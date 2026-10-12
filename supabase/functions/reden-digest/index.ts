import { createClient } from "jsr:@supabase/supabase-js@2";

// Reden notifier. Runs every 15 min via pg_cron.
// mode=instant       -> flush pending events per location immediately
// mode=daily_digest  -> one digest per location per day, at digest_hour local time
// Without RESEND_API_KEY it reports what it WOULD send and dispatches nothing.
// Sender comes from the RESEND_FROM secret (must be on a Resend-verified domain).
// Preview (head office only): POST { "preview": true, "location_id"?: uuid } returns whether email is set up and the
// exact emails that would go out for what is pending. Nothing is sent and nothing is marked dispatched.

const SYM: Record<string, string> = { USD: "$", THB: "฿", PHP: "₱", VND: "₫", IDR: "Rp", KHR: "៛", LAK: "₭" };

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // an Edge Function secret if one is ever set, otherwise the key an admin saved in Settings > Email (Vault)
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? ((await supabase.rpc("email_key")).data as string | null) ?? null;
  const sender = Deno.env.get("RESEND_FROM") ??
    "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";

  let reqBody: { preview?: boolean; location_id?: string } = {};
  try { reqBody = await req.json(); } catch { /* cron sends an empty body */ }
  const preview = reqBody.preview === true;
  if (preview) {
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: me } = await caller.auth.getUser();
    const isAdmin = me.user ? (await caller.rpc("has_role", { _user: me.user.id, _role: "admin" })).data : false;
    const isHO = me.user ? (await caller.rpc("has_role", { _user: me.user.id, _role: "head_office" })).data : false;
    if (!isAdmin && !isHO) return json({ error: "head office only" });
  }

  const { data: settings } = await supabase.from("notification_settings").select("*").eq("id", 1).single();
  const status = {
    email_service_key_set: !!resendKey, sender, enabled: !!settings?.enabled, mode: settings?.mode,
    digest_hour_local: settings?.digest_hour_local, recipients: settings?.recipients?.length ?? 0,
  };
  if (!preview) {
    if (!settings?.enabled) return json({ skipped: "notifications disabled" });
    if (!settings.recipients?.length) return json({ skipped: "no recipients configured" });
  }

  let q = supabase.from("notification_events").select("*").is("dispatched_at", null).order("changed_at").limit(500);
  if (preview && reqBody.location_id) q = q.eq("location_id", reqBody.location_id);
  const { data: events } = await q;
  if (!events?.length) return json({ ok: true, pending: 0, ...(preview ? { status } : {}) });

  const { data: locations } = await supabase.from("locations").select("id, name, timezone");
  const locById = new Map((locations ?? []).map((l) => [l.id, l]));

  // resolve names for the "who made the change" line the brief requires
  const userIds = [...new Set(events.map((e) => e.changed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profs ?? []) names.set(p.id, p.full_name ?? "unknown");
  }

  // the current local price for price lines: the website shows the hostel's own currency
  const pids = [...new Set(events.filter((e) => e.field === "rate_usd" && e.product_id).map((e) => e.product_id))] as string[];
  const localOf = new Map<string, string>();
  if (pids.length) {
    const { data: prods } = await supabase.from("products").select("id, local_amount, local_currency").in("id", pids);
    for (const p of prods ?? []) {
      if (p.local_amount != null && p.local_currency && p.local_currency !== "USD") {
        localOf.set(p.id, `${SYM[p.local_currency] ?? p.local_currency + " "}${Number(p.local_amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
      }
    }
  }

  const byLoc = new Map<string, typeof events>();
  for (const e of events) {
    const k = e.location_id ?? "unknown";
    if (!byLoc.has(k)) byLoc.set(k, []);
    byLoc.get(k)!.push(e);
  }

  const results: Record<string, unknown>[] = [];
  for (const [locId, evts] of byLoc) {
    const loc = locById.get(locId);
    const tz = loc?.timezone ?? "Asia/Phnom_Penh";
    const localHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

    if (settings.mode === "daily_digest" && !preview) {
      if (localHour < settings.digest_hour_local) { results.push({ loc: loc?.name, waiting: true }); continue; }
      const { data: sentToday } = await supabase
        .from("notification_events")
        .select("id").eq("location_id", locId).eq("digest_date", localDate).limit(1);
      if (sentToday?.length) { results.push({ loc: loc?.name, alreadySentToday: true }); continue; }
    }

    // brief: location, product title, what changed, old value, new value, who, timestamp
    const fmtTime = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));
    const lines = evts.map((e) => {
      const who = e.changed_by ? (names.get(e.changed_by) ?? "unknown") : "system";
      const when = fmtTime(e.changed_at);
      if (e.field === "product_added") return `NEW PRODUCT: ${e.product_title}  (by ${who}, ${when})`;
      if (e.field === "rate_usd") {
        const local = localOf.get(e.product_id);
        return `${e.product_title}: price $${e.old_value ?? "(blank)"} -> $${e.new_value ?? "(blank)"}${local ? `, now ${local}` : ""}  (by ${who}, ${when})`;
      }
      return `${e.product_title}: ${e.field.replace(/_/g, " ")}: ${e.old_value ?? "(blank)"} -> ${e.new_value ?? "(blank)"}  (by ${who}, ${when})`;
    });
    const subject = `[Mad Monkey] ${loc?.name ?? "Unknown"}: ${evts.length} website product change${evts.length === 1 ? "" : "s"}`;
    const text = `Website-bookable product changes for ${loc?.name ?? "unknown location"}:\n\n${lines.join("\n")}\n\nOpen the Experience Database for full details.`;

    if (preview) { results.push({ loc: loc?.name, to: settings?.recipients ?? [], subject, text }); continue; }
    if (!resendKey) { results.push({ loc: loc?.name, wouldSend: evts.length, subject }); continue; }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: settings.recipients, subject, text }),
    });
    if (!resp.ok) { results.push({ loc: loc?.name, error: await resp.text() }); continue; }

    await supabase
      .from("notification_events")
      .update({ dispatched_at: new Date().toISOString(), digest_date: localDate })
      .in("id", evts.map((e) => e.id));
    results.push({ loc: loc?.name, sent: evts.length });
  }
  return json({ ok: true, mode: settings?.mode, ...(preview ? { status, preview: true } : {}), results });
});

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
}

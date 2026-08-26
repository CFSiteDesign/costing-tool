import { createClient } from "jsr:@supabase/supabase-js@2";

// Reden notifier. Runs every 15 min via pg_cron.
// mode=instant       -> flush pending events per location immediately
// mode=daily_digest  -> one digest per location per day, at digest_hour local time
// Without RESEND_API_KEY it reports what it WOULD send and dispatches nothing.
// Sender comes from the RESEND_FROM secret (must be on a Resend-verified domain).

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("RESEND_FROM") ??
    "Mad Monkey Experiences <experiences@madmonkeyhostels.com>";



  const { data: settings } = await supabase.from("notification_settings").select("*").eq("id", 1).single();
  if (!settings?.enabled) return json({ skipped: "notifications disabled" });
  if (!settings.recipients?.length) return json({ skipped: "no recipients configured" });

  const { data: events } = await supabase
    .from("notification_events")
    .select("*")
    .is("dispatched_at", null)
    .order("changed_at")
    .limit(500);
  if (!events?.length) return json({ ok: true, pending: 0 });

  const { data: locations } = await supabase.from("locations").select("id, name, timezone");
  const locById = new Map((locations ?? []).map((l) => [l.id, l]));

  // resolve names for the "who made the change" line the brief requires
  const userIds = [...new Set(events.map((e) => e.changed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profs ?? []) names.set(p.id, p.full_name ?? "unknown");
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

    if (settings.mode === "daily_digest") {
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
      return `${e.product_title} — ${e.field.replace(/_/g, " ")}: ${e.old_value ?? "(blank)"} -> ${e.new_value ?? "(blank)"}  (by ${who}, ${when})`;
    });
    const subject = `[Mad Monkey] ${loc?.name ?? "Unknown"}: ${evts.length} website product change${evts.length === 1 ? "" : "s"}`;
    const body = `Website-bookable product changes for ${loc?.name ?? "unknown location"}:\n\n${lines.join("\n")}\n\nOpen the Experience Database for full details.`;

    if (!resendKey) { results.push({ loc: loc?.name, wouldSend: evts.length, subject }); continue; }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: settings.recipients, subject, text: body }),
    });
    if (!resp.ok) { results.push({ loc: loc?.name, error: await resp.text() }); continue; }

    await supabase
      .from("notification_events")
      .update({ dispatched_at: new Date().toISOString(), digest_date: localDate })
      .in("id", evts.map((e) => e.id));
    results.push({ loc: loc?.name, sent: evts.length });
  }
  return json({ ok: true, mode: settings.mode, results });
});

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
}

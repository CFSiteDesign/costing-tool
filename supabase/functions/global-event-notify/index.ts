import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 2 / GE3: when head office launches a global event, every GM of an active hostel
// gets an email saying it is waiting for their answer. Fired by the global_event_notify
// trigger (pg_net) with { event_id }. Without RESEND_API_KEY it records what it WOULD send.
// Sender comes from the RESEND_FROM secret (must be on a Resend-verified domain).

const APP_URL = "https://mm-costing-tool.vercel.app";

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("RESEND_FROM") ?? "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";

  let eventId: string | undefined;
  try { eventId = (await req.json())?.event_id; } catch { /* no body */ }
  if (!eventId) return json({ error: "event_id required" }, 400);

  const { data: ev } = await supabase.from("global_events").select("*").eq("id", eventId).single();
  if (!ev) return json({ error: "event not found" }, 404);

  // every GM of every active hostel, by email
  const [{ data: locs }, { data: ul }, { data: roles }] = await Promise.all([
    supabase.from("locations").select("id, name").eq("is_active", true),
    supabase.from("user_locations").select("user_id, location_id"),
    supabase.from("user_roles").select("user_id, role").eq("role", "gm"),
  ]);
  const gmIds = new Set((roles ?? []).map((r) => r.user_id));
  const locName = new Map((locs ?? []).map((l) => [l.id, l.name]));
  const perGm = new Map<string, string[]>();
  for (const x of ul ?? []) {
    if (!gmIds.has(x.user_id) || !locName.has(x.location_id)) continue;
    if (!perGm.has(x.user_id)) perGm.set(x.user_id, []);
    perGm.get(x.user_id)!.push(locName.get(x.location_id)!);
  }
  const { data: profs } = await supabase.from("profiles").select("id, full_name, email, is_active").in("id", [...perGm.keys()]);
  const recipients = (profs ?? []).filter((p) => p.is_active && p.email).map((p) => ({ email: p.email as string, name: p.full_name ?? "", hostels: perGm.get(p.id) ?? [] }));

  const date = ev.event_date ? new Date(ev.event_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  const time = ev.starts_at ? `${String(ev.starts_at).slice(0, 5)}${ev.ends_at ? `–${String(ev.ends_at).slice(0, 5)}` : ""}` : null;
  const subject = `[Mad Monkey] New global event to accept or decline: ${ev.title}`;
  const body = (hostels: string[]) => [
    `Head office has launched a global event and it is waiting for your answer${hostels.length ? ` for ${hostels.join(", ")}` : ""}.`,
    ``,
    `Event: ${ev.title}`,
    date ? `Date: ${date}` : null,
    time ? `Time: ${time}` : null,
    ev.rate_usd != null ? `Rate: $${ev.rate_usd} (USD)` : `Rate: set by each hostel`,
    ev.brief_description ? `About: ${ev.brief_description}` : null,
    ev.notes ? `` : null,
    ev.notes ? `Message from head office: ${ev.notes}` : null,
    ``,
    `Open the Experience Database, check the details, change anything that is different at your hostel, then accept or decline:`,
    `${APP_URL}/experiences`,
    ``,
    `Accepting adds it to your product list. Declining tells head office you are not running it.`,
  ].filter((l) => l !== null).join("\n");

  const results: Record<string, unknown>[] = [];
  for (const r of recipients) {
    if (!resendKey) { results.push({ to: r.email, wouldSend: true }); continue; }
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: [r.email], subject, text: body(r.hostels) }),
    });
    results.push(resp.ok ? { to: r.email, sent: true } : { to: r.email, error: await resp.text() });
  }
  const summary = { recipients: recipients.length, sent: results.filter((x) => x.sent).length,
    wouldSend: results.filter((x) => x.wouldSend).length, failed: results.filter((x) => x.error).length,
    noResendKey: !resendKey, at: new Date().toISOString(), details: results };
  await supabase.from("global_events").update({ notified_at: new Date().toISOString(), notify_result: summary }).eq("id", eventId);
  return json({ ok: true, ...summary });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

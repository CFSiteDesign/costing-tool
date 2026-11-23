import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildDigest, parseEmails, type HwChange } from "../_shared/hostelworld.ts";

// Hostelworld Link Up changes, once a day (migration 038, 23 Nov 2026).
//   POST {action:"cron"}                 pg_cron, hourly at :10. Sends only once a day, at hostelworld_digest_hour in
//                                         hostelworld_digest_tz, and only when hostelworld_alerts_enabled = 'true'.
//                                         Everything not yet emailed goes out: hostelworld_alerts_all (Reden) gets every
//                                         event and tour, hostelworld_alerts_nightly (Adel, Katrina) nightly events + Meet-Ups.
//   POST {action:"preview", secret}      the emails that would go out now, nothing sent or marked (for testing).
// verify_jwt is off: the cron step only acts in its own slot and preview needs the secret from sync_config.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const APP = "https://madmonkeyhostels.com/experiencedashboard";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function config(): Promise<Record<string, string>> {
  const { data } = await admin.from("sync_config").select("key,value").like("key", "hostelworld_%");
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

function localNow(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function build(cfg: Record<string, string>) {
  const tz = cfg.hostelworld_digest_tz || "Asia/Bangkok";
  const { data, error } = await admin.from("hostelworld_changes")
    .select("id, product_id, product_title, location_id, category, field, old_value, new_value, changed_by, changed_at")
    .is("emailed_at", null).order("changed_at").limit(3000);
  if (error) throw new Error(error.message);
  const changes = (data ?? []) as HwChange[];
  const userIds = [...new Set(changes.map((c) => c.changed_by).filter(Boolean))] as string[];
  const [{ data: locs }, { data: profs }] = await Promise.all([
    admin.from("locations").select("id, name"),
    userIds.length ? admin.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const locById = new Map((locs ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
  const names = new Map((profs ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "unknown"]));
  const ctx = {
    locName: (id: string | null) => (id && locById.get(id)) || "Unknown hostel",
    who: (id: string | null) => (id ? names.get(id) ?? "unknown" : "system"),
    when: (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)),
    appUrl: APP,
    dateLabel: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date()),
  };
  const emails = [
    { to: parseEmails(cfg.hostelworld_alerts_all), digest: buildDigest(changes, "all", ctx) },
    { to: parseEmails(cfg.hostelworld_alerts_nightly), digest: buildDigest(changes, "nightly", ctx) },
  ].filter((e) => e.to.length && e.digest);
  return { changes, emails };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const cfg = await config();

  try {
    if (body.action === "preview") {
      if (!cfg.hostelworld_secret || body.secret !== cfg.hostelworld_secret) return json({ error: "Not allowed" }, 403);
      const { changes, emails } = await build(cfg);
      return json({ ok: true, pending: changes.length, enabled: cfg.hostelworld_alerts_enabled === "true",
        emails: emails.map((e) => ({ to: e.to, subject: e.digest!.subject, count: e.digest!.count, text: e.digest!.text })) });
    }

    if (body.action === "cron") {
      if (cfg.hostelworld_alerts_enabled !== "true") return json({ skipped: "hostelworld_alerts_enabled is not true" });
      const now = localNow(cfg.hostelworld_digest_tz || "Asia/Bangkok");
      const hour = Number(cfg.hostelworld_digest_hour ?? 9);
      if (now.hour < hour) return json({ skipped: "before the send hour" });
      if (cfg.hostelworld_last_digest === now.date) return json({ skipped: "already sent today" });

      const { changes, emails } = await build(cfg);
      const key = Deno.env.get("RESEND_API_KEY") ?? ((await admin.rpc("email_key")).data as string | null);
      if (emails.length && !key) return json({ error: "no email key" }, 500);
      const from = Deno.env.get("RESEND_FROM") ?? "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";
      const sent: unknown[] = [];
      for (const e of emails) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: e.to, subject: e.digest!.subject, text: e.digest!.text }),
        });
        if (!r.ok) throw new Error(`email to ${e.to.join(", ")}: HTTP ${r.status} ${await r.text()}`);   // nothing marked: retried next hour
        sent.push({ to: e.to, count: e.digest!.count });
      }
      // everything pending was covered (each audience gets its share), so all of it is now emailed
      const ids = changes.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await admin.from("hostelworld_changes").update({ emailed_at: new Date().toISOString() }).in("id", ids.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
      await admin.from("sync_config").upsert({ key: "hostelworld_last_digest", value: now.date });
      console.log(JSON.stringify({ hostelworld_digest: now.date, changes: ids.length, sent }));
      return json({ ok: true, changes: ids.length, sent });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Something went wrong" }, 500);
  }
});

import { createClient } from "jsr:@supabase/supabase-js@2";

// One hostel's week, for STUDIO's weekly event posters (Charlie, 13 Nov 2026). STUDIO reads what's on at a hostel
// and makes that week's posters from it, so every title, day, time and price comes from here.
//
//   POST { "action": "locations", "ts": 1763020800000 }
//     -> { locations: [{ name, country, timezone, currency }], gms: [{ email, hostels }] }
//        every active hostel (STUDIO's Monday schedule) and each GM login's hostels (who sees which pack)
//   POST { "action": "week", "location": "Siargao", "week_start": "2026-11-16", "ts": 1763020800000 }
//     -> { hostel, country, currency, timezone, week_start, experiences: [...] }   (public.hostel_week)
//
// Same rule as My week and the Claude connector's whats_on: live experiences on that weekday plus dated runs, minus
// blackout days, transport left out. Guest-facing facts only, no suppliers, costs or notes.
//
// Auth = the key STUDIO already shares with this database for the ASSET button: HMAC-SHA256 of the raw body with
// sync_config.studio_asset_secret (STUDIO's MM_ASSET_SECRET), sent as x-mm-signature, exactly like asset-callback.
// The body carries ts (ms) and anything older than 5 minutes is refused, so a copied request can't be replayed.
// verify_jwt is off by design: STUDIO's backend is not a Supabase client. Server to server only, no CORS.

const MAX_SKEW_MS = 5 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: cfg } = await sb.from("sync_config").select("value").eq("key", "studio_asset_secret").single();
    if (!cfg) return json({ error: "secret not configured" }, 500);

    const raw = await req.text();
    const expected = await hmacHex(cfg.value, raw);
    if (!timingSafeEqual(req.headers.get("x-mm-signature") ?? "", expected)) return json({ error: "bad signature" }, 401);

    let body: { action?: string; location?: string; week_start?: string; ts?: number };
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }
    if (typeof body.ts !== "number" || Math.abs(Date.now() - body.ts) > MAX_SKEW_MS) return json({ error: "stale request" }, 401);

    if (body.action === "locations") {
      const { data, error } = await sb.from("locations").select("id,name,country,timezone,currency").eq("is_active", true).order("name");
      if (error) throw error;
      // Which GM runs which hostel, so STUDIO shows each GM their own hostel's posters. Same rule as the
      // connector's gm_logins: a GM login tied to 3 hostels or fewer (head office accounts are left out).
      const [roles, links, people] = await Promise.all([
        sb.from("user_roles").select("user_id").eq("role", "gm"),
        sb.from("user_locations").select("user_id,location_id"),
        sb.from("profiles").select("id,email").eq("is_active", true),
      ]);
      for (const r of [roles, links, people]) if (r.error) throw r.error;
      const names = new Map((data ?? []).map((l) => [l.id, l.name]));
      const isGm = new Set((roles.data ?? []).map((r) => r.user_id));
      const byUser = new Map<string, string[]>();
      for (const l of links.data ?? []) {
        if (!isGm.has(l.user_id) || !names.has(l.location_id)) continue;
        byUser.set(l.user_id, [...(byUser.get(l.user_id) ?? []), names.get(l.location_id)!]);
      }
      const gms = (people.data ?? [])
        .filter((p) => p.email && byUser.has(p.id) && byUser.get(p.id)!.length <= 3)
        .map((p) => ({ email: String(p.email).toLowerCase(), hostels: [...new Set(byUser.get(p.id))].sort() }));
      return json({ locations: (data ?? []).map(({ id: _id, ...l }) => l), gms });
    }

    if (body.action === "week") {
      const location = typeof body.location === "string" ? body.location.trim() : "";
      if (!location) return json({ error: 'Send "location", e.g. "Siargao"' }, 400);
      if (!body.week_start || !ISO_DATE.test(body.week_start)) return json({ error: 'Send "week_start" as YYYY-MM-DD' }, 400);
      const { data, error } = await sb.rpc("hostel_week", { p_location: location, p_week_start: body.week_start });
      if (error) throw error;
      return json(data);
    }

    return json({ error: 'action must be "locations" or "week"' }, 400);
  } catch (e) {
    console.error("hostel-week error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

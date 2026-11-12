import { createClient } from "jsr:@supabase/supabase-js@2";

// Activities a hostel runs, for the Creator Hub (Cai's brief, 12 Nov 2026). When marketing approves a creator stay
// they can add one activity as a perk; the list comes from here so it always matches what the GM keeps up to date.
//
//   POST { "location": "Koh Rong" }  ->  { location, activities: [{ id, title, category }] }
//
// Only live products (active or signature, running on the ground) in the activity categories: Mad Monkey tours,
// third-party tours and nightly events. Transport and one-off dated events are left out. Titles only: no rates,
// suppliers or notes leave the database.
//
// Same key scheme as allin-guest-trips: the calling app sends its own key in x-api-key (made in Settings > API keys,
// only a SHA-256 hash is kept). Server to server only, so there are no CORS headers.

const CATEGORIES = ["mm_tour", "third_party_tour", "nightly_event"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const presented = (req.headers.get("x-api-key") ?? "").trim();
    if (!presented) return json({ error: "Key required (x-api-key header)" }, 401);
    const { data: client } = await sb.from("api_clients").select("id,revoked_at").eq("key_hash", await sha256(presented)).maybeSingle();
    if (!client || client.revoked_at) return json({ error: "Wrong or revoked key" }, 401);
    sb.from("api_clients").update({ last_used_at: new Date().toISOString() }).eq("id", client.id).then(() => {});

    const location = typeof body.location === "string" ? body.location.trim() : "";
    if (!location) return json({ error: 'Send {"location": "Koh Rong"}' }, 400);

    const { data: loc, error: locErr } = await sb.from("locations").select("id,name").ilike("name", location).maybeSingle();
    if (locErr) throw locErr;
    if (!loc) return json({ location, activities: [], unknown_location: true });

    const { data, error } = await sb.from("products")
      .select("id,title,category")
      .eq("location_id", loc.id)
      .in("category", CATEGORIES)
      .in("status", ["active", "signature"])
      .eq("active_on_ground", true)
      .order("title");
    if (error) throw error;

    // Some hostels list the same event twice (e.g. a meet-up on two nights); one entry per title is enough to pick from.
    const order = (c: string) => CATEGORIES.indexOf(c);
    const seen = new Set<string>();
    const activities = (data ?? [])
      .map((p) => ({ id: p.id, title: String(p.title).trim(), category: p.category }))
      .sort((a, b) => order(a.category) - order(b.category) || a.title.localeCompare(b.title))
      .filter((a) => {
        const k = a.title.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    return json({ location: loc.name, activities });
  } catch (e) {
    console.error("hostel-activities error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

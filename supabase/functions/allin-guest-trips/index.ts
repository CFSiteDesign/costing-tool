import { createClient } from "jsr:@supabase/supabase-js@2";

// ALL IN guest trips for other Mad Monkey apps (Charlie, 19 Oct 2026): Dhany's Loyalty app and Ayush's main website
// and WhatsApp messages. Every booking comes back with its day-by-day on real dates, so a guest can see where to be
// each day and nobody misses a boat or a transfer.
//
// Each app sends its own key in the x-api-key header (made in Settings > API keys; only a SHA-256 hash is kept here).
// Bookings come from allin_bookings, synced from the ALL IN site every 5 minutes; days from allin_trip_days.
//
//   { "email": "guest@x.com" }        that guest's ALL IN trips, as the lead booker or a named traveller
//   { "emails": ["a@x.com", ...] }    the same for up to 100 guests
//   { "booking_ref": "SOL-LAO-001" }  one booking
//   { "date": "2026-11-24" }          every confirmed guest on an ALL IN trip that day, with that day's plan
//
// Server to server only: the key must never reach a browser, so there are no CORS headers.

const MAX_EMAILS = 100;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type DayRow = {
  trip_slug: string; day_from: number; day_to: number; label: string; place: string; body: string;
  transport: string | null; activities: string | null; meals: string | null;
};
type BookingRow = {
  booking_ref: string; status: string; trip_slug: string | null; departure_date: string | null;
  end_date: string | null; payload: Record<string, unknown>; synced_at: string;
};

// The day-by-day on real dates. Day 1 is the departure date; guests arrive the day before.
function datedDays(b: BookingRow, days: DayRow[]) {
  const start = b.departure_date;
  return days
    .filter((d) => d.trip_slug === b.trip_slug)
    .sort((x, y) => x.day_from - y.day_from)
    .map((d) => ({
      day_from: d.day_from,
      day_to: d.day_to,
      label: d.label,
      date_from: start ? plusDays(start, d.day_from - 1) : null,
      date_to: start ? plusDays(start, d.day_to - 1) : null,
      place: d.place,
      plan: d.body,
      transport: d.transport,
      activities: d.activities,
      meals: d.meals,
    }));
}

function shape(b: BookingRow, days: DayRow[], onDate?: string) {
  const itinerary = datedDays(b, days);
  const arrival = b.departure_date ? plusDays(b.departure_date, -1) : null;
  const out: Record<string, unknown> = {
    ...b.payload,
    arrival: { date: arrival, note: "Arrive the day before Day 1 and check in at the first hostel." },
    days: itinerary,
    synced_at: b.synced_at,
  };
  if (onDate && b.departure_date) {
    const n = daysBetween(b.departure_date, onDate) + 1;
    out.on_date = {
      date: onDate,
      day: n,
      is_arrival_day: n === 0,
      plan: n === 0 ? null : itinerary.find((d) => n >= d.day_from && n <= d.day_to) ?? null,
    };
  }
  return out;
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

    const cols = "booking_ref,status,trip_slug,departure_date,end_date,payload,synced_at";
    let rows: BookingRow[] = [];
    let onDate: string | undefined;

    const emails = [
      ...(typeof body.email === "string" ? [body.email] : []),
      ...(Array.isArray(body.emails) ? body.emails : []),
    ].map(lower).filter((e) => EMAIL.test(e));
    if (emails.length > MAX_EMAILS) return json({ error: `Max ${MAX_EMAILS} emails per call` }, 400);

    if (emails.length) {
      const { data, error } = await sb.from("allin_bookings").select(cols).overlaps("emails", [...new Set(emails)]);
      if (error) throw error;
      rows = (data ?? []) as BookingRow[];
    } else if (typeof body.booking_ref === "string" && body.booking_ref.trim()) {
      const { data, error } = await sb.from("allin_bookings").select(cols).eq("booking_ref", body.booking_ref.trim().toUpperCase());
      if (error) throw error;
      rows = (data ?? []) as BookingRow[];
    } else if (typeof body.date === "string" && DATE.test(body.date)) {
      onDate = body.date;
      // On the trip that day: from the arrival day (the day before Day 1) to the last day.
      const { data, error } = await sb.from("allin_bookings").select(cols)
        .eq("status", "confirmed").lte("departure_date", plusDays(onDate, 1)).gte("end_date", onDate);
      if (error) throw error;
      rows = (data ?? []) as BookingRow[];
    } else {
      return json({ error: 'Send {"email"}, {"emails": [...]}, {"booking_ref"} or {"date": "YYYY-MM-DD"}' }, 400);
    }

    const slugs = [...new Set(rows.map((r) => r.trip_slug).filter((s): s is string => Boolean(s)))];
    const { data: days, error: dErr } = slugs.length
      ? await sb.from("allin_trip_days").select("*").in("trip_slug", slugs)
      : { data: [], error: null };
    if (dErr) throw dErr;

    const bookings = rows
      .sort((a, b) => String(a.departure_date ?? "").localeCompare(String(b.departure_date ?? "")))
      .map((r) => {
        const shaped = shape(r, (days ?? []) as DayRow[], onDate);
        // For an email lookup: whether the asked-for guest is the lead booker or a named traveller.
        if (emails.length) {
          const lead = lower((r.payload.lead as { email?: string } | undefined)?.email);
          shaped.role = emails.includes(lead) ? "lead" : "traveller";
        }
        return shaped;
      });
    return json({ count: bookings.length, bookings });
  } catch (e) {
    console.error("allin-guest-trips failed:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong" }, 500);
  }
});

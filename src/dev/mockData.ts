/**
 * DEV ONLY. Mock data and a fetch interceptor for the tour harness (/__dev/tour). Imported only behind
 * `import.meta.env.DEV`, so production builds never include it. While the harness is on, every request that is not
 * to the local dev server is answered here: nothing reaches the production database, and writes go nowhere.
 */
import type { Location, Product, Role } from "@/lib/types";

if (!import.meta.env.DEV) throw new Error("The tour harness is development-only.");

export type HarnessPersona = "gm" | "head_office" | "sales" | "admin";

export const PEOPLE: Record<HarnessPersona, { name: string; email: string; roles: Role[] }> = {
  gm: { name: "Sam Taylor", email: "sam@harness.local", roles: ["gm"] },
  head_office: { name: "Jo Rivers", email: "jo@harness.local", roles: ["head_office"] },
  sales: { name: "Alex Chen", email: "alex@harness.local", roles: ["sales"] },
  admin: { name: "Pat Morgan", email: "pat@harness.local", roles: ["admin"] },
};

export const LOCATIONS: Location[] = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Siem Reap", country: "Cambodia", timezone: "Asia/Phnom_Penh", currency: "USD" },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Phuket", country: "Thailand", timezone: "Asia/Bangkok", currency: "THB" },
  { id: "a0000000-0000-4000-8000-000000000003", name: "Kuta Lombok", country: "Indonesia", timezone: "Asia/Makassar", currency: "IDR" },
];
const FX: Record<string, number> = { USD: 1, THB: 36.2, IDR: 16300, KHR: 4100 };

type Row = Record<string, unknown>;
const ALL = [1, 2, 3, 4, 5, 6, 7];
const SEED: [title: string, category: Product["category"], rate: number, days: number[], start: string | null, end: string | null, extra?: Partial<Product>][] = [
  ["Sunrise Temple Tour", "mm_tour", 18, ALL, "04:30", "12:00", { status: "signature", bookable_on_website: true }],
  ["Waterfall Day Trip", "mm_tour", 32, [1, 3, 5], "08:00", "15:00", { bookable_on_website: true }],
  ["Morning Yoga by the Pool", "mm_tour", 6, ALL, "07:00", "08:00"],
  ["Pub Crawl", "nightly_event", 10, [1, 3, 5], "20:00", "23:30", { status: "signature" }],
  ["Beer Pong Night", "nightly_event", 0, [2, 4], "21:00", "23:00"],
  ["Karaoke Night", "nightly_event", 0, [6], "20:00", "23:00"],
  ["Pool Party BBQ", "nightly_event", 8, [7], "15:00", "19:00"],
  ["Quiz Night", "nightly_event", 0, [2], "19:30", "21:30", { status: "pending_update" }],
  ["Quad Bike Sunset", "third_party_tour", 35, ALL, "16:30", "18:30"],
  ["Cooking Class", "third_party_tour", 25, [1, 3, 6], "10:00", "13:00"],
  ["Floating Village Boat Trip", "third_party_tour", 28, [2, 5], "13:00", "17:30", { status: "paused", active_on_ground: false }],
  ["Circus Night Out", "third_party_tour", 22, ALL, "19:30", "21:00"],
];
const TRANSPORT: [title: string, rate: number, vehicle: string, from: string, to: string, times: string[], mins: number][] = [
  ["Van to the capital", 12, "Van", "Hostel", "Capital bus park", ["08:00:00", "14:00:00"], 360],
  ["Bus to the coast", 15, "Bus", "Hostel", "Coast terminal", ["07:30:00"], 480],
  ["Airport transfer", 10, "Tuk-tuk", "Airport", "Hostel", [], 40],
];

const pid = (loc: number, i: number) => `b${loc}000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const today = new Date().toISOString().slice(0, 10);

function products(): Row[] {
  const rows: Row[] = [];
  LOCATIONS.forEach((l, li) => {
    const fx = FX[l.currency] ?? 1;
    const local = (usd: number) => (l.currency === "USD" ? null : Math.round(usd * fx));
    SEED.forEach(([title, category, rate, days, start, end, extra], i) => rows.push({
      id: pid(li + 1, i + 1), location_id: l.id, category, title, operator_id: null,
      rate_usd: rate, rate_raw: null, local_amount: local(rate), local_currency: l.currency === "USD" ? null : l.currency, fx_rate_used: fx, fx_as_of: today,
      gross_service_value: null, active_on_ground: true, bookable_on_website: false, status: "active", days_of_week: days, availability_raw: null,
      starts_at: start && `${start}:00`, ends_at: end && `${end}:00`, duration_minutes: null, min_guests: 1, max_guests_per_day: 20,
      brief_description: `${title} from the tour desk.`, long_description: null, meeting_point: "Reception", inclusions: null, exclusions: null,
      things_to_bring: null, cancellation_policy: null, itinerary: null, travel_insurance_required: false, photo_album_url: null, remarks: null,
      rezdy_reference: null, expires_on: null, last_verified_at: i % 3 === 0 ? null : `${today}T09:00:00Z`, updated_at: `${today}T09:00:00Z`,
      price_options: [],
      ...extra,
      // the first product shows two prices and the website status line (Oct 2026)
      ...(i === 0 ? { bookable_on_website: true, price_options: [
        { label: "Without transfer", local_amount: local(rate - 5), rate_usd: rate - 5 },
        { label: "With transfer", local_amount: local(rate), rate_usd: rate },
      ] } : {}),
    }));
    TRANSPORT.forEach(([title, rate, vehicle, from, to, times, mins], i) => rows.push({
      id: pid(li + 1, 100 + i), location_id: l.id, category: "transport", title, rate_usd: rate, rate_raw: null, local_amount: local(rate),
      local_currency: null, active_on_ground: true, bookable_on_website: false, status: "active", days_of_week: ALL, starts_at: times[0] ?? null,
      ends_at: null, duration_minutes: mins, expires_on: null, last_verified_at: null,
      transport_details: { vehicle_type: vehicle, route_raw: `${from} to ${to}`, origin: from, destination: to, pickup_point: from, dropoff_point: to, departure_times: times },
    }));
  });
  return rows;
}

const GLOBAL_EVENTS: Row[] = [
  { id: "c0000000-0000-4000-8000-000000000001", title: "Halloween Party", category: "one_time_event", event_date: "2026-10-31", expires_on: "2026-11-01",
    days_of_week: [], starts_at: "20:00:00", ends_at: "02:00:00", duration_minutes: null, rate_usd: 15, brief_description: "Costumes, bucket drinks and a scare or two.",
    long_description: null, inclusions: "Welcome shot", things_to_bring: "A costume", photo_album_url: null, bookable_on_website: true,
    notes: "Same night at every hostel, please.", asset_urls: [], notified_at: null, notify_result: { recipients: 23, sent: 0, wouldSend: 23, failed: 0, noResendKey: true },
    created_at: `${today}T08:00:00Z` },
  { id: "c0000000-0000-4000-8000-000000000002", title: "Oktoberfest Weekend", category: "one_time_event", event_date: "2026-10-03", expires_on: "2026-10-05",
    days_of_week: [], starts_at: "18:00:00", ends_at: "23:00:00", duration_minutes: null, rate_usd: 12, brief_description: "Steins, pretzels and a very loud oompah playlist.",
    long_description: null, inclusions: null, things_to_bring: null, photo_album_url: null, bookable_on_website: false, notes: null, asset_urls: [],
    notified_at: `${today}T08:00:00Z`, notify_result: null, created_at: "2026-09-20T08:00:00Z" },
];

function responses(persona: HarnessPersona): Row[] {
  return LOCATIONS.flatMap((l, i) => GLOBAL_EVENTS.map((e, j) => ({
    global_event_id: e.id, location_id: l.id, overrides: null,
    status: j === 0 ? (persona === "gm" || i > 0 ? "pending" : "accepted") : "accepted",
    responded_at: null, global_events: e,
  })));
}

const QUOTES: Row[] = [
  { id: "d0000000-0000-4000-8000-000000000001", reference: "Q-2026-031", title: "Cambodia loop, March", status: "sent", pax_count: 14, created_at: "2026-09-28T10:00:00Z",
    customers: { contact_name: "Dana Fox", company_name: "Wanderlust Tours", country: "Australia" }, quote_versions: [{ version_no: 1, total_usd: 8420 }, { version_no: 2, total_usd: 8105 }] },
  { id: "d0000000-0000-4000-8000-000000000002", reference: "Q-2026-030", title: "Island hop, April", status: "draft", pax_count: 8, created_at: "2026-09-25T10:00:00Z",
    customers: { contact_name: "Lee Park", company_name: null, country: "Korea" }, quote_versions: [] },
  { id: "d0000000-0000-4000-8000-000000000003", reference: "Q-2026-027", title: "Uni society trip", status: "accepted", pax_count: 22, created_at: "2026-09-12T10:00:00Z",
    customers: { contact_name: "Robin Hart", company_name: "Student Union", country: "UK" }, quote_versions: [{ version_no: 1, total_usd: 11950 }] },
];

function audit(): Row[] {
  return LOCATIONS.flatMap((l, li) => [
    { id: li * 10 + 1, table_name: "products", action: "UPDATE", changed_by: "harness-gm", changed_at: new Date(Date.now() - 12 * 60_000).toISOString(), location_id: l.id,
      changed_fields: ["rate_usd"], old_values: { title: "Pub Crawl", rate_usd: 8 }, new_values: { title: "Pub Crawl", rate_usd: 10 } },
    { id: li * 10 + 2, table_name: "products", action: "UPDATE", changed_by: "harness-gm", changed_at: new Date(Date.now() - 3 * 3600_000).toISOString(), location_id: l.id,
      changed_fields: ["starts_at", "ends_at"], old_values: { title: "Karaoke Night", starts_at: "19:00:00", ends_at: "22:00:00" }, new_values: { title: "Karaoke Night", starts_at: "20:00:00", ends_at: "23:00:00" } },
    { id: li * 10 + 3, table_name: "products", action: "INSERT", changed_by: "harness-gm", changed_at: new Date(Date.now() - 26 * 3600_000).toISOString(), location_id: l.id,
      changed_fields: [], old_values: null, new_values: { title: "Quiz Night" } },
    { id: li * 10 + 4, table_name: "products", action: "UPDATE", changed_by: "harness-ho", changed_at: new Date(Date.now() - 50 * 3600_000).toISOString(), location_id: l.id,
      changed_fields: ["status"], old_values: { title: "Floating Village Boat Trip", status: "active" }, new_values: { title: "Floating Village Boat Trip", status: "paused" } },
  ]);
}

function tables(persona: HarnessPersona): Record<string, Row[] | Row> {
  return {
    products: products(),
    transport_details: products().filter((p) => p.transport_details).map((p) => ({ product_id: p.id, ...(p.transport_details as Row) })),
    product_assets: [],
    import_exceptions: [],
    product_date_rules: [],
    product_key_days: LOCATIONS.flatMap((l, li) => [
      { product_id: pid(li + 1, 4), weekday: 1, location_id: l.id }, { product_id: pid(li + 1, 2), weekday: 3, location_id: l.id },
      { product_id: pid(li + 1, 6), weekday: 6, location_id: l.id },
    ]),
    global_events: GLOBAL_EVENTS,
    global_event_responses: responses(persona),
    quotes: QUOTES,
    audit_log: audit(),
    profiles: [{ id: "harness-gm", full_name: "Sam Taylor", mimo_met_at: null }, { id: "harness-ho", full_name: "Jo Rivers", mimo_met_at: null }],
    fx_rates: Object.entries(FX).map(([code, units]) => ({ code, units_per_usd: units, manual_override: null, as_of: today, source: "api" })),
    rate_sync_runs: [{ id: 1, source: "sample_seed", triggered_by: "seed", status: "success", started_at: `${today}T01:00:00Z`, finished_at: `${today}T01:00:05Z` }],
    notification_settings: [{ id: 1, mode: "daily_digest", recipients: ["web@harness.local"], enabled: true }],
    notification_events: [   // Approvals > Website updates
      { id: 1, product_id: pid(1, 1), product_title: "Pub Crawl", location_id: LOCATIONS[0].id, field: "rate_usd", old_value: "8.00", new_value: "10.00",
        changed_by: "harness-gm", changed_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
      { id: 2, product_id: pid(1, 1), product_title: "Pub Crawl", location_id: LOCATIONS[0].id, field: "brief_description", old_value: "Five bars, one wristband.",
        new_value: "Five bars, one wristband, free shot at every stop.", changed_by: "harness-gm", changed_at: new Date(Date.now() - 3600_000).toISOString() },
      { id: 3, product_id: pid(1, 9), product_title: "Monday Madness", location_id: LOCATIONS[0].id, field: "product_added", old_value: null, new_value: "Monday Madness",
        changed_by: "harness-gm", changed_at: new Date(Date.now() - 20 * 3600_000).toISOString() },
      { id: 4, product_id: pid(2, 3), product_title: "Sunset Cruise", location_id: LOCATIONS[1].id, field: "starts_at", old_value: "17:00:00", new_value: "16:30:00",
        changed_by: "harness-ho", changed_at: new Date(Date.now() - 5 * 3600_000).toISOString() },
      { id: 5, product_id: pid(1, 2), product_title: "Karaoke Night", location_id: LOCATIONS[0].id, field: "rate_usd", old_value: "5.00", new_value: "6.00",
        changed_by: "harness-gm", changed_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
        website_done_at: new Date(Date.now() - 26 * 3600_000).toISOString(), website_done_by: "harness-ho" },
    ].map((e) => ({ website_done_at: null, website_done_by: null, ...e })),
    sheet_sync_proposals: [],
    product_time_proposals: [],
    weekly_stories: [],
    room_types: [],
    season_calendar: [],
  };
}

// ---------------------------------------------------------------- a tiny PostgREST stand-in

function matches(row: Row, col: string, expr: string): boolean {
  if (!(col in row)) return true;   // filters on columns the mock doesn't model are ignored
  const v = row[col];
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot), arg = decodeURIComponent(expr.slice(dot + 1));
  const s = v == null ? "null" : String(v);
  switch (op) {
    case "eq": return s === arg;
    case "neq": return s !== arg;
    case "not": return !matches(row, col, arg);   // not.is.null
    case "is": return arg === "null" ? v == null : s === arg;
    case "in": return arg.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(s);
    case "gte": return v != null && s >= arg;
    case "lte": return v != null && s <= arg;
    case "ilike": return s.toLowerCase().includes(arg.replace(/%/g, "").toLowerCase());
    case "cs": { const want = arg.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number); return Array.isArray(v) && want.every((w) => (v as number[]).includes(w)); }
    default: return true;
  }
}

const RESERVED = new Set(["select", "order", "limit", "offset", "or", "and", "on_conflict", "columns"]);
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

export function mockResponse(url: URL, method: string, headers: Headers, persona: HarnessPersona): Response {
  const path = url.pathname;
  if (path === "/rest/v1/rpc/list_quotes") return json(tables(persona).quotes);   // the Quotes list (migration 021)
  if (path === "/rest/v1/rpc/website_status") return json({ pending: 1, last_done_at: null, last_done_by: null });   // product page (024)
  if (path.startsWith("/rest/v1/rpc/")) return json(null);
  if (path.startsWith("/rest/v1/")) {
    const wantsObject = (headers.get("accept") ?? "").includes("vnd.pgrst.object");
    if (method !== "GET" && method !== "HEAD") {   // writes are swallowed: the harness never changes anything
      return wantsObject ? json({ id: "harness-new" }, { status: 201 }) : new Response(null, { status: 204 });
    }
    const source = tables(persona)[path.slice("/rest/v1/".length)];
    let rows = Array.isArray(source) ? source : source ? [source] : [];
    for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) rows = rows.filter((r) => matches(r, k, v));
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
    rows = rows.slice(offset, limit == null ? undefined : offset + limit);
    const range = { "content-range": rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}` };
    if (method === "HEAD") return new Response(null, { status: 200, headers: range });
    if (wantsObject) return rows.length ? json(rows[0], { headers: range }) : json({ code: "PGRST116", message: "harness: no rows" }, { status: 406 });
    return json(rows, { headers: range });
  }
  if (path.startsWith("/functions/v1/")) {
    return json({ reply: "This is the dev harness, so there's no real Assistant behind me. Nothing changed.", kind: "answer", changes: [], log_id: null });
  }
  if (path.startsWith("/auth/v1/")) return json({ message: "harness: auth is mocked" }, { status: 401 });
  return json({ message: "blocked by the dev harness" }, { status: 503 });
}

let realFetch: typeof window.fetch | null = null;
let current: HarnessPersona = "gm";

/** Answer every non-local request from the mock while the harness is on. Idempotent. */
export function installMockFetch(persona: HarnessPersona) {
  current = persona;
  if (realFetch) return;
  realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), window.location.href);
    if (url.origin === window.location.origin) return realFetch!(input, init);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? req?.headers);
    await new Promise((r) => setTimeout(r, 120));   // a little latency, like hostel wifi on a good day
    return mockResponse(url, method, headers, current);
  };
}

export function uninstallMockFetch() {
  if (realFetch) window.fetch = realFetch;
  realFetch = null;
}

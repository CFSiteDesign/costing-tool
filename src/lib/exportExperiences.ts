import { supabase } from "@/lib/supabase";
import { CATEGORY_LABELS, type Category, type PriceOption } from "@/lib/types";
import { formatOptions } from "@/components/app/PriceOptions";

/**
 * Export to spreadsheet (Oct 2026): every experience the signed-in person can see, as an .xlsx with an
 * "All hostels" tab plus one tab per hostel, in roughly the flow chart's column order. Head office and sales get
 * every hostel; a GM gets their own (RLS decides). Built in the browser; nothing is stored.
 */
type Row = Record<string, unknown>;
const DAYN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAT_ORDER: Category[] = ["mm_tour", "nightly_event", "third_party_tour", "one_time_event", "transport"];
const STATUS: Record<string, string> = { active: "Active", paused: "Paused", signature: "Signature", pending_update: "Pending update" };
const days = (d: number[] | null) => !d?.length ? "" : d.length === 7 ? "Every day" : d.map((x) => DAYN[x]).join(" ");
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
const ymd = (t: string | null) => (t ? t.slice(0, 10) : "");

async function all(table: string, select: string) {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

// [header, width, value]
const COLS: [string, number, (p: Row, t: Row | undefined) => unknown][] = [
  ["Category", 18, (p) => CATEGORY_LABELS[p.category as Category] ?? p.category],
  ["Title", 40, (p) => p.title],
  ["Status", 14, (p) => STATUS[p.status as string] ?? p.status],
  ["Active on the ground", 12, (p) => (p.active_on_ground ? "Yes" : "No")],
  ["On the website", 12, (p) => (p.bookable_on_website ? "Yes" : "No")],
  ["Rate USD", 10, (p) => (p.rate_usd == null ? "" : Number(p.rate_usd))],
  ["Local price", 12, (p) => (p.local_amount == null ? "" : Number(p.local_amount))],
  ["Currency", 9, (p) => p.local_currency ?? ""],
  ["Price options", 40, (p) => formatOptions(p.price_options as PriceOption[] | null, p.local_currency as string | null)],
  ["Days", 16, (p) => days(p.days_of_week as number[])],
  ["Start", 8, (p) => hhmm(p.starts_at as string)],
  ["Finish", 8, (p) => hhmm(p.ends_at as string)],
  ["Duration (mins)", 10, (p) => (p.duration_minutes == null ? "" : Number(p.duration_minutes))],
  ["Event date / expiry", 12, (p) => ymd(p.expires_on as string)],
  ["Min guests", 9, (p) => (p.min_guests == null ? "" : Number(p.min_guests))],
  ["Max guests / day", 9, (p) => (p.max_guests_per_day == null ? "" : Number(p.max_guests_per_day))],
  ["Brief description", 50, (p) => p.brief_description ?? ""],
  ["Long description", 60, (p) => p.long_description ?? ""],
  ["Meeting point", 30, (p) => p.meeting_point ?? ""],
  ["Inclusions", 30, (p) => p.inclusions ?? ""],
  ["Exclusions", 30, (p) => p.exclusions ?? ""],
  ["Things to bring", 25, (p) => p.things_to_bring ?? ""],
  ["Cancellation policy", 30, (p) => p.cancellation_policy ?? ""],
  ["Itinerary", 50, (p) => p.itinerary ?? ""],
  ["Travel insurance required", 10, (p) => (p.travel_insurance_required ? "Yes" : "No")],
  ["Photo album", 30, (p) => p.photo_album_url ?? ""],
  ["Vehicle", 14, (_p, t) => t?.vehicle_type ?? ""],
  ["Route", 30, (_p, t) => t?.route_raw ?? ""],
  ["Pickup", 25, (_p, t) => t?.pickup_point ?? ""],
  ["Drop-off", 25, (_p, t) => t?.dropoff_point ?? ""],
  ["Departures", 18, (_p, t) => ((t?.departure_times as string[] | null) ?? []).map((x) => x.slice(0, 5)).join(", ")],
  ["Remarks", 30, (p) => p.remarks ?? ""],
  ["Last updated", 12, (p) => ymd(p.updated_at as string)],
  ["Last verified", 12, (p) => ymd(p.last_verified_at as string)],
];

const cell = (v: unknown, bold = false) => {
  if (v === "" || v == null) return null;
  return typeof v === "number" ? { value: v, type: Number, ...(bold ? { fontWeight: "bold" as const } : {}) }
    : { value: String(v), type: String, ...(bold ? { fontWeight: "bold" as const } : {}) };
};

export async function exportExperiences(): Promise<{ hostels: number; rows: number; fileName: string }> {
  const [products, transport, locations] = await Promise.all([
    all("products", "*"),
    all("transport_details", "product_id, vehicle_type, route_raw, pickup_point, dropoff_point, departure_times"),
    all("locations", "id, name"),
  ]);
  const tByProduct = new Map(transport.map((t) => [t.product_id as string, t]));
  const locName = new Map(locations.map((l) => [l.id as string, String(l.name)]));
  const sorted = [...products].sort((a, b) =>
    (locName.get(a.location_id as string) ?? "").localeCompare(locName.get(b.location_id as string) ?? "") ||
    CAT_ORDER.indexOf(a.category as Category) - CAT_ORDER.indexOf(b.category as Category) ||
    String(a.title).localeCompare(String(b.title)));

  const header = (withHostel: boolean) => [...(withHostel ? [cell("Hostel", true)] : []), ...COLS.map(([h]) => cell(h, true))];
  const line = (p: Row, withHostel: boolean) => [...(withHostel ? [cell(locName.get(p.location_id as string) ?? "")] : []), ...COLS.map(([, , f]) => cell(f(p, tByProduct.get(p.id as string))))];
  const widths = (withHostel: boolean) => [...(withHostel ? [{ width: 16 }] : []), ...COLS.map(([, w]) => ({ width: w }))];

  const hostelIds = [...new Set(sorted.map((p) => p.location_id as string))];
  const data = [[header(true), ...sorted.map((p) => line(p, true))]];
  const sheets = ["All hostels"];
  const columns = [widths(true)];
  for (const id of hostelIds) {
    data.push([header(false), ...sorted.filter((p) => p.location_id === id).map((p) => line(p, false))]);
    sheets.push((locName.get(id) ?? "Unknown").replace(/[[\]:*?/\\]/g, " ").slice(0, 31));
    columns.push(widths(false));
  }
  const multi = hostelIds.length > 1;
  const fileName = `mad-monkey-experiences-${multi ? "all-hostels" : (locName.get(hostelIds[0]) ?? "hostel").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const { default: writeXlsxFile } = await import("write-excel-file");
  // one hostel: just its own tab; several: the all-hostels tab first, then one per hostel
  await (multi
    ? writeXlsxFile(data as never, { sheets, columns: columns as never, fileName, stickyRowsCount: 1 } as never)
    : writeXlsxFile(data[1] as never, { sheet: sheets[1], columns: columns[1] as never, fileName, stickyRowsCount: 1 } as never));
  return { hostels: hostelIds.length, rows: sorted.length, fileName };
}

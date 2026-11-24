// Hostelworld Link Up changes (migration 038): how a change reads, who gets it, and the daily email.
// Shared by the `hostelworld-digest` Edge Function and Approvals > Hostelworld, so both say exactly the same thing.
// Pure TypeScript, no imports.

export interface HwChange {
  id: number;
  product_id: string | null;
  product_title: string | null;
  location_id: string | null;
  category: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

/** Since 24 Nov 2026 (Reden, Katrina; migration 039) only nightly events and Meet-Ups are logged at all: tours have
 *  their own process. The two audiences (Reden / Adel and Katrina) are kept so a wider list stays a one-line change. */
export type HwAudience = "all" | "nightly";

export const isMeetUp = (title: string | null) => /\bmeet[\s-]?ups?\b/i.test(title ?? "");
/** What counts for Hostelworld: the same rule as is_hostelworld_product() in migration 039. */
export const isHostelworldProduct = (category: string, title: string | null) => category === "nightly_event" || isMeetUp(title);
export const inAudience = (c: Pick<HwChange, "category" | "product_title">, a: HwAudience) =>
  a === "all" || c.category === "nightly_event" || isMeetUp(c.product_title);

export const HW_CATEGORY: Record<string, string> = {
  nightly_event: "nightly event", mm_tour: "Mad Monkey tour", one_time_event: "one-off event", third_party_tour: "third-party tour",
  transport: "transport",
};
export const HW_FIELD: Record<string, string> = {
  title: "Name", category: "Category", status: "Status", active_on_ground: "Running", days_of_week: "Days",
  starts_at: "Start", ends_at: "Finish", duration_minutes: "Duration", rate_usd: "Price (USD)",
  brief_description: "Brief description", long_description: "Long description", meeting_point: "Meeting point",
  expires_on: "Last date", hostelworld_photo_url: "Photo for Hostelworld", dates: "Date",
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A stored value as people read it: "Mon, Wed, Fri", "18:30", "1h 30m", "$12", "Free", "yes". */
export function hwValue(field: string, v: string | null): string {
  if (v == null || v === "") return "(blank)";
  switch (field) {
    case "days_of_week": {
      try {
        const d = (JSON.parse(v) as number[]).filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
        return d.length === 7 ? "every day" : d.length ? d.map((n) => DAYS[n - 1]).join(", ") : "no days";
      } catch { return v; }
    }
    case "starts_at": case "ends_at": return v.slice(0, 5);
    case "duration_minutes": {
      const m = Number(v); if (!Number.isFinite(m)) return v;
      return m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    }
    case "rate_usd": { const n = Number(v); return n === 0 ? "Free" : Number.isFinite(n) ? `$${n % 1 ? n.toFixed(2) : n}` : v; }
    case "active_on_ground": return v === "true" ? "yes" : v === "false" ? "no (paused)" : v;
    case "category": return HW_CATEGORY[v] ?? v;
    case "expires_on": return new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    default: return v;
  }
}

/** One line: "Start: 18:30 -> 18:00". Long text is cut for email (the dashboard shows it in full). */
export function hwLine(c: HwChange, maxLen = 0): string {
  const cut = (s: string) => (maxLen && s.length > maxLen ? `${s.slice(0, maxLen).trimEnd()}…` : s);
  if (c.field === "product_added") return "New: add it to Hostelworld";
  if (c.field === "product_removed") return "Deleted: take the Link Up down";
  if (c.field === "hostelworld_photo_url") return c.new_value ? `New photo for Hostelworld: ${c.new_value}` : "Photo for Hostelworld removed";
  if (c.field === "status" && c.new_value === "paused") return "Paused: take the Link Up down until it is back";
  if (c.field === "active_on_ground" && c.new_value === "false") return "Stopped running: take the Link Up down until it is back";
  const label = HW_FIELD[c.field] ?? c.field.replace(/_/g, " ");
  return `${label}: ${cut(hwValue(c.field, c.old_value))} -> ${cut(hwValue(c.field, c.new_value))}`;
}

export interface DigestCtx {
  locName: (id: string | null) => string;
  who: (id: string | null) => string;
  when: (iso: string) => string;
  appUrl: string;          // https://madmonkeyhostels.com/experiencedashboard
  dateLabel: string;       // "23 Nov 2026"
}

/** The daily email for one audience, or null when nothing in it is for them. Grouped by hostel, then event. */
export function buildDigest(changes: HwChange[], audience: HwAudience, ctx: DigestCtx): { subject: string; text: string; count: number } | null {
  const mine = changes.filter((c) => inAudience(c, audience));
  if (!mine.length) return null;
  const byLoc = new Map<string, Map<string, HwChange[]>>();
  for (const c of [...mine].sort((a, b) => a.changed_at.localeCompare(b.changed_at))) {
    const loc = ctx.locName(c.location_id);
    if (!byLoc.has(loc)) byLoc.set(loc, new Map());
    const key = c.product_id ?? `t:${c.product_title}`;
    const m = byLoc.get(loc)!;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(c);
  }
  const hostels = [...byLoc.keys()].sort();
  const out: string[] = [
    `Hostelworld Link Up changes, ${ctx.dateLabel}`, "",
    `${mine.length} change${mine.length === 1 ? "" : "s"} at ${hostels.length} hostel${hostels.length === 1 ? "" : "s"} since the last email.`,
    audience === "all"
      ? "Update the Link Ups in the Hostelworld Inbox, then tick them off under Approvals > Hostelworld:"
      : "Nightly events and Meet-Ups only. Reden updates the Link Ups and ticks them off under Approvals > Hostelworld:",
    `${ctx.appUrl}/approvals?tab=hostelworld`,
  ];
  for (const loc of hostels) {
    out.push("", loc.toUpperCase());
    for (const evts of byLoc.get(loc)!.values()) {
      const last = evts[evts.length - 1];
      const removed = evts.some((e) => e.field === "product_removed");
      out.push(`  ${last.product_title ?? "(no name)"} (${HW_CATEGORY[last.category] ?? last.category})${!removed && last.product_id ? `  ${ctx.appUrl}/experiences/${last.product_id}` : ""}`);
      for (const e of evts) out.push(`    - ${hwLine(e, 240)}  (${ctx.who(e.changed_by)}, ${ctx.when(e.changed_at)})`);
    }
  }
  out.push("", "Mad Monkey Experience Dashboard");
  const subject = `[Mad Monkey] Hostelworld: ${mine.length} change${mine.length === 1 ? "" : "s"} at ${hostels.length} hostel${hostels.length === 1 ? "" : "s"} (${ctx.dateLabel})`;
  return { subject, text: out.join("\n"), count: mine.length };
}

/** "reden@x.com, adel@y.com" -> ["reden@x.com", "adel@y.com"] */
export const parseEmails = (s: string | null | undefined) =>
  (s ?? "").split(/[,;\s]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

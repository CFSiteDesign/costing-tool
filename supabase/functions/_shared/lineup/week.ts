// @deno-types="./engine.d.ts"
import type { LineupWeek, ColourwayKey } from "./engine.js";

// What lineup_week() (migration 035) returns, shared by the /lineup page and the `lineup` Edge Function.

export const COLOURWAY_KEYS: ColourwayKey[] = ["orange-yellow", "blue-lime", "pink-cyan", "purple-yellow", "retro"];

export interface LineupFiles { post: string; post_print: string; story: string; colourway: string; rendered_at: string }
export interface LineupRow {
  id: string; week_start: string; status: "draft" | "approved"; colourway: ColourwayKey;
  key_picks: Record<string, string>; approved_at: string | null; approved_by: string | null; auto_approved: boolean;
  files: LineupFiles | null; flags: { fit: number; tier: number; overfull: boolean } | null; notified_at: string | null;
}
export interface LineupBundle {
  week: LineupWeek & { days: (LineupWeek["days"][number] & { iso: string })[] };
  hostel: { id: string; name: string; timezone: string; colourway: ColourwayKey };
  row: LineupRow;
  can_edit: boolean;
}

/** Mark each day's KEY pick (the GM's star). The engine puts it first in its row and makes it the biggest item. */
export function applyKeys(week: LineupBundle["week"], picks: Record<string, string>): LineupWeek {
  return {
    ...week,
    days: week.days.map((d) => ({ ...d, items: d.items.map((it) => ({ ...it, key: !!it.id && picks[d.iso ?? ""] === it.id })) })),
  };
}

/** The week exactly as the poster prints it: the GM's KEY picks, plus Kyle's poster rules (19 Nov 2026):
 *  no EVERY DAY band, no dates beside the day labels, no prices. The header keeps the week's date range.
 *  The page preview and the Edge Function both go through this, so the approved PNGs match the preview. */
export function posterWeek(week: LineupBundle["week"], picks: Record<string, string>): LineupWeek {
  const w = applyKeys(week, picks);
  return {
    ...w,
    everyDay: [],
    days: w.days.map((d) => ({ ...d, date: "", items: d.items.map((it) => ({ ...it, price: null })) })),
  };
}

/** mm-lineup-{hostel}-{yyyy-mm-dd}-{post|post-print|story}.png */
export const lineupFileName = (hostel: string, weekStart: string, kind: "post" | "post-print" | "story") =>
  `mm-lineup-${hostel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${weekStart}-${kind}.png`;

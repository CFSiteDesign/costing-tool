/** Phase 2: two activities "run at the same time" when their time windows overlap. */
export interface Timed { starts_at: string | null; ends_at?: string | null; duration_minutes?: number | null; title?: string }

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** [start, end) in minutes from midnight; null when there's no start time. Unknown end = a point. */
export function timeWindow(p: Timed): [number, number] | null {
  if (!p.starts_at) return null;
  const s = toMin(p.starts_at);
  let e = p.ends_at ? toMin(p.ends_at) : p.duration_minutes ? s + p.duration_minutes : s + 1;
  if (e <= s) e += 24 * 60;   // finishes after midnight
  return [s, e];
}

export function clashes(a: Timed, b: Timed): boolean {
  const wa = timeWindow(a), wb = timeWindow(b);
  if (!wa || !wb) return false;
  return wa[0] < wb[1] && wb[0] < wa[1];
}

/** Finish time: the stored one, or worked out from start + duration. */
export function endTime(p: Timed): string | null {
  if (p.ends_at) return p.ends_at.slice(0, 5);
  if (p.starts_at && p.duration_minutes) return fromMin(timeWindow(p)![1]);
  return null;
}

/** "09:00–12:30", "09:00", or "" */
export const timeSpan = (p: Timed) => {
  if (!p.starts_at) return "";
  const e = endTime(p);
  return `${p.starts_at.slice(0, 5)}${e ? `–${e}` : ""}`;
};

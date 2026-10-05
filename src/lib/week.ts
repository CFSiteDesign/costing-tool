import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/types";

/** Shared by My week and the weekly story, so both read exactly the same schedule and key events. */
const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const parseIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const weekdayOf = (d: Date) => ((d.getDay() + 6) % 7) + 1;   // Mon = 1
export const MAX_KEY_PER_DAY = 3;

export interface KeyDay { product_id: string; weekday: number }

export function useWeek(locId: string | undefined, weekStart: Date) {
  const days = Array.from({ length: 7 }, (_, i) => plus(weekStart, i));
  const today = iso(new Date());
  const q = useQuery({
    queryKey: ["my-week", locId, iso(weekStart)],
    enabled: !!locId,
    queryFn: async () => {
      const from = iso(days[0]), to = iso(days[6]);
      const [{ data: products }, { data: rules }, { data: keys }] = await Promise.all([
        supabase.from("products").select("*").eq("location_id", locId!).eq("active_on_ground", true)
          .neq("status", "paused").neq("category", "transport")   // transport has its own tab
          .or(`expires_on.is.null,expires_on.gte.${today}`),
        supabase.from("product_date_rules").select("product_id, starts_on, ends_on").gte("starts_on", from).lte("starts_on", to),
        supabase.from("product_key_days").select("product_id, weekday").eq("location_id", locId!),
      ]);
      return { products: (products ?? []) as Product[], rules: rules ?? [], keys: (keys ?? []) as KeyDay[] };
    },
  });
  const keySet = new Set((q.data?.keys ?? []).map((k) => `${k.product_id}:${k.weekday}`));
  const isKey = (p: Product, d: Date) => keySet.has(`${p.id}:${weekdayOf(d)}`);
  const rowsFor = (d: Date) => {
    const weekday = weekdayOf(d);
    const dateStr = iso(d);
    const dated = new Set((q.data?.rules ?? []).filter((r) => r.starts_on === dateStr).map((r) => r.product_id));
    return (q.data?.products ?? [])
      .filter((p) => (p.category !== "one_time_event" && p.days_of_week.includes(weekday)) || dated.has(p.id))
      .sort((a, b) => (a.starts_at ?? "99").localeCompare(b.starts_at ?? "99") || a.title.localeCompare(b.title));
  };
  const keysFor = (d: Date) => rowsFor(d).filter((p) => isKey(p, d));
  return { ...q, days, today, rowsFor, keysFor, isKey };
}

/** "20:00" -> "8PM", "20:30" -> "8:30PM" */
export const storyTime = (t: string | null) => {
  if (!t) return "";
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM"; const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
};

export interface StoryItem { time: string; title: string }
export interface StoryDay { day: string; date: string; items: StoryItem[] }
export interface StoryDoc { eyebrow: string; headline: string; sticker: string; days: StoryDay[] }

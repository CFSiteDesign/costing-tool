import type { Product } from "@/lib/types";
import { daysLabel, shortTime } from "@/lib/format";
import { money } from "@/lib/fx";

export const STUDIO_URL = "https://mad-monkey-studio.vercel.app/";

/**
 * Deep link into STUDIO with exactly the five fields the client asked for —
 * tour name, day, key time, price, short description — plus the product id so
 * the finished file can come back to the right row. Nothing else leaves.
 */
export function studioLink(p: Product, currency: string, locationName?: string) {
  const q = new URLSearchParams({ source: "costing", product: p.id, tour: p.title });
  // STUDIO's event form needs a location to enable Generate; the hostel name is
  // the only addition to the client's five fields.
  if (locationName) q.set("location", `Mad Monkey ${locationName}`);
  const day = daysLabel(p.days_of_week);
  if (day && day !== "—") q.set("day", day);
  if (p.starts_at) q.set("time", shortTime(p.starts_at));
  if (p.rate_usd != null) {
    q.set("price", p.rate_usd === 0 ? "Free" : currency !== "USD" && p.local_amount != null
      ? `${money(p.local_amount, currency)} (${money(p.rate_usd, "USD")})` : money(p.rate_usd, "USD"));
  }
  if (p.brief_description) q.set("desc", p.brief_description);
  return `${STUDIO_URL}?${q.toString()}`;
}

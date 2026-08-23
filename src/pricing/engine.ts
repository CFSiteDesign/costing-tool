/** Pure pricing engine — no I/O. A rounding error here becomes a real invoice. */

export interface PricedLine {
  kind: "accommodation" | "breakfast" | "experience" | "transport" | "custom";
  qty: number;
  unit_price_usd: number;
  per_person: boolean;
  pax: number | null;           // overrides quote pax for this line
  discount_pct: number | null;
  discount_amount_usd: number | null;
  is_comp: boolean;
  room_type_id?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Gross value of a line before any discount. */
export function lineBase(l: PricedLine, quotePax: number): number {
  const people = l.per_person ? (l.pax ?? quotePax) : 1;
  return r2(l.unit_price_usd * l.qty * people);
}

/** Final value after % discount, then absolute discount, floored at 0. Comp = 0. */
export function lineTotal(l: PricedLine, quotePax: number): number {
  if (l.is_comp) return 0;
  const base = lineBase(l, quotePax);
  const afterPct = base * (1 - (l.discount_pct ?? 0) / 100);
  return r2(Math.max(0, afterPct - (l.discount_amount_usd ?? 0)));
}

export interface Totals {
  subtotal: number;
  discountTotal: number;
  total: number;
  perPerson: number;
  byProductLine: Record<"accommodation" | "fnb" | "transport" | "experiences" | "other", number>;
  byRoomType: Record<string, number>;   // room_type_id -> accommodation total
}

const BUCKET: Record<PricedLine["kind"], keyof Totals["byProductLine"]> = {
  accommodation: "accommodation",
  breakfast: "fnb",
  transport: "transport",
  experience: "experiences",
  custom: "other",
};

export function computeTotals(lines: PricedLine[], quotePax: number): Totals {
  const byProductLine = { accommodation: 0, fnb: 0, transport: 0, experiences: 0, other: 0 };
  const byRoomType: Record<string, number> = {};
  let subtotal = 0, total = 0;
  for (const l of lines) {
    const base = lineBase(l, quotePax);
    const final = lineTotal(l, quotePax);
    subtotal = r2(subtotal + base);
    total = r2(total + final);
    byProductLine[BUCKET[l.kind]] = r2(byProductLine[BUCKET[l.kind]] + final);
    if (l.kind === "accommodation" && l.room_type_id)
      byRoomType[l.room_type_id] = r2((byRoomType[l.room_type_id] ?? 0) + final);
  }
  return {
    subtotal,
    discountTotal: r2(subtotal - total),
    total,
    perPerson: r2(total / Math.max(quotePax, 1)),
    byProductLine,
    byRoomType,
  };
}

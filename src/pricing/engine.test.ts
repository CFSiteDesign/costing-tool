import { describe, it, expect } from "vitest";
import { lineBase, lineTotal, computeTotals, type PricedLine } from "./engine";

const L = (o: Partial<PricedLine>): PricedLine => ({
  kind: "experience", qty: 1, unit_price_usd: 10, per_person: true, pax: null,
  discount_pct: null, discount_amount_usd: null, is_comp: false, ...o,
});

describe("lineBase / lineTotal", () => {
  it("multiplies per-person lines by quote pax", () => {
    expect(lineBase(L({ unit_price_usd: 32 }), 4)).toBe(128);
  });
  it("line pax overrides quote pax", () => {
    expect(lineBase(L({ unit_price_usd: 15, pax: 2 }), 10)).toBe(30);
  });
  it("group-priced line ignores pax", () => {
    expect(lineBase(L({ unit_price_usd: 200, per_person: false }), 12)).toBe(200);
  });
  it("accommodation: rate x nights x pax", () => {
    expect(lineBase(L({ kind: "accommodation", unit_price_usd: 15, qty: 3 }), 4)).toBe(180);
  });
  it("% discount applies before absolute discount", () => {
    expect(lineTotal(L({ unit_price_usd: 100, discount_pct: 10, discount_amount_usd: 5 }), 1)).toBe(85);
  });
  it("discount never goes below zero", () => {
    expect(lineTotal(L({ unit_price_usd: 10, discount_amount_usd: 500 }), 1)).toBe(0);
  });
  it("comp is zero regardless of price", () => {
    expect(lineTotal(L({ unit_price_usd: 999, is_comp: true }), 5)).toBe(0);
  });
  it("avoids float drift", () => {
    expect(lineTotal(L({ unit_price_usd: 0.1, qty: 3 }), 1)).toBe(0.3);
  });
});

describe("computeTotals", () => {
  const lines: PricedLine[] = [
    L({ kind: "accommodation", unit_price_usd: 15, qty: 2, room_type_id: "dorm6" }), // 15*2*4 = 120
    L({ kind: "breakfast", unit_price_usd: 5, qty: 2 }),                             // 40
    L({ kind: "experience", unit_price_usd: 32, discount_pct: 50 }),                 // 128 -> 64
    L({ kind: "transport", unit_price_usd: 10 }),                                    // 40
    L({ kind: "custom", unit_price_usd: 100, per_person: false, is_comp: true }),    // 100 -> 0
  ];
  const t = computeTotals(lines, 4);
  it("subtotal is pre-discount", () => expect(t.subtotal).toBe(428));
  it("total applies discounts and comps", () => expect(t.total).toBe(264));
  it("discountTotal is the difference", () => expect(t.discountTotal).toBe(164));
  it("per person divides by pax", () => expect(t.perPerson).toBe(66));
  it("splits by product line", () => {
    expect(t.byProductLine).toEqual({ accommodation: 120, fnb: 40, transport: 40, experiences: 64, other: 0 });
  });
  it("splits accommodation by room type", () => expect(t.byRoomType).toEqual({ dorm6: 120 }));
  it("empty is all zeros", () => {
    const z = computeTotals([], 2);
    expect(z.total).toBe(0); expect(z.perPerson).toBe(0);
  });
});

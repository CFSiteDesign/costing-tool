import { describe, expect, it } from "vitest";
import { buildDigest, hwLine, hwValue, inAudience, isHostelworldProduct, parseEmails, type HwChange } from "../../supabase/functions/_shared/hostelworld";

// Hostelworld Link Up alerts (migration 038): Katrina's rules from 23 Nov 2026. Reden gets every event and tour;
// Adel and Katrina only nightly events and anything called a Meet-Up. One email a day.
let n = 0;
const ch = (o: Partial<HwChange>): HwChange => ({
  id: ++n, product_id: `p${n}`, product_title: "Pub Quiz", location_id: "L1", category: "nightly_event",
  field: "starts_at", old_value: "19:00:00", new_value: "19:30:00", changed_by: "u1", changed_at: `2026-11-23T0${n % 9}:00:00Z`, ...o,
});
const ctx = {
  locName: (id: string | null) => ({ L1: "Siargao", L2: "Koh Rong" } as Record<string, string>)[id ?? ""] ?? "Unknown hostel",
  who: (id: string | null) => (id ? "Sam" : "system"), when: () => "23 Nov, 09:00",
  appUrl: "https://example.test/experiencedashboard", dateLabel: "23 Nov 2026",
};

describe("Hostelworld alerts", () => {
  it("Adel and Katrina get nightly events and Meet-Ups only; Reden gets everything", () => {
    expect(inAudience({ category: "nightly_event", product_title: "Pub Quiz" }, "nightly")).toBe(true);
    expect(inAudience({ category: "mm_tour", product_title: "The Meet-Up" }, "nightly")).toBe(true);
    expect(inAudience({ category: "one_time_event", product_title: "Sunday Meetup" }, "nightly")).toBe(true);
    expect(inAudience({ category: "mm_tour", product_title: "Sunset Boat Tour" }, "nightly")).toBe(false);
    expect(inAudience({ category: "one_time_event", product_title: "Christmas Party" }, "nightly")).toBe(false);
    expect(inAudience({ category: "third_party_tour", product_title: "Kayaking" }, "all")).toBe(true);
  });

  it("24 Nov: only nightly events and Meet-Ups count for Hostelworld (tours have their own process)", () => {
    expect(isHostelworldProduct("nightly_event", "Pub Quiz")).toBe(true);
    expect(isHostelworldProduct("mm_tour", "The Meet-Up")).toBe(true);
    expect(isHostelworldProduct("mm_tour", "Sunset Boat Tour")).toBe(false);
    expect(isHostelworldProduct("third_party_tour", "Kayaking")).toBe(false);
    expect(isHostelworldProduct("one_time_event", "Christmas Party")).toBe(false);
    expect(isHostelworldProduct("transport", "Airport Transfer")).toBe(false);
  });

  it("values read the way people say them", () => {
    expect(hwValue("days_of_week", "[1, 3, 5]")).toBe("Mon, Wed, Fri");
    expect(hwValue("days_of_week", "[7, 1, 2, 3, 4, 5, 6]")).toBe("every day");
    expect(hwValue("starts_at", "18:30:00")).toBe("18:30");
    expect(hwValue("duration_minutes", "90")).toBe("1h 30m");
    expect(hwValue("duration_minutes", "120")).toBe("2h");
    expect(hwValue("rate_usd", "0")).toBe("Free");
    expect(hwValue("rate_usd", "12.5")).toBe("$12.50");
    expect(hwValue("expires_on", "2026-12-25")).toBe("25 Dec 2026");
    expect(hwValue("title", null)).toBe("(blank)");
  });

  it("lines say what to do on Hostelworld", () => {
    expect(hwLine(ch({ field: "product_added", old_value: null, new_value: "Pub Quiz" }))).toMatch(/^New: add it to Hostelworld/);
    expect(hwLine(ch({ field: "product_removed", new_value: null }))).toMatch(/take the Link Up down/);
    expect(hwLine(ch({ field: "status", old_value: "active", new_value: "paused" }))).toMatch(/^Paused/);
    expect(hwLine(ch({ field: "starts_at" }))).toBe("Start: 19:00 -> 19:30");
    expect(hwLine(ch({ field: "long_description", old_value: "a".repeat(400), new_value: "b" }), 50)).toMatch(/^Long description: a{50}… -> b$/);
  });

  it("the daily email is grouped by hostel, and each audience only sees its share", () => {
    const changes = [
      ch({ location_id: "L2", product_title: "Beach Olympics" }),
      ch({ location_id: "L1", product_title: "Pub Quiz" }),
      ch({ location_id: "L1", category: "mm_tour", product_title: "Land Tour", field: "rate_usd", old_value: "20", new_value: "25" }),
      ch({ location_id: "L1", category: "mm_tour", product_title: "The Meet-Up", field: "days_of_week", old_value: "[1,2]", new_value: "[1,2,3]" }),
    ];
    const all = buildDigest(changes, "all", ctx)!;
    const team = buildDigest(changes, "nightly", ctx)!;
    expect(all.count).toBe(4);
    expect(team.count).toBe(3);
    expect(all.subject).toBe("[Mad Monkey] Hostelworld: 4 changes at 2 hostels (23 Nov 2026)");
    expect(all.text.indexOf("KOH RONG")).toBeLessThan(all.text.indexOf("SIARGAO"));
    expect(all.text).toContain("Price (USD): $20 -> $25");
    expect(team.text).not.toContain("Land Tour");
    expect(team.text).toContain("Days: Mon, Tue -> Mon, Tue, Wed");
    expect(all.text).toContain("https://example.test/experiencedashboard/approvals?tab=hostelworld");
    for (const t of [all.text, all.subject, team.text]) expect(t, "no em dashes in anything Charlie ships").not.toMatch(/—/);
  });

  it("no email when nothing is for that audience", () => {
    expect(buildDigest([ch({ category: "mm_tour", product_title: "Land Tour" })], "nightly", ctx)).toBeNull();
    expect(buildDigest([], "all", ctx)).toBeNull();
  });

  it("recipient lists accept commas, spaces or semicolons and drop junk", () => {
    expect(parseEmails("a@x.com, b@y.co;c@z.org  nope")).toEqual(["a@x.com", "b@y.co", "c@z.org"]);
    expect(parseEmails("")).toEqual([]);
  });
});

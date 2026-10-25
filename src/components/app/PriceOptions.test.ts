import { describe, expect, it } from "vitest";
import { formatOptions, optionsFrom, rowsFrom } from "./PriceOptions";

describe("price options", () => {
  it("round-trips stored options through the edit rows", () => {
    const stored = [{ label: "Without bus tickets", local_amount: 4280000, rate_usd: 165.78 }, { label: "With bus tickets", local_amount: 5030000, rate_usd: 194.83 }];
    expect(optionsFrom(rowsFrom(stored), "VND")).toEqual({ options: stored });
  });
  it("drops empty rows and trims names", () => {
    expect(optionsFrom([{ label: "  With transfer ", local: "", dollars: "20" }, { label: "", local: "", dollars: "" }], "USD"))
      .toEqual({ options: [{ label: "With transfer", local_amount: 20, rate_usd: 20 }] });
  });
  it("refuses a price with no name, a name with no price, or a non-number", () => {
    expect(optionsFrom([{ label: "", local: "", dollars: "20" }], "USD")).toHaveProperty("error");
    expect(optionsFrom([{ label: "With bus", local: "", dollars: "" }], "VND")).toHaveProperty("error");
    expect(optionsFrom([{ label: "With bus", local: "abc", dollars: "" }], "VND")).toHaveProperty("error");
  });
  it("formats local price with USD in brackets, or USD alone for USD hostels", () => {
    expect(formatOptions([{ label: "With bus tickets", local_amount: 5030000, rate_usd: 194.83 }], "VND")).toBe("With bus tickets ₫5,030,000 ($194.83)");
    expect(formatOptions([{ label: "A", local_amount: 10, rate_usd: 10 }, { label: "B", local_amount: 12, rate_usd: 12 }], "USD")).toBe("A $10.00 · B $12.00");
    expect(formatOptions([], "VND")).toBe("");
  });
});

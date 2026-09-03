import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", THB: "฿", PHP: "₱", IDR: "Rp", VND: "₫", KHR: "៛", LAK: "₭", AUD: "A$", GBP: "£", EUR: "€",
};
/** Currencies with no useful minor unit. */
const ZERO_DECIMALS = new Set(["IDR", "VND", "KHR", "LAK"]);

export const money = (amount: number | null | undefined, code: string) => {
  if (amount == null) return "—";
  const dp = ZERO_DECIMALS.has(code) ? 0 : 2;
  return `${CURRENCY_SYMBOL[code] ?? code + " "}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};

export interface FxRow { code: string; units_per_usd: number; manual_override: number | null; as_of: string; source: string; }

/** Effective FX map (manual override wins), plus the freshest as_of. */
export function useFx() {
  const q = useQuery({
    queryKey: ["fx"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("fx_rates").select("*").order("code");
      const rows = (data ?? []) as FxRow[];
      const map: Record<string, number> = {};
      for (const r of rows) map[r.code] = Number(r.manual_override ?? r.units_per_usd);
      const asOf = rows.filter((r) => r.source === "api").map((r) => r.as_of).sort().at(-1) ?? null;
      return { rows, map, asOf };
    },
  });
  const rate = (code: string) => q.data?.map[code] ?? (code === "USD" ? 1 : null);
  return { ...q, rate, toUsd: (local: number, code: string) => { const r = rate(code); return r ? Math.round((local / r) * 100) / 100 : null; },
    fromUsd: (usd: number, code: string) => { const r = rate(code); return r ? Math.round(usd * r * 100) / 100 : null; } };
}

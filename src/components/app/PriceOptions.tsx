import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { money } from "@/lib/fx";
import type { PriceOption } from "@/lib/types";

/** Price options (Oct 2026): extra named prices on a product, for things guests buy at more than one price.
 *  The main rate stays the headline price that quotes and the list use. Rows are strings while editing. */
export interface PriceRow { label: string; local: string; dollars: string; }
const EMPTY: PriceRow = { label: "", local: "", dollars: "" };

export const rowsFrom = (opts: PriceOption[] | null | undefined): PriceRow[] =>
  (opts ?? []).map((o) => ({ label: o.label ?? "", local: o.local_amount != null ? String(o.local_amount) : "", dollars: o.rate_usd != null ? String(o.rate_usd) : "" }));

/** Rows back to stored options, or a message saying what's wrong. Empty rows are dropped. */
export function optionsFrom(rows: PriceRow[], ccy: string): { options: PriceOption[] } | { error: string } {
  const options: PriceOption[] = [];
  for (const r of rows) {
    const label = r.label.trim();
    const d = r.dollars.trim() === "" ? null : Number(r.dollars);
    const l = r.local.trim() === "" ? null : Number(r.local);
    if (!label && d == null && l == null) continue;
    if (!label) return { error: "Each price option needs a name, e.g. With bus tickets" };
    if ((d != null && !isFinite(d)) || (l != null && !isFinite(l))) return { error: `The price for "${label}" must be a number` };
    if (d == null && l == null) return { error: `"${label}" needs a price` };
    options.push({ label, local_amount: ccy === "USD" ? d : l, rate_usd: d });
  }
  return { options };
}

/** "Without bus tickets ₫4,280,000 ($165.78) · With bus tickets ₫5,030,000 ($194.83)" */
export function formatOptions(opts: PriceOption[] | null | undefined, ccy: string | null | undefined): string {
  return (opts ?? []).map((o) => {
    const usd = o.rate_usd != null ? `$${Number(o.rate_usd).toFixed(2)}` : "";
    const local = ccy && ccy !== "USD" && o.local_amount != null ? money(Number(o.local_amount), ccy) : "";
    return `${o.label} ${local ? `${local}${usd ? ` (${usd})` : ""}` : usd}`.trim();
  }).join(" · ");
}

export function PriceOptionsEditor({ rows, onChange, ccy, fxRate, readOnly }: {
  rows: PriceRow[]; onChange: (rows: PriceRow[]) => void; ccy: string; fxRate: number | null | undefined; readOnly?: boolean;
}) {
  const setRow = (i: number, patch: Partial<PriceRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const round = (n: number) => String(Math.round(n * 100) / 100);
  if (rows.length === 0) {
    if (readOnly) return null;
    return (
      <button type="button" className="text-xs text-primary hover:underline underline-offset-2" onClick={() => onChange([{ ...EMPTY }, { ...EMPTY }])}>
        + More than one price? Add price options
      </button>
    );
  }
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">Prices guests choose from, e.g. With bus tickets and Without bus tickets. The main rate above is still what quotes use.</div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <Input placeholder="e.g. With bus tickets" className="h-8 text-sm flex-1 min-w-0" readOnly={readOnly} value={r.label}
            onChange={(e) => setRow(i, { label: e.target.value })} />
          {ccy !== "USD" && (
            <Input inputMode="decimal" placeholder={ccy} className="h-8 w-28 tabular-nums" readOnly={readOnly} value={r.local}
              onChange={(e) => { const n = Number(e.target.value); setRow(i, { local: e.target.value, ...(fxRate && e.target.value !== "" && isFinite(n) ? { dollars: round(n / fxRate) } : {}) }); }} />
          )}
          <Input inputMode="decimal" placeholder="USD" className="h-8 w-24 tabular-nums" readOnly={readOnly} value={r.dollars}
            onChange={(e) => { const n = Number(e.target.value); setRow(i, { dollars: e.target.value, ...(ccy !== "USD" && fxRate && e.target.value !== "" && isFinite(n) ? { local: round(n * fxRate) } : {}) }); }} />
          {!readOnly && (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Remove this price option" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="text-xs text-primary hover:underline underline-offset-2" onClick={() => onChange([...rows, { ...EMPTY }])}>+ Add another option</button>
      )}
    </div>
  );
}

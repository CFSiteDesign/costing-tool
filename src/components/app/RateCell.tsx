import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useFx, money, CURRENCY_SYMBOL } from "@/lib/fx";
import { usd } from "@/lib/format";
import type { Product } from "@/lib/types";
import { toast } from "sonner";

/**
 * A GM enters baht OR dollars; the other is derived from today's FX and both are
 * stored with the rate used, so a price is always traceable back to what was typed.
 */
export function RateCell({
  product, currency, canEdit, onCommit,
}: {
  product: Product;
  currency: string;             // the hostel's local currency
  canEdit: boolean;
  onCommit: (patch: Partial<Product>) => void;
}) {
  const fx = useFx();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(product.local_amount != null ? String(product.local_amount) : "");
  const [dollars, setDollars] = useState(product.rate_usd != null ? String(product.rate_usd) : "");
  const isUsdHostel = currency === "USD";
  const rate = fx.rate(currency);

  const display = () => {
    if (product.rate_usd == null) {
      return <span className="italic text-muted-foreground">{product.rate_raw ? `“${product.rate_raw.slice(0, 14)}…”` : "—"}</span>;
    }
    if (!isUsdHostel && product.local_amount != null) {
      return <><span>{money(product.local_amount, currency)}</span><span className="text-muted-foreground"> · {usd(product.rate_usd)}</span></>;
    }
    return <span>{usd(product.rate_usd)}</span>;
  };

  const save = () => {
    const l = local.trim() === "" ? null : Number(local);
    const d = dollars.trim() === "" ? null : Number(dollars);
    if ((l != null && !isFinite(l)) || (d != null && !isFinite(d))) { toast.error("Enter numbers only"); return; }
    if (d != null && product.rate_usd && product.rate_usd > 0) {
      const pct = Math.abs(d - product.rate_usd) / product.rate_usd;
      if (pct > 0.4 && !window.confirm(`$${product.rate_usd} → $${d} is a ${Math.round(pct * 100)}% change. Save?`)) return;
    }
    onCommit({
      rate_usd: d, local_amount: l, local_currency: currency,
      fx_rate_used: rate ?? null, fx_as_of: rate ? new Date().toISOString() : null,
    });
    setOpen(false);
  };

  if (!canEdit) return <span className="tabular-nums block text-right text-sm">{display()}</span>;

  return (
    <Popover open={open} onOpenChange={(o) => {
      setOpen(o);
      if (o) { setLocal(product.local_amount != null ? String(product.local_amount) : ""); setDollars(product.rate_usd != null ? String(product.rate_usd) : ""); }
    }}>
      <PopoverTrigger asChild>
        <button title={isUsdHostel ? "Click to change the USD price" : `Click to change. Type the ${currency} price or the USD price — the other is worked out from today's rate.`} className="w-full text-right px-1.5 py-0.5 rounded text-sm tabular-nums hover:bg-secondary cursor-text min-h-[26px]">
          {display()}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="end">
        {!isUsdHostel && (
          <div className="space-y-1">
            <Label className="text-xs">Local price ({currency})</Label>
            <Input className="h-8 tabular-nums" inputMode="decimal" autoFocus value={local}
              placeholder={CURRENCY_SYMBOL[currency]}
              onChange={(e) => { setLocal(e.target.value); const n = Number(e.target.value); if (isFinite(n) && rate && e.target.value !== "") setDollars(String(Math.round((n / rate) * 100) / 100)); }} />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">USD price</Label>
          <Input className="h-8 tabular-nums" inputMode="decimal" autoFocus={isUsdHostel} value={dollars} placeholder="$"
            onChange={(e) => { setDollars(e.target.value); const n = Number(e.target.value); if (!isUsdHostel && isFinite(n) && rate && e.target.value !== "") setLocal(String(Math.round(n * rate * 100) / 100)); }}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {isUsdHostel ? "This hostel prices in USD." : rate
            ? `1 USD = ${money(rate, currency)}${fx.data?.asOf ? ` · rates as of ${new Date(fx.data.asOf).toLocaleDateString("en-GB")}` : ""}. Quotes always use the USD figure.`
            : "No FX rate loaded yet — enter USD directly."}
        </p>
        <Button size="sm" className="w-full h-8" onClick={save}>Save</Button>
      </PopoverContent>
    </Popover>
  );
}

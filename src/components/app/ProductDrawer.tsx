import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function LongField({
  label, value, onCommit, canEdit, maxLength, rows = 3,
}: {
  label: string; value: string | null; onCommit: (v: string | null) => void;
  canEdit: boolean; maxLength?: number; rows?: number;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">{label}</Label>
        {maxLength && (
          <span className={`text-[11px] tabular-nums ${draft.length > maxLength ? "text-destructive" : "text-muted-foreground"}`}>
            {draft.length}/{maxLength}
          </span>
        )}
      </div>
      <Textarea
        value={draft}
        rows={rows}
        readOnly={!canEdit}
        maxLength={maxLength}
        className="text-sm"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (value ?? "")) onCommit(draft || null); }}
      />
    </div>
  );
}

export function ProductDrawer({
  product, onClose, onCommit, canEdit,
}: {
  product: Product | null;
  onClose: () => void;
  onCommit: (patch: Partial<Product>) => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data: transport } = useQuery({
    queryKey: ["transport", product?.id],
    enabled: !!product && product.category === "transport",
    queryFn: async () => {
      const { data } = await supabase.from("transport_details").select("*").eq("product_id", product!.id).maybeSingle();
      return data;
    },
  });

  if (!product) return null;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-2">
          <SheetTitle className="pr-6 text-left">{product.title}</SheetTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {CATEGORY_LABELS[product.category]} · <StatusBadge status={product.status} />
          </div>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {product.rate_raw && product.rate_usd == null && (
            <div className="rounded-md border border-[hsl(var(--st-pending))]/40 bg-[hsl(var(--st-pending))]/10 p-2.5 text-sm">
              <span className="font-medium">Rate needs a number.</span> The sheet said:{" "}
              <span className="italic">“{product.rate_raw}”</span> — set a USD rate in the table
              or it can’t be added to a quote.
            </div>
          )}
          {product.category === "transport" && transport && (
            <div className="rounded-md bg-secondary p-3 text-sm space-y-1">
              <div className="font-medium">{transport.route_raw ?? "Route"}</div>
              {transport.pickup_point && <div><span className="text-muted-foreground">Pick-up:</span> {transport.pickup_point}</div>}
              {transport.dropoff_point && <div><span className="text-muted-foreground">Drop-off:</span> {transport.dropoff_point}</div>}
              <div className="pt-1.5 space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Departure times (quotes pick from these)</Label>
                <Input
                  className="h-8 text-sm tabular-nums"
                  readOnly={!canEdit}
                  placeholder="e.g. 08:30, 11:30, 17:00"
                  defaultValue={(transport.departure_times ?? []).map((t: string) => t.slice(0, 5)).join(", ")}
                  onBlur={async (e) => {
                    const slots = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
                    const bad = slots.find((x) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x));
                    if (bad) { toast.error(`"${bad}" isn't a time — use HH:MM`); return; }
                    const { error } = await supabase.from("transport_details")
                      .update({ departure_times: slots.map((x) => x.padStart(5, "0")) }).eq("product_id", product.id);
                    if (error) toast.error(error.message);
                    else { toast.success("Departure times saved"); qc.invalidateQueries({ queryKey: ["transport", product.id] }); }
                  }}
                />
              </div>
            </div>
          )}
          <LongField label="Brief description" maxLength={95} rows={2}
            value={product.brief_description} canEdit={canEdit}
            onCommit={(v) => onCommit({ brief_description: v })} />
          <LongField label="Long description" rows={5}
            value={product.long_description} canEdit={canEdit}
            onCommit={(v) => onCommit({ long_description: v })} />
          <LongField label="Meeting point & time" rows={2}
            value={product.meeting_point} canEdit={canEdit}
            onCommit={(v) => onCommit({ meeting_point: v })} />
          <LongField label="Inclusions" rows={3}
            value={product.inclusions} canEdit={canEdit}
            onCommit={(v) => onCommit({ inclusions: v })} />
          <LongField label="Exclusions" rows={2}
            value={product.exclusions} canEdit={canEdit}
            onCommit={(v) => onCommit({ exclusions: v })} />
          <LongField label="Things to bring" rows={2}
            value={product.things_to_bring} canEdit={canEdit}
            onCommit={(v) => onCommit({ things_to_bring: v })} />
          <LongField label="Cancellation policy" rows={2}
            value={product.cancellation_policy} canEdit={canEdit}
            onCommit={(v) => onCommit({ cancellation_policy: v })} />
          <LongField label="Itinerary" rows={6}
            value={product.itinerary} canEdit={canEdit}
            onCommit={(v) => onCommit({ itinerary: v })} />
          <LongField label="Photo album URL (min 6 images)" rows={1}
            value={product.photo_album_url} canEdit={canEdit}
            onCommit={(v) => onCommit({ photo_album_url: v })} />
          <LongField label="Remarks / update notes" rows={2}
            value={product.remarks} canEdit={canEdit}
            onCommit={(v) => onCommit({ remarks: v })} />
          {product.availability_raw && (
            <div className="text-xs text-muted-foreground border-t pt-3">
              <span className="font-medium">From the sheet:</span> {product.availability_raw}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

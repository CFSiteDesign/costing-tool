import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { DaysPicker } from "@/components/app/DaysPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

interface Exc {
  id: number; location_id: string | null; product_id: string | null;
  source_sheet: string | null; source_row: number | null;
  field: string; reason: string; raw_value: string | null; status: string;
  products: { title: string } | null;
}

const FIELD_LABELS: Record<string, string> = {
  rate: "Rate", days_of_week: "Days", brief_description: "Brief description",
  active_on_ground: "Active flag", status: "Status", category: "Unknown section", event_date: "Event date",
};

export default function ImportsPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [field, setField] = useState("all");
  const [locFilter, setLocFilter] = useState(auth.seesAllLocations ? "all" : (auth.currentLocation?.id ?? "all"));
  const [days, setDays] = useState<Record<number, number[]>>({});

  const { data: stats } = useQuery({
    queryKey: ["exc-stats", locFilter],
    queryFn: async () => {
      let base = supabase.from("import_exceptions").select("id", { count: "exact", head: true });
      let open = supabase.from("import_exceptions").select("id", { count: "exact", head: true }).eq("status", "open");
      if (locFilter !== "all") { base = base.eq("location_id", locFilter); open = open.eq("location_id", locFilter); }
      const [t, o] = await Promise.all([base, open]);
      return { total: t.count ?? 0, open: o.count ?? 0 };
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["exceptions", field, locFilter],
    queryFn: async () => {
      let q = supabase.from("import_exceptions")
        .select("*, products(title)")
        .eq("status", "open")
        .order("source_sheet").order("source_row")
        .limit(100);
      if (field !== "all") q = q.eq("field", field);
      if (locFilter !== "all") q = q.eq("location_id", locFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Exc[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["exceptions"] });
    qc.invalidateQueries({ queryKey: ["exc-stats"] });
    qc.invalidateQueries({ queryKey: ["exception-count"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const resolve = useMutation({
    mutationFn: async ({ exc, patch, dismiss }: { exc: Exc; patch?: Record<string, unknown>; dismiss?: boolean }) => {
      if (patch && exc.product_id) {
        const { error } = await supabase.from("products").update(patch).eq("id", exc.product_id);
        if (error) throw error;
      }
      const { data: me } = await supabase.auth.getUser();
      const { error } = await supabase.from("import_exceptions").update({
        status: dismiss ? "dismissed" : "resolved",
        resolved_by: me.user?.id,
        resolved_at: new Date().toISOString(),
      }).eq("id", exc.id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const fields = ["all", "rate", "days_of_week", "brief_description", "active_on_ground", "status", "category", "event_date"];
  const done = (stats?.total ?? 0) - (stats?.open ?? 0);
  const pct = stats?.total ? Math.round((done / stats.total) * 100) : 0;

  return (
    <div className="p-4 max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import exceptions</h1>
        <p className="text-sm text-muted-foreground">
          Rows the migration wouldn’t guess at. Fix the value — the product updates and the item closes.
        </p>
      </div>

      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium">{done} of {stats?.total ?? 0} cleared</span>
          <span className="text-muted-foreground tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <Select value={field} onValueChange={setField}>
          <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {fields.map((f) => <SelectItem key={f} value={f}>{f === "all" ? "All fields" : FIELD_LABELS[f] ?? f}</SelectItem>)}
          </SelectContent>
        </Select>
        {auth.seesAllLocations && (
          <Select value={locFilter} onValueChange={setLocFilter}>
            <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {auth.allLocations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="border rounded-lg divide-y">
        {(rows ?? []).length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Queue clear for this filter. 🎉</div>
        )}
        {(rows ?? []).map((e) => (
          <div key={e.id} className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {e.products?.title ?? `${e.source_sheet} row ${e.source_row}`}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {auth.allLocations.find((l) => l.id === e.location_id)?.name}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-[hsl(var(--st-pending))]">{FIELD_LABELS[e.field] ?? e.field}:</span>{" "}
                  {e.reason}
                  {e.raw_value && <> — sheet said <span className="italic">“{e.raw_value.slice(0, 120)}”</span></>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {(e.field === "active_on_ground" || e.field === "status" || e.field === "event_date" || e.field === "category") && (
                  <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => resolve.mutate({ exc: e })}>
                    <Check className="h-3.5 w-3.5" /> Looks right
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => resolve.mutate({ exc: e, dismiss: true })}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {e.field === "rate" && e.product_id && auth.isEditor && (
              <div className="flex gap-2 items-center">
                <Input className="h-8 w-32" inputMode="decimal" placeholder="USD rate"
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter") return;
                    const n = Number((ev.target as HTMLInputElement).value);
                    if (!isFinite(n)) return toast.error("Enter a number");
                    resolve.mutate({ exc: e, patch: { rate_usd: n } });
                  }} />
                <span className="text-xs text-muted-foreground">Enter to save</span>
              </div>
            )}
            {e.field === "days_of_week" && e.product_id && auth.isEditor && (
              <div className="flex gap-2 items-center">
                <DaysPicker size="sm" value={days[e.id] ?? []} onChange={(d) => setDays((s) => ({ ...s, [e.id]: d }))} />
                <Button size="sm" className="h-7" disabled={!days[e.id]?.length}
                  onClick={() => resolve.mutate({ exc: e, patch: { days_of_week: days[e.id] } })}>Save</Button>
              </div>
            )}
            {e.field === "brief_description" && e.product_id && auth.isEditor && (
              <BriefFix onSave={(v) => resolve.mutate({ exc: e, patch: { brief_description: v } })} initial={e.raw_value ?? ""} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefFix({ onSave, initial }: { onSave: (v: string) => void; initial: string }) {
  const [v, setV] = useState(initial.split("\n")[0]?.slice(0, 95) ?? "");
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-xs text-muted-foreground">Rewrite under 95 characters</span>
        <span className={`text-[11px] tabular-nums ${v.length > 95 ? "text-destructive" : "text-muted-foreground"}`}>{v.length}/95</span>
      </div>
      <div className="flex gap-2">
        <Textarea rows={2} maxLength={95} value={v} onChange={(e) => setV(e.target.value)} className="text-sm" />
        <Button size="sm" className="h-8 self-end" disabled={!v.trim()} onClick={() => onSave(v.trim())}>Save</Button>
      </div>
    </div>
  );
}

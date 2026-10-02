import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { CATEGORY_LABELS, type Category } from "@/lib/types";
import { Tip, TipHead } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Check, X, FileText } from "lucide-react";

/** Final flow-chart sync (Oct 2026): every difference between the sheet and the tool, waiting for head office. */
export interface SheetProposal {
  id: number; product_id: string | null; location_id: string; kind: "field" | "new" | "missing"; field: string | null; label: string;
  patch: Record<string, unknown> | null; payload: { product?: { title?: string; category?: Category; rate_usd?: number | null } } | null;
  current_text: string | null; proposed_text: string | null; sheet_text: string | null; previous_sheet_text: string | null;
  basis: "sheet_changed" | "no_baseline" | "import_fix" | "section"; note: string | null; source_sheet: string | null; source_row: number | null;
  status: "pending" | "approved" | "rejected" | "superseded" | "stale"; decided_at: string | null; outcome_note: string | null;
  products: { title: string; category: Category } | null;
}

const BASIS: Record<SheetProposal["basis"], { label: string; tip: string; tone: string }> = {
  sheet_changed: { label: "Changed on the sheet", tip: "The sheet cell is different from the copy the tool was built from, so someone updated it on the sheet.", tone: "hsl(var(--st-signature))" },
  import_fix: { label: "Import fix", tip: "On this tab the first import read these transport fields from the column next door. This puts the sheet's own values in.", tone: "hsl(var(--st-pending))" },
  no_baseline: { label: "Can't tell when", tip: "There is no earlier copy of this row to compare with, so this may be a change on the sheet or a value fixed by hand in the tool.", tone: "hsl(var(--muted-foreground))" },
  section: { label: "Sheet section", tip: "The sheet files this under a different category than the tool does.", tone: "hsl(var(--muted-foreground))" },
};
const VIEWS = [
  { v: "all", label: "Everything" },
  { v: "sheet", label: "Changed on the sheet", test: (p: SheetProposal) => p.kind === "field" && p.basis !== "import_fix" && p.field !== "category" && p.field !== "title" },
  { v: "fix", label: "Transport import fixes", test: (p: SheetProposal) => p.basis === "import_fix" },
  { v: "new", label: "New on the sheet", test: (p: SheetProposal) => p.kind === "new" },
  { v: "missing", label: "Not on the sheet any more", test: (p: SheetProposal) => p.kind === "missing" },
  { v: "rename", label: "Names and categories", test: (p: SheetProposal) => p.field === "title" || p.field === "category" },
] as const;

async function fetchAll(decided: boolean) {
  const out: SheetProposal[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("sheet_sync_proposals").select("*, products(title, category)").order("id").range(from, from + 999);
    q = decided ? q.neq("status", "pending") : q.eq("status", "pending");
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as unknown as SheetProposal[]));
    if (!data || data.length < 1000 || decided) return out;
  }
}

export function SheetQueue() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canApprove = auth.isAdmin || auth.roles.includes("head_office");
  const [locFilter, setLocFilter] = useState("all");
  const [view, setView] = useState<string>("all");
  const [showDecided, setShowDecided] = useState(false);
  const [typed, setTyped] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({ queryKey: ["sheet-proposals", showDecided], queryFn: () => fetchAll(showDecided) });
  const locName = (id: string) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";
  const title = (p: SheetProposal) => p.products?.title ?? p.payload?.product?.title ?? "—";
  const inView = (p: SheetProposal) => { const t = VIEWS.find((x) => x.v === view); return !t || !("test" in t) || t.test(p); };
  const rows = useMemo(() => (data ?? []).filter((p) => (locFilter === "all" || p.location_id === locFilter) && inView(p))
    .sort((a, b) => locName(a.location_id).localeCompare(locName(b.location_id)) || title(a).localeCompare(title(b)) || a.id - b.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, locFilter, view, auth.allLocations]);
  const perLoc = useMemo(() => { const m = new Map<string, number>(); for (const p of data ?? []) if (inView(p)) m.set(p.location_id, (m.get(p.location_id) ?? 0) + 1); return m; },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, view]);
  const perView = (v: string) => { const t = VIEWS.find((x) => x.v === v); return (data ?? []).filter((p) => !t || !("test" in t) || t.test(p)).length; };

  const needsValue = (p: SheetProposal) => (p.kind === "field" && !p.patch) || (p.kind === "new" && p.payload?.product?.rate_usd == null);
  const overrideFor = (p: SheetProposal) => {
    const v = (typed[p.id] ?? "").trim();
    return v && isFinite(Number(v)) ? { [p.id]: { rate_usd: Number(v) } } : {};
  };
  const report = (r: { approved: number; rejected: number; stale: number; errors: { id: number; error: string }[] }) => {
    const bits = [r.approved && `${r.approved} approved`, r.rejected && `${r.rejected} rejected`, r.stale && `${r.stale} skipped because the tool changed since`].filter(Boolean);
    if (bits.length) toast.success(bits.join(" · "));
    if (r.errors?.length) toast.error(`${r.errors.length} could not be applied: ${r.errors[0].error}`);
  };
  const invalidate = () => { ["sheet-proposals", "pending-approvals", "products", "my-week"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };

  const decide = useMutation({
    mutationFn: async ({ ids, decision, overrides }: { ids: number[]; decision: "approved" | "rejected"; overrides?: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc("decide_sheet_proposals", { p_ids: ids, p_decision: decision, p_overrides: overrides ?? {} });
      if (error) throw error;
      return data as { approved: number; rejected: number; stale: number; errors: { id: number; error: string }[] };
    },
    onSuccess: (r) => { invalidate(); report(r); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkIds = rows.filter((p) => !needsValue(p) || overrideFor(p)[p.id]).map((p) => p.id);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-3xl">Everything that differs between the experience flow chart and the tool, from the final read of the sheet. Nothing changes on an experience until it is approved here. Approving checks the experience first, and skips it if someone has changed it in the tool since.</p>
        {canApprove && !showDecided && rows.length > 0 && (
          <div className="flex gap-1.5">
            <Tip label="Approves every item shown with the filters applied. Items that need a price typed in are left until you type one.">
              <Button size="sm" className="gap-1.5" disabled={decide.isPending || bulkIds.length === 0} onClick={() => { if (window.confirm(`Approve all ${bulkIds.length} shown?`)) decide.mutate({ ids: bulkIds, decision: "approved", overrides: Object.assign({}, ...rows.map(overrideFor)) }); }}>
                <Check className="h-4 w-4" /> Approve all shown ({bulkIds.length})
              </Button>
            </Tip>
            <Tip label="Rejects every item shown. Experiences are left exactly as they are.">
              <Button size="sm" variant="outline" className="gap-1.5" disabled={decide.isPending} onClick={() => { if (window.confirm(`Reject all ${rows.length} shown?`)) decide.mutate({ ids: rows.map((r) => r.id), decision: "rejected" }); }}><X className="h-4 w-4" /> Reject all shown</Button>
            </Tip>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={view} onValueChange={setView}>
          <SelectTrigger className="w-60 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{VIEWS.map((v) => <SelectItem key={v.v} value={v.v}>{v.label} ({perView(v.v)})</SelectItem>)}</SelectContent>
        </Select>
        <Select value={locFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hostels</SelectItem>
            {auth.allLocations.filter((l) => perLoc.has(l.id)).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({perLoc.get(l.id)})</SelectItem>)}
          </SelectContent>
        </Select>
        <Tip label="Show what has already been approved, rejected or skipped (latest 1000)."><label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help"><Switch checked={showDecided} onCheckedChange={setShowDecided} /> Show decided</label></Tip>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-muted-foreground text-left">
                <th className="font-medium px-3 py-2.5 min-w-[220px]">Experience</th>
                <th className="font-medium px-3 py-2.5 w-36">What</th>
                <th className="font-medium px-3 py-2.5 min-w-[200px]"><TipHead label="In the tool now" tip="What the experience says in the tool today." /></th>
                <th className="font-medium px-3 py-2.5 min-w-[220px]"><TipHead label="The sheet says" tip="What approving writes to the experience." /></th>
                <th className="font-medium px-3 py-2.5 w-28"><TipHead label="Sheet" tip="The sheet cell now, and what it said when the tool was built." /></th>
                <th className="font-medium px-3 py-2.5 w-36"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">{showDecided ? "Nothing decided yet." : "Nothing waiting for approval."}</td></tr>}
              {rows.map((p) => {
                const pending = p.status === "pending"; const b = BASIS[p.basis]; const cat = p.products?.category ?? p.payload?.product?.category;
                return (
                  <tr key={p.id} className="border-t align-top hover:bg-secondary/30">
                    <td className="px-3 py-2">
                      {p.product_id ? <Link to={`/experiences/${p.product_id}`} className="font-medium hover:underline underline-offset-2">{title(p)}</Link> : <span className="font-medium">{title(p)}</span>}
                      <div className="text-xs text-muted-foreground">{locName(p.location_id)}{cat ? ` · ${CATEGORY_LABELS[cat]}` : ""}</div>
                      <Tip label={b.tip}><span className="inline-block mt-1 text-[11px] font-medium cursor-help" style={{ color: b.tone }}>{b.label}</span></Tip>
                      {p.note && <div className="text-xs text-muted-foreground mt-0.5 max-w-xs">{p.note}</div>}
                      {!pending && <div className="text-xs mt-0.5" style={{ color: p.status === "approved" ? "hsl(var(--st-active))" : p.status === "stale" ? "hsl(var(--st-pending))" : "hsl(var(--st-remove))" }}>{p.status === "stale" ? "skipped" : p.status} {p.decided_at ? new Date(p.decided_at).toLocaleDateString("en-GB") : ""}{p.outcome_note ? `: ${p.outcome_note}` : ""}</div>}
                    </td>
                    <td className="px-3 py-2 text-[13px]">{p.label}</td>
                    <td className="px-3 py-2 text-[13px] whitespace-pre-line text-muted-foreground">{p.current_text || "—"}</td>
                    <td className="px-3 py-2 text-[13px] whitespace-pre-line">
                      {pending && canApprove && needsValue(p) ? (
                        <div className="space-y-1">
                          <div className="text-xs text-[hsl(var(--st-pending))]">{p.kind === "new" ? `${p.proposed_text}. Price not readable, type it:` : "Price not readable, type it:"}</div>
                          <div className="flex items-center gap-1"><span className="text-muted-foreground">$</span><Input inputMode="decimal" className="h-8 w-24 tabular-nums" placeholder="USD" value={typed[p.id] ?? ""} onChange={(e) => setTyped((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.]/g, "") }))} /></div>
                        </div>
                      ) : (p.proposed_text || "—")}
                    </td>
                    <td className="px-3 py-2">
                      {p.sheet_text && (
                        <Popover>
                          <PopoverTrigger className="text-left text-xs inline-flex items-center gap-1 hover:underline underline-offset-2"><FileText className="h-3.5 w-3.5 text-muted-foreground" /> {p.source_sheet ? `Row ${p.source_row ?? "?"}` : "Sheet"}</PopoverTrigger>
                          <PopoverContent className="w-[28rem] text-xs space-y-2" align="end">
                            <div className="text-muted-foreground">{p.source_sheet ? `${p.source_sheet}, row ${p.source_row ?? "?"}` : "From the sheet"}</div>
                            <div><div className="font-medium mb-1">Now</div><pre className="whitespace-pre-wrap font-sans max-h-56 overflow-y-auto border rounded p-2 bg-secondary/50">{p.sheet_text}</pre></div>
                            {p.previous_sheet_text && <div><div className="font-medium mb-1">When the tool was built</div><pre className="whitespace-pre-wrap font-sans max-h-40 overflow-y-auto border rounded p-2">{p.previous_sheet_text}</pre></div>}
                          </PopoverContent>
                        </Popover>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {pending && canApprove && (
                        <div className="flex gap-1 justify-end">
                          <Tip label={p.kind === "new" ? "Adds this experience to the tool" : p.kind === "missing" ? "Pauses it. It stays in the database." : "Writes the sheet's value to the experience"}>
                            <Button size="sm" className="h-8 gap-1" disabled={decide.isPending || (needsValue(p) && !overrideFor(p)[p.id])} onClick={() => decide.mutate({ ids: [p.id], decision: "approved", overrides: overrideFor(p) })}><Check className="h-3.5 w-3.5" /> {p.kind === "new" ? "Add" : p.kind === "missing" ? "Pause" : "Approve"}</Button>
                          </Tip>
                          <Tip label="Leaves the tool as it is"><Button size="sm" variant="outline" className="h-8 gap-1" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [p.id], decision: "rejected" })}><X className="h-3.5 w-3.5" /></Button></Tip>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Where a sheet cell is unchanged since the tool was built, the tool's value stands and nothing is listed here, so values fixed by hand in the tool are safe. Start and finish times are in the Times tab.</p>
    </div>
  );
}

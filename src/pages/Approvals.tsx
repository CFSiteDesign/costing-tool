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
import { Check, X, FileText, ClipboardCheck } from "lucide-react";

interface Proposal {
  id: number; product_id: string; location_id: string;
  current_starts_at: string | null; current_ends_at: string | null; current_duration_minutes: number | null;
  proposed_starts_at: string | null; proposed_ends_at: string | null; proposed_duration_minutes: number | null;
  source: "itinerary" | "day_time_column" | "duration"; source_text: string | null; note: string | null;
  status: "pending" | "approved" | "rejected"; decided_at: string | null; created_at: string;
  products: { title: string; category: Category } | null;
}
const SOURCE_LABEL: Record<Proposal["source"], string> = { itinerary: "Itinerary column", day_time_column: "Day / time column", duration: "Start + duration" };
const SOURCE_TIP: Record<Proposal["source"], string> = {
  itinerary: "First and last times written in the flow chart's ITINERARY column.",
  day_time_column: "The itinerary had no times, so this is the range in the DAY, TIME & DURATION column.",
  duration: "Only a start time and a duration were given, so the finish is start + duration.",
};
const t5 = (t: string | null) => (t ? t.slice(0, 5) : "");
const span = (s: string | null, e: string | null, d: number | null) => {
  if (!s) return <span className="text-muted-foreground">no times</span>;
  return <>{t5(s)}{e ? `–${t5(e)}` : <span className="text-[hsl(var(--st-pending))]"> no finish</span>}{d ? <span className="text-muted-foreground"> · {d % 60 === 0 ? `${d / 60}h` : `${d}m`}</span> : null}</>;
};

/** Times queue (9 Sep 2026): start / finish read from the flow chart, waiting for head office to approve. */
export default function Approvals() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canApprove = auth.isAdmin || auth.roles.includes("head_office");
  const [locFilter, setLocFilter] = useState("all");
  const [showDecided, setShowDecided] = useState(false);
  const [edits, setEdits] = useState<Record<number, { s: string; e: string; d: string }>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["time-proposals", showDecided],
    queryFn: async () => {
      let q = supabase.from("product_time_proposals").select("*, products(title, category)").order("created_at", { ascending: false });
      q = showDecided ? q.neq("status", "pending").limit(200) : q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Proposal[];
    },
  });
  const locName = (id: string) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";
  const rows = useMemo(() => (data ?? []).filter((p) => locFilter === "all" || p.location_id === locFilter)
    .sort((a, b) => locName(a.location_id).localeCompare(locName(b.location_id)) || (a.products?.title ?? "").localeCompare(b.products?.title ?? "")), [data, locFilter, auth.allLocations]);
  const perLoc = useMemo(() => { const m = new Map<string, number>(); for (const p of data ?? []) m.set(p.location_id, (m.get(p.location_id) ?? 0) + 1); return m; }, [data]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["time-proposals"] }); qc.invalidateQueries({ queryKey: ["pending-approvals"] }); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["my-week"] }); };
  const decide = useMutation({
    mutationFn: async ({ p, decision }: { p: Proposal; decision: "approved" | "rejected" }) => {
      const ed = edits[p.id];
      const changed = ed && (ed.s !== t5(p.proposed_starts_at) || ed.e !== t5(p.proposed_ends_at) || ed.d !== String(p.proposed_duration_minutes ?? ""));
      const { error } = await supabase.rpc("decide_time_proposal", {
        p_id: p.id, p_decision: decision,
        p_starts: changed && ed.s ? ed.s : null, p_ends: changed && ed.e ? ed.e : null,
        p_duration: changed && ed.d ? Number(ed.d) : null,
      });
      if (error) throw error;
      return decision;
    },
    onSuccess: (decision) => { invalidate(); toast.success(decision === "approved" ? "Approved — times updated on the product" : "Rejected — product left as it was"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulk = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const { data, error } = await supabase.rpc("decide_time_proposals", { p_ids: rows.map((r) => r.id), p_decision: decision });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n, decision) => { invalidate(); toast.success(`${n} ${decision} `); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ed = (p: Proposal) => edits[p.id] ?? { s: t5(p.proposed_starts_at), e: t5(p.proposed_ends_at), d: String(p.proposed_duration_minutes ?? "") };
  const setEd = (p: Proposal, patch: Partial<{ s: string; e: string; d: string }>) => setEdits((m) => ({ ...m, [p.id]: { ...ed(p), ...patch } }));

  return (
    <div className="p-4 space-y-3 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Time approvals</h1>
          <p className="text-sm text-muted-foreground">Start and finish times read from the experience flow chart. Nothing changes on a product until it is approved here. Adjust the proposed times first if they are wrong.</p>
        </div>
        {canApprove && !showDecided && rows.length > 0 && (
          <div className="flex gap-1.5">
            <Tip label="Approves every proposal shown (with the filter applied) exactly as proposed. Anything you have edited but not approved keeps your edit only if you approve it individually.">
              <Button size="sm" className="gap-1.5" disabled={bulk.isPending} onClick={() => { if (window.confirm(`Approve all ${rows.length} shown?`)) bulk.mutate("approved"); }}><Check className="h-4 w-4" /> Approve all shown ({rows.length})</Button>
            </Tip>
            <Tip label="Rejects every proposal shown. Products are left exactly as they are."><Button size="sm" variant="outline" className="gap-1.5" disabled={bulk.isPending} onClick={() => { if (window.confirm(`Reject all ${rows.length} shown?`)) bulk.mutate("rejected"); }}><X className="h-4 w-4" /> Reject all shown</Button></Tip>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={locFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hostels ({data?.length ?? 0})</SelectItem>
            {auth.allLocations.filter((l) => perLoc.has(l.id)).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({perLoc.get(l.id)})</SelectItem>)}
          </SelectContent>
        </Select>
        <Tip label="Show what has already been approved or rejected (latest 200)."><label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help"><Switch checked={showDecided} onCheckedChange={setShowDecided} /> Show decided</label></Tip>
        {!canApprove && <span className="text-xs text-[hsl(var(--st-pending))]">Only head office can approve. You can see what is proposed for your hostel.</span>}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-muted-foreground text-left">
                <th className="font-medium px-3 py-2.5 min-w-[240px]">Product</th>
                <th className="font-medium px-3 py-2.5 w-40"><TipHead label="Now" tip="What the product currently says." /></th>
                <th className="font-medium px-3 py-2.5 w-64"><TipHead label="Proposed" tip="Start, finish and minutes read from the flow chart. Edit before approving if they are wrong." /></th>
                <th className="font-medium px-3 py-2.5 w-44"><TipHead label="Read from" tip="Which column of the flow chart the times came from. Click to see the text." /></th>
                <th className="font-medium px-3 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">{showDecided ? "Nothing decided yet." : "Nothing waiting for approval."}</td></tr>}
              {rows.map((p) => {
                const e = ed(p); const pending = p.status === "pending";
                return (
                  <tr key={p.id} className="border-t align-top hover:bg-secondary/30">
                    <td className="px-3 py-2">
                      <Link to={`/experiences/${p.product_id}`} className="font-medium hover:underline underline-offset-2">{p.products?.title ?? "—"}</Link>
                      <div className="text-xs text-muted-foreground">{locName(p.location_id)} · {p.products ? CATEGORY_LABELS[p.products.category] : ""}</div>
                      {p.note && <div className="text-xs text-[hsl(var(--st-pending))] mt-0.5">{p.note}</div>}
                      {!pending && <div className="text-xs mt-0.5" style={{ color: p.status === "approved" ? "hsl(var(--st-active))" : "hsl(var(--st-remove))" }}>{p.status} {p.decided_at ? new Date(p.decided_at).toLocaleDateString("en-GB") : ""}</div>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{span(p.current_starts_at, p.current_ends_at, p.current_duration_minutes)}</td>
                    <td className="px-3 py-2">
                      {pending && canApprove ? (
                        <div className="flex items-center gap-1.5">
                          <Input type="time" className="h-8 w-[6.5rem] tabular-nums" value={e.s} onChange={(ev) => setEd(p, { s: ev.target.value })} />
                          <span className="text-muted-foreground">–</span>
                          <Input type="time" className="h-8 w-[6.5rem] tabular-nums" value={e.e} onChange={(ev) => setEd(p, { e: ev.target.value })} />
                          <Tip label="Minutes"><Input inputMode="numeric" className="h-8 w-16 tabular-nums" placeholder="mins" value={e.d} onChange={(ev) => setEd(p, { d: ev.target.value.replace(/[^\d]/g, "") })} /></Tip>
                        </div>
                      ) : <span className="tabular-nums">{span(p.proposed_starts_at, p.proposed_ends_at, p.proposed_duration_minutes)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Popover>
                        <PopoverTrigger className="text-left text-xs inline-flex items-center gap-1 hover:underline underline-offset-2"><FileText className="h-3.5 w-3.5 text-muted-foreground" /> {SOURCE_LABEL[p.source]}</PopoverTrigger>
                        <PopoverContent className="w-96 text-xs space-y-1.5" align="start">
                          <div className="text-muted-foreground">{SOURCE_TIP[p.source]}</div>
                          <pre className="whitespace-pre-wrap font-sans max-h-64 overflow-y-auto border rounded p-2 bg-secondary/50">{p.source_text || "(no text recorded)"}</pre>
                        </PopoverContent>
                      </Popover>
                    </td>
                    <td className="px-3 py-2">
                      {pending && canApprove && (
                        <div className="flex gap-1 justify-end">
                          <Tip label="Writes these times to the product"><Button size="sm" className="h-8 gap-1" disabled={decide.isPending} onClick={() => decide.mutate({ p, decision: "approved" })}><Check className="h-3.5 w-3.5" /> Approve</Button></Tip>
                          <Tip label="Leaves the product as it is"><Button size="sm" variant="outline" className="h-8 gap-1" disabled={decide.isPending} onClick={() => decide.mutate({ p, decision: "rejected" })}><X className="h-3.5 w-3.5" /></Button></Tip>
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
      <p className="text-xs text-muted-foreground">Where the itinerary had no times, the day / time column was used; where only a start and a duration existed, the finish is start + duration. A blank finish on any product is now filled in from start + minutes automatically when it is saved.</p>
    </div>
  );
}

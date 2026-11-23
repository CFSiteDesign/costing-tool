import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Tip } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { HW_CATEGORY, hwLine, inAudience, type HwAudience, type HwChange } from "../../../supabase/functions/_shared/hostelworld";

/** Approvals > Hostelworld (migration 038, 23 Nov 2026): every change to an event or tour, for whoever updates the
 *  Link Ups in the Hostelworld Inbox to copy across and tick off. The same changes go out in a daily email
 *  (hostelworld-digest). The change itself is already live here; ticking only records that Hostelworld now matches. */
interface Row extends HwChange { done_at: string | null; done_by: string | null }

export function HostelworldQueue() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canTick = auth.isAdmin || auth.roles.includes("head_office");
  const [done, setDone] = useState(false);
  const [scope, setScope] = useState<HwAudience>("all");
  const [locFilter, setLocFilter] = useState("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["hostelworld-changes", done],
    queryFn: async () => {
      let q = supabase.from("hostelworld_changes")
        .select("id, product_id, product_title, location_id, category, field, old_value, new_value, changed_by, changed_at, done_at, done_by");
      q = done ? q.not("done_at", "is", null).order("done_at", { ascending: false }).limit(500)
        : q.is("done_at", null).order("changed_at", { ascending: true }).limit(1500);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      const ids = [...new Set(rows.flatMap((r) => [r.changed_by, r.done_by]).filter(Boolean))] as string[];
      const { data: profs } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      return { rows, names: new Map((profs ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "unknown"])) };
    },
  });

  const locName = (id: string | null) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";
  const inScope = useMemo(() => (data?.rows ?? []).filter((r) => inAudience(r, scope)), [data, scope]);
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; product_id: string | null; title: string; category: string; location_id: string | null; done_at: string | null; done_by: string | null; rows: Row[] }>();
    for (const r of inScope) {
      if (locFilter !== "all" && r.location_id !== locFilter) continue;
      const key = (r.product_id ?? `t:${r.product_title}`) + (done ? `@${r.done_at}` : "");
      if (!m.has(key)) m.set(key, { key, product_id: r.product_id, title: r.product_title ?? "—", category: r.category, location_id: r.location_id, done_at: r.done_at, done_by: r.done_by, rows: [] });
      const g = m.get(key)!; g.rows.push(r); g.title = r.product_title ?? g.title;
    }
    const list = [...m.values()];
    for (const g of list) g.rows.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    return done ? list.sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""))
      : list.sort((a, b) => locName(a.location_id).localeCompare(locName(b.location_id)) || a.title.localeCompare(b.title));
  }, [inScope, locFilter, done, auth.allLocations]); // eslint-disable-line react-hooks/exhaustive-deps
  const perLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inScope) if (r.location_id) m.set(r.location_id, (m.get(r.location_id) ?? 0) + 1);
    return m;
  }, [inScope]);

  const tick = useMutation({
    mutationFn: async ({ ids, undo }: { ids: number[]; undo?: boolean }) => {
      const { data, error } = await supabase.rpc(undo ? "unmark_hostelworld_done" : "mark_hostelworld_done", { p_ids: ids });
      if (error) throw error;
      return { n: data as number, undo };
    },
    onSuccess: ({ n, undo }) => {
      qc.invalidateQueries({ queryKey: ["hostelworld-changes"] }); qc.invalidateQueries({ queryKey: ["pending-approvals"] });
      toast.success(undo ? "Moved back to the to-do list" : n === 1 ? "Done, moved to Completed" : `${n} changes moved to Completed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const who = (id: string | null) => (id ? data?.names.get(id) ?? "unknown" : "system");
  const shownIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  const tone = (r: Row) => r.field === "product_removed" || (r.field === "status" && r.new_value === "paused") || (r.field === "active_on_ground" && r.new_value === "false")
    ? "text-destructive font-medium" : r.field === "product_added" ? "text-[hsl(var(--st-active))] font-medium" : "";

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-3xl">
          {done
            ? "Hostelworld changes already ticked off, newest first. Ticked one by mistake? Move it back."
            : "Every change to an event or tour, for the Link Ups in the Hostelworld Inbox. They are already live here and go out in one email a day; once the Link Up matches, press Done."}
        </p>
        {canTick && !done && groups.length > 1 && (
          <Tip label="Ticks off every change shown (with the filters applied).">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={tick.isPending}
              onClick={() => { if (window.confirm(`Tick off all ${shownIds.length} changes shown?`)) tick.mutate({ ids: shownIds }); }}>
              <Check className="h-4 w-4" /> All shown done ({shownIds.length})
            </Button>
          </Tip>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex rounded-md border overflow-hidden text-sm">
          <button type="button" onClick={() => setDone(false)} className={`px-3 py-1.5 ${!done ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-secondary"}`}>To do</button>
          <button type="button" onClick={() => setDone(true)} className={`px-3 py-1.5 ${done ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-secondary"}`}>Completed</button>
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as HwAudience)}>
          <SelectTrigger className="w-64 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events and tours</SelectItem>
            <SelectItem value="nightly">Nightly events and Meet-Ups</SelectItem>
          </SelectContent>
        </Select>
        <Select value={locFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hostels ({inScope.length})</SelectItem>
            {auth.allLocations.filter((l) => perLoc.has(l.id)).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({perLoc.get(l.id)})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg divide-y">
        {isLoading && <div className="px-3 py-10 text-center text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="px-3 py-10 text-center text-sm text-destructive">Couldn't load the Hostelworld changes. Refresh the page.</div>}
        {!isLoading && !error && groups.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">{done ? "Nothing ticked off yet." : "All done. Hostelworld matches every change."}</div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="px-3 py-2.5 flex gap-3 items-start hover:bg-secondary/30">
            <div className="flex-1 min-w-0 space-y-1">
              <div>
                {g.product_id && !g.rows.some((r) => r.field === "product_removed")
                  ? <Link to={`/experiences/${g.product_id}`} className="font-medium hover:underline underline-offset-2">{g.title}</Link>
                  : <span className="font-medium">{g.title}</span>}
                <span className="text-xs text-muted-foreground"> · {HW_CATEGORY[g.category] ?? g.category} · {locName(g.location_id)}</span>
              </div>
              <ul className="text-sm space-y-0.5">
                {g.rows.map((r) => (
                  <li key={r.id} className="break-words">
                    {r.field === "hostelworld_photo_url" && r.new_value
                      ? <span>New photo for Hostelworld: <a href={r.new_value} target="_blank" rel="noreferrer" className="underline underline-offset-2">open it</a></span>
                      : <span className={tone(r)}>{hwLine(r)}</span>}
                    <span className="text-xs text-muted-foreground"> · {who(r.changed_by)}, {when(r.changed_at)}</span>
                  </li>
                ))}
              </ul>
              {done && g.done_at && (
                <div className="text-xs text-[hsl(var(--st-active))] flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Done on Hostelworld by {who(g.done_by)}, {when(g.done_at)}</div>
              )}
            </div>
            {canTick && !done && (
              <Tip label="The Link Up on Hostelworld now matches these changes. Moves them to Completed.">
                <Button size="sm" className="h-8 gap-1 shrink-0" disabled={tick.isPending} onClick={() => tick.mutate({ ids: g.rows.map((r) => r.id) })}>
                  <Check className="h-3.5 w-3.5" /> Done on Hostelworld
                </Button>
              </Tip>
            )}
            {canTick && done && (
              <Tip label="Ticked by mistake? Puts these changes back on the to-do list.">
                <Button size="sm" variant="outline" className="h-8 gap-1 shrink-0" disabled={tick.isPending} onClick={() => tick.mutate({ ids: g.rows.map((r) => r.id), undo: true })}>
                  <Undo2 className="h-3.5 w-3.5" /> Move back
                </Button>
              </Tip>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

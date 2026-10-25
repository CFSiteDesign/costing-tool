import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { money } from "@/lib/fx";
import { Tip } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Check } from "lucide-react";

/** Website updates (Oct 2026): every change to a website-bookable product, for Reden to copy to the website and
 *  Rezdy, then tick off. The same changes are emailed to him (reden-digest). The change itself is already live in
 *  the tool; ticking only records that the website now matches. */
interface WebEvent {
  id: number; product_id: string | null; product_title: string | null; location_id: string | null;
  field: string; old_value: string | null; new_value: string | null; changed_by: string | null; changed_at: string;
}
const FIELD_LABEL: Record<string, string> = {
  title: "Name", rate_usd: "Price", brief_description: "Brief description", long_description: "Long description",
  days_of_week: "Days", starts_at: "Start", ends_at: "Finish", duration_minutes: "Length (mins)", status: "Status",
  active_on_ground: "Active", bookable_on_website: "On the website", meeting_point: "Meeting point",
  inclusions: "Inclusions", things_to_bring: "Things to bring", expires_on: "Expires on",
};
const LONG = 140;

function Val({ v }: { v: string | null }) {
  if (v == null || v === "") return <span className="text-muted-foreground">(blank)</span>;
  if (v.length <= LONG) return <span className="whitespace-pre-wrap">{v}</span>;
  return (
    <Popover>
      <PopoverTrigger className="text-left hover:underline underline-offset-2">{v.slice(0, LONG).trimEnd()}… <span className="text-muted-foreground">(full text)</span></PopoverTrigger>
      <PopoverContent className="w-[28rem] text-xs" align="start"><pre className="whitespace-pre-wrap font-sans max-h-72 overflow-y-auto">{v}</pre></PopoverContent>
    </Popover>
  );
}

export function WebsiteQueue() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canTick = auth.isAdmin || auth.roles.includes("head_office");
  const [locFilter, setLocFilter] = useState("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["website-updates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("notification_events")
        .select("id, product_id, product_title, location_id, field, old_value, new_value, changed_by, changed_at")
        .is("website_done_at", null).order("changed_at", { ascending: true }).limit(1000);
      if (error) throw error;
      const events = (data ?? []) as WebEvent[];
      const userIds = [...new Set(events.map((e) => e.changed_by).filter(Boolean))] as string[];
      const pids = [...new Set(events.filter((e) => e.field === "rate_usd").map((e) => e.product_id).filter(Boolean))] as string[];
      const [{ data: profs }, { data: prods }] = await Promise.all([
        userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
        pids.length ? supabase.from("products").select("id, local_amount, local_currency").in("id", pids) : Promise.resolve({ data: [] }),
      ]);
      const names = new Map((profs ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "unknown"]));
      const local = new Map((prods ?? []).filter((p: { local_amount: number | null; local_currency: string | null }) => p.local_amount != null && p.local_currency && p.local_currency !== "USD")
        .map((p: { id: string; local_amount: number; local_currency: string }) => [p.id, money(p.local_amount, p.local_currency)]));
      return { events, names, local };
    },
  });

  const locName = (id: string | null) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";
  // one row per product: its changes in order, newest product activity first within each hostel
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; product_id: string | null; title: string; location_id: string | null; events: WebEvent[] }>();
    for (const e of data?.events ?? []) {
      if (locFilter !== "all" && e.location_id !== locFilter) continue;
      const key = e.product_id ?? `t:${e.product_title}`;
      if (!m.has(key)) m.set(key, { key, product_id: e.product_id, title: e.product_title ?? "—", location_id: e.location_id, events: [] });
      const g = m.get(key)!; g.events.push(e); g.title = e.product_title ?? g.title;
    }
    return [...m.values()].sort((a, b) => locName(a.location_id).localeCompare(locName(b.location_id))
      || b.events[b.events.length - 1].changed_at.localeCompare(a.events[a.events.length - 1].changed_at));
  }, [data, locFilter, auth.allLocations]);
  const perLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.events ?? []) if (e.location_id) m.set(e.location_id, (m.get(e.location_id) ?? 0) + 1);
    return m;
  }, [data]);

  const done = useMutation({
    mutationFn: async (ids: number[]) => {
      const { data, error } = await supabase.rpc("mark_website_done", { p_ids: ids });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["website-updates"] }); qc.invalidateQueries({ queryKey: ["pending-approvals"] });
      toast.success(n === 1 ? "Ticked off" : `${n} changes ticked off`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const line = (e: WebEvent) => {
    if (e.field === "product_added") return <span className="font-medium text-[hsl(var(--st-active))]">New product</span>;
    const label = FIELD_LABEL[e.field] ?? e.field.replace(/_/g, " ");
    if (e.field === "rate_usd") {
      const loc = e.product_id ? data?.local.get(e.product_id) : undefined;
      return <><span className="text-muted-foreground">{label}:</span> ${e.old_value ?? "(blank)"} → ${e.new_value ?? "(blank)"}{loc ? <span className="text-muted-foreground">, now {loc}</span> : null}</>;
    }
    const t = (v: string | null) => (v && (e.field === "starts_at" || e.field === "ends_at") ? v.slice(0, 5) : v);   // 17:00:00 -> 17:00
    return <><span className="text-muted-foreground">{label}:</span> <Val v={t(e.old_value)} /> → <Val v={t(e.new_value)} /></>;
  };
  const shownIds = groups.flatMap((g) => g.events.map((e) => e.id));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-3xl">
          Changes GMs and head office made to products sold on the website. They are already live in the Experience
          Database and emailed to you; once the website and Rezdy match, press Done.
        </p>
        {canTick && groups.length > 1 && (
          <Tip label="Ticks off every change shown (with the hostel filter applied).">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={done.isPending}
              onClick={() => { if (window.confirm(`Tick off all ${shownIds.length} changes shown?`)) done.mutate(shownIds); }}>
              <Check className="h-4 w-4" /> All shown done ({shownIds.length})
            </Button>
          </Tip>
        )}
      </div>

      <Select value={locFilter} onValueChange={setLocFilter}>
        <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All hostels ({data?.events.length ?? 0})</SelectItem>
          {auth.allLocations.filter((l) => perLoc.has(l.id)).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({perLoc.get(l.id)})</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="border rounded-lg divide-y">
        {isLoading && <div className="px-3 py-10 text-center text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="px-3 py-10 text-center text-sm text-destructive">Couldn't load the website updates. Refresh the page.</div>}
        {!isLoading && !error && groups.length === 0 && <div className="px-3 py-10 text-center text-sm text-muted-foreground">All done. The website matches every change.</div>}
        {groups.map((g) => (
          <div key={g.key} className="px-3 py-2.5 flex gap-3 items-start hover:bg-secondary/30">
            <div className="flex-1 min-w-0 space-y-1">
              <div>
                {g.product_id ? <Link to={`/experiences/${g.product_id}`} className="font-medium hover:underline underline-offset-2">{g.title}</Link> : <span className="font-medium">{g.title}</span>}
                <span className="text-xs text-muted-foreground"> · {locName(g.location_id)}</span>
              </div>
              <ul className="text-sm space-y-0.5">
                {g.events.map((e) => (
                  <li key={e.id} className="break-words">
                    {line(e)}
                    <span className="text-xs text-muted-foreground"> · {e.changed_by ? data?.names.get(e.changed_by) ?? "unknown" : "system"}, {when(e.changed_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {canTick && (
              <Tip label="The website and Rezdy now match these changes.">
                <Button size="sm" className="h-8 gap-1 shrink-0" disabled={done.isPending} onClick={() => done.mutate(g.events.map((e) => e.id))}>
                  <Check className="h-3.5 w-3.5" /> Done on website
                </Button>
              </Tip>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

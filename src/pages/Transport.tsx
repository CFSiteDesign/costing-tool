import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { Product } from "@/lib/types";
import { usd, shortTime } from "@/lib/format";
import { money } from "@/lib/fx";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Tip, TipHead } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search } from "lucide-react";

interface TransportRow extends Product {
  transport_details: { vehicle_type: string | null; route_raw: string | null; origin: string | null; destination: string | null; pickup_point: string | null; dropoff_point: string | null; departure_times: string[] } | null;
}

const hours = (m: number | null) => m == null ? "" : m % 60 === 0 ? `${m / 60}h` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;

/** Phase 2: transport gets its own tab - a searchable list of every transfer, bus, boat and rental at this hostel. */
export default function Transport() {
  const auth = useAuth();
  const nav = useNavigate();
  const locId = auth.currentLocation?.id;
  const ccy = auth.currentLocation?.currency ?? "USD";
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [showPaused, setShowPaused] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["transport", locId],
    enabled: !!locId,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*, transport_details(*)")
        .eq("location_id", locId!).eq("category", "transport").order("title");
      if (error) throw error;
      return (data ?? []) as unknown as TransportRow[];
    },
  });

  const types = useMemo(() => [...new Set((data ?? []).map((r) => r.transport_details?.vehicle_type?.trim()).filter(Boolean) as string[])].sort(), [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (!showPaused && r.status === "paused") return false;
      const t = r.transport_details;
      if (type !== "all" && (t?.vehicle_type?.trim() ?? "") !== type) return false;
      if (!q) return true;
      return [r.title, t?.route_raw, t?.origin, t?.destination, t?.vehicle_type, t?.pickup_point, t?.dropoff_point, r.brief_description]
        .some((x) => (x ?? "").toLowerCase().includes(q));
    });
  }, [data, search, type, showPaused]);

  const price = (p: Product) =>
    p.rate_usd == null ? <span className="text-[hsl(var(--st-pending))] text-xs">no rate</span>
      : p.rate_usd === 0 ? "Free"
      : ccy !== "USD" && p.local_amount != null ? <>{money(p.local_amount, ccy)} <span className="text-muted-foreground">· {usd(p.rate_usd)}</span></>
      : usd(p.rate_usd);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Transport</h1>
          <p className="text-sm text-muted-foreground">Every transfer, bus, boat, taxi and rental at {auth.currentLocation?.name ?? "this hostel"}. Click a row to edit it.</p>
        </div>
        {auth.isEditor && (
          <Tip label="Opens the add-product form with the category set to Transport.">
            <Link to="/experiences/new?category=transport"><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add transport</Button></Link>
          </Tip>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="Search route, place, operator…" className="w-72 h-9 pl-8" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Tip label="Paused transport is hidden. Switch on to see it.">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help"><Switch checked={showPaused} onCheckedChange={setShowPaused} /> Show paused</label>
        </Tip>
        <div className="ml-auto text-sm text-muted-foreground tabular-nums">{rows.length} of {(data ?? []).length}</div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-muted-foreground text-left">
                <th className="font-medium px-3 py-2.5 min-w-[280px]"><TipHead label="Route" tip="The transfer as named in the database, with from → to underneath when known. Click to open and edit." /></th>
                <th className="font-medium px-3 py-2.5 w-32"><TipHead label="Type" tip="Vehicle: bus, van, ferry/boat, taxi, bike/scooter…" /></th>
                <th className="font-medium px-3 py-2.5 w-44"><TipHead label="Departures" tip="Time slots the quote builder offers for this transfer. Set them on the product page." /></th>
                <th className="font-medium px-3 py-2.5 w-20"><TipHead label="Takes" tip="Journey time, when recorded." /></th>
                <th className="font-medium px-3 py-2.5 w-40 text-right"><TipHead label="Price" tip="Local price with USD alongside. Quotes always use USD." /></th>
                <th className="font-medium px-3 py-2.5 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">{(data ?? []).length === 0 ? "No transport at this hostel yet." : "Nothing matches."}</td></tr>}
              {rows.map((r) => {
                const t = r.transport_details;
                const slots = t?.departure_times ?? [];
                const fromTo = t?.origin && t?.destination ? `${t.origin} → ${t.destination}` : t?.route_raw && t.route_raw !== r.title ? t.route_raw : null;
                return (
                  <tr key={r.id} className="border-t hover:bg-secondary/40 cursor-pointer" onClick={() => nav(`/experiences/${r.id}`)}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.title}</div>
                      {fromTo && <div className="text-xs text-muted-foreground">{fromTo}</div>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{t?.vehicle_type ?? "—"}</td>
                    <td className="px-3 py-2">
                      {slots.length > 0 ? (
                        <div className="flex flex-wrap gap-1">{slots.map((s) => <span key={s} className="rounded-full border px-2 py-0.5 text-xs tabular-nums">{shortTime(s)}</span>)}</div>
                      ) : r.starts_at ? <span className="tabular-nums text-muted-foreground">{shortTime(r.starts_at)}</span>
                      : <Tip label="No departure times yet - add them on the product page so quotes can pick a slot."><span className="text-xs text-[hsl(var(--st-pending))] cursor-help">no times</span></Tip>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{hours(r.duration_minutes) || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{price(r)}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Transport is kept out of Experiences and My week. Departure times, pick-up and drop-off points are edited on each product's page.</p>
    </div>
  );
}

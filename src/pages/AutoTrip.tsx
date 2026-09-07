import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { lineTotal } from "@/pricing/engine";
import type { Product, RoomType, SeasonTier } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { usd } from "@/lib/format";
import { clashes, timeSpan } from "@/lib/clash";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Tip } from "@/components/app/Tip";
import { Plus, Trash2, Wand2, ArrowLeft } from "lucide-react";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoOf(d); };
const isoWeekday = (iso: string) => ((new Date(iso + "T00:00:00").getDay() + 6) % 7) + 1;
const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const SEASON_LABEL: Record<string, string> = { lean: "Low", mid: "Mid", high: "High" };

/** nights is kept as text so the box can be cleared and retyped (phase 2 fix). */
interface Stop { location_id: string; first_night: string; nights: string; }
const nightsOf = (s: Stop) => Math.max(0, Math.floor(Number(s.nights)) || 0);
interface GenDay { day_no: number; date: string; location_id: string; season: SeasonTier | null; }

/** Round 2 / C: the second way in — stops + dates in, a whole trip out. */
export default function AutoTrip() {
  const auth = useAuth();
  const nav = useNavigate();
  const today = isoOf(new Date());
  const [title, setTitle] = useState("");
  const [pax, setPax] = useState("12");
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [breakfast, setBreakfast] = useState(true);
  const [stops, setStops] = useState<Stop[]>([{ location_id: auth.currentLocation?.id ?? "", first_night: "", nights: "2" }]);
  const [picked, setPicked] = useState<Record<number, Set<string>>>({});   // day_no -> product ids
  const [creating, setCreating] = useState(false);

  const { data: roomTypes } = useQuery({ queryKey: ["room-types"], queryFn: async () => (await supabase.from("room_types").select("*").order("sort_order")).data as RoomType[] });
  const { data: seasons } = useQuery({ queryKey: ["season-calendar"], queryFn: async () => (await supabase.from("season_calendar").select("*")).data ?? [] });

  /** Earliest first night a stop may have: today, or the day the previous stop ends (phase 2). */
  const minFor = (i: number) => {
    if (i === 0) return today;
    const prev = stops[i - 1];
    const after = prev.first_night ? addDays(prev.first_night, Math.max(1, nightsOf(prev))) : today;
    return after > today ? after : today;
  };
  const dateProblem = (i: number) => stops[i].first_night && stops[i].first_night < minFor(i)
    ? (i === 0 ? "That date has already passed" : `Starts before stop ${i} ends (${fmt(minFor(i))})`) : null;
  const setStop = (i: number, patch: Partial<Stop>) => setStops((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ── derive the day list from the stops ─────────────────────────────
  const days: GenDay[] = useMemo(() => {
    const out: GenDay[] = [];
    let n = 1;
    for (const s of stops) {
      const nights = nightsOf(s);
      if (!s.location_id || !s.first_night || nights < 1) continue;
      for (let i = 0; i < nights; i++) {
        const date = addDays(s.first_night, i);
        const month = Number(date.slice(5, 7));
        const row = (seasons ?? []).find((x) => x.location_id === s.location_id && x.month === month);
        out.push({ day_no: n++, date, location_id: s.location_id, season: (row?.tier as SeasonTier) ?? null });
      }
    }
    return out;
  }, [stops, seasons]);

  const locIds = useMemo(() => [...new Set(days.map((d) => d.location_id))], [days]);
  const dateRange = days.length ? [days[0].date, days[days.length - 1].date] : null;

  // ── what runs at those places on those days ────────────────────────
  const { data: menu } = useQuery({
    queryKey: ["auto-menu", locIds, dateRange],
    enabled: locIds.length > 0 && !!dateRange,
    queryFn: async () => {
      const [{ data: products }, { data: rules }, { data: rates }, { data: bf }] = await Promise.all([
        supabase.from("products").select("*").in("location_id", locIds).eq("active_on_ground", true).neq("status", "paused")
          .in("category", ["mm_tour", "nightly_event", "third_party_tour", "one_time_event"]).or(`expires_on.is.null,expires_on.gte.${today}`),
        supabase.from("product_date_rules").select("product_id, starts_on").gte("starts_on", dateRange![0]).lte("starts_on", dateRange![1]),
        supabase.from("accommodation_rates").select("location_id, room_type_id, season, rate_usd").in("location_id", locIds),
        supabase.from("breakfast_rates").select("location_id, rate_usd_pp").in("location_id", locIds),
      ]);
      return { products: (products ?? []) as Product[], rules: rules ?? [], rates: rates ?? [], bf: bf ?? [] };
    },
  });

  /** Everything that runs at that hostel on that date, in time order (untimed last). */
  const optionsFor = (d: GenDay) => {
    const wd = isoWeekday(d.date);
    const dated = new Set((menu?.rules ?? []).filter((r) => r.starts_on === d.date).map((r) => r.product_id));
    return (menu?.products ?? [])
      .filter((p) => p.location_id === d.location_id)
      .filter((p) => (p.category !== "one_time_event" && p.days_of_week.includes(wd)) || dated.has(p.id))
      .sort((a, b) => (a.starts_at ?? "99").localeCompare(b.starts_at ?? "99") || a.title.localeCompare(b.title));
  };
  const stayRate = (d: GenDay) => {
    if (!roomId) return null;
    const r = (menu?.rates ?? []).find((x) => x.location_id === d.location_id && x.room_type_id === roomId && x.season === (d.season ?? "mid"));
    return r ? Number(r.rate_usd) : null;
  };
  const bfRate = (locId: string) => { const r = (menu?.bf ?? []).find((x) => x.location_id === locId); return r ? Number(r.rate_usd_pp) : null; };
  const locName = (id: string) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";

  const toggle = (dayNo: number, pid: string) => setPicked((s) => {
    const set = new Set(s[dayNo] ?? []);
    set.has(pid) ? set.delete(pid) : set.add(pid);
    return { ...s, [dayNo]: set };
  });

  // ── create everything ──────────────────────────────────────────────
  const create = async () => {
    const paxN = Math.max(1, Number(pax) || 1);
    if (days.length === 0) return toast.error("Add at least one stop with a date");
    const bad = stops.findIndex((_, i) => dateProblem(i));
    if (bad >= 0) return toast.error(`Stop ${bad + 1}: ${dateProblem(bad)}`);
    if (!roomId) return toast.error("Pick a room type");
    const missingRate = days.find((d) => stayRate(d) == null);
    if (missingRate) return toast.error(`No ${roomTypes?.find((r) => r.id === roomId)?.name} rate for ${locName(missingRate.location_id)} in ${SEASON_LABEL[missingRate.season ?? "mid"]} season`);
    setCreating(true);
    try {
      let customerId: string | null = null;
      if (contact.trim()) {
        const { data, error } = await supabase.from("customers").insert({ contact_name: contact.trim(), company_name: company.trim() || null }).select("id").single();
        if (error) throw error; customerId = data.id;
      }
      const { data: me } = await supabase.auth.getUser();
      const { data: q, error: qe } = await supabase.from("quotes").insert({ title: title.trim() || "Untitled trip", pax_count: paxN, customer_id: customerId, owner_id: me.user?.id }).select("id").single();
      if (qe) throw qe;
      const { data: dayRows, error: de } = await supabase.from("quote_days")
        .insert(days.map((d) => ({ quote_id: q.id, day_no: d.day_no, date: d.date, location_id: d.location_id,
          notes: d.season ? null : "Season unknown for this month — defaulted to mid, check the rate" })))
        .select("id, day_no");
      if (de) throw de;
      const dayId = new Map((dayRows ?? []).map((r) => [r.day_no, r.id]));
      const room = roomTypes?.find((r) => r.id === roomId);
      const lines: Record<string, unknown>[] = [];
      for (const d of days) {
        const season = d.season ?? "mid";
        const rate = stayRate(d)!;
        const base = { quote_id: q.id, day_id: dayId.get(d.day_no), qty: 1, per_person: true };
        lines.push({ ...base, sort_order: 0, kind: "accommodation", title: `${room?.name ?? "Room"} - ${SEASON_LABEL[season]} season`, room_type_id: roomId, season, unit_price_usd: rate,
          line_total_usd: lineTotal({ kind: "accommodation", qty: 1, unit_price_usd: rate, per_person: true, pax: null, discount_pct: null, discount_amount_usd: null, is_comp: false }, paxN) });
        const b = breakfast ? bfRate(d.location_id) : null;
        if (b != null) lines.push({ ...base, sort_order: 1, kind: "breakfast", title: "Breakfast", unit_price_usd: b,
          line_total_usd: lineTotal({ kind: "breakfast", qty: 1, unit_price_usd: b, per_person: true, pax: null, discount_pct: null, discount_amount_usd: null, is_comp: false }, paxN) });
        // experiences go in time order so the builder and the quote read like a day (phase 2)
        const chosen = optionsFor(d).filter((p) => picked[d.day_no]?.has(p.id));
        let i = 2;
        for (const p of chosen) {
          if (p.rate_usd == null) continue;
          lines.push({ ...base, sort_order: i++, kind: "experience", source_product_id: p.id, title: p.title, description: p.brief_description,
            starts_at: p.starts_at, ends_at: p.ends_at, duration_minutes: p.duration_minutes, unit_price_usd: p.rate_usd,
            line_total_usd: lineTotal({ kind: "experience", qty: 1, unit_price_usd: p.rate_usd, per_person: true, pax: null, discount_pct: null, discount_amount_usd: null, is_comp: false }, paxN) });
        }
      }
      const { error: le } = await supabase.from("quote_lines").insert(lines);
      if (le) throw le;
      toast.success(`Trip created — ${days.length} days, ${lines.length} lines`);
      nav(`/quotes/${q.id}`);
    } catch (e) { toast.error((e as Error).message); setCreating(false); }
  };

  const pickedCount = Object.values(picked).reduce((n, s) => n + s.size, 0);

  return (
    <div className="p-4 max-w-4xl space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav("/quotes")}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-xl font-semibold">Auto-create a trip</h1>
          <p className="text-sm text-muted-foreground">Stops and dates in, a whole day-by-day trip out. You can change anything in the builder afterwards.</p>
        </div>
      </div>

      {/* 1. basics */}
      <section className="border rounded-lg p-4 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="space-y-1.5 col-span-2"><Label>Trip title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reight Travel Cambodia 10 Days" /></div>
        <div className="space-y-1.5"><Label>Pax</Label><Input inputMode="numeric" value={pax} onChange={(e) => setPax(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Tip label="Applied to every night of the trip. You can change individual nights in the builder afterwards."><Label className="cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">Room type for every night</Label></Tip>
          <Select value={roomId ?? ""} onValueChange={setRoomId}>
            <SelectTrigger><SelectValue placeholder="Dorm or Private" /></SelectTrigger>
            <SelectContent>{(roomTypes ?? []).filter((r) => !r.is_sample).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Contact</Label><Input value={contact} onChange={(e) => setContact(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Company / agent</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        <Tip label="Adds a breakfast line to every night at that hostel's per-person rate."><label className="flex items-center gap-2 text-sm col-span-2 cursor-help"><Switch checked={breakfast} onCheckedChange={setBreakfast} /> Breakfast every night</label></Tip>
      </section>

      {/* 2. stops */}
      <section className="border rounded-lg p-4 space-y-2">
        <Tip label="Each stop: which hostel, the date of the first night there, how many nights. The next stop's date follows on automatically and can't be earlier than the previous stop ends."><div className="font-medium cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50 w-fit">Stops, in order</div></Tip>
        {stops.map((s, i) => {
          const problem = dateProblem(i);
          return (
            <div key={i} className="space-y-1">
              <div className="grid grid-cols-[1fr_10rem_5rem_2rem] gap-2 items-center max-sm:grid-cols-2">
                <Select value={s.location_id} onValueChange={(v) => setStop(i, { location_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Hostel" /></SelectTrigger>
                  <SelectContent>{auth.allLocations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
                <Tip label={i === 0 ? "First night of the trip. Past dates can't be picked." : `Earliest: ${fmt(minFor(i))}, when the previous stop ends.`}>
                  <Input type="date" className={`h-9 ${problem ? "border-[hsl(var(--st-remove))]" : ""}`} value={s.first_night} min={minFor(i)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && v < minFor(i)) { toast.error(i === 0 ? "That date has already passed" : `Stop ${i + 1} can't start before stop ${i} ends (${fmt(minFor(i))})`); return; }
                      setStop(i, { first_night: v });
                    }} />
                </Tip>
                <Tip label="Nights at this hostel. Clear the box and type a new number.">
                  <Input inputMode="numeric" className="h-9" value={s.nights} placeholder="nights"
                    onChange={(e) => setStop(i, { nights: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                    onBlur={() => setStop(i, { nights: String(Math.max(1, nightsOf(s))) })} />
                </Tip>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled={stops.length === 1} onClick={() => setStops((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              {problem && <p className="text-xs text-[hsl(var(--st-remove))]">{problem}</p>}
            </div>
          );
        })}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
          const last = stops[stops.length - 1];
          setStops((a) => [...a, { location_id: "", first_night: last?.first_night ? addDays(last.first_night, Math.max(1, nightsOf(last))) : "", nights: "2" }]);
        }}><Plus className="h-3.5 w-3.5" /> Add stop</Button>
        <p className="text-xs text-muted-foreground">Columns: hostel · first night · nights. The next stop's date follows on automatically. A day is a night: five nights = five days.</p>
      </section>

      {/* 3. generated days with tick-lists */}
      {days.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Tip label="Listed in time order. Two things that run at the same time can't both be ticked — the second one greys out and says what it clashes with."><div className="font-medium cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">{days.length} days generated — tick what to include</div></Tip>
            <span className="text-xs text-muted-foreground">{pickedCount} experience{pickedCount === 1 ? "" : "s"} picked</span>
          </div>
          {days.map((d) => {
            const opts = optionsFor(d); const rate = stayRate(d); const b = breakfast ? bfRate(d.location_id) : null;
            const chosen = opts.filter((p) => picked[d.day_no]?.has(p.id));
            return (
              <div key={d.day_no} className="border rounded-lg p-3">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <div className="font-medium text-[15px]">Day {d.day_no} <span className="text-muted-foreground font-normal text-sm">· {locName(d.location_id)} · {fmt(d.date)}</span></div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    Stay {roomId ? (rate != null ? `${usd(rate)} pp` : <span className="text-[hsl(var(--st-pending))]">no rate</span>) : "—"} · <Tip label={d.season ? "Season picked automatically from this hostel's month table in the rate sheet." : "The rate sheet has no season for this month here — assumed mid. Check the rate."}><span className="cursor-help underline decoration-dotted underline-offset-4">{SEASON_LABEL[d.season ?? "mid"]} season{d.season ? "" : " (assumed)"}</span></Tip>
                    {b != null && ` · breakfast ${usd(b)} pp`}
                  </div>
                </div>
                {opts.length === 0 ? <p className="text-sm text-muted-foreground italic mt-1">Nothing runs here on a {fmt(d.date).split(" ")[0]}</p> : (
                  <div className="mt-2 grid grid-cols-2 gap-1 max-md:grid-cols-1">
                    {opts.map((p) => {
                      const on = picked[d.day_no]?.has(p.id) ?? false;
                      const clash = on ? undefined : chosen.find((c) => clashes(c, p));
                      const disabled = p.rate_usd == null || !!clash;
                      const row = (
                        <label key={p.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm border ${on ? "bg-primary/5 border-primary/40" : "border-transparent"} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-secondary"}`}>
                          <input type="checkbox" className="accent-[#1A1A18]" checked={on} disabled={disabled} onChange={() => toggle(d.day_no, p.id)} />
                          <span className="w-[6.5rem] shrink-0 tabular-nums text-xs text-muted-foreground">{timeSpan(p) || "—"}</span>
                          <span className="flex-1 truncate">{p.title}<span className="text-xs text-muted-foreground"> · {CATEGORY_LABELS[p.category]}</span>{clash && <span className="text-xs text-[hsl(var(--st-remove))]"> · clashes with {clash.title}</span>}</span>
                          <span className="tabular-nums text-xs">{p.rate_usd == null ? "no rate" : p.rate_usd === 0 ? "free" : usd(p.rate_usd)}</span>
                        </label>
                      );
                      return clash ? <Tip key={p.id} label={`Runs at the same time as ${clash.title} (${timeSpan(clash)}). Untick that one to pick this instead.`}>{row}</Tip> : row;
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end pt-1">
            <Tip label="Creates the quote with every day, one stay per night, breakfast if ticked, and the experiences you ticked in time order — then opens it in the builder."><Button className="gap-1.5" disabled={creating} onClick={create}><Wand2 className="h-4 w-4" /> {creating ? "Creating…" : "Create the trip"}</Button></Tip>
          </div>
        </section>
      )}
    </div>
  );
}

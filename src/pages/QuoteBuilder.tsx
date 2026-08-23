import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { computeTotals, lineTotal, type PricedLine } from "@/pricing/engine";
import { usd, shortTime, timeAgo } from "@/lib/format";
import type { Location, Product, QuoteLine, RoomType, SeasonTier } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { InlineText } from "@/components/app/InlineCell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Plus, Trash2, Percent, Copy, ExternalLink, FileText } from "lucide-react";

type Day = { id: string; day_no: number; date: string | null; location_id: string | null; notes: string | null };
type Version = { id: string; version_no: number; created_at: string; total_usd: number; per_person_usd: number; share_slug: string; sent_at: string | null };

const asPriced = (l: QuoteLine): PricedLine => ({
  kind: l.kind, qty: Number(l.qty), unit_price_usd: Number(l.unit_price_usd),
  per_person: l.per_person, pax: l.pax, discount_pct: l.discount_pct == null ? null : Number(l.discount_pct),
  discount_amount_usd: l.discount_amount_usd == null ? null : Number(l.discount_amount_usd),
  is_comp: l.is_comp, room_type_id: l.room_type_id,
});

export default function QuoteBuilder() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState<null | "accommodation" | "experience" | "transport" | "custom">(null);
  const [addDayId, setAddDayId] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const { data: quote } = useQuery({
    queryKey: ["quote", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes")
        .select("*, customers(*)").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: days } = useQuery({
    queryKey: ["quote-days", id],
    queryFn: async () => {
      const { data } = await supabase.from("quote_days").select("*").eq("quote_id", id!).order("day_no");
      return (data ?? []) as Day[];
    },
  });
  const { data: lines } = useQuery({
    queryKey: ["quote-lines", id],
    queryFn: async () => {
      const { data } = await supabase.from("quote_lines").select("*").eq("quote_id", id!).order("sort_order").order("created_at");
      return (data ?? []) as QuoteLine[];
    },
  });
  const { data: roomTypes } = useQuery({
    queryKey: ["room-types"],
    queryFn: async () => (await supabase.from("room_types").select("*").order("sort_order")).data as RoomType[],
  });
  const { data: versions } = useQuery({
    queryKey: ["quote-versions", id],
    queryFn: async () => {
      const { data } = await supabase.from("quote_versions")
        .select("id, version_no, created_at, total_usd, per_person_usd, share_slug, sent_at")
        .eq("quote_id", id!).order("version_no", { ascending: false });
      return (data ?? []) as Version[];
    },
  });
  const { data: rateMeta } = useQuery({
    queryKey: ["rate-meta"],
    queryFn: async () => {
      const { data } = await supabase.from("rate_sync_runs")
        .select("finished_at, status, source").eq("status", "success")
        .order("finished_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quote-lines", id] });
    qc.invalidateQueries({ queryKey: ["quote-days", id] });
    qc.invalidateQueries({ queryKey: ["quote", id] });
  };

  const patchQuote = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("quotes").update(patch).eq("id", id!);
    if (error) toast.error(error.message); else invalidate();
  };

  const addDay = async () => {
    const dayNo = (days?.length ?? 0) + 1;
    const { error } = await supabase.from("quote_days").insert({
      quote_id: id, day_no: dayNo, location_id: auth.currentLocation?.id ?? null,
    });
    if (error) toast.error(error.message); else invalidate();
  };

  const patchLine = async (lineId: string, patch: Partial<QuoteLine>, isAdjustment = false) => {
    const current = (lines ?? []).find((l) => l.id === lineId);
    if (!current) return;
    const merged = { ...current, ...patch };
    const total = lineTotal(asPriced(merged as QuoteLine), quote?.pax_count ?? 1);
    const extra: Record<string, unknown> = { line_total_usd: total };
    if (isAdjustment) {
      const { data: me } = await supabase.auth.getUser();
      extra.adjusted_by = me.user?.id;
      extra.adjusted_at = new Date().toISOString();
    }
    const { error } = await supabase.from("quote_lines").update({ ...patch, ...extra }).eq("id", lineId);
    if (error) toast.error(error.message); else invalidate();
  };

  const removeLine = async (lineId: string) => {
    const { error } = await supabase.from("quote_lines").delete().eq("id", lineId);
    if (error) toast.error(error.message); else invalidate();
  };

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_quote_version", { p_quote_id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote-versions", id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setVersionsOpen(true);
      toast.success("Version frozen — prices are locked to this agreement");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = useMemo(
    () => computeTotals((lines ?? []).map(asPriced), quote?.pax_count ?? 1),
    [lines, quote?.pax_count],
  );

  if (!quote) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const roomName = (rid: string) => roomTypes?.find((r) => r.id === rid)?.name ?? "Room";
  const rateStale = rateMeta?.finished_at
    ? Date.now() - new Date(rateMeta.finished_at).getTime() > 36 * 3600e3 : true;
  const usingSampleRates = rateMeta?.source === "sample_seed";

  const linesFor = (dayId: string | null) =>
    (lines ?? []).filter((l) => l.day_id === dayId);

  const LineRow = ({ l }: { l: QuoteLine }) => (
    <div className="flex items-center gap-2 py-1.5 pl-2 pr-1 rounded hover:bg-secondary/50 group text-sm">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{l.kind === "accommodation" ? "stay" : l.kind}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">
          {l.title}
          {l.room_type_id && <span className="text-muted-foreground font-normal"> · {roomName(l.room_type_id)}{l.season ? ` · ${l.season}` : ""}</span>}
        </div>
        {(l.starts_at || l.is_comp || l.discount_pct || l.discount_amount_usd) && (
          <div className="text-xs text-muted-foreground">
            {l.starts_at && `${shortTime(l.starts_at)}${l.ends_at ? `–${shortTime(l.ends_at)}` : ""} · `}
            {l.is_comp && <span className="text-[hsl(var(--st-active))]">comped</span>}
            {!l.is_comp && l.discount_pct ? `−${l.discount_pct}%` : ""}
            {!l.is_comp && l.discount_amount_usd ? ` −$${l.discount_amount_usd}` : ""}
          </div>
        )}
      </div>
      <div className="w-14 shrink-0">
        <InlineText numeric value={String(l.qty)} onCommit={(v) => {
          const n = Number(v); if (!isFinite(n) || n <= 0) return toast.error("Qty must be > 0");
          patchLine(l.id, { qty: n });
        }} />
      </div>
      <span className="text-muted-foreground text-xs shrink-0">×</span>
      <div className="w-20 shrink-0">
        <InlineText numeric value={String(l.unit_price_usd)} onCommit={(v) => {
          const n = Number(v); if (!isFinite(n)) return toast.error("Price must be a number");
          patchLine(l.id, { unit_price_usd: n }, true);
        }} />
      </div>
      <span className="w-20 text-right tabular-nums shrink-0 font-medium">{usd(lineTotal(asPriced(l), quote.pax_count))}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100"><Percent className="h-3.5 w-3.5" /></Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2" align="end">
          <div className="space-y-1">
            <Label className="text-xs">Discount %</Label>
            <Input className="h-8" inputMode="decimal" defaultValue={l.discount_pct ?? ""} onBlur={(e) =>
              patchLine(l.id, { discount_pct: e.target.value === "" ? null : Number(e.target.value) }, true)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Discount $ (after %)</Label>
            <Input className="h-8" inputMode="decimal" defaultValue={l.discount_amount_usd ?? ""} onBlur={(e) =>
              patchLine(l.id, { discount_amount_usd: e.target.value === "" ? null : Number(e.target.value) }, true)} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Comp this line</Label>
            <Switch checked={l.is_comp} onCheckedChange={(v) => patchLine(l.id, { is_comp: v }, true)} />
          </div>
          <p className="text-[11px] text-muted-foreground">Logged against your name.</p>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        onClick={() => removeLine(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );

  const AddButtons = ({ dayId }: { dayId: string | null }) => (
    <div className="flex gap-1.5 flex-wrap pt-1">
      {(["accommodation", "experience", "transport", "custom"] as const).map((k) => (
        <Button key={k} variant="outline" size="sm" className="h-7 text-xs gap-1"
          onClick={() => { setAddDayId(dayId); setAddOpen(k); }}>
          <Plus className="h-3 w-3" /> {k === "accommodation" ? "Stay" : k[0].toUpperCase() + k.slice(1)}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="p-4 grid grid-cols-[1fr_320px] gap-4 max-xl:grid-cols-1 items-start">
      <div className="space-y-4 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground tabular-nums">{quote.reference}</div>
            <div className="w-[28rem] max-w-full">
              <InlineText value={quote.title} className="text-xl font-semibold px-0"
                onCommit={(v) => patchQuote({ title: v || "Untitled trip" })} />
            </div>
            <div className="text-sm text-muted-foreground">
              {quote.customers ? `${quote.customers.contact_name}${quote.customers.company_name ? ` · ${quote.customers.company_name}` : ""}` : "No customer"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              <Label className="text-muted-foreground">Pax</Label>
              <div className="w-16">
                <InlineText numeric value={String(quote.pax_count)} onCommit={(v) => {
                  const n = Number(v); if (!isFinite(n) || n < 1) return toast.error("Pax must be ≥ 1");
                  patchQuote({ pax_count: n });
                }} />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)} className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Versions ({versions?.length ?? 0})
            </Button>
          </div>
        </div>

        {(usingSampleRates || rateStale) && (
          <div className="rounded-md border border-[hsl(var(--st-pending))]/40 bg-[hsl(var(--st-pending))]/10 px-3 py-2 text-sm">
            {usingSampleRates
              ? <><span className="font-medium">Sample accommodation rates.</span> Real rates arrive with the 2027 RATE OFFER TA sync — don’t send agreements built on these stays.</>
              : <><span className="font-medium">Rates may be stale</span> — last successful sync {timeAgo(rateMeta?.finished_at ?? null)}.</>}
          </div>
        )}

        {(days ?? []).map((d) => (
          <div key={d.id} className="border rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between">
              <div className="font-medium text-[15px]">Day {d.day_no}
                <span className="text-muted-foreground font-normal text-sm">
                  {" · "}{auth.allLocations.find((l) => l.id === d.location_id)?.name ?? "no location"}
                  {d.date ? ` · ${d.date}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input type="date" className="h-7 w-36 text-xs" defaultValue={d.date ?? ""} onBlur={async (e) => {
                  await supabase.from("quote_days").update({ date: e.target.value || null }).eq("id", d.id); invalidate();
                }} />
                <Select value={d.location_id ?? ""} onValueChange={async (v) => {
                  await supabase.from("quote_days").update({ location_id: v }).eq("id", d.id); invalidate();
                }}>
                  <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Location" /></SelectTrigger>
                  <SelectContent>
                    {auth.allLocations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {linesFor(d.id).map((l) => <LineRow key={l.id} l={l} />)}
            <AddButtons dayId={d.id} />
          </div>
        ))}

        <Button variant="outline" onClick={addDay} className="gap-1.5"><Plus className="h-4 w-4" /> Add day</Button>

        {linesFor(null).length > 0 && (
          <div className="border rounded-lg p-3 space-y-1">
            <div className="font-medium text-[15px]">Trip-wide</div>
            {linesFor(null).map((l) => <LineRow key={l.id} l={l} />)}
          </div>
        )}
        {(days ?? []).length === 0 && <AddButtons dayId={null} />}
      </div>

      {/* totals panel */}
      <div className="border rounded-lg p-4 space-y-3 sticky top-4">
        <div className="text-sm font-medium">Totals · {quote.pax_count} pax</div>
        <div className="space-y-1 text-sm">
          {(["accommodation", "fnb", "transport", "experiences", "other"] as const).map((k) =>
            totals.byProductLine[k] > 0 && (
              <div key={k} className="flex justify-between text-muted-foreground">
                <span className="capitalize">{k === "fnb" ? "F&B" : k}</span>
                <span className="tabular-nums">{usd(totals.byProductLine[k])}</span>
              </div>
            ))}
          {totals.discountTotal > 0 && (
            <div className="flex justify-between text-[hsl(var(--st-pending))]">
              <span>Discounts & comps</span><span className="tabular-nums">−{usd(totals.discountTotal)}</span>
            </div>
          )}
        </div>
        <div className="border-t pt-2 space-y-1">
          <div className="flex justify-between font-semibold text-lg">
            <span>Group total</span><span className="tabular-nums">{usd(totals.total)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Per person</span><span className="tabular-nums">{usd(totals.perPerson)}</span>
          </div>
        </div>
        {Object.keys(totals.byRoomType).length > 0 && (
          <div className="border-t pt-2 space-y-1 text-sm">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">By room type</div>
            {Object.entries(totals.byRoomType).map(([rid, v]) => (
              <div key={rid} className="flex justify-between text-muted-foreground">
                <span>{roomName(rid)}</span><span className="tabular-nums">{usd(v)}</span>
              </div>
            ))}
          </div>
        )}
        <Button className="w-full" disabled={(lines ?? []).length === 0 || generate.isPending}
          onClick={() => generate.mutate()}>
          {generate.isPending ? "Freezing…" : "Generate agreement version"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Freezes every price and description into an immutable version. Later edits to products never re-price it.
        </p>
      </div>

      <AddLineDialog
        kind={addOpen} dayId={addDayId} quoteId={id!} pax={quote.pax_count}
        defaultLocation={(days ?? []).find((d) => d.id === addDayId)?.location_id ?? auth.currentLocation?.id ?? null}
        onClose={() => setAddOpen(null)} onAdded={invalidate}
        roomTypes={roomTypes ?? []} locations={auth.allLocations}
      />

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Agreement versions</DialogTitle></DialogHeader>
          {(versions ?? []).length === 0 && <p className="text-sm text-muted-foreground">None yet — generate one from the builder.</p>}
          <div className="space-y-2">
            {(versions ?? []).map((v) => {
              const url = `${window.location.origin}/a/${v.share_slug}`;
              return (
                <div key={v.id} className="border rounded-md px-3 py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">v{v.version_no} · {usd(v.total_usd)} <span className="text-muted-foreground font-normal">({usd(v.per_person_usd)} pp)</span></div>
                    <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => {
                      navigator.clipboard.writeText(url); toast.success("Share link copied");
                    }}><Copy className="h-3.5 w-3.5" /> Link</Button>
                    <a href={url} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm" className="h-8"><ExternalLink className="h-3.5 w-3.5" /></Button>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Add-line dialog: pickers per kind ─────────────────────────────── */
function AddLineDialog({
  kind, dayId, quoteId, pax, defaultLocation, onClose, onAdded, roomTypes, locations,
}: {
  kind: null | "accommodation" | "experience" | "transport" | "custom";
  dayId: string | null; quoteId: string; pax: number;
  defaultLocation: string | null;
  onClose: () => void; onAdded: () => void;
  roomTypes: RoomType[]; locations: Location[];
}) {
  const [locId, setLocId] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [override, setOverride] = useState(false);
  const [search, setSearch] = useState("");
  // accommodation state
  const [roomId, setRoomId] = useState<string | null>(null);
  const [season, setSeason] = useState<SeasonTier>("mid");
  const [nights, setNights] = useState("1");
  const [breakfast, setBreakfast] = useState(false);
  // custom state
  const [cTitle, setCTitle] = useState("");
  const [cPrice, setCPrice] = useState("");
  const [cPerPerson, setCPerPerson] = useState(true);

  const effLoc = locId ?? defaultLocation;

  const { data: products } = useQuery({
    queryKey: ["picker", kind, effLoc, day, override, search],
    enabled: !!kind && (kind === "experience" || kind === "transport") && !!effLoc,
    queryFn: async () => {
      let q = supabase.from("products").select("*").eq("location_id", effLoc!);
      if (kind === "transport") q = q.eq("category", "transport");
      else q = q.in("category", ["mm_tour", "nightly_event", "third_party_tour", "one_time_event"]);
      if (!override) {
        q = q.neq("status", "paused").eq("active_on_ground", true);
        if (day) q = q.contains("days_of_week", [day]);
      }
      if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);
      const { data } = await q.order("title").limit(60);
      return (data ?? []) as Product[];
    },
  });

  const { data: accRate } = useQuery({
    queryKey: ["acc-rate", effLoc, roomId, season],
    enabled: kind === "accommodation" && !!effLoc && !!roomId,
    queryFn: async () => {
      const { data } = await supabase.from("accommodation_rates").select("rate_usd")
        .eq("location_id", effLoc!).eq("room_type_id", roomId!).eq("season", season).maybeSingle();
      return data?.rate_usd != null ? Number(data.rate_usd) : null;
    },
  });
  const { data: bfRate } = useQuery({
    queryKey: ["bf-rate", effLoc],
    enabled: kind === "accommodation" && !!effLoc,
    queryFn: async () => {
      const { data } = await supabase.from("breakfast_rates").select("rate_usd_pp").eq("location_id", effLoc!).maybeSingle();
      return data?.rate_usd_pp != null ? Number(data.rate_usd_pp) : null;
    },
  });

  const insert = async (rows: Record<string, unknown>[]) => {
    const withTotals = rows.map((r) => ({
      ...r,
      quote_id: quoteId,
      day_id: dayId,
      line_total_usd: lineTotal(
        {
          kind: r.kind as PricedLine["kind"], qty: Number(r.qty ?? 1),
          unit_price_usd: Number(r.unit_price_usd ?? 0),
          per_person: (r.per_person as boolean) ?? true, pax: null,
          discount_pct: null, discount_amount_usd: null, is_comp: false,
        },
        pax,
      ),
    }));
    const { error } = await supabase.from("quote_lines").insert(withTotals);
    if (error) { toast.error(error.message); return false; }
    onAdded(); onClose();
    return true;
  };

  const addProduct = async (p: Product) => {
    if (p.rate_usd == null) {
      toast.error(`“${p.title}” has no numeric rate yet — fix it in Experiences first (sheet said: ${p.rate_raw ?? "blank"})`);
      return;
    }
    await insert([{
      kind: kind === "transport" ? "transport" : "experience",
      source_product_id: p.id, title: p.title,
      description: p.brief_description, starts_at: p.starts_at, ends_at: p.ends_at,
      duration_minutes: p.duration_minutes, qty: 1, unit_price_usd: p.rate_usd, per_person: true,
    }]);
  };

  const addAccommodation = async () => {
    if (!roomId || accRate == null) { toast.error("Pick a room type with a rate"); return; }
    const n = Math.max(1, Number(nights) || 1);
    const room = roomTypes.find((r) => r.id === roomId);
    const rows: Record<string, unknown>[] = [{
      kind: "accommodation", title: `${room?.name ?? "Room"} · ${locations.find((l) => l.id === effLoc)?.name ?? ""}`,
      room_type_id: roomId, season, qty: n, unit_price_usd: accRate, per_person: true,
    }];
    if (breakfast && bfRate != null) {
      rows.push({ kind: "breakfast", title: "Breakfast", qty: n, unit_price_usd: bfRate, per_person: true });
    }
    await insert(rows);
  };

  const addCustom = async () => {
    if (!cTitle.trim()) { toast.error("Description required"); return; }
    const price = Number(cPrice);
    if (!isFinite(price)) { toast.error("Price must be a number"); return; }
    await insert([{ kind: "custom", title: cTitle.trim(), qty: 1, unit_price_usd: price, per_person: cPerPerson }]);
  };

  if (!kind) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="capitalize">Add {kind === "accommodation" ? "stay" : kind}</DialogTitle>
        </DialogHeader>

        {(kind === "experience" || kind === "transport") && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              <Select value={effLoc ?? ""} onValueChange={setLocId}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Location" /></SelectTrigger>
                <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
              {kind === "experience" && (
                <Select value={day == null ? "any" : String(day)} onValueChange={(v) => setDay(v === "any" ? null : Number(v))}>
                  <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any day</SelectItem>
                    {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => <SelectItem key={d} value={String(i + 1)}>Runs {d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
                <Switch checked={override} onCheckedChange={setOverride} />
                Show everything
              </label>
            </div>
            <Input placeholder="Search…" className="h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
              {(products ?? []).length === 0 && <div className="p-4 text-sm text-muted-foreground text-center">Nothing matches the filter — try “Show everything”.</div>}
              {(products ?? []).map((p) => (
                <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-secondary text-sm flex justify-between gap-2"
                  onClick={() => addProduct(p)}>
                  <span className="min-w-0">
                    <span className="font-medium block truncate">{p.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[p.category]}
                      {p.starts_at ? ` · ${shortTime(p.starts_at)}${p.ends_at ? `–${shortTime(p.ends_at)}` : ""}` : ""}
                      {p.duration_minutes ? ` · ${Math.round(p.duration_minutes / 60)}h` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums shrink-0 self-center">
                    {p.rate_usd != null ? usd(p.rate_usd) : <span className="text-[hsl(var(--st-pending))] text-xs">no rate</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "accommodation" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={effLoc ?? ""} onValueChange={setLocId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Location" /></SelectTrigger>
                  <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Room type</Label>
                <Select value={roomId ?? ""} onValueChange={setRoomId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Room" /></SelectTrigger>
                  <SelectContent>{roomTypes.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Season tier</Label>
                <Select value={season} onValueChange={(v) => setSeason(v as SeasonTier)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lean">Lean</SelectItem>
                    <SelectItem value="mid">Mid</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Nights</Label>
                <Input className="h-9" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between border rounded-md px-3 py-2">
              <span className="text-sm">
                Rate: <span className="font-medium tabular-nums">{accRate != null ? `${usd(accRate)} pp/night` : "—"}</span>
              </span>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={breakfast} onCheckedChange={setBreakfast} />
                Breakfast {bfRate != null ? `(${usd(bfRate)} pp/night)` : ""}
              </label>
            </div>
            <Button className="w-full" onClick={addAccommodation}>Add stay</Button>
          </div>
        )}

        {kind === "custom" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="e.g. Farewell dinner F&B package" />
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1.5">
                <Label>Price (USD)</Label>
                <Input className="w-32" inputMode="decimal" value={cPrice} onChange={(e) => setCPrice(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm pb-2">
                <Switch checked={cPerPerson} onCheckedChange={setCPerPerson} />
                Per person
              </label>
            </div>
            <Button className="w-full" onClick={addCustom}>Add line</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { CATEGORY_LABELS, STATUS_LABELS, type Category, type Product, type ProductStatus } from "@/lib/types";
import { useFx, money } from "@/lib/fx";
import { DaysPicker } from "@/components/app/DaysPicker";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { AssetCell, type Asset } from "@/components/app/AssetCell";

interface Transport { vehicle_type: string | null; route_raw: string | null; origin: string | null; destination: string | null; pickup_point: string | null; dropoff_point: string | null; departure_times: string[]; }

/** E2: the product detail page — everything editable in place, one explicit Save, never silent. */
export default function ExperienceDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const [{ data: p, error }, { data: t }] = await Promise.all([
        supabase.from("products").select("*").eq("id", id!).single(),
        supabase.from("transport_details").select("*").eq("product_id", id!).maybeSingle(),
      ]);
      if (error) throw error;
      return { product: p as Product, transport: (t ?? null) as Transport | null };
    },
  });
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  // key by id + updated_at so a fresh save re-seeds the form from the server copy
  return <DetailForm key={`${data.product.id}:${(data.product as unknown as { updated_at?: string }).updated_at ?? ""}`} product={data.product} transport={data.transport} />;
}

function DetailForm({ product, transport }: { product: Product; transport: Transport | null }) {
  const auth = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const fx = useFx();
  const canEdit = auth.isEditor;
  const loc = auth.allLocations.find((l) => l.id === product.location_id);
  const ccy = loc?.currency ?? "USD";
  const fxRate = fx.rate(ccy);

  const init = {
    title: product.title, category: product.category as Category, status: product.status as ProductStatus,
    active_on_ground: product.active_on_ground, bookable_on_website: product.bookable_on_website,
    local: product.local_amount != null ? String(product.local_amount) : "",
    dollars: product.rate_usd != null ? String(product.rate_usd) : "",
    days: product.days_of_week, starts_at: product.starts_at?.slice(0, 5) ?? "", ends_at: product.ends_at?.slice(0, 5) ?? "",
    duration: product.duration_minutes != null ? String(product.duration_minutes) : "",
    min: product.min_guests != null ? String(product.min_guests) : "", max: product.max_guests_per_day != null ? String(product.max_guests_per_day) : "",
    brief: product.brief_description ?? "", long: product.long_description ?? "",
    meeting_point: product.meeting_point ?? "", inclusions: product.inclusions ?? "", exclusions: product.exclusions ?? "",
    things_to_bring: product.things_to_bring ?? "", cancellation_policy: product.cancellation_policy ?? "",
    itinerary: product.itinerary ?? "", photo_album_url: product.photo_album_url ?? "", remarks: product.remarks ?? "",
    insurance: product.travel_insurance_required,
    expires_on: (product as unknown as { expires_on: string | null }).expires_on ?? "",
    slots: (transport?.departure_times ?? []).map((t) => t.slice(0, 5)).join(", "),
    pickup: transport?.pickup_point ?? "", dropoff: transport?.dropoff_point ?? "", route: transport?.route_raw ?? "",
  };
  const [f, setF] = useState(init);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = <K extends keyof typeof init>(k: K, v: (typeof init)[K]) => setF((s) => ({ ...s, [k]: v }));

  // E3-style safety: never lose edits by accident
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const back = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    nav(-1);
  };

  const save = async () => {
    if (!f.title.trim()) return toast.error("Title is required");
    if (f.brief.length > 95) return toast.error("Brief description must be 95 characters or fewer");
    const d = f.dollars.trim() === "" ? null : Number(f.dollars);
    const l = f.local.trim() === "" ? null : Number(f.local);
    if ((d != null && !isFinite(d)) || (l != null && !isFinite(l))) return toast.error("Rate must be a number");
    const rateChanged = f.dollars !== init.dollars || f.local !== init.local;
    if (f.category === "one_time_event" && !f.expires_on) {
      if (!window.confirm("One-time event with no expiry date — it will never drop off My week. Save anyway?")) return;
    }
    const slots = f.slots.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const badSlot = slots.find((x) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x));
    if (badSlot) return toast.error(`"${badSlot}" isn't a time — use HH:MM`);

    setSaving(true);
    const patch: Record<string, unknown> = {
      title: f.title.trim(), category: f.category, status: f.status,
      active_on_ground: f.active_on_ground, bookable_on_website: f.bookable_on_website,
      rate_usd: d, local_amount: l, local_currency: ccy,
      ...(rateChanged ? { fx_rate_used: ccy === "USD" ? 1 : fxRate, fx_as_of: new Date().toISOString() } : {}),
      days_of_week: f.days, starts_at: f.starts_at || null, ends_at: f.ends_at || null,
      duration_minutes: f.duration ? Number(f.duration) : null,
      min_guests: f.min ? Number(f.min) : null, max_guests_per_day: f.max ? Number(f.max) : null,
      brief_description: f.brief.trim() || null, long_description: f.long.trim() || null,
      meeting_point: f.meeting_point.trim() || null, inclusions: f.inclusions.trim() || null,
      exclusions: f.exclusions.trim() || null, things_to_bring: f.things_to_bring.trim() || null,
      cancellation_policy: f.cancellation_policy.trim() || null, itinerary: f.itinerary.trim() || null,
      photo_album_url: f.photo_album_url.trim() || null, remarks: f.remarks.trim() || null,
      travel_insurance_required: f.insurance,
      expires_on: f.category === "one_time_event" && f.expires_on ? f.expires_on : null,
    };
    const { error } = await supabase.from("products").update(patch).eq("id", product.id);
    if (!error && (transport || f.category === "transport")) {
      const tp = { product_id: product.id, departure_times: slots.map((x) => x.padStart(5, "0")), pickup_point: f.pickup || null, dropoff_point: f.dropoff || null, route_raw: f.route || null };
      const { error: te } = await supabase.from("transport_details").upsert(tp, { onConflict: "product_id" });
      if (te) toast.error(te.message);
    }
    setSaving(false);
    if (error) { toast.error(`Not saved: ${error.message}`); return; }
    setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["my-week"] });
  };

  const verify = async () => {
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase.from("products").update({ last_verified_at: new Date().toISOString(), last_verified_by: me.user?.id }).eq("id", product.id);
    if (error) toast.error(error.message);
    else { toast.success("Marked as verified today"); qc.invalidateQueries({ queryKey: ["product", product.id] }); qc.invalidateQueries({ queryKey: ["products"] }); }
  };
  const verifiedAt = (product as unknown as { last_verified_at: string | null }).last_verified_at;
  const { data: assets } = useQuery({
    queryKey: ["product-assets", product.id],
    queryFn: async () => (await supabase.from("product_assets").select("*").eq("product_id", product.id).order("created_at", { ascending: false })).data as Asset[],
  });
  const latestAsset = assets?.[0] ?? null;

  const Field = ({ label, k, rows = 2, maxLength }: { label: string; k: keyof typeof init; rows?: number; maxLength?: number }) => (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">{label}</Label>
        {maxLength && <span className={`text-[11px] tabular-nums ${String(f[k]).length > maxLength ? "text-destructive" : "text-muted-foreground"}`}>{String(f[k]).length}/{maxLength}</span>}
      </div>
      <Textarea rows={rows} maxLength={maxLength} readOnly={!canEdit} className="text-sm" value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} />
    </div>
  );

  return (
    <div className="p-4 max-w-4xl space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={back}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0">
            <Input className="text-lg font-semibold h-9 px-1 border-transparent hover:border-input focus:border-input" readOnly={!canEdit} value={f.title} onChange={(e) => set("title", e.target.value)} />
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-1 mt-0.5">
              {loc?.name} · {CATEGORY_LABELS[f.category]} · <StatusBadge status={f.status} />
              <span className="ml-2 text-xs">
                {verifiedAt ? `verified ${new Date(verifiedAt).toLocaleDateString("en-GB")}` : "never verified"}
              </span>
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={verify} title="Confirms these details are current as of today">
              <ShieldCheck className="h-3.5 w-3.5" /> Mark verified
            </Button>
            {savedAt && !dirty && <span className="text-xs text-[hsl(var(--st-active))] inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved {savedAt}</span>}
            {dirty && <span className="text-xs text-[hsl(var(--st-pending))]">Unsaved changes</span>}
            <Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        )}
      </div>

      {/* core */}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Category</Label>
          <Select value={f.category} onValueChange={(v) => set("category", v as Category)} disabled={!canEdit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Status</Label>
          <Select value={f.status} onValueChange={(v) => { set("status", v as ProductStatus); if (v === "paused") set("active_on_ground", false); if (v === "active" && !f.active_on_ground) set("active_on_ground", true); }} disabled={!canEdit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(STATUS_LABELS) as ProductStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Rate {ccy !== "USD" ? `(${ccy} or USD)` : "(USD)"}</Label>
          <div className="flex gap-2">
            {ccy !== "USD" && (
              <Input inputMode="decimal" placeholder={ccy} readOnly={!canEdit} className="tabular-nums" value={f.local}
                onChange={(e) => { set("local", e.target.value); const n = Number(e.target.value); if (fxRate && e.target.value !== "" && isFinite(n)) set("dollars", String(Math.round((n / fxRate) * 100) / 100)); }} />
            )}
            <Input inputMode="decimal" placeholder="USD" readOnly={!canEdit} className="tabular-nums" value={f.dollars}
              onChange={(e) => { set("dollars", e.target.value); const n = Number(e.target.value); if (ccy !== "USD" && fxRate && e.target.value !== "" && isFinite(n)) set("local", String(Math.round(n * fxRate * 100) / 100)); }} />
          </div>
          {ccy !== "USD" && fxRate && <p className="text-[11px] text-muted-foreground">1 USD = {money(fxRate, ccy)} · quotes use the USD figure</p>}
          {product.rate_raw && product.rate_usd == null && <p className="text-[11px] text-[hsl(var(--st-pending))]">Sheet said: “{product.rate_raw}”</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Days it runs</Label>
          <div><DaysPicker value={f.days} onChange={(d) => canEdit && set("days", d)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Start</Label><Input type="time" readOnly={!canEdit} value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Finish</Label><Input type="time" readOnly={!canEdit} value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Mins</Label><Input inputMode="numeric" readOnly={!canEdit} value={f.duration} onChange={(e) => set("duration", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Min to run</Label><Input inputMode="numeric" placeholder="n/a" readOnly={!canEdit} value={f.min} onChange={(e) => set("min", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Max pax</Label><Input inputMode="numeric" placeholder="n/a" readOnly={!canEdit} value={f.max} onChange={(e) => set("max", e.target.value)} /></div>
        </div>
        {f.category === "one_time_event" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Expires on</Label>
            <Input type="date" readOnly={!canEdit} value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} />
            <p className="text-[11px] text-muted-foreground">After this date it drops off My week and the list.</p>
          </div>
        )}
        <div className="flex items-center gap-6 pt-1">
          <label className="flex items-center gap-2 text-sm"><Switch disabled={!canEdit} checked={f.active_on_ground} onCheckedChange={(v) => { set("active_on_ground", v); if (!v) set("status", "paused"); else if (f.status === "paused") set("status", "active"); }} /> Active on the ground</label>
          <label className="flex items-center gap-2 text-sm"><Switch disabled={!canEdit} checked={f.bookable_on_website} onCheckedChange={(v) => set("bookable_on_website", v)} /> Listed on website</label>
          <label className="flex items-center gap-2 text-sm"><Switch disabled={!canEdit} checked={f.insurance} onCheckedChange={(v) => set("insurance", v)} /> Insurance required</label>
        </div>
      </div>

      {(transport || f.category === "transport") && (
        <div className="rounded-md bg-secondary p-3 grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div className="space-y-1 col-span-2"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Route</Label><Input readOnly={!canEdit} value={f.route} onChange={(e) => set("route", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Pick-up</Label><Input readOnly={!canEdit} value={f.pickup} onChange={(e) => set("pickup", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Drop-off</Label><Input readOnly={!canEdit} value={f.dropoff} onChange={(e) => set("dropoff", e.target.value)} /></div>
          <div className="space-y-1 col-span-2"><Label className="text-xs text-muted-foreground uppercase tracking-wide">Departure times (quotes pick from these)</Label><Input className="tabular-nums" placeholder="08:30, 11:30, 17:00" readOnly={!canEdit} value={f.slots} onChange={(e) => set("slots", e.target.value)} /></div>
        </div>
      )}

      <div className="rounded-md border p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {latestAsset && <img src={latestAsset.url} alt="" className="h-14 w-14 rounded object-cover border" onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }} />}
          <div className="text-sm">
            <div className="font-medium">Social asset</div>
            <div className="text-xs text-muted-foreground">
              {latestAsset ? `Latest made ${new Date(latestAsset.created_at).toLocaleDateString("en-GB")}${latestAsset.stale ? " · out of date" : ""}${(assets?.length ?? 0) > 1 ? ` · ${assets!.length} versions` : ""}` : "None yet — Create opens STUDIO with these details prefilled."}
            </div>
          </div>
        </div>
        <AssetCell product={product} asset={latestAsset} currency={ccy} canEdit={canEdit} />
      </div>

      <Field label="Brief description" k="brief" maxLength={95} />
      <Field label="Long description" k="long" rows={5} />
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Field label="Meeting point & time" k="meeting_point" />
        <Field label="Inclusions" k="inclusions" rows={3} />
        <Field label="Exclusions" k="exclusions" />
        <Field label="Things to bring" k="things_to_bring" />
        <Field label="Cancellation policy" k="cancellation_policy" />
        <Field label="Photo album URL (min 6 images)" k="photo_album_url" rows={1} />
      </div>
      <Field label="Itinerary" k="itinerary" rows={6} />
      <Field label="Remarks / update notes" k="remarks" />
      {product.availability_raw && <p className="text-xs text-muted-foreground border-t pt-3"><span className="font-medium">From the sheet:</span> {product.availability_raw}</p>}

      {canEdit && (
        <div className="sticky bottom-3 flex justify-end">
          <div className="bg-background border rounded-lg shadow-sm px-3 py-2 flex items-center gap-3">
            {dirty ? <span className="text-xs text-[hsl(var(--st-pending))]">Unsaved changes</span> : <span className="text-xs text-muted-foreground">All changes saved</span>}
            <Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

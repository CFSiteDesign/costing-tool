import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { CATEGORY_LABELS, type Category } from "@/lib/types";
import { DaysPicker } from "@/components/app/DaysPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Tip } from "@/components/app/Tip";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useFx, money } from "@/lib/fx";
import { holdUnsaved } from "@/lib/unsaved";
import { PriceOptionsEditor, optionsFrom, type PriceRow } from "@/components/app/PriceOptions";

export default function ExperienceNew() {
  const auth = useAuth();
  const nav = useNavigate();
  const fx = useFx();
  const localCcy = auth.currentLocation?.currency ?? "USD";
  const [params] = useSearchParams();
  const initialCategory = (["mm_tour","nightly_event","third_party_tour","one_time_event","transport"].includes(params.get("category") ?? "") ? params.get("category") : "mm_tour") as Category;   // phase 2: Transport tab deep-links here
  const [f, setF] = useState({
    title: "", category: initialCategory, rate: "", rateCcy: "", brief: "", long: "",
    days: [] as number[], starts: "", ends: "", minGuests: "1", maxGuests: "",
    meetingPoint: "", inclusions: "", thingsToBring: "", photoUrl: "", bookable: false,
    oneTime: false, expiresOn: "", status: "active" as "active" | "paused",
    options: [] as PriceRow[],
  });
  const filled = Object.entries(f).some(([k, v]) => !["category", "minGuests", "status", "rateCcy"].includes(k) && (Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v).trim() !== ""));
  useEffect(() => {
    if (!filled) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    const release = holdUnsaved();   // so replaying the tour asks first
    return () => { window.removeEventListener("beforeunload", h); release(); };
  }, [filled]);
  const back = () => {
    if (filled && !window.confirm("You've started filling this in. Leave without saving?")) return;
    nav(-1);
  };
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentLocation) return;
    if (!f.title.trim()) { toast.error("Title is required"); return; }
    if (!f.brief.trim()) { toast.error("Brief description is required"); return; }
    const category: Category = f.oneTime ? "one_time_event" : f.category;
    if (category !== "one_time_event" && f.days.length === 0) {
      toast.error("Pick the days it runs"); return;
    }
    if (f.oneTime && !f.expiresOn) { toast.error("A one-time event needs an expiry date"); return; }
    const typed = f.rate.trim() === "" ? null : Number(f.rate);
    if (f.rate.trim() !== "" && !isFinite(typed!)) { toast.error("Rate must be a number"); return; }
    const ccy = f.rateCcy || localCcy;
    const fxRate = fx.rate(ccy);
    if (typed != null && ccy !== "USD" && !fxRate) { toast.error(`No FX rate for ${ccy} yet — enter USD`); return; }
    const rate = typed == null ? null : ccy === "USD" ? typed : Math.round((typed / fxRate!) * 100) / 100;
    const localAmount = typed == null ? null : ccy === "USD" ? (localCcy === "USD" ? typed : null) : typed;
    const po = optionsFrom(f.options, localCcy);
    if ("error" in po) { toast.error(po.error); return; }
    setBusy(true);
    const { error } = await supabase.from("products").insert({
      location_id: auth.currentLocation.id,
      category,
      title: f.title.trim(),
      expires_on: f.oneTime ? f.expiresOn : null,
      active_on_ground: f.status === "active",
      rate_usd: rate,
      local_amount: localAmount,
      local_currency: localCcy,
      price_options: po.options,
      fx_rate_used: typed == null ? null : (ccy === "USD" ? 1 : fxRate),
      fx_as_of: typed == null ? null : new Date().toISOString(),
      brief_description: f.brief.trim(),
      long_description: f.long.trim() || null,
      days_of_week: f.days,
      starts_at: f.starts || null,
      ends_at: f.ends || null,
      min_guests: f.minGuests ? Number(f.minGuests) : null,
      max_guests_per_day: f.maxGuests ? Number(f.maxGuests) : null,
      meeting_point: f.meetingPoint.trim() || null,
      inclusions: f.inclusions.trim() || null,
      things_to_bring: f.thingsToBring.trim() || null,
      photo_album_url: f.photoUrl.trim() || null,
      bookable_on_website: f.bookable,
      status: f.status,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Product added");
    nav("/experiences");
  };

  return (
    <div className="p-4 max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={back}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-semibold">Add product</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Adding to <span className="font-medium text-foreground">{auth.currentLocation?.name}</span>.
        Required fields are enforced — nothing incomplete enters the database.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="space-y-1.5 col-span-2">
            <Label>Title *</Label>
            <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Category *</Label>
            <Select value={f.oneTime ? "one_time_event" : f.category} disabled={f.oneTime} onValueChange={(v) => set("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Rate</Label>
            <div className="flex gap-2">
              <Input inputMode="decimal" placeholder="0 = free" value={f.rate} onChange={(e) => set("rate", e.target.value)} />
              {localCcy !== "USD" && (
                <Select value={f.rateCcy || localCcy} onValueChange={(v) => set("rateCcy", v)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={localCcy}>{localCcy}</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            {localCcy !== "USD" && f.rate && isFinite(Number(f.rate)) && (f.rateCcy || localCcy) !== "USD" && fx.rate(localCcy) && (
              <p className="text-[11px] text-muted-foreground">≈ ${(Number(f.rate) / fx.rate(localCcy)!).toFixed(2)} USD · quotes use the USD figure</p>
            )}
            <PriceOptionsEditor rows={f.options} onChange={(rows) => set("options", rows)} ccy={localCcy} fxRate={fx.rate(localCcy)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Tip label="Goes to the website word for word, so it's capped at 95 characters."><Label className="cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">Brief description *</Label></Tip>
            <span className={`text-[11px] tabular-nums ${f.brief.length > 95 ? "text-destructive" : "text-muted-foreground"}`}>{f.brief.length}/95</span>
          </div>
          <Textarea rows={2} maxLength={95} value={f.brief} onChange={(e) => set("brief", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Long description</Label>
          <Textarea rows={4} value={f.long} onChange={(e) => set("long", e.target.value)} />
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <div className="space-y-1.5">
            <Label>{f.category === "one_time_event" ? "Days (optional for one-time)" : "Days it runs *"}</Label>
            <DaysPicker value={f.days} onChange={(d) => set("days", d)} />
          </div>
          <div className="space-y-1.5">
            <Label>Start</Label>
            <Input type="time" className="w-28" value={f.starts} onChange={(e) => set("starts", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Finish</Label>
            <Input type="time" className="w-28" value={f.ends} onChange={(e) => set("ends", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="space-y-1.5">
            <Label>Min guests / booking</Label>
            <Input inputMode="numeric" value={f.minGuests} onChange={(e) => set("minGuests", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Max guests / day</Label>
            <Input inputMode="numeric" value={f.maxGuests} onChange={(e) => set("maxGuests", e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Meeting point & time</Label>
          <Input value={f.meetingPoint} onChange={(e) => set("meetingPoint", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Inclusions</Label>
          <Textarea rows={2} value={f.inclusions} onChange={(e) => set("inclusions", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Things to bring</Label>
          <Input value={f.thingsToBring} onChange={(e) => set("thingsToBring", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Photo album URL (minimum 6 images)</Label>
          <Input type="url" placeholder="https://…" value={f.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1 items-end">
          <div className="space-y-1.5">
            <Tip label="Active = running and quotable now. Paused = in the database but hidden from quoting until you switch it on."><Label className="cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">Starts as</Label></Tip>
            <Select value={f.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active — running now</SelectItem>
                <SelectItem value="paused">Paused — not yet running</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Tip label="A dated one-off (Tequila Day, a festival) rather than a weekly tour. It gets an expiry date and drops off automatically afterwards."><label className="flex items-center gap-2.5 text-sm cursor-help">
              <Switch checked={f.oneTime} onCheckedChange={(v) => set("oneTime", v)} /> One-time event
            </label></Tip>
            {f.oneTime && (
              <div className="space-y-1">
                <Input type="date" value={f.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Expiry date — after this it drops off My week and the list.</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 pt-1">
          <Switch checked={f.bookable} onCheckedChange={(v) => set("bookable", v)} id="bk" />
          <Label htmlFor="bk">Bookable on the Mad Monkey website</Label>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add product"}</Button>
          <Button type="button" variant="outline" onClick={back}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

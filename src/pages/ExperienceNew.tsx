import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useFx, money } from "@/lib/fx";

export default function ExperienceNew() {
  const auth = useAuth();
  const nav = useNavigate();
  const fx = useFx();
  const localCcy = auth.currentLocation?.currency ?? "USD";
  const [f, setF] = useState({
    title: "", category: "mm_tour" as Category, rate: "", rateCcy: "", brief: "", long: "",
    days: [] as number[], starts: "", ends: "", minGuests: "1", maxGuests: "",
    meetingPoint: "", inclusions: "", thingsToBring: "", photoUrl: "", bookable: false,
  });
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentLocation) return;
    if (!f.title.trim()) { toast.error("Title is required"); return; }
    if (!f.brief.trim()) { toast.error("Brief description is required"); return; }
    if (f.category !== "one_time_event" && f.days.length === 0) {
      toast.error("Pick the days it runs"); return;
    }
    const typed = f.rate.trim() === "" ? null : Number(f.rate);
    if (f.rate.trim() !== "" && !isFinite(typed!)) { toast.error("Rate must be a number"); return; }
    const ccy = f.rateCcy || localCcy;
    const fxRate = fx.rate(ccy);
    if (typed != null && ccy !== "USD" && !fxRate) { toast.error(`No FX rate for ${ccy} yet — enter USD`); return; }
    const rate = typed == null ? null : ccy === "USD" ? typed : Math.round((typed / fxRate!) * 100) / 100;
    const localAmount = typed == null ? null : ccy === "USD" ? (localCcy === "USD" ? typed : null) : typed;
    setBusy(true);
    const { error } = await supabase.from("products").insert({
      location_id: auth.currentLocation.id,
      category: f.category,
      title: f.title.trim(),
      rate_usd: rate,
      local_amount: localAmount,
      local_currency: localCcy,
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
      status: "active",
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Product added");
    nav("/experiences");
  };

  return (
    <div className="p-4 max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Add product</h1>
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
            <Select value={f.category} onValueChange={(v) => set("category", v)}>
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
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label>Brief description *</Label>
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
        <div className="flex items-center gap-2.5 pt-1">
          <Switch checked={f.bookable} onCheckedChange={(v) => set("bookable", v)} id="bk" />
          <Label htmlFor="bk">Bookable on the Mad Monkey website</Label>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add product"}</Button>
          <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { CATEGORY_LABELS, type Category } from "@/lib/types";
import { daysLabel } from "@/lib/format";
import { timeSpan } from "@/lib/clash";
import { DaysPicker } from "@/components/app/DaysPicker";
import { Tip } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Globe, Check, X, Pencil, Link2, ExternalLink } from "lucide-react";

interface PendingEvent {
  id: string; title: string; category: Category; event_date: string | null; expires_on: string | null; days_of_week: number[];
  starts_at: string | null; ends_at: string | null; rate_usd: number | null; brief_description: string | null; long_description: string | null;
  inclusions: string | null; things_to_bring: string | null; photo_album_url: string | null; notes: string | null; asset_urls: string[];
}
type Overrides = Record<string, unknown>;
const fmtDate = (d: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

/** D + phase 2 / GE2: what a GM sees — global events waiting for this hostel's answer. Click one to see everything and adjust it before accepting. */
export function PendingGlobalEvents() {
  const auth = useAuth();
  const qc = useQueryClient();
  const locId = auth.currentLocation?.id;
  const [openId, setOpenId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["pending-global", locId],
    enabled: !!locId,
    queryFn: async () => {
      const { data } = await supabase.from("global_event_responses")
        .select("global_event_id, status, global_events(id, title, category, event_date, expires_on, days_of_week, starts_at, ends_at, rate_usd, brief_description, long_description, inclusions, things_to_bring, photo_album_url, notes, asset_urls)")
        .eq("location_id", locId!).eq("status", "pending");
      return (data ?? []) as unknown as { global_event_id: string; global_events: PendingEvent }[];
    },
  });

  const respond = useMutation({
    mutationFn: async ({ eventId, status, overrides }: { eventId: string; status: "accepted" | "declined"; overrides?: Overrides }) => {
      const { error } = await supabase.rpc("respond_global_event", { p_event: eventId, p_location: locId, p_status: status, p_overrides: overrides ?? null });
      if (error) throw error;
      return { status, changed: !!overrides && Object.keys(overrides).length > 0 };
    },
    onSuccess: ({ status, changed }) => {
      qc.invalidateQueries({ queryKey: ["pending-global"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["my-week"] });
      setOpenId(null);
      toast.success(status === "accepted" ? (changed ? "Accepted with your changes — it's now in your product list" : "Accepted — it's now in your product list") : "Declined");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data?.length || !auth.isEditor) return null;
  const openEvent = data.find((r) => r.global_events.id === openId)?.global_events ?? null;

  return (
    <div className="rounded-lg border border-[hsl(var(--st-signature))]/40 bg-[hsl(var(--st-signature))]/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium"><Globe className="h-4 w-4" /> {data.length} global event{data.length === 1 ? "" : "s"} waiting for your answer <span className="text-xs text-muted-foreground font-normal">· click one to see everything and change details before accepting</span></div>
      {data.map((r) => {
        const e = r.global_events;
        return (
          <div key={r.global_event_id} className="flex items-start justify-between gap-3 bg-background rounded-md border px-3 py-2">
            <button className="min-w-0 text-sm text-left flex-1 hover:underline underline-offset-2" onClick={() => setOpenId(e.id)} title="Open — full details, assets, and edit before you accept">
              <div className="font-medium">{e.title}
                <span className="text-muted-foreground font-normal text-xs">
                  {e.event_date ? ` · ${fmtDate(e.event_date)}` : e.days_of_week?.length ? ` · ${daysLabel(e.days_of_week)}` : ""}{timeSpan(e) ? ` · ${timeSpan(e)}` : ""}{e.rate_usd != null ? ` · $${e.rate_usd}` : ""}
                </span>
              </div>
              {e.brief_description && <div className="text-muted-foreground text-xs">{e.brief_description}</div>}
              {e.notes && <div className="text-xs mt-0.5 italic">{e.notes}</div>}
            </button>
            <div className="flex gap-1 shrink-0">
              <Tip label="Open the details and change anything that's different at your hostel (rate, time, days…) before accepting"><Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setOpenId(e.id)}><Pencil className="h-3.5 w-3.5" /> Edit</Button></Tip>
              <Button size="sm" className="h-8 gap-1" title="Adds it to your product list right away, exactly as head office sent it" disabled={respond.isPending} onClick={() => respond.mutate({ eventId: e.id, status: "accepted" })}><Check className="h-3.5 w-3.5" /> Accept</Button>
              <Button size="sm" variant="outline" className="h-8 gap-1" title="Not running this at your hostel. Head office sees who declined." disabled={respond.isPending} onClick={() => respond.mutate({ eventId: e.id, status: "declined" })}><X className="h-3.5 w-3.5" /> Decline</Button>
            </div>
          </div>
        );
      })}
      {openEvent && (
        <EventDialog key={openEvent.id} ev={openEvent} busy={respond.isPending} onClose={() => setOpenId(null)}
          onAccept={(overrides) => respond.mutate({ eventId: openEvent.id, status: "accepted", overrides })}
          onDecline={() => respond.mutate({ eventId: openEvent.id, status: "declined" })} />
      )}
    </div>
  );
}

/** GE2: everything head office sent, editable, with "accept with these details". Only what you changed is sent as an override. */
function EventDialog({ ev, busy, onClose, onAccept, onDecline }: { ev: PendingEvent; busy: boolean; onClose: () => void; onAccept: (o: Overrides) => void; onDecline: () => void }) {
  const oneTime = ev.category === "one_time_event";
  const init = {
    title: ev.title, rate: ev.rate_usd != null ? String(ev.rate_usd) : "", event_date: ev.event_date ?? "", expires_on: ev.expires_on ?? "",
    days: ev.days_of_week ?? [], starts: ev.starts_at?.slice(0, 5) ?? "", ends: ev.ends_at?.slice(0, 5) ?? "",
    brief: ev.brief_description ?? "", long: ev.long_description ?? "", inclusions: ev.inclusions ?? "", bring: ev.things_to_bring ?? "",
  };
  const [f, setF] = useState(init);
  const set = <K extends keyof typeof init>(k: K, v: (typeof init)[K]) => setF((s) => ({ ...s, [k]: v }));
  const changed = (k: keyof typeof init) => JSON.stringify(f[k]) !== JSON.stringify(init[k]);
  const changedKeys = (Object.keys(init) as (keyof typeof init)[]).filter(changed);

  const accept = () => {
    if (!f.title.trim()) return toast.error("Title is required");
    if (f.brief.length > 95) return toast.error("Brief description must be 95 characters or fewer");
    if (f.rate.trim() !== "" && !isFinite(Number(f.rate))) return toast.error("Rate must be a number");
    if (oneTime && !f.event_date) return toast.error("A one-time event needs a date");
    const o: Overrides = {};
    if (changed("title")) o.title = f.title.trim();
    if (changed("rate")) o.rate_usd = f.rate.trim() === "" ? null : Number(f.rate);
    if (changed("event_date")) o.event_date = f.event_date || null;
    if (changed("expires_on")) o.expires_on = f.expires_on || null;
    if (changed("days")) o.days_of_week = f.days;
    if (changed("starts")) o.starts_at = f.starts || null;
    if (changed("ends")) o.ends_at = f.ends || null;
    if (changed("brief")) o.brief_description = f.brief.trim();
    if (changed("long")) o.long_description = f.long.trim();
    if (changed("inclusions")) o.inclusions = f.inclusions.trim();
    if (changed("bring")) o.things_to_bring = f.bring.trim();
    onAccept(o);
  };
  const L = ({ children, k }: { children: React.ReactNode; k?: keyof typeof init }) => (
    <Label className="text-xs text-muted-foreground uppercase tracking-wide">{children}{k && changed(k) && <span className="ml-1 normal-case tracking-normal text-[hsl(var(--st-pending))]">· changed</span>}</Label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /> {ev.title} <span className="text-xs font-normal text-muted-foreground">· {CATEGORY_LABELS[ev.category]}</span></DialogTitle></DialogHeader>
        {ev.notes && <div className="rounded-md bg-secondary px-3 py-2 text-sm"><span className="text-xs text-muted-foreground uppercase tracking-wide block">Message from head office</span>{ev.notes}</div>}
        <p className="text-xs text-muted-foreground">These are the details head office sent. Change anything that's different at your hostel, then accept. Only what you change is recorded as a change.</p>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="space-y-1 col-span-2"><L k="title">Title</L><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="space-y-1"><L k="rate">Rate (USD)</L><Input inputMode="decimal" placeholder="each hostel sets it" value={f.rate} onChange={(e) => set("rate", e.target.value)} /></div>
          {oneTime ? (
            <>
              <div className="space-y-1"><L k="event_date">Event date</L><Input type="date" value={f.event_date} onChange={(e) => set("event_date", e.target.value)} /></div>
              <div className="space-y-1"><L k="expires_on">Expires on</L><Input type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} /></div>
            </>
          ) : (
            <div className="space-y-1"><L k="days">Days it runs</L><div><DaysPicker value={f.days} onChange={(d) => set("days", d)} /></div></div>
          )}
          <div className="space-y-1"><L k="starts">Start</L><Input type="time" value={f.starts} onChange={(e) => set("starts", e.target.value)} /></div>
          <div className="space-y-1"><L k="ends">Finish</L><Input type="time" value={f.ends} onChange={(e) => set("ends", e.target.value)} /></div>
          <div className="space-y-1 col-span-2">
            <div className="flex justify-between"><L k="brief">Brief description</L><span className={`text-[11px] ${f.brief.length > 95 ? "text-destructive" : "text-muted-foreground"}`}>{f.brief.length}/95</span></div>
            <Textarea rows={2} maxLength={95} value={f.brief} onChange={(e) => set("brief", e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2"><L k="long">Long description</L><Textarea rows={3} value={f.long} onChange={(e) => set("long", e.target.value)} /></div>
          <div className="space-y-1"><L k="inclusions">Inclusions</L><Textarea rows={2} value={f.inclusions} onChange={(e) => set("inclusions", e.target.value)} /></div>
          <div className="space-y-1"><L k="bring">Things to bring</L><Textarea rows={2} value={f.bring} onChange={(e) => set("bring", e.target.value)} /></div>
          {(ev.asset_urls?.length > 0 || ev.photo_album_url) && (
            <div className="space-y-1 col-span-2">
              <L>Assets from head office</L>
              <div className="text-sm space-y-1">
                {ev.asset_urls?.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline underline-offset-2 truncate"><Link2 className="h-3 w-3 shrink-0" /> Asset {i + 1} <span className="text-muted-foreground text-xs truncate">{u}</span></a>)}
                {ev.photo_album_url && <a href={ev.photo_album_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline underline-offset-2 truncate"><ExternalLink className="h-3 w-3 shrink-0" /> Photo album</a>}
              </div>
              <p className="text-[11px] text-muted-foreground">Attached to the product's Asset column when you accept.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">{changedKeys.length ? `${changedKeys.length} change${changedKeys.length === 1 ? "" : "s"} — head office will see what you changed` : "No changes — accepts exactly as sent"}</span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={busy} onClick={onDecline} title="Not running this at your hostel"><X className="h-3.5 w-3.5" /> Decline</Button>
            <Button size="sm" disabled={busy} onClick={accept} title="Creates the product at your hostel with these details"><Check className="h-3.5 w-3.5" /> {changedKeys.length ? "Accept with these details" : "Accept"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

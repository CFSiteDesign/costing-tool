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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Globe, Mail, Link2, ExternalLink, Pencil } from "lucide-react";

export interface GEvent {
  id: string; title: string; category: Category; event_date: string | null; expires_on: string | null; days_of_week: number[];
  starts_at: string | null; ends_at: string | null; duration_minutes: number | null; rate_usd: number | null;
  brief_description: string | null; long_description: string | null; inclusions: string | null; things_to_bring: string | null;
  photo_album_url: string | null; bookable_on_website: boolean; notes: string | null; asset_urls: string[];
  notified_at: string | null; notify_result: { recipients: number; sent: number; wouldSend: number; failed: number; noResendKey: boolean } | null; created_at: string;
}
interface Resp { global_event_id: string; location_id: string; status: "pending" | "accepted" | "declined"; responded_at: string | null; overrides: Record<string, unknown> | null; }

const COLOR: Record<Resp["status"], string> = { accepted: "--st-active", declined: "--st-remove", pending: "--st-pending" };
const OVERRIDE_LABEL: Record<string, string> = {
  title: "name", rate_usd: "rate", local_amount: "local price", starts_at: "start", ends_at: "finish", days_of_week: "days", event_date: "date",
  expires_on: "expiry", brief_description: "brief", long_description: "description", inclusions: "inclusions", things_to_bring: "things to bring",
};
const fmtDate = (d: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

/** GE3: what happened to the GM email. */
export function emailStatus(ev: GEvent): { text: string; warn: boolean } {
  const r = ev.notify_result;
  if (!r) {
    if (ev.notified_at) return { text: "GMs emailed", warn: false };
    const fresh = Date.now() - new Date(ev.created_at).getTime() < 2 * 60_000;
    return fresh ? { text: "GM email queued", warn: false } : { text: "No GM email — launched before GM emails were added", warn: true };
  }
  if (r.noResendKey) return { text: `GM email not sent — email sending isn't switched on yet (${r.recipients} GM${r.recipients === 1 ? "" : "s"} would get it)`, warn: true };
  if (r.failed) return { text: `Emailed ${r.sent} of ${r.recipients} GMs · ${r.failed} failed`, warn: true };
  return { text: `Emailed ${r.sent} GM${r.sent === 1 ? "" : "s"}`, warn: false };
}

const EMPTY_ASSETS = ["", "", "", "", "", ""];

/** Round 2 / D + phase 2: add once at global level, push to every GM, see who said what — and click any event for the full picture. */
export default function GlobalEvents() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GEvent | null>(null);
  const [f, setF] = useState({ title: "", category: "one_time_event" as Category, event_date: "", expires_on: "", days: [] as number[],
    starts: "", ends: "", rate: "", brief: "", long: "", inclusions: "", bring: "", photo: "", website: false, notes: "", assets: [...EMPTY_ASSETS] });
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const setAsset = (i: number, v: string) => setF((s) => ({ ...s, assets: s.assets.map((a, j) => (j === i ? v : a)) }));

  const { data } = useQuery({
    queryKey: ["global-events"],
    queryFn: async () => {
      const [{ data: events }, { data: responses }] = await Promise.all([
        supabase.from("global_events").select("*").order("created_at", { ascending: false }),
        supabase.from("global_event_responses").select("*"),
      ]);
      return { events: (events ?? []) as GEvent[], responses: (responses ?? []) as Resp[] };
    },
    refetchInterval: view ? 10_000 : false,   // keep the email status fresh while an event is open
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error("Title is required");
      if (f.brief.length > 95) throw new Error("Brief description must be 95 characters or fewer");
      if (f.category === "one_time_event" && !f.event_date) throw new Error("A one-time event needs a date");
      const assets = f.assets.map((a) => a.trim()).filter(Boolean);
      const badAsset = assets.find((a) => !/^https?:\/\//i.test(a));
      if (badAsset) throw new Error(`Asset link "${badAsset.slice(0, 30)}" must start with http:// or https://`);
      const { data: me } = await supabase.auth.getUser();
      const { error } = await supabase.from("global_events").insert({
        title: f.title.trim(), category: f.category,
        event_date: f.event_date || null,
        expires_on: f.expires_on || f.event_date || null,
        days_of_week: f.category === "one_time_event" ? [] : f.days,
        starts_at: f.starts || null, ends_at: f.ends || null,
        rate_usd: f.rate.trim() === "" ? null : Number(f.rate),
        brief_description: f.brief.trim() || null, long_description: f.long.trim() || null,
        inclusions: f.inclusions.trim() || null, things_to_bring: f.bring.trim() || null,
        photo_album_url: f.photo.trim() || null, bookable_on_website: f.website, notes: f.notes.trim() || null,
        asset_urls: assets,
        created_by: me.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["global-events"] }); setOpen(false);
      setF({ title: "", category: "one_time_event", event_date: "", expires_on: "", days: [], starts: "", ends: "", rate: "", brief: "", long: "", inclusions: "", bring: "", photo: "", website: false, notes: "", assets: [...EMPTY_ASSETS] });
      toast.success("Sent to every hostel — GMs are being emailed");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["global-events"] }), 4000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const locName = (id: string) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";
  const responsesFor = (id: string) => (data?.responses ?? []).filter((r) => r.global_event_id === id).sort((a, b) => locName(a.location_id).localeCompare(locName(b.location_id)));
  const summary = (id: string) => {
    const rs = responsesFor(id);
    return { accepted: rs.filter((r) => r.status === "accepted"), declined: rs.filter((r) => r.status === "declined"), pending: rs.filter((r) => r.status === "pending") };
  };
  const changedList = (o: Record<string, unknown> | null) => o ? Object.keys(o).map((k) => OVERRIDE_LABEL[k] ?? k).join(", ") : "";

  const Chip = ({ r }: { r: Resp }) => (
    <Tip label={r.status === "accepted" ? (r.overrides ? `Accepted with changes: ${changedList(r.overrides)}` : "Accepted as sent — product created at this hostel") : r.status === "declined" ? "Declined — not running it" : "No reply yet"}>
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs cursor-help"
        style={{ color: `hsl(var(${COLOR[r.status]}))`, borderColor: `hsl(var(${COLOR[r.status]}) / 0.4)`, background: `hsl(var(${COLOR[r.status]}) / 0.08)` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(var(${COLOR[r.status]}))` }} />
        {locName(r.location_id)}{r.overrides && <Pencil className="h-3 w-3" />}
      </span>
    </Tip>
  );

  return (
    <div className="p-4 space-y-3 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Global events</h1>
          <p className="text-sm text-muted-foreground">Add once, and every hostel gets it to accept or decline. Accepting creates the product at that hostel. Click an event for the full picture.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="gap-1.5" title="Add once — every hostel gets it to accept or decline, and every GM gets an email. Accepting creates the product at that hostel."><Plus className="h-4 w-4" /> New global event</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New global event</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <div className="space-y-1.5 col-span-2"><Label>Title *</Label><Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Tequila Day 2027" /></div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={f.category} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CATEGORY_LABELS).filter(([k]) => k !== "transport").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Rate (USD, blank = each hostel sets it)</Label><Input inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} /></div>
              {f.category === "one_time_event" ? (
                <>
                  <div className="space-y-1.5"><Label>Event date *</Label><Input type="date" value={f.event_date} onChange={(e) => set("event_date", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Expires on (defaults to event date)</Label><Input type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} /></div>
                </>
              ) : (
                <div className="space-y-1.5 col-span-2"><Label>Days it runs</Label><div><DaysPicker value={f.days} onChange={(d) => set("days", d)} /></div></div>
              )}
              <div className="space-y-1.5"><Label>Start</Label><Input type="time" value={f.starts} onChange={(e) => set("starts", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Finish</Label><Input type="time" value={f.ends} onChange={(e) => set("ends", e.target.value)} /></div>
              <div className="space-y-1.5 col-span-2">
                <div className="flex justify-between"><Label>Brief description</Label><span className={`text-[11px] ${f.brief.length > 95 ? "text-destructive" : "text-muted-foreground"}`}>{f.brief.length}/95</span></div>
                <Textarea rows={2} maxLength={95} value={f.brief} onChange={(e) => set("brief", e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2"><Label>Long description</Label><Textarea rows={3} value={f.long} onChange={(e) => set("long", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Inclusions</Label><Textarea rows={2} value={f.inclusions} onChange={(e) => set("inclusions", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Things to bring</Label><Textarea rows={2} value={f.bring} onChange={(e) => set("bring", e.target.value)} /></div>
              <div className="space-y-1.5 col-span-2"><Label>Photo album URL</Label><Input value={f.photo} onChange={(e) => set("photo", e.target.value)} /></div>

              {/* phase 2 / GE1: one box per asset link, up to six */}
              <div className="space-y-1.5 col-span-2">
                <Tip label="Links to the artwork for this event (Drive, Dropbox, STUDIO…), one per box. Every hostel that accepts gets them attached to the product's Asset column."><Label className="cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">Assets (up to 6 links)</Label></Tip>
                <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                  {f.assets.map((a, i) => (
                    <div key={i} className="relative">
                      <span className="absolute left-2.5 top-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                      <Input className="pl-7" placeholder={`Asset ${i + 1} link`} value={a} onChange={(e) => setAsset(i, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 col-span-2"><Label>Message to GMs</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Why we're running it, what's expected, deadline to respond…" /></div>
              <label className="flex items-center gap-2 text-sm col-span-2"><Switch checked={f.website} onCheckedChange={(v) => set("website", v)} /> Bookable on the website once accepted</label>
              <Tip label={`Creates the event, puts it on every GM's dashboard to accept, edit or decline, and emails each GM.`}><Button className="col-span-2 w-full" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Sending…" : `Send to all ${auth.allLocations.length} hostels`}</Button></Tip>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {(data?.events ?? []).length === 0 && <div className="border rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">No global events yet.</div>}
        {(data?.events ?? []).map((ev) => {
          const s = summary(ev.id); const em = emailStatus(ev);
          return (
            <button key={ev.id} className="w-full text-left border rounded-lg px-4 py-3 hover:bg-secondary/40 flex items-center justify-between gap-3 flex-wrap" onClick={() => setView(ev)} title="Open — full details, assets, who has answered">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{ev.title}</span>
                  <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[ev.category]}{ev.event_date ? ` · ${fmtDate(ev.event_date)}` : ev.days_of_week?.length ? ` · ${daysLabel(ev.days_of_week)}` : ""}{ev.rate_usd != null ? ` · $${ev.rate_usd}` : ""}</span>
                </div>
                <div className={`text-xs mt-0.5 flex items-center gap-1 ${em.warn ? "text-[hsl(var(--st-pending))]" : "text-muted-foreground"}`}><Mail className="h-3 w-3" /> {em.text}{ev.asset_urls?.length ? ` · ${ev.asset_urls.length} asset${ev.asset_urls.length === 1 ? "" : "s"}` : ""}</div>
              </div>
              <div className="flex gap-3 text-xs font-medium tabular-nums" title="Accepted = product created at that hostel. Declined = they passed. No reply = still waiting.">
                <span style={{ color: "hsl(var(--st-active))" }}>{s.accepted.length} accepted</span>
                <span style={{ color: "hsl(var(--st-remove))" }}>{s.declined.length} declined</span>
                <span style={{ color: "hsl(var(--st-pending))" }}>{s.pending.length} no reply</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* phase 2 / GE4: the full picture after launch */}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {view && (() => {
            const ev = data?.events.find((e) => e.id === view.id) ?? view;
            const s = summary(ev.id); const em = emailStatus(ev); const rs = responsesFor(ev.id);
            const Row = ({ k, v }: { k: string; v: React.ReactNode }) => v ? <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm"><span className="text-muted-foreground">{k}</span><span className="whitespace-pre-wrap">{v}</span></div> : null;
            return (
              <>
                <DialogHeader><DialogTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /> {ev.title}</DialogTitle></DialogHeader>
                <div className="space-y-1.5">
                  <Row k="Category" v={CATEGORY_LABELS[ev.category]} />
                  <Row k={ev.event_date ? "Date" : "Days"} v={ev.event_date ? fmtDate(ev.event_date) : daysLabel(ev.days_of_week ?? [])} />
                  <Row k="Time" v={timeSpan(ev) || null} />
                  <Row k="Rate" v={ev.rate_usd != null ? `$${ev.rate_usd} USD` : "Each hostel sets it"} />
                  <Row k="Expires" v={fmtDate(ev.expires_on)} />
                  <Row k="Brief" v={ev.brief_description} />
                  <Row k="Description" v={ev.long_description} />
                  <Row k="Inclusions" v={ev.inclusions} />
                  <Row k="Things to bring" v={ev.things_to_bring} />
                  <Row k="Photo album" v={ev.photo_album_url ? <a className="underline underline-offset-2 inline-flex items-center gap-1" href={ev.photo_album_url} target="_blank" rel="noreferrer">{ev.photo_album_url} <ExternalLink className="h-3 w-3" /></a> : null} />
                  <Row k="Website" v={ev.bookable_on_website ? "Bookable once accepted" : "Not on the website"} />
                  <Row k="Message to GMs" v={ev.notes} />
                  <Row k="Assets" v={ev.asset_urls?.length ? (
                    <div className="space-y-1">{ev.asset_urls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline underline-offset-2 truncate"><Link2 className="h-3 w-3 shrink-0" /> Asset {i + 1} <span className="text-muted-foreground text-xs truncate">{u}</span></a>)}</div>
                  ) : null} />
                  <Row k="GM email" v={<span className={em.warn ? "text-[hsl(var(--st-pending))]" : ""}>{em.text}{ev.notified_at ? ` · ${new Date(ev.notified_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}</span>} />
                  <Row k="Launched" v={new Date(ev.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} />
                </div>
                <div className="border-t pt-3 space-y-2">
                  <div className="flex gap-3 text-xs font-medium tabular-nums">
                    <span style={{ color: "hsl(var(--st-active))" }}>{s.accepted.length} accepted</span>
                    <span style={{ color: "hsl(var(--st-remove))" }}>{s.declined.length} declined</span>
                    <span style={{ color: "hsl(var(--st-pending))" }}>{s.pending.length} no reply</span>
                    <span className="text-muted-foreground font-normal">· a pencil means the GM changed details before accepting — hover to see what</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">{rs.map((r) => <Chip key={r.location_id} r={r} />)}</div>
                  {rs.some((r) => r.overrides) && (
                    <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                      {rs.filter((r) => r.overrides).map((r) => <div key={r.location_id}><span className="font-medium text-foreground">{locName(r.location_id)}</span> changed {changedList(r.overrides)}: {Object.entries(r.overrides!).map(([k, v]) => `${OVERRIDE_LABEL[k] ?? k} → ${Array.isArray(v) ? daysLabel(v as number[]) : String(v)}`).join("; ")}</div>)}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

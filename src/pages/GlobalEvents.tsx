import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Globe } from "lucide-react";

interface GEvent { id: string; title: string; category: Category; event_date: string | null; expires_on: string | null; rate_usd: number | null; notes: string | null; created_at: string; }
interface Resp { global_event_id: string; location_id: string; status: "pending" | "accepted" | "declined"; responded_at: string | null; }

const COLOR: Record<Resp["status"], string> = { accepted: "--st-active", declined: "--st-remove", pending: "--st-pending" };

/** Round 2 / D: add once at global level, push to every GM, see who said what. */
export default function GlobalEvents() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", category: "one_time_event" as Category, event_date: "", expires_on: "", days: [] as number[],
    starts: "", ends: "", rate: "", brief: "", long: "", inclusions: "", bring: "", photo: "", website: false, notes: "" });
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  const { data } = useQuery({
    queryKey: ["global-events"],
    queryFn: async () => {
      const [{ data: events }, { data: responses }] = await Promise.all([
        supabase.from("global_events").select("*").order("created_at", { ascending: false }),
        supabase.from("global_event_responses").select("*"),
      ]);
      return { events: (events ?? []) as GEvent[], responses: (responses ?? []) as Resp[] };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error("Title is required");
      if (f.brief.length > 95) throw new Error("Brief description must be 95 characters or fewer");
      if (f.category === "one_time_event" && !f.event_date) throw new Error("A one-time event needs a date");
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
        created_by: me.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["global-events"] }); setOpen(false); toast.success("Sent to every hostel"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const locName = (id: string) => auth.allLocations.find((l) => l.id === id)?.name ?? "—";
  const summary = (id: string) => {
    const rs = (data?.responses ?? []).filter((r) => r.global_event_id === id);
    return { accepted: rs.filter((r) => r.status === "accepted"), declined: rs.filter((r) => r.status === "declined"), pending: rs.filter((r) => r.status === "pending") };
  };

  return (
    <div className="p-4 space-y-3 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Global events</h1>
          <p className="text-sm text-muted-foreground">Add once, and every hostel gets it to accept or decline. Accepting creates the product at that hostel.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> New global event</Button></DialogTrigger>
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
              <div className="space-y-1.5 col-span-2"><Label>Message to GMs</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Why we're running it, what's expected, deadline to respond…" /></div>
              <label className="flex items-center gap-2 text-sm col-span-2"><Switch checked={f.website} onCheckedChange={(v) => set("website", v)} /> Bookable on the website once accepted</label>
              <Button className="col-span-2" disabled={create.isPending} onClick={() => create.mutate()}>Send to all {auth.allLocations.length} hostels</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {(data?.events ?? []).length === 0 && <div className="border rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">No global events yet.</div>}
        {(data?.events ?? []).map((ev) => {
          const s = summary(ev.id);
          return (
            <details key={ev.id} className="border rounded-lg">
              <summary className="px-4 py-3 cursor-pointer flex items-center justify-between gap-3 flex-wrap list-none">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{ev.title}</span>
                  <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[ev.category]}{ev.event_date ? ` · ${new Date(ev.event_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}{ev.rate_usd != null ? ` · $${ev.rate_usd}` : ""}</span>
                </div>
                <div className="flex gap-3 text-xs font-medium tabular-nums">
                  <span style={{ color: "hsl(var(--st-active))" }}>{s.accepted.length} accepted</span>
                  <span style={{ color: "hsl(var(--st-remove))" }}>{s.declined.length} declined</span>
                  <span style={{ color: "hsl(var(--st-pending))" }}>{s.pending.length} no reply</span>
                </div>
              </summary>
              <div className="px-4 pb-3 border-t pt-3">
                {ev.notes && <p className="text-sm text-muted-foreground mb-2">{ev.notes}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {(data?.responses ?? []).filter((r) => r.global_event_id === ev.id)
                    .sort((a, b) => locName(a.location_id).localeCompare(locName(b.location_id)))
                    .map((r) => (
                      <span key={r.location_id} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                        style={{ color: `hsl(var(${COLOR[r.status]}))`, borderColor: `hsl(var(${COLOR[r.status]}) / 0.4)`, background: `hsl(var(${COLOR[r.status]}) / 0.08)` }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(var(${COLOR[r.status]}))` }} />
                        {locName(r.location_id)}
                      </span>
                    ))}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { emptyDoc, newBlock, type ItineraryBlock, type ItineraryDay, type ItineraryDoc } from "@/lib/itinerary";
import { Tip } from "@/components/app/Tip";
import { holdUnsaved } from "@/lib/unsaved";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { friendlyAiError, invokeErrorMessage } from "@/lib/aiErrors";
import { ArrowLeft, Sparkles, Save, Link2, ExternalLink, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, X, AlertTriangle, RefreshCw, Check } from "lucide-react";
import { asset, appUrl } from "@/lib/paths";

interface Row { quote_id: string; doc: ItineraryDoc; share_slug: string; model: string | null; generated_at: string | null; updated_at: string; generation_meta: { usage?: Record<string, number>; ms?: number } | null }
const lines = (a: string[]) => a.join("\n");
const unlines = (s: string) => s.split("\n").map((x) => x.replace(/^\s*[-•]\s*/, "")).filter((x) => x.trim() !== "");

/** The editor: reads like the finished document, every field editable, Claude writes the first draft. */
export default function ItineraryEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [doc, setDoc] = useState<ItineraryDoc | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);

  const { data: row, isLoading } = useQuery({
    queryKey: ["itinerary-row", id],
    queryFn: async () => (await supabase.from("quote_itineraries").select("*").eq("quote_id", id!).maybeSingle()).data as Row | null,
  });
  const { data: quote } = useQuery({ queryKey: ["quote-head", id], queryFn: async () => (await supabase.from("quotes").select("title, reference, pax_count").eq("id", id!).single()).data });
  useEffect(() => { if (row && doc === null) { setDoc(row.doc?.days ? row.doc : null); setSaved(JSON.stringify(row.doc ?? {})); } }, [row, doc]);

  const dirty = doc != null && JSON.stringify(doc) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    const release = holdUnsaved();   // so replaying the tour asks first
    return () => { window.removeEventListener("beforeunload", h); release(); };
  }, [dirty]);

  const startTimer = () => { setElapsed(0); timer.current = window.setInterval(() => setElapsed((s) => s + 1), 1000); };
  const stopTimer = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; };

  const generate = useMutation({
    mutationFn: async () => {
      startTimer();
      const { data, error } = await supabase.functions.invoke("itinerary-generate", { body: { quote_id: id, mode: "full" } });
      if (error) {
        const msg = await invokeErrorMessage(error);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data as { doc: ItineraryDoc; usage: Record<string, number>; ms: number; model: string };
    },
    onSuccess: (d) => { stopTimer(); setDoc(d.doc); setSaved(JSON.stringify(d.doc)); qc.invalidateQueries({ queryKey: ["itinerary-row", id] }); toast.success(`Written in ${Math.round(d.ms / 1000)}s. Read it through and fix anything that's off.`); },
    onError: (e: Error) => { stopTimer(); toast.error(friendlyAiError(e.message) ?? e.message); },
  });
  const rewriteDay = useMutation({
    mutationFn: async ({ day_no, instruction }: { day_no: number; instruction: string }) => {
      const { data, error } = await supabase.functions.invoke("itinerary-generate", { body: { quote_id: id, mode: "day", day_no, instruction } });
      if (error) throw new Error(await invokeErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data as { doc: ItineraryDoc };
    },
    onSuccess: (d) => { setDoc(d.doc); setSaved(JSON.stringify(d.doc)); toast.success("Day rewritten"); },
    onError: (e: Error) => toast.error(friendlyAiError(e.message) ?? e.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const { data: me } = await supabase.auth.getUser();
      const { error } = await supabase.from("quote_itineraries").upsert({ quote_id: id, doc, updated_by: me.user?.id }, { onConflict: "quote_id" });
      if (error) throw error;
    },
    onSuccess: () => { setSaved(JSON.stringify(doc)); setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); qc.invalidateQueries({ queryKey: ["itinerary-row", id] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(`Not saved: ${e.message}`),
  });

  // ── edit helpers ──
  const patchDoc = (p: Partial<ItineraryDoc>) => setDoc((d) => d ? { ...d, ...p } : d);
  const patchDay = (dayNo: number, p: Partial<ItineraryDay>) => setDoc((d) => d ? { ...d, days: d.days.map((x) => x.day_no === dayNo ? { ...x, ...p } : x) } : d);
  const patchBlock = (dayNo: number, bid: string, p: Partial<ItineraryBlock>) => setDoc((d) => d ? { ...d, days: d.days.map((x) => x.day_no === dayNo ? { ...x, blocks: x.blocks.map((b) => b.id === bid ? { ...b, ...p } : b) } : x) } : d);
  const moveBlock = (dayNo: number, bid: string, dir: -1 | 1) => setDoc((d) => {
    if (!d) return d;
    return { ...d, days: d.days.map((x) => {
      if (x.day_no !== dayNo) return x;
      const i = x.blocks.findIndex((b) => b.id === bid); const j = i + dir;
      if (i < 0 || j < 0 || j >= x.blocks.length) return x;
      const blocks = [...x.blocks]; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; return { ...x, blocks };
    }) };
  });
  const deleteBlock = (dayNo: number, bid: string) => setDoc((d) => d ? { ...d, days: d.days.map((x) => x.day_no === dayNo ? { ...x, blocks: x.blocks.filter((b) => b.id !== bid) } : x) } : d);
  const addBlock = (dayNo: number) => setDoc((d) => d ? { ...d, days: d.days.map((x) => x.day_no === dayNo ? { ...x, blocks: [...x.blocks, newBlock()] } : x) } : d);
  const uploadPhoto = async (dayNo: number, b: ItineraryBlock, file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${id}/${b.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("itinerary-photos").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("itinerary-photos").getPublicUrl(path);
    patchBlock(dayNo, b.id, { photo_url: data.publicUrl });
  };
  const shareUrl = row?.share_slug ? appUrl(`/it/${row.share_slug}`) : null;
  const flaggedCount = useMemo(() => (doc?.days ?? []).reduce((n, d) => n + d.blocks.filter((b) => b.flagged).length, 0), [doc]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-full bg-secondary/40">
      {/* toolbar */}
      <div className="sticky top-0 z-20 bg-background border-b px-4 py-2 flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return; nav(`/quotes/${id}`); }}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0">
          <div className="font-semibold leading-tight">Detailed itinerary <span className="text-muted-foreground font-normal">· {quote?.title}</span></div>
          <div className="text-[11px] text-muted-foreground">
            {row?.generated_at ? `Written by ${row.model ?? "Claude"} on ${new Date(row.generated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Not written yet"}
            {flaggedCount > 0 && <span className="ml-2 text-[hsl(var(--st-pending))]">{flaggedCount} thing{flaggedCount === 1 ? "" : "s"} to check</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {dirty ? <span className="text-xs text-[hsl(var(--st-pending))]">Unsaved changes</span> : savedAt ? <span className="text-xs text-[hsl(var(--st-active))] inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved {savedAt}</span> : null}
          <Tip label={doc ? "Throws the whole document away and writes it again from the quote. Your edits are lost." : "Claude writes the whole itinerary from this quote: every day, timed lines, inclusions, transfers."}>
            <Button size="sm" variant={doc ? "outline" : "default"} className="gap-1.5" disabled={generate.isPending} onClick={() => { if (doc && !window.confirm("Rewrite everything from the quote? Your edits will be lost.")) return; generate.mutate(); }}>
              <Sparkles className="h-4 w-4" /> {generate.isPending ? `Writing… ${elapsed}s` : doc ? "Rewrite all" : "Write the itinerary"}
            </Button>
          </Tip>
          {doc && <Tip label="Nothing changes until you press Save."><Button size="sm" className="gap-1.5" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save"}</Button></Tip>}
          {shareUrl && doc && (
            <>
              <Tip label="Copies the share link. Anyone with it can read the itinerary, nothing else."><Button size="sm" variant="outline" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); }}><Link2 className="h-4 w-4" /> Copy link</Button></Tip>
              <Tip label={dirty ? "Save first, the asset shows the saved version" : "Opens the finished asset. Print from there for the PDF."}><a href={shareUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="h-4 w-4" /> Open asset</Button></a></Tip>
            </>
          )}
        </div>
      </div>

      {!doc ? (
        <div className="max-w-2xl mx-auto my-16 text-center space-y-3 px-4">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-semibold">No itinerary yet for this quote</h2>
          <p className="text-sm text-muted-foreground">Claude writes the whole document from the quote: every day in order, timed lines, the activities' hour by hour steps, meeting points, inclusions and transfers, in the Mad Monkey voice. Times and names are checked against the quote afterwards and anything that doesn't match is marked for you. Then you edit whatever you like and add photos.</p>
          <Button className="gap-1.5" disabled={generate.isPending} onClick={() => generate.mutate()}><Sparkles className="h-4 w-4" /> {generate.isPending ? `Writing… ${elapsed}s` : "Write the itinerary"}</Button>
          {generate.isPending && <p className="text-xs text-muted-foreground">Usually under a minute. Every day is written at the same time.</p>}
        </div>
      ) : (
        <div className="max-w-[210mm] mx-auto my-4 bg-background border shadow-sm px-8 py-8 space-y-6">
          <div className="flex items-center justify-between"><img src={asset("mm-logo.png")} alt="Mad Monkey" className="h-10 w-auto" /><span className="text-[11px] text-muted-foreground uppercase tracking-wider">Detailed itinerary · {quote?.reference}</span></div>
          {doc.flags?.length > 0 && (
            <div className="rounded-md border border-[hsl(var(--st-pending))]/40 bg-[hsl(var(--st-pending))]/5 p-3 text-sm">
              <div className="font-medium flex items-center gap-1.5 mb-1"><AlertTriangle className="h-4 w-4 text-[hsl(var(--st-pending))]" /> Checks against the quote</div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">{doc.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              <button className="text-xs underline underline-offset-2 mt-1.5" onClick={() => patchDoc({ flags: [] })}>Clear these</button>
            </div>
          )}

          {/* header */}
          <div className="space-y-2">
            <Input className="text-2xl font-extrabold h-12 px-1 border-transparent hover:border-input focus:border-input" value={doc.title} onChange={(e) => patchDoc({ title: e.target.value })} placeholder="Trip title" />
            <Input className="font-medium text-muted-foreground px-1 border-transparent hover:border-input focus:border-input" value={doc.subtitle} onChange={(e) => patchDoc({ subtitle: e.target.value })} placeholder="Subtitle (nights, route)" />
            <div className="grid grid-cols-[6rem_1fr] gap-2 items-center text-sm">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">Nights</label><Input className="w-24" inputMode="numeric" value={doc.nights} onChange={(e) => patchDoc({ nights: Number(e.target.value) || 0 })} />
              <label className="text-xs text-muted-foreground uppercase tracking-wide">Route</label><Input value={doc.route.join(", ")} onChange={(e) => patchDoc({ route: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Hanoi, Ha Giang, Hanoi" />
            </div>
            <Field label="Intro" value={doc.intro} onChange={(v) => patchDoc({ intro: v })} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="Package inclusions (one per line)" value={lines(doc.inclusions)} onChange={(v) => patchDoc({ inclusions: unlines(v) })} rows={6} />
            <Field label="Not included (one per line)" value={lines(doc.not_included)} onChange={(v) => patchDoc({ not_included: unlines(v) })} rows={6} />
            <Field label="Optional extras (one per line)" value={lines(doc.optional_extras)} onChange={(v) => patchDoc({ optional_extras: unlines(v) })} rows={3} />
            <Field label="Transfers (one per line)" value={lines(doc.transfers)} onChange={(v) => patchDoc({ transfers: unlines(v) })} rows={3} />
          </div>

          {/* days */}
          {doc.days.map((d) => (
            <section key={d.day_no} className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-md bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-wider px-2 py-1">Day {d.day_no}</span>
                <Input className="flex-1 min-w-[12rem] text-lg font-bold h-9 px-1 border-transparent hover:border-input focus:border-input" value={d.title} onChange={(e) => patchDay(d.day_no, { title: e.target.value })} placeholder={d.hostel} />
                <Input type="date" className="w-40 h-9" value={d.date ?? ""} onChange={(e) => patchDay(d.day_no, { date: e.target.value || null })} />
                <Popover>
                  <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-9 gap-1.5" disabled={rewriteDay.isPending}><RefreshCw className="h-3.5 w-3.5" /> Rewrite day</Button></PopoverTrigger>
                  <PopoverContent className="w-80 space-y-2" align="end">
                    <p className="text-xs text-muted-foreground">Claude rewrites just this day from the quote. Say what you want different.</p>
                    <RewriteForm onSubmit={(instruction) => rewriteDay.mutate({ day_no: d.day_no, instruction })} busy={rewriteDay.isPending} />
                  </PopoverContent>
                </Popover>
              </div>
              <Field label="Intro" value={d.intro} onChange={(v) => patchDay(d.day_no, { intro: v })} rows={2} />
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="Today's highlights (multi-day tours, one per line)" value={lines(d.highlights ?? [])} onChange={(v) => patchDay(d.day_no, { highlights: unlines(v) })} rows={3} />
                <Field label="The vibe (multi-day tours)" value={d.vibe ?? ""} onChange={(v) => patchDay(d.day_no, { vibe: v })} rows={3} />
              </div>
              <div className="space-y-3">
                {d.blocks.map((b, i) => (
                  <div key={b.id} className={`rounded-md border p-3 space-y-2 ${b.flagged ? "border-[hsl(var(--st-pending))]/50 bg-[hsl(var(--st-pending))]/5" : ""}`}>
                    <div className="flex items-start gap-2">
                      <Input className="w-24 font-semibold tabular-nums" value={b.time} onChange={(e) => patchBlock(d.day_no, b.id, { time: e.target.value })} placeholder="7pm" />
                      <Input className="flex-1 font-semibold" value={b.title} onChange={(e) => patchBlock(d.day_no, b.id, { title: e.target.value })} placeholder="What happens" />
                      <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-9 w-8" disabled={i === 0} onClick={() => moveBlock(d.day_no, b.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-9 w-8" disabled={i === d.blocks.length - 1} onClick={() => moveBlock(d.day_no, b.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-9 w-8 text-muted-foreground" onClick={() => deleteBlock(d.day_no, b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    {b.flagged && <p className="text-xs text-[hsl(var(--st-pending))] flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {b.flagged} <button className="underline underline-offset-2 ml-1" onClick={() => patchBlock(d.day_no, b.id, { flagged: null })}>ok, checked</button></p>}
                    <div className="grid grid-cols-[1fr_9rem] gap-3 max-sm:grid-cols-1">
                      <div className="space-y-2">
                        <Field label="Body" value={b.body} onChange={(v) => patchBlock(d.day_no, b.id, { body: v })} rows={2} />
                        <Field label="Hour by hour (one per line)" value={lines(b.bullets)} onChange={(v) => patchBlock(d.day_no, b.id, { bullets: unlines(v) })} rows={Math.max(2, Math.min(8, b.bullets.length + 1))} />
                        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                          <Field label="Today's highlights (one per line)" value={lines(b.highlights)} onChange={(v) => patchBlock(d.day_no, b.id, { highlights: unlines(v) })} rows={3} />
                          <Field label="The vibe" value={b.vibe} onChange={(v) => patchBlock(d.day_no, b.id, { vibe: v })} rows={3} />
                        </div>
                      </div>
                      <PhotoSlot url={b.photo_url} onFile={(f) => uploadPhoto(d.day_no, b, f)} onUrl={(u) => patchBlock(d.day_no, b.id, { photo_url: u })} onClear={() => patchBlock(d.day_no, b.id, { photo_url: null })} />
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => addBlock(d.day_no)}><Plus className="h-3.5 w-3.5" /> Add a line</Button>
              </div>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase tracking-wide">Accommodation</label><Input value={d.accommodation} onChange={(e) => patchDay(d.day_no, { accommodation: e.target.value })} placeholder="Mad Monkey Hanoi, shared dorm" /></div>
                <Field label="Notes (one per line)" value={lines(d.notes)} onChange={(v) => patchDay(d.day_no, { notes: unlines(v) })} rows={2} />
              </div>
            </section>
          ))}
          <Field label="Closing" value={doc.closing} onChange={(v) => patchDoc({ closing: v })} rows={2} />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground uppercase tracking-wide">{label}</label>
      <Textarea rows={rows} className="text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function RewriteForm({ onSubmit, busy }: { onSubmit: (s: string) => void; busy: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-2">
      <Textarea rows={2} className="text-sm" placeholder="e.g. shorter, mention the pool, move the Meet Up later" value={v} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" className="w-full gap-1.5" disabled={busy} onClick={() => onSubmit(v)}><RefreshCw className="h-3.5 w-3.5" /> {busy ? "Rewriting…" : "Rewrite this day"}</Button>
    </div>
  );
}

function PhotoSlot({ url, onFile, onUrl, onClear }: { url: string | null; onFile: (f: File) => void; onUrl: (u: string) => void; onClear: () => void }) {
  const [pasting, setPasting] = useState(false); const [v, setV] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground uppercase tracking-wide">Photo</label>
      {url ? (
        <div className="relative"><img src={url} alt="" className="h-24 w-full object-cover rounded-md border" /><button className="absolute top-1 right-1 bg-background/90 rounded-full p-0.5 border" onClick={onClear} title="Remove photo"><X className="h-3.5 w-3.5" /></button></div>
      ) : (
        <div className="h-24 rounded-md border border-dashed grid place-items-center text-xs text-muted-foreground text-center px-2">
          {pasting ? (
            <div className="w-full space-y-1"><Input className="h-7 text-xs" placeholder="https://…" value={v} onChange={(e) => setV(e.target.value)} /><div className="flex gap-1"><Button size="sm" className="h-6 text-xs flex-1" onClick={() => { if (v.trim()) onUrl(v.trim()); setPasting(false); }}>Use</Button><Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPasting(false)}>Cancel</Button></div></div>
          ) : (
            <div className="space-y-1">
              <button className="inline-flex items-center gap-1 underline underline-offset-2" onClick={() => input.current?.click()}><ImagePlus className="h-3.5 w-3.5" /> Upload</button>
              <div>or <button className="underline underline-offset-2" onClick={() => setPasting(true)}>paste a link</button></div>
            </div>
          )}
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}

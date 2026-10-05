import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toPng } from "html-to-image";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { iso, mondayOf, parseIso, plus, storyTime, useWeek, type StoryDoc } from "@/lib/week";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/app/Tip";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, RotateCcw, Undo2, Send, Loader2 } from "lucide-react";

/**
 * Weekly story (Oct 2026): the week's key events as an Instagram story, always 1080 x 1920.
 * Mad Monkey core brand (design.madmonkeyhostels.com): Mad Black canvas, Montserrat only, lime + pink brights,
 * hard-offset shadow, one brand device (the ALL IN sticker), the official white wordmark bottom-right, never redrawn.
 */
const W = 1080, H = 1920;
const C = { black: "#0a0a0a", white: "#ffffff", lime: "#ccff01", pink: "#ff01aa" };
const DAY3 = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export default function WeeklyStory() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const weekStart = useMemo(() => { const w = params.get("week"); return w ? mondayOf(parseIso(w)) : mondayOf(new Date()); }, [params]);
  const loc = auth.currentLocation;
  const { days, keysFor, isLoading } = useWeek(loc?.id, weekStart);
  const weekKey = iso(weekStart);

  // the story built fresh from the key events
  const built: StoryDoc | null = useMemo(() => {
    if (isLoading || !loc) return null;
    return {
      eyebrow: `MAD MONKEY ${loc.name.toUpperCase()}`,
      headline: "THIS WEEK.",
      sticker: "ALL IN",
      days: days.map((d, i) => ({
        day: DAY3[i],
        date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
        items: keysFor(d).map((p) => ({ time: storyTime(p.starts_at), title: p.title.replace(/\s+/g, " ").toUpperCase() })),
      })).filter((d) => d.items.length > 0),
    };
  }, [isLoading, loc, days, keysFor]);

  // the GM's saved version for this week, if they have edited it
  const { data: saved, isFetched } = useQuery({
    queryKey: ["weekly-story", loc?.id, weekKey], enabled: !!loc,
    queryFn: async () => (await supabase.from("weekly_stories").select("doc, updated_at").eq("location_id", loc!.id).eq("week_start", weekKey).maybeSingle()).data,
  });
  const [doc, setDoc] = useState<StoryDoc | null>(null);
  const [history, setHistory] = useState<StoryDoc[]>([]);
  useEffect(() => { setDoc(null); setHistory([]); }, [loc?.id, weekKey]);
  useEffect(() => { if (doc === null && isFetched && built) setDoc((saved?.doc as StoryDoc) ?? built); }, [doc, isFetched, built, saved]);

  const persist = async (next: StoryDoc | null) => {
    if (!loc || !auth.isEditor) return;
    if (next) await supabase.from("weekly_stories").upsert({ location_id: loc.id, week_start: weekKey, doc: next, updated_at: new Date().toISOString() });
    else await supabase.from("weekly_stories").delete().eq("location_id", loc.id).eq("week_start", weekKey);
    qc.invalidateQueries({ queryKey: ["weekly-story", loc.id, weekKey] });
  };

  // quick text changes via the prompt box
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const apply = async () => {
    const instruction = text.trim(); if (!instruction || !doc || !loc || busy) return;
    setBusy(true); setReply(null);
    try {
      const { data, error } = await supabase.functions.invoke("story-edit", { body: { location_id: loc.id, doc, instruction } });
      if (error) throw new Error(error.message);
      if (data?.error && !data?.doc) throw new Error(data.reply || data.error);
      setReply(data.reply);
      if (data.changed) { setHistory((h) => [...h, doc]); setDoc(data.doc); setText(""); await persist(data.doc); }
    } catch (e) { setReply(`That didn't work, nothing changed. ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const undo = async () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setDoc(prev); await persist(prev); setReply("Undone."); };
  const rebuild = async () => { if (!built) return; if (doc) setHistory((h) => [...h, doc]); setDoc(built); await persist(null); setReply("Rebuilt from the key events on My week."); };

  // export at exactly 1080 x 1920
  const canvasRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    if (!canvasRef.current || !loc) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const url = await toPng(canvasRef.current, { width: W, height: H, pixelRatio: 1, cacheBust: true, style: { transform: "none" } });
      const a = document.createElement("a");
      a.href = url; a.download = `mad-monkey-${loc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-week-${weekKey}.png`; a.click();
    } catch (e) { toast.error(`Couldn't make the image: ${(e as Error).message}`); }
    finally { setExporting(false); }
  };

  // preview scale: fit the story in the window height
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.36);
  useLayoutEffect(() => {
    const fit = () => { const h = (boxRef.current?.clientHeight ?? 700) - 8; setScale(Math.max(0.2, Math.min(0.6, h / H))); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  const go = (n: number) => setParams({ week: iso(plus(weekStart, n)) });
  const empty = doc && doc.days.length === 0;

  return (
    <div className="p-4 h-[calc(100vh-3.5rem)] flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/week" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="text-xl font-semibold">Weekly story</h1>
          <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">Instagram story · 1080 × 1920</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Tip label="Previous week"><Button variant="outline" size="sm" className="h-8" onClick={() => go(-7)}><ChevronLeft className="h-4 w-4" /></Button></Tip>
          <span className="text-sm text-muted-foreground tabular-nums px-1">{days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {days[6].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
          <Tip label="Next week"><Button variant="outline" size="sm" className="h-8" onClick={() => go(7)}><ChevronRight className="h-4 w-4" /></Button></Tip>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-6 flex-col lg:flex-row">
        <div ref={boxRef} className="flex-1 min-h-[420px] flex items-start justify-center overflow-hidden">
          <div className="shadow-xl" style={{ width: W * scale, height: H * scale, overflow: "hidden", flexShrink: 0 }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: W, height: H }}>
              {doc ? <StoryCanvas ref={canvasRef} doc={doc} /> : <div style={{ width: W, height: H, background: C.black }} />}
            </div>
          </div>
        </div>

        <div className="lg:w-[380px] shrink-0 space-y-4">
          {empty && (
            <div className="rounded-lg border p-3 text-sm">
              No key events this week yet. Mark up to three a day on <Link to="/week" className="underline underline-offset-2">My week</Link> and they'll appear here.
            </div>
          )}
          <div className="space-y-2">
            <div className="text-sm font-medium">Quick changes</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); apply(); }}>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Remove Tuesday's quiz" disabled={busy || !doc || !auth.isEditor} maxLength={400} className="h-10" />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={busy || !text.trim()} aria-label="Apply">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
            </form>
            {reply && <p className="text-[13px] text-muted-foreground">{reply}</p>}
            {!reply && <p className="text-[12px] text-muted-foreground">Try: "headline BIG WEEK", "change pub crawl to 9PM", "rename the quiz to PUB QUIZ", "remove Sunday".</p>}
            <div className="flex gap-1.5 pt-1">
              <Tip label="Undo the last change"><Button variant="outline" size="sm" className="gap-1.5" disabled={!history.length || busy} onClick={undo}><Undo2 className="h-3.5 w-3.5" /> Undo</Button></Tip>
              <Tip label="Throw away the text changes and rebuild from the key events on My week"><Button variant="outline" size="sm" className="gap-1.5" disabled={busy || !built} onClick={rebuild}><RotateCcw className="h-3.5 w-3.5" /> Rebuild</Button></Tip>
            </div>
          </div>
          <Button className="w-full gap-2 h-11" onClick={download} disabled={!doc || exporting}>{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download story (PNG)</Button>
          <p className="text-[12px] text-muted-foreground">Text changes only change the story, never the experiences. Edits are saved for this week. Change times or prices on the experience itself.</p>
        </div>
      </div>
    </div>
  );
}

/** The story itself, at full 1080 x 1920. The list shrinks to fit however many key events there are. */
const StoryCanvas = forwardRef<HTMLDivElement, { doc: StoryDoc }>(function StoryCanvas({ doc }, ref) {
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current; if (!el) return;
    let s = 1; el.style.setProperty("--s", "1");
    while (el.scrollHeight > el.clientHeight + 1 && s > 0.45) { s -= 0.03; el.style.setProperty("--s", String(s)); }
  }, [doc]);
  const font = "'Montserrat', sans-serif";
  return (
    <div ref={ref} style={{ width: W, height: H, background: C.black, color: C.white, fontFamily: font, position: "relative", overflow: "hidden" }}>
      {/* eyebrow */}
      <div style={{ position: "absolute", left: 88, top: 120, fontWeight: 700, fontSize: 30, letterSpacing: "0.16em", color: C.lime, textTransform: "uppercase" }}>{doc.eyebrow}</div>
      {/* headline */}
      <div style={{ position: "absolute", left: 80, top: 180, width: 900, fontWeight: 900, fontSize: 190, lineHeight: 0.86, letterSpacing: "-0.035em", textTransform: "uppercase" }}>{doc.headline}</div>
      {/* the one brand device: the ALL IN sticker */}
      {doc.sticker && (
        <div style={{ position: "absolute", right: 70, top: 300, transform: "rotate(-8deg)", background: C.pink, color: C.black, fontWeight: 900, fontSize: 54, letterSpacing: "-0.01em",
          padding: "18px 40px", borderRadius: 9999, boxShadow: `8px 8px 0 0 ${C.black}`, textTransform: "uppercase", whiteSpace: "nowrap" }}>{doc.sticker}</div>
      )}
      {/* the week */}
      <div ref={listRef} style={{ position: "absolute", left: 88, right: 88, top: 600, bottom: 230, overflow: "hidden", display: "flex", flexDirection: "column", gap: "calc(var(--s, 1) * 44px)" }}>
        {doc.days.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: "calc(var(--s, 1) * 36px)", alignItems: "flex-start" }}>
            <div style={{ width: "calc(var(--s, 1) * 190px)", flexShrink: 0 }}>
              <div style={{ fontWeight: 900, fontSize: "calc(var(--s, 1) * 72px)", lineHeight: 0.95, color: C.lime, letterSpacing: "-0.02em" }}>{d.day}</div>
              <div style={{ fontWeight: 600, fontSize: "calc(var(--s, 1) * 26px)", marginTop: "calc(var(--s, 1) * 6px)", color: C.white }}>{d.date}</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "calc(var(--s, 1) * 16px)", paddingTop: "calc(var(--s, 1) * 6px)" }}>
              {d.items.map((it, j) => (
                <div key={j}>
                  {it.time && <div style={{ fontWeight: 700, fontSize: "calc(var(--s, 1) * 30px)", color: C.pink, letterSpacing: "0.04em" }}>{it.time}</div>}
                  <div style={{ fontWeight: 900, fontSize: "calc(var(--s, 1) * 50px)", lineHeight: 1.0, letterSpacing: "-0.015em", textTransform: "uppercase" }}>{it.title}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* the official wordmark, white version on Mad Black, bottom-right with clear space */}
      <img src="/brand/mad-monkey-white.png" alt="Mad Monkey" crossOrigin="anonymous" style={{ position: "absolute", right: 72, bottom: 72, width: 160, height: "auto" }} />
    </div>
  );
});

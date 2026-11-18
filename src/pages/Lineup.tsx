import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { iso, mondayOf, parseIso, plus } from "@/lib/week";
import { asset } from "@/lib/paths";
import { invokeErrorMessage } from "@/lib/aiErrors";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/app/Tip";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Loader2, Share2, Star, AlertTriangle, Printer } from "lucide-react";
import { lineupView, COLOURWAYS, type ColourwayKey } from "../../supabase/functions/_shared/lineup/engine.js";
import { lineupSvg, type LineupAssets } from "../../supabase/functions/_shared/lineup/svg";
import { applyKeys, lineupFileName, COLOURWAY_KEYS, type LineupBundle } from "../../supabase/functions/_shared/lineup/week";

/**
 * Weekly lineup (Nov 2026, spec from Claude Design): one poster per hostel per week, made from the experiences.
 * The GM checks it here: a KEY star per day, one of 5 colourways, Approve. Previews are drawn in the browser with
 * the same engine + SVG the `lineup` Edge Function rasterises, so what you see is what gets exported.
 */
const NAMES: Record<ColourwayKey, string> = {
  "orange-yellow": "Orange + Yellow", "blue-lime": "Blue + Lime", "pink-cyan": "Pink + Cyan",
  "purple-yellow": "Purple + Yellow", retro: "Retro print",
};
const ASSETS: LineupAssets = {
  logoBlack: { href: asset("lineup/mm-logo-black.png"), w: 600, h: 226 },
  logoWhite: { href: asset("lineup/mm-logo-white.png"), w: 600, h: 181 },
  allIn: { href: asset("lineup/all-in-sticker.png"), w: 1130, h: 776 },
};

// the poster fonts, from our own files (never system fonts)
let fontsAdded = false;
function addFonts() {
  if (fontsAdded || typeof document === "undefined") return;
  fontsAdded = true;
  const faces: [string, string, string][] = [
    ["Anton", "Anton-Regular.ttf", "400"], ["Montserrat", "Montserrat-SemiBold.ttf", "600"],
    ["Montserrat", "Montserrat-Black.ttf", "900"], ["Prompt", "Prompt-Black.ttf", "900"],
  ];
  for (const [family, file, weight] of faces) {
    const f = new FontFace(family, `url(${asset(`lineup/fonts/${file}`)})`, { weight });
    f.load().then((ok) => document.fonts.add(ok)).catch(() => {});
  }
}

const nextMonday = () => plus(mondayOf(new Date()), 7);

export default function Lineup() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  useEffect(addFonts, []);

  // a link from the email carries ?hostel=: switch to it when this login can see it
  const hostelParam = params.get("hostel");
  useEffect(() => {
    if (hostelParam && hostelParam !== auth.currentLocation?.id && auth.allLocations.some((l) => l.id === hostelParam)) auth.setCurrentLocationId(hostelParam);
  }, [hostelParam, auth]);

  const weekStart = useMemo(() => { const w = params.get("week"); return w ? mondayOf(parseIso(w)) : nextMonday(); }, [params]);
  const weekKey = iso(weekStart);
  const loc = auth.currentLocation;
  const setWeek = (d: Date) => { const p = new URLSearchParams(params); p.set("week", iso(d)); p.delete("hostel"); setParams(p, { replace: true }); };

  const qk = ["lineup", loc?.id, weekKey];
  const { data: bundle, isLoading, error } = useQuery({
    queryKey: qk, enabled: !!loc,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lineup_week", { p_location: loc!.id, p_week_start: weekKey });
      if (error) throw error;
      return data as LineupBundle;
    },
  });

  // local copies so every star or colour tap redraws straight away
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [colourway, setColourway] = useState<ColourwayKey>("orange-yellow");
  useEffect(() => { if (bundle) { setPicks(bundle.row.key_picks ?? {}); setColourway(bundle.row.colourway); } }, [bundle?.row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const week = useMemo(() => (bundle ? applyKeys(bundle.week, picks) : null), [bundle, picks]);
  const post = useMemo(() => (week ? lineupView(week, "post", colourway) : null), [week, colourway]);
  const story = useMemo(() => (week ? lineupView(week, "story", colourway) : null), [week, colourway]);
  const postSvg = useMemo(() => (post ? lineupSvg(post, ASSETS) : ""), [post]);
  const storySvg = useMemo(() => (story ? lineupSvg(story, ASSETS) : ""), [story]);
  const busy = !!post && !!story && (post.overfull || story.overfull || Math.max(post.tier, story.tier) >= 2);

  const canEdit = !!bundle?.can_edit;
  const approved = bundle?.row.status === "approved";
  const [exporting, setExporting] = useState(false);
  const exportRun = useRef(0);

  /** Render the final PNGs on the server (Approve, or a re-export after a change on an approved week). */
  const runExport = async (first: boolean) => {
    if (!loc) return;
    const run = ++exportRun.current;
    setExporting(true);
    const { data, error } = await supabase.functions.invoke("lineup", { body: { action: "approve", location_id: loc.id, week_start: weekKey } });
    if (run !== exportRun.current) return;           // a newer change already started another export
    setExporting(false);
    if (error || !data?.ok) { toast.error(error ? await invokeErrorMessage(error) : (data?.error ?? "Couldn't make the final files")); return; }
    qc.setQueryData(qk, data.bundle);
    toast.success(first ? "Approved. The final posters are ready to download." : "Final posters updated");
  };

  const toggleKey = async (dayIso: string, id: string) => {
    if (!canEdit || !loc) return;
    const next = { ...picks };
    if (next[dayIso] === id) delete next[dayIso]; else next[dayIso] = id;
    setPicks(next);
    const { error } = await supabase.rpc("lineup_set_key", { p_location: loc.id, p_week_start: weekKey, p_date: dayIso, p_product: next[dayIso] ?? null });
    if (error) { toast.error(error.message); setPicks(picks); return; }
    qc.setQueryData(qk, (b: LineupBundle | undefined) => (b ? { ...b, row: { ...b.row, key_picks: next } } : b));
    if (approved) runExport(false);
  };

  const pickColourway = async (c: ColourwayKey) => {
    if (!canEdit || !loc || c === colourway) return;
    const prev = colourway;
    setColourway(c);
    const { error } = await supabase.rpc("lineup_set_colourway", { p_location: loc.id, p_week_start: weekKey, p_colourway: c });
    if (error) { toast.error(error.message); setColourway(prev); return; }
    qc.setQueryData(qk, (b: LineupBundle | undefined) => (b ? { ...b, row: { ...b.row, colourway: c } } : b));
    if (approved) runExport(false);
  };

  const download = async (url: string, kind: "post" | "post-print" | "story") => {
    if (!bundle) return;
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = lineupFileName(bundle.hostel.name, weekKey, kind);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { window.open(url, "_blank"); }
  };

  const share = async () => {
    const f = bundle?.row.files;
    if (!f || !bundle) return;
    try {
      const blob = await (await fetch(f.post)).blob();
      const file = new File([blob], lineupFileName(bundle.hostel.name, weekKey, "post"), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: `What's on at Mad Monkey ${bundle.hostel.name} this week` }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(f.post)}`, "_blank");
  };

  if (!loc) return <p className="text-sm text-muted-foreground">Pick a hostel at the top first.</p>;
  const files = bundle?.row.files;
  const row = bundle?.row;

  return (
    <div className="space-y-5 pb-24 lg:pb-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to={`/week?week=${weekKey}`} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-xl font-semibold mr-auto">Weekly lineup <span className="text-muted-foreground font-normal">· {loc.name}</span></h1>
        <Tip label="Previous week"><Button variant="outline" size="sm" className="h-8" onClick={() => setWeek(plus(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button></Tip>
        <span className="text-sm font-medium tabular-nums min-w-[96px] text-center">{bundle?.week.dates ?? weekKey}</span>
        <Tip label="Next week"><Button variant="outline" size="sm" className="h-8" onClick={() => setWeek(plus(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button></Tip>
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Building the lineup…</p>}

      {bundle && row && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {approved
              ? <span className="rounded-full bg-[hsl(var(--st-active))]/15 text-[hsl(var(--st-active))] px-2.5 py-0.5 font-medium">
                  {row.auto_approved ? "Auto-approved" : `Approved${row.approved_by ? ` by ${row.approved_by}` : ""}`}
                  {row.approved_at ? ` · ${new Date(row.approved_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : ""}
                </span>
              : <span className="rounded-full bg-[hsl(var(--st-pending))]/15 text-[hsl(var(--st-pending))] px-2.5 py-0.5 font-medium">Draft · approves itself Sunday 6pm if nobody does</span>}
            <span className="text-muted-foreground">Names, times and prices come from the experiences. <Link to={`/week?week=${weekKey}`} className="underline underline-offset-2">Change them there</Link> and the poster follows.</span>
          </div>

          {busy && (
            <div className="rounded-md border border-[hsl(var(--st-pending))]/40 bg-[hsl(var(--st-pending))]/10 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(var(--st-pending))]" />
              A very full week: the text is at its smallest size. Check every name reads before you approve.
            </div>
          )}

          {canEdit && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Colours</div>
              <div className="grid grid-cols-5 gap-2 max-w-xl">
                {COLOURWAY_KEYS.map((k) => {
                  const c = COLOURWAYS[k], on = k === colourway;
                  const a = k === "retro" ? "#f5efe2" : c.background, b = k === "retro" ? "#0a0a0a" : c.rowFill;
                  return (
                    <button key={k} onClick={() => pickColourway(k)} aria-pressed={on} aria-label={NAMES[k]}
                      className="flex flex-col items-center gap-1.5 rounded-lg p-1.5 hover:bg-muted min-h-[44px]">
                      <span className={`relative block w-full aspect-square max-w-[64px] rounded-lg overflow-hidden ${on ? "ring-[3px] ring-[#0a0a0a] ring-offset-2" : "ring-1 ring-black/15"}`}>
                        <span className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} />
                        {on && <span className="absolute right-1 top-1 rounded-full bg-[#0a0a0a] p-0.5"><Check className="h-3 w-3 text-white" strokeWidth={3} /></span>}
                      </span>
                      <span className={`text-[11px] leading-tight text-center ${on ? "font-semibold" : "text-muted-foreground"}`}>{NAMES[k]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex gap-3 items-start">
              <figure className="flex-[1] min-w-0">
                <div className="[&>svg]:w-full [&>svg]:h-auto [&>svg]:block rounded-md overflow-hidden shadow-sm border" dangerouslySetInnerHTML={{ __html: postSvg }} />
                <figcaption className="text-xs text-muted-foreground mt-1">Post 4:5 · WhatsApp and print</figcaption>
              </figure>
              <figure className="flex-[0.703] min-w-0">
                <div className="[&>svg]:w-full [&>svg]:h-auto [&>svg]:block rounded-md overflow-hidden shadow-sm border" dangerouslySetInnerHTML={{ __html: storySvg }} />
                <figcaption className="text-xs text-muted-foreground mt-1">Story 9:16 · Instagram</figcaption>
              </figure>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Key event per day</div>
                <p className="text-xs text-muted-foreground mb-2">{canEdit ? "Star one event a day to make it the biggest thing in its row." : "Stars mark each day's main event."}</p>
                <div className="rounded-md border divide-y">
                  {bundle.week.days.map((d) => (
                    <div key={d.iso} className="px-3 py-2">
                      <div className="text-xs font-semibold text-muted-foreground">{d.day} {d.date}</div>
                      {d.items.length === 0 && <div className="text-xs text-muted-foreground">Nothing on</div>}
                      {d.items.map((it) => {
                        const on = picks[d.iso] === it.id;
                        return (
                          <button key={it.id} disabled={!canEdit} onClick={() => toggleKey(d.iso, it.id!)}
                            className="w-full flex items-center gap-2 py-1.5 text-left text-sm disabled:cursor-default min-h-[36px]">
                            <Star className={`h-5 w-5 shrink-0 ${on ? "fill-[#ffc000] text-[#0a0a0a]" : "text-muted-foreground/50"}`} />
                            <span className={`min-w-0 truncate ${on ? "font-semibold" : ""}`}>{it.name}</span>
                            {it.time && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{it.time}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {bundle.week.everyDay.length > 0 && (
                    <div className="px-3 py-2">
                      <div className="text-xs font-semibold text-muted-foreground">EVERY DAY <span className="font-normal">(runs all week, so it sits in its own band)</span></div>
                      {bundle.week.everyDay.map((it) => (
                        <div key={it.id} className="flex gap-2 py-1 text-sm"><span className="truncate">{it.name}</span>{it.time && <span className="ml-auto text-xs text-muted-foreground">{it.time}</span>}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {approved && files && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Final posters {exporting && <Loader2 className="inline h-3 w-3 animate-spin" />}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={exporting} onClick={() => download(files.post, "post")} className="gap-1.5"><Download className="h-4 w-4" /> Post</Button>
                    <Button variant="outline" disabled={exporting} onClick={() => download(files.story, "story")} className="gap-1.5"><Download className="h-4 w-4" /> Story</Button>
                    <Button variant="outline" disabled={exporting} onClick={() => download(files.post_print, "post-print")} className="gap-1.5"><Printer className="h-4 w-4" /> Print (3x)</Button>
                    <Button disabled={exporting} onClick={share} className="gap-1.5 bg-[#25D366] hover:bg-[#1ebe5a] text-[#0a0a0a]"><Share2 className="h-4 w-4" /> WhatsApp</Button>
                  </div>
                  {files.colourway !== colourway && !exporting && <p className="text-xs text-muted-foreground">Updating the files to the new colours…</p>}
                </div>
              )}
            </div>
          </div>

          {canEdit && !approved && (
            <div className="fixed bottom-0 inset-x-0 z-20 border-t bg-background/95 p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <Button size="lg" className="w-full lg:w-auto gap-2" disabled={exporting} onClick={() => runExport(true)}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {exporting ? "Making the final posters…" : "Approve this lineup"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

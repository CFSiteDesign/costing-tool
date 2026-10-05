import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/motion";
import { type Box, SHEET_BREAKPOINT, insideBox, placeCard, sheetDock, spotlightBox } from "./logic";
import type { TourStep } from "./steps";

/** The spotlight and the card. Finds the step's anchor (waiting briefly for a page to render after navigating),
 *  follows it every frame so layout shifts never leave the spotlight behind, and falls back to a centred card when
 *  the anchor never appears. The app underneath is inert while this is open. */

const SEEK_MS = 1500;
const DIM = "rgba(26, 26, 24, 0.45)";
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

interface Layout {
  index: number;
  spot: Box | null;
  card: { top: number; left: number } | null;   // floating card position; null in sheet mode
  sheet: "bottom" | "top" | null;
}

export interface TourOverlayProps {
  step: TourStep;
  index: number;
  total: number;
  closing?: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onDone: () => void;
  onMissing: () => void;   // the anchor never showed up and the step asked to be skipped
}

const findAnchor = (id: string) => document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
function visibleBox(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
}

/** Scroll the anchor on screen if it isn't (a column off to the right of a wide table, a button below the fold). */
function bringIntoView(el: HTMLElement, maxHeight: number | undefined, reduced: boolean) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const sheet = vw < SHEET_BREAKPOINT;
  const limit = sheet ? vh * 0.55 : vh - 16;
  const bottom = Math.min(r.bottom, r.top + (maxHeight ?? Infinity));
  if (r.top >= 0 && bottom <= limit && r.left >= 0 && r.right <= vw) return;
  el.scrollIntoView({ block: sheet || bottom - r.top > limit * 0.8 ? "start" : "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && near(a.top, b.top) && near(a.left, b.left) && near(a.width, b.width) && near(a.height, b.height));
const sameLayout = (a: Layout, b: Layout) =>
  a.index === b.index && a.sheet === b.sheet && sameBox(a.spot, b.spot) &&
  (a.card === b.card || (!!a.card && !!b.card && near(a.card.top, b.card.top) && near(a.card.left, b.card.left)));

export function TourOverlay({ step, index, total, closing = false, onNext, onBack, onSkip, onDone, onMissing }: TourOverlayProps) {
  const reduced = usePrefersReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [shownIndex, setShownIndex] = useState(-1);   // the step whose anchor search has finished
  const [layout, setLayout] = useState<Layout>({ index: -1, spot: null, card: null, sheet: null });
  const last = index === total - 1;

  // latest values for the frame loop and key handler, without restarting them
  const live = useRef({ step, index, shownIndex, layout, closing, onNext, onBack, onSkip, onDone, onMissing, last });
  live.current = { step, index, shownIndex, layout, closing, onNext, onBack, onSkip, onDone, onMissing, last };

  // 1. find this step's anchor: wait for the page to render, scroll it on screen, or give up and centre the card
  useEffect(() => {
    if (!step.anchor) { setShownIndex(index); return; }
    let raf = 0;
    const started = performance.now();
    const tick = () => {
      const el = findAnchor(step.anchor!);
      if (el && visibleBox(el)) { bringIntoView(el, step.maxHeight, reduced); setShownIndex(index); return; }
      if (performance.now() - started > (step.wait ?? SEEK_MS)) {
        if (step.fallback === "skip") live.current.onMissing(); else setShownIndex(index);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, index, reduced]);

  // 2. follow the anchor every frame (data loading, smooth scrolling and resizes all move it)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const { step: s, index: i, shownIndex: shown } = live.current;
      if (shown !== i) return;
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const cw = cardRef.current?.offsetWidth ?? 320;
      const ch = cardRef.current?.offsetHeight ?? 180;
      const anchor = s.anchor ? visibleBox(findAnchor(s.anchor)) : null;
      let next: Layout;
      if (vp.width < SHEET_BREAKPOINT) {
        const dock = sheetDock(anchor, vp, s.maxHeight);
        const spot = spotlightBox(anchor, vp, dock === "bottom" ? { maxHeight: s.maxHeight, bottomLimit: vp.height - ch - 8 } : { maxHeight: s.maxHeight, topLimit: ch + 8 });
        next = { index: i, spot, card: null, sheet: dock };
      } else {
        const spot = spotlightBox(anchor, vp, { maxHeight: s.maxHeight });
        const pos = placeCard(spot, { width: cw, height: ch }, vp, s.placement);
        next = { index: i, spot, card: { top: Math.round(pos.top), left: Math.round(pos.left) }, sheet: null };
      }
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const visible = shownIndex === index && layout.index === index && !closing;

  // 3. focus: the primary button on every step; the app behind is inert so nothing else can take it
  useEffect(() => { if (visible) nextRef.current?.focus({ preventScroll: true }); }, [visible, index]);
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.setAttribute("inert", "");
    return () => root.removeAttribute("inert");
  }, []);

  // 4. keyboard: Esc skips, arrows move, Tab stays in the card, Cmd/Ctrl+K can't open the Assistant over the tour
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (l.closing) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); l.onSkip(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); (l.last ? l.onDone : l.onNext)(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); if (l.index > 0) l.onBack(); return; }
      if (e.key === "Tab") {
        const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0], end = items[items.length - 1];
        const inside = cardRef.current?.contains(document.activeElement);
        if (!inside) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
        else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const { spot, card, sheet } = layout;
  const glide = reduced ? "none" : `top 220ms ${EASE}, left 220ms ${EASE}, width 220ms ${EASE}, height 220ms ${EASE}, box-shadow 200ms ease-out`;
  // no spotlight = a zero-size hole in the middle, so the dim covers everything and the next spotlight grows out of it
  const hole = spot ?? { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

  return createPortal(
    <div
      className={cn("fixed inset-0 z-[100]", closing ? "pointer-events-none" : !reduced && "animate-in fade-in-0")}
      style={{ opacity: closing ? 0 : 1, transition: reduced ? "none" : "opacity 150ms ease-out" }}
      data-testid="tour-overlay"
    >
      {/* the backdrop: a click anywhere but the spotlight just closes the tour */}
      <div className="absolute inset-0" onClick={(e) => { if (!insideBox(spot, e.clientX, e.clientY)) live.current.onSkip(); }} />
      <div
        aria-hidden
        className="pointer-events-none fixed rounded-lg"
        style={{
          top: hole.top, left: hole.left, width: hole.width, height: hole.height,
          boxShadow: `0 0 0 2px hsl(var(--accent) / ${spot ? 1 : 0}), 0 0 0 9999px ${DIM}`,
          transition: glide,
        }}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mm-tour-title"
        aria-describedby="mm-tour-body"
        className={cn(
          "fixed bg-background text-sm shadow-lg border",
          sheet === "bottom" ? "inset-x-0 bottom-0 rounded-t-xl border-x-0 border-b-0 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            : sheet === "top" ? "inset-x-0 top-0 rounded-b-xl border-x-0 border-t-0 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"
            : "w-[320px] max-w-[calc(100vw-24px)] rounded-lg p-4",
          !visible && "pointer-events-none",
        )}
        style={{
          ...(card ? { top: card.top, left: card.left } : {}),
          opacity: visible ? 1 : 0,
          transition: reduced ? "none" : card ? `top 220ms ${EASE}, left 220ms ${EASE}, opacity 160ms ease-out` : "opacity 160ms ease-out",
        }}
      >
        <div key={index} className={cn(!reduced && visible && "animate-in fade-in-0 duration-200", !reduced && visible && (sheet === "top" ? "slide-in-from-top-1" : "slide-in-from-bottom-1"))}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="mm-tour-title" className="text-[15px] font-semibold leading-snug">{step.title}</h2>
            <button type="button" onClick={onSkip} className="shrink-0 rounded text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mt-0.5">
              Skip tour
            </button>
          </div>
          <p id="mm-tour-body" className="mt-1.5 text-muted-foreground leading-relaxed">{step.body}</p>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all duration-200 ease-out motion-reduce:transition-none", i === index ? "w-3.5 bg-foreground" : "w-1.5 bg-muted-foreground/30")} />
            ))}
          </div>
          <span className="sr-only">Step {index + 1} of {total}</span>
          <div className="ml-auto flex gap-1.5">
            {index > 0 && <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onBack}>Back</Button>}
            <Button ref={nextRef} type="button" size="sm" className="h-8 min-w-[64px]" onClick={last ? onDone : onNext}>{last ? "Done" : "Next"}</Button>
          </div>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">{visible ? `Step ${index + 1} of ${total}: ${step.title}` : ""}</div>
    </div>,
    document.body,
  );
}

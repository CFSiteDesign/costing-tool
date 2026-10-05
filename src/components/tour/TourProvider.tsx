import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Signpost } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMimo } from "@/components/app/Mimo";
import { Tip } from "@/components/app/Tip";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { hasUnsavedChanges } from "@/lib/unsaved";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SHEET_BREAKPOINT, accessFor, firstNameFor, isAutoStartPath, normalisePath, shouldAutoStart, writeTourState, type TourOutcome } from "./logic";
import { buildTour, type TourStep } from "./steps";
import { setTourActive } from "./store";
import { TourOverlay } from "./TourOverlay";

/** The first-run walkthrough. Starts on its own once per person per device (after roles load, on a main list page),
 *  replays from the sidebar footer or the user menu, and keeps the Assistant closed while it runs. */

interface TourApi { active: boolean; start: () => void }
const Ctx = createContext<TourApi>({ active: false, start: () => {} });
export const useTour = () => useContext(Ctx);

const AUTO_DELAY_MS = 700;   // let the first page settle before the dim comes down
const modKey = (): "Cmd" | "Ctrl" => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Cmd" : "Ctrl");

interface Run { steps: TourStep[]; index: number }

export function TourProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { setOpen: setAssistantOpen } = useMimo();
  const userId = auth.session?.user.id ?? null;
  const [run, setRun] = useState<Run | null>(null);
  const [closing, setClosing] = useState(false);
  const dir = useRef<1 | -1>(1);
  const returnFocus = useRef<HTMLElement | null>(null);

  const begin = useCallback(() => {
    const steps = buildTour(accessFor(auth.roles), {
      first: firstNameFor(auth.fullName, auth.session?.user.email),
      hostel: auth.currentLocation?.name ?? "your hostel",
      mod: modKey(),
      compact: window.innerWidth < SHEET_BREAKPOINT,
    });
    if (!steps.length) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAssistantOpen(false);   // the Assistant, and its own first-run intro, wait until the tour is over
    dir.current = 1;
    setClosing(false);
    setRun({ steps, index: 0 });
  }, [auth.roles, auth.fullName, auth.session, auth.currentLocation, setAssistantOpen]);

  /** Replay. Never throws away a half-filled form without asking, same wording as the pages' own guard. */
  const start = useCallback(() => {
    if (run) return;
    if (hasUnsavedChanges() && !window.confirm("You have unsaved changes. Leave without saving and take the tour?")) return;
    begin();
  }, [run, begin]);

  const closingRef = useRef(false);
  const finish = useCallback((outcome: TourOutcome) => {
    if (closingRef.current) return;   // Done then a stray backdrop click must not turn "done" into "skipped"
    closingRef.current = true;
    if (userId) writeTourState(userId, outcome);
    setClosing(true);
    window.setTimeout(() => { closingRef.current = false; setRun(null); setClosing(false); }, prefersReducedMotion() ? 0 : 160);
  }, [userId]);

  // first run: once per person per device, only from a main list page (never over a form someone is filling in)
  useEffect(() => {
    if (run || !isAutoStartPath(pathname) || !shouldAutoStart(userId)) return;
    const t = window.setTimeout(() => { if (shouldAutoStart(userId)) begin(); }, AUTO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [userId, pathname, run, begin]);

  // a different person (sign out, or the dev harness switching role) never inherits someone else's tour
  useEffect(() => { setRun(null); setClosing(false); }, [userId]);

  // tell the Assistant's shortcut to stand down while the tour is up
  useEffect(() => { setTourActive(!!run && !closing); }, [run, closing]);
  useEffect(() => () => setTourActive(false), []);

  // focus goes back where it was once the overlay (and the inert on the app) is gone
  useEffect(() => {
    if (run) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, [run]);

  // each step lives on a page: go there if we're not already on it
  const step = run ? run.steps[run.index] : null;
  useEffect(() => {
    if (step?.route && normalisePath(pathname) !== step.route) navigate(step.route);
  }, [step]);   // eslint-disable-line react-hooks/exhaustive-deps

  const go = (delta: 1 | -1) => {
    dir.current = delta;
    setRun((r) => (r && r.index + delta >= 0 && r.index + delta < r.steps.length ? { ...r, index: r.index + delta } : r));
  };
  /** A step whose anchor never appeared and asked to be skipped: drop it, so the dots stay honest. */
  const dropCurrent = () => setRun((r) => {
    if (!r) return r;
    const steps = r.steps.filter((_, i) => i !== r.index);
    if (!steps.length) return null;
    const index = dir.current === 1 ? Math.min(r.index, steps.length - 1) : Math.max(0, r.index - 1);
    return { steps, index };
  });

  const api = useMemo(() => ({ active: !!run, start }), [run, start]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {run && step && (
        <TourOverlay
          step={step}
          index={run.index}
          total={run.steps.length}
          closing={closing}
          onNext={() => go(1)}
          onBack={() => go(-1)}
          onSkip={() => finish("skipped")}
          onDone={() => finish("done")}
          onMissing={dropCurrent}
        />
      )}
    </Ctx.Provider>
  );
}

/** Sidebar footer: always there, collapsed rail and phones included. The tour's last step points at it. */
export function TourReplayButton({ className }: { className?: string }) {
  const { start } = useTour();
  return (
    <Tip side="right" label="Take the tour: a quick look round, any time you fancy a refresher">
      <button type="button" onClick={start} data-tour="tour-replay" aria-label="Take the tour"
        className={cn("shrink-0 rounded-md p-1 hover:bg-background/60 hover:text-foreground", className)}>
        <Signpost className="h-4 w-4" />
      </button>
    </Tip>
  );
}

/** User menu entry, for anyone who looks there first. */
export function TourMenuItem() {
  const { start } = useTour();
  // after the menu has closed and handed focus back, so the tour starts from a settled page
  return <DropdownMenuItem onSelect={() => window.setTimeout(start, 0)}>Take the tour</DropdownMenuItem>;
}

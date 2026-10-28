/**
 * DEV ONLY: the walkthrough harness. Open /__dev/tour (or /__dev/tour?role=head_office) on the local dev server to
 * see the real app shell and real pages, signed in as a mock person with the role you pick, over mock data, with the
 * tour starting on its own. App.tsx only imports this behind `import.meta.env.DEV`, which Vite sets to false in
 * production builds, so neither this file nor the route ships. Nothing here talks to Supabase: mockData answers
 * every non-local request.
 */
import { Fragment, createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { AuthStateContext, type AuthState } from "@/contexts/AuthContext";
import { clearTourState } from "@/components/tour/logic";
import { LOCATIONS, PEOPLE, installMockFetch, uninstallMockFetch, type HarnessPersona } from "./mockData";

if (!import.meta.env.DEV) throw new Error("The tour harness is development-only.");

export const HARNESS_KEY = "mm.dev.harness";
const PERSONAS: { id: HarnessPersona; label: string }[] = [
  { id: "gm", label: "GM" }, { id: "head_office", label: "Head office" }, { id: "sales", label: "Sales" }, { id: "admin", label: "Admin" },
];
const isPersona = (v: string | null): v is HarnessPersona => PERSONAS.some((p) => p.id === v);
const userIdFor = (p: HarnessPersona) => `harness-${p}`;

const HarnessCtx = createContext<{ persona: HarnessPersona; switchTo: (p: HarnessPersona) => void }>({ persona: "gm", switchTo: () => {} });

function readPersona(): HarnessPersona {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("role");
    if (isPersona(fromUrl)) return fromUrl;
    const saved = sessionStorage.getItem(HARNESS_KEY);
    if (isPersona(saved)) return saved;
  } catch { /* ignore */ }
  return "gm";
}

/** Wraps the app's routes in place of AuthProvider while the harness is on. */
export function HarnessRoot({ children }: { children: React.ReactNode }) {
  const [persona, setPersona] = useState<HarnessPersona>(readPersona);
  installMockFetch(persona);   // before any page query fires; idempotent
  const qc = useQueryClient();
  const [locId, setLocId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => { try { sessionStorage.setItem(HARNESS_KEY, persona); } catch { /* ignore */ } }, [persona]);

  const switchTo = (p: HarnessPersona) => {
    clearTourState(userIdFor(p));   // so the tour starts again for that role
    qc.clear();
    setLocId(null);
    setPersona(p);
    setEpoch((n) => n + 1);
  };

  const auth = useMemo<AuthState>(() => {
    const person = PEOPLE[persona];
    const seesAll = person.roles.some((r) => r === "admin" || r === "head_office" || r === "sales");
    const mine = persona === "gm" ? [LOCATIONS[0]] : [];
    const pool = seesAll ? LOCATIONS : mine;
    return {
      session: { user: { id: userIdFor(persona), email: person.email } } as unknown as Session,
      loading: false,
      roles: person.roles,
      isAdmin: person.roles.includes("admin"),
      isEditor: person.roles.some((r) => r === "admin" || r === "head_office" || r === "gm"),
      canQuote: seesAll,
      rolesLoaded: true,
      seesAllLocations: seesAll,
      myLocations: mine,
      allLocations: LOCATIONS,
      currentLocation: pool.find((l) => l.id === locId) ?? pool[0] ?? null,
      setCurrentLocationId: setLocId,
      reloadLocations: async () => {},
      fullName: person.name,
      signOut: () => exitHarness(),
    };
  }, [persona, locId]);

  return (
    <HarnessCtx.Provider value={{ persona, switchTo }}>
      <AuthStateContext.Provider value={auth}>
        <Fragment key={`${persona}:${epoch}`}>{children}</Fragment>
      </AuthStateContext.Provider>
      <HarnessBar persona={persona} onSwitch={switchTo} />
    </HarnessCtx.Provider>
  );
}

function exitHarness() {
  try { sessionStorage.removeItem(HARNESS_KEY); } catch { /* ignore */ }
  uninstallMockFetch();
  window.location.assign("/login");
}

/** The /__dev/tour route: pick the role from ?role=, reset that role's tour, land on Experiences. */
export function HarnessEntry() {
  const { switchTo } = useContext(HarnessCtx);
  const [params] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    const role = params.get("role");
    switchTo(isPersona(role) ? role : "gm");
    nav("/experiences", { replace: true });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Floating role switcher. Portalled to <body> and above the tour, so it still works while the tour is up. */
function HarnessBar({ persona, onSwitch }: { persona: HarnessPersona; onSwitch: (p: HarnessPersona) => void }) {
  return createPortal(
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-1 rounded-full border bg-background/95 px-2 py-1 text-[11px] shadow-md backdrop-blur" role="toolbar" aria-label="Dev harness">
      <span className="px-1.5 font-semibold uppercase tracking-wide text-[hsl(var(--st-pending))]">Dev harness</span>
      {PERSONAS.map((p) => (
        <button key={p.id} type="button" onClick={() => onSwitch(p.id)}
          className={`rounded-full px-2 py-0.5 ${p.id === persona ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
          {p.label}
        </button>
      ))}
      <button type="button" onClick={() => onSwitch(persona)} className="rounded-full px-2 py-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Forget this role's tour and start it again">Reset tour</button>
      <button type="button" onClick={exitHarness} className="rounded-full px-2 py-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">Exit</button>
    </div>,
    document.body,
  );
}

import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { Tip } from "@/components/app/Tip";
import { MimoProvider, MimoNavButton, MimoPanel } from "@/components/app/Mimo";
import { TourProvider, TourReplayButton, TourMenuItem } from "@/components/tour/TourProvider";
import { accessFor, canSeeNav } from "@/components/tour/logic";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Compass, CalendarDays, FileText, History, Settings, ChevronDown, Globe, Bus, ClipboardCheck, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/experiences", label: "Experiences", icon: Compass, tip: "Every tour and event at this hostel: rates, days, times, status." },
  { to: "/week", label: "My week", icon: CalendarDays, tip: "What runs this week, day by day, in time order." },
  { to: "/transport", label: "Transport", icon: Bus, tip: "Every transfer, bus, boat and rental, with departure times." },
  { to: "/quotes", label: "Quotes", icon: FileText, quoting: true, tip: "Group trip quotes, agreements and detailed itineraries." },   // hidden from GMs (phase 2)
  { to: "/activity", label: "Activity", icon: History, tip: "Every change, who made it and when." },
  { to: "/global-events", label: "Global events", icon: Globe, headOffice: true, tip: "Events sent to every hostel to accept or decline." },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck, headOffice: true, tip: "Changes from the flow chart and start / finish times, waiting for head office approval." },
  { to: "/settings", label: "Settings", icon: Settings, adminOnly: true, tip: "Rate sync, Reden emails, currencies, imports." },
];

/** The sidebar is the icon rail below Tailwind's lg breakpoint (half a desktop screen), or whenever the person
 *  collapses it themselves. Their choice is remembered on this browser. */
function useCollapsedSidebar(): { collapsed: boolean; narrow: boolean; toggle: () => void } {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const [pref, setPref] = useState(() => { try { return localStorage.getItem("mm.sidebar") === "collapsed"; } catch { return false; } });
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const h = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", h); return () => mq.removeEventListener("change", h);
  }, []);
  const toggle = () => setPref((p) => { try { localStorage.setItem("mm.sidebar", p ? "expanded" : "collapsed"); } catch { /* private mode */ } return !p; });
  return { collapsed: narrow || pref, narrow, toggle };
}

export default function AppShell() {
  const auth = useAuth();
  const loc = useLocation();
  const access = accessFor(auth.roles);   // same rule the walkthrough uses, so its steps always match this sidebar
  const isHeadOffice = access.isHeadOffice;
  const { collapsed, narrow, toggle: toggleSidebar } = useCollapsedSidebar();
  const { data: pendingApprovals } = useQuery({
    queryKey: ["pending-approvals"],
    enabled: !!auth.session && isHeadOffice,
    refetchInterval: 60_000,
    queryFn: async () => {   // flow-chart sheet changes + times, both waiting for head office
      const [a, b] = await Promise.all([
        supabase.from("sheet_sync_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("product_time_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      return (a.count ?? 0) + (b.count ?? 0);
    },
  });

  if (auth.loading || (auth.session && !auth.rolesLoaded)) {
    return <div className="h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (!auth.session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

  return (
    <MimoProvider>
    <TourProvider>
    <div className="flex h-screen overflow-hidden">
      <aside className={cn("shrink-0 border-r bg-secondary/60 flex flex-col transition-[width] duration-200 motion-reduce:transition-none", collapsed ? "w-14" : "w-[220px]")}>
        <div className={cn("h-14 flex items-center border-b", collapsed ? "justify-center px-0" : "px-4")}>
          {collapsed ? <img src="/mm-head.png" alt="Mad Monkey" className="h-7 w-7" /> : <img src="/mm-logo.png" alt="Mad Monkey" className="h-8 w-auto" />}
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.filter((n) => canSeeNav(n, access)).map((n) => {
            const link = (
            <NavLink
              key={n.to}
              to={n.to}
              data-tour={`nav${n.to.replace(/\//g, "-")}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors relative", collapsed && "justify-center",
                  isActive
                    ? "bg-background text-foreground shadow-sm before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )
              }
            >
              <n.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{n.label}</span>}
              {!collapsed && n.to === "/approvals" && (pendingApprovals ?? 0) > 0 && <span className="ml-auto rounded-full bg-[hsl(var(--st-pending))] text-white text-[10px] font-semibold px-1.5 py-0.5 tabular-nums" title={`${pendingApprovals} waiting`}>{pendingApprovals}</span>}
            </NavLink>
            );
            // collapsed rail: the name (and what the page is for) on hover, to the right of the icon
            return collapsed ? <Tip key={n.to} side="right" label={`${n.label}${n.to === "/approvals" && pendingApprovals ? ` (${pendingApprovals} waiting)` : ""}: ${n.tip}`}>{link}</Tip> : link;
          })}
        </nav>
        <div className="px-2 pb-2 border-t pt-2"><MimoNavButton collapsed={collapsed} /></div>
        <div className={cn("flex items-center text-[11px] text-muted-foreground", collapsed ? "flex-col justify-center gap-1 py-2" : "px-3 py-2 gap-1")}>
          {!collapsed && <span className="min-w-0 truncate mr-1">Experience Database & Costing Tool</span>}
          <TourReplayButton className={cn(!collapsed && "ml-auto")} />
          {/* below lg the rail is forced, so no toggle there */}
          {!narrow && (
            <Tip side="right" label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}>
              <button onClick={toggleSidebar} className="shrink-0 rounded-md p-1 hover:bg-background/60 hover:text-foreground" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </Tip>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b flex items-center justify-between px-4 gap-3">
          {auth.seesAllLocations ? (
            <Select
              value={auth.currentLocation?.id ?? ""}
              onValueChange={(v) => auth.setCurrentLocationId(v)}
            >
              <SelectTrigger className="w-[210px] h-9" data-tour="location-switcher">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                {auth.allLocations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name} · {l.country}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="font-medium text-[15px]" data-tour="location-switcher">{auth.currentLocation?.name ?? "—"}</div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              {auth.fullName} <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <TourMenuItem />
              <DropdownMenuItem onClick={auth.signOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 overflow-auto">
          {/* keyed by page so each one eases in (fade + small rise, reduced-motion aware, see index.css) */}
          <div key={loc.pathname} className="mm-page">
            <Outlet />
          </div>
        </main>
      </div>
      <MimoPanel />
    </div>
    </TourProvider>
    </MimoProvider>
  );
}

/** Route guard: quotes are a head-office / sales tool. GMs are sent back to Experiences. */
export function RequireQuoting() {
  const auth = useAuth();
  if (!auth.canQuote) return <Navigate to="/experiences" replace />;
  return <Outlet />;
}

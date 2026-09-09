import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { Tip } from "@/components/app/Tip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Compass, CalendarDays, FileText, History, Settings, ChevronDown, Globe, Bus, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/experiences", label: "Experiences", icon: Compass, tip: "Every tour and event at this hostel: rates, days, times, status." },
  { to: "/week", label: "My week", icon: CalendarDays, tip: "What runs this week, day by day, in time order." },
  { to: "/transport", label: "Transport", icon: Bus, tip: "Every transfer, bus, boat and rental, with departure times." },
  { to: "/quotes", label: "Quotes", icon: FileText, quoting: true, tip: "Group trip quotes, agreements and detailed itineraries." },   // hidden from GMs (phase 2)
  { to: "/activity", label: "Activity", icon: History, tip: "Every change, who made it and when." },
  { to: "/global-events", label: "Global events", icon: Globe, headOffice: true, tip: "Events sent to every hostel to accept or decline." },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck, headOffice: true, tip: "Start and finish times waiting for head office approval." },   // times queue (9 Sep 2026)
  { to: "/settings", label: "Settings", icon: Settings, adminOnly: true, tip: "Rate sync, Reden emails, currencies, imports." },
];

/** True when the sidebar is the icon rail (below Tailwind's lg breakpoint, e.g. half a desktop screen). */
function useCollapsedSidebar() {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const h = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mq.addEventListener("change", h); return () => mq.removeEventListener("change", h);
  }, []);
  return collapsed;
}

export default function AppShell() {
  const auth = useAuth();
  const loc = useLocation();
  const isHeadOffice = auth.isAdmin || auth.roles.includes("head_office");
  const collapsed = useCollapsedSidebar();
  const { data: pendingApprovals } = useQuery({
    queryKey: ["pending-approvals"],
    enabled: !!auth.session && isHeadOffice,
    refetchInterval: 60_000,
    queryFn: async () => (await supabase.from("product_time_proposals").select("id", { count: "exact", head: true }).eq("status", "pending")).count ?? 0,
  });

  if (auth.loading || (auth.session && !auth.rolesLoaded)) {
    return <div className="h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (!auth.session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-[220px] shrink-0 border-r bg-secondary/60 flex flex-col max-lg:w-14">
        <div className="h-14 flex items-center px-4 border-b max-lg:justify-center max-lg:px-0">
          <img src="/mm-logo.png" alt="Mad Monkey" className="h-8 w-auto max-lg:hidden" />
          <img src="/mm-head.png" alt="Mad Monkey" className="h-7 w-7 lg:hidden" />
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.filter((n) => (!n.adminOnly || auth.isAdmin) && (!n.headOffice || auth.isAdmin || auth.roles.includes("head_office")) && (!n.quoting || auth.canQuote)).map((n) => {
            const link = (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors relative max-lg:justify-center",
                  isActive
                    ? "bg-background text-foreground shadow-sm before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )
              }
            >
              <n.icon className="h-4 w-4 shrink-0" />
              <span className="max-lg:hidden">{n.label}</span>
              {n.to === "/approvals" && (pendingApprovals ?? 0) > 0 && <span className="ml-auto rounded-full bg-[hsl(var(--st-pending))] text-white text-[10px] font-semibold px-1.5 py-0.5 tabular-nums max-lg:hidden" title={`${pendingApprovals} waiting`}>{pendingApprovals}</span>}
            </NavLink>
            );
            // collapsed rail: the name (and what the page is for) on hover, to the right of the icon
            return collapsed ? <Tip key={n.to} side="right" label={`${n.label}${n.to === "/approvals" && pendingApprovals ? ` (${pendingApprovals} waiting)` : ""}: ${n.tip}`}>{link}</Tip> : link;
          })}
        </nav>
        <div className="p-3 text-[11px] text-muted-foreground max-lg:hidden">
          Experience Database & Costing Tool
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b flex items-center justify-between px-4 gap-3">
          {auth.seesAllLocations ? (
            <Select
              value={auth.currentLocation?.id ?? ""}
              onValueChange={(v) => auth.setCurrentLocationId(v)}
            >
              <SelectTrigger className="w-[210px] h-9">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                {auth.allLocations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name} · {l.country}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="font-medium text-[15px]">{auth.currentLocation?.name ?? "—"}</div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              {auth.fullName} <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={auth.signOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Route guard: quotes are a head-office / sales tool. GMs are sent back to Experiences. */
export function RequireQuoting() {
  const auth = useAuth();
  if (!auth.canQuote) return <Navigate to="/experiences" replace />;
  return <Outlet />;
}

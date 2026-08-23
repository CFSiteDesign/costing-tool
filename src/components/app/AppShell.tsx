import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Compass, FileText, History, Settings, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/experiences", label: "Experiences", icon: Compass },
  { to: "/quotes", label: "Quotes", icon: FileText },
  { to: "/activity", label: "Activity", icon: History },
  { to: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export default function AppShell() {
  const auth = useAuth();
  const loc = useLocation();

  if (auth.loading) {
    return <div className="h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (!auth.session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-[220px] shrink-0 border-r bg-secondary/60 flex flex-col max-lg:w-14">
        <div className="h-14 flex items-center gap-2 px-4 border-b max-lg:justify-center max-lg:px-0">
          <div className="h-7 w-7 rounded bg-accent grid place-items-center font-bold text-sm shrink-0">M</div>
          <div className="font-semibold text-[15px] max-lg:hidden">Mad Monkey</div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.filter((n) => !n.adminOnly || auth.isAdmin).map((n) => (
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
            </NavLink>
          ))}
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

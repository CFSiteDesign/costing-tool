import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Location, Role } from "@/lib/types";

interface AuthState {
  session: Session | null;
  loading: boolean;
  roles: Role[];
  isAdmin: boolean;
  isEditor: boolean;
  canQuote: boolean;             // quotes are hidden from GMs (phase 2)
  rolesLoaded: boolean;
  seesAllLocations: boolean;
  myLocations: Location[];       // GM scoping
  allLocations: Location[];      // whatever RLS lets this user read
  currentLocation: Location | null;
  setCurrentLocationId: (id: string | null) => void;
  fullName: string;
  signOut: () => void;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [myLocations, setMyLocations] = useState<Location[]>([]);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [currentLocationId, setCurrentLocationId] = useState<string | null>(
    () => localStorage.getItem("mm.location"),
  );
  const [fullName, setFullName] = useState("");
  const [rolesLoaded, setRolesLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setRoles([]); setMyLocations([]); setAllLocations([]); setRolesLoaded(false); return; }
    (async () => {
      const uid = session.user.id;
      const [r, ul, locs, prof] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("user_locations").select("location_id").eq("user_id", uid),
        supabase.from("locations").select("*").order("name"),
        supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
      ]);
      const roleList = (r.data ?? []).map((x) => x.role as Role);
      setRoles(roleList);
      setAllLocations((locs.data ?? []) as Location[]);
      const mine = new Set((ul.data ?? []).map((x) => x.location_id));
      setMyLocations(((locs.data ?? []) as Location[]).filter((l) => mine.has(l.id)));
      setFullName(prof.data?.full_name ?? session.user.email ?? "");
      setRolesLoaded(true);
    })();
  }, [session]);

  const seesAll = roles.some((r) => r === "admin" || r === "head_office" || r === "sales");

  const currentLocation = useMemo(() => {
    const pool = seesAll ? allLocations : myLocations;
    if (pool.length === 0) return null;
    return pool.find((l) => l.id === currentLocationId) ?? pool[0];
  }, [allLocations, myLocations, currentLocationId, seesAll]);

  const value: AuthState = {
    session, loading, roles,
    isAdmin: roles.includes("admin"),
    isEditor: roles.some((r) => r === "admin" || r === "head_office" || r === "gm"),
    seesAllLocations: seesAll,
    canQuote: seesAll,
    rolesLoaded,
    myLocations, allLocations, currentLocation,
    setCurrentLocationId: (id) => {
      if (id) localStorage.setItem("mm.location", id); else localStorage.removeItem("mm.location");
      setCurrentLocationId(id);
    },
    fullName,
    signOut: () => supabase.auth.signOut(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

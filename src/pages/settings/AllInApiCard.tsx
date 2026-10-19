import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, RefreshCw } from "lucide-react";

const ENDPOINT = "https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/allin-guest-trips";

type Client = {
  id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null;
};
type SyncStatus = { synced_until: string | null; last_error: string | null; bookings: number; upcoming: number } | null;

/**
 * Settings > ALL IN guest trips (admins). ALL IN bookings sync here every 5 minutes (allin-sync) next to each trip's
 * day-by-day, and other apps read them through allin-guest-trips with their own key: Dhany's Loyalty app, Ayush's
 * main website and WhatsApp. A key is shown once, when it's made; only its hash is stored. See docs/ALLIN_API.md.
 */
export function AllInApiCard() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);

  const { data: status } = useQuery({
    queryKey: ["allin-sync-status"],
    queryFn: async () => (await supabase.rpc("allin_sync_status")).data as SyncStatus,
    refetchInterval: 60_000,
  });
  const { data: clients } = useQuery({
    queryKey: ["api-clients"],
    queryFn: async () =>
      ((await supabase.from("api_clients").select("id,name,key_prefix,created_at,last_used_at,revoked_at")
        .order("created_at", { ascending: false })).data ?? []) as Client[],
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_api_client", { p_name: name });
      if (error) throw error;
      return data as { name: string; key: string };
    },
    onSuccess: (d) => { setMade(d); setName(""); qc.invalidateQueries({ queryKey: ["api-clients"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("revoke_api_client", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-clients"] }); toast.success("Key revoked. It stopped working straight away."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const syncNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("allin-sync", { body: { full: true } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Sync failed");
      return data as { received: number };
    },
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["allin-sync-status"] }); toast.success(`Synced ${d.received} ALL IN bookings`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  const synced = status?.synced_until && !status.synced_until.startsWith("1970") ? timeAgo(status.synced_until) : "never";

  return (
    <section className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">ALL IN guest trips</h2>
          <p className="text-sm text-muted-foreground">
            {status ? <>{status.bookings} ALL IN bookings here ({status.upcoming} upcoming), synced from the ALL IN site every 5 minutes. Last sync {synced}.</> : "Loading…"}
            {" "}Apps read each guest's trip and day-by-day with their own key.
          </p>
          {status?.last_error && <p className="text-[12px] text-[hsl(var(--st-pending))] mt-1">Last sync failed: {status.last_error}</p>}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
          <RefreshCw className="h-3.5 w-3.5" /> {syncNow.isPending ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {made && (
        <div className="rounded-md border border-[hsl(var(--st-pending))] p-3 space-y-2">
          <p className="text-sm font-medium">Key for {made.name}. Copy it now: it won't be shown again.</p>
          <div className="flex gap-2">
            <Input readOnly value={made.key} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(made.key)}><Copy className="h-3.5 w-3.5" /> Copy</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Send it privately (DM or a password manager), never in a group chat. It goes in the x-api-key header, from their server only.</p>
          <Button size="sm" variant="ghost" onClick={() => setMade(null)}>Done, I've copied it</Button>
        </div>
      )}

      <form className="flex gap-2 max-sm:flex-col" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <Input placeholder="Who is it for? e.g. Dhany, Loyalty app" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? "Making…" : "Make a key"}</Button>
      </form>

      <div className="text-sm border rounded-md divide-y">
        {(clients ?? []).length === 0 && <div className="px-3 py-2 text-muted-foreground">No keys yet.</div>}
        {(clients ?? []).map((c) => (
          <div key={c.id} className="px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={c.revoked_at ? "line-through text-muted-foreground" : ""}>{c.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {c.key_prefix}… · made {timeAgo(c.created_at)} · {c.revoked_at ? `revoked ${timeAgo(c.revoked_at)}` : c.last_used_at ? `last used ${timeAgo(c.last_used_at)}` : "not used yet"}
              </div>
            </div>
            {!c.revoked_at && (
              <Button size="sm" variant="outline" disabled={revoke.isPending}
                onClick={() => { if (window.confirm(`Revoke the key for ${c.name}? Their app stops getting ALL IN trips straight away.`)) revoke.mutate(c.id); }}>
                Revoke
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Endpoint: <span className="font-mono">{ENDPOINT}</span></span>
        <button type="button" className="underline" onClick={() => copy(ENDPOINT)}>copy</button>
      </div>
    </section>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Tip } from "@/components/app/Tip";
import { RefreshCw, ArrowRight } from "lucide-react";
import { useFx, money } from "@/lib/fx";
import { AllInApiCard } from "./AllInApiCard";

export default function SettingsPage() {
  const auth = useAuth();
  const qc = useQueryClient();

  const { data: runs } = useQuery({
    queryKey: ["sync-runs"],
    queryFn: async () =>
      (await supabase.from("rate_sync_runs").select("*").order("started_at", { ascending: false }).limit(10)).data ?? [],
  });
  const { data: settings } = useQuery({
    queryKey: ["notif-settings"],
    queryFn: async () => (await supabase.from("notification_settings").select("*").eq("id", 1).single()).data,
  });
  const { data: pendingEvents } = useQuery({
    queryKey: ["pending-events"],
    queryFn: async () => {
      const { count } = await supabase.from("notification_events").select("id", { count: "exact", head: true }).is("dispatched_at", null);
      return count ?? 0;
    },
  });
  const { data: openExceptions } = useQuery({
    queryKey: ["open-exceptions-total"],
    queryFn: async () => {
      const { count } = await supabase.from("import_exceptions").select("id", { count: "exact", head: true }).eq("status", "open");
      return count ?? 0;
    },
  });

  const saveSettings = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from("notification_settings").update(patch).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notif-settings"] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const lastSuccess = (runs ?? []).find((r) => r.status === "success" || r.status === "partial");
  const fx = useFx();
  const refreshFx = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("fx-refresh");
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fx"] }); toast.success("FX rates refreshed"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setOverride = useMutation({
    mutationFn: async ({ code, value }: { code: string; value: number | null }) => {
      const { error } = await supabase.from("fx_rates").update({ manual_override: value }).eq("code", code);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fx"] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {auth.isAdmin && <EmailKeyCard />}
      {auth.isAdmin && <AllInApiCard />}

      <section className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Accommodation rates</h2>
            <p className="text-sm text-muted-foreground">
              Last successful sync: {lastSuccess ? timeAgo(lastSuccess.finished_at) : "never"}
              {lastSuccess?.source === "sample_seed" && (
                <span className="text-[hsl(var(--st-pending))]"> · sample data, awaiting the 2027 RATE OFFER TA connection</span>
              )}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span><Button variant="outline" size="sm" disabled className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Sync now</Button></span>
            </TooltipTrigger>
            <TooltipContent>Arrives with the Apps Script phase — the rate sheet isn’t connected yet.</TooltipContent>
          </Tooltip>
        </div>
        <div className="text-sm border rounded-md divide-y">
          {(runs ?? []).map((r) => (
            <div key={r.id} className="px-3 py-2 flex justify-between">
              <span>{r.source} · {r.triggered_by}</span>
              <span className={r.status === "success" ? "text-[hsl(var(--st-active))]" : "text-[hsl(var(--st-pending))]"}>
                {r.status} · {timeAgo(r.finished_at ?? r.started_at)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="border rounded-lg p-4 space-y-4">
        <div>
          <h2 className="font-medium">Reden notifications</h2>
          <p className="text-sm text-muted-foreground">
            Changes to website-bookable products queue an email so the site gets updated.
            {" "}{pendingEvents} change{pendingEvents === 1 ? "" : "s"} waiting in the queue.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select
              disabled={!auth.isAdmin}
              value={settings?.mode ?? "daily_digest"}
              onValueChange={(v) => saveSettings.mutate({ mode: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily_digest">Daily digest per location</SelectItem>
                <SelectItem value="instant">Instant per change</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Ask Reden which he prefers — it’s a toggle, not a rebuild.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Recipients (comma-separated)</Label>
            <Input
              disabled={!auth.isAdmin}
              defaultValue={(settings?.recipients ?? []).join(", ")}
              placeholder="reden@madmonkeyhostels.com"
              onBlur={(e) => saveSettings.mutate({
                recipients: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })}
            />
          </div>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            disabled={!auth.isAdmin}
            checked={settings?.enabled ?? true}
            onCheckedChange={(v) => saveSettings.mutate({ enabled: v })}
          />
          Notifications enabled
        </label>
      </section>

      <section className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Exchange rates</h2>
            <p className="text-sm text-muted-foreground">
              Local prices convert to USD with these. Refreshed daily at 01:15 UTC from open.er-api.com
              {fx.data?.asOf ? ` · rates as of ${new Date(fx.data.asOf).toLocaleDateString("en-GB")}` : ""}.
              A manual override pins a rate until you clear it.
            </p>
          </div>
          <Tip label="Pulls today's rates immediately instead of waiting for the 01:15 UTC refresh. Manual overrides are never touched."><Button variant="outline" size="sm" className="gap-1.5" disabled={refreshFx.isPending} onClick={() => refreshFx.mutate()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh now
          </Button></Tip>
        </div>
        <div className="text-sm border rounded-md divide-y">
          {(fx.data?.rows ?? []).filter((r) => r.code !== "USD").map((r) => (
            <div key={r.code} className="px-3 py-2 grid grid-cols-[4rem_1fr_auto] items-center gap-3">
              <span className="font-medium">{r.code}</span>
              <span className="text-muted-foreground tabular-nums">
                1 USD = {money(Number(r.manual_override ?? r.units_per_usd), r.code)}
                {r.manual_override != null && <span className="ml-2 text-[hsl(var(--st-pending))]">manual override (api: {Number(r.units_per_usd).toLocaleString()})</span>}
              </span>
              <Input className="h-7 w-32 text-xs tabular-nums" placeholder="override…" disabled={!auth.isAdmin} title="Pin a rate (units per 1 USD). Stays until you clear the box — the daily refresh won't overwrite it."
                defaultValue={r.manual_override ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const n = v === "" ? null : Number(v);
                  if (v !== "" && (!isFinite(n!) || n! <= 0)) { toast.error("Enter a positive number"); return; }
                  if ((n ?? null) !== (r.manual_override ?? null)) setOverride.mutate({ code: r.code, value: n });
                }} />
            </div>
          ))}
        </div>
      </section>

      <section className="border rounded-lg p-4 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Import exceptions</h2>
          <p className="text-sm text-muted-foreground">{openExceptions} open item{openExceptions === 1 ? "" : "s"} from the flow-chart migration.</p>
        </div>
        <Link to="/settings/imports">
          <Button variant="outline" size="sm" className="gap-1.5">Work the queue <ArrowRight className="h-3.5 w-3.5" /></Button>
        </Link>
      </section>
    </div>
  );
}

/**
 * Settings > Email (admins). The Resend key that lets the database send email: GM login emails, global-event emails,
 * Reden's website changes. Saved encrypted in the database (Supabase Vault) through set_email_key; this page can
 * only ever learn whether a key is set, never read it back.
 */
function EmailKeyCard() {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const { data: status } = useQuery({
    queryKey: ["email-key-status"],
    queryFn: async () => (await supabase.rpc("email_key_status")).data as { key_set: boolean; updated_at: string | null } | null,
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_email_key", { p_key: key });
      if (error) throw error;
    },
    onSuccess: () => { setKey(""); qc.invalidateQueries({ queryKey: ["email-key-status"] }); toast.success("Saved. Email is on."); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-medium">Email</h2>
        <p className="text-sm text-muted-foreground">
          {status?.key_set
            ? <>On. Emails send from updates@experience.madmonkeyhostels.com. Key saved {timeAgo(status.updated_at)}.</>
            : <>Off. Paste the Resend API key to let the database send login emails and global-event emails.</>}
        </p>
      </div>
      <form className="flex gap-2 max-sm:flex-col" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save.mutate(); }}>
        <Input type="password" autoComplete="off" spellCheck={false} placeholder={status?.key_set ? "Paste a new key to replace it" : "re_..."}
          value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-sm" />
        <Button type="submit" disabled={!key.trim() || save.isPending}>{save.isPending ? "Saving…" : status?.key_set ? "Replace key" : "Save key"}</Button>
      </form>
      <p className="text-[11px] text-muted-foreground">Stored encrypted. Nobody can read it back here, including admins.</p>
    </section>
  );
}

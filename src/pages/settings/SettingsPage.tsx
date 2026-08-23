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
import { RefreshCw, ArrowRight } from "lucide-react";

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

  const lastSuccess = (runs ?? []).find((r) => r.status === "success");

  return (
    <div className="p-4 max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

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

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Globe, Check, X } from "lucide-react";

/** D: what a GM sees — global events waiting for this hostel's answer. */
export function PendingGlobalEvents() {
  const auth = useAuth();
  const qc = useQueryClient();
  const locId = auth.currentLocation?.id;

  const { data } = useQuery({
    queryKey: ["pending-global", locId],
    enabled: !!locId,
    queryFn: async () => {
      const { data } = await supabase.from("global_event_responses")
        .select("global_event_id, status, global_events(id, title, category, event_date, rate_usd, notes, brief_description)")
        .eq("location_id", locId!).eq("status", "pending");
      return (data ?? []) as unknown as { global_event_id: string; global_events: { id: string; title: string; event_date: string | null; rate_usd: number | null; notes: string | null; brief_description: string | null } }[];
    },
  });

  const respond = useMutation({
    mutationFn: async ({ eventId, status }: { eventId: string; status: "accepted" | "declined" }) => {
      const { error } = await supabase.rpc("respond_global_event", { p_event: eventId, p_location: locId, p_status: status });
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["pending-global"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["my-week"] });
      toast.success(status === "accepted" ? "Accepted — it's now in your product list" : "Declined");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data?.length || !auth.isEditor) return null;
  return (
    <div className="rounded-lg border border-[hsl(var(--st-signature))]/40 bg-[hsl(var(--st-signature))]/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium"><Globe className="h-4 w-4" /> {data.length} global event{data.length === 1 ? "" : "s"} waiting for your answer</div>
      {data.map((r) => {
        const e = r.global_events;
        return (
          <div key={r.global_event_id} className="flex items-start justify-between gap-3 bg-background rounded-md border px-3 py-2">
            <div className="min-w-0 text-sm">
              <div className="font-medium">{e.title}
                <span className="text-muted-foreground font-normal text-xs">
                  {e.event_date ? ` · ${new Date(e.event_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}{e.rate_usd != null ? ` · $${e.rate_usd}` : ""}
                </span>
              </div>
              {e.brief_description && <div className="text-muted-foreground text-xs">{e.brief_description}</div>}
              {e.notes && <div className="text-xs mt-0.5 italic">{e.notes}</div>}
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" className="h-8 gap-1" title="Adds it to your product list right away — edit the details there like any other product" disabled={respond.isPending} onClick={() => respond.mutate({ eventId: e.id, status: "accepted" })}><Check className="h-3.5 w-3.5" /> Accept</Button>
              <Button size="sm" variant="outline" className="h-8 gap-1" title="Not running this at your hostel. Head office sees who declined." disabled={respond.isPending} onClick={() => respond.mutate({ eventId: e.id, status: "declined" })}><X className="h-3.5 w-3.5" /> Decline</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

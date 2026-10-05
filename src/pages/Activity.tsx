import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { timeAgo } from "@/lib/format";

interface AuditRow {
  id: number;
  table_name: string;
  action: string;
  changed_by: string | null;
  changed_at: string;
  changed_fields: string[];
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

const fmt = (v: unknown) => {
  if (v == null || v === "") return "∅";
  if (Array.isArray(v)) return v.length ? v.join(",") : "∅";
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
};

export default function Activity() {
  const auth = useAuth();
  const locId = auth.currentLocation?.id;

  const { data } = useQuery({
    queryKey: ["audit", locId],
    enabled: !!locId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("audit_log").select("*")
        .eq("location_id", locId!)
        .order("changed_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      const ids = [...new Set((rows ?? []).map((r) => r.changed_by).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        for (const p of profs ?? []) names[p.id] = p.full_name ?? "—";
      }
      return { rows: (rows ?? []) as AuditRow[], names };
    },
  });

  const rows = data?.rows ?? [];
  return (
    <div className="p-4 space-y-3 max-w-4xl">
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="text-sm text-muted-foreground -mt-2">
        Every change, who made it, and the before/after. This is the safety net — there is no approval gate.
      </p>
      <div className="border rounded-lg divide-y mm-stagger">
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No changes recorded yet for {auth.currentLocation?.name}.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {(r.new_values?.title as string) ?? (r.old_values?.title as string) ?? r.table_name}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                {data?.names[r.changed_by ?? ""] ?? "import"} · {timeAgo(r.changed_at)}
              </span>
            </div>
            {r.action === "INSERT" && <div className="text-muted-foreground">created</div>}
            {r.action === "DELETE" && <div className="text-[hsl(var(--st-remove))]">deleted</div>}
            {r.action === "UPDATE" && (
              <div className="space-y-0.5 mt-0.5">
                {r.changed_fields.map((f) => (
                  <div key={f} className="text-muted-foreground">
                    <span className="text-foreground">{f.replace(/_/g, " ")}</span>:{" "}
                    <span className="line-through decoration-[hsl(var(--st-remove))]/50">{fmt(r.old_values?.[f])}</span>
                    {" → "}
                    <span className="text-foreground">{fmt(r.new_values?.[f])}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

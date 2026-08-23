import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { CATEGORY_LABELS, STATUS_LABELS, type Category, type Product, type ProductStatus } from "@/lib/types";
import { daysLabel, shortTime, usd } from "@/lib/format";
import { StatusBadge } from "@/components/app/StatusBadge";
import { DayFilter, DaysPicker } from "@/components/app/DaysPicker";
import { InlineText } from "@/components/app/InlineCell";
import { ProductDrawer } from "@/components/app/ProductDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Plus, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

const PAGE = 50;

export default function Experiences() {
  const auth = useAuth();
  const qc = useQueryClient();
  const locId = auth.currentLocation?.id;
  const [category, setCategory] = useState<Category | "all">("all");
  const [status, setStatus] = useState<ProductStatus | "all">("all");
  const [day, setDay] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const key = ["products", locId, category, status, day, search, page];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!locId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("products").select("*", { count: "exact" }).eq("location_id", locId!);
      if (category !== "all") q = q.eq("category", category);
      if (status !== "all") q = q.eq("status", status);
      if (day) q = q.contains("days_of_week", [day]);
      if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);
      const { data, count, error } = await q
        .order("category").order("title")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Product[], count: count ?? 0 };
    },
  });

  const { data: exceptionCount } = useQuery({
    queryKey: ["exception-count", locId],
    enabled: !!locId,
    queryFn: async () => {
      const { count } = await supabase
        .from("import_exceptions")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locId!).eq("status", "open");
      return count ?? 0;
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Product> }) => {
      const { error } = await supabase.from("products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ rows: Product[]; count: number }>(key);
      if (prev) {
        qc.setQueryData(key, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        });
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(`Save failed: ${e.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  const commit = (id: string, patch: Partial<Product>) => update.mutate({ id, patch });
  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const canEdit = auth.isEditor;

  const openProduct = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Experiences</h1>
        <div className="flex items-center gap-2">
          {(exceptionCount ?? 0) > 0 && (
            <Link to="/settings/imports">
              <Button variant="outline" size="sm" className="gap-1.5 text-[hsl(var(--st-pending))]">
                <AlertTriangle className="h-3.5 w-3.5" /> {exceptionCount} to fix
              </Button>
            </Link>
          )}
          {canEdit && (
            <Link to="/experiences/new">
              <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add product</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search products…"
          className="w-52 h-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <Select value={category} onValueChange={(v) => { setCategory(v as Category | "all"); setPage(0); }}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v as ProductStatus | "all"); setPage(0); }}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <DayFilter value={day} onChange={(d) => { setDay(d); setPage(0); }} />
        <div className="ml-auto text-sm text-muted-foreground tabular-nums">
          {total} product{total === 1 ? "" : "s"}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-muted-foreground text-left">
                <th className="font-medium px-3 py-2.5 min-w-[260px] sticky left-0 bg-secondary z-10">Title</th>
                <th className="font-medium px-3 py-2.5">Category</th>
                <th className="font-medium px-3 py-2.5 text-right w-28">Rate</th>
                <th className="font-medium px-3 py-2.5 w-40">Days</th>
                <th className="font-medium px-3 py-2.5 w-28">Times</th>
                <th className="font-medium px-3 py-2.5 w-32">Status</th>
                <th className="font-medium px-3 py-2.5 w-24">Website</th>
                <th className="font-medium px-3 py-2.5 w-24">Active</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No products match.</td></tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className="border-t hover:bg-secondary/40 h-11">
                  <td className="px-3 py-1 sticky left-0 bg-background z-10">
                    <button
                      className="text-left font-medium hover:underline underline-offset-2 line-clamp-1"
                      onClick={() => setOpenId(p.id)}
                      title={p.title}
                    >
                      {p.title}
                    </button>
                  </td>
                  <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">{CATEGORY_LABELS[p.category]}</td>
                  <td className="px-3 py-1 w-28">
                    {canEdit ? (
                      <InlineText
                        numeric
                        confirmLargeChange
                        value={p.rate_usd != null ? String(p.rate_usd) : ""}
                        placeholder={p.rate_raw ? `“${p.rate_raw.slice(0, 14)}…”` : "—"}
                        onCommit={(v) => {
                          const n = v.trim() === "" ? null : Number(v);
                          if (v.trim() !== "" && !isFinite(n!)) { toast.error("Rate must be a number"); return; }
                          commit(p.id, { rate_usd: n });
                        }}
                      />
                    ) : <span className="tabular-nums block text-right">{usd(p.rate_usd)}</span>}
                  </td>
                  <td className="px-3 py-1">
                    {canEdit ? (
                      <Popover>
                        <PopoverTrigger className="text-left w-full hover:bg-secondary rounded px-1.5 py-0.5 whitespace-nowrap">
                          {daysLabel(p.days_of_week)}
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                          <DaysPicker value={p.days_of_week} onChange={(days) => commit(p.id, { days_of_week: days })} />
                        </PopoverContent>
                      </Popover>
                    ) : <span className="whitespace-nowrap">{daysLabel(p.days_of_week)}</span>}
                  </td>
                  <td className="px-3 py-1 text-muted-foreground whitespace-nowrap tabular-nums">
                    {p.starts_at ? `${shortTime(p.starts_at)}–${shortTime(p.ends_at)}` : "—"}
                  </td>
                  <td className="px-3 py-1">
                    {canEdit ? (
                      <Popover>
                        <PopoverTrigger><StatusBadge status={p.status} /></PopoverTrigger>
                        <PopoverContent className="w-40 p-1" align="start">
                          {(Object.keys(STATUS_LABELS) as ProductStatus[]).map((s) => (
                            <button
                              key={s}
                              className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary text-sm"
                              onClick={() => commit(p.id, {
                                status: s,
                                active_on_ground: s === "paused" ? false : p.active_on_ground,
                              })}
                            >
                              <StatusBadge status={s} />
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    ) : <StatusBadge status={p.status} />}
                  </td>
                  <td className="px-3 py-1">
                    <Switch
                      disabled={!canEdit}
                      checked={p.bookable_on_website}
                      onCheckedChange={(v) => commit(p.id, { bookable_on_website: v })}
                    />
                  </td>
                  <td className="px-3 py-1">
                    <Switch
                      disabled={!canEdit}
                      checked={p.active_on_ground}
                      onCheckedChange={(v) => commit(p.id, {
                        active_on_ground: v,
                        status: v ? (p.status === "paused" ? "active" : p.status) : "paused",
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
            <span className="text-muted-foreground tabular-nums">Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ProductDrawer
        product={openProduct}
        onClose={() => setOpenId(null)}
        onCommit={(patch) => openProduct && commit(openProduct.id, patch)}
        canEdit={canEdit}
      />
    </div>
  );
}

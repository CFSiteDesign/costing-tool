import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { CATEGORY_LABELS, STATUS_LABELS, type Category, type Product, type ProductStatus } from "@/lib/types";
import { daysLabel, shortTime, usd } from "@/lib/format";
import { StatusBadge } from "@/components/app/StatusBadge";
import { DayFilter, DaysPicker } from "@/components/app/DaysPicker";
import { RateCell } from "@/components/app/RateCell";
import { Tip, TipHead } from "@/components/app/Tip";
import { PendingGlobalEvents } from "@/components/app/PendingGlobalEvents";
import { AssetCell, type Asset } from "@/components/app/AssetCell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { Plus, ChevronLeft, ChevronRight, AlertTriangle, ShieldCheck } from "lucide-react";

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
  const [showExpired, setShowExpired] = useState(false);
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const key = ["products", locId, category, status, day, search, page, showExpired];
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
      if (!showExpired) q = q.or(`expires_on.is.null,expires_on.gte.${today}`);   // E3: expired drop out
      const { data, count, error } = await q
        .order("category").order("title")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Product[], count: count ?? 0 };
    },
  });

  const rowIds = (data?.rows ?? []).map((r) => r.id);
  const { data: assets } = useQuery({
    queryKey: ["assets", rowIds],
    enabled: rowIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("product_assets").select("*").in("product_id", rowIds).order("created_at", { ascending: false });
      const latest: Record<string, Asset> = {};
      for (const a of (data ?? []) as Asset[]) if (!latest[a.product_id]) latest[a.product_id] = a;
      return latest;
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

  return (
    <div className="p-4 space-y-3">
      <PendingGlobalEvents />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Experiences</h1>
          <div className="flex rounded-md border overflow-hidden text-sm">
            <span className="px-3 py-1.5 bg-primary text-primary-foreground font-medium">List</span>
            <Tip label="Day-by-day view of what runs this week, sorted by start time."><Link to="/week" className="px-3 py-1.5 text-muted-foreground hover:bg-secondary">Week</Link></Tip>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(exceptionCount ?? 0) > 0 && (
            <Tip label="Things the spreadsheet import couldn't read with confidence — mostly rates written as words. Click to work the list; most items are one tap.">
              <Link to="/settings/imports">
                <Button variant="outline" size="sm" className="gap-1.5 text-[hsl(var(--st-pending))]">
                  <AlertTriangle className="h-3.5 w-3.5" /> {exceptionCount} to fix
                </Button>
              </Link>
            </Tip>
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
        <Tip label="One-time events past their expiry date are hidden. Switch on to see them.">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
            <Switch checked={showExpired} onCheckedChange={(v) => { setShowExpired(v); setPage(0); }} /> Show expired
          </label>
        </Tip>
        <div className="ml-auto text-sm text-muted-foreground tabular-nums">
          {total} product{total === 1 ? "" : "s"}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-muted-foreground text-left">
                <th className="font-medium px-3 py-2.5 min-w-[260px] sticky left-0 bg-secondary z-10"><TipHead label="Title" tip="Click a name to open the full product page — every field editable, with a Save button." /></th>
                <th className="font-medium px-3 py-2.5"><TipHead label="Category" tip="MM Tours (MADFIVE), Nightly Events, 3rd Party Tours, One-Time Events, Transport. One-time events carry an expiry and drop off once it passes." /></th>
                <th className="font-medium px-3 py-2.5 text-right w-36"><TipHead label="Rate" tip="Local price with the USD figure alongside. Type either one — the other is worked out from today's FX rate. Quotes always use USD. Italic text means the spreadsheet had words instead of a number." /></th>
                <th className="font-medium px-3 py-2.5 w-40"><TipHead label="Days" tip="The days this runs. Click to change — this drives the 'what runs on a Monday?' filter and the quote builder." /></th>
                <th className="font-medium px-3 py-2.5 w-28"><TipHead label="Times" tip="Start and finish. Edit on the product page. Transport uses departure time slots instead." /></th>
                <th className="font-medium px-3 py-2.5 w-32"><TipHead label="Status" tip="Active, Paused, Signature Tour, or Pending update — same meanings as the old sheet's colours. Paused products stay here but drop out of the costing tool." /></th>
                <th className="font-medium px-3 py-2.5 w-24"><TipHead label="Website" tip="Marks this as listed on the Mad Monkey website. Not a live connection — the site itself is updated by hand. Changes to marked products queue an email to Reden so he knows what to update." /></th>
                <th className="font-medium px-3 py-2.5 w-24"><TipHead label="Active" tip="Running on the ground right now. Switching off pauses it everywhere — nothing is ever deleted." /></th>
                <th className="font-medium px-3 py-2.5 w-28"><TipHead label="Verified" tip="When someone last confirmed these details are current. Click the shield to mark it verified today." /></th>
                <th className="font-medium px-3 py-2.5 w-36"><TipHead label="Asset" tip="The social graphic for this experience. Create opens STUDIO prefilled; View shows the latest one; it flags itself out of date when the name, day, time or price change." /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">No products match.</td></tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className="border-t hover:bg-secondary/40 h-11">
                  <td className="px-3 py-1 sticky left-0 bg-background z-10">
                    <button
                      className="text-left font-medium hover:underline underline-offset-2 line-clamp-1"
                      onClick={() => nav(`/experiences/${p.id}`)}
                      title={p.title}
                    >
                      {p.title}
                    </button>
                  </td>
                  <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">{CATEGORY_LABELS[p.category]}</td>
                  <td className="px-3 py-1 w-36">
                    <RateCell product={p} currency={auth.currentLocation?.currency ?? "USD"} canEdit={canEdit}
                      onCommit={(patch) => commit(p.id, patch)} />
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
                    <Tip label={p.bookable_on_website
                      ? "Marked as listed on the website. Edits to this product queue an email to Reden — the site itself only changes when he updates it."
                      : "Marked as not on the website. Switching on queues a notification to Reden — it does not publish anything by itself."}>
                      <Switch
                        disabled={!canEdit}
                        checked={p.bookable_on_website}
                        onCheckedChange={(v) => commit(p.id, { bookable_on_website: v })}
                      />
                    </Tip>
                  </td>
                  <td className="px-3 py-1">
                    <Tip label={p.active_on_ground
                      ? "Running on the ground. Switch off to pause — it stays in the database but leaves the costing tool."
                      : "Paused. Switch on to reactivate."}>
                      <Switch
                        disabled={!canEdit}
                        checked={p.active_on_ground}
                        onCheckedChange={(v) => commit(p.id, {
                        active_on_ground: v,
                          status: v ? (p.status === "paused" ? "active" : p.status) : "paused",
                        })}
                      />
                    </Tip>
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs tabular-nums ${(p as unknown as { last_verified_at: string | null }).last_verified_at ? "text-muted-foreground" : "text-[hsl(var(--st-pending))]"}`}>
                        {(() => { const v = (p as unknown as { last_verified_at: string | null }).last_verified_at; return v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "never"; })()}
                      </span>
                      {canEdit && (
                        <Tip label="Mark verified today">
                          <button className="text-muted-foreground hover:text-[hsl(var(--st-active))]" onClick={async () => {
                            const { data: me } = await supabase.auth.getUser();
                            commit(p.id, { last_verified_at: new Date().toISOString(), last_verified_by: me.user?.id } as Partial<Product>);
                          }}><ShieldCheck className="h-3.5 w-3.5" /></button>
                        </Tip>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1">
                    <AssetCell product={p} asset={assets?.[p.id] ?? null} currency={auth.currentLocation?.currency ?? "USD"} canEdit={canEdit} />
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


    </div>
  );
}

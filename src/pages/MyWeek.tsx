import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { Product } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { usd } from "@/lib/format";
import { timeSpan } from "@/lib/clash";
import { money } from "@/lib/fx";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tip, TipHead } from "@/components/app/Tip";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Who runs it — the phase-2 "MM or third party" column. */
const RUN_BY: Record<Product["category"], string> = {
  mm_tour: "Mad Monkey", nightly_event: "Mad Monkey", third_party_tour: "Third party", one_time_event: "One-off", transport: "Transport",
};
/** Highlighted rows: Signature tours and Mad Monkey tours (phase 2). */
const isHighlight = (p: Product) => p.status === "signature" || p.category === "mm_tour";
const HI = "hsl(var(--st-signature))";

/** E1: the week, day by day — what runs at this hostel and when. Transport lives in its own tab. */
export default function MyWeek() {
  const auth = useAuth();
  const nav = useNavigate();
  const locId = auth.currentLocation?.id;
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => plus(weekStart, i)), [weekStart]);
  const today = iso(new Date());

  const { data } = useQuery({
    queryKey: ["my-week", locId, iso(weekStart)],
    enabled: !!locId,
    queryFn: async () => {
      const from = iso(days[0]), to = iso(days[6]);
      const [{ data: products }, { data: rules }] = await Promise.all([
        supabase.from("products").select("*").eq("location_id", locId!).eq("active_on_ground", true)
          .neq("status", "paused").neq("category", "transport")   // phase 2: transport has its own tab
          .or(`expires_on.is.null,expires_on.gte.${today}`),
        supabase.from("product_date_rules").select("product_id, starts_on, ends_on")
          .gte("starts_on", from).lte("starts_on", to),
      ]);
      return { products: (products ?? []) as Product[], rules: rules ?? [] };
    },
  });

  const rowsFor = (d: Date) => {
    const weekday = ((d.getDay() + 6) % 7) + 1;
    const dateStr = iso(d);
    const dated = new Set((data?.rules ?? []).filter((r) => r.starts_on === dateStr).map((r) => r.product_id));
    return (data?.products ?? [])
      .filter((p) => (p.category !== "one_time_event" && p.days_of_week.includes(weekday)) || dated.has(p.id))
      .sort((a, b) => (a.starts_at ?? "99").localeCompare(b.starts_at ?? "99") || a.title.localeCompare(b.title));
  };

  const ccy = auth.currentLocation?.currency ?? "USD";
  const price = (p: Product) =>
    p.rate_usd == null ? <span className="text-[hsl(var(--st-pending))] text-xs">no rate</span>
      : p.rate_usd === 0 ? "Free"
      : ccy !== "USD" && p.local_amount != null ? <>{money(p.local_amount, ccy)} <span className="text-muted-foreground">· {usd(p.rate_usd)}</span></>
      : usd(p.rate_usd);

  const DayCell = ({ i, d, isToday }: { i: number; d: Date; isToday: boolean }) => (
    <>{DAY_NAMES[i]}<div className="text-xs text-muted-foreground font-normal">{d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>{isToday && <div className="text-[10px] uppercase tracking-wide" style={{ color: HI }}>today</div>}</>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">My week</h1>
          <div className="flex rounded-md border overflow-hidden text-sm">
            <Tip label="Back to the full product list"><Link to="/experiences" className="px-3 py-1.5 text-muted-foreground hover:bg-secondary">List</Link></Tip>
            <span className="px-3 py-1.5 bg-primary text-primary-foreground font-medium">Week</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Tip label="Previous week"><Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart(plus(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button></Tip>
          <Tip label="Jump back to the current week"><Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</Button></Tip>
          <Tip label="Next week"><Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart(plus(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button></Tip>
          <span className="ml-2 text-sm text-muted-foreground tabular-nums">
            {days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {days[6].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary text-muted-foreground text-left">
              <th className="font-medium px-3 py-2.5 w-36">Day</th>
              <th className="font-medium px-3 py-2.5"><TipHead label="Experience" tip="Everything running at this hostel that day, sorted by start time. Daily tours appear on every day they run; one-off and global events on their date. Click to open. Highlighted rows are Mad Monkey tours and Signature tours." /></th>
              <th className="font-medium px-3 py-2.5 w-40"><TipHead label="Category" tip="What kind of product it is and who runs it: Mad Monkey (MM tours, nightly events) or a third-party operator." /></th>
              <th className="font-medium px-3 py-2.5 w-28"><TipHead label="Time" tip="Start–finish. Finish is worked out from the duration when no finish time is set." /></th>
              <th className="font-medium px-3 py-2.5 w-40 text-right"><TipHead label="Price" tip="Local price with USD alongside. Quotes always use USD." /></th>
              <th className="font-medium px-3 py-2.5 w-32">Status</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => {
              const rows = rowsFor(d);
              const isToday = iso(d) === today;
              return rows.length === 0 ? (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2.5 align-top font-medium"><DayCell i={i} d={d} isToday={isToday} /></td>
                  <td colSpan={5} className="px-3 py-2.5 text-muted-foreground italic">Nothing scheduled</td>
                </tr>
              ) : rows.map((p, j) => {
                const hi = isHighlight(p);
                return (
                  <tr key={p.id + i} className={`${j === 0 ? "border-t" : ""} hover:bg-secondary/40 cursor-pointer`} style={hi ? { background: "hsl(var(--st-signature) / 0.07)" } : undefined} onClick={() => nav(`/experiences/${p.id}`)}>
                    <td className="px-3 py-2 align-top font-medium bg-background">{j === 0 && <DayCell i={i} d={d} isToday={isToday} />}</td>
                    <td className="px-3 py-2" style={hi ? { boxShadow: `inset 3px 0 0 ${HI}` } : undefined}>
                      <div className="font-medium flex items-center gap-1.5">
                        {hi && <Tip label={p.status === "signature" ? "Signature tour" : "Mad Monkey tour"}><Star className="h-3.5 w-3.5 shrink-0" style={{ color: HI, fill: HI }} /></Tip>}
                        {p.title}
                      </div>
                      {p.category === "one_time_event" && <div className="text-xs text-muted-foreground">one-off</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div>{CATEGORY_LABELS[p.category]}</div>
                      <div className="text-xs text-muted-foreground">{RUN_BY[p.category]}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">{timeSpan(p) || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{price(p)}</td>
                    <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Daily tours appear under every day they run. One-off and global events appear on their date. Expired events are hidden. Highlighted rows are Mad Monkey tours and Signature tours. Transport is not shown here — it has its own <Link to="/transport" className="underline underline-offset-2">Transport</Link> tab.</p>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { Product } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { usd } from "@/lib/format";
import { timeSpan } from "@/lib/clash";
import { money } from "@/lib/fx";
import { iso, mondayOf, plus, DAY_NAMES, weekdayOf, MAX_KEY_PER_DAY, useWeek } from "@/lib/week";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tip, TipHead } from "@/components/app/Tip";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Star, Zap, Smartphone } from "lucide-react";

/** Who runs it - the phase-2 "MM or third party" column. */
const RUN_BY: Record<Product["category"], string> = {
  mm_tour: "Mad Monkey", nightly_event: "Mad Monkey", third_party_tour: "Third party", one_time_event: "One-off", transport: "Transport",
};
/** Highlighted rows: Signature tours and Mad Monkey tours (phase 2). */
const isHighlight = (p: Product) => p.status === "signature" || p.category === "mm_tour";
const HI = "hsl(var(--st-signature))";

/** E1: the week, day by day - what runs at this hostel and when. Transport lives in its own tab. */
export default function MyWeek() {
  const auth = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const locId = auth.currentLocation?.id;
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const { days, today, rowsFor, keysFor, isKey } = useWeek(locId, weekStart);
  const canKey = auth.isEditor;

  /** Key events: up to 3 per day, and they repeat every week on that weekday until removed. */
  const toggleKey = useMutation({
    mutationFn: async ({ p, d, on }: { p: Product; d: Date; on: boolean }) => {
      const weekday = weekdayOf(d);
      const { error } = on
        ? await supabase.from("product_key_days").insert({ product_id: p.id, weekday, location_id: p.location_id })
        : await supabase.from("product_key_days").delete().eq("product_id", p.id).eq("weekday", weekday);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-week"] }),
    onError: (e: Error) => toast.error(e.message.includes("Three key events") ? `Three key events already on that day. Remove one first.` : e.message),
  });

  const ccy = auth.currentLocation?.currency ?? "USD";
  const price = (p: Product) =>
    p.rate_usd == null ? <span className="text-[hsl(var(--st-pending))] text-xs">no rate</span>
      : p.rate_usd === 0 ? "Free"
      : ccy !== "USD" && p.local_amount != null ? <>{money(p.local_amount, ccy)} <span className="text-muted-foreground">· {usd(p.rate_usd)}</span></>
      : usd(p.rate_usd);

  const DayCell = ({ i, d, isToday }: { i: number; d: Date; isToday: boolean }) => (
    <>{DAY_NAMES[i]}<div className="text-xs text-muted-foreground font-normal">{d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>{isToday && <div className="text-[10px] uppercase tracking-wide" style={{ color: HI }}>today</div>}
      {keysFor(d).length > 0 && <div className="text-[10px] font-normal text-muted-foreground mt-0.5">{keysFor(d).length} of {MAX_KEY_PER_DAY} key</div>}</>
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
          <Tip label="Build this week's Instagram story (1080 x 1920) from the key events.">
            <Button size="sm" className="h-8 gap-1.5 ml-2" onClick={() => nav(`/week/story?week=${iso(weekStart)}`)}><Smartphone className="h-4 w-4" /> Weekly story</Button>
          </Tip>
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
              <th className="font-medium px-3 py-2.5 w-24 text-center"><TipHead label="Key" tip={`Up to ${MAX_KEY_PER_DAY} key events a day. They go on the weekly story, and stay key on that day every week until you turn them off.`} /></th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => {
              const rows = rowsFor(d);
              const isToday = iso(d) === today;
              return rows.length === 0 ? (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2.5 align-top font-medium"><DayCell i={i} d={d} isToday={isToday} /></td>
                  <td colSpan={6} className="px-3 py-2.5 text-muted-foreground italic">Nothing scheduled</td>
                </tr>
              ) : rows.map((p, j) => {
                const hi = isHighlight(p);
                const key = isKey(p, d);
                const full = !key && keysFor(d).length >= MAX_KEY_PER_DAY;
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
                    <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      {canKey ? (
                        <Tip label={key ? `Key event every ${DAY_NAMES[i]}. Click to remove.` : full ? `Already ${MAX_KEY_PER_DAY} key events on ${DAY_NAMES[i]}. Remove one first.` : `Make this a key event every ${DAY_NAMES[i]}`}>
                          <button type="button" aria-pressed={key} aria-label={key ? "Remove key event" : "Make key event"} disabled={toggleKey.isPending || full}
                            onClick={() => toggleKey.mutate({ p, d, on: !key })}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${key ? "bg-accent text-accent-foreground" : full ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                            <Zap className={`h-3.5 w-3.5 ${key ? "fill-current" : ""}`} /> Key
                          </button>
                        </Tip>
                      ) : key ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase"><Zap className="h-3.5 w-3.5 fill-current" /> Key</span> : null}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Mark up to {MAX_KEY_PER_DAY} key events a day; they feed the weekly story. Daily tours appear under every day they run. One-off and global events appear on their date. Expired events are hidden. Highlighted rows are Mad Monkey tours and Signature tours. Transport is not shown here - it has its own <Link to="/transport" className="underline underline-offset-2">Transport</Link> tab.</p>
    </div>
  );
}

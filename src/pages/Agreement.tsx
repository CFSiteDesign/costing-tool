import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usd, shortTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

interface FrozenLine {
  id: string; day_id: string | null; kind: string; title: string; description: string | null;
  starts_at: string | null; ends_at: string | null; room_type_name?: string | null;
}
interface FrozenDay { id: string; day_no: number; date: string | null; location_name: string | null; }

export default function Agreement() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["agreement", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_agreement", { p_slug: slug });
      if (error) throw error;
      return data as {
        quote_title: string; quote_reference: string; version_no: number; created_at: string;
        pax_count: number; total_usd: number; per_person_usd: number; terms_block: string | null;
        customer: { contact_name?: string; company_name?: string } | null;
        days: FrozenDay[]; lines: FrozenLine[];
      } | null;
    },
  });

  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!data) return <div className="min-h-screen grid place-items-center text-muted-foreground">This agreement link isn’t valid.</div>;

  const linesFor = (dayId: string | null) => data.lines.filter((l) => l.day_id === dayId);
  const generalLines = linesFor(null);

  return (
    <div className="min-h-screen bg-secondary/40 py-8 px-4 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto bg-background border rounded-lg overflow-hidden shadow-sm print:border-0 print:shadow-none">
        {/* locked branded header */}
        <div className="bg-[#1A1A18] text-white px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-[#FFC72C] grid place-items-center font-bold text-[#1A1A18] text-lg">M</div>
            <div>
              <div className="font-semibold text-lg leading-tight">Mad Monkey</div>
              <div className="text-xs text-white/70">Group Trip Agreement</div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="tabular-nums">{data.quote_reference} · v{data.version_no}</div>
            <div className="text-white/70 text-xs">{new Date(data.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">{data.quote_title}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {data.customer?.contact_name && <>Prepared for {data.customer.contact_name}{data.customer.company_name ? `, ${data.customer.company_name}` : ""} · </>}
              {data.pax_count} travellers
            </p>
          </div>

          {data.days.map((d) => (
            <section key={d.id}>
              <h2 className="font-semibold text-[15px] border-b pb-1.5 mb-2">
                Day {d.day_no}{d.location_name ? ` — ${d.location_name}` : ""}
                {d.date && <span className="text-muted-foreground font-normal text-sm"> · {new Date(d.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>}
              </h2>
              <div className="space-y-2.5">
                {linesFor(d.id).map((l) => (
                  <div key={l.id} className="flex gap-3">
                    <div className="w-24 shrink-0 text-sm text-muted-foreground tabular-nums pt-0.5">
                      {l.starts_at ? `${shortTime(l.starts_at)}${l.ends_at ? ` – ${shortTime(l.ends_at)}` : ""}` : ""}
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {l.title}{l.room_type_name && !l.title.includes(l.room_type_name) ? ` · ${l.room_type_name}` : ""}
                      </div>
                      {l.description && <div className="text-sm text-muted-foreground">{l.description}</div>}
                    </div>
                  </div>
                ))}
                {linesFor(d.id).length === 0 && <div className="text-sm text-muted-foreground italic">Free day</div>}
              </div>
            </section>
          ))}

          {generalLines.length > 0 && (
            <section>
              <h2 className="font-semibold text-[15px] border-b pb-1.5 mb-2">Also included</h2>
              <div className="space-y-1.5">
                {generalLines.map((l) => (
                  <div key={l.id} className="text-sm"><span className="font-medium">{l.title}</span>
                    {l.description && <span className="text-muted-foreground"> — {l.description}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* totals only — no line-item breakdown, per the brief */}
          <section className="bg-secondary/60 rounded-lg p-5 flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Per person</div>
              <div className="text-xl font-semibold tabular-nums">{usd(data.per_person_usd)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Group total · {data.pax_count} pax</div>
              <div className="text-2xl font-semibold tabular-nums">{usd(data.total_usd)}</div>
            </div>
          </section>

          <section className="text-xs text-muted-foreground leading-relaxed border-t pt-4 whitespace-pre-line">
            {data.terms_block ?? `Prices are quoted in USD and held for 14 days from the date of this agreement. A revised version will be issued for any change of dates, party size, or itinerary. Payment terms and cancellation policy to be confirmed at booking.`}
          </section>
        </div>
      </div>
      <div className="max-w-3xl mx-auto mt-4 flex justify-end no-print">
        <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
          <Printer className="h-4 w-4" /> Print / save PDF
        </Button>
      </div>
    </div>
  );
}

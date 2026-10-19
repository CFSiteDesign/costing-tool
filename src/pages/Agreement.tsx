import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

interface FrozenLine {
  id: string; day_id: string | null; kind: string; title: string; description: string | null;
  room_type_name?: string | null; notes?: string | null;
}
interface FrozenDay { id: string; day_no: number; date: string | null; location_name: string | null; notes?: string | null; }

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
        subtotal_usd: number; discount_total_usd: number; booking_notes?: string | null;
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
          <div className="space-y-1">
            <img src="/mm-logo-white.png" alt="Mad Monkey" className="h-9 w-auto" />
            <div className="text-xs text-white/70">Group Trip Agreement</div>
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

          {data.booking_notes && (
            <section className="rounded-md border-l-4 border-[#1A1A18] bg-secondary/50 px-4 py-3 text-sm whitespace-pre-line">{data.booking_notes}</section>
          )}

          {data.days.map((d) => (
            <section key={d.id}>
              <h2 className="font-semibold text-[15px] border-b pb-1.5 mb-2">
                Day {d.day_no}{d.location_name ? ` — ${d.location_name}` : ""}
                {d.date && <span className="text-muted-foreground font-normal text-sm"> · {new Date(d.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>}
              </h2>
              {d.notes && <p className="text-sm text-muted-foreground italic whitespace-pre-line mb-2">{d.notes}</p>}
              <div className="space-y-2.5">
                {linesFor(d.id).map((l) => (
                  <div key={l.id} className="flex gap-2.5">
                    <span className="text-muted-foreground/50 pt-[3px] leading-none">•</span>
                    <div>
                      <div className="font-medium text-sm">
                        {l.title}{l.room_type_name && !l.title.includes(l.room_type_name) ? ` · ${l.room_type_name}` : ""}
                      </div>
                      {l.description && <div className="text-sm text-muted-foreground">{l.description}</div>}
                      {l.notes && <div className="text-sm italic whitespace-pre-line">Note: {l.notes}</div>}
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
                    {l.notes && <div className="italic whitespace-pre-line">Note: {l.notes}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* totals only — no line-item breakdown, per the brief */}
          <section className="bg-secondary/60 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Per person</div>
                <div className="text-xl font-semibold tabular-nums">{usd(data.per_person_usd)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Group total · {data.pax_count} pax</div>
                <div className="text-2xl font-semibold tabular-nums">{usd(data.total_usd)}</div>
              </div>
            </div>
            {Number(data.discount_total_usd) > 0 && (
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground line-through tabular-nums">{usd(data.subtotal_usd)}</span>
                <span className="font-semibold text-[hsl(var(--st-active))]">
                  You save {usd(data.discount_total_usd)}
                </span>
              </div>
            )}
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

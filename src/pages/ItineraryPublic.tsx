import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ItineraryDoc, ItineraryBlock } from "@/lib/itinerary";
import { fmtDayDate } from "@/lib/itinerary";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

/** The asset: the Mad Monkey itinerary, on screen and on paper. Real logo file top-left of every printed sheet. */
export default function ItineraryPublic() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["itinerary", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_itinerary", { p_slug: slug });
      if (error) throw error;
      return data as { doc: ItineraryDoc; updated_at: string; quote_title: string; quote_reference: string; pax: number } | null;
    },
  });
  useEffect(() => {
    if (document.getElementById("mm-montserrat")) return;
    const l = document.createElement("link"); l.id = "mm-montserrat"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap"; document.head.appendChild(l);
  }, []);

  if (isLoading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!data || !data.doc?.days) return <div className="min-h-screen grid place-items-center text-muted-foreground">This itinerary link isn’t valid.</div>;
  return <ItineraryDocument doc={data.doc} pax={data.pax} reference={data.quote_reference} updatedAt={data.updated_at} />;
}

const List = ({ items }: { items: string[] }) => items.length ? <ul className="space-y-1">{items.map((x, i) => <li key={i} className="pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[0.55em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[#1A1A18]">{x}</li>)}</ul> : null;

export function ItineraryDocument({ doc, pax, reference, updatedAt, showPrint = true }: { doc: ItineraryDoc; pax?: number; reference?: string; updatedAt?: string; showPrint?: boolean }) {
  return (
    <div className="it-root min-h-screen bg-[#f4f3ef] print:bg-white" style={{ fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`
        @page { size: A4; margin: 12mm 14mm 16mm; }
        @media print {
          .it-root { background: white !important; }
          .it-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; max-width: none !important; }
          .it-page-head { display: table-header-group; }
          .it-block, .it-day-head, .it-list { break-inside: avoid; }
          .no-print { display: none !important; }
        }
        .it-doc thead td { padding: 0 0 6mm 0; }
      `}</style>
      {showPrint && (
        <div className="no-print max-w-[210mm] mx-auto pt-4 px-4 flex justify-end">
          <Button size="sm" variant="outline" className="gap-1.5 bg-white" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button>
        </div>
      )}
      <div className="it-sheet max-w-[210mm] mx-auto my-4 bg-white border shadow-sm px-[14mm] py-[12mm] text-[#1A1A18] text-[13.5px] leading-relaxed">
        {/* a table so the logo row repeats at the top of every printed sheet */}
        <table className="it-doc w-full border-collapse">
          <thead className="it-page-head">
            <tr><td>
              <div className="flex items-center justify-between">
                <img src="/mm-logo.png" alt="Mad Monkey" className="h-12 w-auto" />
                <div className="text-[11px] text-[#6c6c6c] text-right uppercase tracking-wider">Detailed itinerary{reference ? ` · ${reference}` : ""}</div>
              </div>
            </td></tr>
          </thead>
          <tbody>
            <tr><td>
              {/* header */}
              <div className="mt-2 mb-6">
                <h1 className="text-[30px] leading-[1.1] font-extrabold tracking-tight">{doc.title}</h1>
                {doc.subtitle && <p className="text-[15px] font-semibold text-[#6c6c6c] mt-1">{doc.subtitle}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wider">
                  {doc.nights ? <span className="rounded-full bg-[#1A1A18] text-white px-2.5 py-1">{doc.nights} nights</span> : null}
                  {doc.route?.length ? <span className="rounded-full bg-[#d9f99d] px-2.5 py-1">{doc.route.join(" · ")}</span> : null}
                  {pax ? <span className="rounded-full border border-[#1A1A18]/20 px-2.5 py-1">{pax} travellers</span> : null}
                </div>
                {doc.intro && <p className="mt-4 text-[14px]">{doc.intro}</p>}
              </div>

              {/* inclusions grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 mb-8 max-sm:grid-cols-1">
                {doc.inclusions?.length > 0 && <section className="it-list"><h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 pb-1 border-b-2 border-[#1A1A18]">Package inclusions</h2><List items={doc.inclusions} /></section>}
                {doc.not_included?.length > 0 && <section className="it-list"><h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 pb-1 border-b-2 border-[#1A1A18]">Not included</h2><List items={doc.not_included} /></section>}
                {doc.optional_extras?.length > 0 && <section className="it-list"><h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 pb-1 border-b-2 border-[#1A1A18]">Optional extras</h2><List items={doc.optional_extras} /></section>}
                {doc.transfers?.length > 0 && <section className="it-list"><h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 pb-1 border-b-2 border-[#1A1A18]">Transfers</h2><List items={doc.transfers} /></section>}
              </div>

              {/* days */}
              {doc.days.map((d) => (
                <section key={d.day_no} className="mb-7">
                  <div className="it-day-head flex items-baseline gap-3 mb-2 pb-1.5 border-b-2 border-[#1A1A18]">
                    <span className="rounded-md bg-[#1A1A18] text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1">Day {d.day_no}</span>
                    <h2 className="text-[18px] font-extrabold tracking-tight">{d.title || d.hostel}</h2>
                    <span className="ml-auto text-[11px] text-[#6c6c6c] font-semibold uppercase tracking-wider">{fmtDayDate(d.date) ?? d.hostel}</span>
                  </div>
                  {d.intro && <p className="mb-2">{d.intro}</p>}
                  {d.highlights?.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1"><span className="bg-[#d9f99d] px-1.5 py-0.5 rounded">Today’s highlights</span></div>
                      <List items={d.highlights} />
                    </div>
                  )}
                  {d.vibe && (
                    <div className="mb-2">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1"><span className="bg-[#d9f99d] px-1.5 py-0.5 rounded">The vibe</span></div>
                      <p className="italic">{d.vibe}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {d.blocks.map((b) => <Block key={b.id} b={b} />)}
                  </div>
                  {d.accommodation && <p className="mt-2.5 text-[12.5px]"><span className="font-bold uppercase tracking-wider text-[10.5px] mr-1.5">Accommodation</span> {d.accommodation}</p>}
                  {d.notes?.length > 0 && <div className="mt-1.5 text-[12px] text-[#6c6c6c]">{d.notes.map((n, i) => <p key={i}>Note: {n}</p>)}</div>}
                </section>
              ))}

              {doc.closing && <p className="mt-6 pt-4 border-t text-[14px] font-medium">{doc.closing}</p>}
              <p className="mt-6 text-[10.5px] text-[#6c6c6c]">Mad Monkey Hostels · Group trips{updatedAt ? ` · itinerary updated ${new Date(updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}</p>
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Block({ b }: { b: ItineraryBlock }) {
  const hasImage = !!b.photo_url;
  return (
    <div className={`it-block grid gap-3 ${hasImage ? "grid-cols-[4.5rem_1fr_9rem]" : "grid-cols-[4.5rem_1fr]"}`}>
      <div className="text-[13px] font-bold tabular-nums pt-0.5">{b.time}</div>
      <div className="min-w-0">
        <div className="font-bold">{b.title}</div>
        {b.body && <p className="mt-0.5">{b.body}</p>}
        {b.bullets?.length > 0 && <List items={b.bullets} />}
        {b.highlights?.length > 0 && (
          <div className="mt-2">
            <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1"><span className="bg-[#d9f99d] px-1.5 py-0.5 rounded">Today’s highlights</span></div>
            <List items={b.highlights} />
          </div>
        )}
        {b.vibe && (
          <div className="mt-2">
            <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1"><span className="bg-[#d9f99d] px-1.5 py-0.5 rounded">The vibe</span></div>
            <p className="italic">{b.vibe}</p>
          </div>
        )}
      </div>
      {hasImage && <img src={b.photo_url!} alt="" className="h-24 w-36 object-cover rounded-md border" />}
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usd } from "@/lib/format";
import { lineBase, lineTotal, type PricedLine } from "@/pricing/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/app/Tip";
import { toast } from "sonner";
import { ArrowLeft, Download, Plus, Trash2, Save } from "lucide-react";

/**
 * Booking request (quote feedback, 16 Oct 2026): the internal document Reservations books from, once a quote is
 * accepted. Everything is pulled from the accepted (frozen) version; the details the quote doesn't hold (agent,
 * guests, nationality, payment deadline) are asked for here. Every field is optional (blank shows "TBC") and
 * editable before downloading. Original rates and totals are shown, with discounts listed separately.
 * A daily job (booking-reminders) emails the Mad Monkey contact 7 days before the deadline unless marked paid.
 */

interface VDay { id: string; day_no: number; date: string | null; location_name: string | null; notes?: string | null }
interface VLine {
  id: string; day_id: string | null; kind: PricedLine["kind"]; title: string; notes?: string | null;
  qty: number; unit_price_usd: number; per_person: boolean; pax: number | null;
  discount_pct: number | null; discount_amount_usd: number | null; is_comp: boolean; sort_order: number;
}
interface Version {
  id: string; version_no: number; pax_count: number; days: VDay[]; lines: VLine[];
  subtotal_usd: number; total_usd: number; booking_notes: string | null;
  quote_discount_pct: number | null; quote_discount_amount_usd: number | null;
}
interface Guest { name: string; nationality: string; email: string; whatsapp: string }
interface Details {
  date_requested: string; agent_company: string; agent_contact_name: string; agent_contact_email: string;
  mm_contact_name: string; mm_contact_email: string; total_guests: string; guests: Guest[];
  payment_deadline: string; payment_terms: string; reservations_notes: string;
}

const DEFAULT_TERMS = "Deposit: None required. Full payment due by the deadline.";
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (iso: string) => new Date(iso + "T00:00:00");
const shift = (iso: string, n: number) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const long = (iso: string) => parse(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const short = (iso: string) => parse(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400e3);
/** 18–27 January 2027 · 28 January – 3 February 2027 · 28 December 2026 – 4 January 2027 */
function range(a: string, b: string) {
  const x = parse(a), y = parse(b);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
  if (x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth()) return `${x.getDate()}–${y.getDate()} ${month(y)} ${y.getFullYear()}`;
  if (x.getFullYear() === y.getFullYear()) return `${x.getDate()} ${month(x)} – ${y.getDate()} ${month(y)} ${y.getFullYear()}`;
  return `${long(a)} – ${long(b)}`;
}
const priced = (l: VLine): PricedLine => ({
  kind: l.kind, qty: Number(l.qty), unit_price_usd: Number(l.unit_price_usd), per_person: l.per_person, pax: l.pax,
  discount_pct: l.discount_pct == null ? null : Number(l.discount_pct),
  discount_amount_usd: l.discount_amount_usd == null ? null : Number(l.discount_amount_usd), is_comp: l.is_comp,
});
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ── the document, worked out from the frozen version ───────────────────────────── */
interface Row { desc: string; note?: string | null; qty: string; rate: string; total: number }
interface Group { location: string; stays: Row[]; tours: Row[]; other: Row[]; checkIn: string | null; checkOut: string | null }

function build(v: Version) {
  const pax = v.pax_count;
  const people = (l: VLine) => (l.per_person ? (l.pax ?? pax) : 1);
  const base = (l: VLine) => lineBase(priced(l), pax);
  const days = [...v.days].sort((a, b) => a.day_no - b.day_no);
  const byDay = new Map<string | null, VLine[]>();
  for (const l of [...v.lines].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!byDay.has(l.day_id)) byDay.set(l.day_id, []);
    byDay.get(l.day_id)!.push(l);
  }

  // consecutive days in the same place form one destination block
  const blocks: { location: string; days: VDay[] }[] = [];
  for (const d of days) {
    const loc = d.location_name ?? "No location";
    const last = blocks[blocks.length - 1];
    if (last && last.location === loc) last.days.push(d); else blocks.push({ location: loc, days: [d] });
  }

  const groups: Group[] = blocks.map((b) => {
    const stays = new Map<string, { l: VLine; n: number; total: number }>();
    const accDates: string[] = [];
    const tours: Row[] = [], other: Row[] = [];
    for (const d of b.days) {
      for (const l of byDay.get(d.id) ?? []) {
        if (l.kind === "accommodation" || l.kind === "breakfast") {
          const key = `${l.kind}|${l.title}|${l.unit_price_usd}|${l.per_person}|${l.pax ?? ""}`;
          const s = stays.get(key) ?? { l, n: 0, total: 0 };
          s.n += Number(l.qty); s.total = r2(s.total + base(l));
          stays.set(key, s);
          if (l.kind === "accommodation" && d.date) accDates.push(d.date);
        } else {
          const row: Row = {
            desc: `${l.title}${d.date ? ` (${short(d.date)})` : ""}`, note: l.notes,
            qty: l.per_person ? `${people(l)} pax${Number(l.qty) > 1 ? ` × ${l.qty}` : ""}` : `${l.qty}`,
            rate: l.per_person ? `${usd(Number(l.unit_price_usd))} pp` : `${usd(Number(l.unit_price_usd))} each`,
            total: base(l),
          };
          (l.kind === "custom" ? other : tours).push(row);
        }
      }
    }
    const stayRows: Row[] = [...stays.values()].map(({ l, n, total }) => {
      const night = l.kind === "breakfast" ? "day" : "night";
      return {
        desc: l.title, note: l.notes,
        qty: l.per_person ? `${people(l)} pax × ${n} ${night}${n === 1 ? "" : "s"}` : `${n} ${night}${n === 1 ? "" : "s"}`,
        rate: l.per_person ? `${usd(Number(l.unit_price_usd))} pp/${night}` : `${usd(Number(l.unit_price_usd))} / ${night}`,
        total,
      };
    });
    accDates.sort();
    return {
      location: b.location, stays: stayRows, tours, other,
      checkIn: accDates[0] ?? null, checkOut: accDates.length ? shift(accDates[accDates.length - 1], 1) : null,
    };
  });

  const tripWide = byDay.get(null) ?? [];
  if (tripWide.length) groups.push({
    location: "Whole trip", stays: [], tours: [], checkIn: null, checkOut: null,
    other: tripWide.map((l) => ({
      desc: l.title, note: l.notes,
      qty: l.per_person ? `${people(l)} pax${Number(l.qty) > 1 ? ` × ${l.qty}` : ""}` : `${l.qty}`,
      rate: l.per_person ? `${usd(Number(l.unit_price_usd))} pp` : `${usd(Number(l.unit_price_usd))} each`, total: base(l),
    })),
  });

  const sum = (kinds: string[]) => r2(v.lines.filter((l) => kinds.includes(l.kind)).reduce((t, l) => t + base(l), 0));
  const discounts = v.lines
    .map((l) => ({ l, off: r2(base(l) - lineTotal(priced(l), pax)) }))
    .filter((x) => x.off > 0.004)
    .map(({ l, off }) => ({ label: l.is_comp ? `Comp: ${l.title}` : `Discount: ${l.title}${l.discount_pct ? ` (${Number(l.discount_pct)}%)` : ""}`, amount: off }));
  const afterLines = r2(v.lines.reduce((t, l) => t + lineTotal(priced(l), pax), 0));
  const pkg = r2(afterLines - Number(v.total_usd));
  const pct = v.quote_discount_pct ? Number(v.quote_discount_pct) : null;

  const dated = days.filter((d) => d.date).map((d) => d.date!) ;
  const lastCheckout = groups.map((g) => g.checkOut).filter(Boolean).sort().pop() ?? null;
  const start = dated[0] ?? null;
  const end = [lastCheckout, dated[dated.length - 1]].filter(Boolean).sort().pop() ?? null;

  return {
    groups, start, end,
    destinations: [...new Set(blocks.map((b) => b.location).filter((x) => x !== "No location"))].join(", "),
    totals: {
      accommodation: sum(["accommodation"]), breakfast: sum(["breakfast"]), tours: sum(["experience", "transport"]),
      other: sum(["custom"]), subtotal: r2(v.lines.reduce((t, l) => t + base(l), 0)), discounts,
      pkg: pkg > 0.004 ? { label: pct ? `${pct}% package discount` : "Package discount", amount: pkg } : null,
      final: Number(v.total_usd),
    },
  };
}

function defaults(v: Version, q: { customers: Record<string, string> | null }, owner: { full_name: string | null; email: string | null } | null): Details {
  const b = build(v);
  const days = [...v.days].sort((a, x) => a.day_no - x.day_no);
  const notes = [
    v.booking_notes?.trim(),
    ...days.filter((d) => d.notes?.trim()).map((d) => `Day ${d.day_no}${d.date ? ` (${short(d.date)})` : ""}: ${d.notes!.trim()}`),
    ...v.lines.filter((l) => l.notes?.trim()).map((l) => `${l.title}: ${l.notes!.trim()}`),
  ].filter(Boolean).join("\n");
  return {
    date_requested: isoOf(new Date()),
    agent_company: q.customers?.company_name ?? "",
    agent_contact_name: q.customers?.contact_name ?? "",
    agent_contact_email: q.customers?.email ?? "",
    mm_contact_name: owner?.full_name ?? "",
    mm_contact_email: owner?.email ?? "",
    total_guests: `${v.pax_count} adult${v.pax_count === 1 ? "" : "s"}`,
    guests: Array.from({ length: Math.max(1, v.pax_count) }, () => ({ name: "", nationality: "", email: "", whatsapp: "" })),
    payment_deadline: b.start ? shift(b.start, -30) : "",
    payment_terms: DEFAULT_TERMS,
    reservations_notes: notes,
  };
}

const TBC = () => <span className="tbc">TBC</span>;
const val = (s: string) => (s.trim() ? s : <TBC />);

function BookingDoc({ v, d, reference }: { v: Version; d: Details; reference: string }) {
  const b = useMemo(() => build(v), [v]);
  const before = d.payment_deadline && b.start ? daysBetween(d.payment_deadline, b.start) : null;
  const guests = d.guests.length ? d.guests : [{ name: "", nationality: "", email: "", whatsapp: "" }];
  const section = (title: string, rows: (g: Group) => Row[], showStays: boolean) => {
    const groups = b.groups.filter((g) => rows(g).length);
    if (!groups.length) return null;
    return (
      <section>
        <h3>{title}</h3>
        <table>
          <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th className="num">Total</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={title + g.location}>
                <tr className="dest"><td colSpan={4}>{g.location}</td></tr>
                {rows(g).map((r, i) => (
                  <tr key={i}>
                    <td>{r.desc}{r.note && <div className="note">{r.note}</div>}</td>
                    <td>{r.qty}</td><td>{r.rate}</td><td className="num">{usd(r.total)}</td>
                  </tr>
                ))}
                {showStays && g.checkIn && g.checkOut && (
                  <tr className="dates"><td colSpan={4}>Check in: {short(g.checkIn)} / Check out: {short(g.checkOut)}</td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  return (
    <div className="br-doc">
      <header className="br-head">
        <img src="/mm-logo.png" alt="Mad Monkey" />
        <div><div className="br-title">Booking request</div><div className="br-sub">For Reservations · {reference}</div></div>
      </header>

      <section>
        <h3>Booking details</h3>
        <table className="kv"><tbody>
          <tr><th>Booking reference</th><td>{reference}</td></tr>
          <tr><th>Date requested</th><td>{d.date_requested ? long(d.date_requested) : <TBC />}</td></tr>
          <tr><th>Agent / Company</th><td>{val(d.agent_company)}</td></tr>
          <tr><th>Agent contact</th><td>{d.agent_contact_name || d.agent_contact_email ? [d.agent_contact_name, d.agent_contact_email].filter(Boolean).join(" / ") : <TBC />}</td></tr>
          <tr><th>Mad Monkey contact</th><td>{val(d.mm_contact_name)}</td></tr>
          <tr><th>Total guests</th><td>{val(d.total_guests)}</td></tr>
          <tr><th>Travel dates</th><td>{b.start && b.end ? range(b.start, b.end) : <TBC />}</td></tr>
          <tr><th>Destinations</th><td>{val(b.destinations)}</td></tr>
        </tbody></table>
      </section>

      <section>
        <h3>Guest details</h3>
        <table>
          <thead><tr><th>Guest name</th><th>Nationality</th><th>Email address</th><th>WhatsApp</th></tr></thead>
          <tbody>{guests.map((g, i) => (
            <tr key={i}><td>{g.name.trim() || <span className="tbc">Guest {i + 1}</span>}</td><td>{val(g.nationality)}</td><td>{val(g.email)}</td><td>{val(g.whatsapp)}</td></tr>
          ))}</tbody>
        </table>
      </section>

      {section("Accommodation", (g) => g.stays, true)}
      {section("Tours + travel", (g) => g.tours, false)}
      {section("Other items", (g) => g.other, false)}

      {d.reservations_notes.trim() && (
        <section>
          <h3>Booking notes</h3>
          <p className="notes">{d.reservations_notes}</p>
        </section>
      )}

      <section>
        <h3>Pricing &amp; payment</h3>
        <table className="money"><tbody>
          {b.totals.accommodation > 0 && <tr><td>Accommodation</td><td className="num">{usd(b.totals.accommodation)}</td></tr>}
          {b.totals.breakfast > 0 && <tr><td>Breakfast</td><td className="num">{usd(b.totals.breakfast)}</td></tr>}
          {b.totals.tours > 0 && <tr><td>Tours + travel</td><td className="num">{usd(b.totals.tours)}</td></tr>}
          {b.totals.other > 0 && <tr><td>Other items</td><td className="num">{usd(b.totals.other)}</td></tr>}
          <tr className="sub"><td>Subtotal</td><td className="num">{usd(b.totals.subtotal)}</td></tr>
          {b.totals.discounts.map((x, i) => <tr key={i} className="off"><td>{x.label}</td><td className="num">-{usd(x.amount)}</td></tr>)}
          {b.totals.pkg && <tr className="off"><td>{b.totals.pkg.label}</td><td className="num">-{usd(b.totals.pkg.amount)}</td></tr>}
          <tr className="final"><td>Final booking total</td><td className="num">{usd(b.totals.final)}</td></tr>
        </tbody></table>
        <p className="pay">
          <b>Payment deadline:</b> {d.payment_deadline ? <>{long(d.payment_deadline)}{before != null && before > 0 ? ` (${before} days before arrival)` : ""}</> : <TBC />}
          {d.payment_terms.trim() && <> {d.payment_terms.trim()}</>}
        </p>
      </section>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────────────── */
export default function BookingRequest() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [d, setD] = useState<Details | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["booking-request", id],
    queryFn: async () => {
      const { data: q, error } = await supabase.from("quotes")
        .select("id, reference, title, status, owner_id, accepted_version_id, customers(*)").eq("id", id!).single();
      if (error) throw error;
      const [{ data: v }, { data: owner }, { data: saved }] = await Promise.all([
        q.accepted_version_id ? supabase.from("quote_versions").select("*").eq("id", q.accepted_version_id).single() : Promise.resolve({ data: null }),
        q.owner_id ? supabase.from("profiles").select("full_name, email").eq("id", q.owner_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("booking_requests").select("*").eq("quote_id", id!).maybeSingle(),
      ]);
      return { q, v: v as Version | null, owner, saved };
    },
  });

  useEffect(() => {
    if (!data?.v || d) return;
    const fresh = defaults(data.v, data.q as never, data.owner);
    setD(data.saved?.details && Object.keys(data.saved.details).length ? { ...fresh, ...(data.saved.details as Details) } : fresh);
  }, [data, d]);

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const { q, v, saved } = data;
  if (q.status !== "accepted" || !v) {
    return (
      <div className="p-6 space-y-3 max-w-lg">
        <h1 className="text-xl font-semibold">Booking request</h1>
        <p className="text-sm text-muted-foreground">Mark the quote Accepted first. In the quote, open Versions and press "Mark accepted" on the version the client agreed to.</p>
        <Button variant="outline" onClick={() => nav(`/quotes/${id}`)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to the quote</Button>
      </div>
    );
  }
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const reference = saved?.reference ?? String(q.reference).replace(/^MMQ/i, "MMB");
  const set = <K extends keyof Details>(k: K, value: Details[K]) => setD({ ...d, [k]: value });
  const setGuest = (i: number, k: keyof Guest, value: string) => set("guests", d.guests.map((g, j) => (j === i ? { ...g, [k]: value } : g)));

  const save = async (quiet = false) => {
    setSaving(true);
    const row: Record<string, unknown> = {
      quote_id: id, version_id: v.id, reference, details: d, payment_deadline: d.payment_deadline || null,
      total_usd: v.total_usd, contact_name: d.mm_contact_name.trim() || null, contact_email: d.mm_contact_email.trim() || null,
      updated_at: new Date().toISOString(),
    };
    // a new deadline gets its own reminder
    if (saved && saved.payment_deadline !== (d.payment_deadline || null)) row.reminder_sent_at = null;
    if (!saved) { const { data: me } = await supabase.auth.getUser(); row.created_by = me.user?.id ?? null; }
    const { error } = await supabase.from("booking_requests").upsert(row, { onConflict: "quote_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    qc.invalidateQueries({ queryKey: ["booking-request", id] });
    if (!quiet) toast.success("Booking request saved");
    return true;
  };
  const download = async () => { if (await save(true)) setTimeout(() => window.print(), 50); };
  const togglePaid = async (paid: boolean) => {
    if (!saved && !(await save(true))) return;
    const { error } = await supabase.from("booking_requests").update({ paid_at: paid ? new Date().toISOString() : null }).eq("quote_id", id!);
    if (error) toast.error(error.message);
    else { qc.invalidateQueries({ queryKey: ["booking-request", id] }); toast.success(paid ? "Marked as paid. No reminder will go out." : "Marked as not paid"); }
  };

  const reminder = (() => {
    if (saved?.paid_at) return `Paid ${long(String(saved.paid_at).slice(0, 10))}. No reminder will go out.`;
    if (saved?.reminder_sent_at) return `Reminder emailed to ${saved.contact_email} on ${long(String(saved.reminder_sent_at).slice(0, 10))}.`;
    if (!d.payment_deadline) return "Add a payment deadline to get a reminder.";
    if (!d.mm_contact_email.trim()) return "Add the Mad Monkey contact's email to get a reminder.";
    const due = shift(d.payment_deadline, -7);
    return `A reminder emails ${d.mm_contact_email.trim()} on ${long(due < isoOf(new Date()) ? isoOf(new Date()) : due)} if it isn't marked paid. Saved changes only.`;
  })();

  return (
    <div className="p-4 grid grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-5 max-xl:grid-cols-1 items-start">
      <style>{DOC_CSS}</style>
      <div className="space-y-4 min-w-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(`/quotes/${id}`)} aria-label="Back to the quote"><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Booking request</h1>
            <div className="text-xs text-muted-foreground truncate">{reference} · {q.title} · from v{v.version_no}</div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Everything below is filled from the accepted quote. Check it, add what's missing, or leave a field blank to skip it (it shows as TBC).</p>

        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Agent</legend>
          <F id="br-agent" label="Agent / Company" value={d.agent_company} onChange={(x) => set("agent_company", x)} />
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <F id="br-agent-name" label="Contact name" value={d.agent_contact_name} onChange={(x) => set("agent_contact_name", x)} />
            <F id="br-agent-email" label="Contact email" type="email" value={d.agent_contact_email} onChange={(x) => set("agent_contact_email", x)} />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Guests</legend>
          <F id="br-total" label="Total guests" value={d.total_guests} onChange={(x) => set("total_guests", x)} />
          {d.guests.map((g, i) => (
            <div key={i} className="border rounded-md p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Guest {i + 1}</span>
                {d.guests.length > 1 && <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" aria-label={`Remove guest ${i + 1}`} onClick={() => set("guests", d.guests.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Input aria-label={`Guest ${i + 1} name`} placeholder="Full name" className="h-8 text-sm" value={g.name} onChange={(e) => setGuest(i, "name", e.target.value)} />
                <Input aria-label={`Guest ${i + 1} nationality`} placeholder="Nationality" className="h-8 text-sm" value={g.nationality} onChange={(e) => setGuest(i, "nationality", e.target.value)} />
                <Input aria-label={`Guest ${i + 1} email`} placeholder="Email" type="email" className="h-8 text-sm" value={g.email} onChange={(e) => setGuest(i, "email", e.target.value)} />
                <Input aria-label={`Guest ${i + 1} WhatsApp`} placeholder="WhatsApp" className="h-8 text-sm" value={g.whatsapp} onChange={(e) => setGuest(i, "whatsapp", e.target.value)} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => set("guests", [...d.guests, { name: "", nationality: "", email: "", whatsapp: "" }])}><Plus className="h-3 w-3" /> Add guest</Button>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Payment</legend>
          <div className="space-y-1">
            <Label htmlFor="br-deadline" className="text-xs">Payment deadline</Label>
            <Input id="br-deadline" type="date" className="h-8 w-44" value={d.payment_deadline} onChange={(e) => set("payment_deadline", e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Starts at 30 days before arrival. Change it if the agent has agreed something else.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="br-terms" className="text-xs">Payment terms</Label>
            <Textarea id="br-terms" rows={2} className="text-sm" value={d.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <F id="br-mm-name" label="Mad Monkey contact" value={d.mm_contact_name} onChange={(x) => set("mm_contact_name", x)} />
            <F id="br-mm-email" label="Their email (gets the reminder)" type="email" value={d.mm_contact_email} onChange={(x) => set("mm_contact_email", x)} />
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <Switch checked={!!saved?.paid_at} onCheckedChange={togglePaid} /> Payment received
          </label>
          <p className="text-[11px] text-muted-foreground">{reminder}</p>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Notes for Reservations</legend>
          <Textarea id="br-notes" aria-label="Notes for Reservations" rows={4} className="text-sm" value={d.reservations_notes} onChange={(e) => set("reservations_notes", e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Starts with the notes from the quote. Edit freely: this only changes the booking request.</p>
        </fieldset>

        <div className="flex gap-2 sticky bottom-0 bg-background py-2">
          <Button variant="outline" className="gap-1.5" disabled={saving} onClick={() => save()}><Save className="h-4 w-4" /> Save</Button>
          <Tip label="Saves, then opens the print window. Choose Save as PDF.">
            <Button className="gap-1.5 flex-1" disabled={saving} onClick={download}><Download className="h-4 w-4" /> Download PDF</Button>
          </Tip>
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div className="br-paper"><BookingDoc v={v} d={d} reference={reference} /></div>
      </div>
      {createPortal(<div className="br-print"><BookingDoc v={v} d={d} reference={reference} /></div>, document.body)}
    </div>
  );
}

function F({ id, label, value, onChange, type = "text" }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1 min-w-0">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type={type} className="h-8 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const DOC_CSS = `
.br-paper { background: #fff; border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 28px 32px; min-width: 640px; }
.br-doc { color: #1a1a18; font-family: Montserrat, ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; line-height: 1.45; }
.br-doc .br-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1a1a18; padding-bottom: 12px; margin-bottom: 14px; }
.br-doc .br-head img { height: 34px; width: auto; }
.br-doc .br-head > div { text-align: right; }
.br-doc .br-title { font-weight: 800; font-size: 18px; }
.br-doc .br-sub { color: #66665f; font-size: 11.5px; }
.br-doc section { margin-top: 16px; break-inside: avoid; }
.br-doc h3 { font-weight: 800; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; margin: 0 0 6px; }
.br-doc table { width: 100%; border-collapse: collapse; }
.br-doc th, .br-doc td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e6e5df; vertical-align: top; }
.br-doc thead th { background: #f4f3ef; font-weight: 700; font-size: 11px; }
.br-doc .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.br-doc td:nth-child(2), .br-doc td:nth-child(3) { white-space: nowrap; }
.br-doc .kv th { width: 34%; background: #f4f3ef; font-weight: 600; }
.br-doc .dest td { font-weight: 700; background: #fafaf7; }
.br-doc .dates td { color: #66665f; font-size: 11.5px; }
.br-doc .note { color: #66665f; font-style: italic; font-size: 11.5px; white-space: pre-line; }
.br-doc .notes { white-space: pre-line; margin: 0; border-left: 3px solid #1a1a18; padding: 6px 10px; background: #fafaf7; }
.br-doc .money { max-width: 420px; margin-left: auto; }
.br-doc .money .sub td { font-weight: 600; }
.br-doc .money .off td { color: #2f7a32; }
.br-doc .money .final td { font-weight: 800; font-size: 14px; border-bottom: 2px solid #1a1a18; }
.br-doc .pay { margin: 10px 0 0; }
.br-doc .tbc { color: #a3a39b; }
.br-print { display: none; }
@media print {
  @page { size: A4; margin: 12mm; }
  #root { display: none !important; }
  .br-print { display: block !important; }
  .br-print .br-doc { font-size: 11px; }
}
`;

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { usd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tip } from "@/components/app/Tip";
import { Plus, Wand2, CopyPlus } from "lucide-react";

interface QuoteRow {
  id: string; reference: string; title: string; status: string; pax_count: number; created_at: string;
  customers: { contact_name: string; company_name: string | null; country: string | null } | null;
  quote_versions: { version_no: number; total_usd: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  draft: "--st-pending", sent: "--st-signature", accepted: "--st-active", cancelled: "--st-remove",
};

export default function Quotes() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [month, setMonth] = useState("all");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", pax: "2", contact: "", company: "", email: "", customerCountry: "" });

  const { data: rows } = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id, reference, title, status, pax_count, created_at, customers(contact_name, company_name, country), quote_versions(version_no, total_usd)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteRow[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      let customerId: string | null = null;
      if (f.contact.trim()) {
        const { data, error } = await supabase.from("customers").insert({
          contact_name: f.contact.trim(),
          company_name: f.company.trim() || null,
          email: f.email.trim() || null,
          country: f.customerCountry.trim() || null,
        }).select("id").single();
        if (error) throw error;
        customerId = data.id;
      }
      const { data: me } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("quotes").insert({
        title: f.title.trim() || "Untitled trip",
        pax_count: Math.max(1, Number(f.pax) || 1),
        customer_id: customerId,
        owner_id: me.user?.id,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ["quotes"] }); setOpen(false); nav(`/quotes/${id}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const countries = [...new Set((rows ?? []).map((r) => r.customers?.country).filter(Boolean))] as string[];
  const months = [...new Set((rows ?? []).map((r) => r.created_at.slice(0, 7)))];
  const needle = search.trim().toLowerCase();
  const filtered = (rows ?? []).filter((r) =>
    (country === "all" || r.customers?.country === country) &&
    (month === "all" || r.created_at.startsWith(month)) &&
    (!needle || [r.reference, r.title, r.customers?.contact_name, r.customers?.company_name]
      .some((v) => (v ?? "").toLowerCase().includes(needle))));

  const latestTotal = (r: QuoteRow) =>
    r.quote_versions.length ? r.quote_versions.sort((a, b) => b.version_no - a.version_no)[0].total_usd : null;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Quotes</h1>
        <div className="flex items-center gap-2">
        <Tip label="Stops and dates in, a whole day-by-day trip out: stays, breakfast and that day's experiences to tick. Fastest way to build a 10-day itinerary."><Button size="sm" variant="outline" className="gap-1.5" data-tour="quotes-auto" onClick={() => nav("/quotes/auto")}><Wand2 className="h-4 w-4" /> Auto-create trip</Button></Tip>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" title="Start an empty quote and build it day by day"><Plus className="h-4 w-4" /> New quote</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New quote</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Trip title</Label>
                <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Contiki Cambodia loop, March" />
              </div>
              <div className="space-y-1.5">
                <Label>Pax</Label>
                <Input inputMode="numeric" className="w-24" value={f.pax} onChange={(e) => setF({ ...f, pax: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Contact name</Label>
                  <Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Company / agent</Label>
                  <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Input value={f.customerCountry} onChange={(e) => setF({ ...f, customerCountry: e.target.value })} />
                </div>
              </div>
              <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
                Create & open builder
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input placeholder="Search quotes…" className="w-56 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-hidden" data-tour="quotes-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary text-muted-foreground text-left">
              <th className="font-medium px-3 py-2.5">Reference</th>
              <th className="font-medium px-3 py-2.5">Trip</th>
              <th className="font-medium px-3 py-2.5">Customer</th>
              <th className="font-medium px-3 py-2.5 text-right">Pax</th>
              <th className="font-medium px-3 py-2.5 text-right">Latest total</th>
              <th className="font-medium px-3 py-2.5 text-right">Versions</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="mm-stagger">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No quotes yet — create the first one.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t hover:bg-secondary/40 h-11 cursor-pointer" onClick={() => nav(`/quotes/${r.id}`)}>
                <td className="px-3 py-1 font-medium tabular-nums"><Link to={`/quotes/${r.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.reference}</Link></td>
                <td className="px-3 py-1">{r.title}</td>
                <td className="px-3 py-1 text-muted-foreground">
                  {r.customers ? `${r.customers.contact_name}${r.customers.company_name ? ` · ${r.customers.company_name}` : ""}` : "—"}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{r.pax_count}</td>
                <td className="px-3 py-1 text-right tabular-nums">{usd(latestTotal(r))}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.quote_versions.length || "—"}</td>
                <td className="px-3 py-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize"
                    style={{ color: `hsl(var(${STATUS_COLORS[r.status]}))` }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `hsl(var(${STATUS_COLORS[r.status]}))` }} />
                    {r.status}
                  </span>
                </td>
                <td className="px-1 py-1">
                  <button title="Duplicate into a new draft — same days, stays and experiences. Use any quote as a template this way." className="text-muted-foreground hover:text-foreground p-1"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const { data, error } = await supabase.rpc("duplicate_quote", { p_quote_id: r.id });
                      if (error) { toast.error(error.message); return; }
                      qc.invalidateQueries({ queryKey: ["quotes"] });
                      toast.success("Trip duplicated"); nav(`/quotes/${data}`);
                    }}><CopyPlus className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/** Add a hostel (Oct 2026): head office adds a new Mad Monkey property without asking Charlie. Picking a country we
 *  already have fills in its currency and time zone; a new country picks them from the lists. add_location() checks
 *  the role, the name and the time zone on the server. */
const CURRENCIES = ["USD", "THB", "PHP", "IDR", "VND", "KHR", "LAK", "MYR", "SGD", "AUD", "GBP", "EUR"];
const TIMEZONES = ["Asia/Phnom_Penh", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Vientiane", "Asia/Manila", "Asia/Makassar",
  "Asia/Jakarta", "Asia/Kuala_Lumpur", "Asia/Singapore", "Australia/Sydney", "Europe/London"];
const NEW_COUNTRY = "__new__";

export function AddHostelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  // what each country we already run uses, so a new hostel in Vietnam gets VND and Ho Chi Minh time by itself
  const known = useMemo(() => {
    const m = new Map<string, { currency: string; timezone: string }>();
    for (const l of auth.allLocations) if (!m.has(l.country)) m.set(l.country, { currency: l.currency, timezone: l.timezone });
    return m;
  }, [auth.allLocations]);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [busy, setBusy] = useState(false);

  const pickCountry = (c: string) => {
    setCountry(c);
    const k = known.get(c);
    if (k) { setCurrency(k.currency); setTimezone(k.timezone); }
  };
  const reset = () => { setName(""); setCountry(""); setNewCountry(""); setCurrency("USD"); setTimezone("Asia/Bangkok"); };

  const save = async () => {
    const finalCountry = country === NEW_COUNTRY ? newCountry.trim() : country;
    if (!name.trim() || !finalCountry) { toast.error("Give the hostel a name and a country"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("add_location", { p_name: name.trim(), p_country: finalCountry, p_currency: currency, p_timezone: timezone });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await auth.reloadLocations();
    if (data) auth.setCurrentLocationId(data as string);
    qc.invalidateQueries();
    toast.success(`${name.trim()} added. You're looking at it now, so add its experiences with Add product.`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a hostel</DialogTitle>
          <DialogDescription>A new Mad Monkey property. It appears in the hostel list for head office straight away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Hostel name</Label>
            <Input placeholder="e.g. Kampot" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Country</Label>
            <Select value={country} onValueChange={pickCountry}>
              <SelectTrigger><SelectValue placeholder="Pick a country" /></SelectTrigger>
              <SelectContent>
                {[...known.keys()].sort().map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                <SelectItem value={NEW_COUNTRY}>Another country…</SelectItem>
              </SelectContent>
            </Select>
            {country === NEW_COUNTRY && <Input placeholder="Country name" value={newCountry} onChange={(e) => setNewCountry(e.target.value)} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Time zone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[...new Set([...TIMEZONES, ...[...known.values()].map((k) => k.timezone)])].sort().map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Prices are shown in the currency; the time zone sets when Reden's emails and My week roll over. To give the hostel's GM a login, message Charlie.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? "Adding…" : "Add hostel"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

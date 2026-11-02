import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { asset } from "@/lib/paths";

type Step = "email" | "code" | "password";

export default function Login() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [needLocation, setNeedLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    supabase.functions.invoke("staff-login", { body: { mode: "locations" } }).then(({ data }) => setLocations(data?.locations ?? []));
  }, []);

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke("staff-login", { body: { mode: "request", email, location_id: locationId || undefined } });
    setBusy(false);
    if (err || !data) { setError("Something went wrong. Try again."); return; }
    if (data.error) { setError(data.error); return; }
    if (data.need_location) { setNeedLocation(true); return; }
    setStep("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke("staff-login", { body: { mode: "verify", email, code, location_id: locationId || undefined } });
    if (err || !data) { setBusy(false); setError("Something went wrong. Try again."); return; }
    if (data.error) { setBusy(false); setError(data.error); return; }
    const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    setBusy(false);
    if (vErr) { setError(vErr.message); return; }
    nav("/experiences", { replace: true });
  };

  const passwordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    nav("/experiences", { replace: true });
  };

  const header = (
    <div className="space-y-1.5">
      <img src={asset("mm-logo.png")} alt="Mad Monkey" className="h-11 w-auto" />
      <div className="text-xs text-muted-foreground">Experiences &amp; Costing</div>
    </div>
  );
  const emailField = (
    <div className="space-y-1.5">
      <Label htmlFor="email">Work email</Label>
      <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
        placeholder="you@madmonkeyhostels.com" disabled={step === "code"} />
    </div>
  );
  const err = error && <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="min-h-screen grid place-items-center bg-secondary/50 p-4">
      {step === "email" && (
        <form onSubmit={request} className="w-full max-w-sm bg-background border rounded-lg p-6 shadow-sm space-y-4">
          {header}
          {emailField}
          {needLocation && (
            <div className="space-y-1.5">
              <Label htmlFor="loc">First time here? Choose your hostel</Label>
              <select id="loc" required value={locationId} onChange={(e) => setLocationId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select a hostel…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {err}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : needLocation ? "Sign up and send code" : "Email me a code"}</Button>
          <p className="text-xs text-muted-foreground">Anyone with a @madmonkeyhostels.com email can sign up. We'll email you a security code.</p>
          <button type="button" className="text-xs underline text-muted-foreground" onClick={() => { setStep("password"); setError(null); }}>Sign in with a password instead</button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={verify} className="w-full max-w-sm bg-background border rounded-lg p-6 shadow-sm space-y-4">
          {header}
          {emailField}
          <div className="space-y-1.5">
            <Label htmlFor="code">Security code</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" />
            <p className="text-xs text-muted-foreground">We emailed a code to {email}. It works for 10 minutes.</p>
          </div>
          {err}
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</Button>
          <div className="flex gap-4">
            <button type="button" className="text-xs underline text-muted-foreground" onClick={() => request()}>Resend code</button>
            <button type="button" className="text-xs underline text-muted-foreground" onClick={() => { setStep("email"); setCode(""); setError(null); }}>Use a different email</button>
          </div>
        </form>
      )}
      {step === "password" && (
        <form onSubmit={passwordLogin} className="w-full max-w-sm bg-background border rounded-lg p-6 shadow-sm space-y-4">
          {header}
          {emailField}
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {err}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          <button type="button" className="text-xs underline text-muted-foreground" onClick={() => { setStep("email"); setError(null); }}>Email me a code instead</button>
        </form>
      )}
    </div>
  );
}

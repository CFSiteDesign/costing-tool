import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Where an invite link lands: /set-password?token_hash=...&type=invite (or recovery for a reset).
 * The link signs the person in once; they choose their own password here, then go straight in.
 */
export default function SetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "bad">("checking");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token_hash = params.get("token_hash");
    const type = params.get("type") === "recovery" ? "recovery" : "invite";
    (async () => {
      if (!token_hash) { setState("bad"); return; }
      const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
      if (error || !data.session) { setState("bad"); return; }
      setEmail(data.user?.email ?? "");
      window.history.replaceState(null, "", "/set-password");   // the link only works once; keep it out of the address bar
      setState("ready");
    })();
  }, [params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setError(error.message); return; }
    nav("/experiences", { replace: true });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-secondary/50 p-4">
      <div className="w-full max-w-sm bg-background border rounded-lg p-6 shadow-sm space-y-4">
        <div className="space-y-1.5">
          <img src="/mm-logo.png" alt="Mad Monkey" className="h-11 w-auto" />
          <div className="text-xs text-muted-foreground">Experiences &amp; Costing</div>
        </div>
        {state === "checking" && <p className="text-sm text-muted-foreground">Checking your link…</p>}
        {state === "bad" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">This link has expired or has already been used.</p>
            <p className="text-sm text-muted-foreground">Ask Charlie for a new one. If you've already set a password, just sign in.</p>
            <Button variant="outline" className="w-full" onClick={() => nav("/login")}>Go to sign in</Button>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <p className="text-[15px] font-medium">Choose your password</p>
              {email && <p className="text-sm text-muted-foreground">for {email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Same again</Label>
              <Input id="pw2" type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save and go in"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}

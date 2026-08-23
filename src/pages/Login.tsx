import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    // "test" shortcut: signs straight into the read-only demo account (sales role,
    // cannot edit products). Remove before real go-live — anyone with the URL can use it.
    const creds = email.trim().toLowerCase() === "test"
      ? { email: "demo@madmonkey.test", password: "mm-demo-view-2026" }
      : { email, password };
    const { error } = await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) { setError(error.message); return; }
    nav("/experiences", { replace: true });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-secondary/50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-background border rounded-lg p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded bg-accent grid place-items-center font-bold">M</div>
          <div>
            <div className="font-semibold text-lg leading-tight">Mad Monkey</div>
            <div className="text-xs text-muted-foreground">Experiences & Costing</div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="text" required placeholder="you@madmonkeyhostels.com — or just: test" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password{email.trim().toLowerCase() === "test" && <span className="text-muted-foreground font-normal"> — not needed for test</span>}</Label>
          <Input id="password" type="password" required={email.trim().toLowerCase() !== "test"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

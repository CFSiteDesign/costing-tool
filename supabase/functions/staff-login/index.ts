import { createClient } from "jsr:@supabase/supabase-js@2";

// Staff email-code login (Nov 2026). Public (no session needed): the emailed code is the key.
// POST { mode: "locations" }                                   -> hostels to choose from on sign-up
// POST { mode: "request", email, location_id? }               -> emails a 6-digit code (10 min, 5 tries). A first-time email must pick a hostel.
// POST { mode: "verify", email, code, location_id? }          -> checks the code; creates the account if new (gm role, that hostel),
//                                                                returns a one-time token hash the app turns into a session.
// Only @madmonkeyhostels.com addresses are accepted, checked here on the server.

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DOMAIN = "@madmonkeyhostels.com";
const valid = (e: string) => /^[a-z0-9._%+-]+@madmonkeyhostels\.com$/.test(e);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: { mode?: string; email?: string; code?: string; location_id?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body.email ?? "").trim().toLowerCase();

  if (body.mode === "locations") {
    const { data } = await admin.from("locations").select("id, name").order("name");
    return json({ locations: data ?? [] });
  }

  if (!valid(email)) return json({ error: `Use your ${DOMAIN} email address.` });

  const existing = await findUser(admin, email);

  if (body.mode === "request") {
    if (!existing && !body.location_id) return json({ need_location: true });
    if (!existing) {
      const { data: loc } = await admin.from("locations").select("id").eq("id", body.location_id!).maybeSingle();
      if (!loc) return json({ error: "Choose your hostel." });
    }
    // one code a minute per address, ten an hour
    const { data: recent } = await admin.from("staff_login_codes").select("created_at").eq("email", email)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString()).order("created_at", { ascending: false });
    if (recent && recent.length >= 10) return json({ error: "Too many codes requested. Try again in an hour." });
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) return json({ error: "A code was just sent. Wait a minute to request another." });
    const key = await resendKey(admin);
    if (!key) return json({ error: "Email isn't set up yet. Ask Charlie." });
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const { data: row, error: insErr } = await admin.from("staff_login_codes")
      .insert({ email, code_hash: await sha256(`${email}:${code}`), location_id: existing ? null : body.location_id }).select("id").single();
    if (insErr) return json({ error: "Couldn't create a code. Try again." });
    const mail = codeEmail(code);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER(), to: [email], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) { await admin.from("staff_login_codes").delete().eq("id", row.id); return json({ error: "Couldn't send the email. Try again shortly." }); }
    return json({ sent: true, new_account: !existing });
  }

  if (body.mode === "verify") {
    const code = String(body.code ?? "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code." });
    const { data: row } = await admin.from("staff_login_codes").select("*").eq("email", email).is("used_at", null)
      .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row) return json({ error: "That code has expired. Request a new one." });
    if (row.attempts >= 5) return json({ error: "Too many wrong tries. Request a new code." });
    if (row.code_hash !== await sha256(`${email}:${code}`)) {
      await admin.from("staff_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return json({ error: "That code isn't right." });
    }
    // claim it atomically so a code can only ever be used once
    const { data: claimed } = await admin.from("staff_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id");
    if (!claimed?.length) return json({ error: "That code has already been used." });

    let userId = existing?.id as string | undefined;
    if (!userId) {
      if (!row.location_id) return json({ error: "Choose your hostel and request a new code." });
      const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !created.user) return json({ error: "Couldn't create your account. Tell Charlie." });
      userId = created.user.id;
      await admin.from("user_roles").upsert({ user_id: userId, role: "gm" });
      await admin.from("user_locations").upsert({ user_id: userId, location_id: row.location_id });
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) return json({ error: "Couldn't sign you in. Try again." });
    return json({ token_hash: data.properties.hashed_token, type: "magiclink" });
  }

  return json({ error: "unknown mode" }, 400);
});

// deno-lint-ignore no-explicit-any
async function findUser(admin: any, email: string): Promise<{ id: string } | null> {
  const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  return data ?? null;
}
async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}
// deno-lint-ignore no-explicit-any
const resendKey = async (admin: any): Promise<string | null> => Deno.env.get("RESEND_API_KEY") ?? ((await admin.rpc("email_key")).data as string | null) ?? null;
const SENDER = () => Deno.env.get("RESEND_FROM") ?? "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";

function codeEmail(code: string) {
  const subject = `${code} is your Mad Monkey Experience Database code`;
  const text = `Your security code is ${code}\n\nIt works for 10 minutes. If you didn't try to sign in, ignore this email.\n\nAny problems, contact charlie@madmonkeyhostels.com`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f2;padding:24px 12px;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#0a0a0a;font-size:15px;line-height:1.55">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:2px solid #0a0a0a;padding:28px 24px">
<div style="font-weight:900;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px">Mad Monkey <span style="background:#ccff01;padding:2px 6px">Experience Database</span></div>
<p style="margin:0 0 12px">Your security code is:</p>
<p style="margin:0 0 18px;font-size:34px;font-weight:900;letter-spacing:.3em">${code}</p>
<p style="margin:0 0 16px;font-size:13px;color:#555">It works for 10 minutes. If you didn't try to sign in, ignore this email.</p>
<p style="margin:0;font-size:13px;color:#555">Any problems, contact charlie@madmonkeyhostels.com</p>
</div></body></html>`;
  return { subject, text, html };
}

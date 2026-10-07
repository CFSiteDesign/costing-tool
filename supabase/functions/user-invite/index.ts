import { createClient } from "jsr:@supabase/supabase-js@2";

// Invite people to the Experience Database (Oct 2026). Admin callers only, apart from claim/done below.
// POST { users: [{ email, full_name, role }] }            -> creates each new user with Auth's invite link (no password, no email sent),
//                                                            their profile name comes from the invite, role added if missing.
// POST { mode: "link", emails: [..] }                     -> a fresh set-password link for people who already exist (expired invite, forgotten password).
// POST { mode: "welcome", emails: [..] }                  -> a 7-day welcome code per person (replaces any older one), safe to email.
// Returns one-time token hashes; the app's /set-password page turns one into a session and asks for a password.
// Public (no admin needed, the code is the key):
// POST { mode: "claim", code }                            -> swaps a live welcome code for a fresh one-hour Auth token hash.
// POST { mode: "done", code }                             -> the password was saved; the code stops working.

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ROLES = ["admin", "head_office", "sales", "gm"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: { mode?: string; code?: string; users?: { email: string; full_name?: string; role?: string }[]; emails?: string[] } = {};
  try { body = await req.json(); } catch { /* empty */ }

  // welcome links: the person opening the email has no account session yet, so these run before the admin check
  if (body.mode === "claim" || body.mode === "done") {
    const code = String(body.code ?? "");
    if (code.length < 20) return json({ error: "expired" });
    const { data: row } = await admin.from("welcome_links").select("*").eq("code_hash", await sha256(code)).maybeSingle();
    if (!row || row.used_at || new Date(row.expires_at) < new Date() || row.claims >= 20) return json({ error: "expired" });
    if (body.mode === "done") {
      await admin.from("welcome_links").update({ used_at: new Date().toISOString() }).eq("code_hash", row.code_hash);
      return json({ ok: true });
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: row.email });
    if (error) return json({ error: "expired" });
    await admin.from("welcome_links").update({ claims: row.claims + 1, last_claimed_at: new Date().toISOString() }).eq("code_hash", row.code_hash);
    return json({ token_hash: data.properties?.hashed_token, type: "recovery" });
  }

  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: me } = await caller.auth.getUser();
  if (!me.user) return json({ error: "not signed in" }, 401);
  const { data: isAdmin } = await caller.rpc("has_role", { _user: me.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "admins only" }, 403);

  if (body.mode === "welcome") {
    const out = [];
    for (const raw of body.emails ?? []) {
      const email = raw.trim().toLowerCase();
      const { data: prof } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (!prof) { out.push({ email, error: "no account with that email" }); continue; }
      const code = randomCode();
      await admin.from("welcome_links").delete().eq("user_id", prof.id);   // one live link per person
      const { error } = await admin.from("welcome_links").insert({ code_hash: await sha256(code), user_id: prof.id, email, created_by: me.user.id });
      out.push(error ? { email, error: error.message } : { email, code });
    }
    return json({ results: out });
  }

  if (body.mode === "link") {
    const out = [];
    for (const raw of body.emails ?? []) {
      const email = raw.trim().toLowerCase();
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
      out.push(error ? { email, error: error.message } : { email, token_hash: data.properties?.hashed_token, type: "recovery" });
    }
    return json({ results: out });
  }

  const results = [];
  for (const u of body.users ?? []) {
    const email = (u.email ?? "").trim().toLowerCase();
    const full_name = (u.full_name ?? "").trim();
    const role = u.role ?? "";
    if (!email || !ROLES.includes(role)) { results.push({ email, error: "email and a valid role are required" }); continue; }
    const r: Record<string, unknown> = { email };

    // 1. the user: an invite link creates them with no password; skip if they already exist
    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name } } });
    let userId: string | null = null;
    if (genErr) {
      if (!/already (been )?registered|already exists/i.test(genErr.message)) { results.push({ ...r, error: genErr.message }); continue; }
      const { data: prof } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      userId = prof?.id ?? null;
      r.user = "already existed, skipped";
    } else {
      userId = gen.user?.id ?? null;
      r.user = "invited";
      r.token_hash = gen.properties?.hashed_token;
      r.type = "invite";
    }
    if (!userId) { results.push({ ...r, error: "could not find the user id" }); continue; }

    // 2. the profile: created by the handle_new_user trigger from the invite's full_name; make sure it is there and named
    const { data: prof } = await admin.from("profiles").select("id, full_name").eq("id", userId).maybeSingle();
    if (!prof) {
      const { error } = await admin.from("profiles").insert({ id: userId, email, full_name: full_name || email.split("@")[0] });
      r.profile = error ? `error: ${error.message}` : "created";
    } else if (full_name && prof.full_name !== full_name) {
      const { error } = await admin.from("profiles").update({ full_name }).eq("id", userId);
      r.profile = error ? `error: ${error.message}` : "name set";
    } else r.profile = gen ? "created by invite" : "already there";

    // 3. the role: insert only if missing
    const { data: has } = await admin.from("user_roles").select("user_id").eq("user_id", userId).eq("role", role).maybeSingle();
    if (has) r.role = `${role} already there`;
    else { const { error } = await admin.from("user_roles").insert({ user_id: userId, role }); r.role = error ? `error: ${error.message}` : `${role} added`; }
    results.push(r);
  }
  return json({ results });
});

function randomCode() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

import { createClient } from "jsr:@supabase/supabase-js@2";

// Invite people to the Experience Database (Oct 2026). Admin callers only.
// POST { users: [{ email, full_name, role }] }            -> creates each new user with Auth's invite link (no password, no email sent),
//                                                            their profile name comes from the invite, role added if missing.
// POST { mode: "link", emails: [..] }                     -> a fresh set-password link for people who already exist (expired invite, forgotten password).
// Returns one-time token hashes; the app's /set-password page turns one into a session and asks for a password.

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ROLES = ["admin", "head_office", "sales", "gm"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: me } = await caller.auth.getUser();
  if (!me.user) return json({ error: "not signed in" }, 401);
  const { data: isAdmin } = await caller.rpc("has_role", { _user: me.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "admins only" }, 403);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: { mode?: string; users?: { email: string; full_name?: string; role?: string }[]; emails?: string[] } = {};
  try { body = await req.json(); } catch { /* empty */ }

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

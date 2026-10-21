import { createClient } from "jsr:@supabase/supabase-js@2";

// Invite people to the Experience Database (Oct 2026). Admin callers only, apart from claim/done below.
// POST { users: [{ email, full_name, role }] }            -> creates each new user with Auth's invite link (no password, no email sent),
//                                                            their profile name comes from the invite, role added if missing.
// POST { mode: "link", emails: [..] }                     -> a fresh set-password link for people who already exist (expired invite, forgotten password).
// POST { mode: "welcome", emails: [..] }                  -> a 7-day welcome code per person (replaces any older one), safe to email.
// POST { mode: "people" }                                 -> everyone with an account, their access and login-email status (Settings > People).
// POST { mode: "send_welcome", emails: [..], cc?: [..], no_expiry?: true }
//                                                         -> makes each person a welcome link and emails it to them via Resend.
//                                                            no_expiry: the link works until a password is saved; cc: copied in.
//                                                            The link only ever goes to that person's inbox; it is never returned.
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
  let body: { mode?: string; code?: string; users?: { email: string; full_name?: string; role?: string }[]; emails?: string[]; cc?: string[]; no_expiry?: boolean } = {};
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

  if (body.mode === "people") {
    const [{ data: list }, { data: profs }, { data: roles }, { data: locs }, { data: links }] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("profiles").select("id, email, full_name"),
      admin.from("user_roles").select("user_id, role"),
      admin.from("user_locations").select("user_id, locations(name)"),
      admin.from("welcome_links").select("user_id, created_at, emailed_at, used_at, expires_at"),
    ]);
    const prof = new Map((profs ?? []).map((p) => [p.id, p]));
    const people = (list?.users ?? []).map((u) => ({
      id: u.id, email: u.email, full_name: prof.get(u.id)?.full_name ?? null, last_sign_in_at: u.last_sign_in_at ?? null,
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      hostels: (locs ?? []).filter((l) => l.user_id === u.id).map((l) => (l.locations as unknown as { name: string })?.name).filter(Boolean).sort(),
      welcome: (links ?? []).find((w) => w.user_id === u.id) ?? null,
    })).sort((a, b) => String(a.full_name ?? a.email).localeCompare(String(b.full_name ?? b.email)));
    return json({ email_ready: !!(await resendKey(admin)), sender: SENDER(), people });
  }

  if (body.mode === "send_welcome") {
    const key = await resendKey(admin);
    if (!key) return json({ error: "email_not_set_up" });
    const site = (Deno.env.get("SITE_URL") ?? "https://madmonkeyhostels.com/experiencedashboard").replace(/\/$/, "");
    const cc = (body.cc ?? []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 5);
    const noExpiry = body.no_expiry === true;   // the link then lasts until a password is saved
    const out = [];
    for (const raw of body.emails ?? []) {
      const email = raw.trim().toLowerCase();
      const { data: prof } = await admin.from("profiles").select("id, full_name").eq("email", email).maybeSingle();
      if (!prof) { out.push({ email, error: "no account with that email" }); continue; }
      const [{ data: hasPassword }, { data: roles }, { data: locs }] = await Promise.all([
        admin.rpc("user_has_password", { _user: prof.id }),   // signed in once is not enough: a link signs you in before you pick a password
        admin.from("user_roles").select("role").eq("user_id", prof.id),
        admin.from("user_locations").select("locations(name)").eq("user_id", prof.id),
      ]);
      const seesAll = (roles ?? []).some((r) => ["admin", "head_office", "sales"].includes(r.role));
      const hostels = (locs ?? []).map((l) => (l.locations as unknown as { name: string })?.name).filter(Boolean).sort();
      const code = randomCode();
      const hash = await sha256(code);
      // the person's current link stays valid until this email has actually gone; a failed send must not kill it
      const { error: insErr } = await admin.from("welcome_links").insert({ code_hash: hash, user_id: prof.id, email, created_by: me.user.id,
        ...(noExpiry ? { expires_at: "2100-01-01T00:00:00Z" } : {}) });
      if (insErr) { out.push({ email, error: insErr.message }); continue; }
      const mail = welcomeEmail({
        name: greetingName(prof.full_name, email), access: seesAll ? "every hostel" : hostels.length ? listJoin(hostels) : "",
        existing: hasPassword === true, link: `${site}/set-password?code=${code}`, site, noExpiry,
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: SENDER(), to: [email], ...(cc.length ? { cc } : {}), subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) {
        await admin.from("welcome_links").delete().eq("code_hash", hash);   // never leave a live link nobody received
        const detail = await res.json().catch(() => ({}));
        out.push({ email, error: detail?.message ?? `email service said ${res.status}` });
        if (res.status === 401 || res.status === 403) break;   // bad key or unverified sender: every other send would fail the same way
        continue;
      }
      await admin.from("welcome_links").update({ emailed_at: new Date().toISOString() }).eq("code_hash", hash);
      await admin.from("welcome_links").delete().eq("user_id", prof.id).neq("code_hash", hash);   // now one live link per person
      out.push({ email, sent: true, ...(cc.length ? { cc } : {}), ...(noExpiry ? { expires: "never, until a password is saved" } : {}) });
    }
    return json({ results: out });
  }

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

// the Resend key: an Edge Function secret if one is ever set, otherwise the one an admin saved in Settings > Email (Vault)
// deno-lint-ignore no-explicit-any
const resendKey = async (admin: any): Promise<string | null> => Deno.env.get("RESEND_API_KEY") ?? ((await admin.rpc("email_key")).data as string | null) ?? null;
const SENDER = () => Deno.env.get("RESEND_FROM") ?? "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";
const listJoin = (a: string[]) => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// "Chris Gibson" -> Chris, "Froggy (Thailand Senior GM)" -> Froggy; a double first name that IS the email's local part
// (harryjohn@ "Harry John", thuyanh@ "Thuy Anh") stays whole
function greetingName(full: string | null, email: string) {
  const local = email.split("@")[0].toLowerCase();
  const name = (full ?? "").replace(/\(.*?\)/g, "").trim();
  if (!name) return "there";
  if (!local.includes(".") && name.replace(/\s+/g, "").toLowerCase() === local) return name;
  return name.split(/\s+/)[0];
}

function welcomeEmail(o: { name: string; access: string; existing: boolean; link: string; site: string; noExpiry?: boolean }) {
  const subject = "Your login for the Mad Monkey Experience Database";
  const host = o.site.replace(/^https?:\/\//, "");
  const where = o.access ? ` You're set up for ${o.access}.` : "";
  const assistant = "There's an Assistant built in. Ask it things like what's on tonight, or tell it what to change, and it sets the change up for you to check. Nothing changes until you confirm.";
  const intro = o.existing
    ? `You already have a login for the Mad Monkey Experience Database.${where} If you know your password, just sign in at ${host} as usual. If you've forgotten it, choose a new one here:`
    : `You now have access to the Mad Monkey Experience Database. It holds every tour, event and transport option across the hostels, with prices, times and descriptions.${where}`;
  const cta = o.existing ? "Choose a new password" : "Choose your password";
  const small = o.noExpiry
    ? "This link works until you've set your password. Please don't forward it."
    : "This link works for 7 days and is just for you, so please don't forward it.";
  const after = o.existing ? "" : `After that, sign in any time at ${host} with this email address.`;
  const text = [`Hi ${o.name},`, intro, `${cta}: ${o.link}`, small, after, assistant, "Any problems, message Charlie."].filter(Boolean).join("\n\n");
  const p = (t: string, extra = "") => `<p style="margin:0 0 16px;${extra}">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f2;padding:24px 12px;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#0a0a0a;font-size:15px;line-height:1.55">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:2px solid #0a0a0a;border-radius:0;padding:28px 24px">
<div style="font-weight:900;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px">Mad Monkey <span style="background:#ccff01;padding:2px 6px">Experience Database</span></div>
${p(`Hi ${esc(o.name)},`)}${p(esc(intro))}
<p style="margin:22px 0"><a href="${esc(o.link)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9999px">${cta}</a></p>
${p(esc(small), "font-size:13px;color:#555")}${after ? p(esc(after)) : ""}${p(esc(assistant))}${p("Any problems, message Charlie.", "margin:0")}
</div></body></html>`;
  return { subject, text, html };
}

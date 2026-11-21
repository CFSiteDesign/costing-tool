import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
// @deno-types="../_shared/lineup/engine.d.ts"
import { lineupView } from "../_shared/lineup/engine.js";
import { lineupSvg, type LineupAssets } from "../_shared/lineup/svg.ts";
import { posterWeek, lineupFileName, type LineupBundle } from "../_shared/lineup/week.ts";

// Weekly lineup posters (migration 035, 18 Nov 2026).
//   POST {action:"approve", location_id, week_start}   user JWT: render the final PNGs (post, 3x print, story) with
//        resvg, store them in the public `lineups` bucket and mark the week approved. Run again after a colourway
//        or KEY change on an approved week and it re-exports (the first approver is kept).
//   POST {action:"cron"}                                pg_cron, hourly: on the build slot (Thursday 10:00 hostel time)
//        make next week's draft and email the hostel's GMs; on the auto slot (Sunday 18:00) approve any draft for
//        the coming week. Only when sync_config lineup_enabled = 'true'. Each hostel's render runs as its own request
//        (action "auto_one" + the cron secret) so one request never renders more than one poster set.
// verify_jwt is off: user actions check the JWT here, cron steps only act on their own time slots.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SELF = `${SUPABASE_URL}/functions/v1/lineup`;
const APP = "https://madmonkeyhostels.com/experiencedashboard";
const DEFAULT_ASSETS = "https://raw.githubusercontent.com/CFSiteDesign/costing-tool/main/public/lineup/";
const WASM = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function config(): Promise<Record<string, string>> {
  const { data } = await admin.from("sync_config").select("key,value").like("key", "lineup_%");
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

// ---- rendering ---------------------------------------------------------------------------------------------------

let ready: Promise<{ fonts: Uint8Array[]; assets: LineupAssets }> | null = null;
function b64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function loadRenderer(base: string) {
  if (!ready) {
    ready = (async () => {
      const get = async (p: string) => {
        const r = await fetch(base + p);
        if (!r.ok) throw new Error(`asset ${p}: HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      };
      const [wasm, ...files] = await Promise.all([
        fetch(WASM).then((r) => r.arrayBuffer()),
        get("fonts/Anton-Regular.ttf"), get("fonts/Montserrat-SemiBold.ttf"), get("fonts/Montserrat-Black.ttf"), get("fonts/Prompt-Black.ttf"),
        get("mm-logo-black.png"), get("mm-logo-white.png"), get("all-in-sticker.png"),
      ]);
      await initWasm(wasm);
      const png = (u: Uint8Array, w: number, h: number) => ({ href: `data:image/png;base64,${b64(u)}`, w, h });
      return {
        fonts: files.slice(0, 4),
        assets: { logoBlack: png(files[4], 600, 226), logoWhite: png(files[5], 600, 181), allIn: png(files[6], 1130, 776) },
      };
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function renderAndStore(bundle: LineupBundle, colourway: string, base: string) {
  const { fonts, assets } = await loadRenderer(base);
  const week = posterWeek(bundle.week, bundle.row.key_picks ?? {});
  const opts = { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Montserrat" } };
  const post = lineupView(week, "post", colourway), story = lineupView(week, "story", colourway);
  const postSvg = lineupSvg(post, assets), storySvg = lineupSvg(story, assets);
  const out: Record<string, Uint8Array> = {
    post: new Resvg(postSvg, opts).render().asPng(),
    "post-print": new Resvg(postSvg, { ...opts, fitTo: { mode: "zoom" as const, value: 3 } }).render().asPng(),
    story: new Resvg(storySvg, opts).render().asPng(),
  };
  const ws = bundle.row.week_start, v = Date.now();
  const urls: Record<string, string> = {};
  for (const [kind, bytes] of Object.entries(out)) {
    const path = `${bundle.hostel.id}/${ws}/${lineupFileName(bundle.hostel.name, ws, kind as "post")}`;
    const { error } = await admin.storage.from("lineups").upload(path, bytes, { contentType: "image/png", upsert: true, cacheControl: "300" });
    if (error) throw new Error(`upload ${kind}: ${error.message}`);
    urls[kind] = `${admin.storage.from("lineups").getPublicUrl(path).data.publicUrl}?v=${v}`;
  }
  return {
    files: { post: urls.post, post_print: urls["post-print"], story: urls.story, colourway, rendered_at: new Date().toISOString() },
    flags: { fit: Math.min(post.fit, story.fit), tier: Math.max(post.tier, story.tier), overfull: post.overfull || story.overfull },
    data: week,
  };
}

/** Render, store and mark approved. by = null means auto-approved by the Sunday job. */
async function approve(bundle: LineupBundle, by: string | null, base: string) {
  const r = await renderAndStore(bundle, bundle.row.colourway, base);
  const first = bundle.row.status !== "approved";
  const patch: Record<string, unknown> = { status: "approved", files: r.files, flags: r.flags, data: r.data, colourway: bundle.row.colourway, updated_at: new Date().toISOString() };
  if (first) Object.assign(patch, { approved_at: new Date().toISOString(), approved_by: by, auto_approved: by === null });
  const { error } = await admin.from("lineup_weeks").update(patch).eq("id", bundle.row.id);
  if (error) throw new Error(error.message);
  return r;
}

async function bundleFor(db: SupabaseClient, location: string, weekStart: string): Promise<LineupBundle> {
  const { data, error } = await db.rpc("lineup_week", { p_location: location, p_week_start: weekStart });
  if (error) throw new Error(error.message);
  return data as LineupBundle;
}

// ---- weekly job -----------------------------------------------------------------------------------------------

function localNow(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, dow, hour: Number(parts.hour) };
}
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

async function notifyGms(bundle: LineupBundle) {
  const { data: emails } = await admin.rpc("lineup_gm_emails", { p_location: bundle.hostel.id });
  const to = (emails as string[] | null) ?? [];
  if (!to.length) return { sent: false, reason: "no GM email for this hostel" };
  const key = Deno.env.get("RESEND_API_KEY") ?? ((await admin.rpc("email_key")).data as string | null);
  if (!key) return { sent: false, reason: "no email key" };
  const from = Deno.env.get("RESEND_FROM") ?? "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";
  const link = `${APP}/lineup?hostel=${bundle.hostel.id}&week=${bundle.row.week_start}`;
  const subject = `Your weekly lineup for ${bundle.hostel.name} (${bundle.week.dates}) is ready to check`;
  const text = [
    `Hi!`, ``,
    `Next week's lineup poster for Mad Monkey ${bundle.hostel.name} (${bundle.week.dates}) is ready.`, ``,
    `Check it here, star each day's main event if you want one, pick your colours and press Approve:`, link, ``,
    `Names and times come from your experiences in the dashboard, so fix anything there and the poster updates.`,
    `If it isn't approved by Sunday 6pm it is approved as it is, so the poster is never missing.`, ``,
    `Mad Monkey Experience Dashboard`,
  ].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  return { sent: res.ok, to, status: res.status, id: res.ok ? (await res.json()).id : await res.text() };
}

async function cron(cfg: Record<string, string>) {
  if (cfg.lineup_enabled !== "true") return { skipped: "lineup_enabled is not true" };
  const buildDow = Number(cfg.lineup_build_dow ?? 4), buildHour = Number(cfg.lineup_build_hour ?? 10);
  const autoDow = Number(cfg.lineup_auto_dow ?? 7), autoHour = Number(cfg.lineup_auto_hour ?? 18);
  const { data: hostels } = await admin.from("locations").select("id,name,timezone").eq("is_active", true);
  const done: unknown[] = [];
  for (const h of hostels ?? []) {
    const now = localNow(h.timezone || "Asia/Bangkok");
    const nextMonday = plusDays(now.date, 8 - now.dow);
    if (now.dow === buildDow && now.hour === buildHour) {
      const b = await bundleFor(admin, h.id, nextMonday);
      if (!b.row.notified_at) {
        const result = await notifyGms(b);
        await admin.from("lineup_weeks").update({ notified_at: new Date().toISOString(), notify_result: result }).eq("id", b.row.id);
        done.push({ hostel: h.name, week: nextMonday, notify: result });
      }
    }
    if (now.dow === autoDow && now.hour === autoHour) {
      const b = await bundleFor(admin, h.id, nextMonday);
      if (b.row.status !== "approved") {
        // one request per hostel, so no single request renders more than one poster set
        const r = await fetch(SELF, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "auto_one", location_id: h.id, week_start: nextMonday, secret: cfg.lineup_cron_secret }) });
        done.push({ hostel: h.name, week: nextMonday, auto: r.status });
      }
    }
  }
  return { done };
}

// ---- entry ----------------------------------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "JSON body required" }, 400); }
  const cfg = await config();
  const base = cfg.lineup_asset_base || DEFAULT_ASSETS;

  try {
    if (body.action === "cron") return json(await cron(cfg));

    if (body.action === "auto_one") {
      if (!cfg.lineup_cron_secret || body.secret !== cfg.lineup_cron_secret) return json({ error: "Not allowed" }, 403);
      const b = await bundleFor(admin, body.location_id, body.week_start);
      if (b.row.status === "approved") return json({ ok: true, already: true });
      const r = await approve(b, null, base);
      console.log(JSON.stringify({ auto_approved: b.hostel.name, week: body.week_start, flags: r.flags }));
      return json({ ok: true, flags: r.flags });
    }

    if (body.action === "approve") {
      const auth = req.headers.get("Authorization") ?? "";
      const userDb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: u } = await userDb.auth.getUser();
      if (!u?.user) return json({ error: "Please sign in again." }, 401);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.week_start ?? "") || !body.location_id) return json({ error: "location_id and week_start are required" }, 400);
      const b = await bundleFor(userDb, body.location_id, body.week_start);   // checks this user can see the hostel
      if (!b.can_edit) return json({ error: "Your login can view the lineup but not approve it." }, 403);
      const t0 = Date.now();
      const r = await approve(b, u.user.id, base);
      console.log(JSON.stringify({ approved: b.hostel.name, week: body.week_start, by: u.user.email, ms: Date.now() - t0, flags: r.flags }));
      return json({ ok: true, bundle: await bundleFor(userDb, body.location_id, body.week_start) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Something went wrong" }, 500);
  }
});

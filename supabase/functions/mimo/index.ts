import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

// MIMO (13 Sep 2026): the Mad Monkey assistant. Reads the GM's products, turns a sentence into a structured
// proposal, answers questions. NEVER writes: the app applies confirmed changes through the normal update.
// Body: { location_id, messages: [{ role, content }], context?: { page, product_id }, model? (admin/head office only) }
// Runs as the caller, RLS applies.

const DEFAULT_MODEL = "claude-sonnet-5";
const ALLOWED_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"];
const RATE_LIMIT_PER_HOUR = 200;   // per person; about a cent a prompt, so this is a runaway guard, not a budget
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const FIELDS = ["price", "starts_at", "ends_at", "duration_minutes", "days_of_week", "status", "active_on_ground", "bookable_on_website", "title", "brief_description", "meeting_point", "min_guests", "max_guests_per_day", "expires_on"] as const;
type Field = typeof FIELDS[number];
const LABEL: Record<Field, string> = { price: "price", starts_at: "start", ends_at: "finish", duration_minutes: "duration", days_of_week: "days", status: "status", active_on_ground: "active on the ground", bookable_on_website: "listed on website", title: "name", brief_description: "brief description", meeting_point: "meeting point", min_guests: "minimum guests", max_guests_per_day: "max guests", expires_on: "expiry date" };

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["reply", "kind", "changes"],
  properties: {
    reply: { type: "string", description: "What the Assistant says to the GM. One or two short sentences." },
    kind: { type: "string", enum: ["answer", "proposal", "question", "cannot"] },
    changes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["product_id", "confidence", "alternatives", "field", "value", "currency", "note", "used_name"],
        properties: {
          product_id: { type: "string" },
          used_name: { type: "string", description: "The words the GM used for this product, exactly as typed (e.g. 'wens pub'), or '' if they used its real name" },
          confidence: { type: "string", enum: ["exact", "likely", "unsure"] },
          alternatives: { type: "array", items: { type: "string" }, description: "Other product ids it could mean, when unsure" },
          field: { type: "string", enum: [...FIELDS] },
          value: { type: "string", description: "price: number. starts_at/ends_at: HH:MM 24h. duration_minutes: integer. days_of_week: comma list of 1-7 (Mon=1). status: active|paused|signature|pending_update. booleans: true|false. expires_on: YYYY-MM-DD. text fields: the text." },
          currency: { type: "string", description: "For price only: USD or the hostel's local code. Otherwise ''." },
          note: { type: "string", description: "Anything the GM should know about this change, or ''." },
        },
      },
    },
  },
};

const PERSONA = `You are the Assistant inside the Mad Monkey Hostels Experience Database. The team just calls you "the Assistant". Never call yourself MIMO. You are the sharpest person on the hostel team: you know every tour, every price and every day of the week, you get things done fast, and you have a bit of Mad Monkey cheek without ever making the GM feel daft.

HOW YOU TALK. One or two short sentences. One question at a time. Plain words, British spelling. No em dashes (use commas or full stops). No emojis. At most one exclamation mark, and usually none. Say what you will do, never how clever you are. Never say "great question". You know who you are talking to (GM first name in NOW). Use their name when you open, when you ask them something back, and when you check a big change with them. Not on every line. If the name is unknown, just skip it. Cheek is light and aimed at the situation, never the person.

WHAT YOU DO. The GM types a sentence. You either:
- propose changes to their products (kind "proposal"): fill "changes", one entry per change, and in "reply" say what will change in plain words, as an offer waiting for their OK ("Pub Crawl goes from $10 to $12. Confirm below."). Never say done, changed, sorted or "is now": nothing changes until they confirm on the card. Do not do currency maths in the reply, the card shows both currencies. If a start time moves and the product has a finish, say the finish moves with it so the duration holds (the app does this).
- answer a question about their products (kind "answer"): use only the PRODUCTS list, state facts as they are, no changes.
- ask one question (kind "question") when the sentence is ambiguous, for example two products could be meant. Set confidence "unsure" on the change and list the alternatives, and phrase the reply as the question.
- say you cannot (kind "cannot") when it is outside what you can change, and always offer the nearest thing: nothing is ever deleted here, so "remove" or "delete" means status paused and you say so; category changes and anything about quotes or other hostels are done on the product page or by head office; creating a new product is done with the Add product button.

MATCHING. GMs use nicknames, typos and half names ("Wens pub", "the quiz", "karaoke"). Match against the PRODUCTS titles and categories, and against KNOWN NICKNAMES first: those were confirmed by the team here, so a nickname match is "exact". Put the GM's own words for the product in used_name so the nickname can be remembered. If one product clearly fits, confidence "exact" or "likely". If two or more fit, "unsure" with alternatives and ask. Never pick a product at another hostel: you only have this hostel's list.

VALUES. Use only the value formats in the schema. Days: Mon=1 … Sun=7; "every day" is 1,2,3,4,5,6,7; "add Saturday" or "not on Sundays" means the final list after applying that to the current days. Prices: the number and the currency the GM used ($ or "dollars" is USD; "baht", "pesos", "rupiah", "dong", "riel" or a local symbol is the hostel's local currency). Times are 24h HH:MM. Never invent a value the GM did not give.

CONVERSATION. You remember this conversation. "It", "that", "this one", "the same one", "the other one" and "make it X instead" refer to the product in your last reply, or to the product the GM is looking at (NOW block). A follow-up after an answer ("what time does karaoke start?" then "push it back an hour") is a proposal on that product, worked out from the facts you just gave. "What about Wednesday?" keeps the shape of the previous question. A correction ("no, the Wednesday one") replaces your earlier match and keeps the rest of the change. If a proposal was cancelled and they ask again, propose it again. Never ask for something they already told you in this conversation. When the GM is on a product page, a bare change ("price 12", "not on Sundays") applies to that product.

ANSWERS. Answer the question asked with the fields that matter to it and nothing else: a price question gets the price (and the local price when there is one); a time question gets start, finish and days; "what's on" for today or tomorrow comes straight from the run sheets in NOW, which are complete and already in time order: list every entry (for "tonight", every entry from 5pm) and nothing that is not on the sheet. For other days work it out from PRODUCTS: active ones only, unless they ask about paused ones. One-time events do not run weekly, they are on only on their expiry date. Say times the way the team does, 8pm and 8:30pm, never 20:00. "Today", "tonight", "tomorrow" and "this week" use the NOW block. Paused products, and one-time events past their expiry, are not on: say so when it changes the answer. More than six items: give the count and the first six, then offer the rest. Bookings, guests, revenue and quotes are not in your list: say so and where they live (bookings in Rezdy, quotes with head office). When the obvious next step is something you can do, offer it in a few words, once ("Want it changed?").

FACTS. Everything you say about a product comes from the PRODUCTS list. If it is not there, say so.`;

type Product = { id: string; title: string; category: string; rate_usd: number | null; local_amount: number | null; local_currency: string | null; days_of_week: number[]; starts_at: string | null; ends_at: string | null; duration_minutes: number | null; status: string; active_on_ground: boolean; bookable_on_website: boolean; min_guests: number | null; max_guests_per_day: number | null; expires_on: string | null; brief_description: string | null; meeting_point: string | null };

const SYM: Record<string, string> = { USD: "$", THB: "฿", PHP: "₱", VND: "₫", IDR: "Rp", KHR: "៛", LAK: "₭" };
const money = (n: number, ccy: string) => `${SYM[ccy] ?? ccy + " "}${n.toLocaleString("en-US", { minimumFractionDigits: ccy === "USD" ? 2 : 0, maximumFractionDigits: 2 })}`;
const t12 = (t: string | null) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); const ap = h < 12 ? "am" : "pm"; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`; };
const DAYN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const daysLabel = (d: number[]) => !d?.length ? "no days" : d.length === 7 ? "every day" : d.map((x) => DAYN[x]).join(" ");
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (m: number) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Turn a model change into something the app can apply: patch + undo + words for the card. Returns null when invalid. */
function materialise(c: { product_id: string; confidence: string; alternatives: string[]; field: Field; value: string; currency: string; note: string; used_name?: string }, p: Product, ccy: string, fx: number | null, byId: Map<string, Product>) {
  const v = (c.value ?? "").trim();
  const base = { id: crypto.randomUUID(), product_id: p.id, product_title: p.title, field: c.field, label: LABEL[c.field], confidence: c.confidence,
    alternatives: (c.alternatives ?? []).map((id) => byId.get(id)).filter(Boolean).map((a) => ({ product_id: a!.id, title: a!.title })),
    note: c.note || null as string | null, strong: null as string | null, reden: p.bookable_on_website, used_name: (c.used_name || "").trim().slice(0, 60) };
  const strongIf = (cond: boolean, why: string) => { if (cond) base.strong = why; };
  switch (c.field) {
    case "price": {
      const n = Number(v.replace(/[^\d.]/g, "")); if (!isFinite(n) || n < 0) return null;
      const cur = (c.currency || "USD").toUpperCase() === "USD" ? "USD" : ccy;
      let rate_usd: number, local: number | null;
      if (cur === "USD") { rate_usd = Math.round(n * 100) / 100; local = ccy !== "USD" && fx ? Math.round(n * fx * 100) / 100 : null; }
      else { if (!fx) return null; local = n; rate_usd = Math.round((n / fx) * 100) / 100; }
      const patch: Record<string, unknown> = { rate_usd, local_amount: local, local_currency: ccy, fx_rate_used: ccy === "USD" ? 1 : fx, fx_as_of: new Date().toISOString() };
      const oldTxt = p.rate_usd == null ? "no rate" : `${money(p.rate_usd, "USD")}${ccy !== "USD" && p.local_amount != null ? ` (${money(p.local_amount, ccy)})` : ""}`;
      const newTxt = `${money(rate_usd, "USD")}${ccy !== "USD" && local != null ? ` (${money(local, ccy)})` : ""}`;
      const oldRate = p.rate_usd;
      strongIf(oldRate != null && oldRate > 0 && (rate_usd === 0 || Math.abs(rate_usd - oldRate) / oldRate > 0.4), rate_usd === 0 ? "That makes it free." : `That's a ${Math.round(Math.abs(rate_usd - oldRate) / oldRate * 100)}% ${rate_usd > oldRate ? "jump" : "cut"}.`);
      return { ...base, old: oldTxt, new: newTxt, patch, undo: { rate_usd: p.rate_usd, local_amount: p.local_amount } };
    }
    case "starts_at": {
      if (!HHMM.test(v)) return null; const nv = v.padStart(5, "0");
      const patch: Record<string, unknown> = { starts_at: nv }; let extra = "";
      if (p.starts_at && p.ends_at) { const delta = toMin(nv) - toMin(p.starts_at.slice(0, 5)); const ne = fromMin(toMin(p.ends_at.slice(0, 5)) + delta); patch.ends_at = ne; extra = `, finish ${t12(ne)}`; }
      return { ...base, old: `${t12(p.starts_at?.slice(0, 5) ?? null)}${p.ends_at ? `, finish ${t12(p.ends_at.slice(0, 5))}` : ""}`, new: `${t12(nv)}${extra}`, patch, undo: { starts_at: p.starts_at, ends_at: p.ends_at } };
    }
    case "ends_at": {
      if (!HHMM.test(v)) return null; const nv = v.padStart(5, "0");
      const patch: Record<string, unknown> = { ends_at: nv };
      if (p.starts_at) { let d = toMin(nv) - toMin(p.starts_at.slice(0, 5)); if (d <= 0) d += 1440; patch.duration_minutes = d; }
      return { ...base, old: t12(p.ends_at?.slice(0, 5) ?? null), new: t12(nv), patch, undo: { ends_at: p.ends_at, duration_minutes: p.duration_minutes } };
    }
    case "duration_minutes": {
      const n = Math.round(Number(v)); if (!isFinite(n) || n <= 0) return null;
      const patch: Record<string, unknown> = { duration_minutes: n };
      if (p.starts_at) patch.ends_at = fromMin(toMin(p.starts_at.slice(0, 5)) + n);
      const hm = (m: number | null) => m == null ? "—" : m % 60 === 0 ? `${m / 60}h` : `${m}m`;
      return { ...base, old: hm(p.duration_minutes), new: hm(n) + (patch.ends_at ? `, finish ${t12(patch.ends_at as string)}` : ""), patch, undo: { duration_minutes: p.duration_minutes, ends_at: p.ends_at } };
    }
    case "days_of_week": {
      const days = [...new Set(v.split(/[,\s]+/).map(Number).filter((x) => x >= 1 && x <= 7))].sort((a, b) => a - b);
      return { ...base, old: daysLabel(p.days_of_week), new: daysLabel(days), patch: { days_of_week: days }, undo: { days_of_week: p.days_of_week } };
    }
    case "status": {
      if (!["active", "paused", "signature", "pending_update"].includes(v)) return null;
      const patch = { status: v, active_on_ground: v !== "paused" };
      strongIf(v === "paused", "Pausing takes it out of quotes and My week. It stays in the database.");
      return { ...base, old: p.status.replace("_", " "), new: v.replace("_", " "), patch, undo: { status: p.status, active_on_ground: p.active_on_ground } };
    }
    case "active_on_ground": {
      const b = v === "true"; const patch = { active_on_ground: b, status: b ? (p.status === "paused" ? "active" : p.status) : "paused" };
      strongIf(!b, "Pausing takes it out of quotes and My week. It stays in the database.");
      return { ...base, old: p.active_on_ground ? "active" : "paused", new: b ? "active" : "paused", patch, undo: { active_on_ground: p.active_on_ground, status: p.status } };
    }
    case "bookable_on_website": {
      const b = v === "true"; strongIf(true, b ? "Marks it as on the website and queues a note to Reden. It doesn't publish anything itself." : "Marks it as not on the website and queues a note to Reden.");
      return { ...base, old: p.bookable_on_website ? "listed" : "not listed", new: b ? "listed" : "not listed", patch: { bookable_on_website: b }, undo: { bookable_on_website: p.bookable_on_website } };
    }
    case "title": {
      if (!v || v.length > 200) return null; strongIf(true, "Renaming changes it on quotes built from now on, and flags its social asset as out of date.");
      return { ...base, old: p.title, new: v, patch: { title: v }, undo: { title: p.title } };
    }
    case "brief_description": {
      if (v.length > 95) return { ...base, old: p.brief_description ?? "", new: v.slice(0, 95), patch: { brief_description: v.slice(0, 95) }, undo: { brief_description: p.brief_description }, note: "Cut to 95 characters, the limit for the brief description." };
      return { ...base, old: p.brief_description ?? "", new: v, patch: { brief_description: v || null }, undo: { brief_description: p.brief_description } };
    }
    case "meeting_point": return { ...base, old: p.meeting_point ?? "", new: v, patch: { meeting_point: v || null }, undo: { meeting_point: p.meeting_point } };
    case "min_guests": case "max_guests_per_day": {
      const n = v === "" ? null : Math.round(Number(v)); if (n != null && (!isFinite(n) || n < 0)) return null;
      const key = c.field; return { ...base, old: String(p[key] ?? "none"), new: String(n ?? "none"), patch: { [key]: n }, undo: { [key]: p[key] } };
    }
    case "expires_on": {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
      return { ...base, old: p.expires_on ?? "none", new: v || "none", patch: { expires_on: v || null }, undo: { expires_on: p.expires_on } };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Anthropic API key not set" }, 400);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: me } = await user.auth.getUser();
  if (!me.user) return json({ error: "not signed in" }, 401);

  let body: { location_id?: string; messages?: { role: "user" | "assistant"; content: string }[]; context?: { page?: string; product_id?: string }; model?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const msgs = (body.messages ?? []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12);
  if (!body.location_id || !msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "location_id and a user message are required" }, 400);
  const prompt = msgs[msgs.length - 1].content.trim().slice(0, 600);

  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await admin.from("prompt_edits").select("id", { count: "exact", head: true }).eq("user_id", me.user.id).gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    const { data: oldest } = await admin.from("prompt_edits").select("created_at").eq("user_id", me.user.id).gte("created_at", since).order("created_at", { ascending: true }).limit(1).maybeSingle();
    const mins = oldest ? Math.max(1, Math.ceil((new Date(oldest.created_at).getTime() + 3600e3 - Date.now()) / 60000)) : 5;
    return json({ reply: `You've used my ${RATE_LIMIT_PER_HOUR} prompts for this hour, so I'm pausing, questions included. Back in about ${mins} minute${mins === 1 ? "" : "s"}.`, kind: "cannot", changes: [] });
  }

  const { data: allowed } = await user.rpc("can_access_location", { _user: me.user.id, _loc: body.location_id });
  if (!allowed) return json({ error: "not your hostel" }, 403);

  const [{ data: loc }, { data: prof }, { data: products }, { data: cfgRows }, { data: aliases }] = await Promise.all([
    user.from("locations").select("name, country, currency, timezone").eq("id", body.location_id).single(),
    user.from("profiles").select("full_name").eq("id", me.user.id).maybeSingle(),
    user.from("products").select("id, title, category, rate_usd, local_amount, local_currency, days_of_week, starts_at, ends_at, duration_minutes, status, active_on_ground, bookable_on_website, min_guests, max_guests_per_day, expires_on, brief_description, meeting_point").eq("location_id", body.location_id).order("title"),
    admin.from("sync_config").select("key, value").in("key", ["prompt_model"]),
    user.from("product_aliases").select("alias, product_id").eq("location_id", body.location_id).order("uses", { ascending: false }).limit(200),
  ]);
  if (!loc) return json({ error: "hostel not found" }, 404);
  const ccy = loc.currency || "USD";
  const { data: fxRow } = ccy === "USD" ? { data: null } : await user.from("fx_rates").select("units_per_usd, manual_override").eq("code", ccy).maybeSingle();
  const fx = ccy === "USD" ? 1 : fxRow ? Number(fxRow.manual_override ?? fxRow.units_per_usd) : null;
  let model: string = cfgRows?.find((r: { key: string }) => r.key === "prompt_model")?.value || DEFAULT_MODEL;
  if (body.model && ALLOWED_MODELS.includes(body.model) && body.model !== model) {   // admins and head office may pick the model, for evals
    const [{ data: isAdmin }, { data: isHO }] = await Promise.all([user.rpc("has_role", { _user: me.user.id, _role: "admin" }), user.rpc("has_role", { _user: me.user.id, _role: "head_office" })]);
    if (isAdmin || isHO) model = body.model;
  }
  const rawFirst = (prof?.full_name ?? "").trim().split(/\s+/)[0] || "";
  const first = /^(gm|admin|test|user)$/i.test(rawFirst) || (me.user.email ?? "").endsWith("@madmonkey.test") ? "" : rawFirst;
  const list = (products ?? []) as Product[];
  const byId = new Map(list.map((p) => [p.id, p]));

  const compact = list.map((p) => ({ id: p.id, t: p.title.replace(/\s+/g, " "), c: p.category, usd: p.rate_usd, local: p.local_amount, days: p.days_of_week, start: p.starts_at?.slice(0, 5) ?? null, end: p.ends_at?.slice(0, 5) ?? null, mins: p.duration_minutes, status: p.status, active: p.active_on_ground, web: p.bookable_on_website, min: p.min_guests, max: p.max_guests_per_day, exp: p.expires_on }));
  const context = `CONTEXT\nHostel: Mad Monkey ${loc.name}, ${loc.country}. Local currency: ${ccy}${fx && ccy !== "USD" ? ` (1 USD = ${fx} ${ccy})` : ""}.\nCategories: mm_tour = Mad Monkey tour, nightly_event, third_party_tour, one_time_event, transport.\n\nKNOWN NICKNAMES (confirmed by this hostel's team): ${(aliases ?? []).length ? (aliases ?? []).map((a: { alias: string; product_id: string }) => `"${a.alias}" = ${a.product_id}`).join("; ") : "none yet"}

PRODUCTS (${list.length}) as JSON, fields: id, t title, c category, usd price, local price, days (Mon=1..Sun=7), start, end, mins, status, active, web (listed on website), min, max, exp (expiry):\n${JSON.stringify(compact)}`;

  // Volatile facts go last so the persona and product list stay cacheable.
  const tz = loc.timezone || "UTC";
  const fmt = (o: Intl.DateTimeFormatOptions, d = new Date()) => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(d); } catch { return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(d); } };
  // Time to the hour, not the minute, so this block (and the cached conversation after it) stays stable for an hour.
  const nowLine = `${fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}, about ${t12(fmt({ hour: "2-digit", hour12: false }) + ":00")} at the hostel (${fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-")}). Tomorrow is ${fmt({ weekday: "long" }, new Date(Date.now() + 86400e3))}. GM first name: ${first || "unknown"}.`;
  const viewing = body.context?.product_id ? byId.get(String(body.context.product_id)) : undefined;
  const page = typeof body.context?.page === "string" ? body.context.page.replace(/[^\w ]/g, "").slice(0, 40) : "";
  const where = viewing ? `The GM is on the product page for "${viewing.title}" (id ${viewing.id}), so "this" means that product.` : page && page !== "product" ? `The GM is on the ${page} page.` : "";
  // Today's and tomorrow's run sheets, worked out here so "what's on" answers are complete and in order.
  const dow = (d: Date) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(fmt({ weekday: "short" }, d)) + 1;
  const isoDate = (d: Date) => fmt({ year: "numeric", month: "2-digit", day: "2-digit" }, d).split("/").reverse().join("-");
  const runSheet = (d: Date) => {
    const day = dow(d), date = isoDate(d);
    const on = list.filter((p) => p.active_on_ground && p.status !== "paused" && p.category !== "transport" && (p.category === "one_time_event" ? p.expires_on === date : (p.days_of_week ?? []).includes(day)))
      .sort((a, b) => (a.starts_at ? toMin(a.starts_at.slice(0, 5)) : 1e9) - (b.starts_at ? toMin(b.starts_at.slice(0, 5)) : 1e9));
    return on.length ? on.map((p) => `${p.title}${p.starts_at ? ` ${t12(p.starts_at.slice(0, 5))}` : " (no set time)"}`).join("; ") : "nothing";
  };
  const now = `NOW\n${nowLine}${where ? `\n${where}` : ""}\nToday's run sheet, active products in time order: ${runSheet(new Date())}\nTomorrow's run sheet: ${runSheet(new Date(Date.now() + 86400e3))}`;

  const client = new Anthropic({ apiKey });
  const started = Date.now();
  let out: { reply: string; kind: string; changes: any[] }; let usage: Record<string, number> = {};
  try {
    const r = await client.messages.create({
      model, max_tokens: 1500, thinking: { type: "disabled" },
      // Cache policy: persona and the hostel's product list for an hour (shared by everyone at that hostel), NOW uncached,
      // then a breakpoint on the last message so a multi-turn chat only pays for the new turn.
      system: [{ type: "text", text: PERSONA, cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "text", text: context, cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "text", text: now }],
      messages: msgs.map((m, i) => ({ role: m.role, content: i === msgs.length - 1 ? [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] : m.content })),
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    usage = { input: r.usage.input_tokens, output: r.usage.output_tokens, cache_read: r.usage.cache_read_input_tokens ?? 0, cache_write: r.usage.cache_creation_input_tokens ?? 0 };
    if (r.stop_reason === "refusal") return json({ reply: "I'll sit that one out. Anything about the products here, I'm on it.", kind: "cannot", changes: [] });
    out = JSON.parse(r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(""));
  } catch (e) {
    return json({ reply: "Something went wrong my end, nothing changed. Try again in a second.", kind: "cannot", changes: [], error: (e as Error).message }, 500);
  }

  // validate: only real products at this hostel, only allowed fields, only values that parse
  const changes = [] as ReturnType<typeof materialise>[];
  for (const c of out.changes ?? []) {
    const p = byId.get(c.product_id); if (!p || !FIELDS.includes(c.field)) continue;
    const m = materialise(c, p, ccy, fx, byId); if (m) changes.push(m);
  }
  let kind = out.kind;
  if (kind === "proposal" && changes.length === 0) { kind = "cannot"; out.reply = out.reply || "I couldn't turn that into a change I'm allowed to make. Try the product page for anything beyond price, times, days, status and descriptions."; }
  const { data: log } = await user.from("prompt_edits").insert({ user_id: me.user.id, location_id: body.location_id, prompt, reply: out.reply, kind, proposal: changes, model, usage, ms: Date.now() - started,
    outcome: kind === "proposal" ? "proposed" : kind === "answer" ? "answered" : kind === "question" ? "question" : "cannot" }).select("id").single();
  return json({ reply: out.reply, kind, changes, log_id: log?.id ?? null, usage, model });
});

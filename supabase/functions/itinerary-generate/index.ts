import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

// Detailed itinerary writer (10 Sep 2026). Claude writes the whole document from the quote's fact pack;
// the tool renders it. Facts in, words out: the model never sees a price and is told to invent nothing.
// Body: { quote_id, mode: "full" | "day", day_no?, instruction? }. Runs as the calling user (RLS applies).
// The voice examples + reference document live in sync_config ('itinerary_voice', seeded from voice.ts in the
// repo) so the prompt can be tuned without a redeploy. The model is sync_config 'itinerary_model'.

const DEFAULT_MODEL = "claude-opus-5-5";
// Model rules (Charlie, 5 Oct 2026): Sonnet 5.5 for chat, Opus 5.5 for agentic, creation and generation work.
// Sonnet 5.5 rejects thinking "disabled" (send "between_tools" to keep it off); Opus 5.5 can't switch thinking
// off at all, so effort is the only lever. Older models keep thinking disabled as before.
function claudeParams(model: string, effort: "low" | "medium" | "high"): { thinking?: Record<string, string>; effort?: string } {
  if (model === "claude-sonnet-5-5") return { thinking: { type: "between_tools" }, effort };
  if (model === "claude-opus-5-5") return { effort };
  return { thinking: { type: "disabled" } };
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── schemas (structured output: every property required, no extras) ──
const STR_LIST = { type: "array", items: { type: "string" } };
const BLOCK_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["time", "title", "body", "bullets", "highlights", "vibe", "source_line_id"],
  properties: {
    time: { type: "string", description: "Clock time like '7pm' or '8:45am', or '' when untimed" },
    title: { type: "string" }, body: { type: "string" },
    bullets: STR_LIST, highlights: STR_LIST, vibe: { type: "string" },
    source_line_id: { type: "string", description: "The quote line id this block comes from, or ''" },
  },
};
const DAY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["day_no", "date", "hostel", "title", "intro", "highlights", "vibe", "blocks", "accommodation", "notes"],
  properties: {
    day_no: { type: "integer" }, date: { type: "string" }, hostel: { type: "string" }, title: { type: "string" }, intro: { type: "string" },
    highlights: STR_LIST, vibe: { type: "string" },
    blocks: { type: "array", items: BLOCK_SCHEMA }, accommodation: { type: "string" }, notes: STR_LIST,
  },
};
const HEADER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "subtitle", "nights", "route", "intro", "inclusions", "not_included", "optional_extras", "transfers", "closing"],
  properties: {
    title: { type: "string" }, subtitle: { type: "string" }, nights: { type: "integer" }, route: STR_LIST, intro: { type: "string" },
    inclusions: STR_LIST, not_included: STR_LIST, optional_extras: STR_LIST, transfers: STR_LIST, closing: { type: "string" },
  },
};

// ── the brief ──
const RULES = `You write detailed group-trip itineraries for Mad Monkey Hostels, sent to travel partners and their clients.

VOICE. Second person, present tense, warm and a bit cheeky, plain words, short sentences. Sounds like a mate who works there, not a brochure. No em dashes anywhere (use commas or full stops). No exclamation marks except at most one per day. No emojis. British spelling.

FORMAT. Copy the structure and level of detail of the reference document below exactly: a header with package inclusions and meal counts, a not-included list, optional extras, transfers, then every single day of the trip in order with timed lines, and an accommodation line for every day. Every day exists even when nothing is booked (a free day still has check in / Meet Up / accommodation).

FACTS. Use only what is in the FACT PACK. Never invent times, places, meals, inclusions or activities. Never mention prices or money. If a detail is missing (a meeting time, a finish time, what a tour includes), leave it out and add a short item to that day's notes saying what needs confirming, e.g. "Confirm the meeting time for the food tour". Product names must be copied exactly from the fact pack. Each block that comes from a quote line must carry that line's id in source_line_id.

HOUSE LINES (Mad Monkey standard, use them):
- First day at a hostel: "2pm: Check in to Mad Monkey {hostel}".
- Every day at a Mad Monkey hostel, unless a booked activity runs over 7pm: "7pm: The Meet Up @ Mad Monkey bar, meet travellers from around the world + free drink" then "8pm: Hostel social activities or free time".
- The day a multi-day tour leaves: a note "You will need to check out of your room before leaving. Large luggage can be left in storage at Mad Monkey {hostel}", then "Meet at Mad Monkey {hostel} reception" 15 minutes before departure.
- Last day: "11am: Check out + onward travel".
- Accommodation line: "Mad Monkey {hostel}, shared dorm" for Dorm room types, "Mad Monkey {hostel}, private room" for Private; on tour nights use what the tour text says (homestay, onboard the boat), otherwise "".

BLOCKS. One block per timed thing, in time order. time is a clock time like "7pm" or "8:45am". For a booked activity: title = the product name exactly, body = one to three sentences in the voice, bullets = its hour by hour steps taken from the product's itinerary text (each bullet starts with the time when the text has one), highlights and vibe empty unless it is a multi-day tour. For a day inside a multi-day tour (the fact pack marks these with covered_by), write that day like the reference: title, intro, then the DAY's own highlights (3 to 6 short items from the tour's own itinerary text) and the DAY's vibe (one short paragraph), and keep blocks to the timed lines only (often there are none). Day-level highlights and vibe are only for multi-day tour days; leave them empty on ordinary days.

FREE DAYS. "Free day to explore {city}." One or two sentences: the guest experience team can recommend things to do. Then the Meet Up lines and the accommodation line.

MEAL COUNTS for the inclusions list: breakfasts = the number of breakfast lines in the quote; lunches and dinners only where an activity's inclusions text says lunch or dinner is included. Write them as "Breakfast x 5", "Lunch x 2".

TRANSFERS list: one line per transport line in the quote, "{vehicle} {origin} to {destination}", plus the departure time when known. If there are no transport lines, list the transfers the multi-day tours include (bus to Ha Giang and back, for example) as "included in the tour", otherwise leave the list empty.

NOT INCLUDED: flights, airport transfers (available on request), private room upgrades (available on request), optional or additional activities (available on request), meals not specifically mentioned, personal expenses, travel insurance. Adjust only if the fact pack contradicts one.`;

const FALLBACK_VOICE = `MAD MONKEY VOICE: like the ALL IN trip pages. Second person, present tense, short punchy sentences, warm and a bit cheeky, concrete details over adjectives. Example: "Out the door at 8am and onto the water at Lan Ha Bay, Halong's quieter, wilder neighbour. Days are for swimming straight off the boat, tubing and beach volleyball. Come sunset the boat party starts and the limestone towers turn gold."`;

// ── fact pack helpers ──
type Line = { id: string; kind: string; title: string; starts_at: string | null; ends_at: string | null; duration_minutes: number | null; product: Record<string, unknown> | null };
type Day = { day_no: number; date: string | null; hostel: string; lines: Line[]; covered_by?: { line_id: string; title: string; day_index: number; total_days: number }[] };

function tourDays(l: Line): number {
  const m = /(\d+)\s*D\s*\/?\s*(\d+)\s*N/i.exec(l.title) || /(\d+)\s*days?\s*\/?\s*(\d+)\s*nights?/i.exec(l.title);
  if (m) return Number(m[1]);
  if (l.duration_minutes && l.duration_minutes >= 1440) return Math.round(l.duration_minutes / 1440);
  return 1;
}
function annotate(facts: { days: Day[] }) {
  for (const d of facts.days) d.covered_by = [];
  for (const d of facts.days) {
    for (const l of d.lines) {
      if (l.kind !== "experience") continue;
      const n = tourDays(l);
      if (n <= 1) continue;
      for (let i = 0; i < n; i++) {
        const target = facts.days.find((x) => x.day_no === d.day_no + i);
        if (target) target.covered_by!.push({ line_id: l.id, title: l.title, day_index: i + 1, total_days: n });
      }
    }
  }
  return facts;
}

const to24 = (t: string | null) => {
  if (!t) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] ?? 0);
  if (m[3]) { const ap = m[3].toLowerCase(); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
};

/** Deterministic check: times and product names in the output must match the quote. */
function check(days: Day[], outDays: any[]): string[] {
  const flags: string[] = [];
  const lineById = new Map<string, Line>();
  for (const d of days) for (const l of d.lines) lineById.set(l.id, l);
  const referenced = new Set<string>();
  for (const od of outDays) {
    for (const b of od.blocks) {
      if (!b.source_line_id) continue;
      const l = lineById.get(b.source_line_id);
      if (!l) { b.flagged = "Refers to a quote line that doesn't exist"; b.source_line_id = null; continue; }
      referenced.add(l.id);
      if (l.starts_at && b.time) {
        const want = l.starts_at.slice(0, 5), got = to24(b.time);
        if (got && got !== want) b.flagged = `Quote says ${want}`;
      }
      if (l.kind === "experience" && b.title.trim().toLowerCase() !== l.title.trim().toLowerCase().replace(/\s+/g, " ")) {
        b.flagged = (b.flagged ? b.flagged + ". " : "") + `Quote calls it "${l.title.replace(/\s+/g, " ")}"`;
      }
    }
  }
  for (const d of days) for (const l of d.lines) {
    if ((l.kind === "experience" || l.kind === "transport") && !referenced.has(l.id)) flags.push(`Day ${d.day_no}: "${l.title.replace(/\s+/g, " ")}" is on the quote but not in the itinerary`);
  }
  return flags;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Anthropic API key not set. Add the Supabase secret ANTHROPIC_API_KEY." }, 400);
  const authHeader = req.headers.get("Authorization") ?? "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { quote_id?: string; mode?: string; day_no?: number; instruction?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!body.quote_id) return json({ error: "quote_id required" }, 400);
  const mode = body.mode === "day" ? "day" : "full";

  const { data: facts, error: fe } = await user.rpc("itinerary_facts", { p_quote_id: body.quote_id });
  if (fe) return json({ error: fe.message }, 403);
  annotate(facts);
  const { data: cfgRows } = await admin.from("sync_config").select("key, value").in("key", ["itinerary_model", "itinerary_voice"]);
  const cfg = Object.fromEntries((cfgRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const model = cfg.itinerary_model || DEFAULT_MODEL;
  const voice = cfg.itinerary_voice || FALLBACK_VOICE;
  const { data: me } = await user.auth.getUser();

  const client = new Anthropic({ apiKey });
  // The rules + voice block is identical for every quote, so it is the only thing worth caching.
  // Day calls carry just their own day's facts; only the header call needs the whole pack.
  const base: Anthropic.TextBlockParam = { type: "text", text: RULES + "\n\n" + voice, cache_control: { type: "ephemeral" } };
  const systemFor = (extra?: string): Anthropic.TextBlockParam[] => extra ? [base, { type: "text", text: extra }] : [base];
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  // Low effort: Opus still writes every word, but thinks less first, so a long trip (header, then every day in
  // parallel) stays inside the function time limit. Raise to "medium" once the project is off the free plan.
  const cp = claudeParams(model, "low");
  const room = cp.thinking?.type === "disabled" ? 0 : 10000;   // thinking tokens count toward max_tokens
  const call = async (prompt: string, schema: Record<string, unknown>, max_tokens: number, system?: string) => {
    const r = await client.messages.create({
      model, max_tokens: max_tokens + room, system: systemFor(system),
      ...(cp.thinking ? { thinking: cp.thinking } : {}),   // Opus 5.5 always thinks; `room` above makes space for it
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema }, ...(cp.effort ? { effort: cp.effort } : {}) },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    usage.input += r.usage.input_tokens; usage.output += r.usage.output_tokens;
    usage.cache_read += r.usage.cache_read_input_tokens ?? 0; usage.cache_write += r.usage.cache_creation_input_tokens ?? 0;
    console.log(JSON.stringify({ call: prompt.slice(0, 24), stop: r.stop_reason, out: r.usage.output_tokens, cache_read: r.usage.cache_read_input_tokens, cache_write: r.usage.cache_creation_input_tokens }));
    if (r.stop_reason === "refusal") throw new Error("The writer declined this request");
    if (r.stop_reason === "max_tokens") throw new Error(`The writer ran out of room on "${prompt.slice(0, 30)}…" (${max_tokens} tokens)`);
    const text = r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    try { return JSON.parse(text); }
    catch { throw new Error(`Bad JSON from the writer (stop ${r.stop_reason}, ${text.length} chars): ${text.slice(0, 160)}`); }
  };
  const dayPrompt = (d: Day, instruction?: string) => {
    const total = facts.days.length;
    const around = facts.days.map((x: Day) => `Day ${x.day_no}: ${x.hostel}${x.lines.filter((l) => l.kind === "experience" || l.kind === "transport").map((l) => ", " + l.title.replace(/\s+/g, " ")).join("")}`).join("\n");
    return `Write Day ${d.day_no} of ${total} only. The trip is "${facts.quote.title}" for ${facts.quote.pax} travellers.\n\nThis day's facts (the only source of truth for this day):\n${JSON.stringify(d)}\n\nThe whole trip for context (do not write these other days):\n${around}\n\n` +
      (d.covered_by?.length ? `This day is day ${d.covered_by[0].day_index} of ${d.covered_by[0].total_days} of "${d.covered_by[0].title.replace(/\s+/g, " ")}". Write it in the multi-day tour style (title, intro, highlights, vibe) using only that tour's itinerary and description text.\n\n` : "") +
      (d.day_no === 1 ? "This is the arrival day: start with check in.\n" : "") + (d.day_no === total ? "This is the last night: tomorrow is check out + onward travel, mention it in the closing note.\n" : "") +
      (instruction ? `\nThe person editing asked for this change: ${instruction}\n` : "") + `\nReturn the Day object.`;
  };

  const started = Date.now();
  try {
    if (mode === "day") {
      const { data: row } = await user.from("quote_itineraries").select("doc").eq("quote_id", body.quote_id).maybeSingle();
      if (!row) return json({ error: "Generate the itinerary first" }, 400);
      const d = facts.days.find((x: Day) => x.day_no === body.day_no);
      if (!d) return json({ error: "day not found" }, 400);
      const day = await call(dayPrompt(d, body.instruction), DAY_SCHEMA, 6000);
      const doc = row.doc; const idx = doc.days.findIndex((x: any) => x.day_no === body.day_no);
      const fresh = finishDay(day);
      doc.flags = check(facts.days, [fresh]);
      if (idx >= 0) doc.days[idx] = fresh; else doc.days.push(fresh);
      await user.from("quote_itineraries").update({ doc, updated_by: me.user?.id }).eq("quote_id", body.quote_id);
      return json({ doc, usage, ms: Date.now() - started });
    }

    // full: header first (creates the cache), then every day in parallel
    const header = await call(`Write the header section for the whole trip: title (the trip name), subtitle (nights and route), nights, route, intro (two or three sentences), package inclusions with meal counts, not included, optional extras, transfers, and a one or two sentence closing. Return the header object.`, HEADER_SCHEMA, 4000, "FACT PACK (the only source of truth):\n" + JSON.stringify(facts));
    const days = await Promise.all(facts.days.map((d: Day) => call(dayPrompt(d), DAY_SCHEMA, 6000)));
    const outDays = days.map(finishDay).sort((a, b) => a.day_no - b.day_no);
    const flags = check(facts.days, outDays);
    const doc = { ...header, days: outDays, flags };
    const { error: ue } = await user.from("quote_itineraries").upsert({ quote_id: body.quote_id, doc, model, generated_at: new Date().toISOString(), generation_meta: { usage, ms: Date.now() - started }, updated_by: me.user?.id }, { onConflict: "quote_id" });
    if (ue) return json({ error: ue.message }, 500);
    return json({ doc, usage, ms: Date.now() - started, model });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function finishDay(day: any) {
  day.date = day.date || null;
  day.highlights = day.highlights ?? []; day.vibe = day.vibe ?? "";
  day.blocks = (day.blocks ?? []).map((b: any) => ({ id: crypto.randomUUID(), ...b, source_line_id: b.source_line_id || null, photo_url: null, flagged: null }));
  return day;
}

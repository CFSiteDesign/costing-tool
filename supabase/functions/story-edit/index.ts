import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

// Weekly story text edits (Oct 2026). The GM types a quick change ("remove the Tuesday quiz", "headline: BIG WEEK")
// and gets the story text back with only that change made. Edits the story only, never the database.
// Body: { location_id, doc, instruction }   Runs as the caller.

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ITEM = { type: "object", additionalProperties: false, required: ["time", "title"], properties: { time: { type: "string" }, title: { type: "string" } } };
const DAY = { type: "object", additionalProperties: false, required: ["day", "date", "items"], properties: { day: { type: "string" }, date: { type: "string" }, items: { type: "array", items: ITEM } } };
const DOC = { type: "object", additionalProperties: false, required: ["eyebrow", "headline", "sticker", "days"],
  properties: { eyebrow: { type: "string" }, headline: { type: "string" }, sticker: { type: "string" }, days: { type: "array", items: DAY } } };
const SCHEMA = { type: "object", additionalProperties: false, required: ["reply", "changed", "doc"],
  properties: { reply: { type: "string", description: "One short sentence on what changed, or why nothing did." }, changed: { type: "boolean" }, doc: DOC } };

const RULES = `You edit the text on a Mad Monkey Hostels weekly Instagram story. The GM types one quick change; you return the
whole story with ONLY that change made. Everything else stays exactly as it was, character for character.

What you can change: the eyebrow (small line at the top), the headline, the sticker text, a day's label, an event's
time or title, and removing an event or a whole day. Reordering events within a day is fine if asked.

Rules:
- Never add an event, time, price or detail the GM did not give you. If they ask you to add one and give the details, add it.
- At most 3 events per day. If a change would make 4, keep the first 3 and say so.
- Remove means remove. If a day ends up with no events, drop the day.
- Headline, event titles, day labels and the sticker are UPPERCASE. Times look like 8PM, 8:30PM, 10AM.
- Mad Monkey voice: say less, hit harder. Display lines are 12 words or fewer. Short, punchy, cheeky, never corporate.
- British spelling. No em dashes. No emojis. Never these words: premium, boutique, curated, hospitality solutions,
  discerning, elevated, bespoke.
- The brand is only ever written MAD MONKEY. Never invent an abbreviation.
- If the instruction is unclear or is not about this story's text, change nothing (changed=false) and say what you need.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Anthropic API key not set" }, 400);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: me } = await user.auth.getUser();
  if (!me.user) return json({ error: "not signed in" }, 401);

  let body: { location_id?: string; doc?: unknown; instruction?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const instruction = (body.instruction ?? "").trim().slice(0, 400);
  if (!body.location_id || !body.doc || !instruction) return json({ error: "location_id, doc and instruction are required" }, 400);
  const { data: allowed } = await user.rpc("can_access_location", { _user: me.user.id, _loc: body.location_id });
  if (!allowed) return json({ error: "not your hostel" }, 403);

  const client = new Anthropic({ apiKey });
  try {
    const r = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 2000, thinking: { type: "disabled" },
      system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `STORY:\n${JSON.stringify(body.doc)}\n\nCHANGE: ${instruction}` }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const out = JSON.parse(r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(""));
    // belt and braces: cap 3 per day, drop empty days, strip em dashes
    const clean = (s: string) => String(s ?? "").replace(/—/g, ",").slice(0, 120);
    out.doc.days = (out.doc.days ?? []).map((d: { day: string; date: string; items: { time: string; title: string }[] }) => ({
      day: clean(d.day), date: clean(d.date), items: (d.items ?? []).slice(0, 3).map((i) => ({ time: clean(i.time), title: clean(i.title) })),
    })).filter((d: { items: unknown[] }) => d.items.length > 0);
    for (const k of ["eyebrow", "headline", "sticker"]) out.doc[k] = clean(out.doc[k]);
    return json({ reply: clean(out.reply), changed: !!out.changed, doc: out.doc });
  } catch (e) {
    return json({ error: (e as Error).message, reply: "That didn't work my end, nothing changed. Try again in a second." }, 500);
  }
});

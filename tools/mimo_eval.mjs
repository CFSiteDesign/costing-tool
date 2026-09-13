// Runs a set of GM sentences through the live MIMO function on two models and writes the replies side by side.
// Read-only: MIMO never writes to products; it only logs to prompt_edits. Usage:
//   MIMO_EVAL_EMAIL=... MIMO_EVAL_PASSWORD=... node tools/mimo_eval.mjs [location_name]
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((s) => s.trim())));
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const email = process.env.MIMO_EVAL_EMAIL, password = process.env.MIMO_EVAL_PASSWORD;
if (!email || !password) { console.error("set MIMO_EVAL_EMAIL and MIMO_EVAL_PASSWORD"); process.exit(1); }
// MIMO_EVAL_MODELS=claude-sonnet-5 and MIMO_EVAL_ONLY=tonight narrow a run.
const MODELS = (process.env.MIMO_EVAL_MODELS ?? "claude-sonnet-5,claude-opus-5").split(",");
const SCENARIOS = [
  { name: "Typo + price change", turns: ["the pub crwal is 12 bucks now"] },
  { name: "Ambiguous product", turns: ["move the pool thing to 3pm"] },
  { name: "Two changes in one line", turns: ["kulen now 45 dollars and runs mon wed fri"] },
  { name: "Follow-up across turns", turns: ["what time does karaoke start?", "push it back an hour"] },
  { name: "Delete request (not allowed)", turns: ["get rid of the music quiz, nobody turns up"] },
  { name: "Context check: tonight", turns: ["what's on tonight?"] },
  { name: "Capacity question", turns: ["does each experience have a ticket limit?"] },
];
const auth = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
if (!auth.access_token) { console.error("login failed", auth); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" };
const locs = await fetch(`${URL}/rest/v1/locations?select=id,name&name=eq.${encodeURIComponent(process.argv[2] ?? "Siem Reap")}`, { headers: H }).then((r) => r.json());
const loc = locs[0]; if (!loc) { console.error("no such hostel"); process.exit(1); }
const memory = (t) => t.content + ((t.changes ?? []).length ? `\n(proposed: ${t.changes.map((c) => `${c.product_title}: ${c.label} ${c.old} -> ${c.new}`).join("; ")})` : "");

const results = [];
for (const sc of SCENARIOS.filter((x) => !process.env.MIMO_EVAL_ONLY || x.name.toLowerCase().includes(process.env.MIMO_EVAL_ONLY.toLowerCase()))) {
  const row = { scenario: sc.name, turns: sc.turns, by: {} };
  for (const model of MODELS) {
    const history = []; const replies = [];
    for (const u of sc.turns) {
      history.push({ role: "user", content: u });
      const t0 = Date.now();
      const r = await fetch(`${URL}/functions/v1/mimo`, { method: "POST", headers: H, body: JSON.stringify({ location_id: loc.id, model, context: { page: "Experiences list" }, messages: history.map((t) => ({ role: t.role, content: t.role === "assistant" ? memory(t) : t.content })) }) }).then((r) => r.json());
      const ms = Date.now() - t0;
      const turn = { role: "assistant", content: r.reply ?? `ERROR ${r.error ?? JSON.stringify(r)}`, changes: r.changes ?? [] };
      history.push(turn);
      replies.push({ user: u, reply: turn.content, kind: r.kind, model_used: r.model, ms, usage: r.usage, changes: (r.changes ?? []).map((c) => ({ product: c.product_title, field: c.label, old: c.old, new: c.new, confidence: c.confidence, strong: c.strong, used_name: c.used_name, alternatives: c.alternatives?.map((a) => a.title) })) });
      console.log(`${sc.name} | ${model} | ${u} -> [${r.kind}] ${turn.content} (${ms}ms)`);
    }
    row.by[model] = replies;
  }
  results.push(row);
}
const out = process.env.MIMO_EVAL_ONLY ? `tools/data/mimo_eval_last.json` : `tools/data/mimo_eval_${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(out, JSON.stringify({ hostel: loc.name, ran_at: new Date().toISOString(), results }, null, 2));
console.log("wrote", out);

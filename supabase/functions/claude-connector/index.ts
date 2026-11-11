import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

// Claude connector for the Experience Database (Kyle Kenny via Charlie, 11 Nov 2026).
//
// A remote MCP server (Streamable HTTP, plain JSON responses, stateless) that people add to their own Claude as a
// custom connector: Claude > Settings > Connectors > Add custom connector > paste their personal link
//   https://<project>.supabase.co/functions/v1/claude-connector/<token>
// Only a SHA-256 of the token is stored (connector_tokens). Revoke a link by setting revoked_at.
//
// READ ONLY, by design. Every query runs as the Postgres login mcp_reader (migration 032), which can read the
// views in schema "connector" and nothing else, inside a READ ONLY transaction with a statement timeout. The
// service role is only used to check the token and to fetch mcp_reader's password from Vault.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const SERVER = { name: "mad-monkey-experience-database", title: "Mad Monkey Experience Database", version: "1.0.0" };
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_ROWS = 500;
const MAX_TEXT = 150_000;      // characters per tool result
const MAX_CELL = 4_000;        // characters per text value

const INSTRUCTIONS = `Mad Monkey Hostels Experience Database (people also call it the Experience Dashboard): every tour, nightly event, one-time event, 3rd party tour and transport route at every Mad Monkey hostel in South East Asia, with prices, days, times, descriptions, website status, change history, room rates, group quotes and ALL IN trip bookings. Read only: nothing can be changed from here.
Start with overview. Use search_experiences, get_experience, whats_on and recent_changes for everyday questions, and run_sql for anything else (counts, comparisons, lists, exports).
Glossary: live = active on the ground and not paused. on_website = listed on madmonkeyhostels.com (Reden updates the website and is told about changes). price_usd = headline USD price; price_local + local_currency = what guests pay locally; price_options = named alternative prices. Weekdays are 1 = Monday ... 7 = Sunday. Categories: mm_tour, nightly_event, third_party_tour, one_time_event, transport. Status: active, paused, signature, pending_update.
Always name the hostel when you answer about one, and say when a value is missing rather than guessing.`;

// ---- database --------------------------------------------------------------------------------------------------

type Sql = ReturnType<typeof postgres>;
let sqlClient: Sql | null = null;

async function db(): Promise<Sql> {
  if (sqlClient) return sqlClient;
  const { data: password, error } = await admin.rpc("connector_db_password");
  if (error || !password) throw new Error("The connector's database login is not set up yet.");
  const base = new URL(Deno.env.get("SUPABASE_DB_URL")!);
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const pooled = base.hostname.includes("pooler.supabase.com");
  sqlClient = postgres({
    host: base.hostname,
    port: Number(base.port || 5432),
    database: decodeURIComponent(base.pathname.slice(1)) || "postgres",
    username: pooled ? `mcp_reader.${ref}` : "mcp_reader",
    password: String(password),
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: base.searchParams.get("sslmode") === "disable" ? false : "prefer",
  });
  return sqlClient;
}

// every query: read only transaction, 20s cap, as mcp_reader
async function read<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  const sql = await db();
  return await sql.begin("read only", async (tx) => {
    await tx`set local statement_timeout = '20s'`;
    return await fn(tx as unknown as Sql);
  }) as T;
}

// ---- helpers ---------------------------------------------------------------------------------------------------

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const CATEGORIES = ["mm_tour", "nightly_event", "third_party_tour", "one_time_event", "transport"];
const STATUSES = ["active", "paused", "signature", "pending_update"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ToolError extends Error {}

function clean(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return String(v);
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;   // plain dates come back as midnight UTC
  }
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return v.length > MAX_CELL ? v.slice(0, MAX_CELL) + " [cut]" : v;
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const c = clean(x);
      if (c !== undefined && !(Array.isArray(c) && c.length === 0)) out[k] = c;
    }
    return out;
  }
  return v;
}

/** JSON text for Claude, trimmed to MAX_TEXT by dropping rows from the end */
function pack(result: Record<string, unknown>, rowsKey = "rows"): string {
  const cleaned = clean(result) as Record<string, unknown>;
  let text = JSON.stringify(cleaned);
  const rows = cleaned[rowsKey];
  if (text.length > MAX_TEXT && Array.isArray(rows)) {
    let keep = rows.length;
    while (keep > 1 && text.length > MAX_TEXT) {
      keep = Math.floor(keep * 0.8);
      text = JSON.stringify({ ...cleaned, [rowsKey]: rows.slice(0, keep),
        note: `Result too long: showing the first ${keep} of ${rows.length} rows. Ask for fewer columns or rows.` });
    }
  }
  return text;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
function int(v: unknown, def: number, max: number) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
}
function weekday(v: unknown): number | null {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  const i = DAYS.indexOf(s.slice(0, 3));
  if (i < 0) throw new ToolError(`Unknown day "${v}". Use Monday to Sunday.`);
  return i + 1;
}
function oneOf(v: unknown, list: string[], name: string) {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (!list.includes(s)) throw new ToolError(`Unknown ${name} "${v}". Use one of: ${list.join(", ")}.`);
  return s;
}

async function findHostel(tx: Sql, name: unknown) {
  const h = str(name);
  if (!h) throw new ToolError("Say which hostel.");
  const rows = await tx`select hostel_id, hostel, country, timezone from connector.hostels
    where hostel ilike ${"%" + h + "%"} or country ilike ${h} order by hostel`;
  const exact = rows.find((r) => String(r.hostel).toLowerCase() === h.toLowerCase());
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  const all = rows.length ? rows : await tx`select hostel from connector.hostels order by hostel`;
  throw new ToolError(`${rows.length ? "More than one hostel matches" : "No hostel matches"} "${h}". Hostels: ${all.map((r) => r.hostel).join(", ")}.`);
}

// ---- tools -----------------------------------------------------------------------------------------------------

type Tool = {
  name: string; title: string; description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
};

const LIST_COLUMNS = `id, hostel, country, category_label as category, title, status, live, on_website, urgent, days, dated_runs,
  starts_at, ends_at, price_usd, price_local, local_currency, price_options, operator`;

const tools: Tool[] = [
  {
    name: "overview",
    title: "Overview",
    description: "Start here. Every hostel with its experience counts (total, live, on the website, transport routes, website updates waiting for Reden), totals by category, when the data last changed, and the tables run_sql can read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => read(async (tx) => {
      const hostels = await tx`select hostel, country, currency, is_active, gm_logins, experiences, live_experiences,
        on_website, transport_routes, website_updates_waiting from connector.hostels order by country, hostel`;
      const byCategory = await tx`select category_label as category, count(*)::int as total,
        count(*) filter (where live)::int as live, count(*) filter (where on_website)::int as on_website
        from connector.experiences group by 1 order by 1`;
      const [last] = await tx`select max(changed_at) as last_change from connector.changes`;
      const tables = await tx`select c.relname as table, obj_description(c.oid) as about,
        (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
        from pg_class c where c.relnamespace = 'connector'::regnamespace and c.relkind = 'v' order by 1`;
      return pack({ hostels, totals_by_category: byCategory, last_change: last?.last_change, tables_for_run_sql: tables }, "hostels");
    }),
  },
  {
    name: "search_experiences",
    title: "Search experiences",
    description: "Find experiences (tours, nightly events, one-time events, 3rd party tours; transport only when asked) by any mix of filters. Returns a short row per experience; use get_experience for the full details of one.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for in the title or descriptions, e.g. 'pub crawl'" },
        hostel: { type: "string", description: "Hostel name or part of it, e.g. 'Koh Rong'" },
        country: { type: "string", description: "e.g. Cambodia, Vietnam, Thailand, Laos, Indonesia, Philippines" },
        category: { type: "string", enum: CATEGORIES },
        status: { type: "string", enum: STATUSES },
        live: { type: "boolean", description: "true = active on the ground and not paused" },
        on_website: { type: "boolean", description: "true = listed on madmonkeyhostels.com" },
        day: { type: "string", description: "Runs on this weekday, e.g. 'Friday'" },
        limit: { type: "integer", description: "Max rows, default 100, max 500" },
      },
      additionalProperties: false,
    },
    run: (a) => read(async (tx) => {
      const q = str(a.query), hostel = str(a.hostel), country = str(a.country);
      const category = oneOf(a.category, CATEGORIES, "category"), status = oneOf(a.status, STATUSES, "status");
      const live = bool(a.live), onWebsite = bool(a.on_website), day = weekday(a.day);
      const limit = int(a.limit, 100, MAX_ROWS);
      const like = q ? `%${q}%` : null;
      const rows = await tx.unsafe(`select ${LIST_COLUMNS} from connector.experiences
        where ($1::text is null or title ilike $1 or brief_description ilike $1 or long_description ilike $1)
          and ($2::text is null or hostel ilike '%' || $2 || '%')
          and ($3::text is null or country ilike '%' || $3 || '%')
          and ($4::text is null or category = $4)
          and ($5::text is null or status = $5)
          and ($6::boolean is null or live = $6)
          and ($7::boolean is null or on_website = $7)
          and ($8::int is null or $8::smallint = any(days_of_week))
          and (category <> 'transport' or $4::text = 'transport')
        order by country, hostel, category, title limit ${limit + 1}`,
        [like, hostel, country, category, status, live, onWebsite, day] as never[]);
      const more = rows.length > limit;
      return pack({ count: more ? `more than ${limit}` : rows.length, rows: rows.slice(0, limit) });
    }),
  },
  {
    name: "get_experience",
    title: "Get one experience",
    description: "Everything about one experience: prices and price options, days, times, descriptions, inclusions, meeting point, cancellation policy, itinerary, operator, transport details, photos and assets, its last 20 changes and any website updates still waiting for Reden. Look it up by id, or by title (plus hostel when the title exists at several hostels).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Experience id from another tool" },
        title: { type: "string", description: "Title or part of it" },
        hostel: { type: "string", description: "Hostel name, to narrow a title search" },
      },
      additionalProperties: false,
    },
    run: (a) => read(async (tx) => {
      const id = str(a.id), title = str(a.title), hostel = str(a.hostel);
      if (id && !UUID.test(id)) throw new ToolError("That id is not a valid experience id.");
      if (!id && !title) throw new ToolError("Give an id or a title.");
      const found = id
        ? await tx`select * from connector.experiences where id = ${id}`
        : await tx`select * from connector.experiences where title ilike ${"%" + title + "%"}
            and (${hostel}::text is null or hostel ilike ${"%" + (hostel ?? "") + "%"})
            order by (lower(title) = lower(${title})) desc, hostel, title limit 25`;
      if (!found.length) throw new ToolError("No experience matches. Try search_experiences.");
      const exact = found.filter((r) => String(r.title).toLowerCase() === (title ?? "").toLowerCase());
      const pick = found.length === 1 ? found[0] : exact.length === 1 ? exact[0] : null;
      if (!pick) {
        return pack({ note: "Several experiences match. Ask again with the id or the hostel.",
          rows: found.map((r) => ({ id: r.id, hostel: r.hostel, title: r.title, category: r.category_label, status: r.status })) });
      }
      const changes = await tx`select changed_at, changed_by, action, changed_fields, old_values, new_values
        from connector.changes where experience_id = ${pick.id} order by changed_at desc limit 20`;
      const waiting = await tx`select changed_at, field, old_value, new_value, changed_by
        from connector.website_updates where experience_id = ${pick.id} and waiting order by changed_at`;
      return pack({ experience: pick, recent_changes: changes, website_updates_waiting_for_reden: waiting });
    }),
  },
  {
    name: "whats_on",
    title: "What's on",
    description: "The programme at one hostel for a day or a run of days (what guests can do, in time order), worked out the same way as the dashboard's My week: live experiences on that weekday plus dated one-offs, transport left out. Defaults to today in the hostel's time zone.",
    inputSchema: {
      type: "object",
      properties: {
        hostel: { type: "string", description: "Hostel name, e.g. 'Siargao'" },
        date: { type: "string", description: "First day, YYYY-MM-DD. Default: today at the hostel" },
        days: { type: "integer", description: "How many days from that date, default 1, max 14" },
      },
      required: ["hostel"],
      additionalProperties: false,
    },
    run: (a) => read(async (tx) => {
      const h = await findHostel(tx, a.hostel);
      const date = str(a.date);
      if (date && !ISO_DATE.test(date)) throw new ToolError("Give the date as YYYY-MM-DD.");
      const days = int(a.days, 1, 14);
      const [{ start }] = await tx`select coalesce(${date}::date, (now() at time zone ${h.timezone})::date)::text as start`;
      const rows = await tx`select to_char(d, 'YYYY-MM-DD') as date, to_char(d, 'Dy') as day, e.title, e.category_label as category,
          e.starts_at, e.ends_at, e.price_usd, e.price_local, e.local_currency, e.on_website, e.status,
          (extract(isodow from d)::smallint = any(coalesce(e.key_weekdays, '{}'))) as key_event, e.id
        from generate_series(${start}::date, ${start}::date + (${days}::int - 1), interval '1 day') d
        join connector.experiences e on e.hostel_id = ${h.hostel_id}
        where e.live and e.category <> 'transport'
          and (e.expires_on is null or e.expires_on >= d::date)
          and ((e.category <> 'one_time_event' and extract(isodow from d)::smallint = any(e.days_of_week))
               or d::date = any(coalesce(e.dated_runs, '{}')))
        order by d, e.starts_at nulls last, e.title`;
      return pack({ hostel: h.hostel, country: h.country, from: start, days, rows });
    }),
  },
  {
    name: "recent_changes",
    title: "Recent changes",
    description: "Who changed what and when: the change history of experiences and transport, newest first, with old and new values. Filter by date, hostel, experience title or person.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "YYYY-MM-DD, default 7 days ago" },
        until: { type: "string", description: "YYYY-MM-DD, inclusive" },
        hostel: { type: "string" },
        experience: { type: "string", description: "Title or part of it" },
        changed_by: { type: "string", description: "Name or email or part of it" },
        limit: { type: "integer", description: "Max rows, default 100, max 500" },
      },
      additionalProperties: false,
    },
    run: (a) => read(async (tx) => {
      const since = str(a.since), until = str(a.until);
      for (const d of [since, until]) if (d && !ISO_DATE.test(d)) throw new ToolError("Give dates as YYYY-MM-DD.");
      const hostel = str(a.hostel), exp = str(a.experience), who = str(a.changed_by);
      const limit = int(a.limit, 100, MAX_ROWS);
      const rows = await tx`select changed_at, hostel, experience, experience_id, action, changed_by, changed_fields, old_values, new_values
        from connector.changes
        where changed_at >= coalesce(${since}::date, (now() - interval '7 days')::date)
          and (${until}::date is null or changed_at < ${until}::date + 1)
          and (${hostel}::text is null or hostel ilike '%' || ${hostel} || '%')
          and (${exp}::text is null or experience ilike '%' || ${exp} || '%')
          and (${who}::text is null or changed_by ilike '%' || ${who} || '%')
        order by changed_at desc limit ${limit}`;
      return pack({ count: rows.length, rows });
    }),
  },
  {
    name: "run_sql",
    title: "Run a SQL query",
    description: "", // filled in from the live schema when tools are listed
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "One PostgreSQL SELECT (or WITH ... SELECT) over the connector views. No semicolons." },
        max_rows: { type: "integer", description: "Default 200, max 500" },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    run: (a) => read(async (tx) => {
      let q = str(a.sql) ?? "";
      q = q.replace(/;\s*$/, "").trim();
      if (!q) throw new ToolError("Write a SELECT query.");
      if (q.includes(";")) throw new ToolError("One statement only, no semicolons.");
      if (!/^(select|with|table|values)\b/i.test(q.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, ""))) {
        throw new ToolError("Only SELECT queries can run here. The data is read only.");
      }
      const max = int(a.max_rows, 200, MAX_ROWS);
      const rows = await tx.unsafe(`select * from (\n${q}\n) as result limit ${max + 1}`);
      const more = rows.length > max;
      const columns = rows.columns?.map((c: { name: string }) => c.name) ?? [];
      return pack({ columns, row_count: more ? `more than ${max} (raise max_rows or aggregate)` : rows.length, rows: rows.slice(0, max) });
    }),
  },
];

const STATIC_SQL_HELP = `Read-only PostgreSQL over the Experience Database views (schema connector, already on the search path): experiences, hostels, changes, website_updates, global_events, global_event_responses, room_rates, breakfast_rates, seasons, fx_rates, quotes, quote_lines, allin_bookings, allin_trip_days, deleted_experiences, people. Call overview first to see every column. Use it for counts, comparisons and lists the other tools can't do. Arrays: use = any(days_of_week). Weekdays 1 = Mon ... 7 = Sun.`;

let sqlHelp: string | null = null;
async function runSqlDescription() {
  if (sqlHelp) return sqlHelp;
  try {
    const tables = await read((tx) => tx`select c.relname as t, obj_description(c.oid) as about,
      (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols
      from pg_class c where c.relnamespace = 'connector'::regnamespace and c.relkind = 'v' order by 1`);
    sqlHelp = `Read-only PostgreSQL over the Experience Database views (schema connector, already on the search path). Use it for counts, comparisons, lists and anything the other tools can't do. One SELECT, no semicolons, max 500 rows back (aggregate for big questions). Arrays: use = any(days_of_week). Weekdays 1 = Mon ... 7 = Sun. Text matching: ilike.\n\nViews:\n` +
      tables.map((r) => `- ${r.t}(${r.cols})${r.about ? `: ${r.about}` : ""}`).join("\n");
  } catch (e) {
    console.error("schema for run_sql description failed", e);
    return STATIC_SQL_HELP;
  }
  return sqlHelp;
}

async function listTools() {
  const sql = await runSqlDescription();
  return tools.map((t) => ({
    name: t.name, title: t.title,
    description: t.name === "run_sql" ? sql : t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

// ---- MCP over HTTP ---------------------------------------------------------------------------------------------

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Who = { token_id: string; user_id: string; label: string; name: string };

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: RpcRequest, who: Who) {
  const id = msg.id;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return rpcResult(id, {});
    case "tools/list": return rpcResult(id, { tools: await listTools() });
    case "resources/list": return rpcResult(id, { resources: [] });
    case "resources/templates/list": return rpcResult(id, { resourceTemplates: [] });
    case "prompts/list": return rpcResult(id, { prompts: [] });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const t0 = Date.now();
      try {
        const text = await tool.run(args);
        console.log(JSON.stringify({ who: who.label, tool: name, ms: Date.now() - t0, chars: text.length }));
        return rpcResult(id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        const known = e instanceof ToolError;
        const pg = e as { message?: string; hint?: string };
        const message = known ? String(pg.message)
          : pg.message ? `Database said: ${pg.message}${pg.hint ? ` (hint: ${pg.hint})` : ""}. Only the connector views can be read; call overview for their columns.`
          : "Something went wrong running that.";
        console.error(JSON.stringify({ who: who.label, tool: name, ms: Date.now() - t0, error: pg.message ?? String(e) }));
        return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tokenFrom(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const at = parts.indexOf("claude-connector");
  const fromPath = at >= 0 ? parts[at + 1] : undefined;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const t = fromPath ?? (bearer && !bearer.startsWith("eyJ") ? bearer : undefined);
  return t && /^[A-Za-z0-9_-]{32,128}$/.test(t) ? t : null;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

Deno.serve(async (req) => {
  const token = tokenFrom(req);
  if (!token) return json({ error: "This connector link is not valid." }, 404);
  const { data: who, error } = await admin.rpc("connector_use_token", { p_hash: await sha256(token) });
  if (error) { console.error("token check failed", error); return json({ error: "Try again in a moment." }, 503); }
  if (!who) return json({ error: "This connector link is not valid or has been switched off." }, 404);

  // stateless server: no SSE stream to open, no session to end
  if (req.method !== "POST") return json({ error: "Use POST (MCP Streamable HTTP)." }, 405, { Allow: "POST" });

  const raw = await req.text();
  if (raw.length > 1_000_000) return json(rpcError(null, -32600, "Request too large"), 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }

  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcRequest[];
  if (!msgs.length) return json(rpcError(null, -32600, "Empty batch"), 400);
  const replies = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || typeof m.method !== "string") {
      // a response or junk from the client: nothing to answer unless it carries an id
      if (m && typeof m === "object" && "id" in m && !("result" in m) && !("error" in m)) replies.push(rpcError(m.id, -32600, "Invalid request"));
      continue;
    }
    if (m.id === undefined || m.id === null) continue;   // notification (initialized, cancelled, ...)
    replies.push(await handle(m, who as Who));
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return json(batch ? replies : replies[0]);
});

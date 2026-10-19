import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Pulls ALL IN bookings into allin_bookings (Charlie, 19 Oct 2026). pg_cron calls it every 5 minutes (020_allin.sql).
//
// Every request to the ALL IN feed is signed (ECDSA P-256 over "<timestamp>.<body>") with a key pair made here on the
// first run. The private half never leaves this database (sync_config 'allin_sync_keypair'); the ALL IN site checks
// the signature with the public half, copied to its app_config 'experience_db_public_jwk'. No shared password.
//
// Each run asks for the bookings changed since the last one (10 minutes' overlap). The run at the top of each hour
// pulls everything instead, which also catches departure-level changes that don't touch a booking row and drops
// bookings that no longer exist on the ALL IN side. {"full": true} forces a full pull. Runs without a JWT, so it
// returns counts only, never guest data, and skips a run that comes within a minute of the last one.

const FEED = "https://bilhhkzcmicygufsdfxi.supabase.co/functions/v1/loyalty-allin-bookings";
const KEY_ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" } as const;
const EPOCH = "1970-01-01T00:00:00Z";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function config(sb: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await sb.from("sync_config").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}
async function setConfig(sb: SupabaseClient, key: string, value: string) {
  await sb.from("sync_config").upsert({ key, value });
}

/** The signing key, made on the first run. One row for both halves, inserted only if missing, so two first runs
 *  racing can't end up with a private key that doesn't match the public one. */
async function signingKey(sb: SupabaseClient): Promise<CryptoKey> {
  let stored = await config(sb, "allin_sync_keypair");
  if (!stored) {
    const pair = await crypto.subtle.generateKey(KEY_ALG, true, ["sign", "verify"]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
    await sb.from("sync_config").upsert(
      { key: "allin_sync_keypair", value: JSON.stringify({ private: priv, public: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } }) },
      { onConflict: "key", ignoreDuplicates: true },
    );
    stored = await config(sb, "allin_sync_keypair");
  }
  return crypto.subtle.importKey("jwk", JSON.parse(stored!).private, KEY_ALG, false, ["sign"]);
}

type FeedBooking = {
  booking_ref: string;
  booking_id?: string;
  status: string;
  payment_state?: string;
  updated_at?: string;
  trip?: { slug?: string | null; name?: string | null };
  departure?: { date?: string | null; end_date?: string | null };
  spots?: number;
  lead?: { name?: string | null; email?: string | null };
  whatsapp?: { opt_in?: boolean };
  travellers?: Array<{ email?: string | null }>;
  role?: string;
};

function toRow(b: FeedBooking, syncedAt: string) {
  const emails = [...new Set([b.lead?.email, ...(b.travellers ?? []).map((t) => t.email)].map(lower).filter((e) => e.includes("@")))];
  const { role: _role, ...payload } = b;
  return {
    booking_ref: b.booking_ref,
    booking_id: b.booking_id ?? null,
    status: b.status,
    payment_state: b.payment_state ?? null,
    trip_slug: b.trip?.slug ?? null,
    trip_name: b.trip?.name ?? null,
    departure_date: b.departure?.date ?? null,
    end_date: b.departure?.end_date ?? null,
    spots: b.spots ?? null,
    lead_name: b.lead?.name ?? null,
    lead_email: lower(b.lead?.email) || null,
    whatsapp_opt_in: b.whatsapp?.opt_in === true,
    emails,
    payload,
    source_updated_at: b.updated_at ?? null,
    synced_at: syncedAt,
  };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }

  const now = new Date();
  const last = await config(sb, "allin_sync_last_run");
  if (body.full !== true && last && now.getTime() - Date.parse(last) < 60_000) {
    return json({ ok: true, skipped: "ran under a minute ago" });
  }
  await setConfig(sb, "allin_sync_last_run", now.toISOString());

  const full = body.full === true || now.getUTCMinutes() < 5;
  const until = (await config(sb, "allin_synced_until")) ?? EPOCH;
  const since = full ? EPOCH : new Date(Date.parse(until) - 10 * 60_000).toISOString();

  try {
    const payload = JSON.stringify({ since });
    const ts = String(Math.floor(now.getTime() / 1000));
    const signature = b64url(await crypto.subtle.sign(SIGN_ALG, await signingKey(sb), new TextEncoder().encode(`${ts}.${payload}`)));
    const res = await fetch(FEED, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mmx-timestamp": ts, "x-mmx-signature": signature },
      body: payload,
    });
    const out = await res.json().catch(() => ({})) as { bookings?: FeedBooking[]; error?: string };
    if (!res.ok) throw new Error(`ALL IN feed ${res.status}: ${out.error ?? "no reply"}`);

    const syncedAt = now.toISOString();
    const rows = (out.bookings ?? []).filter((b) => b?.booking_ref).map((b) => toRow(b, syncedAt));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("allin_bookings").upsert(rows.slice(i, i + 200), { onConflict: "booking_ref" });
      if (error) throw new Error(`save: ${error.message}`);
    }
    // A full pull is the whole list: anything else here was removed on the ALL IN side.
    let removed = 0;
    if (full && rows.length > 0) {
      const { data: gone, error } = await sb.from("allin_bookings").delete().lt("synced_at", syncedAt).select("booking_ref");
      if (error) throw new Error(`prune: ${error.message}`);
      removed = gone?.length ?? 0;
    }

    await setConfig(sb, "allin_synced_until", syncedAt);
    await sb.from("sync_config").delete().eq("key", "allin_sync_last_error");
    return json({ ok: true, full, since, received: rows.length, removed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setConfig(sb, "allin_sync_last_error", `${now.toISOString()} ${msg}`.slice(0, 500));
    return json({ ok: false, error: msg }, 502);
  }
});

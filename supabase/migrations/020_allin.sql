-- ALL IN guest trips in the Experience Database (Charlie, 19 Oct 2026).
-- Guests need a day-by-day of where to be (boats, transfers) in their Loyalty account (Dhany) and on the main
-- website and WhatsApp (Ayush). The ALL IN site stays the source of truth for bookings: the allin-sync Edge
-- Function pulls them every 5 minutes into allin_bookings, next to each trip's day-by-day in allin_trip_days.
-- Dhany and Ayush read both through one endpoint, allin-guest-trips, each with their own key from
-- Settings > ALL IN guest trips. Guest data is server-only: no app user reads allin_bookings.

-- One row per ALL IN checkout, as the ALL IN feed (loyalty-allin-bookings) returns it.
create table if not exists public.allin_bookings (
  booking_ref text primary key,
  booking_id uuid,
  status text not null,
  payment_state text,
  trip_slug text,
  trip_name text,
  departure_date date,
  end_date date,
  spots integer,
  lead_name text,
  lead_email text,
  whatsapp_opt_in boolean not null default false,
  emails text[] not null default '{}',   -- lead booker + named travellers, lowercased, for lookups
  payload jsonb not null,                -- the whole feed entry
  source_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists allin_bookings_emails_idx on public.allin_bookings using gin (emails);
create index if not exists allin_bookings_dates_idx on public.allin_bookings (departure_date, end_date);
alter table public.allin_bookings enable row level security;
-- No policies: only the service role (Edge Functions) reads or writes guest data.

-- Each ALL IN trip's day-by-day, from the trip pages (mm-squad-trips tools/export-itineraries.ts). An entry covers
-- day_from..day_to (Indonesia has "Days 10–12"). Day 1 is the departure date; guests arrive the night before.
create table if not exists public.allin_trip_days (
  trip_slug text not null,
  day_from integer not null,
  day_to integer not null,
  label text not null,
  place text not null,
  body text not null,
  transport text,
  activities text,
  meals text,
  updated_at timestamptz not null default now(),
  primary key (trip_slug, day_from),
  check (day_to >= day_from)
);
alter table public.allin_trip_days enable row level security;
create policy allin_trip_days_read on public.allin_trip_days for select to authenticated using (true);

-- Apps allowed to read ALL IN guest trips. Only a SHA-256 hash of each key is kept; the key is shown once, to the
-- admin who makes it, and can't be read back. Revoking stops it straight away.
create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_clients enable row level security;
create policy api_clients_admin_read on public.api_clients for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.create_api_client(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, '')); v_key text; v_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only admins can make API keys.'; end if;
  if length(v_name) < 2 then raise exception 'Give the key a name, e.g. Dhany, Loyalty app.'; end if;
  v_key := 'mmx_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_clients (name, key_prefix, key_hash, created_by)
  values (v_name, left(v_key, 12), encode(extensions.digest(v_key, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'key', v_key);
end $$;
revoke all on function public.create_api_client(text) from public, anon;
grant execute on function public.create_api_client(text) to authenticated;

create or replace function public.revoke_api_client(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only admins can revoke API keys.'; end if;
  update public.api_clients set revoked_at = now() where id = p_id and revoked_at is null;
end $$;
revoke all on function public.revoke_api_client(uuid) from public, anon;
grant execute on function public.revoke_api_client(uuid) to authenticated;

-- What Settings > ALL IN guest trips shows about the sync: when it last ran and how many bookings are here.
create or replace function public.allin_sync_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'synced_until', (select value from public.sync_config where key = 'allin_synced_until'),
    'last_error', (select value from public.sync_config where key = 'allin_sync_last_error'),
    'bookings', (select count(*) from public.allin_bookings),
    'upcoming', (select count(*) from public.allin_bookings where status = 'confirmed' and end_date >= current_date))
  where public.has_role(auth.uid(), 'admin')
$$;
revoke all on function public.allin_sync_status() from public, anon;
grant execute on function public.allin_sync_status() to authenticated;

-- The ALL IN feed checks a signature instead of a shared password: allin-sync signs every request with a private
-- key that never leaves this database (sync_config 'allin_sync_keypair', made on its first run) and the ALL IN
-- site holds the matching public key (app_config 'experience_db_public_jwk').
insert into public.sync_config (key, value) values ('allin_synced_until', '1970-01-01T00:00:00Z')
on conflict (key) do nothing;

-- Every 5 minutes. allin-sync runs without a JWT (it returns counts only, never guest data, and skips a run that
-- comes within a minute of the last one), so the job needs no key.
select cron.schedule('allin-sync', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/allin-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb);
$cron$);

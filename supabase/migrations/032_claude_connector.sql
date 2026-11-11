-- 11 Nov 2026 (Kyle Kenny via Charlie): a Claude connector, so Kyle can ask his own Claude anything about the
-- Experience Database ("basically the raw database"). It is READ ONLY by design:
--  * schema "connector" holds plain views of the business data. No logins, keys, codes, Vault or guest emails.
--  * the Edge Function claude-connector logs in to Postgres as mcp_reader, a role that can read those views and
--    nothing else, always inside READ ONLY transactions with a statement timeout.
--  * mcp_reader's password is generated in here and kept in Vault. Only the Edge Function (service role) reads it.
--  * every person gets their own connector link. Only a SHA-256 of it is stored (connector_tokens), and it can be
--    revoked by setting revoked_at.

create schema if not exists connector;
revoke all on schema connector from public;
comment on schema connector is 'Read-only views for the Claude connector (Edge Function claude-connector).';

-- weekday numbers (1 = Mon ... 7 = Sun) to "Mon Wed Fri"
create or replace function connector.day_names(d smallint[]) returns text
language sql immutable set search_path = '' as $$
  select case
    when d is null or cardinality(d) = 0 then null
    when cardinality(d) = 7 then 'Every day'
    else (select string_agg((array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[x], ' ' order by x) from unnest(d) x)
  end
$$;

create or replace view connector.hostels as
select l.id as hostel_id, l.name as hostel, l.country, l.currency, l.timezone, l.is_active,
  (select string_agg(coalesce(p.full_name, p.email), ', ' order by p.full_name)
     from public.user_locations ul
     join public.profiles p on p.id = ul.user_id and p.is_active
    where ul.location_id = l.id
      and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'gm')
      and (select count(*) from public.user_locations u2 where u2.user_id = p.id) <= 3) as gm_logins,
  (select count(*) from public.products p where p.location_id = l.id and p.category <> 'transport')::int as experiences,
  (select count(*) from public.products p where p.location_id = l.id and p.category <> 'transport'
      and p.active_on_ground and p.status <> 'paused')::int as live_experiences,
  (select count(*) from public.products p where p.location_id = l.id and p.bookable_on_website)::int as on_website,
  (select count(*) from public.products p where p.location_id = l.id and p.category = 'transport')::int as transport_routes,
  (select count(*) from public.notification_events n where n.location_id = l.id and n.website_done_at is null)::int as website_updates_waiting
from public.locations l;
comment on view connector.hostels is 'One row per Mad Monkey hostel. gm_logins = GM accounts tied to that hostel (accounts covering more than 3 hostels, like head office, are left out).';

create or replace view connector.experiences as
select p.id, p.location_id as hostel_id, l.name as hostel, l.country,
  p.category::text as category,
  case p.category when 'mm_tour' then 'MM Tour' when 'nightly_event' then 'Nightly Event'
    when 'third_party_tour' then '3rd Party Tour' when 'one_time_event' then 'One-Time Event' else 'Transport' end as category_label,
  p.title, p.status::text as status, p.active_on_ground,
  (p.active_on_ground and p.status <> 'paused') as live,
  p.bookable_on_website as on_website, p.urgent,
  connector.day_names(p.days_of_week) as days, p.days_of_week,
  (select array_agg(r.starts_on order by r.starts_on) from public.product_date_rules r where r.product_id = p.id) as dated_runs,
  p.starts_at, p.ends_at, p.duration_minutes, p.expires_on,
  p.rate_usd as price_usd, p.local_amount as price_local, p.local_currency, p.rate_raw as price_note, p.price_options,
  p.gross_service_value,
  p.min_guests, p.max_guests_per_day, p.capacity_raw as capacity_note,
  o.name as operator, o.is_mad_monkey as operator_is_mad_monkey,
  p.brief_description, p.long_description, p.meeting_point, p.inclusions, p.exclusions, p.things_to_bring,
  p.cancellation_policy, p.itinerary, p.travel_insurance_required, p.remarks,
  p.rezdy_reference, p.photo_album_url,
  (select count(*) from public.product_photos ph where ph.product_id = p.id)::int as photo_count,
  (select array_agg(a.url order by a.created_at desc) from public.product_assets a where a.product_id = p.id) as asset_links,
  (select array_agg(k.weekday order by k.weekday) from public.product_key_days k where k.product_id = p.id) as key_weekdays,
  (select connector.day_names(array_agg(k.weekday order by k.weekday)) from public.product_key_days k where k.product_id = p.id) as key_event_days,
  td.vehicle_type, td.origin, td.destination, td.route_raw as route, td.pickup_point, td.dropoff_point, td.departure_times,
  (select count(*) from public.notification_events n where n.product_id = p.id and n.website_done_at is null)::int as website_updates_waiting,
  p.last_verified_at, coalesce(vp.full_name, vp.email) as last_verified_by,
  p.created_at, p.updated_at
from public.products p
join public.locations l on l.id = p.location_id
left join public.operators o on o.id = p.operator_id
left join public.transport_details td on td.product_id = p.id
left join public.profiles vp on vp.id = p.last_verified_by;
comment on view connector.experiences is 'Every tour, nightly event, one-time event, 3rd party tour and transport route. live = active on the ground and not paused. on_website = listed on madmonkeyhostels.com. days_of_week/key_weekdays: 1 = Mon ... 7 = Sun. dated_runs = specific dates for dated products. price_usd = headline USD price, price_local + local_currency = local price, price_options = named alternative prices.';

create or replace view connector.changes as
select a.id, a.changed_at, l.name as hostel, a.record_id as experience_id,
  coalesce(p.title, a.new_values->>'title', a.old_values->>'title', ap.title) as experience,
  a.table_name, a.action, coalesce(pr.full_name, pr.email, 'system') as changed_by,
  a.changed_fields, a.old_values, a.new_values
from public.audit_log a
left join public.locations l on l.id = a.location_id
left join public.products p on p.id = a.record_id
left join public.archived_products ap on ap.product_id = a.record_id
left join public.profiles pr on pr.id = a.changed_by;
comment on view connector.changes is 'Change history of experiences and transport details: who changed which fields, old and new values.';

create or replace view connector.website_updates as
select n.id, n.changed_at, l.name as hostel, n.product_id as experience_id, n.product_title as experience,
  n.field, n.old_value, n.new_value, coalesce(cb.full_name, cb.email) as changed_by,
  n.dispatched_at as emailed_to_reden_at, (n.website_done_at is null) as waiting,
  n.website_done_at as done_at, coalesce(db.full_name, db.email) as done_by, coalesce(p.urgent, false) as urgent
from public.notification_events n
left join public.locations l on l.id = n.location_id
left join public.profiles cb on cb.id = n.changed_by
left join public.profiles db on db.id = n.website_done_by
left join public.products p on p.id = n.product_id;
comment on view connector.website_updates is 'Changes Reden (website) is told about. waiting = not yet ticked off in Approvals > Website updates.';

create or replace view connector.global_events as
select g.id, g.title, g.category::text as category, g.event_date, g.expires_on, connector.day_names(g.days_of_week) as days,
  g.starts_at, g.ends_at, g.duration_minutes, g.rate_usd as price_usd, g.brief_description, g.long_description,
  g.inclusions, g.things_to_bring, g.bookable_on_website as on_website, g.notes, g.asset_urls,
  coalesce(c.full_name, c.email) as created_by, g.created_at
from public.global_events g
left join public.profiles c on c.id = g.created_by;
comment on view connector.global_events is 'Events head office sends to every hostel to accept or decline.';

create or replace view connector.global_event_responses as
select r.global_event_id, g.title as global_event, l.name as hostel, r.status, r.responded_at,
  coalesce(p.full_name, p.email) as responded_by, r.product_id as experience_id, r.overrides
from public.global_event_responses r
join public.global_events g on g.id = r.global_event_id
join public.locations l on l.id = r.location_id
left join public.profiles p on p.id = r.responded_by;

create or replace view connector.room_rates as
select l.name as hostel, l.country, rt.name as room, ar.season::text as season, ar.rate_usd,
  ar.valid_from, ar.valid_to, ar.source, ar.created_at as synced_at
from public.accommodation_rates ar
join public.locations l on l.id = ar.location_id
join public.room_types rt on rt.id = ar.room_type_id;
comment on view connector.room_rates is 'Bed rates per hostel, room type and season (lean, mid, high), synced nightly from the 2027 RATE OFFER TA sheet.';

create or replace view connector.breakfast_rates as
select l.name as hostel, b.rate_usd_pp, b.source, b.created_at as synced_at
from public.breakfast_rates b join public.locations l on l.id = b.location_id;

create or replace view connector.seasons as
select l.name as hostel, s.month, to_char(make_date(2000, s.month, 1), 'Mon') as month_name, s.tier::text as season
from public.season_calendar s join public.locations l on l.id = s.location_id;
comment on view connector.seasons is 'Which season (lean, mid, high) each month is at each hostel.';

create or replace view connector.fx_rates as
select code, coalesce(manual_override, units_per_usd) as units_per_usd, (manual_override is not null) as manual_override, as_of
from public.fx_rates;

create or replace view connector.quotes as
select q.id, q.reference, q.title, q.status::text as status, q.pax_count,
  c.company_name as customer, c.contact_name as customer_contact, c.country as customer_country,
  coalesce(o.full_name, o.email) as owner, q.created_at, q.updated_at,
  (select min(d.date) from public.quote_days d where d.quote_id = q.id) as start_date,
  (select max(d.date) from public.quote_days d where d.quote_id = q.id) as end_date,
  (select string_agg(distinct l.name, ', ') from public.quote_days d join public.locations l on l.id = d.location_id where d.quote_id = q.id) as hostels,
  lv.version_no as latest_version, lv.total_usd as latest_total_usd, lv.per_person_usd as latest_per_person_usd,
  lv.sent_at as latest_sent_at, av.version_no as accepted_version, av.total_usd as accepted_total_usd,
  br.reference as booking_reference, br.payment_deadline, br.paid_at
from public.quotes q
left join public.customers c on c.id = q.customer_id
left join public.profiles o on o.id = q.owner_id
left join lateral (select * from public.quote_versions v where v.quote_id = q.id order by v.version_no desc limit 1) lv on true
left join public.quote_versions av on av.id = q.accepted_version_id
left join lateral (select * from public.booking_requests b where b.quote_id = q.id order by b.created_at desc limit 1) br on true;
comment on view connector.quotes is 'Group quotes built by head office and sales (B2B), with the latest and accepted version totals.';

create or replace view connector.quote_lines as
select q.reference as quote, d.day_no, d.date, l.name as hostel, ql.sort_order, ql.kind, ql.title,
  ql.starts_at, ql.ends_at, ql.qty, ql.pax, ql.per_person, ql.unit_price_usd, ql.discount_pct, ql.discount_amount_usd,
  ql.is_comp, ql.line_total_usd, ql.source_product_id as experience_id
from public.quote_lines ql
join public.quotes q on q.id = ql.quote_id
left join public.quote_days d on d.id = ql.day_id
left join public.locations l on l.id = d.location_id;

create or replace view connector.allin_bookings as
select booking_ref, trip_name, trip_slug, departure_date, end_date, spots, status, payment_state,
  source_updated_at as updated_at
from public.allin_bookings;
comment on view connector.allin_bookings is 'ALL IN group trip bookings (synced from the ALL IN site every 5 minutes). Guest names and emails left out on purpose.';

create or replace view connector.allin_trip_days as
select trip_slug, day_from, day_to, label, place, body, transport, activities, meals
from public.allin_trip_days;

create or replace view connector.deleted_experiences as
select a.product_id as experience_id, a.title, l.name as hostel, a.category, a.reason,
  a.archived_at as deleted_at, a.archived_by as deleted_by
from public.archived_products a left join public.locations l on l.id = a.location_id;

create or replace view connector.people as
select p.id, p.full_name as name, p.email, p.is_active,
  (select string_agg(r.role::text, ', ' order by r.role) from public.user_roles r where r.user_id = p.id) as roles,
  (select count(*) from public.user_locations ul where ul.user_id = p.id)::int as hostel_count,
  (select string_agg(l.name, ', ' order by l.name) from public.user_locations ul join public.locations l on l.id = ul.location_id where ul.user_id = p.id) as hostels,
  u.last_sign_in_at, p.created_at
from public.profiles p left join auth.users u on u.id = p.id;
comment on view connector.people is 'Dashboard logins: roles (admin, head_office, gm, sales, viewer), hostels and last sign-in.';

-- the read-only login --------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_reader') then
    create role mcp_reader with login noinherit nocreatedb nocreaterole connection limit 10;
  end if;
end $$;
alter role mcp_reader set default_transaction_read_only = on;
alter role mcp_reader set statement_timeout = '20s';
alter role mcp_reader set idle_in_transaction_session_timeout = '30s';
alter role mcp_reader set search_path = connector, pg_catalog;

grant usage on schema connector to mcp_reader;
grant select on all tables in schema connector to mcp_reader;
grant execute on function connector.day_names(smallint[]) to mcp_reader;

do $$ declare v_pw text; begin
  if not exists (select 1 from vault.secrets where name = 'connector_db_password') then
    v_pw := encode(extensions.gen_random_bytes(24), 'hex');
    execute format('alter role mcp_reader password %L', v_pw);
    perform vault.create_secret(v_pw, 'connector_db_password', 'Postgres password of mcp_reader, the read-only login of the Claude connector');
  end if;
end $$;

create or replace function public.connector_db_password() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'connector_db_password' limit 1
$$;
revoke all on function public.connector_db_password() from public, anon, authenticated;
grant execute on function public.connector_db_password() to service_role;

-- personal connector links ---------------------------------------------------------------------------------------
create table if not exists public.connector_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  uses integer not null default 0,
  revoked_at timestamptz
);
alter table public.connector_tokens enable row level security;   -- no policies: service role only
revoke all on public.connector_tokens from anon, authenticated;

create or replace function public.connector_use_token(p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid; v_label text;
begin
  update public.connector_tokens t set last_used_at = now(), uses = t.uses + 1
   where t.token_hash = p_hash and t.revoked_at is null
     and exists (select 1 from public.profiles p where p.id = t.user_id and p.is_active)
  returning t.id, t.user_id, t.label into v_id, v_user, v_label;
  if v_id is null then return null; end if;
  return jsonb_build_object('token_id', v_id, 'user_id', v_user, 'label', v_label,
    'name', (select coalesce(full_name, email) from public.profiles where id = v_user));
end $$;
revoke all on function public.connector_use_token(text) from public, anon, authenticated;
grant execute on function public.connector_use_token(text) to service_role;

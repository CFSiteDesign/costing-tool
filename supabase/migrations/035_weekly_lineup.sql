-- 18 Nov 2026 (Charlie, spec from Claude Design: ~/Downloads/weekly lineup design/costing-tool-prompt.md):
-- WEEKLY LINEUP posters. One poster per hostel per week, MON to SUN, two formats (post 4:5 + 3x print, story 9:16).
--
-- What goes on it: the same live rule as My week and hostel_week() (live, not transport, on that weekday or a dated
-- run, minus blackouts), limited to nightly events, Mad Monkey tours and dated one-time events. 3rd party tours are
-- left off: most run every day and would flood every row (Vang Vieng Friday: 30 items, 10 of them ours).
-- Prices: the local price GMs entered (local_amount); USD hostels use rate_usd, which is their local price. A hostel
-- that only has USD prices for a non-USD currency shows no price tags rather than a converted guess.
-- Same title at the same time listed twice (Pai's two "Half Day Scenery Tour" rows) shows once, and a leading
-- weekday some GMs type into titles ("Friday - Music Quiz") is dropped, as the row already says FRI.
--
-- GMs check it on /lineup: a KEY star per day (one per day, stored per week), 5 colourways (saved as the hostel's
-- default), Approve. The `lineup` Edge Function renders the PNGs with resvg into the public `lineups` bucket and runs
-- the weekly job: draft + email to the hostel's GMs on the build slot (Thursday 10:00 hostel time by default), auto
-- approve on Sunday 18:00. The job only acts when sync_config lineup_enabled = 'true' (off until Charlie says go).

alter table public.locations add column if not exists lineup_colourway text not null default 'orange-yellow';
do $$ begin
  alter table public.locations add constraint locations_lineup_colourway_check
    check (lineup_colourway in ('orange-yellow','blue-lime','pink-cyan','purple-yellow','retro'));
exception when duplicate_object then null; end $$;

create table if not exists public.lineup_weeks (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft','approved')),
  colourway text check (colourway in ('orange-yellow','blue-lime','pink-cyan','purple-yellow','retro')),
  key_picks jsonb not null default '{}'::jsonb,          -- {"2026-11-23": "<product id>"}: at most one per day
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  auto_approved boolean not null default false,
  files jsonb,            -- {post, post_print, story, colourway, rendered_at}: public URLs of the final PNGs
  data jsonb,             -- the LineupWeek the final files were made from
  flags jsonb,            -- {fit, tier, overfull}: tier 2 or overfull = a human should look at it
  notified_at timestamptz,
  notify_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, week_start)
);
alter table public.lineup_weeks enable row level security;
drop policy if exists "lineup weeks: read own hostels" on public.lineup_weeks;
create policy "lineup weeks: read own hostels" on public.lineup_weeks for select to authenticated
  using (public.can_access_location(auth.uid(), location_id));
-- no insert/update policies: changes go through the RPCs below and the Edge Function (service role)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lineups', 'lineups', true, 20971520, array['image/png'])
on conflict (id) do nothing;

insert into public.sync_config (key, value) values
  ('lineup_enabled', 'false'), ('lineup_build_dow', '4'), ('lineup_build_hour', '10'),
  ('lineup_auto_dow', '7'), ('lineup_auto_hour', '18')
on conflict (key) do nothing;

-- access helper: service role, or someone who can see that hostel
create or replace function public.lineup_assert_access(p_location uuid, p_edit boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  if not public.can_access_location(auth.uid(), p_location) then raise exception 'You don''t have access to that hostel.'; end if;
  if p_edit and not public.is_editor(auth.uid()) then raise exception 'Your login can view the lineup but not change it.'; end if;
end $$;
revoke all on function public.lineup_assert_access(uuid, boolean) from public, anon;

/** One hostel's week as a LineupWeek (plus ids, ISO dates and the review state). Creates the draft row if needed. */
create or replace function public.lineup_week(p_location uuid, p_week_start date) returns jsonb
language plpgsql security definer set search_path = public, connector as $$
declare v_h record; v_row public.lineup_weeks; v_week jsonb; v_end date := p_week_start + 6;
begin
  perform public.lineup_assert_access(p_location, false);
  if extract(isodow from p_week_start) <> 1 then raise exception 'A lineup week starts on a Monday.'; end if;
  select l.id, l.name, l.currency, l.timezone, l.lineup_colourway into v_h from public.locations l where l.id = p_location;
  if v_h.id is null then raise exception 'Unknown hostel.'; end if;

  insert into public.lineup_weeks (location_id, week_start) values (p_location, p_week_start) on conflict do nothing;
  select * into v_row from public.lineup_weeks where location_id = p_location and week_start = p_week_start;

  with runs as (
    select e.id, e.title, e.starts_at, e.status, e.price_local, e.price_usd, d::date as day
    from connector.experiences e
    cross join generate_series(p_week_start, v_end, interval '1 day') d
    where e.hostel_id = p_location and e.live
      and e.category in ('nightly_event', 'mm_tour', 'one_time_event')
      and (e.expires_on is null or e.expires_on >= d::date)
      and ((e.category <> 'one_time_event' and extract(isodow from d)::smallint = any(e.days_of_week))
           or d::date = any(coalesce(e.dated_runs, '{}')))
      and not (d::date = any(coalesce(e.blackout_dates, '{}')))
  ),
  -- one entry per (name, start time): duplicates collapse, signature wins
  items as (
    select upper(r.name) as k, r.starts_at,
      (array_agg(r.id order by (r.status = 'signature') desc, r.id))[1] as id,
      (array_agg(r.name order by (r.status = 'signature') desc, r.id))[1] as name,
      bool_or(r.status = 'signature') as signature,
      (array_agg(coalesce(r.price_local, case when v_h.currency = 'USD' then r.price_usd end) order by (r.status = 'signature') desc, r.id))[1] as price,
      array_agg(distinct r.day) as days
    from (select r0.*, regexp_replace(regexp_replace(btrim(r0.title), '\s+', ' ', 'g'),
                 '^(mon|tues|wednes|thurs|fri|satur|sun)day\s*[-:–]\s*', '', 'i') as name from runs r0) r
    group by 1, 2
  ),
  fmt as (
    select i.*, cardinality(i.days) = 7 as every_day,
      case when i.starts_at is null then null
           else regexp_replace(to_char(date '2000-01-01' + i.starts_at, 'FMHH12:MIAM'), ':00(?=[AP]M)', '') end as time
    from items i
  )
  select jsonb_build_object(
    'hostel', v_h.name,
    'dates', case when to_char(p_week_start, 'MM') = to_char(v_end, 'MM')
                  then to_char(p_week_start, 'FMDD') || '-' || to_char(v_end, 'FMDD Mon')
                  else to_char(p_week_start, 'FMDD Mon') || '-' || to_char(v_end, 'FMDD Mon') end,
    'currency', case v_h.currency when 'PHP' then '₱' when 'VND' then '₫' when 'USD' then '$' when 'IDR' then 'Rp'
                  when 'LAK' then '₭' when 'THB' then '฿' else coalesce(v_h.currency, '') end,
    'everyDay', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'time', f.time, 'price', f.price,
                  'signature', f.signature) order by f.starts_at nulls last, f.name) from fmt f where f.every_day), '[]'::jsonb),
    'days', (select jsonb_agg(jsonb_build_object(
                'day', upper(to_char(d, 'Dy')), 'date', to_char(d, 'FMDD'), 'iso', to_char(d, 'YYYY-MM-DD'),
                'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'time', f.time, 'price', f.price,
                           'signature', f.signature) order by f.starts_at nulls last, f.name)
                         from fmt f where not f.every_day and d::date = any(f.days)), '[]'::jsonb)) order by d)
             from generate_series(p_week_start, v_end, interval '1 day') d)
  ) into v_week;

  return jsonb_build_object(
    'week', v_week,
    'hostel', jsonb_build_object('id', v_h.id, 'name', v_h.name, 'timezone', v_h.timezone, 'colourway', v_h.lineup_colourway),
    'row', jsonb_build_object('id', v_row.id, 'week_start', v_row.week_start, 'status', v_row.status,
      'colourway', coalesce(v_row.colourway, v_h.lineup_colourway), 'key_picks', v_row.key_picks,
      'approved_at', v_row.approved_at, 'auto_approved', v_row.auto_approved,
      'approved_by', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = v_row.approved_by),
      'files', v_row.files, 'flags', v_row.flags, 'notified_at', v_row.notified_at),
    'can_edit', coalesce(auth.role(), '') = 'service_role' or public.is_editor(auth.uid())
  );
end $$;
revoke all on function public.lineup_week(uuid, date) from public, anon;
grant execute on function public.lineup_week(uuid, date) to authenticated, service_role;

/** Star an item as that day's KEY pick (p_product null clears it). One per day. */
create or replace function public.lineup_set_key(p_location uuid, p_week_start date, p_date date, p_product uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.lineup_assert_access(p_location, true);
  if p_date < p_week_start or p_date > p_week_start + 6 then raise exception 'That day is not in this week.'; end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and location_id = p_location) then
    raise exception 'That experience is not at this hostel.';
  end if;
  insert into public.lineup_weeks (location_id, week_start) values (p_location, p_week_start) on conflict do nothing;
  update public.lineup_weeks
     set key_picks = case when p_product is null then key_picks - to_char(p_date, 'YYYY-MM-DD')
                          else key_picks || jsonb_build_object(to_char(p_date, 'YYYY-MM-DD'), p_product) end,
         updated_at = now()
   where location_id = p_location and week_start = p_week_start
  returning key_picks into v;
  return v;
end $$;
revoke all on function public.lineup_set_key(uuid, date, date, uuid) from public, anon;
grant execute on function public.lineup_set_key(uuid, date, date, uuid) to authenticated;

/** Pick one of the 5 colourways for this week; it also becomes the hostel's default for the following weeks. */
create or replace function public.lineup_set_colourway(p_location uuid, p_week_start date, p_colourway text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lineup_assert_access(p_location, true);
  if p_colourway not in ('orange-yellow','blue-lime','pink-cyan','purple-yellow','retro') then raise exception 'Unknown colourway.'; end if;
  update public.locations set lineup_colourway = p_colourway where id = p_location;
  insert into public.lineup_weeks (location_id, week_start, colourway) values (p_location, p_week_start, p_colourway)
  on conflict (location_id, week_start) do update set colourway = excluded.colourway, updated_at = now();
end $$;
revoke all on function public.lineup_set_colourway(uuid, date, text) from public, anon;
grant execute on function public.lineup_set_colourway(uuid, date, text) to authenticated;

/** The GM logins to email for a hostel: GM role, active, tied to it and covering at most 3 hostels (so head office
 *  accounts that see every hostel aren't emailed 23 times). Service role only. */
create or replace function public.lineup_gm_emails(p_location uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p.email), '{}')
  from public.user_locations ul
  join public.profiles p on p.id = ul.user_id and p.is_active and p.email is not null and p.email not like '%.test'
  where ul.location_id = p_location
    and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'gm')
    and (select count(*) from public.user_locations u2 where u2.user_id = p.id) <= 3
$$;
revoke all on function public.lineup_gm_emails(uuid) from public, anon, authenticated;
grant execute on function public.lineup_gm_emails(uuid) to service_role;

-- Kyle's Claude connector can see the posters too
create or replace view connector.lineups as
select l.name as hostel, w.week_start, w.status, coalesce(w.colourway, l.lineup_colourway) as colourway,
  w.approved_at, w.auto_approved, coalesce(p.full_name, p.email) as approved_by, w.files, w.flags
from public.lineup_weeks w join public.locations l on l.id = w.location_id
left join public.profiles p on p.id = w.approved_by;
comment on view connector.lineups is 'Weekly lineup posters per hostel and week: draft or approved, colourway, links to the final PNGs.';
grant select on connector.lineups to mcp_reader;

-- The hourly job. The function is verify_jwt off and guards itself: the cron step only acts on its own time slots,
-- and the per-hostel steps it fans out to need this secret (read with the service role, never sent to a browser).
insert into public.sync_config (key, value)
select 'lineup_cron_secret', encode(extensions.gen_random_bytes(24), 'hex')
where not exists (select 1 from public.sync_config where key = 'lineup_cron_secret');

do $$ begin perform cron.unschedule('lineup-hourly'); exception when others then null; end $$;
select cron.schedule('lineup-hourly', '5 * * * *', $cron$
  select net.http_post(
    url := 'https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/lineup',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'cron'))
$cron$);

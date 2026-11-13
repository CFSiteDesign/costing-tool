-- 13 Nov 2026: weekly event posters in STUDIO (Charlie).
--
-- 1. Blackout fix. product_date_rules has two kinds: 'available' (a dated run on starts_on; a multi-day trip
--    departs that day) and 'blackout' (not running from starts_on to ends_on). Until now every reader treated a
--    blackout row as one more dated run. There are no blackout rows yet, so nothing changes today; this stops it
--    going wrong the day someone adds one. dated_runs now counts 'available' rows only, and the new blackout_dates
--    column (appended at the end, so the view can be replaced in place) lists every blacked-out day. The app's
--    My week, weekly story and auto-trip read the same rule from src/lib/week.ts.
--
-- 2. public.hostel_week(): one hostel's week, for the hostel-week Edge Function that STUDIO calls to make that
--    week's posters. Same rule as the connector's whats_on and the app's My week: live experiences on that weekday
--    plus dated runs, minus blackouts, transport left out. Guest-facing facts only (no suppliers, costs or notes).
--    Service role only.

create or replace view connector.experiences as
select p.id, p.location_id as hostel_id, l.name as hostel, l.country,
  p.category::text as category,
  case p.category when 'mm_tour' then 'MM Tour' when 'nightly_event' then 'Nightly Event'
    when 'third_party_tour' then '3rd Party Tour' when 'one_time_event' then 'One-Time Event' else 'Transport' end as category_label,
  p.title, p.status::text as status, p.active_on_ground,
  (p.active_on_ground and p.status <> 'paused') as live,
  p.bookable_on_website as on_website, p.urgent,
  connector.day_names(p.days_of_week) as days, p.days_of_week,
  (select array_agg(r.starts_on order by r.starts_on) from public.product_date_rules r where r.product_id = p.id and r.kind = 'available') as dated_runs,
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
  p.created_at, p.updated_at,
  (select array_agg(distinct x::date order by x::date) from public.product_date_rules r,
     generate_series(r.starts_on, coalesce(r.ends_on, r.starts_on), interval '1 day') x
   where r.product_id = p.id and r.kind = 'blackout') as blackout_dates
from public.products p
join public.locations l on l.id = p.location_id
left join public.operators o on o.id = p.operator_id
left join public.transport_details td on td.product_id = p.id
left join public.profiles vp on vp.id = p.last_verified_by;

comment on view connector.experiences is 'Every tour, nightly event, one-time event, 3rd party tour and transport route. live = active on the ground and not paused. on_website = listed on madmonkeyhostels.com. days_of_week/key_weekdays: 1 = Mon ... 7 = Sun. dated_runs = specific dates for dated products. blackout_dates = days it does not run. price_usd = headline USD price, price_local + local_currency = local price, price_options = named alternative prices.';
grant select on connector.experiences to mcp_reader;

create or replace function public.hostel_week(p_location text, p_week_start date)
returns jsonb
language sql stable security definer
set search_path = public, connector
as $$
  with h as (
    select l.id, l.name, l.country, l.currency, l.timezone
    from public.locations l
    where l.is_active and lower(l.name) = lower(trim(p_location))
    limit 1
  ),
  runs as (
    select e.id, array_agg(d::date order by d) as dates
    from h
    join connector.experiences e on e.hostel_id = h.id
    cross join generate_series(p_week_start, p_week_start + 6, interval '1 day') d
    where e.live and e.category <> 'transport'
      and (e.expires_on is null or e.expires_on >= d::date)
      and ((e.category <> 'one_time_event' and extract(isodow from d)::smallint = any(e.days_of_week))
           or d::date = any(coalesce(e.dated_runs, '{}')))
      and not (d::date = any(coalesce(e.blackout_dates, '{}')))
    group by e.id
  )
  select case when not exists (select 1 from h) then jsonb_build_object('unknown_location', true)
  else (
    select jsonb_build_object(
      'hostel', h.name, 'country', h.country, 'currency', h.currency, 'timezone', h.timezone,
      'week_start', p_week_start,
      'experiences', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'title', e.title, 'category', e.category, 'status', e.status,
          'days_of_week', e.days_of_week, 'dates', r.dates,
          'starts_at', e.starts_at, 'ends_at', e.ends_at, 'duration_minutes', e.duration_minutes,
          'price_usd', e.price_usd, 'price_local', e.price_local, 'local_currency', e.local_currency,
          'price_options', e.price_options,
          'brief_description', e.brief_description, 'meeting_point', e.meeting_point, 'inclusions', e.inclusions,
          'on_website', e.on_website, 'key_weekdays', e.key_weekdays,
          'photos', coalesce((select jsonb_agg(jsonb_build_object('url', ph.url, 'caption', ph.caption) order by ph.sort_order, ph.id)
                              from public.product_photos ph where ph.product_id = e.id), '[]'::jsonb),
          'updated_at', e.updated_at
        ) order by e.starts_at nulls last, e.title)
        from runs r join connector.experiences e on e.id = r.id
      ), '[]'::jsonb)
    ) from h
  ) end
$$;
revoke all on function public.hostel_week(text, date) from public, anon, authenticated;
grant execute on function public.hostel_week(text, date) to service_role;

-- 25 Oct 2026, two asks from Reden.
-- 1. Price options: some products sell at more than one price (Ha Giang Loop with or without bus tickets). The main
--    rate stays the headline price used by quotes and the list; price_options holds every named price guests choose
--    from: [{ "label": "With bus tickets", "local_amount": 5030000, "rate_usd": 195.32 }, ...].
-- 2. website_status(): GMs can see on the product page whether Reden has copied their changes to the website yet
--    (notification_events itself stays head-office-only).

alter table public.products add column if not exists price_options jsonb not null default '[]'::jsonb;
alter table public.products drop constraint if exists products_price_options_array;
alter table public.products add constraint products_price_options_array check (jsonb_typeof(price_options) = 'array');

-- The four Ha Giang Loop tours already had both prices in the flow chart's rate text. Filled in before price_options
-- is watched below, so this is not a Reden alert and doesn't clear anyone's verified stamp.
with fx as (select coalesce(manual_override, units_per_usd) as r from public.fx_rates where code = 'VND'),
src(pattern, without_vnd, with_vnd) as (values
  ('%Ha Giang Loop Tour%3D%2N%Self%', 4280000, 5030000),
  ('%Ha Giang Loop Tour%4D%3N%Self%', 5320000, 6070000),
  ('%Ha Giang Loop Tour%3D%2N%Easy Rider%', 5580000, 6330000),
  ('%Ha Giang Loop Tour%4D%3N%Easy Rider%', 6920000, 7670000))
update public.products p set price_options = jsonb_build_array(
    jsonb_build_object('label', 'Without bus tickets', 'local_amount', s.without_vnd, 'rate_usd', round(s.without_vnd / fx.r, 2)),
    jsonb_build_object('label', 'With bus tickets', 'local_amount', s.with_vnd, 'rate_usd', round(s.with_vnd / fx.r, 2)))
  from src s, fx
 where p.title ilike s.pattern and p.title not ilike '%christmas%' and p.price_options = '[]'::jsonb;

-- Reden alerts and the verified stamp now treat price options like the rate.
create or replace function public.enqueue_reden_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  watched text[] := array['title','rate_usd','rate_raw','status','active_on_ground',
    'brief_description','long_description','inclusions','days_of_week',
    'availability_raw','starts_at','ends_at','bookable_on_website','price_options'];
  f text; v_old jsonb; v_new jsonb;
begin
  if not coalesce(new.bookable_on_website, false)
     and not coalesce(case when tg_op = 'UPDATE' then old.bookable_on_website end, false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into notification_events (product_id, product_title, location_id, field, old_value, new_value, changed_by)
    values (new.id, new.title, new.location_id, 'product_added', null, new.title, auth.uid());
    return new;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach f in array watched loop
    if v_old->f is distinct from v_new->f then
      insert into notification_events (product_id, product_title, location_id, field, old_value, new_value, changed_by)
      values (new.id, new.title, new.location_id, f, v_old->>f, v_new->>f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

create or replace function public.clear_verified_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  watched text[] := array['title','category','rate_usd','local_amount','days_of_week','starts_at','ends_at',
    'duration_minutes','min_guests','max_guests_per_day','brief_description','long_description','meeting_point',
    'inclusions','exclusions','things_to_bring','cancellation_policy','itinerary','photo_album_url',
    'active_on_ground','bookable_on_website','status','expires_on','travel_insurance_required','price_options'];
  f text; v_old jsonb := to_jsonb(old); v_new jsonb := to_jsonb(new);
begin
  if new.last_verified_at is distinct from old.last_verified_at then return new; end if;
  foreach f in array watched loop
    if v_old->f is distinct from v_new->f then
      new.last_verified_at := null; new.last_verified_by := null;
      return new;
    end if;
  end loop;
  return new;
end $$;

create or replace function public.website_status(p_product uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not can_access_location(auth.uid(), p.location_id) then null else jsonb_build_object(
    'pending', (select count(*) from notification_events e where e.product_id = p.id and e.website_done_at is null),
    'last_done_at', (select max(e.website_done_at) from notification_events e where e.product_id = p.id and e.website_done_by is not null),
    'last_done_by', (select pr.full_name from notification_events e join profiles pr on pr.id = e.website_done_by
                      where e.product_id = p.id and e.website_done_by is not null order by e.website_done_at desc limit 1)
  ) end
  from products p where p.id = p_product
$$;
revoke all on function public.website_status(uuid) from public, anon;
grant execute on function public.website_status(uuid) to authenticated;

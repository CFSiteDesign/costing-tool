-- Phase 2 (client doc "Costing Tool Updates (1)", 8 Sep 2026). Applied to prod via MCP as
-- phase2_quotes_hidden_from_gms, phase2_reverify_on_edit, phase2_global_events_assets_overrides_email.

-- 1. Quotes are hidden from GMs: RLS on quotes/quote_days/quote_lines/quote_versions/customers
--    now requires can_quote() (admin / head_office / sales); the two SECURITY DEFINER quote
--    RPCs (duplicate_quote, generate_quote_version) refuse other roles too.
create or replace function public.can_quote(_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user and role in ('admin','head_office','sales'))
$$;
-- policies: "quoting roles manage quotes|quote days|quote lines|customers", "quoting roles read versions|mark sent"

-- 2. Edited => must be verified again.
create or replace function public.clear_verified_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  watched text[] := array['title','category','rate_usd','local_amount','days_of_week','starts_at','ends_at',
    'duration_minutes','min_guests','max_guests_per_day','brief_description','long_description','meeting_point',
    'inclusions','exclusions','things_to_bring','cancellation_policy','itinerary','photo_album_url',
    'active_on_ground','bookable_on_website','status','expires_on','travel_insurance_required'];
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
create trigger products_clear_verified before update on public.products for each row execute function public.clear_verified_on_edit();
-- + transport_clear_verified (after update on transport_details) does the same via the parent product.

-- 3. Global events: up to 6 asset links, GM overrides before accepting, email log.
alter table public.global_events
  add column if not exists asset_urls text[] not null default '{}',
  add column if not exists notified_at timestamptz,
  add column if not exists notify_result jsonb;
alter table public.global_events add constraint global_events_asset_urls_max6 check (cardinality(asset_urls) <= 6);
alter table public.global_event_responses add column if not exists overrides jsonb;
alter table public.product_assets drop constraint if exists product_assets_source_check;
alter table public.product_assets add constraint product_assets_source_check check (source in ('studio','manual','global'));
-- respond_global_event(p_event, p_location, p_status, p_overrides jsonb default null):
--   overrides (title, rate_usd, local_amount, starts_at, ends_at, days_of_week, event_date, expires_on,
--   brief_description, long_description, inclusions, things_to_bring) are applied to the created product
--   and stored on the response row; asset_urls are copied into product_assets (source 'global').
-- notify_global_event(): after-insert trigger, pg_net POST to the global-event-notify edge function.

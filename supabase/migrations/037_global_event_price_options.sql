-- 19 Nov 2026 (Kyle, Kurt in Phuket): GMs accepting a head-office event (Christmas 2026) could only give one rate,
-- but they sell it at several prices (full package early bird / on the day, free flow only, dinner only), and
-- "Rate must be a number" made Kurt type 1 to save. The accept screen now has the same "Add price options" as the
-- experience page; respond_global_event() copies overrides.price_options onto the new product. Only change from the
-- live version: the price_options column in the insert.
create or replace function public.respond_global_event(p_event uuid, p_location uuid, p_status text, p_overrides jsonb default null::jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare e global_events%rowtype; v_product uuid; o jsonb := coalesce(p_overrides, '{}'::jsonb);
        v_days int[]; v_event_date date; v_ccy text;
begin
  if p_status not in ('accepted','declined') then raise exception 'status must be accepted or declined'; end if;
  if not can_access_location(auth.uid(), p_location) or not is_editor(auth.uid()) then
    raise exception 'not allowed for this location';
  end if;
  select * into e from global_events where id = p_event;
  if not found then raise exception 'event not found'; end if;
  select product_id into v_product from global_event_responses where global_event_id = p_event and location_id = p_location;
  select currency into v_ccy from locations where id = p_location;

  -- GM may adjust the details for their hostel before accepting (phase 2, GE2)
  v_days := case when o ? 'days_of_week' then (select coalesce(array_agg(x::int), '{}') from jsonb_array_elements_text(o->'days_of_week') x) else e.days_of_week end;
  v_event_date := case when o ? 'event_date' then nullif(o->>'event_date','')::date else e.event_date end;

  if p_status = 'accepted' and v_product is null then
    insert into products (location_id, category, title, rate_usd, local_amount, local_currency, fx_rate_used, fx_as_of,
                          days_of_week, starts_at, ends_at, duration_minutes, brief_description, long_description,
                          inclusions, things_to_bring, photo_album_url, bookable_on_website, expires_on,
                          status, active_on_ground, external_refs, price_options)
    values (p_location, e.category, coalesce(nullif(o->>'title',''), e.title),
            case when o ? 'rate_usd' then nullif(o->>'rate_usd','')::numeric else e.rate_usd end,
            case when o ? 'local_amount' then nullif(o->>'local_amount','')::numeric end,
            v_ccy, case when v_ccy = 'USD' then 1 end, now(),
            v_days,
            case when o ? 'starts_at' then nullif(o->>'starts_at','')::time else e.starts_at end,
            case when o ? 'ends_at' then nullif(o->>'ends_at','')::time else e.ends_at end,
            e.duration_minutes,
            coalesce(nullif(o->>'brief_description',''), e.brief_description),
            coalesce(nullif(o->>'long_description',''), e.long_description),
            coalesce(nullif(o->>'inclusions',''), e.inclusions),
            coalesce(nullif(o->>'things_to_bring',''), e.things_to_bring),
            e.photo_album_url, e.bookable_on_website,
            case when o ? 'expires_on' then nullif(o->>'expires_on','')::date else coalesce(e.expires_on, v_event_date) end,
            'active', true, jsonb_build_object('global_event_id', e.id),
            case when jsonb_typeof(o->'price_options') = 'array' then o->'price_options' else '[]'::jsonb end)
    returning id into v_product;
    if v_event_date is not null then
      insert into product_date_rules (product_id, kind, starts_on, note) values (v_product, 'available', v_event_date, 'global event');
    end if;
    -- head office's asset links travel with the product (asset 1 ends up as the latest)
    insert into product_assets (product_id, url, source, created_by, created_at)
    select v_product, u, 'global', auth.uid(), now() - (ord * interval '1 second')
      from unnest(e.asset_urls) with ordinality as a(u, ord) where btrim(u) <> '';
  elsif p_status = 'declined' and v_product is not null then
    update products set status = 'paused', active_on_ground = false where id = v_product;
  end if;

  update global_event_responses
     set status = p_status, responded_by = auth.uid(), responded_at = now(),
         product_id = coalesce(product_id, v_product),
         overrides = case when p_status = 'accepted' and o <> '{}'::jsonb then o else null end
   where global_event_id = p_event and location_id = p_location;
  return v_product;
end $function$;

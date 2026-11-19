-- 19 Nov 2026 (Reden via Charlie): hostels added their Christmas and New Year events but Reden got nothing in
-- Approvals. They are one-time events, and Reden was only told about one-time events a GM had ticked "Listed on
-- website" (only Hanoi and Hoi An had). Same fix as 030 for transport and third-party tours: every one-time event
-- now notifies Reden, ticked or not. The 36 live Christmas/New Year events he missed were sent once by hand.
create or replace function public.enqueue_reden_events() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare
  watched text[] := array['title','rate_usd','rate_raw','status','active_on_ground',
    'brief_description','long_description','inclusions','days_of_week',
    'availability_raw','starts_at','ends_at','bookable_on_website','price_options'];
  f text; v_old jsonb; v_new jsonb;
begin
  if not coalesce(new.bookable_on_website, false)
     and not coalesce(case when tg_op = 'UPDATE' then old.bookable_on_website end, false)
     and new.category::text not in ('transport', 'third_party_tour', 'one_time_event') then
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
end $function$;

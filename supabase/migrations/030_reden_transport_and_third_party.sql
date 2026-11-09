-- 9 Nov 2026, Reden was not told about Kampot tour or Transportation edits. The Reden alert (and so the Approvals
-- to-do) only fired for products ticked "bookable on the website". Transport and third-party tours are managed in
-- Rezdy by Reden whether or not that tick is set, so they now always notify. Everything else is unchanged.
create or replace function public.enqueue_reden_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  watched text[] := array['title','rate_usd','rate_raw','status','active_on_ground',
    'brief_description','long_description','inclusions','days_of_week',
    'availability_raw','starts_at','ends_at','bookable_on_website','price_options'];
  f text; v_old jsonb; v_new jsonb;
begin
  if not coalesce(new.bookable_on_website, false)
     and not coalesce(case when tg_op = 'UPDATE' then old.bookable_on_website end, false)
     and new.category::text not in ('transport', 'third_party_tour') then
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

-- 24 Nov 2026 (Reden, Katrina): Hostelworld Link Ups are about nightly events. Tours already have their own process
-- (GMs tell the team which top sellers to promote), so the 038 list was too wide. From now on only nightly events,
-- plus anything called a Meet-Up (one hostel has its Meet-Up set up as a tour), are logged for Hostelworld.
-- The tour changes still waiting in Approvals > Hostelworld are removed; the ones already ticked off stay as history.

create or replace function public.is_hostelworld_product(c text, t text) returns boolean
language sql immutable as $$ select c = 'nightly_event' or coalesce(t, '') ~* '\mmeet[\s-]?ups?\M' $$;

create or replace function public.enqueue_hostelworld_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- the fields a Link Up shows (name, when, how long, free or paid, description, meeting point, image) + on/off
  watched text[] := array['title','category','status','active_on_ground','days_of_week','starts_at','ends_at',
    'duration_minutes','rate_usd','brief_description','long_description','meeting_point','expires_on','hostelworld_photo_url'];
  f text; v_old jsonb; v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if is_hostelworld_product(old.category::text, old.title) then
      insert into hostelworld_changes (product_id, product_title, location_id, category, field, old_value, new_value, changed_by)
      values (old.id, old.title, old.location_id, old.category::text, 'product_removed', old.title, null, auth.uid());
    end if;
    return old;
  end if;
  if not (is_hostelworld_product(new.category::text, new.title)
          or (tg_op = 'UPDATE' and is_hostelworld_product(old.category::text, old.title))) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into hostelworld_changes (product_id, product_title, location_id, category, field, old_value, new_value, changed_by)
    values (new.id, new.title, new.location_id, new.category::text, 'product_added', null, new.title, auth.uid());
    return new;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach f in array watched loop
    if v_old->f is distinct from v_new->f then
      insert into hostelworld_changes (product_id, product_title, location_id, category, field, old_value, new_value, changed_by)
      values (new.id, new.title, new.location_id, new.category::text, f, v_old->>f, v_new->>f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

create or replace function public.enqueue_hostelworld_dates() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
  fmt constant text := 'DD Mon YYYY';
begin
  select id, title, location_id, category::text as cat into p
    from products where id = case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  if not found or not is_hostelworld_product(p.cat, p.title) then return null; end if;
  insert into hostelworld_changes (product_id, product_title, location_id, category, field, old_value, new_value, changed_by)
  values (p.id, p.title, p.location_id, p.cat, 'dates',
    case when tg_op <> 'INSERT' then case when old.kind = 'available' then 'runs ' else 'not running ' end
      || to_char(old.starts_on, fmt) || coalesce(' to ' || to_char(old.ends_on, fmt), '') end,
    case when tg_op <> 'DELETE' then case when new.kind = 'available' then 'runs ' else 'not running ' end
      || to_char(new.starts_on, fmt) || coalesce(' to ' || to_char(new.ends_on, fmt), '') end,
    auth.uid());
  return null;
end $$;

drop function if exists public.is_hostelworld_category(text);

delete from public.hostelworld_changes
 where done_at is null and not public.is_hostelworld_product(category, product_title);

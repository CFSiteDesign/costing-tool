-- Viewer: sees every hostel's experiences (read only), never edits, never sees Quotes.
-- can_access_location lets viewers READ every hostel; is_editor and can_quote are left as they were, so a viewer
-- cannot insert/update/delete anything and cannot reach quotes (both policies are built on those two functions).
create or replace function public.can_access_location(_user uuid, _loc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user and role in ('admin','head_office','sales','viewer'))
      or exists (select 1 from user_locations where user_id = _user and location_id = _loc)
$$;

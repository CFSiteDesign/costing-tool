-- after a real sheet push, sample room types that nothing references any more disappear
-- (frozen quote versions store room_type_name as text, so they are unaffected)
create or replace function public.cleanup_sample_room_types()
returns void language sql security definer set search_path = public as $$
  delete from room_types rt
  where rt.is_sample
    and not exists (select 1 from accommodation_rates ar where ar.room_type_id = rt.id)
    and not exists (select 1 from quote_lines ql where ql.room_type_id = rt.id);
$$;
revoke execute on function public.cleanup_sample_room_types() from anon, authenticated, public;

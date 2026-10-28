-- Add a hostel (28 Oct 2026). Reden asked whether head office can add new properties (e.g. Kampot) without asking
-- Charlie. locations is admin-write only, so head office goes through this checked function instead.
create or replace function public.add_location(p_name text, p_country text, p_currency text, p_timezone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(p_name); v_country text := btrim(p_country); v_ccy text := upper(btrim(p_currency));
begin
  if not (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office')) then
    raise exception 'Only head office can add a hostel';
  end if;
  if coalesce(v_name, '') = '' or coalesce(v_country, '') = '' then raise exception 'A hostel needs a name and a country'; end if;
  if exists (select 1 from locations where lower(name) = lower(v_name)) then raise exception 'There is already a hostel called %', v_name; end if;
  if v_ccy !~ '^[A-Z]{3}$' then raise exception 'Currency must be a 3-letter code like USD or IDR'; end if;
  begin
    perform now() at time zone p_timezone;
  exception when others then
    raise exception 'Unknown time zone %', p_timezone;
  end;
  insert into locations (name, country, currency, timezone, is_active)
  values (v_name, v_country, v_ccy, p_timezone, true)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.add_location(text, text, text, text) from public, anon;
grant execute on function public.add_location(text, text, text, text) to authenticated;

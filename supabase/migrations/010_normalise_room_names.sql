-- The 2027 rate sheet labels rooms "Lowest Dorm"/"Lowest Private"; the client wants
-- "Dorm"/"Private" on quotes. Renaming the rows alone was undone by the next sync
-- (promote_rate_sync auto-creates room types from the sheet's own labels), so the
-- normalisation has to live at ingest.
create or replace function public.normalise_room_name(_raw text)
returns text language sql immutable as $$
  select initcap(btrim(regexp_replace(coalesce(_raw, ''), '^\s*lowest\s+', '', 'i')))
$$;
-- promote_rate_sync() then applies normalise_room_name() when staging rows;
-- see the applied migration `normalise_room_type_names` for the full body.

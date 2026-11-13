-- ALL IN itineraries that change after guests have booked (Charlie, 13 Nov 2026).
-- Cambodia moved from Sihanoukville to Kampot (11 Nov brief), and Charlie's call is that bookings made before the
-- change keep the old route. allin_trip_days used to hold one itinerary per trip, so reloading Kampot would have
-- switched every old booking too. Now a trip can keep older editions next to the current one:
--   allin_trip_days.edition   '' is the current itinerary (what the trip page shows); anything else is an older one.
--   allin_trip_editions       for each older edition, booked_before: bookings made before that moment follow it.
--                             booked_before null means the newer itinerary isn't live yet, so every booking still
--                             follows the older one. Set it to the moment the new trip page went live.
-- allin-guest-trips picks the edition per booking from the booking's booked_at.

alter table public.allin_trip_days add column if not exists edition text not null default '';
alter table public.allin_trip_days drop constraint if exists allin_trip_days_pkey;
alter table public.allin_trip_days add primary key (trip_slug, edition, day_from);

create table if not exists public.allin_trip_editions (
  trip_slug text not null,
  edition text not null check (edition <> ''),
  booked_before timestamptz,
  note text,
  primary key (trip_slug, edition)
);
alter table public.allin_trip_editions enable row level security;
create policy allin_trip_editions_read on public.allin_trip_editions for select to authenticated using (true);

-- Keep the Sihanoukville Cambodia days as an older edition; the Kampot days load as the current edition from
-- tools/data/allin_trip_days.sql. Cut-off: the Kampot page reached main at 03:32 UTC on 11 Nov 2026 (mm-squad-trips
-- ac941a2) and was live on madmonkeyhostels.com by 13 Nov. The last Cambodia booking before it was 3 Nov and none came
-- in between, so all six existing Cambodia bookings keep the old route and every booking from now on gets Kampot.
update public.allin_trip_days set edition = 'via-sihanoukville' where trip_slug = 'cambodia' and edition = '';
insert into public.allin_trip_editions (trip_slug, edition, booked_before, note) values
  ('cambodia', 'via-sihanoukville', '2026-11-11T03:32:51Z',
   'Phnom Penh, Siem Reap, Sihanoukville, Koh Rong, Koh Sdach. Bookings made before the Kampot route went live keep it.')
on conflict (trip_slug, edition) do nothing;

-- Kyle's read-only connector sees which edition a day belongs to (columns can only be added at the end).
create or replace view connector.allin_trip_days as
select trip_slug, day_from, day_to, label, place, body, transport, activities, meals, edition
from public.allin_trip_days;

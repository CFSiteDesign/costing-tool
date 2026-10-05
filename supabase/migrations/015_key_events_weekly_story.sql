-- 015 Key events + weekly story (Oct 2026)
-- A GM stars up to 3 experiences per day on My week. Stars repeat every week (per weekday) until removed.
-- The weekly story (1080x1920) is built from them; the GM's text edits are saved per hostel per week.

create table if not exists public.product_key_days (
  product_id uuid not null references public.products on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),   -- Mon = 1
  location_id uuid not null references public.locations,
  created_by uuid default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  primary key (product_id, weekday)
);
create index if not exists product_key_days_loc on public.product_key_days (location_id, weekday);

-- at most 3 key events per hostel per weekday, counting only experiences that actually run that day
create or replace function public.enforce_key_day_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int; v_loc uuid;
begin
  select p.location_id into v_loc from products p where p.id = new.product_id;
  if v_loc is null then raise exception 'Unknown experience'; end if;
  new.location_id := v_loc;
  select count(*) into n from product_key_days k join products p on p.id = k.product_id
   where k.location_id = v_loc and k.weekday = new.weekday and k.product_id <> new.product_id
     and p.active_on_ground and p.status <> 'paused'
     and (new.weekday = any(p.days_of_week) or (p.category = 'one_time_event' and coalesce(p.expires_on, current_date) >= current_date));
  if n >= 3 then raise exception 'Three key events already on that day. Remove one first.'; end if;
  return new;
end $$;
drop trigger if exists product_key_days_limit on public.product_key_days;
create trigger product_key_days_limit before insert on public.product_key_days for each row execute function public.enforce_key_day_limit();

alter table public.product_key_days enable row level security;
drop policy if exists "read key days in scope" on public.product_key_days;
create policy "read key days in scope" on public.product_key_days for select to authenticated using (public.can_access_location(auth.uid(), location_id));
drop policy if exists "editors add key days" on public.product_key_days;
create policy "editors add key days" on public.product_key_days for insert to authenticated
  with check (public.is_editor(auth.uid()) and exists (select 1 from public.products p where p.id = product_id and public.can_access_location(auth.uid(), p.location_id)));
drop policy if exists "editors remove key days" on public.product_key_days;
create policy "editors remove key days" on public.product_key_days for delete to authenticated
  using (public.is_editor(auth.uid()) and public.can_access_location(auth.uid(), location_id));

create table if not exists public.weekly_stories (
  location_id uuid not null references public.locations,
  week_start date not null,                 -- the Monday
  doc jsonb not null,                       -- { eyebrow, headline, sticker, days: [{ day, date, items: [{ time, title }] }] }
  updated_by uuid default auth.uid() references auth.users,
  updated_at timestamptz not null default now(),
  primary key (location_id, week_start)
);
alter table public.weekly_stories enable row level security;
drop policy if exists "read stories in scope" on public.weekly_stories;
create policy "read stories in scope" on public.weekly_stories for select to authenticated using (public.can_access_location(auth.uid(), location_id));
drop policy if exists "editors write stories" on public.weekly_stories;
create policy "editors write stories" on public.weekly_stories for insert to authenticated with check (public.is_editor(auth.uid()) and public.can_access_location(auth.uid(), location_id));
drop policy if exists "editors update stories" on public.weekly_stories;
create policy "editors update stories" on public.weekly_stories for update to authenticated
  using (public.is_editor(auth.uid()) and public.can_access_location(auth.uid(), location_id))
  with check (public.is_editor(auth.uid()) and public.can_access_location(auth.uid(), location_id));
drop policy if exists "editors delete stories" on public.weekly_stories;
create policy "editors delete stories" on public.weekly_stories for delete to authenticated using (public.is_editor(auth.uid()) and public.can_access_location(auth.uid(), location_id));

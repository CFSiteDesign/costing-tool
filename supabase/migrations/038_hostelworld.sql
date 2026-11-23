-- 23 Nov 2026, Hostelworld Link Ups (Katrina, Reden, Adel; plan in docs/HOSTELWORLD_PLAN.md, kept local).
-- Link Ups are typed by hand into the Hostelworld Inbox (Hostelworld has no API for them), so they drifted from the
-- dashboard: nobody was told when a GM changed an event. Now:
--   1. every change to an event or tour lands in hostelworld_changes (a trigger, like Reden's website alerts);
--   2. the `hostelworld-digest` Edge Function emails them once a day: Reden gets every event and tour (he runs the
--      Link Ups), Adel and Katrina get nightly events plus anything called a Meet-Up. Recipients and the send hour
--      live in sync_config (set outside this file so staff emails stay out of the public repo);
--   3. head office ticks each change off under Approvals > Hostelworld once the Link Up matches;
--   4. every event can carry its own "Photo for Hostelworld" and an "On Hostelworld" check.

alter table public.products
  add column if not exists hostelworld_photo_url text,
  add column if not exists on_hostelworld boolean,            -- null = nobody has checked yet
  add column if not exists hostelworld_checked_at timestamptz,
  add column if not exists hostelworld_checked_by uuid;

create table if not exists public.hostelworld_changes (
  id bigint generated always as identity primary key,
  product_id uuid,                 -- no foreign key: a deleted event's change stays on the list
  product_title text,
  location_id uuid,
  category text not null,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  emailed_at timestamptz,          -- in a daily email (the digest sends everything pending, once a day)
  done_at timestamptz,             -- ticked off: the Link Up matches
  done_by uuid
);
create index if not exists hostelworld_changes_unsent on public.hostelworld_changes (changed_at) where emailed_at is null;
create index if not exists hostelworld_changes_todo on public.hostelworld_changes (location_id, changed_at) where done_at is null;
create index if not exists hostelworld_changes_done on public.hostelworld_changes (done_at desc) where done_at is not null;

alter table public.hostelworld_changes enable row level security;
drop policy if exists "head office reads hostelworld changes" on public.hostelworld_changes;
create policy "head office reads hostelworld changes" on public.hostelworld_changes for select to authenticated
  using (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office'));

-- Events and tours (everything that can be a Link Up). Transport never is.
create or replace function public.is_hostelworld_category(c text) returns boolean
language sql immutable as $$ select c in ('nightly_event', 'mm_tour', 'one_time_event', 'third_party_tour') $$;

create or replace function public.enqueue_hostelworld_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- the fields a Link Up shows (name, when, how long, free or paid, description, meeting point, image) + on/off
  watched text[] := array['title','category','status','active_on_ground','days_of_week','starts_at','ends_at',
    'duration_minutes','rate_usd','brief_description','long_description','meeting_point','expires_on','hostelworld_photo_url'];
  f text; v_old jsonb; v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if is_hostelworld_category(old.category::text) then
      insert into hostelworld_changes (product_id, product_title, location_id, category, field, old_value, new_value, changed_by)
      values (old.id, old.title, old.location_id, old.category::text, 'product_removed', old.title, null, auth.uid());
    end if;
    return old;
  end if;
  if not (is_hostelworld_category(new.category::text)
          or (tg_op = 'UPDATE' and is_hostelworld_category(old.category::text))) then
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

drop trigger if exists products_hostelworld on public.products;
create trigger products_hostelworld after insert or update or delete on public.products
  for each row execute function public.enqueue_hostelworld_changes();

-- One-off events keep their date in product_date_rules, so a moved date is a change too.
create or replace function public.enqueue_hostelworld_dates() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
  fmt constant text := 'DD Mon YYYY';
begin
  select id, title, location_id, category::text as cat into p
    from products where id = case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  if not found or not is_hostelworld_category(p.cat) then return null; end if;   -- gone with its product, or not an event
  insert into hostelworld_changes (product_id, product_title, location_id, category, field, old_value, new_value, changed_by)
  values (p.id, p.title, p.location_id, p.cat, 'dates',
    case when tg_op <> 'INSERT' then case when old.kind = 'available' then 'runs ' else 'not running ' end
      || to_char(old.starts_on, fmt) || coalesce(' to ' || to_char(old.ends_on, fmt), '') end,
    case when tg_op <> 'DELETE' then case when new.kind = 'available' then 'runs ' else 'not running ' end
      || to_char(new.starts_on, fmt) || coalesce(' to ' || to_char(new.ends_on, fmt), '') end,
    auth.uid());
  return null;
end $$;

drop trigger if exists product_date_rules_hostelworld on public.product_date_rules;
create trigger product_date_rules_hostelworld after insert or update or delete on public.product_date_rules
  for each row execute function public.enqueue_hostelworld_dates();

-- Approvals > Hostelworld: tick off / move back (head office, like the website updates)
create or replace function public.mark_hostelworld_done(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office')) then
    raise exception 'Only head office can tick off Hostelworld changes';
  end if;
  update hostelworld_changes set done_at = now(), done_by = auth.uid() where id = any(p_ids) and done_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.unmark_hostelworld_done(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office')) then
    raise exception 'Only head office can change Hostelworld changes';
  end if;
  update hostelworld_changes set done_at = null, done_by = null where id = any(p_ids) and done_at is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mark_hostelworld_done(bigint[]) from public, anon;
revoke all on function public.unmark_hostelworld_done(bigint[]) from public, anon;
grant execute on function public.mark_hostelworld_done(bigint[]) to authenticated;
grant execute on function public.unmark_hostelworld_done(bigint[]) to authenticated;

-- Digest settings (values are set by hand: see the header). The secret lets a test run preview the emails.
insert into public.sync_config (key, value) values
  ('hostelworld_alerts_enabled', 'false'),
  ('hostelworld_alerts_all', ''),
  ('hostelworld_alerts_nightly', ''),
  ('hostelworld_digest_hour', '9'),
  ('hostelworld_digest_tz', 'Asia/Bangkok'),
  ('hostelworld_last_digest', ''),
  ('hostelworld_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Hourly; the function only sends in its slot (digest hour, once a day).
select cron.unschedule('hostelworld-digest-hourly') where exists (select 1 from cron.job where jobname = 'hostelworld-digest-hourly');
select cron.schedule('hostelworld-digest-hourly', '10 * * * *', $cron$
  select net.http_post(
    url := 'https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/hostelworld-digest',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'cron'))
$cron$);

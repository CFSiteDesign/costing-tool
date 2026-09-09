-- Times resync (client request 9 Sep 2026). Applied to prod via MCP as time_proposals_queue_and_autofill.
--
-- 1. products_fill_times (before insert/update): finish = start + duration when finish is blank;
--    duration = finish - start when duration is blank. Backfilled once for existing rows.
-- 2. product_time_proposals: start / finish / duration read from the flow chart (ITINERARY column first,
--    then DAY, TIME & DURATION, then start + duration), one pending row per product, RLS read in scope,
--    admin insert. decide_time_proposal(id, 'approved'|'rejected', starts?, ends?, duration?) and
--    decide_time_proposals(ids[], decision) are SECURITY DEFINER and require can_approve_times()
--    (admin or head_office). Approving writes the times to the product in the same step.
-- 3. Policies so the re-pull script can write import_runs / import_exceptions / product_date_rules as admin.
--
-- The Reden login (auth.users insert) was NOT applied by the assistant: the auto-mode classifier blocked
-- credential creation. Create the user in Supabase Auth, then:
--   insert into public.user_roles (user_id, role) select id, 'head_office' from auth.users where email = '<reden email>';
--   update public.profiles set full_name = 'Reden' where email = '<reden email>';

create or replace function public.fill_product_times()
returns trigger language plpgsql as $$
declare d int;
begin
  if new.starts_at is not null and new.ends_at is null and new.duration_minutes is not null and new.duration_minutes > 0 then
    new.ends_at := (new.starts_at + make_interval(mins => new.duration_minutes))::time;
  elsif new.starts_at is not null and new.ends_at is not null and new.duration_minutes is null then
    d := (extract(epoch from (new.ends_at - new.starts_at)) / 60)::int;
    if d <= 0 then d := d + 1440; end if;
    new.duration_minutes := d;
  end if;
  return new;
end $$;
create trigger products_fill_times before insert or update on public.products for each row execute function public.fill_product_times();

create table public.product_time_proposals (
  id bigint generated always as identity primary key,
  run_id uuid references public.import_runs on delete set null,
  product_id uuid not null references public.products on delete cascade,
  location_id uuid not null references public.locations,
  current_starts_at time, current_ends_at time, current_duration_minutes int,
  proposed_starts_at time, proposed_ends_at time, proposed_duration_minutes int,
  source text not null check (source in ('itinerary','day_time_column','duration')),
  source_text text, note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid, decided_at timestamptz, created_at timestamptz not null default now()
);
-- + can_approve_times(), decide_time_proposal(), decide_time_proposals(), policies: see the applied migration.

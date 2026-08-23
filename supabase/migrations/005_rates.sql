-- 005 rates (synced from Sheets in Phase-2b; sample-seeded until then)
create table public.rate_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'sheets',
  triggered_by text not null default 'manual' check (triggered_by in ('edit','nightly','manual','seed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed','partial','needs_review')),
  rows_read int not null default 0,
  rows_imported int not null default 0,
  rows_rejected int not null default 0,
  error text
);

create table public.rate_sync_issues (
  id bigint generated always as identity primary key,
  sync_run_id uuid not null references public.rate_sync_runs on delete cascade,
  sheet_row int,
  raw jsonb,
  reason text not null
);

create table public.accommodation_rates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations,
  room_type_id uuid not null references public.room_types,
  season public.season_tier not null,
  rate_usd numeric(10,2) not null check (rate_usd > 0),
  valid_from date,
  valid_to date,
  source text not null default 'sample',
  sync_run_id uuid references public.rate_sync_runs,
  created_at timestamptz not null default now(),
  unique (location_id, room_type_id, season)
);

create table public.breakfast_rates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations unique,
  rate_usd_pp numeric(10,2) not null check (rate_usd_pp >= 0),
  source text not null default 'sample',
  sync_run_id uuid references public.rate_sync_runs,
  created_at timestamptz not null default now()
);

alter table public.rate_sync_runs enable row level security;
alter table public.rate_sync_issues enable row level security;
alter table public.accommodation_rates enable row level security;
alter table public.breakfast_rates enable row level security;
create policy "authenticated read sync runs" on public.rate_sync_runs for select to authenticated using (true);
create policy "authenticated read sync issues" on public.rate_sync_issues for select to authenticated using (true);
create policy "authenticated read acc rates" on public.accommodation_rates for select to authenticated using (true);
create policy "authenticated read bf rates" on public.breakfast_rates for select to authenticated using (true);
-- writes come only from the sync Edge Function (service role) / admin seeds

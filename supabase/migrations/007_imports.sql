-- 007 migration bookkeeping: runs + exceptions queue
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'flowchart_xlsx',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  products_imported int not null default 0,
  exceptions_count int not null default 0,
  notes text
);

create table public.import_exceptions (
  id bigint generated always as identity primary key,
  run_id uuid references public.import_runs on delete cascade,
  location_id uuid references public.locations,
  product_id uuid references public.products on delete set null,
  source_sheet text,
  source_row int,
  field text not null,
  reason text not null,
  raw_value text,
  payload jsonb,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index import_exceptions_open on public.import_exceptions (location_id, status);

alter table public.import_runs enable row level security;
alter table public.import_exceptions enable row level security;
create policy "authenticated read runs" on public.import_runs for select to authenticated using (true);
create policy "read exceptions in scope" on public.import_exceptions for select to authenticated
  using (location_id is null or can_access_location(auth.uid(), location_id));
create policy "resolve exceptions in scope" on public.import_exceptions for update to authenticated
  using (is_editor(auth.uid()) and (location_id is null or can_access_location(auth.uid(), location_id)))
  with check (is_editor(auth.uid()));

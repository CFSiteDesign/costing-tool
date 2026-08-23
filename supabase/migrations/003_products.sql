-- 003 products + children
create table public.products (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations,
  category public.product_category not null,
  title text not null,
  operator_id uuid references public.operators,

  rate_usd numeric(10,2),          -- parsed; null where source was unparseable
  rate_raw text,                   -- verbatim source cell, always kept
  gross_service_value text,
  rezdy_reference text,
  external_refs jsonb not null default '{}'::jsonb,

  active_on_ground boolean not null default true,
  bookable_on_website boolean not null default false,
  status public.product_status not null default 'active',

  days_of_week smallint[] not null default '{}',   -- ISO: 1=Mon .. 7=Sun
  availability_raw text,
  starts_at time,
  ends_at time,
  duration_minutes int,
  min_guests int,
  max_guests_per_day int,
  capacity_raw text,

  brief_description text check (char_length(brief_description) <= 95),
  long_description text,
  meeting_point text,
  inclusions text,
  exclusions text,
  things_to_bring text,
  cancellation_policy text,
  itinerary text,
  travel_insurance_required boolean not null default false,
  photo_album_url text,
  remarks text,

  source_sheet text,
  source_row int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint days_valid check (days_of_week <@ array[1,2,3,4,5,6,7]::smallint[])
);
create unique index products_source_key on public.products (source_sheet, source_row)
  where source_sheet is not null;
create index products_loc_cat_status on public.products (location_id, category, status);
create index products_days_gin on public.products using gin (days_of_week);
create trigger products_updated before update on public.products
  for each row execute function public.set_updated_at();

create table public.transport_details (
  product_id uuid primary key references public.products on delete cascade,
  vehicle_type text,
  route_raw text,
  origin text,
  destination text,
  pickup_point text,
  dropoff_point text
);

create table public.product_date_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products on delete cascade,
  kind text not null default 'available' check (kind in ('available','blackout')),
  starts_on date not null,
  ends_on date,
  note text
);

create table public.product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products on delete cascade,
  url text not null,
  sort_order int not null default 0,
  caption text
);

alter table public.products enable row level security;
alter table public.transport_details enable row level security;
alter table public.product_date_rules enable row level security;
alter table public.product_photos enable row level security;

create policy "read products in scope" on public.products for select to authenticated
  using (can_access_location(auth.uid(), location_id));
create policy "editors insert products" on public.products for insert to authenticated
  with check (is_editor(auth.uid()) and can_access_location(auth.uid(), location_id));
create policy "editors update products" on public.products for update to authenticated
  using (is_editor(auth.uid()) and can_access_location(auth.uid(), location_id))
  with check (is_editor(auth.uid()) and can_access_location(auth.uid(), location_id));
create policy "admin deletes products" on public.products for delete to authenticated
  using (has_role(auth.uid(),'admin'));

create policy "transport follows product" on public.transport_details for all to authenticated
  using (exists (select 1 from products p where p.id = product_id and can_access_location(auth.uid(), p.location_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_editor(auth.uid()) and can_access_location(auth.uid(), p.location_id)));
create policy "date rules follow product" on public.product_date_rules for all to authenticated
  using (exists (select 1 from products p where p.id = product_id and can_access_location(auth.uid(), p.location_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_editor(auth.uid()) and can_access_location(auth.uid(), p.location_id)));
create policy "photos follow product" on public.product_photos for all to authenticated
  using (exists (select 1 from products p where p.id = product_id and can_access_location(auth.uid(), p.location_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_editor(auth.uid()) and can_access_location(auth.uid(), p.location_id)));

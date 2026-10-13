-- Archived products (Oct 2026). When an experience is retired for good it is copied here whole (the product row plus
-- its photos, assets, aliases, date rules, time proposals, sheet proposals, key days, import exceptions and transport
-- details) and then deleted from products. Nothing in the app reads this table: RLS is on with no policies, so only
-- the service role sees it. To bring one back, re-insert archived_products.product into products (same id) and the
-- related rows from archived_products.related.
create table if not exists public.archived_products (
  product_id  uuid primary key,
  location_id uuid,
  title       text not null,
  category    text,
  reason      text,
  archived_at timestamptz not null default now(),
  archived_by text,
  product     jsonb not null,
  related     jsonb not null default '{}'::jsonb
);
create index if not exists archived_products_location_idx on public.archived_products (location_id);
alter table public.archived_products enable row level security;
-- no policies on purpose: invisible in the app

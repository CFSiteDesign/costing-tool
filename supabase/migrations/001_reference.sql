-- 001 reference: enums, locations, operators, room types
create type public.app_role as enum ('admin','head_office','gm','sales');
create type public.product_category as enum ('mm_tour','nightly_event','third_party_tour','one_time_event','transport');
create type public.product_status as enum ('active','paused','signature','pending_update');
create type public.season_tier as enum ('lean','mid','high');
create type public.quote_status as enum ('draft','sent','accepted','cancelled');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text not null,
  timezone text not null default 'Asia/Phnom_Penh',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_mad_monkey boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order int not null default 0,
  is_sample boolean not null default false
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

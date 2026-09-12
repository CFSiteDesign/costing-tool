-- MIMO (13 Sep 2026). Applied to prod via MCP as mimo_prompt_edits and mimo_onboarding_and_aliases.
-- prompt_edits: every prompt, MIMO's reply/kind, the validated proposal, and the outcome
--   (answered | question | cannot | proposed | applied | cancelled | undone | failed). GMs read their own,
--   head office reads all. sync_config 'prompt_model' = claude-sonnet-5.
-- profiles.mimo_met_at: the first-run walkthrough, once per person on any device.
-- product_aliases: nicknames MIMO learns from confirmed actions, per hostel (unique on location + lower(alias)),
--   written only through learn_alias(location, product, alias) which checks access, length 3..60, and that the
--   alias is not the product's real name.
create table if not exists public.prompt_edits (
  id bigint generated always as identity primary key, user_id uuid not null, location_id uuid references public.locations,
  prompt text not null, reply text, kind text, proposal jsonb,
  outcome text not null default 'proposed' check (outcome in ('answered','question','cannot','proposed','applied','cancelled','undone','failed')),
  applied jsonb, model text, usage jsonb, ms int, created_at timestamptz not null default now());
alter table public.profiles add column if not exists mimo_met_at timestamptz;
create table if not exists public.product_aliases (
  id bigint generated always as identity primary key, location_id uuid not null references public.locations on delete cascade,
  product_id uuid not null references public.products on delete cascade, alias text not null, uses int not null default 1,
  created_by uuid, created_at timestamptz not null default now(), last_used timestamptz not null default now());
create unique index if not exists product_aliases_unique on public.product_aliases (location_id, lower(alias));
-- policies + learn_alias(): see the applied migrations.

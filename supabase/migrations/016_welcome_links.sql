-- Welcome links (Oct 2026). Auth's own set-password links die after an hour, too short to email to GMs across
-- time zones. A welcome link is a random code that stays valid for 7 days or until the person saves a password;
-- each open swaps it for a fresh one-hour Auth link behind the scenes (user-invite function, modes welcome/claim/done).
-- Only a hash of the code is stored, so the table alone can't be turned back into working links.
create table if not exists public.welcome_links (
  code_hash   text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  claims      int not null default 0,
  last_claimed_at timestamptz,
  used_at     timestamptz
);
create index if not exists welcome_links_user_idx on public.welcome_links (user_id);
alter table public.welcome_links enable row level security;
-- no policies on purpose: only the user-invite function (service role) reads or writes these

-- 016b: the Experience Database emails the link itself (Settings > People); this records when it went out
alter table public.welcome_links add column if not exists emailed_at timestamptz;

-- 016c: does this person have a password yet? (the welcome email says "sign in as usual" only if they do). Service role only.
create or replace function public.user_has_password(_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(u.encrypted_password, '') <> '' from auth.users u where u.id = _user
$$;
revoke all on function public.user_has_password(uuid) from public, anon, authenticated;
grant execute on function public.user_has_password(uuid) to service_role;

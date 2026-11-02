-- Staff email-code login (Nov 2026). Anyone with an @madmonkeyhostels.com address can sign up (choose a hostel) or sign in
-- with a 6-digit code emailed to them. Handled by the staff-login Edge Function (service role). Existing password logins are untouched.
-- Only a hash of the code is stored.
create table if not exists public.staff_login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  location_id uuid references public.locations(id) on delete set null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz
);
create index if not exists staff_login_codes_email_idx on public.staff_login_codes (email, created_at desc);
alter table public.staff_login_codes enable row level security;
-- no policies on purpose: only the staff-login function (service role) reads or writes these

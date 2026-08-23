-- 002 auth: profiles, roles, location scoping, RLS helpers
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users on delete cascade,
  role public.app_role not null,
  primary key (user_id, role)
);

create table public.user_locations (
  user_id uuid not null references auth.users on delete cascade,
  location_id uuid not null references public.locations on delete cascade,
  primary key (user_id, location_id)
);

create or replace function public.has_role(_user uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user and role = _role)
$$;

-- admin / head_office / sales see every location; a gm sees only their own
create or replace function public.can_access_location(_user uuid, _loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user and role in ('admin','head_office','sales'))
      or exists (select 1 from user_locations where user_id = _user and location_id = _loc)
$$;

create or replace function public.is_editor(_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user and role in ('admin','head_office','gm'))
$$;

-- auto-create a profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_locations enable row level security;

create policy "read own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or has_role(auth.uid(),'admin') or has_role(auth.uid(),'head_office'));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "read own roles or admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "admin manages roles" on public.user_roles for all to authenticated
  using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));
create policy "read own locations or admin" on public.user_locations for select to authenticated
  using (user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "admin manages user locations" on public.user_locations for all to authenticated
  using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));

alter table public.locations enable row level security;
alter table public.operators enable row level security;
alter table public.room_types enable row level security;
create policy "authenticated read locations" on public.locations for select to authenticated using (true);
create policy "authenticated read operators" on public.operators for select to authenticated using (true);
create policy "authenticated read room types" on public.room_types for select to authenticated using (true);
create policy "editors insert operators" on public.operators for insert to authenticated
  with check (is_editor(auth.uid()));
create policy "admin writes locations" on public.locations for all to authenticated
  using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));
create policy "admin writes room types" on public.room_types for all to authenticated
  using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));

-- 004 audit log (trigger-written, unbypassable) + Reden notification queue
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  location_id uuid,
  changed_fields text[] not null default '{}',
  old_values jsonb,
  new_values jsonb
);
create index audit_log_record on public.audit_log (table_name, record_id, changed_at desc);
create index audit_log_location on public.audit_log (location_id, changed_at desc);

alter table public.audit_log enable row level security;
create policy "read audit in scope" on public.audit_log for select to authenticated
  using (location_id is null or can_access_location(auth.uid(), location_id));
-- deliberately NO insert/update/delete policies: only the definer trigger writes

create or replace function public.log_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_fields text[]; v_loc uuid; v_id uuid; k text;
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key), '{}') into v_fields
    from jsonb_each(v_new) as n(key, value)
    where v_old->key is distinct from value and key not in ('updated_at','created_at');
    if v_fields = '{}' then return new; end if;
  end if;
  if tg_table_name = 'products' then
    v_loc := coalesce((v_new->>'location_id')::uuid, (v_old->>'location_id')::uuid);
    v_id  := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  elsif tg_table_name = 'transport_details' then
    v_id := coalesce((v_new->>'product_id')::uuid, (v_old->>'product_id')::uuid);
    select location_id into v_loc from products where id = v_id;
  end if;
  insert into audit_log (table_name, record_id, action, changed_by, location_id, changed_fields, old_values, new_values)
  values (tg_table_name, v_id, tg_op, auth.uid(), v_loc, coalesce(v_fields,'{}'),
          case when tg_op = 'UPDATE' then (select jsonb_object_agg(f, v_old->f) from unnest(v_fields) f) else v_old end,
          case when tg_op = 'UPDATE' then (select jsonb_object_agg(f, v_new->f) from unnest(v_fields) f) else v_new end);
  return coalesce(new, old);
end $$;

create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.log_changes();
create trigger transport_audit after insert or update or delete on public.transport_details
  for each row execute function public.log_changes();

-- ── Reden notifications ────────────────────────────────────────────────
create table public.notification_settings (
  id smallint primary key default 1 check (id = 1),
  mode text not null default 'daily_digest' check (mode in ('instant','daily_digest')),
  digest_hour_local int not null default 17 check (digest_hour_local between 0 and 23),
  recipients text[] not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.notification_events (
  id bigint generated always as identity primary key,
  product_id uuid,
  product_title text,
  location_id uuid,
  audit_id bigint references public.audit_log,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  dispatched_at timestamptz,
  digest_date date
);
create index notification_events_pending on public.notification_events (location_id, changed_at)
  where dispatched_at is null;

alter table public.notification_settings enable row level security;
alter table public.notification_events enable row level security;
create policy "authenticated read settings" on public.notification_settings for select to authenticated using (true);
create policy "admin updates settings" on public.notification_settings for update to authenticated
  using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));
create policy "staff read events" on public.notification_events for select to authenticated
  using (has_role(auth.uid(),'admin') or has_role(auth.uid(),'head_office'));

-- enqueue events for website-bookable products on the brief's trigger fields
create or replace function public.enqueue_reden_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  watched text[] := array['title','rate_usd','rate_raw','status','active_on_ground',
    'brief_description','long_description','inclusions','days_of_week',
    'availability_raw','starts_at','ends_at','bookable_on_website'];
  f text; v_old jsonb; v_new jsonb;
begin
  if not coalesce(new.bookable_on_website, false)
     and not coalesce(case when tg_op = 'UPDATE' then old.bookable_on_website end, false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into notification_events (product_id, product_title, location_id, field, old_value, new_value, changed_by)
    values (new.id, new.title, new.location_id, 'product_added', null, new.title, auth.uid());
    return new;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach f in array watched loop
    if v_old->f is distinct from v_new->f then
      insert into notification_events (product_id, product_title, location_id, field, old_value, new_value, changed_by)
      values (new.id, new.title, new.location_id, f, v_old->>f, v_new->>f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

create trigger products_reden after insert or update on public.products
  for each row execute function public.enqueue_reden_events();

insert into public.notification_settings (id) values (1);

-- 006 customers, quotes, working lines, frozen versions, agreement RPC
create sequence public.quote_ref_seq;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  contact_name text not null,
  email text,
  phone text,
  country text,
  source text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default 'MMQ-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.quote_ref_seq')::text, 4, '0'),
  customer_id uuid references public.customers,
  title text not null default 'Untitled trip',
  status public.quote_status not null default 'draft',
  owner_id uuid references auth.users,
  pax_count int not null default 1 check (pax_count > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger quotes_updated before update on public.quotes
  for each row execute function public.set_updated_at();

create table public.quote_days (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes on delete cascade,
  day_no int not null,
  date date,
  location_id uuid references public.locations,
  notes text,
  unique (quote_id, day_no)
);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes on delete cascade,
  day_id uuid references public.quote_days on delete set null,
  sort_order int not null default 0,
  kind text not null check (kind in ('accommodation','breakfast','experience','transport','custom')),
  source_product_id uuid references public.products on delete set null,  -- breadcrumb only
  title text not null,
  description text,
  starts_at time,
  ends_at time,
  duration_minutes int,
  room_type_id uuid references public.room_types,
  season public.season_tier,
  qty numeric(10,2) not null default 1,          -- nights for accommodation, units otherwise
  unit_price_usd numeric(10,2) not null default 0,
  per_person boolean not null default true,
  pax int,                                       -- overrides quote pax for this line
  discount_pct numeric(5,2),
  discount_amount_usd numeric(10,2),
  is_comp boolean not null default false,
  line_total_usd numeric(12,2) not null default 0,
  adjusted_by uuid,
  adjusted_at timestamptz,
  adjustment_note text,
  created_at timestamptz not null default now()
);
create index quote_lines_quote on public.quote_lines (quote_id, sort_order);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes on delete cascade,
  version_no int not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  rates_snapshot_at timestamptz not null default now(),
  pax_count int not null,
  customer jsonb,
  days jsonb not null default '[]'::jsonb,       -- frozen copy
  lines jsonb not null default '[]'::jsonb,      -- frozen copy: prices + copy
  subtotal_usd numeric(12,2) not null default 0,
  discount_total_usd numeric(12,2) not null default 0,
  total_usd numeric(12,2) not null default 0,
  per_person_usd numeric(12,2) not null default 0,
  breakdown jsonb not null default '{}'::jsonb,
  terms_block text,
  doc_url text,
  share_slug text not null unique default encode(gen_random_bytes(9), 'hex'),
  unique (quote_id, version_no)
);

alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_days enable row level security;
alter table public.quote_lines enable row level security;
alter table public.quote_versions enable row level security;

-- brief: anyone with tool access can build and send; discounts logged, no approval gate
create policy "authenticated customers" on public.customers for all to authenticated using (true) with check (true);
create policy "authenticated quotes" on public.quotes for all to authenticated using (true) with check (true);
create policy "authenticated quote days" on public.quote_days for all to authenticated using (true) with check (true);
create policy "authenticated quote lines" on public.quote_lines for all to authenticated using (true) with check (true);
create policy "authenticated read versions" on public.quote_versions for select to authenticated using (true);
create policy "authenticated mark sent" on public.quote_versions for update to authenticated using (true) with check (true);
-- version INSERT happens only through the RPC below

-- ── Freeze a version: the snapshot rule ────────────────────────────────
create or replace function public.generate_quote_version(p_quote_id uuid, p_terms text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_quote quotes%rowtype;
  v_no int; v_id uuid;
  v_days jsonb; v_lines jsonb; v_customer jsonb;
  v_sub numeric; v_disc numeric; v_total numeric;
  v_breakdown jsonb;
begin
  select * into v_quote from quotes where id = p_quote_id;
  if not found then raise exception 'quote not found'; end if;
  select coalesce(max(version_no), 0) + 1 into v_no from quote_versions where quote_id = p_quote_id;

  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('location_name', l.name) order by d.day_no), '[]')
    into v_days from quote_days d left join locations l on l.id = d.location_id
    where d.quote_id = p_quote_id;

  select coalesce(jsonb_agg(to_jsonb(ql) || jsonb_build_object('room_type_name', rt.name) order by ql.sort_order, ql.created_at), '[]')
    into v_lines from quote_lines ql left join room_types rt on rt.id = ql.room_type_id
    where ql.quote_id = p_quote_id;

  select to_jsonb(c) into v_customer from customers c where c.id = v_quote.customer_id;

  select coalesce(sum(case when is_comp then 0
              else greatest(0, unit_price_usd * qty * (case when per_person then coalesce(pax, v_quote.pax_count) else 1 end)
                   * (1 - coalesce(discount_pct,0)/100) - coalesce(discount_amount_usd,0)) end), 0),
         coalesce(sum(unit_price_usd * qty * (case when per_person then coalesce(pax, v_quote.pax_count) else 1 end)), 0)
    into v_total, v_sub
    from quote_lines where quote_id = p_quote_id;
  v_disc := v_sub - v_total;

  select coalesce(jsonb_object_agg(k, t), '{}') into v_breakdown from (
    select case kind when 'accommodation' then 'accommodation' when 'breakfast' then 'fnb'
                when 'transport' then 'transport' when 'experience' then 'experiences' else 'other' end k,
           sum(case when is_comp then 0
               else greatest(0, unit_price_usd * qty * (case when per_person then coalesce(pax, v_quote.pax_count) else 1 end)
                    * (1 - coalesce(discount_pct,0)/100) - coalesce(discount_amount_usd,0)) end) t
    from quote_lines where quote_id = p_quote_id group by 1) b;

  insert into quote_versions (quote_id, version_no, created_by, pax_count, customer, days, lines,
                              subtotal_usd, discount_total_usd, total_usd, per_person_usd, breakdown, terms_block)
  values (p_quote_id, v_no, auth.uid(), v_quote.pax_count, v_customer, v_days, v_lines,
          round(v_sub, 2), round(v_disc, 2), round(v_total, 2),
          round(v_total / greatest(v_quote.pax_count, 1), 2), v_breakdown, p_terms)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.generate_quote_version(uuid, text) to authenticated;

-- ── Public agreement page (anon, by unguessable slug) ──────────────────
create or replace function public.get_agreement(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) || jsonb_build_object(
           'quote_reference', q.reference, 'quote_title', q.title)
  from quote_versions v join quotes q on q.id = v.quote_id
  where v.share_slug = p_slug
$$;
grant execute on function public.get_agreement(text) to anon, authenticated;

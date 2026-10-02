-- 014 Final flow-chart sync (Oct 2026)
-- One queue for every difference between the flow chart and the tool, approved by head office.
-- Nothing changes on a product until a proposal is approved; approval re-checks the product first.

create table if not exists public.sheet_sync_proposals (
  id bigserial primary key,
  run_id uuid references public.import_runs on delete set null,
  location_id uuid not null references public.locations,
  product_id uuid references public.products on delete cascade,
  kind text not null check (kind in ('field', 'new', 'missing')),
  field text,
  label text not null,
  current jsonb,              -- the product's values when proposed (approval refuses if they have changed since)
  patch jsonb,                -- what approval writes; null when head office has to type the value (an unreadable price)
  payload jsonb,              -- kind 'new': { product, transport, date }
  current_text text,
  proposed_text text,
  sheet_text text,            -- the sheet cell(s) now
  previous_sheet_text text,   -- the same cell(s) in the copy the tool was built from
  basis text not null check (basis in ('sheet_changed', 'no_baseline', 'import_fix', 'section')),
  note text,
  source_sheet text,
  source_row int,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded', 'stale')),
  decided_by uuid references auth.users,
  decided_at timestamptz,
  applied_product_id uuid,
  outcome_note text,
  created_at timestamptz not null default now()
);
create index if not exists sheet_sync_proposals_status on public.sheet_sync_proposals (status, location_id);
alter table public.sheet_sync_proposals enable row level security;
drop policy if exists "head office reads sync proposals" on public.sheet_sync_proposals;
create policy "head office reads sync proposals" on public.sheet_sync_proposals for select to authenticated using (public.can_approve_times(auth.uid()));
drop policy if exists "admin inserts sync proposals" on public.sheet_sync_proposals;
create policy "admin inserts sync proposals" on public.sheet_sync_proposals for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));

-- the times queue gains 'superseded' (a newer run replaced the proposal) and an admin update policy for that
alter table public.product_time_proposals drop constraint if exists product_time_proposals_status_check;
alter table public.product_time_proposals add constraint product_time_proposals_status_check check (status in ('pending', 'approved', 'rejected', 'superseded'));
drop policy if exists "admin updates proposals" on public.product_time_proposals;
create policy "admin updates proposals" on public.product_time_proposals for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists "admin manages exceptions" on public.import_exceptions;
create policy "admin manages exceptions" on public.import_exceptions for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- private archive of the final workbook (the sheet itself is deleted after this run)
insert into storage.buckets (id, name, public) values ('flowchart-archive', 'flowchart-archive', false) on conflict (id) do nothing;
drop policy if exists "head office reads flowchart archive" on storage.objects;
create policy "head office reads flowchart archive" on storage.objects for select to authenticated using (bucket_id = 'flowchart-archive' and public.can_approve_times(auth.uid()));
drop policy if exists "admin writes flowchart archive" on storage.objects;
create policy "admin writes flowchart archive" on storage.objects for insert to authenticated with check (bucket_id = 'flowchart-archive' and public.has_role(auth.uid(), 'admin'));
drop policy if exists "admin updates flowchart archive" on storage.objects;
create policy "admin updates flowchart archive" on storage.objects for update to authenticated using (bucket_id = 'flowchart-archive' and public.has_role(auth.uid(), 'admin'));

-- approve / reject. p_overrides: { "<proposal id>": { "rate_usd": 12 } } for values typed in on the page.
create or replace function public.decide_sheet_proposals(p_ids bigint[], p_decision text, p_overrides jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  upd_cols text[] := array['title','category','rate_usd','local_amount','local_currency','rate_raw','fx_rate_used','fx_as_of','days_of_week',
    'availability_raw','expires_on','min_guests','max_guests_per_day','capacity_raw','brief_description','long_description','meeting_point',
    'inclusions','exclusions','things_to_bring','cancellation_policy','bookable_on_website','status','active_on_ground',
    'travel_insurance_required','photo_album_url','itinerary','duration_minutes'];
  new_cols text[] := upd_cols || array['location_id','source_sheet','source_row','remarks','starts_at','ends_at','gross_service_value'];
  pr record; v_patch jsonb; v_over jsonb; v_td jsonb; v_cur jsonb; v_prod jsonb; v_set text; v_cols text; v_rcols text;
  k text; v_new uuid; v_ccy text; v_fx numeric;
  n_ok int := 0; n_rej int := 0; n_stale int := 0; errs jsonb := '[]'::jsonb;
begin
  if not public.can_approve_times(auth.uid()) then raise exception 'Only head office can approve sheet changes'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected'; end if;
  <<props>>
  for pr in select * from public.sheet_sync_proposals where id = any(p_ids) and status = 'pending' order by id for update loop
    if p_decision = 'rejected' then
      update public.sheet_sync_proposals set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = pr.id;
      n_rej := n_rej + 1; continue props;
    end if;
    begin
      v_over := coalesce(p_overrides -> pr.id::text, '{}'::jsonb);
      if v_over ? 'rate_usd' then   -- a typed price: work out the local amount the same way the product page does
        select l.currency into v_ccy from public.locations l where l.id = pr.location_id;
        select coalesce(f.manual_override, f.units_per_usd) into v_fx from public.fx_rates f where f.code = v_ccy;
        v_over := v_over || jsonb_build_object('local_currency', v_ccy, 'fx_as_of', now(),
          'fx_rate_used', case when v_ccy = 'USD' then 1 else v_fx end,
          'local_amount', case when v_ccy = 'USD' or v_fx is null then null else round((v_over->>'rate_usd')::numeric * v_fx, 2) end);
      end if;
      if pr.kind in ('field', 'missing') then
        v_patch := coalesce(pr.patch, '{}'::jsonb) || v_over;
        v_td := v_patch -> 'transport_details'; v_patch := v_patch - 'transport_details';
        if v_patch = '{}'::jsonb and v_td is null then raise exception 'Nothing to apply: type the value first'; end if;
        select to_jsonb(p) into v_cur from public.products p where p.id = pr.product_id;
        if v_cur is null then raise exception 'The product no longer exists'; end if;
        for k in select jsonb_object_keys(coalesce(pr.current, '{}'::jsonb) - 'transport_details') loop
          if k = any(upd_cols) and (v_cur -> k) is distinct from (pr.current -> k) then
            update public.sheet_sync_proposals set status = 'stale', decided_by = auth.uid(), decided_at = now(),
              outcome_note = format('Not applied: %s was changed in the tool after this was proposed.', replace(k, '_', ' '))
            where id = pr.id;
            n_stale := n_stale + 1; continue props;
          end if;
        end loop;
        if v_patch <> '{}'::jsonb then
          select string_agg(format('%I = r.%I', key, key), ', ') into v_set from jsonb_object_keys(v_patch) key where key = any(upd_cols);
          if v_set is null then raise exception 'Nothing in this change can be applied'; end if;
          execute format('update public.products p set %s from jsonb_populate_record(null::public.products, $1) r where p.id = $2', v_set) using v_patch, pr.product_id;
        end if;
        if v_td is not null then
          insert into public.transport_details (product_id, pickup_point, dropoff_point, departure_times)
          values (pr.product_id, v_td->>'pickup_point', v_td->>'dropoff_point',
                  (select array_agg(x::time) from jsonb_array_elements_text(coalesce(v_td->'departure_times', '[]'::jsonb)) x))
          on conflict (product_id) do update set pickup_point = excluded.pickup_point, dropoff_point = excluded.dropoff_point, departure_times = excluded.departure_times;
        end if;
        update public.sheet_sync_proposals set status = 'approved', decided_by = auth.uid(), decided_at = now(), applied_product_id = pr.product_id where id = pr.id;
      else   -- new
        v_prod := (pr.payload -> 'product') || v_over;
        if exists (select 1 from public.products p where p.location_id = (v_prod->>'location_id')::uuid
                   and lower(regexp_replace(p.title, '\s+', ' ', 'g')) = lower(regexp_replace(v_prod->>'title', '\s+', ' ', 'g'))) then
          update public.sheet_sync_proposals set status = 'stale', decided_by = auth.uid(), decided_at = now(),
            outcome_note = 'Not added: an experience with this name is already in the tool at this hostel.' where id = pr.id;
          n_stale := n_stale + 1; continue props;
        end if;
        if exists (select 1 from public.products p where p.source_sheet = v_prod->>'source_sheet' and p.source_row = (v_prod->>'source_row')::int) then
          v_prod := v_prod - 'source_row';   -- the row number is taken by a product that moved; keep the sheet name only
        end if;
        select string_agg(quote_ident(key), ', '), string_agg('r.' || quote_ident(key), ', ') into v_cols, v_rcols
          from jsonb_object_keys(v_prod) key where key = any(new_cols);
        execute format('insert into public.products (%s) select %s from jsonb_populate_record(null::public.products, $1) r returning id', v_cols, v_rcols)
          into v_new using v_prod;
        if jsonb_typeof(pr.payload -> 'transport') = 'object' then
          insert into public.transport_details (product_id, vehicle_type, route_raw, pickup_point, dropoff_point, departure_times)
          values (v_new, pr.payload->'transport'->>'vehicle_type', pr.payload->'transport'->>'route_raw', pr.payload->'transport'->>'pickup_point',
                  pr.payload->'transport'->>'dropoff_point',
                  (select array_agg(x::time) from jsonb_array_elements_text(coalesce(pr.payload->'transport'->'departure_times', '[]'::jsonb)) x))
          on conflict (product_id) do nothing;
        end if;
        if coalesce(pr.payload->>'date', '') <> '' then
          insert into public.product_date_rules (product_id, kind, starts_on, note)
          values (v_new, 'available', (pr.payload->>'date')::date, 'one-time event date from the flow chart (final sync)');
        end if;
        update public.sheet_sync_proposals set status = 'approved', decided_by = auth.uid(), decided_at = now(), applied_product_id = v_new where id = pr.id;
      end if;
      n_ok := n_ok + 1;
    exception when others then
      errs := errs || jsonb_build_object('id', pr.id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('approved', n_ok, 'rejected', n_rej, 'stale', n_stale, 'errors', errs);
end $$;
revoke all on function public.decide_sheet_proposals(bigint[], text, jsonb) from public, anon;
grant execute on function public.decide_sheet_proposals(bigint[], text, jsonb) to authenticated;

-- a re-run marks whatever is still pending as superseded (applied separately as 014b)
drop policy if exists "admin updates sync proposals" on public.sheet_sync_proposals;
create policy "admin updates sync proposals" on public.sheet_sync_proposals for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

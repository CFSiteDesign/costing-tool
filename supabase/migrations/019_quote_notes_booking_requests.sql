-- Quote feedback 16 Oct 2026 (Hayley): customer-facing notes, booking requests for Reservations, payment reminders.

-- 1. Notes. Typed by people, never AI-filled. Shown on the client quote only when filled in.
--    quote_days.notes already exists (daily notes). Versions freeze them: days and lines are snapshotted whole.
alter table public.quotes add column if not exists booking_notes text;           -- top of the quote
alter table public.quote_lines add column if not exists notes text;              -- under one stay / experience / item
alter table public.quote_versions add column if not exists booking_notes text;
alter table public.quote_versions add column if not exists quote_discount_pct numeric;
alter table public.quote_versions add column if not exists quote_discount_amount_usd numeric;

-- accepted quote -> which frozen version was accepted (the booking request is built from that version)
-- no foreign key on purpose: a second quotes<->quote_versions link makes PostgREST embeds like quotes?select=quote_versions(...)
-- ambiguous (PGRST201), which emptied the Quotes list on 19 Oct until it was dropped (019b)
alter table public.quotes add column if not exists accepted_version_id uuid;

create or replace function public.generate_quote_version(p_quote_id uuid, p_terms text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_quote quotes%rowtype;
  v_no int; v_id uuid;
  v_days jsonb; v_lines jsonb; v_customer jsonb;
  v_sub numeric; v_after numeric; v_final numeric;
  v_breakdown jsonb;
begin
  if not can_quote(auth.uid()) then raise exception 'quotes are not available for this role'; end if;
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
    into v_after, v_sub
    from quote_lines where quote_id = p_quote_id;

  v_final := greatest(0, v_after * (1 - coalesce(v_quote.discount_pct, 0)/100) - coalesce(v_quote.discount_amount_usd, 0));

  select coalesce(jsonb_object_agg(k, t), '{}') into v_breakdown from (
    select case kind when 'accommodation' then 'accommodation' when 'breakfast' then 'fnb'
                when 'transport' then 'transport' when 'experience' then 'experiences' else 'other' end k,
           sum(case when is_comp then 0
               else greatest(0, unit_price_usd * qty * (case when per_person then coalesce(pax, v_quote.pax_count) else 1 end)
                    * (1 - coalesce(discount_pct,0)/100) - coalesce(discount_amount_usd,0)) end) t
    from quote_lines where quote_id = p_quote_id group by 1) b;

  insert into quote_versions (quote_id, version_no, created_by, pax_count, customer, days, lines,
                              subtotal_usd, discount_total_usd, total_usd, per_person_usd, breakdown, terms_block,
                              booking_notes, quote_discount_pct, quote_discount_amount_usd)
  values (p_quote_id, v_no, auth.uid(), v_quote.pax_count, v_customer, v_days, v_lines,
          round(v_sub, 2), round(v_sub - v_final, 2), round(v_final, 2),
          round(v_final / greatest(v_quote.pax_count, 1), 2), v_breakdown, p_terms,
          nullif(btrim(coalesce(v_quote.booking_notes, '')), ''), v_quote.discount_pct, v_quote.discount_amount_usd)
  returning id into v_id;
  return v_id;
end $function$;

-- 2. Booking requests: the internal document for Reservations, built from the accepted version. One per quote;
--    everything in `details` is editable before it is downloaded.
create table if not exists public.booking_requests (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null unique references public.quotes(id) on delete cascade,
  version_id       uuid references public.quote_versions(id) on delete set null,
  reference        text not null,
  details          jsonb not null default '{}'::jsonb,
  payment_deadline date,
  total_usd        numeric,
  contact_name     text,             -- the Mad Monkey contact, gets the payment reminder
  contact_email    text,
  paid_at          timestamptz,
  reminder_sent_at timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.booking_requests enable row level security;
drop policy if exists "quoting roles manage booking requests" on public.booking_requests;
create policy "quoting roles manage booking requests" on public.booking_requests
  for all using (public.can_quote(auth.uid())) with check (public.can_quote(auth.uid()));

-- 3. Payment reminders: once a day the booking-reminders function emails the Mad Monkey contact 7 days before the
--    deadline, only while the booking is not marked paid, and only once.
select cron.unschedule('booking-reminders-daily') where exists (select 1 from cron.job where jobname = 'booking-reminders-daily');
select cron.schedule('booking-reminders-daily', '0 1 * * *', $cron$
  select net.http_post(
    url := 'https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/booking-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2ZnR5ZXh4cXl5a3Bwem1yanhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTgyNzAsImV4cCI6MjEwMzA3NDI3MH0.jmXCijjRJU3I6xtylc4mlFEWlGFhtyeUIiYT799zeQc'),
    body := '{}'::jsonb);
$cron$);

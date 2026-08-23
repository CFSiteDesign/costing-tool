# Data model — draft v1

Postgres (Supabase). Every table has `created_at`; mutable tables have `updated_at`.
All money is `numeric(10,2)` and **USD only** — column names carry `_usd` so nothing
can be silently mistaken for local currency later.

---

## 1. Reference

```
locations            id, name, country, timezone, is_active
operators            id, name, is_mad_monkey, contact_email, contact_phone, notes
room_types           id, code, name, sort_order
```

`locations.timezone` matters more than it looks: product start/finish times, the
"what runs on a Monday" filter, and the per-location daily digest all resolve in
local time across 5+ countries. Adding it later is a migration; adding it now is free.

## 2. Identity & access

```
profiles             id → auth.users, full_name, email, is_active
user_roles           user_id, role          -- enum: admin | head_office | gm | sales
user_locations       user_id, location_id   -- GM scoping; supports multi-site GMs
```

Roles live in their **own table**, never as a column on `profiles` and never in a
JWT claim the client can influence — otherwise a user can escalate themselves.
RLS calls a `SECURITY DEFINER` helper:

```sql
create function public.has_role(_user uuid, _role app_role) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from user_roles where user_id = _user and role = _role) $$;

create function public.can_access_location(_user uuid, _loc uuid) returns boolean ...
  -- true for admin/head_office/sales; for gm, true only if row exists in user_locations
```

`SECURITY DEFINER` is what stops the policy recursing into a table that is itself
RLS-protected.

## 3. Experience Database

> **Amended after `SOURCE_DATA_AUDIT.md`.** Three changes from draft v1: a fifth
> category, a route model for transport, and `rate_raw` beside `rate_usd`.

```sql
create type product_category as enum
  ('mm_tour','nightly_event','third_party_tour','one_time_event','transport');
  -- one_time_event is NOT in the brief but is the largest category in the
  -- source data (470 of 1,297 rows). Date-anchored, so days_of_week is empty
  -- for these and product_date_rules carries the dates.
create type product_status as enum
  ('active','paused','signature','pending_update');

create table products (
  id                        uuid primary key default gen_random_uuid(),
  location_id               uuid not null references locations,
  category                  product_category not null,
  title                     text not null,
  operator_id               uuid references operators,

  rate_usd                  numeric(10,2),   -- parsed; NULL where unparseable
  rate_raw                  text,             -- verbatim source cell, always kept
  gross_service_value_usd   numeric(10,2),
  commission_basis          text,

  active_on_ground          boolean not null default true,
  bookable_on_website       boolean not null default false,
  status                    product_status not null default 'active',

  -- ISO-8601 weekday numbers: 1 = Mon … 7 = Sun
  days_of_week              smallint[] not null default '{}',
  starts_at                 time,
  ends_at                   time,
  duration_minutes          integer,
  min_guests                integer,
  max_guests_per_day        integer,

  brief_description         text  check (char_length(brief_description) <= 95),
  long_description          text,
  meeting_point             text,
  meeting_time              time,
  inclusions                text[] not null default '{}',
  exclusions                text[] not null default '{}',
  things_to_bring           text[] not null default '{}',
  cancellation_policy       text,
  travel_insurance_required boolean not null default false,
  photo_album_url           text,
  remarks                   text,

  rezdy_reference           text,
  external_refs             jsonb not null default '{}',   -- room for Rezdy/other later

  constraint days_of_week_valid
    check (days_of_week <@ array[1,2,3,4,5,6,7]::smallint[])
);

create index on products using gin (days_of_week);
create index on products (location_id, category, status);
```

**Why `rate_raw` exists.** Only 22% of source rates are numeric. The rest is prose —
`$25 pre sale $30 on the day`, `Free Flow … Khmer New Year Walking Tour $15`. Dropping
those rows blocks the migration; guessing a number puts a wrong price in front of a
client. So `rate_raw` always holds the original, `rate_usd` is populated only where
parsing is unambiguous, and a NULL `rate_usd` on an active product is an exception the
GM must resolve before it can be added to a quote.

```
product_date_rules       id, product_id, kind (available|blackout), starts_on, ends_on, note
product_itinerary_items  id, product_id, sort_order, at_time, label, detail
product_photos           id, product_id, url, sort_order, caption
```

**Why `days_of_week` is an array, not text.** The brief's own acceptance test is
*"they're in Siem Reap on a Monday, what runs?"*. With a GIN index that is:

```sql
select * from products
where location_id = $1 and days_of_week @> array[1]::smallint[]
  and status <> 'paused' and active_on_ground;
```

The 95-character limit is enforced by a `CHECK` **and** a live counter in the UI —
the DB constraint is what guarantees it survives the import and the API.

`product_photos` as rows (rather than one link field) is what makes "minimum 6
images" checkable — but the rule can only apply to new and edited products. In the
source, 71% of photo cells are blank and only 3.9% are real URLs; the rest are labels
like `POOL PARTY`. Enforcing six images at import would invalidate ~1,200 rows on day
one. See Q5.

### Transport is route-shaped, not title-shaped

```
transport_routes   id, product_id, vehicle_type, provider_id,
                   origin, destination, pickup_point, dropoff_point,
                   departure_times time[], duration_minutes
```

In the source, 33 Phnom Penh rows are all titled `Van` and differ only by a route
string (`Kim Seng - Phnom Penh to Kampot`). Keying transport on title collapses them
into one product. The route fields are what make them distinct — and what lets the
costing tool answer "how do we get them from Siem Reap to Bangkok".

Transport also carries a rule from the sheet banner that the brief omits: *not to be
uploaded to the website, Rezdy only*. Pending Q12, that maps to
`bookable_on_website = false`.

## 4. Change log

```
audit_log   id, table_name, record_id, action, changed_by, changed_at,
            location_id, changed_fields text[], old_values jsonb, new_values jsonb
```

Written by a **trigger**, not by application code — with no approval gate, the log
is the only safety net, so it must be impossible to bypass. `changed_fields` is
computed by diffing `to_jsonb(OLD)` against `to_jsonb(NEW)` so the UI can render
"Rate: $45 → $52" without parsing whole rows. Client-side `INSERT` on this table
has no RLS policy at all; only the definer trigger writes.

## 5. Reden notifications

```
notification_settings  mode (instant|daily_digest), digest_send_hour_local,
                       recipients text[], enabled
notification_events    id, audit_log_id, product_id, location_id, field,
                       old_value, new_value, changed_by, changed_at,
                       digest_id, dispatched_at
notification_digests   id, location_id, digest_date, status, event_count,
                       sent_at, error
```

Mode is **configuration, not code** — Reden's preference (Q3) is still open, so the
build supports both and the answer becomes a settings toggle rather than a rewrite.
Events are only enqueued where `products.bookable_on_website = true`, and only for
the trigger fields the brief lists (create, rate, status, description/inclusions,
availability).

## 6. Rates (Phase 2, synced from Sheets)

```
rate_sync_runs       id, source, triggered_by, started_at, finished_at,
                     status (running|success|failed|partial),
                     rows_read, rows_imported, rows_rejected, error
rate_sync_issues     id, sync_run_id, sheet_row, raw jsonb, reason
accommodation_rates  id, location_id, room_type_id, season_tier, rate_usd,
                     valid_from, valid_to, sync_run_id
breakfast_rates      id, location_id, rate_usd_pp, valid_from, valid_to, sync_run_id
```

Ingest is staged: read → validate → write to staging → promote in one transaction.
A malformed sheet therefore leaves the previous good rates in place rather than
half-replacing them. Rejected rows land in `rate_sync_issues` and never in
`accommodation_rates`.

## 7. Costing & agreements (Phase 2 / 3)

```
customers            id, company_name, contact_name, email, phone, country, source, notes
quotes               id, customer_id, reference, title, status, owner_id, pax_count
quote_versions       id, quote_id, version_no, created_by, sent_at,
                     rates_snapshot_at, pax_count,
                     subtotal_usd, discount_total_usd, total_usd, per_person_usd,
                     terms_block, doc_url, share_slug, share_expires_at
quote_version_days   id, version_id, day_no, date, location_id, notes
quote_version_lines  id, version_id, day_id, sort_order, kind,
                     source_product_id  → products (nullable, ON DELETE SET NULL),
                     title, description, starts_at, ends_at, duration_minutes,
                     room_type_id, season_tier,
                     qty, unit_price_usd, line_total_usd,
                     discount_pct, discount_amount_usd, is_comp,
                     adjusted_by, adjusted_at, adjustment_note
```

### The snapshot rule

`quote_version_lines` stores a **frozen copy** of every price and every piece of
copy. `source_product_id` is a breadcrumb for reporting only — it is nullable and
`ON DELETE SET NULL`, and **nothing in the render path ever joins through it**.

This is the mechanism behind the brief's one non-negotiable: a quote sent Monday
cannot re-price when a GM edits a tour on Tuesday. The failure mode it prevents is
silent, and it is only prevented if the denormalisation is there from the first
commit — retrofitting it means every quote written before the fix is already wrong.
`rates_snapshot_at` records which sync run the frozen prices came from.

Discounts and comps are line-level fields carrying `adjusted_by` — the brief allows
anyone to discount without approval, so attribution is the control.

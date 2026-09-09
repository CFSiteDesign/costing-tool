# Experience Database + Costing Tool — Implementation Plan

Against `docs/BRIEF.md` (Kyle Kenny, v2, 17 Aug 2026).

| Doc | What it covers |
| --- | --- |
| `docs/BRIEF.md` | The brief, verbatim |
| `docs/SOURCE_DATA_AUDIT.md` | **What the real flow chart contains — read this first** |
| `docs/SCHEMA.md` | Data model |
| `docs/UI_SPEC.md` | Screens, colour, navigation |
| `docs/APPS_SCRIPT_PLAN.md` | The one live Sheets connection |
| `tools/extract_flowchart.py` | Working migration prototype |

**Status (23 Aug 2026): BUILT.** Supabase project `mm-experience-db`
(`avftyexxqyykppzmrjxn`, ap-southeast-1) is live with the full schema, RLS, audit +
Reden triggers, and all 1,206 products imported (769 exceptions queued in-app). The app
(steps 1–13, 15*, 17*–21) runs against it; the pricing engine has a 15-test suite.
Remaining: Apps Script rate sync (steps 15–17 run on sample rates until the 2027 RATE
OFFER TA sheet is shared), Google Docs export (step 22, waits on Danny), flow-chart
freeze at cutover (step 14), Vercel project creation (dashboard step), Resend key for
live digest emails, Supabase Pro upgrade. A passwordless `test` demo login exists —
remove before real go-live.

---

## 1. Stack — answering open item #1

| Layer | Pick | Why |
| --- | --- | --- |
| Frontend | Vite + React 18 + TS + Tailwind + shadcn/ui | Already scaffolded; stays Lovable-editable so the project isn't locked to one person |
| Backend | **Supabase** — Postgres, Auth, RLS, Edge Functions, Storage, pg_cron | Three requirements are database problems, not app problems |
| Hosting | **Vercel** | Preview deploy per PR |
| Email | **Resend** | Reden digests, sync-failure alerts |
| Sheets | **Apps Script** push → Edge Function | Avoids needing Workspace admin — see `docs/APPS_SCRIPT_PLAN.md` §2 |

**Why Supabase specifically:**

- *"See your own location's products only"* → RLS. Enforced at the database, so a missed
  `where` clause in one screen can't leak another location's pricing.
- *"Full change log … our safety net given there's no approval step"* → triggers.
  Application-level logging is bypassable; a trigger is not.
- *"Nightly scheduled sync"* + *"failure alerts"* → pg_cron and Edge Functions, with run
  history in the same database being quoted from.

**Region `ap-southeast-1` (Singapore)** — every user is in SE Asia.

**Pro tier, not free.** Free projects auto-pause on inactivity — the exact failure that
has already bitten the giveaway sites. Here it means GMs can't update prices and sales
can't send quotes. It also buys daily backups, which the sole source of truth for pricing
needs.

## 2. Sequential or parallel — answering open item #2

```
Phase 1a  Schema + migration + auth/RLS        ── blocks everything
              ↓
Phase 1b  GM UI + change log + Reden digest    ─┐
Phase 2   Costing tool + rate sync             ─┴─ parallel
              ↓
Phase 3   Version history, dashboard, handoff
```

Phase 2 depends on the *shape* of the database, not on the GM UI being finished. Holding
it until the GM UI is polished costs weeks and buys nothing. The one hard constraint:
**1a must be done and the data migrated before Phase 2 starts**, or the costing tool gets
built against a guess.

Kyle's call, but that is the recommendation.

## 3. What the source data changes

`docs/SOURCE_DATA_AUDIT.md` in full. The five findings that move the plan:

1. **1,297 products across 23 locations** — the real number.
2. **Five categories, not four.** `ONE TIME EVENTS` (470 rows) is the largest and isn't
   in the brief. Date-anchored, not weekly.
3. **Transport uses a different column schema on the same sheet** and is route-shaped —
   33 Phnom Penh rows all titled `Van`, distinguished only by a route string.
4. **Status is cell fill colour**, invisible to CSV and to the Sheets API.
5. **Rate is 22% numeric.** 58% is prose. Photos are 71% blank and only 3.9% real URLs.

Consequence: **migration is a workstream, not a task**, and the exceptions queue is a
primary GM-facing screen rather than a by-product.

---

## 4. Step-by-step build

### Phase 1a — Foundations

**Step 1 · Project setup.** Supabase project in `ap-southeast-1`, Pro. Local CLI, env
wiring, `supabase/migrations/` committed. Vercel project, preview deploys on.

**Step 2 · Reference data.** Enums, `locations` seeded with all 23 tabs incl. country and
**timezone**, `operators` extracted from the sheet's `BY` / `Service Provider` columns,
`room_types`. Resolve Q10 (Cebu City) and Q14 (is 23 the true list?) here.

**Step 3 · Core schema.** `products` + children per `docs/SCHEMA.md`, with the audit's
amendments applied:
- fifth category `one_time_event`
- `transport_routes` — `origin`, `destination`, `vehicle_type`, `provider_id`,
  `pickup_point`, `dropoff_point`
- `rate_raw text` alongside `rate_usd numeric`, so the 58% that doesn't parse still imports
- 95-char `CHECK` on `brief_description`, GIN index on `days_of_week`

**Step 4 · Auth and RLS.** `profiles`, `user_roles`, `user_locations`, the
`has_role` / `can_access_location` definer helpers, policies on every table. Test with
three real accounts — a GM, head office, an admin — before writing any UI.

**Step 5 · Audit trigger.** `to_jsonb(OLD)` vs `to_jsonb(NEW)` diff into `audit_log`. No
client insert policy; only the definer trigger writes.

**Step 6 · Migration.** The big one.
- Harden `tools/extract_flowchart.py`: two parsers (tour schema, transport schema),
  colour→status mapping, `NEED TO KNOW` splitter for meeting point / inclusions /
  things-to-bring, min/max splitter, day-of-week normaliser.
- The normaliser **never guesses.** `Mon/Wed/Fri`, `Daily`, `Every day*`, `Tue & Thu` map
  cleanly; anything below confidence becomes an exception. A wrong availability silently
  quotes a tour that doesn't run that day.
- `import_runs` + `import_exceptions`. Every row lands imported **or** flagged.
- Re-runnable, idempotent on (location, category, title, row).
- Resolve Q11 — recommend migrating only forward-dated one-time events.

**Done when:** every one of the 1,297 rows is in `products` or in `import_exceptions` with
a reason, and counts reconcile per location against the workbook.

### Phase 1b — GM front-end

**Step 7 · App shell.** Sidebar, four nav items, location switcher, auth guard, the token
set from `docs/UI_SPEC.md` §2 replacing the default shadcn palette.

**Step 8 · Product table.** Server-side pagination and filtering (50/page — 1,300 rows
over hostel wifi). Category / status / **day-of-week 7-segment** / search filters. Frozen
title column.

**Step 9 · Inline editing.** Click to edit, optimistic write, flash on success, revert and
toast on failure. The >40% rate-change confirm. This step *is* the "faster than the sheet"
promise — if it isn't quick, nothing else matters.

**Step 10 · Add-product form + pause toggle.** Required fields enforced, category and
location pre-filled from context. Pause rather than delete; paused rows drop out of Phase 2.

**Step 11 · Exceptions queue.** `/settings/imports`, filtered per location, progress bar.
Several hundred rows get fixed here — treat it as a real screen, not an admin table.

**Step 12 · Change log UI.** `/activity`, `field: old → new`, filter by product, person, date.

**Step 13 · Reden notifier.** Trigger → `notification_events` → Edge Function on pg_cron →
Resend. **Mode is a settings toggle** (instant vs per-location daily digest), so open item
#3 becomes configuration rather than a rewrite. Only where `bookable_on_website = true`.

**Step 14 · Cutover.** Freeze the flow chart (`docs/APPS_SCRIPT_PLAN.md` §7), banner
pointing at the new tool, GM walkthrough.

**Done when:** a GM adds a product and changes a price without training, and Reden's email
lands in the format he asked for.

### Phase 2 — Costing tool

**Step 15 · Rate projection tabs** with Hayley. ~1 hour of her time, blocks step 16.

**Step 16 · Apps Script + `rate-sync` Edge Function.** Validation, HMAC, staging, sanity
gate, transactional promotion. Per `docs/APPS_SCRIPT_PLAN.md`.

**Step 17 · Staleness monitor.** Nightly heartbeat, 36-hour alert, persistent
last-synced timestamp, amber banner. The brief's stated worst case is a *silent* failure —
absence of a heartbeat has to be the alarm.

**Step 18 · Pricing engine.** Pure functions, zero DB access, unit-tested. Per person,
group total, per-room-type breakdown, internal split by product line. A rounding error
here becomes a real invoice, so this gets the test suite.

**Step 19 · Build screen.** Location → room type → season tier pulls the rate; breakfast
per night; experiences filtered by location + day with an explicit override; transport;
custom lines; pax drives everything; edit / discount / comp with attribution.

**Step 20 · Snapshotting.** Generating a version writes frozen copies of every line and
every piece of copy. `docs/SCHEMA.md` §7. **This has to be right in the first commit** —
retrofitting means every quote written before the fix is already wrong.

**Step 21 · Outputs.** Internal costing view, then the client agreement page at `/a/:slug`
rendered from the snapshot.

**Step 22 · Google Docs export** — *only once Danny confirms* (open item #5). An adapter
behind the same interface, so Phase 2 never sits blocked in a permissions queue. The
brief's own wording — "with a shareable web link option" — means the web version satisfies
the requirement on its own.

### Phase 3

Version history, tracking dashboard (customer / product / value / version, filterable by
country and month), approved-document handoff. Schema already carries `version_no` and
`sent_at`, so this is UI over data Phase 2 has been collecting. Invoicing stays with Adele.

---

## 5. Risks

**1. Migration is the schedule risk, not the build.** 1,297 rows, two schemas, colour-coded
status, ~60% of rates unparseable. The code is a week; the human cleanup is longer and
needs GM time booked in advance.

**2. Photos can't be enforced retrospectively.** 96% of the catalogue has no usable link.
Apply the six-image rule to new and edited products only, or Phase 1 ends with 1,200
permanently invalid rows.

**3. Apps Script web app deployment may be blocked by Workspace policy.** Main risk to the
sync design. Fallback is a service-account pull against the same projection tabs and the
same Edge Function — `docs/APPS_SCRIPT_PLAN.md` §6.

**4. GMs keep using the sheet.** Freeze it at cutover (step 14). Two sources of truth is
worse than the sheet alone.

**5. "No approval gate" + immediate live changes.** The snapshot protects sent quotes, but
a fat-fingered `$450` for `$45` quotes wrong all day. Mitigated by the >40% inline confirm
and flagging the change in Reden's digest. No gate, no extra click on genuine edits.

---

## 6. Questions

**Blocking:**

- **Q1 → Kyle/Hayley.** Access to *2027 RATE OFFER TA*. The flow chart is now in hand, but the rate sheet is still unseen and Phase 2 can't be specified without it.
- **Q2 → Kyle.** Sequential, or the parallel split in §2.

**Before the relevant phase:**

- **Q3 → Reden.** Instant, or one digest per location per day? Built either way.
- **Q4 → Hayley.** Are lean/mid/high fixed date ranges per location, or judgement per booking? Decides whether we need a season calendar.
- **Q5 → Kyle.** Photo minimum — new/edited products only? (See risk 2.)
- **Q6 → Kyle.** Customer record minimum fields. Proposed: company/agent, contact, email, phone, country, source.
- **Q7 → Danny.** Google Docs API + template ownership.
- **Q8 → Kyle.** Rezdy — eventual direct feed or permanently manual? Doesn't block Phase 1.
- **Q9 → Kyle.** ~~Product count~~ — answered: **1,297**.
- **Q10 → Kyle.** `Cebu City` is hidden with no live tab. Closed?
- **Q11 → Kyle.** One-time events — migrate all 470, or forward-dated only? Recommend forward-dated.
- **Q12 → Kyle.** Transport is *"Rezdy only, not website"*. Does that become `bookable_on_website = false`, or a rule of its own?
- **Q13 → Hayley/GMs.** 71 duplicate titles with conflicting rates need per-location owners.
- **Q14 → Kyle.** Confirm 23 is the true location list — the brief says "24+".

---

## Round 2 — client updates doc (received 27 Aug 2026) — **BUILT 3 Sep 2026, all groups live**

Source: `docs/UPDATES_ROUND2.md`. Context that shaped the plan: the client (Reight Travel) has
already built 9 real quotes of 10–14 days, one stay per day — the doc is driven by that
experience, so the quote-builder items come first.

### A. Quote builder mechanics (no decisions needed) — ~1 day
| # | Item | Approach |
|---|---|---|
| 1 | Day = night, no nights field | Drop `qty` from stay UI (fix qty=1), max one stay per day, amber "no stay" warning on middle days. Existing multi-night rows (test data only) split into days. |
| 2 | Copy stay + breakfast to next day | Button per day; creates next day if missing (date+1, same location). Copies **only** accommodation + breakfast lines. |
| 3 | Day date sets picker weekday | Picker defaults to `weekday(day.date)`, still changeable. |
| 4 | New day inherits date+1 and location | `addDay` seeds from the last day. |
| 5 | Transport time slots | `transport_details.departure_times time[]`, parsed once from `availability_raw` on migration; editable per product; builder picks a slot. |
| 6 | Save & exit | Quotes already persist every keystroke as `draft`; add an explicit "Save & exit" button so people trust it. |
| 7 | Quote search | Reference / title / customer. |
| — | Pax vs capacity warning | Uses existing `min_guests` / `max_guests_per_day`; badge on the line + banner. Never blocks. |

### B. Currency — ~½ day + decision D1
`products.local_amount`, `local_currency`, `fx_rate_used`, `fx_as_of`; `rate_usd` stays the quoted
figure. Per-location currency map (THB, PHP, IDR, VND, USD for Cambodia; Laos priced in USD per
the rate sheet). Experience list shows `฿1,200 · $34.12`. All quotes/outputs untouched (USD).
GM enters either; the other is derived and both are stored so a price is traceable.

### C. Auto-create trip + copy — ~1 day + decision D2
Wizard: ordered stops (location, first night, nights) → generates days + one stay per night
(room type chosen once, season auto-picked from the rate sheet's month tables — Q4 finally
used) → each day shows that weekday's experiences, ordered by start time, as a tick-list.
Then the copy question (D2).

### D. Global events — ~½ day
`global_events` + `global_event_responses(location_id, status)`. Accept = a product is created
at that location; GM dashboard shows pending events; admin sees accepted / declined / no reply.

### E. GM interface — ~1 day
"My week" tab (day → rows sorted by start time; daily tours under every day; one-offs by date),
editable product detail page with explicit Save + confirmation (replaces autosave in the
drawer), Add-product back button with unsaved-changes warning, one-time-event checkbox +
expiry (expired products hidden from My week and Activity), Active/Paused at creation,
"last verified" column + a Mark-verified button.

### F. STUDIO asset link — ~1 day across two repos + decision D3
Costing tool side: ASSET column → deep link `studio?...` with tour name, day, key time, price,
short description, plus `source=costing&product=<id>`; `product_assets` table; "View / Rebuild";
stale flag when name/day/time/price change. STUDIO side (`~/mad-monkey-studio`, Next.js +
Convex): read the params and prefill the brief; after a render completes, POST the file URL
to a new `asset-callback` Edge Function (shared secret). STUDIO deploy is two steps and one is
interactive (`npx convex deploy`).

### Decisions needed
- **D1 FX source.** Recommend daily auto-refresh from a free FX API (covers THB/PHP/IDR/VND/KHR/LAK)
  with an admin override table and "rates as of" shown in the UI. Alternative: derive from the
  local/USD pairs in Hayley's rate sheet (needs the Apps Script re-pasted).
- **D2 Copy trip vs template.** Recommend "Duplicate quote" — covers both (keep any quote as a
  template and duplicate it).
- **D3 STUDIO write-back.** Automatic post-back needs STUDIO changes deployed. Recommend building
  the deep link + manual "attach asset" first, automatic post-back second.
- **D4 Order.** Recommend A → B → E → C → D → F.

### Round 2 outcome (3 Sep 2026)
All six groups shipped, both repos. Decisions taken as recommended: D1 FX from
open.er-api.com daily + admin override; D2 "Duplicate quote" covers copy-trip and template;
D3 STUDIO deep link + automatic post-back both built (STUDIO commit + `npx convex deploy -y`,
`MM_ASSET_SECRET` set on prod exuberant-anaconda-353); D4 order A→B→E→C→D→F.
One addition to the client's five deep-link fields: the hostel name, because STUDIO's event
form can't generate without a location. Verified end-to-end: signed post-back attaches the
asset, forged signature rejected, price edit marks it out of date.
Not done: walkthrough PDF refresh (still describes the autosave drawer and predates My week,
currency, auto-trip) — regenerate before the next GM rollout.

## Phase 2 — client updates doc (received 8 Sep 2026) — **BUILT 8 Sep 2026**

Source: `docs/UPDATES_PHASE2.md` (verbatim) plus one verbal item: hide quotes from GMs.

| Area | Item | What was built |
|---|---|---|
| Auto-trip | Ordered by time; block two things at the same time; end time shown | Tick-list already time-sorted; each row now shows start–finish (finish worked out from duration when not set). Ticking one greys out anything whose window overlaps, with "clashes with X" and a tooltip. Same block in the quote-builder experience picker ("Show everything" overrides). Shared logic in `src/lib/clash.ts`. Lines are inserted in time order. |
| Auto-trip | Nights box couldn't be cleared | Nights kept as text while typing; normalised to ≥1 on blur. |
| Auto-trip | Can't pick a date that's passed | Each stop's date has a minimum: today for the first stop, the previous stop's check-out for later ones. Picking earlier is refused with a message; a red border + note if a later edit makes it invalid; Create refuses too. |
| My week | Highlight Signature / MM tours | Teal tint, left bar and star on Signature-status and MM Tour rows. |
| My week | Category column (MM / third party) | New column: category label + who runs it (Mad Monkey / Third party / One-off). |
| My week | No transport | Transport excluded from the query; footer links to the Transport tab. |
| Experiences | Edited ⇒ verify again | DB trigger `products_clear_verified` (before update) clears `last_verified_*` when any content field changes (remarks excluded); `transport_clear_verified` does the same for slot / pick-up edits. UI: "needs verifying" in amber on the product page, Save tooltip and toast say so, list tooltip updated. |
| Global events | Up to 6 asset links, one box each | `global_events.asset_urls text[]` (max 6, http(s) only). On accept they are copied into `product_assets` (source `global`, asset 1 = latest) so the GM's Asset column shows them. |
| Global events | GM can click + edit before accepting | Pending banner: click the title or **Edit** → dialog with every field editable (title, rate, date/days, times, expiry, descriptions, inclusions, things to bring) + head-office assets. Only changed fields are sent as `p_overrides` to `respond_global_event(…, jsonb)`, applied to the created product and stored on `global_event_responses.overrides`. |
| Global events | Does the GM get an email? | Not before. Now: after-insert trigger → pg_net → new Edge Function `global-event-notify` emails every GM of every active hostel (via Resend) with the details and a link. Result stored in `global_events.notified_at / notify_result` and shown to admin. **Needs RESEND_API_KEY + verified sender; until then it records "would send" and shows "email sending isn't switched on yet". GM profile emails are still the `@madmonkey.test` placeholders — swap to real addresses first.** |
| Global events | Admin sees details after launch | Click any event → dialog with every field, asset links, message, email status, and every hostel's answer; a pencil marks hostels that accepted with changes, listing what they changed. |
| Transport | Own tab with search | New `/transport` tab (sidebar, all roles): search across route / places / operator / type, type filter, "show paused", departure-slot chips, journey time, local + USD price, status. Rows open the product page. Transport is now excluded from the Experiences list and its category filter; "Add transport" deep-links the add form with the category set. |
| Quotes | Hide from GMs | Sidebar hides Quotes unless admin / head office / sales; `/quotes*` routes redirect GMs to Experiences; RLS on quotes, quote_days, quote_lines, quote_versions and customers now requires `can_quote()`; `duplicate_quote` and `generate_quote_version` refuse other roles. Verified via the API as a GM (empty results, RPC refused) and as admin (rows). |

Verified 8 Sep 2026: GM API lock-out; re-verify trigger (remarks edit keeps the stamp, title edit clears it); test global event → 23 GMs resolved by the notify function (no Resend key, so "would send"); GM accept with overrides created the product with the changed title / rate / start, two `global` assets, the date rule, and the overrides recorded on the response.
Not done: walkthrough PDF refresh (still out of date).

## Times re-sync from the flow chart (client request 9 Sep 2026) — **BUILT & RUN 9 Sep 2026**

Source: `docs/TIMES_RESYNC.md` (client message verbatim + results). Finish time now auto-filled from
start + duration on every save (`products_fill_times`, backfilled). Re-runnable pull script
`tools/import_flowchart.py` reads every visible tab (hidden / OLD skipped), proposes start / finish from
the ITINERARY column into `product_time_proposals`, inserts experiences added since 23 Aug, and logs
housekeeping exceptions. New `/approvals` page ("Approvals" in the sidebar, admin + head office, pending
badge): edit, approve, reject, approve-all per hostel; approving writes the times to the product.
Run result: 109 new experiences, 317 proposals queued, 105 exceptions, 495 row numbers updated.
Not done: Reden's login (auth user creation was blocked for the assistant; create in Supabase Auth and
grant `head_office`), walkthrough PDF still out of date.

# Experience Database + Costing Tool — Development Brief

**For:** Charlie Fagan · **From:** Kyle Kenny · **Date:** 17 August 2026
**Version:** 2 — supersedes the earlier costing-tool-only brief

> Verbatim transcription of `Experience_Database_and_Costing_Tool_Brief.md.docx`.
> Source of truth for scope. Do not edit — record decisions in `../IMPLEMENTATION_PLAN.md`.

---

## Phasing

| Phase | What | Notes |
| --- | --- | --- |
| **1** | Experience Database + GM front-end UI + Reden notification | Blocks Phase 2 |
| **2** | Costing tool — build screen, pricing engine, client one-pager | Reads from Phase 1 |
| **3** | Version history, tracking dashboard, internal booking handoff | |

---

## PHASE 1 — Experience Database

**Current database:** [Google Sheet](https://docs.google.com/spreadsheets/d/1rGvWgjV09MqQWPfW75OrhUQD-0y2XlDyop_YDkXBMg4/edit?gid=1878684823#gid=1878684823)

### Structure

Every bookable product, divided by location, in one of four categories:

- Mad Monkey Owned Tours (sometimes called MADFIVE)
- Mad Monkey Nightly Events — karaoke, quiz, beer pong, bar olympics, movie nights, BBQ
- Other 3rd Party Tours
- Transportation — transfers and route transport

All 24+ locations. Each product belongs to one location and one category.

### Fields

Lifted from the current flow chart structure so nothing is lost in migration.

**Core**
- Title
- Category (one of the four above)
- Location
- Operator — Mad Monkey or named 3rd party
- Rate (USD)
- Active on the ground — yes/no
- Bookable on the Mad Monkey website — yes/no
- Status — Active / Paused / Signature Tour / Pending update

**Availability and capacity**
- Days of the week it runs — must be structured, selectable, not free text. This is what makes "they're in Siem Reap on a Monday, what runs?" work.
- Start time, finish time, duration
- Minimum guests per booking
- Maximum guests per day
- Seasonal or date-range restrictions where they apply

**Content**
- Brief description — 95 character limit, enforced
- Long description
- Meeting point and time
- Inclusions
- Exclusions
- Things to bring
- Cancellation policy
- Itinerary — timed breakdown
- Travel insurance required — yes/no
- Photo link — minimum 6 images
- Remarks and update notes

**Commercial**
- Gross service value / commission basis
- Rezdy reference where one exists

### GM front-end UI

Simple. GMs are not spreadsheet analysts and this needs to be faster than what they do today.

- Log in, see your own location's products only. Head office sees everything.
- Click to edit any field inline. Change a price, pause a product, adjust a start time — done in seconds.
- "Add new product" form — guided, with required fields enforced so nothing incomplete enters the database. Category and location pre-set from the GM's context.
- Pause / reactivate toggle rather than deleting. Paused products stay in the database but drop out of the costing tool.
- Changes go live immediately. No approval gate.
- Full change log — who changed what, when, and the before-and-after value. This is our safety net given there's no approval step.

### Reden notification

Any change to the database fires an automatic email to Reden so the website gets updated.

- Triggers on: new product added, price change, status change (active/paused), description or inclusions edit, availability change.
- Email contains: location, product title, what changed, old value, new value, who made the change, timestamp.
- Batch into a single digest per location per day rather than firing one email per keystroke — otherwise Reden gets buried and starts ignoring them. **Confirm with Reden which he'd prefer before building.**
- Only sends for products flagged as bookable on the website.

### Migration

One-time import from the flow chart into the database. Expect messy data — inconsistent day-of-week formats, missing photo links, blank min/max fields. Import what's clean, produce an exceptions list for Hayley and the GMs to fill manually. Don't let bad rows silently through.

---

## PHASE 2 — Costing Tool

### Data sources

| Source | Where | Integration |
| --- | --- | --- |
| Accommodation rates by location, room type, season tier (lean/mid/high) | 2027 RATE OFFER TA — "base rate per seasonality" | Nightly sync from Sheets |
| Breakfast rate per person | 2027 RATE OFFER TA — "breakfast rates from cam" | Nightly sync from Sheets |
| All tours, events, 3rd party product, transportation | Experience Database | Direct — live, no sync |

The rate sheet stays in Sheets for now. It changes near-daily, so build:

- Nightly scheduled sync.
- "Sync now" button to force a refresh after Hayley edits a rate.
- Last-synced timestamp on screen at all times.
- Failure alerts to Charlie and Hayley — a silent sync failure means we quote stale rates without knowing.
- Named ranges and locked headers on the sheet. No column insertions without telling Charlie. Hayley owns this.
- Validation on ingest — reject blank rates and malformed dates, log them, don't import.

### Price snapshotting — non-negotiable

When an agreement version is generated, its prices freeze to that version. A quote sent Monday must never silently re-price when a GM edits a tour on Tuesday. Every version stores its own price set and the timestamp it drew from.

### Build screen

- Select location, room type, season tier — rate pulls automatically.
- Breakfast toggle per night.
- Add experiences, filtered by location and day of week — with a manual override to force-add anything regardless of the filter.
- Add transportation.
- Show duration, start and finish times throughout.
- Custom line items — free-text description plus manually set price, for extra meals, F&B packages, or anything not yet in the database.
- Edit, discount, or comp any line. Logged against the user who applied it.
- Pax count drives the calculation.

### Pricing

- Per person and group total — both shown.
- Plus a per-room-type breakdown.
- USD only. No FX handling.
- Internal view breaks out by product line: accommodation, F&B, transportation, experiences — plus total.

### Outputs

**Internal costing** — by product line, per person, group total.

**Client agreement** — Google Doc from template, with a shareable web link option:
- Mad Monkey branding, locked header.
- Day-by-day itinerary with timings.
- Copy pulled straight from the Experience Database, editable before send.
- Space for images.
- Per person and group total only — no line-item breakdown.
- Editable basic terms block.
- Client requests a change, we regenerate as a new version.

### Permissions

Anyone with tool access can build and send. No approval gate. Discounts and comps logged.

---

## PHASE 3

- Version history per agreement — list of what's been sent, click back in, create a new version.
- Tracking dashboard — customer, product, total value, version. Filterable by country and month.
- Final approved document output to internal teams to make the bookings.
- Invoicing stays manual with Adele. Out of scope.

---

## Open items for Charlie

1. **Stack and hosting** — your call. Flag what you pick and why.
2. **Sequential or parallel build** — see Phasing above. Kyle to confirm.
3. **Reden's notification preference** — instant per change, or daily digest per location. Ask him directly.
4. **Rezdy relationship.** The flow chart currently drives a Rezdy upload process via the Tour Distribution Officer. Confirm whether the Experience Database eventually feeds Rezdy directly or whether that stays manual. Out of scope for Phase 1, but design the schema so it isn't blocked later.
5. **Google Docs API access and template ownership** — confirm with Danny whether Workspace permissions need approving.
6. **Customer record** gets created at the costing or opportunity stage. Confirm minimum fields.

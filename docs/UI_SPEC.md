# UI / UX spec

Design brief in one line: **a GM who has never been trained can change a price in under
ten seconds, on hostel wifi, on a laptop that might be a 2016 MacBook Air.**

The people using this are not spreadsheet analysts (the brief says so). They currently
work in a colour-coded dashboard. Anything that feels like enterprise software will lose
to the sheet they already know.

---

## 1. Principles

1. **The table is the product.** GMs live on one screen. Everything else is secondary.
2. **Edit in place.** Click a cell, type, tab out, saved. No modal, no Edit button, no
   Save button for single-field changes. This is the whole "faster than the sheet" claim.
3. **Keep the colour language they already know.** The sheet trained everyone that cyan
   means signature and orange means paused. Reuse that mapping — calm badges instead of
   full-cell fills — and nobody needs retraining.
4. **Never more than 4 things in the nav.**
5. **Show the save state, always.** No approval gate means the moment of truth is the
   save. Row flashes, toast on failure, never a silent write.
6. **Light theme only for v1.** Internal daytime tool; a second theme is a second thing
   to test. Tokens are structured so dark can be added without a rewrite.

## 2. Colour

Five neutrals, one accent, five status colours. That is the entire palette.

```css
:root {
  /* neutrals */
  --bg:          #FFFFFF;
  --surface:     #F7F7F5;   /* table header, sidebar, cards */
  --border:      #E4E4E1;
  --ink:         #1A1A18;   /* all body text */
  --ink-muted:   #6B6B66;   /* labels, meta, placeholder */

  /* accent — Mad Monkey yellow, used sparingly */
  --accent:      #FFC72C;   /* active nav bar, focus highlight */
  --primary:     #1A1A18;   /* primary buttons: near-black, white text */

  /* status — same meanings as the sheet legend, desaturated for screen */
  --st-active:    #15803D;  /* was: plain white row   */
  --st-signature: #0E7490;  /* was: cyan   #00FFFF    */
  --st-pending:   #B45309;  /* was: yellow #FFFF00    */
  --st-paused:    #C2410C;  /* was: orange #FF9900    */
  --st-remove:    #B91C1C;  /* was: red    #FF0000    */
}
```

Status renders as a **soft badge** — 12% tint of the status colour as background, the
full colour as text. Never a filled row: 1,300 rows of saturated fill is what makes the
current sheet exhausting to read.

Yellow is an accent, not a surface. It appears on the active nav indicator and the focus
ring, nowhere else. Primary buttons are near-black — yellow buttons with dark text fail
contrast at small sizes and read as a warning.

## 3. Typography and density

One family: **Inter**, system fallback. Three sizes only.

| Token | Size / weight | Use |
| --- | --- | --- |
| `text-sm` | 13px / 400 | table cells, body |
| `text-base` | 15px / 500 | section headings, nav |
| `text-lg` | 20px / 600 | page title |

Table rows **44px** — tall enough to hit on a trackpad, tight enough to see ~15 products
without scrolling. Numeric columns tabular-figure aligned right.

## 4. Navigation

A fixed left sidebar, 220px, collapsing to icons under 1024px. **Four items for a GM:**

```
┌──────────────┬────────────────────────────────────────┐
│  MAD MONKEY  │  Phnom Penh ▾            Charlie F ▾   │  ← location switcher
│              │                                        │     (static label for a GM)
│ ▍Experiences │   [ search    ]  Category ▾  Status ▾  │
│  Quotes      │   Day ▾                    + Add       │
│  Activity    │  ────────────────────────────────────  │
│  Settings    │   TITLE      RATE   DAYS    STATUS     │
│              │   S21 Tour   $32    Daily   ●Signature │
└──────────────┴────────────────────────────────────────┘
```

- **Experiences** — the product table. Default screen.
- **Quotes** — Phase 2. Hidden for users without the `sales` role.
- **Activity** — the change log.
- **Settings** — admin only. Rate sync status, users, locations, import exceptions.

Head office gets the location switcher; a GM sees their location as plain text. Role
decides what renders, and RLS decides what is returned — never one without the other.

## 5. Screens

| Route | Who | Notes |
| --- | --- | --- |
| `/experiences` | all | Table. Filters: category, status, **day of week**, search. Inline edit. |
| `/experiences/new` | gm+ | Guided form, required fields enforced, category and location pre-filled. |
| `/experiences/:id` | all | Right-hand drawer for the long fields — description, inclusions, itinerary. |
| `/activity` | all | Change log, `field: old → new`. Filter by product, person, date. |
| `/settings/imports` | admin | **Migration exceptions queue.** |
| `/settings/rates` | admin | Last synced, sync now, failures. |
| `/quotes` · `/quotes/:id/build` | sales | Phase 2. |
| `/a/:slug` | public | Client agreement. No auth, no chrome, unguessable slug. |

### The table

Frozen title column. Everything else scrolls horizontally. Columns visible by default:
title, category, rate, days, times, status, bookable-online. The long content fields open
in the drawer — trying to show a 400-word itinerary in a cell is what makes the sheet
unusable.

**Day filter is a 7-segment control** (`M T W T F S S`), not a dropdown. It answers the
brief's own test — *"they're in Siem Reap on a Monday, what runs?"* — in one click.

### Inline editing

- Text / number → click, input appears in place, `Enter` or blur commits, `Esc` cancels.
- Enum (status, category) → click, small popover list.
- Days → click, the 7-segment toggle.
- Boolean → a switch, commits immediately.
- On commit: optimistic update, row border flashes `--st-active` for 600ms.
- On failure: row reverts, red toast with the reason. **Never fail silently.**
- Rate: if the new value is >40% from the old, an inline confirm — *"$32 → $65. That's a
  103% increase. Save?"* Not a gate, just a second look. See `IMPLEMENTATION_PLAN.md` §7.

### The exceptions queue

The most important screen of Phase 1, given §6 of the audit. One row per unresolved
import problem: source row, what we couldn't read, the raw cell text, and an input to fix
it. Filterable by location so a GM gets only theirs. A progress bar per location, because
several hundred rows is a slog and people need to see it shrinking.

## 6. Client agreement page

The one screen a customer sees, so it is the only place the design gets expressive.
Full-bleed hero image, Mad Monkey branding, day-by-day itinerary with timings, per-person
and group total, terms block. **No line-item breakdown** — the brief is explicit.

Printable to PDF via CSS `@media print`. Static HTML rendered from the frozen snapshot —
it must render identically in two years, so it reads nothing live.

## 7. Accessibility and performance

- All text on `--bg` / `--surface` meets WCAG AA; status badges tested at 13px.
- Full keyboard path through the table: `Tab` between cells, `Enter` to edit.
- Every control has a visible focus ring (`--accent`, 2px).
- 1,300 rows: server-side pagination and filtering, 50 per page. Never ship a client-side
  filter over the whole catalogue — hostel wifi is the constraint.
- Optimistic writes so the UI never blocks on a round trip.

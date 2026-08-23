# Google Sheets integration — Apps Script plan

## 1. First, what the brief actually asks to stay connected

This gets misread, so it is worth being exact. The brief names three data sources and
gives each a different integration:

| Source | Brief says | Meaning |
| --- | --- | --- |
| Accommodation rates — *2027 RATE OFFER TA* | "Nightly sync from Sheets" | **Stays in Sheets. Permanent live connection.** |
| Breakfast rates — same workbook | "Nightly sync from Sheets" | **Stays in Sheets. Permanent live connection.** |
| Tours, events, 3rd party, transport — *Experience Database* | "Direct — live, no sync" | **Leaves Sheets.** Read straight from our own database. |

So: **exactly one live sheet connection, and it is the rate sheet — not the flow chart.**

"Direct — live, no sync" is easy to read as "live link to the spreadsheet". It means the
opposite: no sync *because* there is no longer a sheet in the path. The flow chart gets a
**one-time migration** ("One-time import from the flow chart into the database"), and from
cutover the GM UI is the only place products are edited. If the flow chart stayed live we
would inherit every problem in `SOURCE_DATA_AUDIT.md` permanently, and the change log and
RLS the brief asks for would be unimplementable.

The rate sheet is different and deliberately so: Hayley edits it near-daily, it is her
working tool, and the brief keeps it *"in Sheets for now"*.

## 2. Why Apps Script rather than a service account

The obvious build is a service account calling the Sheets API on a cron. Apps Script is
better here on three counts:

- **No Workspace admin approval.** A service account needs a Google Cloud project and the
  sheet shared to a robot address. Apps Script is bound to the sheet and runs as its
  owner. Open item #5 (Danny) stops blocking the rate sync — it only still gates Google
  Docs export.
- **Validation where Hayley can see it.** The script writes errors back into the sheet
  next to the offending row. She fixes them in the tool she is already in, instead of
  reading an email about row 214.
- **Push, not poll.** Edits reach us within minutes rather than waiting for the nightly
  window.

We keep the pull path as a fallback (§6).

## 3. The `_SYNC` projection tab

Do not read Hayley's working tabs directly. Add one hidden, protected tab whose cells are
formulas pointing at her layout:

```
_SYNC_RATES        location | room_type | season_tier | rate_usd | valid_from | valid_to
_SYNC_BREAKFAST    location | rate_usd_pp | valid_from | valid_to
_SYNC_STATUS       last_push_at | last_status | row_count | error_count | message
```

Fixed headers, one row per rate, no merged cells, no formatting meaning anything. This is
the recommendation from `IMPLEMENTATION_PLAN.md` §7.2, made concrete: **she restructures
her own tabs freely and the contract never breaks**, because the projection absorbs the
change. It costs about an hour to build once.

`_SYNC_STATUS` is written back by the script, so the sheet shows its own sync health.

## 4. Script structure

```
rate-sync/                 (clasp project, committed under tools/apps-script/)
  Code.gs                  entry points
  Projection.gs            read + normalise _SYNC_* tabs
  Validate.gs              row-level validation
  Transport.gs             HMAC signing + POST
  appsscript.json          scopes: spreadsheets, script.external_request
```

### Entry points

| Function | Trigger | Purpose |
| --- | --- | --- |
| `onEditHandler(e)` | installable `onEdit` | Marks the workbook dirty. Does **not** push. |
| `flushIfDirty()` | time-driven, every 5 min | Pushes only if dirty. This is the debounce. |
| `nightlyPush()` | time-driven, 02:00 ICT | Full push regardless of dirty state — the heartbeat. |
| `doGet(e)` | web app | Synchronous pull for the app's **"Sync now"** button. |

Debouncing through a dirty flag is what stops a keystroke storm becoming 400 HTTP calls:

```javascript
function onEditHandler(e) {
  const sheet = e.range.getSheet().getName();
  if (!SOURCE_TABS.includes(sheet)) return;           // ignore unrelated tabs
  PropertiesService.getScriptProperties()
    .setProperty('dirtySince', String(Date.now()));
}

function flushIfDirty() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('dirtySince')) return;
  const result = pushSnapshot('edit');
  if (result.ok) props.deleteProperty('dirtySince');
}
```

### Validation before anything leaves the sheet

```javascript
function validateRateRow(row, i) {
  const errs = [];
  if (!row.location)                        errs.push('missing location');
  if (!row.room_type)                       errs.push('missing room type');
  if (!['lean','mid','high'].includes(String(row.season_tier).toLowerCase()))
                                            errs.push('season tier not lean/mid/high');
  const rate = Number(String(row.rate_usd).replace(/[$,\s]/g, ''));
  if (!isFinite(rate) || rate <= 0)         errs.push('rate not a positive number');
  if (row.valid_from && !isValidDate(row.valid_from))
                                            errs.push('valid_from is not a date');
  return { row: i + 2, rate, errs };
}
```

Rows with errors are **excluded from the payload** and written into a `_SYNC_ERRORS` tab
with the row number and reason — the brief's *"reject blank rates and malformed dates,
log them, don't import"*, enforced before the data ever crosses the wire.

### Signing

Shared secret in Script Properties, never in the source:

```javascript
function signedPost(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty('MM_SHARED_SECRET');
  const body = JSON.stringify(payload);
  const sig = Utilities.computeHmacSha256Signature(body, secret)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  return UrlFetchApp.fetch(ENDPOINT, {
    method: 'post', contentType: 'application/json', payload: body,
    headers: { 'x-mm-signature': sig }, muteHttpExceptions: true
  });
}
```

The Edge Function recomputes the HMAC and rejects any mismatch. Without this the endpoint
is an open write to the pricing table.

## 5. Receiving end — `rate-sync` Edge Function

1. Verify HMAC. Reject on mismatch.
2. Open `rate_sync_runs` with `status = 'running'`, `triggered_by = edit | nightly | manual`.
3. Insert every row into staging.
4. Re-validate server-side. **Never trust the sheet's own validation** — it is editable by
   anyone with the sheet.
5. **Sanity gate:** if the payload has fewer than 80% of the live row count, or more than
   25% of rates moved by more than 50%, mark the run `needs_review`, alert, and **do not
   promote**. A deleted column upstream should not silently wipe the rate table.
6. Promote staging → `accommodation_rates` / `breakfast_rates` in **one transaction**.
7. Close the run, write `_SYNC_STATUS` back to the sheet.
8. On failure: Resend alert to Charlie and Hayley with the run id and the first ten errors.

## 6. Staleness — the failure the brief is most worried about

*"A silent sync failure means we quote stale rates without knowing."* A push-only design
fails exactly this way: if the script stops running, nothing arrives and nothing errors.

So the app treats **absence of a heartbeat as the alarm**:

- `nightlyPush()` fires whether or not anything changed, so a healthy day always produces a run.
- A scheduled check in the app raises an alert if the newest successful run is over **36 hours** old.
- The build screen shows `Rates synced 4 hours ago` at all times, and switches to a
  blocking amber banner past 36 hours.
- **Fallback path:** if Apps Script proves unreliable — or Workspace policy blocks web app
  deployment, which is the main risk to this design — a service-account pull replaces
  §4 without touching §5. The projection tab and the Edge Function are the same either way,
  which is why the contract sits at `_SYNC_*` rather than at the transport.

## 7. Second script — the flow chart, one-time only

The flow chart does **not** need Apps Script. It is a single migration, and the extractor
in `tools/extract_flowchart.py` already parses all 1,297 rows including the colour-encoded
status that the Sheets API cannot see (`SOURCE_DATA_AUDIT.md` §5). Running it offline
against the `.xlsx` is faster to iterate and reproducible.

One small script is worth writing at cutover:

- `freezeFlowchart()` — protects every location tab, and adds a banner:
  *"Frozen 12 Sep 2026. Products are now edited in the Experience Database — <link>."*

Without it the flow chart and the new tool diverge within a week, and GMs keep editing the
sheet because it is what they know.

## 8. Sequence

1. Build `_SYNC_*` projection tabs with Hayley — needs her, ~1 hour.
2. `clasp` project into `tools/apps-script/`, validation + signing, manual push only.
3. `rate-sync` Edge Function, staging, sanity gate, promotion.
4. Wire triggers: onEdit, 5-min flush, nightly.
5. Staleness monitor, banner, Resend alerts.
6. `freezeFlowchart()` at Phase 1 cutover.

Steps 1–3 are the ones with unknowns in them; 4–6 are mechanical.

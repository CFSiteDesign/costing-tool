# Final flow-chart sync (Oct 2026)

## The ask
Kyle, 29 Sep 2026: one re-run against the current flow chart, changing any discrepancies, with every update
left in a queue for Reden to sense-check. The sheet is deleted afterwards, so this is the last read of it.

## How it works
`tools/sheet_sync.py LIVE.xlsx` (dry run) then `--apply`. It reads every visible location tab (OLD and summary
tabs skipped), matches rows to experiences in the tool, and queues the differences. **Nothing on an experience
changes until head office approves it** on Approvals, tab "Sheet changes" (times stay in the "Times" tab).

- **Only real sheet changes are queued.** A field is listed only when its sheet cell differs from the copy the
  tool was built from: the 21 Aug workbook for the first import, the 9 Sep workbook for experiences added then.
  If the cell is unchanged, the tool's value stands. This protects the ~760 values head office fixed by hand in
  August (441 prices and 518 descriptions differ from a fresh parse of an unchanged cell, and are left alone).
- **Transport import fix.** On 21 of the 22 tabs with transport, the columns sit one to the right of Phnom
  Penh's. The first import used fixed positions, so schedule, duration, capacity, pickup, drop-off and both
  descriptions were read one column off (a Hanoi bus had "45.0" as its schedule and "3 Hours" as its pickup).
  The extractor now reads positions from each tab's own header and sub-header. Those corrections are queued as
  one "Transport details" card per product, reason "Import fix". Rates, names and status were always read right.
- **New on the sheet**: added only when approved. **Not on the sheet any more**: approve pauses it (nothing is
  deleted); already-paused items and one-time events past their date are not listed. **Names and categories**:
  the old open rename/category/missing exceptions are dismissed and re-listed here from the live sheet.
- **Times**: recomputed from the ITINERARY column as on 9 Sep; older pending time proposals are marked superseded.
- **Unreadable prices** get a row with a USD box to type the value. Unreadable days or durations are skipped.

## Safety
- `decide_sheet_proposals(ids, decision, overrides)` (security definer, admin / head office only) re-checks each
  experience first: if any field it would change was edited in the tool after the run, it is skipped as
  "stale" with a note. A "new" item is skipped if that name already exists at the hostel. Typed prices get the
  local amount worked out from the hostel's FX rate. Every write goes through the normal update, so the audit
  log, re-verify, Reden note and stale-asset triggers all fire.
- Re-running supersedes whatever is still pending and never brings back a change head office rejected.
- `--apply` archives the workbook and the extracted rows in the private storage bucket `flowchart-archive`.

## Dry run on the 9 Sep copy (2 Oct 2026)
558 sheet changes (422 transport cards, 102 changed on the sheet between 21 Aug and 9 Sep and never pulled,
28 category, 9 names, 6 with no earlier copy), 4 to pause, 317 times. The live run replaces this.

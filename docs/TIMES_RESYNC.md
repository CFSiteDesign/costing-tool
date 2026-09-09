# Times re-sync from the flow chart (9 Sep 2026)

## The ask (client message, verbatim)

> Hi @Charlie Fagan
> when experiences are being input, it's really important that we have a start time AND an end time for
> this to work. there's currently inconsistency across the experiences with this, some just have a duration
> and it's not copying over to the new system accurately. or maybe there's a way for the system to
> understand the 'duration' and calculate the end time?
>
> info should be pulled from the 'itinerary' column rather than the 'description' column in the experience
> flowchart
> pls can you do a fresh pull of the experiences flowchart into the dashboard tool and ask it to bring in
> this colum for statt and end time that then sits in a queue for reden to approve
> cna you also ask it to pull in newly added experiences since the 1st pull

Charlie: search every location page except the ones that say OLD.

## What was built

1. **Finish from duration, automatically.** `products_fill_times` trigger: a blank finish is filled from
   start + duration on every save; a blank duration is worked out from start and finish. Backfilled once.
   The product page says so under the time fields.
2. **Re-pull script** `tools/import_flowchart.py` (durable, re-runnable). Reads every visible tab, skips
   hidden tabs and anything named OLD, recognises both the TITLE (tours/events) and TYPE (transport)
   header layouts, and treats a TITLE header with no banner above it as the next section (Siem Reap's
   one-time events). Matches each row to the database by (tab, row) then by title, then fuzzily; rows that
   moved get their row number updated; renames are logged, never applied.
3. **Time proposals queue** `product_time_proposals` + `/approvals` page ("Approvals" in the sidebar for
   admin / head office, with a pending count). For every matched experience the script proposes
   start / finish / duration read from the **ITINERARY column** (first and last clock times), falling back
   to the DAY, TIME & DURATION column, then start + duration. Only products whose times differ get a
   proposal. Each row shows the current times, the proposed ones (editable), which column they came from
   with the source text, and a note when the itinerary disagrees with the day/time column. Approve writes
   the times to the product in the same step; reject leaves it alone. Approve-all / reject-all per filter.
4. **New experiences since the first pull** inserted with the same parsing rules as the first import (rate,
   days, times, descriptions, need-to-know split, capacity, status from text + cell colour, one-time event
   date + expiry). Unreadable rates / days / dates go to the existing exceptions queue.
5. **Housekeeping exceptions** for humans to decide: products no longer on the sheet
   (`missing_from_sheet`), category differs from the sheet section (`category`), renamed on the sheet
   (`title`). Six Panglao transport rows the first import had filed as one-time events under the vehicle
   name were re-filed as transport with their route.

## Results
(see the run row in `import_runs`, source `flowchart_xlsx_repull`)

Run `bcf4bba6-2b93-48f9-b3df-f08c5c8ca0dd`, 9 Sep 2026, workbook "MAD MONKEY EXPERIENCE FLOW CHART 2026 (1).xlsx"
(23 visible location tabs read; 24 hidden / OLD tabs skipped):

| | |
|---|---|
| Rows read from the sheet | 1,298 (511 transport, 265 one-time events, 208 nightly events, 204 third-party tours, 110 MM tours) |
| Matched to an existing product | 1,189 (679 in place, 495 had moved rows, 15 renamed on the sheet) |
| **New experiences added** | **109** (80 one-time events, 12 third-party tours, 8 nightly events, 5 MM tours, 4 transport) |
| **Time proposals queued for approval** | **317** (275 from the itinerary column, 37 from the day/time column, 5 from start + duration) |
| Exceptions raised | 105 (rates as words, unreadable days/dates, 17 no longer on the sheet, 28 category differs, 11 renamed) |
| Transport rows re-filed | 6 Panglao rows the first import had as one-time events named after the vehicle |

Notable: Siem Reap's whole one-time events section and Nusa Lembongan's were missing from the first pull
(no banner row above them); both are in now. The Reden login could not be created by the assistant (see
`supabase/migrations/012_time_proposals.sql`); admin and head office can approve meanwhile.

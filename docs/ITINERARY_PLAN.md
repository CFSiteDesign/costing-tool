# Detailed itinerary from a quote — plan (10 Sep 2026)

## The ask
Hayley (client), 10 Sep 2026: generate a detailed itinerary from a quote, like the ALL IN trip pages but in
more detail, so the partner / client sees a daily and hourly breakdown of what is included. Fully editable
so gaps can be filled and mistakes corrected. On brand. Bonus: a photo per activity, ideally pulled from
the flow chart's photo column / Rezdy / the website, but easy to swap. Reference document:
"DETAILED ITINERARY Northern Vietnam 10 Nights.docx" for quote MMQ-2026-0003 (Reight Travel, 12 pax).
Charlie's calls: plan first; photo slots stay blank for now (no way to pull images today); Charlie will
talk to Dhany about a Rezdy connection and scope that as phase 2.

## What the reference document actually contains
1. Header: trip name, nights, route ("Hanoi - Ha Giang - Hanoi - Ha Long Bay - Hanoi").
2. Package inclusions: nights + room type, meal counts (Breakfast x5, Lunch x7, Dinner x4), the daily
   Meet Up, each activity by name. Not included list. Optional extras. Transfers list.
3. Day by day, every day, even empty ones: timed lines ("2pm: Check in", "7pm: The Meet Up @ Mad Monkey
   bar", "11pm: pub crawl"), practical notes (check out before leaving, luggage storage), the activity's
   own hourly itinerary, and an "Accommodation:" line per day.
4. Multi-day tours are expanded into their own days (Ha Giang 4D3N: "today's highlights" + "the vibe" per
   day, copied from the ALL IN site; Lan Ha 2D1N: the cruise operator's hourly programme).
5. Last day: "11am: check out + onward travel".

## What the database can fill today (checked against that quote)
| Reference content | Source in the tool | Fill |
|---|---|---|
| Trip name, nights, pax, client | quote + customer | automatic |
| Route | quote days' hostels in order | automatic |
| Day, date, hostel | quote_days | automatic (dates blank on 8 of 10 days in this quote, so "Day N" with date when present) |
| Accommodation line | stay line + room type | automatic ("Mad Monkey Hanoi, shared dorm") |
| Breakfast count | breakfast lines | automatic; lunch / dinner counts have no field, so they come from the activities' inclusions text where it says lunch / dinner, then edited |
| Activity time | line start / finish (now filled from duration too) | automatic |
| Activity hourly breakdown | product ITINERARY column (e.g. Hanoi Pub Crawl: 8:00 PM meet, 11:00 PM depart, 2:00 AM bus home) | automatic, parsed into timed bullets with the parser from the re-pull |
| Meeting point, inclusions, exclusions, things to bring, cancellation | product fields | automatic |
| Activity blurb | brief + long description | automatic |
| Transfers | transport lines: vehicle, route, departure slot, duration | automatic |
| Check in, Meet Up, check out, luggage note | not in the database | defaults (2pm check in, 7pm Meet Up, 11am check out), editable, per-hostel overrides later |
| Multi-day tours (4D3N) | one line with a free-text itinerary | expanded into N days when the title says "xD yN" or duration ≥ 24h; day text split on "day N" markers where the itinerary has them, otherwise blank days to fill |
| Free days | days with no lines | "Free day to explore {city}" template + Meet Up block |
| "Today's highlights" / "the vibe" copy | nowhere | manual (this is the ALL IN voice, needs a human) |
| Photos | products.photo_album_url is a real link on 4% of products; no Rezdy or website connection | empty slot per activity; paste a URL or upload; phase 2 = Rezdy |
| Hostel address, reception contact | flow chart rows 1–28 (not imported) | manual now; a follow-up to the re-pull script can import them |

## Build
**1. Data + generator (½ day).** `quote_itineraries` (one per quote): `doc jsonb`, `share_slug`,
`updated_at / updated_by`. Document shape: header, inclusions[], not_included[], optional[],
transfers[], days[] → blocks[] (kind: activity | stay | meal | transfer | free | note; time, title, body,
bullets[], highlights[], vibe, photo_url, source_line_id, edited). `generate_itinerary(quote_id)` builds it
from the quote + products with the mapping above. "Regenerate from quote" keeps any block marked edited,
refreshes the rest, adds new lines, flags removed ones. Public read via `get_itinerary(slug)` RPC (anon,
SECURITY DEFINER, same pattern as the agreement). Storage bucket `itinerary-photos` for uploads.

**2. Editor (1 day).** `/quotes/:id/itinerary`, opened from a "Detailed itinerary" button in the builder.
Reads like the finished page, every field editable in place, add / move / delete blocks, "needs filling"
markers on empty auto fields (hidden in the output), photo slot per block (upload or paste URL, swap
any time), explicit Save with "Saved hh:mm" like the product page, Regenerate, Preview, Copy share link,
Print / PDF. Quoting roles only (admin, head office, sales).

**3. Public page + PDF (½ day).** `/it/:slug`, Mad Monkey dark header, Montserrat, day cards in the ALL
IN trip-page style (image, timed lines, highlights, vibe, accommodation), inclusions / not included /
transfers up top, mobile friendly, print stylesheet for an A4 PDF. Optional: the agreement page links to
the itinerary and vice versa, so a client gets one pack.

**4. Follow-ups (later).** Per-hostel defaults (check in / out, Meet Up time, luggage note, address,
reception contact) imported from the flow chart header rows; Rezdy / website photo pull (Dhany, phase 2);
lunch / dinner as real fields on products so meal counts stop being a guess.

Total ≈ 2 days, sequence 1 → 2 → 3.

## Decisions needed
- D1 Photos: manual for now (decided by Charlie 10 Sep).
- D2 Standard daily blocks: 2pm check in, 7pm Meet Up with a free drink, 11am check out. Confirm these hold everywhere or give per-hostel values.
- D3 Meal counts: derive lunch / dinner from inclusions text, or leave blank to type? Recommend derive and show as editable.
- D4 One client pack: itinerary link on the agreement page and vice versa? Recommend yes.

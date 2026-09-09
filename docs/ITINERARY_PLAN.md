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

## Build (revised 10 Sep 2026: AI writes the whole document)

Charlie's call: AI for the whole thing, spitting out an on-brand asset. So the split becomes: the tool
assembles the facts, Claude writes the document, the tool renders it in the Mad Monkey look, people edit.

**1. Fact pack (¼ day).** `itinerary_facts(quote_id)` returns one JSON object: trip (title, reference, pax,
client, nights, route), days (day, date, hostel, country), and every line with its product data (times,
duration, meeting point, itinerary text, brief/long description, inclusions, exclusions, things to bring,
cancellation, rate), stays with room type, breakfast, transport with vehicle / route / departure slot.
Nothing is written here, so nothing is invented here.

**2. Generator (½ day).** Edge Function `itinerary-generate` calling Claude with:
- a cached system prefix: the document format (taken from Hayley's reference: header, package
  inclusions with meal counts, not included, optional extras, transfers, day by day with timed lines and an
  accommodation line per day, last day check-out), the Mad Monkey voice with the ALL IN itinerary copy as
  examples, the house rules (2pm check in, 7pm Meet Up with a free drink, 11am check out, luggage note when
  leaving a hostel, "free day" pattern, multi-day tours expanded into their own days);
- the fact pack as the user turn;
- structured output (`output_config.format`) in the document schema below, so the result always renders.
After the response, a deterministic check compares every time, price and product name in the output
against the fact pack and marks any mismatch in the editor ("check this"). Model is a setting; recommend
Sonnet 5 (≈ $0.25 per 10-day itinerary with the prefix cached), Haiku 4.5 ≈ $0.10, Opus 5 ≈ $0.60.
Also per-day regeneration with an instruction ("shorter", "mention the pool") for fixes without a full rewrite.

**3. Document + editor (¾ day).** `quote_itineraries` (quote_id, doc jsonb, share_slug, model, generated_at,
updated_at/by). Schema: header {title, subtitle, nights, route[]}, inclusions[], not_included[], optional[],
transfers[], days[] → {day_no, date, title, intro, blocks[] {time, title, body, bullets[], highlights[],
vibe, photo_url, source_line_id, flagged}, accommodation, notes[]}, closing. Editor at
`/quotes/:id/itinerary`: reads like the finished page, every field editable, add / move / delete blocks,
empty photo slot per activity (upload to the `itinerary-photos` bucket or paste a URL), Generate,
Regenerate day, Save with "Saved hh:mm", Copy share link, Print / PDF. Quoting roles only.

**4. The asset (½ day).** Public page `/it/:slug` via `get_itinerary(slug)` (anon RPC, like the agreement):
Mad Monkey dark header with the logo, Montserrat, day cards in the ALL IN trip-page style (photo, timed
lines, highlights, vibe, accommodation), inclusions / not included / transfers up top, mobile friendly,
print stylesheet for an A4 PDF. Link between the agreement and the itinerary so the client gets one pack.

Total ≈ 2 days. Needs: `ANTHROPIC_API_KEY` as a Supabase secret before the generator can run.
## Decisions needed
- D1 Photos: manual for now (decided by Charlie 10 Sep). Generation: AI writes the whole document from the fact pack (decided by Charlie 10 Sep).
- D2 Standard daily blocks: 2pm check in, 7pm Meet Up with a free drink, 11am check out. Confirm these hold everywhere or give per-hostel values.
- D3 Meal counts: derive lunch / dinner from inclusions text, or leave blank to type? Recommend derive and show as editable.
- D4 One client pack: itinerary link on the agreement page and vice versa? Recommend yes.

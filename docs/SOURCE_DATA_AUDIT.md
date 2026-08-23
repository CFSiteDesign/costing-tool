# Source data audit — MAD MONKEY EXPERIENCE FLOW CHART 2026.xlsx

Machine audit of the real workbook, 21 Aug 2026. Prototype extractor: `../tools/extract_flowchart.py`.

**Headline: 1,206 product rows across 23 live locations** (extractor v2; the first
pass counted 1,297 because transport rows sat under the wrong sections until the parser
learned the second column schema). The brief calls this
"the current database". It is not a database — it is 23 hand-maintained dashboards.
Everything below changes the migration estimate, so read it before scoping Phase 1.

---

## 1. Workbook shape

49 tabs: **23 visible location tabs**, 2 visible summaries, **24 hidden** tabs.

Live locations — Phnom Penh, Siem Reap, Koh Rong, Koh Sdach, Kampot, Siargao, Nacpan,
Panglao, Dumaguete, Siquijor, Manila, Bangkok, Chiang Mai, Pai, Phuket, Luang Prabang,
Vang Vieng, Kuta Lombok, Gili Trawangan, Nusa Lembongan, Uluwatu, Hoi An, Hanoi.

The hidden tabs are superseded copies, and **four of them are booby-trapped**:
`Luang Prabang`, `Nusa`, `Uluwatu`, `Vang Vieng` are old versions that do *not* carry an
`OLD` prefix — they differ from the live tabs only by capitalisation. `Cebu City` is hidden
with no live equivalent (closed? — Q10). Any import must key off `sheet_state == 'visible'`,
never off the tab name.

## 2. A location tab is a dashboard, not a table

Rows 1–28 are a mixed layout — property details, contact emails, Rezdy links, an SOP
block, a weekly schedule grid in columns I–P where each cell reads
`"Tuk Tuk Tour ⏎ 3 PM - 6:00 PM"`, and a channel-listing matrix in U–AA.

The product table starts around row 29, and the **category is a black banner row in
column A**, not a value on the product row. Each banner is followed by its own `TITLE`
header row and then its products.

## 3. Five categories, not four

The brief lists four. The workbook has five, and the labels differ from the brief's:

| Sheet banner | Count (v2) | Brief's name |
| --- | --- | --- |
| `MADFIVE` (21 tabs) | 128 | Mad Monkey Owned Tours |
| `EVENTS` (22 tabs) | 202 | Mad Monkey Nightly Events |
| `OTHER TOURS` (22 tabs) | 196 | Other 3rd Party Tours |
| **`TRANSPORTATION` (`TYPE`-header blocks)** | **502** | Transportation |
| **`ONE TIME EVENTS` (18 tabs)** | **178** | **— not in the brief** |

**Transport is the single largest category** — 42% of the catalogue is route rows, which
is why the dual-schema parser matters. One-time events are next among the non-brief surprises — St Patricks, Khmer New Year, Pride,
Tequila Day, the 15th Birthday. They are date-anchored, not weekly, so `days_of_week` is
meaningless for them and `product_date_rules` is what carries them. They also churn every
year. Q11 below.

Two tabs still use the older banner wording (`MAD MONKEY OWNED TOURS`, `OTHER 3RD PARTY
TOURS`) — Phnom Penh is on a different template generation to everyone else. Plus one-off
sections someone invented: `Food and Beverage Specials`, `Cooking Class`.

## 4. Transport uses a different column schema on the same sheet

Tours: `A=TITLE C=BY D=EVENT/TOUR E=Active F=BOOKABLE ONLINE G=RATE H=MIN/MAX
I=DAY,TIME&DURATION J=BRIEF+LONG DESC N=NEED TO KNOW V=INSURANCE W=PHOTOS X=ITINERARY
AE=Status AF=GSV AG=REMARKS`

Transport: `A=TYPE C=ROUTE E=Active F=Service Provider G=RATE H=MIN/MAX I=DAY&TIME
J=DURATION K=PICK-UP L=DROP-OFF M=Short Desc O=Long Desc Q=REMARKS`

**Column F means "bookable online" in one block and "service provider" in the other**,
and `J` is the long description in one and the duration in the other. A single-schema
importer silently mixes the two — which is exactly what the first prototype run did.

Transport is also *route-shaped*, not title-shaped: 33 rows in Phnom Penh are all titled
`Van`, distinguished only by `C = "Kim Seng - Phnom Penh to Kampot"`. Modelling transport
by title produces 33 identical products. It needs `origin`, `destination`, `vehicle_type`,
`provider` as real columns — see the schema change note below.

The banner also carries a business rule the brief doesn't mention:
*"TRANSPORTATION (Not to Upload Website but on Rezdy only)"*.

## 5. Status is encoded as cell fill colour

Rows 23–27 of every tab are a colour legend:

| Fill | Meaning |
| --- | --- |
| `#00FFFF` cyan | Signature Tour |
| `#FFFF00` yellow | Updates/Pending |
| `#FF9900` orange | Paused Product |
| `#FF0000` red | Need to Delete/Remove |

This is where the brief's `Status — Active / Paused / Signature Tour / Pending update`
actually lives. It is invisible to any normal export — CSV, the Sheets API, and
`pandas.read_excel` all drop it. Only 170 of 1,297 rows carry a legend colour, and the
colouring contradicts the text column in places (Karaoke reads `Paused` in column E but
carries no orange fill). Several fills in use aren't in the legend at all.

**Rule for the importer:** take status from column E where it is a known value, use fill
colour only to add `signature` / `pending_update` (which have no text column), and raise
an exception wherever the two disagree rather than picking a winner.

## 6. Field-by-field quality (n = 1,297)

| Field | Result |
| --- | --- |
| **Rate** | **22% clean numeric.** 14% literally `Free`. **58% is prose** — `$25 pre sale $30 on the day`, `$15 free flow`, `Free Flow - $25 pre sale $30 on the day ⏎ Khmer New Year Wat Phnom Walking Tour $15`, `loation shot entry fee` [sic]. 4% blank. |
| **Day / time / duration** | Three brief fields in one free-text cell. 45% contain a parseable day token; the rest are date-anchored one-time events or fragments like `7.30pm`. |
| **Brief + long description** | Both in one cell, split by blank lines. 91% of first lines are already ≤95 chars; 74 rows breach it; 42 rows have no description. |
| **Meeting point / inclusions / exclusions / things to bring** | All four inside a single `NEED TO KNOW` cell, as labelled sections: `Meet at PLACE at TIME: … INCLUSIONS: … THINGS TO BRING: …`. Splittable on the labels, but the labels are inconsistently typed and often left as empty stubs. |
| **Photo link (min 6)** | **71% blank, 25% not a link** — free text like `POOL PARTY`, `WALKING TOUR - DONE`. Only **3.9% (51 rows) is an actual URL.** Some point at the wrong product: Karaoke's photo cell reads `Khmer Family Dinner`. |
| **Min / max guests** | One cell — `Min 1 ⏎ Max 60`, but also `12 max OR 30 for a private group`. |
| **Bookable online** | `True` 314, `False` 262, **blank 487**, plus `VET`, `Yes`, `Service Provider` leaking in from the transport schema. |
| **`Status` column (AE)** | Not a status. Contains owner names — `DevOps` 288, `T&T / Experience` 117, `QA Test` 11, `Reden` 2. Blank on 879. |
| **Duplicate titles within a location** | **71.** Phnom Penh has `Pool Party & BBQ` twice with conflicting rates (`Free` and `6.0`) in the same category. |

## 7. What this means for the plan

1. **Rate cannot be `numeric NOT NULL` on import.** Keep `rate_raw text` alongside
   `rate_usd numeric`, populate `rate_usd` only where parsing is unambiguous, and route
   the other ~60% to the exceptions queue. The alternative — a human retyping 750 rates
   before anything works — stalls the project.
2. **Budget the migration as its own workstream**, not a task. Roughly 1,300 rows × two
   schemas × colour-encoded status, with an expected exception rate well over half.
3. **Photos are effectively absent.** The "minimum 6 images" rule cannot be enforced
   retrospectively on 96% of the catalogue. It should apply to new and edited products
   only, or Phase 1 ends with 1,200 permanently invalid rows.
4. **Add a fifth category** and a transport route model to the schema.
5. **The exceptions screen is the main GM-facing deliverable of migration**, not a
   by-product — it is where several hundred rows get fixed.

## 8. Additional questions raised by the data

- **Q10 → Kyle.** `Cebu City` is hidden with no live tab. Closed, or an omission?
- **Q11 → Kyle.** One-time events: migrate all 470 (including 2025's), or only forward-dated ones? Recommend forward-dated only, archiving the rest.
- **Q12 → Kyle.** Transport is flagged *Rezdy only, not website*. Does that survive into the new model as `bookable_on_website = false`, or is it a rule of its own?
- **Q13 → Hayley/GMs.** The 71 duplicate titles need a per-location owner to resolve. Which conflicting rate is correct?
- **Q14 → Kyle.** Confirm the 23 live tabs are the true location list — the brief says "24+".


---

## 9. Import result (23 Aug 2026)

The audit above became `tools/extract_flowchart.py` v2 and the import ran against the
live Supabase project:

- **1,206 products imported** (all of them — nothing dropped), 502 with transport route
  details, 156 one-time-event dates, 39 real photo URLs.
- **769 exceptions queued** in the in-app queue (`/settings/imports`): 420 prose rates,
  117 blank active-flags, 113 over-length briefs, 41 unparseable day patterns, 38 unknown
  sections, 18 status conflicts, 22 unparseable event dates.
- Status resolution rule applied: text column wins for Active/Paused; fill colour adds
  `signature`/`pending_update`; conflicts and red delete-flags → paused + exception.

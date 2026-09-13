# MIMO, the Mad Monkey assistant (planned and BUILT 13 Sep 2026)

## The ask (Charlie's Granola notes, plus 13 Sep direction)
- Lives behind a button on the sidebar that opens an assistant, not a bar on the Experiences page.
- Called MIMO. Super clean UI. Give it personality.

## The ask (Granola notes)
- GMs edit experiences through a simple prompt box, e.g. "Change price of Wens Pub to $10".
- AI is the intelligence layer between what the GM typed and the data.
- Handles mismatches (GM says "pub crawl", the product is named differently).
- 2 to 3 step confirmation flow to prevent errors.
- Uses the Anthropic key already live for the itinerary writer.

One clarification on "the sheet": edits land in the tool's database, which is the source of truth. The
old flow chart spreadsheet is not written back to.

## The one rule that makes this safe
**The model never writes.** It reads the GM's product list, turns the sentence into a structured
proposal (which product, which field, old value, new value), and hands it back. The app shows the
proposal, the GM confirms, and the app applies it through the exact same update the table uses today.
So every existing safeguard still fires: the change log, "edited means verify again", the Reden email
queue for website products, the stale flag on assets, and the hostel scoping in the database.

## Flow, step by step
1. **GM opens MIMO** from the sidebar (or Cmd/Ctrl + K) and types: "Pub crawl now $12", "Move karaoke
   to 8pm", "Pause the cooking class", "Beer pong runs Mon Wed Fri". MIMO is a panel, so it works from
   any page, My week included.
2. **The function** (`prompt-edit`, Edge Function, runs as the GM so RLS applies) loads that hostel's
   products (id, title, category, price in USD and local, days, start, finish, status, active, website)
   and sends them with the sentence to Claude, structured output only.
3. **Claude returns a proposal**: one entry per change, each with the matched product, how sure it is
   (exact / likely / unsure), any alternatives, the field, old and new value, and a one line reason. If
   the sentence is ambiguous it returns a question instead ("Which pub crawl, the Tuesday one or the
   Level 2 package?").
4. **Step 1 of confirmation: the card.** MIMO says what it will change, then a card: product, field,
   old → new, in plain words ("Wednesday Pub Crawl · price · $8.00 → $10.00 (฿280 → ฿350)"). Unsure matches show the
   alternatives as chips to pick. The new value is editable on the card before confirming.
5. **Step 2: Confirm.** Big changes need a second explicit "Yes, I'm sure": a price moving more than
   40% or to zero (the same threshold the table already uses), pausing, a rename, a change to a product
   marked as on the website (with the note that Reden gets emailed).
6. **Step 3: Applied, with Undo.** The row updates, a toast confirms, and an Undo link puts the old
   value back with one click. Undo is itself an edit, so the change log shows both.

Several changes in one sentence give one card each; confirm all or one at a time. The conversation
stays in the panel for the session and is not saved.

Because the product list is already in front of the model, MIMO also answers questions for free:
"What runs on a Thursday?", "What's the sunrise tour priced at?", "Which events have no finish
time?". Read-only answers, no card, no confirm. Recommended for phase 1 because it is the thing that
makes MIMO feel like a colleague rather than a form.

## Where MIMO lives, and how it looks (super clean)
- **Sidebar.** One entry under the page list, set apart by a hairline: the monkey head (the real
  `mm-head.png`) and the word MIMO. On the collapsed rail it is the head alone, with the usual hover
  tooltip. Cmd/Ctrl + K opens it from anywhere.
- **The panel.** Slides in from the right, 420px, full height, white, one hairline border, nothing
  floating over the page. Header: the head, "MIMO", the hostel as a small chip, a close cross. That is
  the whole header.
- **Messages.** No chat bubbles. MIMO's lines are plain text on the left with the head shown once per
  group; the GM's lines are short grey chips on the right. Cards sit inline with a hairline border and
  three actions: Confirm, Change (edits the value in place), Cancel. Strong confirms add one line and a
  Yes button. Applied changes collapse to one green line with Undo.
- **Input.** One line at the bottom, "Tell MIMO what to change", Enter sends. Empty state is a
  greeting plus three chips (Change a price, Move a time, Pause something). No help text, no tips
  carousel, no onboarding.
- **Mobile.** Full-screen sheet, same content.
- **Nothing else on any page changes.** No floating bubble, no banner, no badge.

## Personality
MIMO is the sharpest person on the hostel team: knows every tour, every price and every day of the
week, gets things done fast, and has a bit of Mad Monkey cheek without ever making the GM feel daft.

Rules of voice:
- Short. One or two sentences at a time, one question at a time.
- Plain words, British spelling, no em dashes, no emojis, no exclamation mark pile-ups.
- Says what it did, not how clever it was. Never "Great question".
- Honest about limits, and always offers the nearest thing it can do.
- Uses the GM's first name and knows the hostel it is standing in.
- Cheek is light and aimed at the situation, never the person.

Sample lines (the tone to build to):
- Greeting: "Hey Kassy. What needs changing at Siem Reap?"
- Proposal: "Got it. Wednesday Pub Crawl goes from $8 to $10, that's ฿350 at today's rate."
- Unsure match: "Two things look like a pub crawl here. The Wednesday one, or the Level 2 package?"
- Strong confirm: "That's a 60% jump. Sure?"
- Applied: "Done. It's live on the list and Reden gets a note because it's on the website."
- Time shift: "Karaoke now starts at 8pm. I've moved the finish to 11pm so it still runs three hours. Say if that's wrong."
- Can't delete: "Nothing here ever gets deleted, so I've set it to paused instead. It stays in the database and drops out of quotes."
- Off the allow-list: "I can't change the category from here. It's the first dropdown on the product page."
- Not found: "No Sunset Cruise at Siem Reap. Closest I've got is Road 60. Want that?"
- Question: "Thursdays you've got Kulen Waterfalls at 8am, Quad Bike at 4:30pm and Pub Crawl at 8pm."
- Error: "That didn't save. Nothing changed. Try again in a second."

## What MIMO may change (allow-list)
price (USD or local), start, finish, duration, days it runs, status (active / paused / signature /
pending update), active on the ground, listed on website, title, brief description, meeting point,
minimum and maximum guests, expiry date for one-time events.

Not through MIMO: deleting (nothing is ever deleted; "remove X" becomes pause with a note
saying so), changing category, anything at another hostel, anything about quotes, creating a product
(phase 2: "add a Thursday quiz at 8pm" opens the Add product form prefilled, it does not create).

## The logic the app owns (not the model)
- **Currency.** The model reports `{amount, currency}`. The app derives the other side from today's FX
  the same way the rate cell does. The model never does exchange maths.
- **Times.** A new start on its own shifts the finish by the same amount so the duration holds, and the
  card says so ("finish moves to 11pm"). A new finish alone changes the duration.
- **Days.** The model returns the final list; the app shows before and after chips. "Add Saturday" and
  "not on Sundays" are worked out by the model against the current days it was given.
- **Validation before anything is shown**: field must be on the allow-list; product id must be in the
  GM's list; times match HH:MM; days are 1 to 7; numbers are not negative; status is one of the four.
  Anything that fails is dropped with a plain message rather than shown as a card.
- **Rate limit**: 30 prompts per user per hour. **Log**: `prompt_edits` (who, hostel, the sentence, the
  proposal, what happened: applied / cancelled / clarified / rejected, model, tokens). Head office gets
  a small "what GMs asked for" view under Settings, which is also the quality signal for tuning.

## Model
Sonnet 5 for name matching on messy titles ("Wens Pub" against "Wednesday Pub Crawl"), a setting in
`sync_config` (`prompt_model`) like the itinerary. About 4k input tokens per prompt (the product list)
and a few hundred out, roughly $0.01 per prompt on Sonnet, half that on Haiku 4.5 if cost ever matters.
The product list is sent as a cached block so a GM's follow up prompts in the same few minutes cost
less.

## Before it goes to GMs
A 30 sentence test set run against three real hostels (Siem Reap, Phuket, Kuta Lombok): typos, nicknames,
two products with similar names, sentences with two changes, sentences asking for things off the
allow-list. Kept in `tools/data/prompt_eval.json` so the prompt or model can be changed later without
guessing whether matching got worse.

## Build (about 2.5 days)
1. Edge Function `prompt-edit`: product list, prompt, structured output schema, validation, rate limit,
   log row. Half a day.
2. The panel: sidebar entry, slide-over, messages, cards, alternatives, confirm and strong confirm,
   apply via the existing update, Undo, keyboard shortcut, mobile sheet. One day.
3. `prompt_edits` table + Settings view. Quarter of a day.
4. The test set and a tuning pass on the real product names. Quarter of a day.

## Decisions needed
- D1 Who sees it: GMs and head office (recommended). Sales can't edit products, so not them.
- D2 Renames through the prompt box: allowed with the strong confirm (recommended), or product page only.
- D3 Creating products by prompt: phase 2 as a prefilled form (recommended), or never.
- D4 Model: Sonnet 5 (recommended) or Haiku 4.5.
- D5 Questions as well as edits in phase 1 (recommended, no extra cost) or edits only.

## Built 13 Sep 2026
- Edge Function `mimo` (Sonnet 5, structured output, product list + known nicknames as cached blocks,
  30 prompts per user per hour, `prompt_edits` log). The model returns a proposal; the function validates
  every field and value, works out FX, the finish shift and the strong-confirm reasons, and returns a
  patch + undo per change. It never writes.
- Panel `src/components/app/Mimo.tsx`: sidebar entry with the monkey head (⌘K), right slide-over, no
  bubbles, cards with Confirm / Change / Cancel, strong confirm, applied line with Undo, greeting by first
  name (placeholder accounts get no name), example chips.
- Meet MIMO: three screens plus a "try one" example on first open, stored on the profile.
- Learning: `product_aliases` per hostel, written only by `learn_alias()` from a confirmed action (the
  words the GM used, tied to the product they confirmed, or the alternative they picked). Known
  nicknames go into the next prompt as exact matches. MIMO does not change her own rules.
- Verified as Kassy (Siem Reap): question answered from the list, price proposal → confirm → row updated
  and Reden note queued → undo restored it; "delete" refused with pause offered; category change refused
  with the product page offered; a two-change sentence gave two cards.
Not built yet: head-office view of `prompt_edits` under Settings, the 30-sentence eval set, creating
products by prompt (phase 2).

### Added later on 13 Sep 2026
- **Thinking state.** While MIMO works, the head bobs and a line in the Mad Monkey voice rotates every
  2.4s ("Checking the going rate at Siem Reap", "Getting the monkeys in a row"). The pool is picked from
  what was asked (price, time, pause, question), then the general lines. Replies ease in. All of it
  respects reduced-motion. Lines live in `LINES` in `Mimo.tsx`.
- **Context awareness.** The function gets a NOW block (weekday, date and time in the hostel's timezone,
  tomorrow's weekday) and where the GM is (page, or the product page they are on, so "this one" and a bare
  "price 12" land on it). History is the last 12 turns. Persona has CONVERSATION and ANSWERS rules:
  follow-ups ("push it back an hour" after a time answer), corrections, "what about Wednesday", only the
  fields the question needs, "tonight" from 5pm, paused and expired are not on, times as 8pm not 20:00.
  NOW is the last system block and uncached so the persona and product list still cache.
- **Model override for evals.** Body `model` is honoured for admin and head office only, from an
  allow-list (Sonnet 5, Opus 5, Haiku 4.5). GMs always get `sync_config.prompt_model` or the default.
- **Eval script.** `node tools/mimo_eval.mjs "Siem Reap"` with `MIMO_EVAL_EMAIL` / `MIMO_EVAL_PASSWORD`
  runs the scenarios on Sonnet 5 and Opus 5 and writes `tools/data/mimo_eval_<date>.json`. Read-only:
  MIMO never writes to products. First run 12 Sep 2026 (UTC): both models correct on all five; Opus fuller
  on "what's on tonight" (Sonnet missed Pool BBQ), Opus put a card with alternatives on the ambiguous
  one where Sonnet only asked; latency similar (4 to 12s). Staying on Sonnet 5.
- **Fullscreen.** A toggle in the panel header (Maximize icon) widens the slide-over to the whole screen
  with the conversation and input in a centred column; remembered per browser (`mm.mimo.wide`). Hidden on
  phones, where the panel is already full width.
- **Run sheets.** The NOW block carries today's and tomorrow's run sheet (active, non-transport products
  on that weekday, one-time events only on their expiry date, in start-time order), worked out in the
  function, so "what's on tonight" is complete and never invents a one-off. Function v5.
- **Greeting.** Panel and walkthrough open with Good morning / afternoon / evening plus the first name,
  on the GM's own clock (morning to noon, afternoon to 5pm, evening after), recomputed on each open.
- **Hourly cap.** 120 prompts per person per hour (was 30, which an eval run plus normal use hit on the
  admin login). The cap message now says it is the cap, that questions count too, and when it clears.
- **Caching policy (function v7).** Caching is time-based, never per N prompts. Persona and the hostel's
  product list are cached for 1 hour and hold nothing user-specific, so every person at that hostel
  shares one entry. NOW (time to the hour, GM name, page, run sheets) is uncached and last. A 5-minute
  breakpoint sits on the last message so a multi-turn chat only pays for the new turn. A product edit
  changes the product block and rewrites it; that is inherent. Cap: 200 prompts per person per hour.

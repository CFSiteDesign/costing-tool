# AI prompt box for GMs (planned 13 Sep 2026)

## The ask (Charlie's Granola notes)
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
1. **GM types** into a bar above the Experiences table: "Tell me what to change…". Examples appear on
   focus ("Pub crawl now $12", "Move karaoke to 8pm", "Pause the cooking class", "Beer pong runs Mon
   Wed Fri").
2. **The function** (`prompt-edit`, Edge Function, runs as the GM so RLS applies) loads that hostel's
   products (id, title, category, price in USD and local, days, start, finish, status, active, website)
   and sends them with the sentence to Claude, structured output only.
3. **Claude returns a proposal**: one entry per change, each with the matched product, how sure it is
   (exact / likely / unsure), any alternatives, the field, old and new value, and a one line reason. If
   the sentence is ambiguous it returns a question instead ("Which pub crawl, the Tuesday one or the
   Level 2 package?").
4. **Step 1 of confirmation: the card.** "Here's what I'll change" with product, field, old → new, in
   plain words ("Wednesday Pub Crawl · price · $8.00 → $10.00 (฿280 → ฿350)"). Unsure matches show the
   alternatives as chips to pick. The new value is editable on the card before confirming.
5. **Step 2: Confirm.** Big changes need a second explicit "Yes, I'm sure": a price moving more than
   40% or to zero (the same threshold the table already uses), pausing, a rename, a change to a product
   marked as on the website (with the note that Reden gets emailed).
6. **Step 3: Applied, with Undo.** The row updates, a toast confirms, and an Undo link puts the old
   value back with one click. Undo is itself an edit, so the change log shows both.

Several changes in one sentence give one card each; confirm all or one at a time. Clarifications are a
short back and forth (at most three turns) kept in the page, not saved as a conversation.

## What the prompt box may change (allow-list)
price (USD or local), start, finish, duration, days it runs, status (active / paused / signature /
pending update), active on the ground, listed on website, title, brief description, meeting point,
minimum and maximum guests, expiry date for one-time events.

Not through the prompt box: deleting (nothing is ever deleted; "remove X" becomes pause with a note
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

## Build (about 2 days)
1. Edge Function `prompt-edit`: product list, prompt, structured output schema, validation, rate limit,
   log row. Half a day.
2. Experiences page: the bar, proposal cards, alternatives, confirm and strong confirm, apply via the
   existing update, Undo. Three quarters of a day.
3. `prompt_edits` table + Settings view. Quarter of a day.
4. The test set and a tuning pass on the real product names. Quarter of a day.

## Decisions needed
- D1 Who sees it: GMs and head office (recommended). Sales can't edit products, so not them.
- D2 Renames through the prompt box: allowed with the strong confirm (recommended), or product page only.
- D3 Creating products by prompt: phase 2 as a prefilled form (recommended), or never.
- D4 Model: Sonnet 5 (recommended) or Haiku 4.5.

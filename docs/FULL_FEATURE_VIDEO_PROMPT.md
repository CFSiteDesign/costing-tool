# Claude Design prompt: Experience Database full feature tour (video)

Upload with this prompt (all in Downloads › Full feature video): screenshots `01` to `13` and `mm-logo.png`,
`mm-logo-white.png`, `mm-head.png`. The products, names and numbers inside the screenshots are sample data: copy the
layout and styling, never their content. `10` is an example booking request made with test data.

---

Make a 4 to 5 minute feature tour video, 16:9, of the Mad Monkey Experience Database (mm-costing-tool.vercel.app),
covering everything it does, for everyone who uses it: hostel general managers (GMs), head office, and the sales team
who build group trip quotes. Clear, quick and warm, a bit of Mad Monkey cheek, never corporate, never "AI magic".
Organise it in chapters by who uses each part, with a chapter card for each.

Before designing, fetch https://design.madmonkeyhostels.com/llms.txt and follow it for every branded frame (open,
chapter cards, close). Its rules override this brief.

## Everything it does (all true; do not add features, numbers or screens)

**The basics**
- One place for every tour, nightly event, one-off party and transfer at all 23 Mad Monkey hostels, with prices, days
  and times: 1,355 products, 772 experiences running and 497 transport options.
- Roles: GMs see and edit only their own hostel (a dropdown switches if they run more than one). Head office sees and
  edits every hostel. Sales see every hostel and build quotes. Admins also manage settings. Quotes are hidden from GMs.
- Logins: the system emails each person their own link (from updates@experience.madmonkeyhostels.com, subject "Your
  login for the Mad Monkey Experience Database"). It opens "Choose your password" and works for 7 days.
- Every change is logged with who made it and the before and after. Nothing is ever deleted, only paused.
- A guided tour runs on first sign-in and can be replayed from the menu under your name.

**For GMs** (screenshots 01 to 08)
- Experiences: the full list with search, category and status filters, and day letters (M T W T F S S) to see what
  runs on a given day. Change prices, days and status right in the table. Columns show whether each one is on the
  website, active, and verified.
- Experience page: everything else (descriptions, meeting point, inclusions, guest numbers, photo album). Nothing saves
  until "Save". Every edit clears the verified date; "Mark verified" (the shield) once checked. A "Social asset" button
  opens Mad Monkey Studio with the experience's details filled in.
- Add product: Title, Category, Rate ("0 = free", local currency or USD), Brief description (95 characters, goes on
  the website word for word), Days it runs, Start and Finish, guest limits, meeting point, inclusions, things to bring,
  photo album, "Starts as" Active or Paused, "One-time event" with a date (drops off afterwards), "Bookable on the Mad
  Monkey website".
- The Assistant (bottom of the menu, or Cmd K; has a fullscreen mode): greets you by name and time of day. Type a
  change in plain words ("move pub quiz to 830"); it shows a card, old value to new, and nothing changes until
  "Confirm". "Undo" puts it back. Big changes ask "Yes, I'm sure". It answers questions from the hostel's list ("What's
  on tonight?"), answers Mad Monkey brand and marketing questions from the marketing team's knowledge, learns the
  nicknames your team uses, only sees your hostel and never deletes ("delete" becomes "pause").
- Global events: when head office launches one, it waits at the top of Experiences and the GM gets an email. "Accept",
  "Edit" (own price, time or days first) or "Decline".
- My week: what runs each day in start-time order. Mark up to 3 "Key" events a day (they stay key every week).
- Weekly story: turns the key events into a 1080 x 1920 Instagram story ("MAD MONKEY KOH RONG", "THIS WEEK.", an "ALL
  IN" sticker). A "Quick changes" box takes plain words like "Remove Tuesday's quiz"; "Undo", "Rebuild", "Download
  story (PNG)".
- Transport: every bus, boat and transfer with routes, departure times and prices.
- Activity: every change, who made it and when, before and after.
- "Export" downloads the list as a spreadsheet.

**For head office** (screenshots 12 and 13)
- Global events: "New global event" with Title, Category, Rate (blank means each hostel sets its own), Event date,
  Expires on, Start and Finish, descriptions, inclusions, things to bring, photo album, up to 6 asset links and a
  "Message to GMs". Sent to every hostel at once, GMs are emailed, and the page shows who accepted, declined or hasn't
  replied.
- Approvals: changes picked up from the old flow chart, and suggested start and finish times, wait here. Nothing
  changes on an experience until it's approved; approve or reject one at a time or in bulk.
- Changes to anything sold on the website are queued for Reden, who updates the website.

**For sales: the costing tool** (screenshots 09, 10, 11)
- Quotes list: search, filter by country and month, status, versions and latest total. "New quote" with the
  customer's contact, company, email and country. Any quote can be duplicated as a template.
- "Auto-create trip": trip title, pax, room type for every night, breakfast every night, then the stops in order with
  first night and number of nights. Out comes a whole day-by-day trip with stays, breakfast and each day's experiences
  to tick. Two things at the same time can't both be ticked.
- The builder: each day has a hostel and a date. Add a Stay (room type and season; the rate comes from the rate sheet,
  which syncs every night), Breakfast, an Experience (only what runs at that hostel on that weekday, with a warning if
  the group is too big or too small), Transport (by departure time) or a Custom item. Copy stay and breakfast to the
  next day, drag to reorder, edit quantities and prices inline.
- Pricing: per person times the number of travellers. Discount or comp any line (logged against your name), add a
  whole-quote discount, and see totals by category, per person and total saved.
- Notes: booking notes at the top, a note under each day and under each item. Shown on the client's quote only when
  filled in.
- "Generate agreement version": freezes every price into a numbered version with a share link the client can open or
  print. Later changes never alter a sent version.
- "Detailed itinerary": writes a client-friendly day-by-day itinerary from the quote (intro, the vibe, hour by hour,
  highlights, inclusions, transfers, notes) in under a minute. Edit it, then share the link or print it.
- Status: Draft, Sent, Accepted, Cancelled, or "Mark accepted" on the version the client agreed to.
- "Booking request": the internal document for Reservations, built from the accepted version. It asks for the agent,
  guest names, nationality, email and WhatsApp, and the payment deadline (30 days before arrival by default), then
  downloads as a PDF with accommodation, tours, notes and pricing, discounts listed separately (screenshot 10).
- Payment reminder: the Mad Monkey contact gets an email 7 days before the payment deadline, unless it's marked paid.

**Behind the scenes (admins)**
- Room rates sync every night from the rate sheet; exchange rates refresh daily, with manual overrides.
- ALL IN trip bookings sync in every 5 minutes, and other Mad Monkey apps can read a guest's trip with their own key,
  made and revoked in Settings.
- The email key lives in Settings, stored encrypted.

## Real content to show on screen
Use Koh Rong's real weekly timetable for the GM chapter: Sunday 2:30pm Volleyball Tournament, 6:30pm Meet-Up & Raffle,
7:30pm Fire Show, 8pm Pub Quiz, 10pm Dance Party. Assistant example: "move pub quiz to 830" with the card "Pub Quiz
moves to 8:30pm to 10:30pm, keeping the same two hours. Confirm below." then "Done: Pub Quiz, start 20:00 → 20:30."
with Undo. Global event example: "Halloween Party · 31 Oct". For the sales chapter use a made-up trip, "Bangkok and
Chiang Mai, 2 travellers, 18 to 22 January 2027", total $430.58.

## Structure (about 4 to 5 minutes, keep the order)
1. Open (0 to 10s). Brand frame, white logo file, "The Experience Database". Voice: "Every experience Mad Monkey runs,
   across 23 hostels, in one place. Here's everything it does."
2. The basics (10 to 30s). Roles, logins by email, nothing deleted, everything logged.
3. Chapter: For GMs (30s to 2:10). List, experience page and verify, add product, the Assistant (change, question,
   brand question), global events, My week, weekly story, transport, activity, export.
4. Chapter: For head office (2:10 to 2:45). New global event and the replies, approvals, website changes for Reden.
5. Chapter: For sales (2:45 to 4:15). Quotes list, auto-create trip, the builder, pricing and discounts, notes,
   agreement version, detailed itinerary, mark accepted, booking request PDF, payment reminder.
6. Behind the scenes (4:15 to 4:35). Rates synced nightly, ALL IN bookings, keys and settings.
7. Close (4:35 to 4:50). Brand frame, logo, "mm-costing-tool.vercel.app". Voice: "One list, always current.
   Everything else reads from it."

Write a voice-over line for every scene, plain and short, in the order above.

## Look and feel
- App screens look like the uploaded screenshots: white background, near-black text #1A1A18, light grey sidebar,
  Inter typeface, hairline borders, small rounded status chips. Mad Monkey yellow #FFC72E is the only accent in the
  app. Animate as a clean screen recording: visible cursor, soft zooms, a highlight ring on the button being pressed.
- For the few screens without a screenshot (the quote builder with lines, the detailed itinerary, settings), build
  simple mockups in the same style using only the labels in this brief. Never invent buttons or features.
- Brand frames follow llms.txt: Mad Black #0a0a0a, Montserrat, lime #ccff01 and pink #ff01aa used sparingly, the
  "ALL IN" sticker at most once. Logo files placed as real images, never redrawn or recoloured.
- Motion quick and tidy. No particles, glows, robots or brain imagery.
- One friendly voice, unhurried, easy for non-native English speakers. Captions on throughout.

## Copy rules
British spelling. Short sentences. No em dashes anywhere (use commas or full stops). No emojis. At most one
exclamation mark in the whole video. Never call the Assistant or the itinerary writer "AI-powered", "smart" or
"magic", and never say they "think" or "understand". Never show a change happening without a "Save" or "Confirm"
press. Use the exact button names from this brief.

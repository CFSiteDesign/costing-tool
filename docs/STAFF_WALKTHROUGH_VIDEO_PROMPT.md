# Claude Design prompt: Experience Database staff walkthrough video

Upload these with the prompt (all in the "Staff walkthrough video" folder in Downloads):
- `01-experiences-list.png` to `08-assistant-panel.png`: real screenshots of every screen GMs use. The products in
  them are sample data (Siem Reap, "Sam Taylor"); copy the layout and styling, not those names.
- `mm-logo.png` (Mad Monkey logo, dark), `mm-logo-white.png` (logo for dark backgrounds), `mm-head.png` (the monkey
  head used as the Assistant's icon).

---

Make a 2 minute 45 second to 3 minute walkthrough video, 16:9, for Mad Monkey Hostels staff: the general managers
(GMs) who run the hostels across Southeast Asia. It teaches them how to use the Experience Database, the web app at
mm-costing-tool.vercel.app where every hostel keeps its tours, nightly events, one-off parties and transport, with
prices, days and times. The viewers are busy hostel managers, not tech people, and many speak English as a second
language. Keep it clear, warm, quick and a bit cheeky, like a good team brief. It only explains how the software works: no questions, requests or calls to action. Never corporate, never "AI magic".

Before designing any Mad Monkey branded frame, fetch https://design.madmonkeyhostels.com/llms.txt and follow it. Its
rules override this brief for brand frames (open, chapter cards, close).

## What the app does for a GM (all true, do not add features)

**Getting in**
- Each GM gets an email from updates@experience.madmonkeyhostels.com, subject "Your login for the Mad Monkey
  Experience Database". The link opens a page titled "Choose your password": type it twice ("Same again"), press
  "Save and go in", and they are in. The link works for 7 days.
- After that they sign in at mm-costing-tool.vercel.app with their work email and password.
- A GM only sees their own hostel. If they run more than one (for example Hanoi and Hoi An), a hostel dropdown at the
  top left switches between them.
- The first time they sign in, a short guided tour runs. They can replay it from the menu under their name.

**The left menu (what GMs see):** Experiences, My week, Transport, Activity, and Assistant at the bottom.

**Experiences: the full list**
- Every tour and event at the hostel in one table: Title, Category, Rate, Days, Times, Status, Website, Active,
  Verified.
- Search box, category and status filters, and day letters (M T W T F S S): tap a day to see what runs that day.
- Prices, days and status can be changed right in the table.
- Click a name to open its page with everything else (descriptions, meeting point, inclusions, guest numbers, photo
  album). Nothing saves until they press "Save". The page shows "Unsaved changes" until then, and "All changes saved"
  after.
- Every edit clears the verified date ("needs verifying"). Once they have checked the details, they press
  "Mark verified" (the shield).
- To stop something running: switch off Active, or set Status to Paused. Nothing is ever deleted, so it can always
  come back.
- "Export" downloads the hostel's list as a spreadsheet.

**Adding a new event** (the most important how-to, show it step by step)
1. Experiences, then "Add product" at the top right.
2. Title, the name guests see.
3. Category: Nightly Events for anything the hostel runs itself; MM Tours, 3rd Party Tours or Transport for the rest.
4. Rate: price per person, "0 = free". It can be typed in the local currency or USD.
5. Brief description: one line, 95 characters at most (a counter shows 0/95). It goes on the website word for word.
6. Days it runs (tap the day letters), then Start and Finish.
7. Extras: long description, meeting point and time, inclusions, things to bring, min guests and max guests per day,
   photo album link (at least 6 images).
8. "Starts as": Active (running now) or Paused (ready, not running yet).
9. One-off party like Halloween? Switch on "One-time event" and pick the date. It drops off by itself afterwards.
10. "Bookable on the Mad Monkey website" only if guests can book it online.
11. Press "Add product". If anything required is missing, it says so before saving.

**The Assistant** (bottom of the left menu, or Cmd K on any page; it has a fullscreen button)
- It greets them by time of day and name: "Good morning, Sam. What needs changing at Koh Rong?"
- They type what has changed in plain words, like texting a colleague. Typos and nicknames are fine.
- It shows a card with the change spelled out, old value to new value, and waits. Nothing changes until they press
  "Confirm". Big changes (pausing, renaming, a large price jump) ask "Yes, I'm sure" first.
- After confirming: "Done: Pub Quiz, start 20:00 → 20:30." with an "Undo" link.
- It answers questions from the hostel's own list: "What's on tonight?", "What runs on Saturday?", "How much is beer
  pong?"
- It also answers Mad Monkey brand and marketing questions (brand voice, captions, hashtags, logos, promo codes)
  from the marketing team's guide, and points them to Lexie's team when it does not know.
- It remembers the nicknames the team uses. Confirm "the quiz" once and next time it knows.
- It can change: price, start and finish times, length, days, status, active, website listing, name, brief
  description, meeting point, guest limits and expiry date. New products are made with "Add product"; category
  changes are made on the product page.
- It never changes anything without "Confirm", never deletes ("delete" becomes "pause"), and only sees the GM's own
  hostel.

**Events from head office (global events)**
- When head office launches an event for every hostel (Halloween, Oktoberfest), it waits at the top of the
  Experiences page ("1 global event waiting for your answer") and the GM gets an email about it.
- Three buttons: "Accept" adds it to their list as it is; "Edit" lets them set their own price, time or days first;
  "Decline" if they are not running it. Head office sees who said what.

**My week and the weekly story**
- My week shows everything running each day this week, in start-time order, with arrows to move between weeks.
- They can mark up to 3 "Key" events a day. Key events stay key on that day every week until switched off.
- "Weekly story" turns the key events into an Instagram story (1080 x 1920): black background, "MAD MONKEY KOH RONG",
  the big headline "THIS WEEK.", a pink "ALL IN" sticker, and each day's key events with times.
- A "Quick changes" box takes plain words like "Remove Tuesday's quiz" or "headline BIG WEEK". "Undo" and "Rebuild"
  are there too, then "Download story (PNG)".

**Also**
- Transport: every transfer, bus and boat, with routes, departure times and prices.
- Activity: every change, who made it and when, with the before and after. It is the safety net.
- Website: the Mad Monkey website is updated by head office (Reden), so anything sold on the website that changes
  is passed to him.

## Real content to use on screen (Koh Rong's actual weekly timetable)
- Sunday: 2:30pm Volleyball Tournament, 6:30pm Meet-Up & Raffle, 7:30pm Fire Show, 8pm Pub Quiz, 10pm Dance Party.
- Monday: 2:30pm Beach Olympics, 6:30pm Meet-Up & Raffle, 7:30pm Beer Pong, 8pm Music Bingo, 10pm Dance Party.
- Wednesday: 2:30pm Beach Football, 7:30pm Fire Show, 8pm Guess Game.
- Saturday: 2:30pm Volleyball Day, 4pm Saturday Meet-Up, 6:30pm Saturday Beer Pong, 8pm Karaoke Night.
- New event to add in the how-to: "Sunset Hour - DJ", Nightly Events, Sun Tue Thu, 4pm to 5pm, starts as Paused.
- Assistant change: the GM types "move pub quiz to 830". Card: "Pub Quiz moves to 8:30pm to 10:30pm, keeping the same
  two hours. Confirm below." Then "Done: Pub Quiz, start 20:00 → 20:30." with Undo.
- Assistant question: "What's on tonight?" (a Sunday). Reply: "Tonight: Volleyball Tournament 2:30pm, Meet-Up &
  Raffle 6:30pm, Fire Show 7:30pm, Pub Quiz 8pm, Dance Party 10pm."
- Assistant delete request: "Nothing gets deleted here, so I'll pause Beach BBQ instead."
- Global event: "Halloween Party · 31 Oct · 20:00–02:00 · $15", with Edit, Accept, Decline.

## Structure (adjust timing, keep the order)
1. Open (0 to 8s). Brand frame: Mad Black, the white logo file, "The Experience Database". Voice: "Every tour,
   event and transfer your hostel runs. One place. Here's how it works."
2. Getting in (8 to 22s). The welcome email, the "Choose your password" page, then the Experiences page. Voice:
   "Your login comes by email. Choose a password, and you're in. Got two hostels? Switch at the top left."
3. Your list (22 to 45s). Experiences table: tap a day letter, change a price in the table, open a product, press
   Save, then the shield. Voice: "This is your list. Change prices and days right in the table, or open one for
   the details. Nothing saves until you press Save, and once you've checked it, mark it verified."
4. Add a new event (45 to 80s). Fill in Sunset Hour - DJ field by field, highlight the 95 character counter, set
   Paused, press Add product. Voice: "Something new on? Add product. Name, category, price, one short line for the
   website, days and times. Paused if it isn't running yet. Done."
5. The Assistant (80 to 112s). Open it, the greeting, type "move pub quiz to 830", the card, Confirm, Done with
   Undo. Then "What's on tonight?" with the run sheet. Voice: "Or just tell the Assistant. Type it like a text. It
   shows you the change first, and nothing moves until you confirm. Ask it what's on tonight, or a brand question,
   too."
6. Global events (112 to 126s). The Halloween banner, Edit to set the price, Accept. Voice: "When head office
   launches an event for every hostel, it waits at the top. Accept it, tweak it for your crowd, or decline."
7. My week and the story (126 to 148s). My week, tick Key on three events, Weekly story, type "Remove Tuesday's
   quiz", Download. Voice: "My week shows what's on, day by day. Mark your key events and the weekly Instagram
   story builds itself."
8. The safety net (148 to 165s). Activity log, then four quick cards: "Nothing changes until you Save or Confirm",
   "Nothing is ever deleted, pause it instead", "Every change is logged", "Sold on the website? Reden updates it". Voice:
   "You can't break it. Nothing's deleted, every change is logged, and nothing happens until you say so."
9. Close (165 to 175s). Brand frame with the logo file and "mm-costing-tool.vercel.app". Voice: "That's the
   Experience Database. One list for your hostel, always current."

## Look and feel
- App screens must look like the uploaded screenshots: white background, near-black text #1A1A18, light grey
  sidebar, Inter typeface, hairline borders, small rounded status chips (green Active, blue Signature, orange
  Pending and Paused). Mad Monkey yellow #FFC72E is the only accent in the app (active menu item, the Key pill).
  Animate them as a clean screen recording: a visible cursor, a soft zoom on the part that matters, a highlight ring
  on the button being pressed. Never invent buttons or screens that are not in the screenshots or this brief.
- Brand frames (open, chapter titles, close) follow the Mad Monkey design system from llms.txt: Mad Black #0a0a0a,
  Montserrat, lime #ccff01 and pink #ff01aa, the "ALL IN" sticker used once at most. Place the logo files as real
  images; never redraw, recolour or restyle the logo or the monkey head.
- Motion: quick and tidy. No particles, no glowing effects, no robots or brains, no "AI" imagery.
- Sound: light, upbeat, hostel common-room energy. One friendly voice, unhurried, easy to follow for non-native
  English speakers.
- Captions on throughout, short plain sentences, matching the voice-over.

## Copy rules
British spelling. Short sentences. No em dashes anywhere, use commas or full stops. No emojis. At most one
exclamation mark in the whole video. Never call the Assistant "AI-powered", "smart" or "magic", and never say it
"thinks" or "understands". Say what it does. Never show a change happening without a "Save" or "Confirm" press.
Use the exact button names from this brief.

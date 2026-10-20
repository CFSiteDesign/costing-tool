# Claude Design prompt: how the Experience Database works for GMs (slideshow with speaker notes)

Upload with this prompt: the 8 screenshots `01-experiences-list.png` to `08-assistant-panel.png` (the products in
them are sample data: use the layout, not the names) and `mm-logo.png`, `mm-logo-white.png`, `mm-head.png`.

---

Make a 13 slide presentation, 16:9, with speaker notes on every slide, that explains how the Mad Monkey Experience
Database (mm-costing-tool.vercel.app) works for hostel general managers (GMs). It is presented live on a video call.
The only job of the deck is to explain how the software works: no questions slide, no to-do list, no requests, no
status updates, no decisions. The audience are busy hostel managers, many with English as a second language: one idea
per slide, very few words on the slide, big and readable on a shared screen. The speaker notes carry the explanation.

Before designing, fetch https://design.madmonkeyhostels.com/llms.txt and follow it for every branded element. Its
rules override this brief.

## Look
- Mad Monkey core brand from llms.txt: Mad Black #0a0a0a, Montserrat, lime #ccff01 and pink #ff01aa as accents, used
  sparingly. Place the logo files as real images; never redraw, recolour or restyle the logo or the monkey head.
- Screenshot slides: use the uploaded screenshots as real images, never redrawn. Crop or zoom to the part that matters
  and add a simple highlight ring or arrow on the button being explained. Keep at least 40% of these slides for the
  screenshot.
- Headings short and bold. At most 4 short lines of text on any slide. No paragraphs on slides.
- No emojis, no em dashes (use commas or full stops), British spelling, no "AI-powered", "smart" or "magic".

## How it works (all true, do not add features)
- Every tour, nightly event, one-off party and transfer at all 23 hostels, with prices, days and times, lives in one
  place. Head office quotes and the Mad Monkey website are kept in line with it.
- Getting in: each GM gets an email from updates@experience.madmonkeyhostels.com, subject "Your login for the Mad
  Monkey Experience Database". The link opens "Choose your password" and works for 7 days. After that, sign in at
  mm-costing-tool.vercel.app with your work email. More than one hostel? A dropdown at the top left switches.
- Left menu: Experiences, My week, Transport, Activity, and the Assistant at the bottom (Cmd K opens it anywhere).
- Experiences: the full list, with search, filters and day letters (M T W T F S S) to see what runs on a given day.
  Change prices, days and status right in the table, or click a name for everything else. Nothing saves until "Save".
  Every edit clears the verified date; "Mark verified" (the shield) once checked. To stop something, switch off Active
  or set it to Paused. Nothing is ever deleted.
- Add a new event: "Add product", then Title, Category (Nightly Events for anything the hostel runs), Rate ("0 =
  free", local currency or USD), Brief description (95 characters, goes on the website word for word), Days it runs,
  Start and Finish, Active or Paused, "One-time event" with a date for one-offs (it drops off afterwards), "Bookable on
  the Mad Monkey website" only if sold online, then "Add product".
- The Assistant: type a change in plain words ("move pub quiz to 830"). It shows a card, old value to new, and nothing
  changes until "Confirm". "Undo" puts it back. It answers questions about your list ("What's on tonight?") and Mad
  Monkey brand and marketing questions (captions, hashtags, logos, promo codes). It only sees your hostel, never
  deletes, and learns your team's nicknames for things.
- Events from head office: when head office launches an event for every hostel, it waits at the top of Experiences
  and you get an email. "Accept" adds it as it is, "Edit" lets you set your own price or time first, "Decline" if
  you're not running it.
- My week: what's on each day in time order. Mark up to 3 "Key" events a day; they stay key every week.
- Weekly story: turns the key events into a 1080 x 1920 Instagram story. A "Quick changes" box takes plain words like
  "Remove Tuesday's quiz"; then "Download story (PNG)".
- Transport: every transfer, bus and boat with departure times and prices. Activity: every change, who made it and
  when, with before and after. "Export" downloads your list as a spreadsheet.
- Website: Reden updates the Mad Monkey website, so anything sold online that changes is passed to him.

## Slides (title, what is on the slide, then speaker notes)

1. **The Experience Database** (title slide). Logo, "How it works for GMs".
   Notes: This is the Experience Database. In the next few minutes I'll show you how it works: how to get in, the
   five things you'll use, and the few rules that keep everything safe.

2. **One place for everything your hostel runs.** Three big numbers: 23 hostels, 772 experiences, 497 transport
   options.
   Notes: Every tour, nightly event, one-off party and transfer you run, with prices, days and times, lives here. It
   replaces the old flow chart spreadsheet. Head office builds group quotes from it, and the website is kept in line
   with it, so when your list is right, everything else is right.

3. **Getting in.** The email subject line, "Choose your password", the web address.
   Notes: Your login arrives by email from updates@experience.madmonkeyhostels.com, called "Your login for the Mad
   Monkey Experience Database". The link lets you choose your own password and works for seven days. After that you
   sign in at mm-costing-tool.vercel.app with your work email. If you run more than one hostel, a dropdown at the top
   left switches between them.

4. **Your screen.** Screenshot 01 with the left menu ringed.
   Notes: Five things down the left. Experiences is your full list. My week is what's on each day. Transport is your
   transfers. Activity is the change log. And the Assistant sits at the bottom.

5. **Your list.** Screenshot 01, the table and the day letters ringed.
   Notes: Experiences shows everything at your hostel. Search for something, filter by category or status, or tap a day
   letter to see what runs on, say, a Monday. You can change a price, the days or the status right here in the table.

6. **Every detail, saved when you say so.** Screenshot 03, "Save" and the shield ringed.
   Notes: Click a name to open everything else: descriptions, meeting point, inclusions, guest numbers, photos.
   Nothing saves until you press Save. Every edit clears the verified date, so once you've checked the details, press
   the shield to mark it verified. If something stops running, pause it. Nothing ever gets deleted, so it can always
   come back.

7. **Adding a new event.** Screenshot 02, the 0/95 counter ringed. Corner tag: "Live demo".
   Notes: [Switch to the app.] Experiences, Add product. Give it a name and a category: Nightly Events for anything you
   run yourselves. Add the price, zero if it's free. One short line for the brief description, 95 characters, because
   it goes on the website word for word. Pick the days and times. Paused if it isn't running yet. For a one-off party,
   switch on One-time event and pick the date, and it drops off by itself afterwards. Only switch on the website
   option if guests can book it online. Then Add product.

8. **Or just tell the Assistant.** Screenshot 08, plus the lines "move pub quiz to 830" and "What's on tonight?".
   Corner tag: "Live demo".
   Notes: [Open the Assistant.] You can also just type what's changed, the way you'd text a colleague. It shows you
   exactly what will change and waits. Nothing happens until you press Confirm, and Undo puts it back. It answers
   questions about your list, and Mad Monkey brand questions like which hashtags to use. It only sees your hostel,
   never deletes anything, and learns the nicknames your team uses.

9. **Events from head office.** The banner "1 global event waiting for your answer" with Accept, Edit, Decline.
   Notes: When head office launches an event for every hostel, like Halloween, it waits at the top of your
   Experiences page and you get an email about it. Accept adds it to your list as it is. Edit lets you set your own
   price or time first. Decline tells head office you're not running it.

10. **My week and key events.** Screenshot 04, the Key column ringed.
    Notes: My week shows everything running each day this week, in time order. Mark up to three Key events a day.
    They stay key on that day every week until you switch them off.

11. **Your weekly story, made for you.** Screenshot 05.
    Notes: Weekly story turns your key events into this week's Instagram story, sized and branded. Type quick changes
    in plain words, like "Remove Tuesday's quiz", then download it.

12. **Transport, Activity and Export.** Screenshots 06 and 07, the Export button in a corner.
    Notes: Transport lists every bus, boat and transfer with its departure times and price. Activity shows every
    change, who made it and when, with the before and after. And Export downloads your whole list as a spreadsheet.

13. **The ground rules.** Four short cards: "Nothing changes until you Save or Confirm", "Nothing is ever deleted,
    pause it", "Every change is logged", "Sold on the website? Reden updates it". Logo and mm-costing-tool.vercel.app
    along the bottom.
    Notes: Four things to remember. Nothing changes until you press Save or Confirm. Nothing is ever deleted, you pause
    it instead. Every change is logged with your name. And anything sold on the website is passed to Reden, who keeps
    the website up to date. That's the Experience Database.

## Notes rules
Write the speaker notes as the presenter explaining, warm and plain, short sentences, no jargon. Keep each slide's
notes under 120 words. Keep the bracketed demo cues ([Switch to the app.], [Open the Assistant.]) exactly as written.
No questions, requests or calls to action anywhere in the slides or notes.

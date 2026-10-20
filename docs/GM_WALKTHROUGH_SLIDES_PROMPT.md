# Claude Design prompt: GM walkthrough slideshow with speaker notes

Upload with this prompt (same "Staff walkthrough video" folder in Downloads): the 8 screenshots
`01-experiences-list.png` to `08-assistant-panel.png` (the products in them are sample data: use the layout, not the
names) and `mm-logo.png`, `mm-logo-white.png`, `mm-head.png`.

---

Make a 14 slide presentation, 16:9, with speaker notes on every slide. Charlie Fagan presents it live on a video call
today (Tuesday 20 October 2026) to the Mad Monkey Hostels general managers (GMs) across Southeast Asia, to walk them
through the Experience Database at mm-costing-tool.vercel.app. Around 20 minutes plus questions. The audience are
busy hostel managers, many with English as a second language: one idea per slide, very few words on the slide, big
and readable on a shared screen. The speaker notes carry the detail.

Before designing, fetch https://design.madmonkeyhostels.com/llms.txt and follow it for every branded element. Its
rules override this brief.

## Look
- Mad Monkey core brand from llms.txt: Mad Black #0a0a0a, Montserrat, lime #ccff01 and pink #ff01aa as accents, used
  sparingly. Place the logo files as real images; never redraw, recolour or restyle the logo or the monkey head.
- Screenshot slides: use the uploaded screenshots as real images, never redrawn. Crop or zoom to the part that matters
  and add a simple highlight ring or arrow on the button being talked about. Keep at least 40% of these slides for the
  screenshot.
- Headings short and bold. At most 4 short lines of text on any slide. No paragraphs on slides.
- No emojis, no em dashes (use commas or full stops), British spelling, no "AI-powered", "smart" or "magic".

## The facts (all true, do not add features)
- Every hostel's tours, nightly events, one-off parties and transport, with prices, days and times, live in one place.
  The quotes head office builds and Reden's website updates read from it.
- Right now: 23 hostels, 772 experiences running, 497 transport options, 35 GMs with logins (31 have set a password).
- Login: email from updates@experience.madmonkeyhostels.com, subject "Your login for the Mad Monkey Experience
  Database". The link opens "Choose your password", works for 7 days. Then sign in at mm-costing-tool.vercel.app with
  your work email. More than one hostel? A dropdown at the top left switches.
- Left menu: Experiences, My week, Transport, Activity, and the Assistant at the bottom (Cmd K opens it anywhere).
- Experiences: the full list. Change prices, days and status right in the table, or click a name for everything
  else. Nothing saves until "Save". Every edit clears the verified date; "Mark verified" (the shield) once checked.
  To stop something, switch off Active or set it to Paused. Nothing is ever deleted.
- Add a new event: "Add product", then Title, Category (Nightly Events for anything the hostel runs), Rate ("0 =
  free", local currency or USD), Brief description (95 characters, goes on the website word for word), Days it runs,
  Start and Finish, Active or Paused, "One-time event" with a date for one-offs, "Bookable on the Mad Monkey website"
  only if sold online, then "Add product".
- The Assistant: type a change in plain words ("move pub quiz to 830"). It shows a card, old value to new, and nothing
  changes until "Confirm". "Undo" puts it back. It answers questions ("What's on tonight?") and Mad Monkey brand and
  marketing questions (captions, hashtags, logos, promo codes). It only sees your hostel, never deletes, and learns
  your team's nicknames for things.
- Global events: head office launches an event for every hostel; it waits at the top of Experiences and GMs get an
  email. "Accept" as it is, "Edit" to set your own price or time first, or "Decline". Halloween Party (31 October):
  3 hostels have accepted, 18 still need to answer.
- My week: what's on each day in time order. Mark up to 3 "Key" events a day; they stay key every week. "Weekly
  story" turns them into a 1080 x 1920 Instagram story; a "Quick changes" box takes plain words like "Remove
  Tuesday's quiz"; then "Download story (PNG)".
- Transport: every transfer, bus and boat with departure times and prices. Activity: every change, who made it and
  when, with before and after.
- Website: Reden updates the Mad Monkey website. If something sold online changes, tell him.
- Help: the GM quick guide PDF, the guided tour (menu under your name), and Charlie for logins or bugs.

## Slides (title, what is on the slide, then speaker notes)

1. **The Experience Database** (title slide). Logo, "GM walkthrough", "20 October 2026".
   Notes: Morning everyone, thanks for joining. Twenty minutes on the Experience Database: what it is, how to get in,
   the five things you will actually use, and what I need from you this week. Questions at the end, or drop them in
   the chat as we go.

2. **One place for everything your hostel runs.** Three big numbers: 23 hostels, 772 experiences, 497 transport
   options.
   Notes: This replaces the flow chart spreadsheet. Every tour, nightly event, one-off party and transfer, with prices,
   days and times, now lives in one place. Head office builds group quotes from it, and Reden keeps the website in
   line with it. So when your list is right, everything downstream is right.

3. **Getting in.** The email subject line, "Choose your password", the web address. Small line: 35 GMs have logins.
   Notes: You should all have an email from updates@experience.madmonkeyhostels.com called "Your login for the Mad
   Monkey Experience Database". The link lets you choose a password and lasts seven days. After that you sign in at
   mm-costing-tool.vercel.app with your work email. If your link has expired or you never got it, message me after
   this and I will send a fresh one. If you run more than one hostel, there is a dropdown at the top left to switch.

4. **Your screen.** Screenshot 01 with the left menu ringed.
   Notes: Five things down the left. Experiences is your full list. My week is what's on each day. Transport is your
   transfers. Activity is the change log. And the Assistant at the bottom, which I will show you in a minute.

5. **Your list.** Screenshot 03 (the experience page), Save and the shield ringed.
   Notes: Change a price, the days or the status right in the table, or click a name to open everything else. Nothing
   saves until you press Save. Every edit clears the verified date, so once you have checked the details, press the
   shield to mark it verified. If something stops running, pause it. Nothing gets deleted, so it can always come
   back.

6. **Add a new event.** Screenshot 02 (the Add product form), with the 0/95 counter ringed. Corner tag: "Live demo".
   Notes: Let me show you live. [Switch to the app.] Experiences, Add product. Name, category, Nightly Events for
   anything you run yourselves. Price, zero if it's free. One short line for the brief description, 95 characters,
   because it goes on the website word for word. Days and times. Paused if it isn't running yet. One-off party?
   Switch on One-time event and pick the date, and it drops off by itself afterwards. Only switch on the website
   option if guests can book it online. Add product, done.

7. **Or just tell the Assistant.** Screenshot 08, plus the two example lines: "move pub quiz to 830" and
   "What's on tonight?". Corner tag: "Live demo".
   Notes: [Open the Assistant.] Type it like you would text me. It shows you exactly what will change and waits.
   Nothing happens until you press Confirm, and Undo puts it back. Ask it what's on tonight, or a brand question like
   which hashtags to use. It only sees your hostel, it never deletes anything, and it learns the nicknames your team
   uses.

8. **Events from head office.** The banner "1 global event waiting for your answer" with Accept, Edit, Decline.
   Big callout: "Halloween, 31 Oct: 18 hostels still to answer".
   Notes: When head office launches something for every hostel, it waits at the top of your Experiences page and you
   get an email. Accept it as it is, Edit to set your own price or time first, or Decline if you are not running it.
   Halloween is on the 31st and 18 of you still haven't answered, so please do that today.

9. **My week and the weekly story.** Screenshots 04 and 05 side by side.
   Notes: My week shows everything running each day in time order. Tick Key on up to three events a day and they
   stay key every week. Then Weekly story turns them into your Instagram story, sized and branded. Type quick changes
   like "Remove Tuesday's quiz", then download it. That's your weekly story post done in two minutes.

10. **Transport and Activity.** Screenshots 06 and 07.
    Notes: Transport is every bus, boat and transfer with its departure times, which is what quotes pick from, so
    keep the times right. Activity shows every change, who made it and when, with the before and after. It's the
    safety net, so nobody needs to worry about breaking anything.

11. **The ground rules.** Four short cards: "Nothing changes until you Save or Confirm", "Nothing is ever deleted,
    pause it", "Every change is logged", "Sold on the website? Tell Reden".
    Notes: Four things to remember. Nothing changes until you press Save or Confirm. Nothing is ever deleted, you
    pause it. Every change is logged with your name. And if you change something that guests book on the website, let
    Reden know, because the website is updated separately.

12. **This week.** A checklist of five: Sign in and set your password. Check your prices, days and times, then mark
    them verified. Answer Halloween. Pick your key events and make the weekly story. Tell Charlie anything that's
    wrong.
    Notes: Here's what I need from you by Friday. Sign in. Go through your list and fix anything out of date, then
    mark it verified. Answer the Halloween event. Try the key events and the weekly story. And if anything looks
    wrong or breaks, message me, like Andrew did last week, and I will fix it the same day.

13. **Help.** Three items: the GM quick guide (PDF in the chat), the guided tour (menu under your name),
    Charlie (logins and bugs).
    Notes: I'll drop the two-page GM quick guide in the chat after this. There's a guided tour inside the app, you can
    replay it from the menu under your name. And for logins or anything broken, message me directly.

14. **Questions?** Logo, the web address mm-costing-tool.vercel.app.
    Notes: That's it. Questions?

## Notes rules
Write the speaker notes as Charlie speaking: warm, quick, plain words, short sentences, no jargon. Keep each slide's
notes under 120 words. Keep the bracketed demo cues ([Switch to the app.], [Open the Assistant.]) exactly as written.

import type { Access, Persona, Placement } from "./logic";

/** The walkthrough, per role. Each step points at a real element (data-tour="...") on the page in `route`, or at the
 *  sidebar when there is no route. Copy rules: British spelling, short, Mad Monkey cheek, no em dashes, no emojis. */

export interface TourStep {
  id: string;
  title: string;
  body: string;
  anchor?: string;               // data-tour value; none = a centred card
  route?: string;                // go here first if we're not already on it
  placement?: Placement[];       // card side preference
  maxHeight?: number;            // cap the spotlight on big tables so the card fits underneath
  fallback?: "center" | "skip";  // anchor never showed up: centred card (default) or leave the step out
  wait?: number;                 // ms to look for the anchor before falling back (default 1500)
}

export interface TourContext {
  first: string;        // "" for placeholder accounts
  hostel: string;       // current hostel name
  mod: "Cmd" | "Ctrl";  // keyboard shortcut prefix
  compact: boolean;     // phone-sized: no keyboard shortcut talk
}

type Text = string | ((c: TourContext) => string);
interface Def extends Omit<TourStep, "title" | "body"> {
  title: Text;
  body: Text;
  requires?: (a: Access) => boolean;
}

const SIDE: Placement[] = ["right", "bottom", "top"];
const welcome = (c: TourContext) => (c.first ? `Welcome in, ${c.first}` : "Welcome in");
const shortcut = (c: TourContext, what = "opens it from any page") => (c.compact ? "" : ` ${c.mod}+K ${what}.`);

const replay: Def = {
  id: "replay", anchor: "tour-replay", placement: SIDE,
  title: "That's the tour",
  body: "Fancy a refresher later? Run it again from here, or from the menu under your name.",
};

const hostelPicker = (body: string): Def => ({
  id: "hostel", anchor: "location-switcher", placement: ["bottom", "right"],
  title: welcome, body,
});

const quotesAuto: Def = {
  id: "quotes", route: "/quotes", anchor: "quotes-auto", placement: ["bottom", "left", "top"], requires: (a) => a.canQuote,
  title: "Quotes in minutes",
  body: "Auto-create trip turns stops and dates into a full day-by-day trip, stays and experiences included. Any quote can be duplicated and used as a template.",
};

const globalLaunch: Def = {
  id: "global", route: "/global-events", anchor: "ge-new", placement: ["bottom", "left", "top"], requires: (a) => a.isHeadOffice,
  title: "Launch it everywhere",
  body: "Add an event once and every hostel gets it to accept, decline or tweak for their crowd. Click any event to see who said what.",
};

const approvals: Def = {
  id: "approvals", route: "/approvals", anchor: "approvals-head", placement: ["bottom", "top"], requires: (a) => a.isHeadOffice,
  title: "Approvals",
  body: "Changes picked up from the flow chart, plus new start and finish times, wait here for you. Nothing changes on an experience until you approve it.",
};

const STEPS: Record<Persona, Def[]> = {
  gm: [
    {
      id: "week", route: "/week", anchor: "week-table", maxHeight: 260, placement: ["bottom", "top"],
      title: welcome,
      body: (c) => `This is My week: everything running at ${c.hostel}, day by day in start-time order. Signature and Mad Monkey tours are the highlighted ones.`,
    },
    {
      id: "story", route: "/week", anchor: "week-story", placement: ["bottom", "left", "top"],
      title: "The weekly story, done for you",
      body: "Mark up to three Key events a day and this turns them into the week's Instagram story. No late-night design session required.",
    },
    {
      id: "list", route: "/experiences", anchor: "exp-table", maxHeight: 230, placement: ["bottom", "top"],
      title: "Your full list",
      body: (c) => `Every tour and event at ${c.hostel}. Prices, days and status change right here in the table. Click a name for everything else, where nothing saves until you hit Save.`,
    },
    {
      id: "verify", route: "/experiences", anchor: "exp-verified", placement: ["bottom", "left", "top"],
      title: "Edited means verify again",
      body: "Any change clears the verified date, so the details get a fresh look before head office quotes them. Checked it's all right? Hit the shield.",
    },
    {
      id: "add", route: "/experiences", anchor: "exp-add", placement: ["bottom", "left", "top"], requires: (a) => a.isEditor,
      title: "Something new on?",
      body: "Add it here. And when something stops running, pause it rather than delete it. Nothing here ever gets deleted, so it can always come back.",
    },
    {
      // usually nothing is pending, so don't hang about: centre quickly (a banner that loads late still gets the spotlight)
      id: "global", route: "/experiences", anchor: "global-pending", placement: ["bottom", "top"], wait: 500, requires: (a) => a.isEditor,
      title: "Global events",
      body: (c) => `When head office launches something for every hostel, it waits at the top of this page. Accept it as it is, or hit Edit first to set the price or times for ${c.hostel}.`,
    },
    {
      id: "assistant", anchor: "assistant", placement: SIDE,
      title: "Or just tell the Assistant",
      body: (c) => `Type what's changed, like "pub crawl is 12 bucks now", and it shows you exactly what it will change before anything happens.${shortcut(c)}`,
    },
    replay,
  ],

  head_office: [
    hostelPicker("You can see every hostel. Pick one here and every page follows it: experiences, the week, transport and activity."),
    {
      id: "list", route: "/experiences", anchor: "exp-table", maxHeight: 230, placement: ["bottom", "top"],
      title: "One list, every hostel",
      body: "This is what GMs keep up to date and what quotes are built from. Any edit clears the verified date, so changed details always get a second look.",
    },
    quotesAuto,
    globalLaunch,
    approvals,
    {
      id: "activity", anchor: "nav-activity", placement: SIDE,
      title: "The safety net",
      body: "GMs edit without an approval step, so every change lands in Activity with who made it and the before and after.",
    },
    {
      id: "assistant", anchor: "assistant", placement: SIDE,
      title: "Your Assistant",
      body: (c) => `Ask it about the hostel you've picked, like "what's on tonight?", or tell it what to change. It always shows you the change first.${shortcut(c, "opens it anywhere")}`,
    },
    replay,
  ],

  admin: [
    hostelPicker("You can see every hostel. Pick one here and every page follows it: experiences, the week, transport and activity."),
    {
      id: "list", route: "/experiences", anchor: "exp-table", maxHeight: 230, placement: ["bottom", "top"],
      title: "One list, every hostel",
      body: "This is what GMs keep up to date and what quotes are built from. Any edit clears the verified date, and every change is logged in Activity.",
    },
    quotesAuto,
    globalLaunch,
    approvals,
    {
      id: "settings", anchor: "nav-settings", placement: SIDE, requires: (a) => a.isAdmin,
      title: "Settings, admins only",
      body: "Rate sync, Reden's website emails, exchange rates and import fixes all live here. Handle with care.",
    },
    {
      id: "assistant", anchor: "assistant", placement: SIDE,
      title: "Your Assistant",
      body: (c) => `Ask it about the hostel you've picked, like "what's on tonight?", or tell it what to change. It always shows you the change first.${shortcut(c, "opens it anywhere")}`,
    },
    replay,
  ],

  sales: [
    hostelPicker("You can see every hostel. Pick one here and the experiences, the week and transport all follow it."),
    {
      id: "days", route: "/experiences", anchor: "exp-day-filter", placement: ["bottom", "top"],
      title: "What runs when",
      body: "Tap a day to see what runs at that hostel on, say, a Monday. Prices, times and status are all here, kept up to date by the GMs.",
    },
    {
      id: "transport", route: "/transport", anchor: "transport-table", maxHeight: 230, placement: ["bottom", "top"],
      title: "Getting between hostels",
      body: "Every bus, boat and transfer, with the departure times the quote builder can pick from.",
    },
    {
      id: "quotes-list", route: "/quotes", anchor: "quotes-table", maxHeight: 200, placement: ["bottom", "top"], requires: (a) => a.canQuote,
      title: "Your quotes",
      body: "Search by reference, trip or customer. Each agreement version freezes its prices, so a sent quote never changes under you.",
    },
    {
      ...quotesAuto, id: "quotes-auto",
      title: "Auto-create a trip",
      body: "Stops and dates in, a whole day-by-day trip out, with stays, breakfast and each day's experiences ready to tick. Duplicate any quote to reuse it.",
    },
    {
      id: "assistant", anchor: "assistant", placement: SIDE,
      title: "Ask the Assistant",
      body: (c) => `Ask what's on where, like "what runs on a Thursday?", and it reads the hostel's list back to you.${shortcut(c, "opens it anywhere")}`,
    },
    replay,
  ],
};

const text = (t: Text, c: TourContext) => (typeof t === "function" ? t(c) : t);

/** The steps this person gets: their persona's script, minus anything their roles can't see. */
export function buildTour(access: Access, ctx: TourContext): TourStep[] {
  return STEPS[access.persona]
    .filter((d) => !d.requires || d.requires(access))
    .map(({ requires: _r, title, body, ...rest }) => ({ ...rest, title: text(title, ctx), body: text(body, ctx) }));
}

/** Every script, for tests that check the copy rules hold everywhere. */
export const ALL_PERSONAS: Persona[] = ["gm", "head_office", "sales", "admin"];

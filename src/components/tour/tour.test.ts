import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/types";
import {
  accessFor, canSeeNav, clearTourState, firstNameFor, insideBox, isAutoStartPath, placeCard, readTourState,
  sheetDock, shouldAutoStart, spotlightBox, tourKey, writeTourState,
} from "./logic";
import { ALL_PERSONAS, buildTour, type TourContext } from "./steps";
import { isTourActive, setTourActive } from "./store";

const ctx: TourContext = { first: "Sam", hostel: "Siem Reap", mod: "Cmd", compact: false };
const ids = (roles: Role[], c: TourContext = ctx) => buildTour(accessFor(roles), c).map((s) => s.id);

/** The sidebar's own items, with the same gates AppShell uses. */
const NAV = [
  { to: "/experiences" }, { to: "/week" }, { to: "/transport" }, { to: "/quotes", quoting: true }, { to: "/activity" },
  { to: "/global-events", headOffice: true }, { to: "/approvals", headOffice: true }, { to: "/settings", adminOnly: true },
];
const navFor = (roles: Role[]) => NAV.filter((n) => canSeeNav(n, accessFor(roles))).map((n) => n.to);

describe("access mirrors the sidebar", () => {
  it("GMs never see quotes, global events, approvals or settings", () => {
    expect(navFor(["gm"])).toEqual(["/experiences", "/week", "/transport", "/activity"]);
    const a = accessFor(["gm"]);
    expect(a).toMatchObject({ persona: "gm", canQuote: false, isEditor: true, isHeadOffice: false, seesAllLocations: false });
  });
  it("sales sees quotes but can't edit products", () => {
    expect(navFor(["sales"])).toEqual(["/experiences", "/week", "/transport", "/quotes", "/activity"]);
    expect(accessFor(["sales"])).toMatchObject({ persona: "sales", canQuote: true, isEditor: false, seesAllLocations: true });
  });
  it("head office sees quotes, global events and approvals, not settings", () => {
    expect(navFor(["head_office"])).toEqual(["/experiences", "/week", "/transport", "/quotes", "/activity", "/global-events", "/approvals"]);
  });
  it("admin sees everything", () => {
    expect(navFor(["admin"])).toEqual(NAV.map((n) => n.to));
    expect(accessFor(["admin"])).toMatchObject({ persona: "admin", isHeadOffice: true, canQuote: true, isEditor: true });
  });
  it("the most senior role picks the script", () => {
    expect(accessFor(["gm", "sales"]).persona).toBe("sales");
    expect(accessFor(["sales", "head_office"]).persona).toBe("head_office");
    expect(accessFor(["gm", "admin"]).persona).toBe("admin");
    expect(accessFor([]).persona).toBe("gm");
  });
});

describe("steps per role", () => {
  it("GM: the week, the story, the list, verify, add, global events, the Assistant, replay", () => {
    expect(ids(["gm"])).toEqual(["week", "story", "list", "verify", "add", "global", "assistant", "replay"]);
  });
  it("head office", () => {
    expect(ids(["head_office"])).toEqual(["hostel", "list", "quotes", "global", "approvals", "activity", "assistant", "replay"]);
  });
  it("admin swaps Activity for Settings", () => {
    expect(ids(["admin"])).toEqual(["hostel", "list", "quotes", "global", "approvals", "settings", "assistant", "replay"]);
  });
  it("sales", () => {
    expect(ids(["sales"])).toEqual(["hostel", "days", "transport", "quotes-list", "quotes-auto", "assistant", "replay"]);
  });
  it("someone with no editing rights gets no Add product or global event answers", () => {
    expect(ids([])).toEqual(["week", "story", "list", "verify", "assistant", "replay"]);
  });

  it("every role gets 5 to 8 steps and always ends on where to replay it", () => {
    for (const roles of [["gm"], ["head_office"], ["sales"], ["admin"]] as Role[][]) {
      const steps = buildTour(accessFor(roles), ctx);
      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(steps.length).toBeLessThanOrEqual(8);
      expect(steps.at(-1)).toMatchObject({ id: "replay", anchor: "tour-replay" });
    }
  });

  it("GMs are never sent to a page their sidebar doesn't have", () => {
    const allowed = new Set(navFor(["gm"]));
    for (const s of buildTour(accessFor(["gm"]), ctx)) {
      if (s.route) expect(allowed.has(s.route)).toBe(true);
      expect(s.anchor ?? "").not.toMatch(/quotes|ge-new|approvals|nav-settings|location-switcher/);
    }
  });

  it("nobody is sent to a page they can't open", () => {
    for (const roles of [["gm"], ["head_office"], ["sales"], ["admin"], []] as Role[][]) {
      const allowed = new Set(navFor(roles));
      for (const s of buildTour(accessFor(roles), ctx)) if (s.route) expect(allowed.has(s.route), `${roles} -> ${s.route}`).toBe(true);
    }
  });

  it("sidebar anchors only point at items the person can see", () => {
    for (const roles of [["gm"], ["head_office"], ["sales"], ["admin"]] as Role[][]) {
      const visible = new Set(navFor(roles).map((to) => `nav${to.replace(/\//g, "-")}`));
      for (const s of buildTour(accessFor(roles), ctx)) if (s.anchor?.startsWith("nav-")) expect(visible.has(s.anchor)).toBe(true);
    }
  });

  it("greets by first name, names the hostel, and falls back politely", () => {
    const gm = buildTour(accessFor(["gm"]), ctx);
    expect(gm[0].title).toBe("Welcome in, Sam");
    expect(gm[0].body).toContain("Siem Reap");
    expect(buildTour(accessFor(["gm"]), { ...ctx, first: "" })[0].title).toBe("Welcome in");
  });

  it("uses the right shortcut, and none at all on a phone", () => {
    const find = (c: TourContext) => buildTour(accessFor(["gm"]), c).find((s) => s.id === "assistant")!.body;
    expect(find(ctx)).toContain("Cmd+K");
    expect(find({ ...ctx, mod: "Ctrl" })).toContain("Ctrl+K");
    expect(find({ ...ctx, compact: true })).not.toMatch(/\+K/);
  });

  it("copy rules: no em or en dashes, no emojis, no American spellings, short enough to read", () => {
    const banned = /\b(color|favorite|organize|center|behavior|license|customize|program)\b/i;
    for (const persona of ALL_PERSONAS) {
      const roles: Role[] = [persona];
      for (const c of [ctx, { ...ctx, first: "", compact: true, mod: "Ctrl" as const }]) {
        for (const s of buildTour(accessFor(roles), c)) {
          const text = `${s.title} ${s.body}`;
          expect(text, s.id).not.toMatch(/[\u2014\u2013]/);
          expect(text, s.id).not.toMatch(/\p{Extended_Pictographic}/u);
          expect(text, s.id).not.toMatch(banned);
          expect(s.title.length, s.id).toBeLessThanOrEqual(40);
          expect(s.body.length, s.id).toBeLessThanOrEqual(220);
        }
      }
    }
  });
});

describe("first names", () => {
  it("skips placeholder accounts like the Assistant does", () => {
    expect(firstNameFor("Kassy Lim", "kassy@madmonkeyhostels.com")).toBe("Kassy");
    expect(firstNameFor("GM Siem Reap", "x@y.com")).toBe("");
    expect(firstNameFor("Admin", "a@b.com")).toBe("");
    expect(firstNameFor("Sam", "gm.siemreap@madmonkey.test")).toBe("");
    expect(firstNameFor("charlie@example.com", null)).toBe("");
    expect(firstNameFor("", null)).toBe("");
  });
});

describe("tour state in localStorage", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("is keyed per user", () => {
    expect(tourKey("abc")).toBe("mm.tour.v1.abc");
  });
  it("shows once: done and skipped both stop the auto-start", () => {
    expect(shouldAutoStart("u1")).toBe(true);
    writeTourState("u1", "done");
    expect(localStorage.getItem("mm.tour.v1.u1")).toBe("done");
    expect(shouldAutoStart("u1")).toBe(false);
    writeTourState("u2", "skipped");
    expect(readTourState("u2")).toBe("skipped");
    expect(shouldAutoStart("u2")).toBe(false);
    expect(shouldAutoStart("u3")).toBe(true);
    clearTourState("u1");
    expect(shouldAutoStart("u1")).toBe(true);
  });
  it("never auto-starts without a signed-in user", () => {
    expect(shouldAutoStart(null)).toBe(false);
    expect(shouldAutoStart("")).toBe(false);
  });
  it("ignores junk values", () => {
    localStorage.setItem("mm.tour.v1.u4", "maybe");
    expect(readTourState("u4")).toBeNull();
  });
  it("survives storage that throws (private mode), and still only shows once per page load", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => shouldAutoStart("u5")).not.toThrow();
    expect(shouldAutoStart("u5")).toBe(true);
    expect(() => writeTourState("u5", "skipped")).not.toThrow();
    expect(shouldAutoStart("u5")).toBe(false);
    expect(() => clearTourState("u5")).not.toThrow();
  });
});

describe("where it may start on its own", () => {
  it("main list pages only, never a form or a quote", () => {
    for (const p of ["/experiences", "/week", "/week/", "/transport", "/quotes", "/activity", "/global-events", "/approvals", "/settings"]) expect(isAutoStartPath(p), p).toBe(true);
    for (const p of ["/experiences/new", "/experiences/0b8f1c2e-1111-2222-3333-444455556666", "/quotes/abc", "/quotes/auto", "/quotes/abc/itinerary", "/week/story", "/login", "/a/slug", "/"]) expect(isAutoStartPath(p), p).toBe(false);
  });
});

describe("spotlight geometry", () => {
  const vp = { width: 1280, height: 800 };
  it("pads the anchor", () => {
    expect(spotlightBox({ top: 100, left: 100, width: 50, height: 20 }, vp)).toEqual({ top: 94, left: 94, width: 62, height: 32 });
  });
  it("caps tall anchors so the card fits underneath", () => {
    expect(spotlightBox({ top: 200, left: 240, width: 900, height: 2400 }, vp, { maxHeight: 230 })!.height).toBe(230);
  });
  it("clips to the viewport and refuses an off-screen spotlight", () => {
    expect(spotlightBox({ top: 760, left: 100, width: 100, height: 200 }, vp)!.height).toBe(800 - 4 - 754);
    expect(spotlightBox({ top: 900, left: 100, width: 100, height: 40 }, vp)).toBeNull();
    expect(spotlightBox({ top: 100, left: 1400, width: 100, height: 40 }, vp)).toBeNull();
    expect(spotlightBox({ top: 100, left: 100, width: 0, height: 0 }, vp)).toBeNull();
    expect(spotlightBox(null, vp)).toBeNull();
  });
  it("on a phone keeps clear of the sheet, top or bottom", () => {
    const phone = { width: 375, height: 812 };
    expect(spotlightBox({ top: 700, left: 8, width: 40, height: 36 }, phone, { bottomLimit: 600 })).toBeNull();
    expect(spotlightBox({ top: 700, left: 8, width: 40, height: 36 }, phone, { topLimit: 220 })).not.toBeNull();
    expect(spotlightBox({ top: 100, left: 8, width: 40, height: 36 }, phone, { topLimit: 220 })).toBeNull();
  });
  it("docks the phone sheet at the top only when the anchor sits low", () => {
    const phone = { width: 375, height: 812 };
    expect(sheetDock({ top: 700, left: 8, width: 40, height: 36 }, phone)).toBe("top");
    expect(sheetDock({ top: 80, left: 8, width: 300, height: 2000 }, phone, 230)).toBe("bottom");
    expect(sheetDock(null, phone)).toBe("bottom");
  });
  it("knows a click inside the spotlight from one on the backdrop", () => {
    const b = { top: 10, left: 10, width: 100, height: 50 };
    expect(insideBox(b, 50, 30)).toBe(true);
    expect(insideBox(b, 200, 30)).toBe(false);
    expect(insideBox(null, 50, 30)).toBe(false);
  });
});

describe("card placement", () => {
  const vp = { width: 1280, height: 800 };
  const card = { width: 320, height: 160 };
  const inside = (p: { top: number; left: number }) =>
    p.top >= 12 && p.left >= 12 && p.top + card.height <= vp.height - 12 && p.left + card.width <= vp.width - 12;

  it("sits to the right of a sidebar item", () => {
    const p = placeCard({ top: 600, left: 8, width: 204, height: 40 }, card, vp, ["right", "bottom", "top"]);
    expect(p.placement).toBe("right");
    expect(p.left).toBe(8 + 204 + 12);
    expect(inside(p)).toBe(true);
  });
  it("goes below a toolbar button, pulled in from the right edge", () => {
    const p = placeCard({ top: 60, left: 1150, width: 120, height: 40 }, card, vp);
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(112);
    expect(inside(p)).toBe(true);
  });
  it("flips above when there's no room below", () => {
    const p = placeCard({ top: 640, left: 300, width: 200, height: 40 }, card, vp, ["bottom", "top"]);
    expect(p.placement).toBe("top");
    expect(inside(p)).toBe(true);
  });
  it("tucks into the corner over an anchor that fills the screen", () => {
    const p = placeCard({ top: 20, left: 20, width: 1240, height: 760 }, card, vp, ["bottom", "top"]);
    expect(p.placement).toBe("overlay");
    expect(inside(p)).toBe(true);
  });
  it("centres when there's nothing to point at", () => {
    const p = placeCard(null, card, vp);
    expect(p).toEqual({ top: 320, left: 480, placement: "center" });
  });
  it("stays on screen even in a tiny window", () => {
    const tiny = { width: 700, height: 300 };
    const p = placeCard({ top: 100, left: 600, width: 80, height: 30 }, card, tiny);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + card.width).toBeLessThanOrEqual(tiny.width - 12);
  });
});

describe("tour flag for the Assistant", () => {
  it("flips on and off", () => {
    expect(isTourActive()).toBe(false);
    setTourActive(true);
    expect(isTourActive()).toBe(true);
    setTourActive(false);
    expect(isTourActive()).toBe(false);
  });
});

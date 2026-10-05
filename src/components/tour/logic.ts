import type { Role } from "@/lib/types";

/** Pure logic for the first-run walkthrough: who sees what, where state lives, and where the spotlight and card go.
 *  No React and no DOM in here, so every rule is unit-tested in tour.test.ts. */

// ---------------------------------------------------------------- access (mirrors the sidebar exactly)

export type Persona = "admin" | "head_office" | "sales" | "gm";

export interface Access {
  isAdmin: boolean;
  isHeadOffice: boolean;      // admin counts as head office, same as the sidebar
  canQuote: boolean;          // quotes are hidden from GMs
  isEditor: boolean;          // can edit products (Add product, Key events, global event answers)
  seesAllLocations: boolean;  // gets the hostel switcher
  persona: Persona;           // whose tour copy to use: the most senior role wins
}

export function accessFor(roles: readonly Role[]): Access {
  const has = (r: Role) => roles.includes(r);
  const isAdmin = has("admin");
  const isHeadOffice = isAdmin || has("head_office");
  const seesAll = isHeadOffice || has("sales");
  return {
    isAdmin,
    isHeadOffice,
    canQuote: seesAll,
    isEditor: isHeadOffice || has("gm"),
    seesAllLocations: seesAll,
    persona: isAdmin ? "admin" : has("head_office") ? "head_office" : has("sales") ? "sales" : "gm",
  };
}

export interface NavGate { adminOnly?: boolean; headOffice?: boolean; quoting?: boolean }
/** The one rule for which sidebar items render. AppShell and the tour both use it, so they can never disagree. */
export const canSeeNav = (n: NavGate, a: Access) =>
  (!n.adminOnly || a.isAdmin) && (!n.headOffice || a.isHeadOffice) && (!n.quoting || a.canQuote);

/** First name for the greeting. Placeholder accounts (gm@, admin@, *@madmonkey.test) get none, same as the Assistant. */
export function firstNameFor(fullName: string | null | undefined, email?: string | null): string {
  const raw = (fullName || "").trim().split(/\s+/)[0] || "";
  if (!raw || raw.includes("@")) return "";
  if (/^(gm|admin|test|user)$/i.test(raw) || (email ?? "").endsWith("@madmonkey.test")) return "";
  return raw;
}

// ---------------------------------------------------------------- state: once per user per device

export const TOUR_VERSION = 1;
export type TourOutcome = "done" | "skipped";
export const tourKey = (userId: string) => `mm.tour.v${TOUR_VERSION}.${userId}`;

/** Fallback when storage throws (private mode, blocked storage): at least it only shows once per page load. */
const memory = new Map<string, TourOutcome>();

export function readTourState(userId: string): TourOutcome | null {
  const k = tourKey(userId);
  try {
    const v = window.localStorage.getItem(k);
    if (v === "done" || v === "skipped") return v;
  } catch { /* storage blocked */ }
  return memory.get(k) ?? null;
}

export function writeTourState(userId: string, outcome: TourOutcome) {
  const k = tourKey(userId);
  memory.set(k, outcome);
  try { window.localStorage.setItem(k, outcome); } catch { /* storage blocked */ }
}

export function clearTourState(userId: string) {
  const k = tourKey(userId);
  memory.delete(k);
  try { window.localStorage.removeItem(k); } catch { /* storage blocked */ }
}

export const shouldAutoStart = (userId: string | null | undefined) => !!userId && readTourState(userId) === null;

// ---------------------------------------------------------------- where it may start on its own

export const normalisePath = (p: string) => p.replace(/\/+$/, "") || "/";
/** Only the main list pages. Never a form (a half-filled product), a quote or the itinerary editor. */
const AUTO_START_PATHS = ["/experiences", "/week", "/transport", "/quotes", "/activity", "/global-events", "/approvals", "/settings"];
export const isAutoStartPath = (p: string) => AUTO_START_PATHS.includes(normalisePath(p));

// ---------------------------------------------------------------- geometry

export interface Box { top: number; left: number; width: number; height: number }
export interface Size { width: number; height: number }
export type Placement = "right" | "bottom" | "top" | "left";
export interface CardPos { top: number; left: number; placement: Placement | "center" | "overlay" }

/** Below this width the card becomes a bottom sheet. */
export const SHEET_BREAKPOINT = 640;

/** The spotlight around an anchor: padded, height-capped for big tables, and clipped to what is actually on screen
 *  (and clear of the sheet on phones). Null when too little of it is visible: never an off-screen spotlight. */
export function spotlightBox(
  anchor: Box | null,
  vp: Size,
  opts: { pad?: number; maxHeight?: number; bottomLimit?: number; topLimit?: number } = {},
): Box | null {
  if (!anchor || anchor.width <= 0 || anchor.height <= 0) return null;
  const pad = opts.pad ?? 6;
  const edge = 4;
  const top = Math.max(anchor.top - pad, edge, opts.topLimit ?? -Infinity);
  const left = Math.max(anchor.left - pad, edge);
  let bottom = anchor.top + anchor.height + pad;
  if (opts.maxHeight != null) bottom = Math.min(bottom, top + opts.maxHeight);
  bottom = Math.min(bottom, vp.height - edge, opts.bottomLimit ?? Infinity);
  const right = Math.min(anchor.left + anchor.width + pad, vp.width - edge);
  const width = right - left;
  const height = bottom - top;
  if (width < 12 || height < 12) return null;
  return { top, left, width, height };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** Where the floating card goes: the first preferred side that fits, else tucked in the bottom-right corner over a big
 *  anchor, else centred when there is no spotlight. Always fully inside the viewport. */
export function placeCard(
  spot: Box | null,
  card: Size,
  vp: Size,
  prefer: readonly Placement[] = ["bottom", "top", "right", "left"],
  gap = 12,
  margin = 12,
): CardPos {
  const maxLeft = vp.width - card.width - margin;
  const maxTop = vp.height - card.height - margin;
  if (!spot) return { top: clamp((vp.height - card.height) / 2, margin, maxTop), left: clamp((vp.width - card.width) / 2, margin, maxLeft), placement: "center" };
  const midY = spot.top + spot.height / 2 - card.height / 2;
  for (const p of prefer) {
    if (p === "right") {
      const left = spot.left + spot.width + gap;
      if (left <= maxLeft) return { top: clamp(midY, margin, maxTop), left, placement: p };
    } else if (p === "left") {
      const left = spot.left - gap - card.width;
      if (left >= margin) return { top: clamp(midY, margin, maxTop), left, placement: p };
    } else if (p === "bottom") {
      const top = spot.top + spot.height + gap;
      if (top <= maxTop) return { top, left: clamp(spot.left, margin, maxLeft), placement: p };
    } else {
      const top = spot.top - gap - card.height;
      if (top >= margin) return { top, left: clamp(spot.left, margin, maxLeft), placement: p };
    }
  }
  return { top: clamp(maxTop, margin, maxTop), left: clamp(maxLeft, margin, maxLeft), placement: "overlay" };
}

export const insideBox = (b: Box | null, x: number, y: number) =>
  !!b && x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;

/** Phones: the card is a sheet at the bottom, unless the thing it points at sits in the lower half of the screen
 *  (the sidebar's Assistant and replay buttons), in which case it docks at the top so the spotlight stays visible. */
export function sheetDock(anchor: Box | null, vp: Size, maxHeight?: number): "bottom" | "top" {
  if (!anchor) return "bottom";
  const h = Math.min(anchor.height, maxHeight ?? Infinity);
  return anchor.top + h / 2 > vp.height * 0.5 ? "top" : "bottom";
}

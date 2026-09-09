/** Detailed itinerary document (10 Sep 2026). Written by Claude from the quote's fact pack, then edited by people. */
export interface ItineraryBlock {
  id: string;                 // client id for editing / reordering
  time: string;               // "7pm", "8:45am", "" for untimed
  title: string;
  body: string;               // paragraph(s)
  bullets: string[];          // hourly / sub-items
  highlights: string[];       // "today's highlights"
  vibe: string;               // "the vibe" paragraph
  photo_url: string | null;   // always blank from the writer; people add one
  source_line_id: string | null;
  flagged: string | null;     // set by the checker when something doesn't match the quote
}
export interface ItineraryDay {
  day_no: number;
  date: string | null;
  hostel: string;
  title: string;
  intro: string;
  blocks: ItineraryBlock[];
  accommodation: string;
  notes: string[];
}
export interface ItineraryDoc {
  title: string;
  subtitle: string;
  nights: number;
  route: string[];
  intro: string;
  inclusions: string[];
  not_included: string[];
  optional_extras: string[];
  transfers: string[];
  days: ItineraryDay[];
  closing: string;
  flags: string[];            // document-level checks (missing activities etc.)
}

export const emptyDoc = (): ItineraryDoc => ({ title: "", subtitle: "", nights: 0, route: [], intro: "", inclusions: [], not_included: [], optional_extras: [], transfers: [], days: [], closing: "", flags: [] });
export const newBlock = (partial: Partial<ItineraryBlock> = {}): ItineraryBlock => ({ id: crypto.randomUUID(), time: "", title: "", body: "", bullets: [], highlights: [], vibe: "", photo_url: null, source_line_id: null, flagged: null, ...partial });

export const STUDIO_STYLE_LIME = "#d9f99d";
export const fmtDayDate = (d: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : null;

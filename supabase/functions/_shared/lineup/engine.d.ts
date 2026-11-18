// Types for engine.js (the reference layout engine from the Claude Design hand-off, ported as is).

export type Format = "post" | "story";
export type ColourwayKey = "orange-yellow" | "blue-lime" | "pink-cyan" | "purple-yellow" | "retro";

export interface LineupItem {
  id?: string;
  name: string;
  time: string | null;
  price: number | null;
  signature?: boolean;
  key?: boolean;
}
export interface LineupDay { day: string; date: string; iso?: string; items: LineupItem[] }
export interface LineupWeek {
  hostel: string;
  dates: string;
  currency: string;
  everyDay: LineupItem[];
  days: LineupDay[];
}

export interface Colourway {
  background: string; rowFill: string; display: string; accent: string;
  outline: string; stickerText: string; logo: "black" | "white";
}

export interface ItemView {
  text: string; fs: number; key: boolean; plain: boolean; nameColor: string; accent: string; ol: string;
  sig: boolean; burst: number; burstGap: number; burstFill: string; burstLine: string; minH: number;
  hasTime: boolean; time: string; tf: number; timeColor: string;
  hasPrice: boolean; price: string; pf: number; pillH: number; pillLH: number; padX: number;
  pillFill: string; pillText: string; pillShadow: string;
  hasMeta: boolean; metaGap: number; metaML: number;
}
export interface BlockView { mt: number; cols: { w: number; gap: number; items: ItemView[] }[] }
export interface RowView {
  mt: number; h: number; isBand: boolean; isDay: boolean; isEmpty: boolean; hasItems: boolean;
  fill: string; line: string; shadow: string; itemsW: number; blocks: BlockView[];
  // band
  label?: string; labelFs?: number; labelColor?: string;
  // day rows
  day?: string; date?: string; dayFs?: number; stickerFs?: number; dayFill?: string; ol?: string; stickerText?: string;
}
export interface HeadView {
  h: number; side: boolean; stack: boolean; name: string; nameF: number; subF: number;
  display: string; ol: string; stickerText: string; dates: string; dateFs: number;
  sticker: boolean; burst: boolean; burstSize: number; burstFs: number; burstDates: string;
}
export interface DecoView { size: number; x: number; y: number; r: number; fill: string; line: string }
export interface LineupView {
  W: number; H: number; bg: string; top: number; bottom: number; fit: number; tier: number; overfull: boolean;
  deco: DecoView[]; head: HeadView; rows: RowView[]; gapHB: number; footH: number; logoSrc: string; allInSrc: string;
}

export function lineupView(week: LineupWeek, format: Format, colourway: ColourwayKey | string): LineupView;
export function layoutLineup(week: LineupWeek, format: Format, colourway: ColourwayKey | string): unknown;
export const COLOURWAYS: Record<ColourwayKey, Colourway>;
export const FORMATS: Record<Format, { W: number; H: number; top: number; bottom: number }>;
export const G: Record<string, number>;
export const ANTON: Record<string, number>;
export const MONT: Record<string, number>;
export function antonW(s: string, fs: number, track?: number): number;
export function montW(s: string, fs: number): number;

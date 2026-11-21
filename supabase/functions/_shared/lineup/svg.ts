// @deno-types="./engine.d.ts"
import { antonW, montW, G, type LineupView, type RowView, type ItemView, type HeadView, type DecoView } from "./engine.js";

// Weekly lineup renderer: turns lineupView() output into one flat SVG (live text, vector shapes, no blur).
// The same string is shown in the dashboard (inline SVG, browser fonts) and rasterised by the `lineup`
// Edge Function with resvg (font files). Every size and colour comes from the engine; this file only places them.

export interface LineupAsset { href: string; w: number; h: number }
export interface LineupAssets { logoBlack: LineupAsset; logoWhite: LineupAsset; allIn: LineupAsset }

const ANTON_CAP = 0.859;   // cap height / em, from Anton-Regular.ttf (OS/2 sCapHeight)
const MONT_CAP = 0.7;      // Montserrat Black
const DISPLAY = "Anton, Prompt";        // Prompt only supplies the Thai baht sign if a name ever uses it
const SMALL = "Montserrat, Prompt";     // Prompt Black supplies ฿ (Anton and Montserrat have no baht glyph)
const TRACK = -0.02, KEY_TRACK = 0.02, NAME_LH = 0.95, STACK_LH = 0.92;

const r1 = (v: number) => Math.round(v * 10) / 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseShadow(css: string): { dx: number; dy: number; color: string } | null {
  const m = /^(-?\d+)px\s+(-?\d+)px\s+0\s+(#[0-9a-f]{6})$/i.exec((css || "").trim());
  return m ? { dx: +m[1], dy: +m[2], color: m[3] } : null;
}

/** 12-point starburst centred on (cx, cy). */
function star(cx: number, cy: number, rOut: number, rotDeg = 0, points = 12, inner = 0.8) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rOut * inner;
    const a = (Math.PI * i) / points - Math.PI / 2 + (rotDeg * Math.PI) / 180;
    pts.push(`${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}

interface TextOpts {
  family?: string; size: number; weight?: number | string; fill: string; track?: number;
  anchor?: "start" | "middle" | "end"; stroke?: string; sw?: number; dx?: number; dy?: number;
}
function text(x: number, y: number, s: string, o: TextOpts) {
  const a = [
    `x="${r1(x + (o.dx ?? 0))}"`, `y="${r1(y + (o.dy ?? 0))}"`,
    `font-family="${o.family ?? DISPLAY}"`, `font-size="${r1(o.size)}"`,
    o.weight ? `font-weight="${o.weight}"` : "",
    o.track ? `letter-spacing="${r1(o.track * o.size * 100) / 100}"` : "",
    o.anchor && o.anchor !== "start" ? `text-anchor="${o.anchor}"` : "",
    `fill="${o.fill}"`,
    o.stroke ? `stroke="${o.stroke}" stroke-width="${r1(o.sw ?? 0)}" stroke-linejoin="round"` : "",
  ].filter(Boolean).join(" ");
  return `<text ${a}>${esc(s)}</text>`;
}

/** Outlined display type: (1) shadow copy offset down-right, stroked; (2) outline copy, stroke 2x the outline
 *  (centred, so half shows outside the letter); (3) fill copy on top. No blur anywhere. */
function outlined(x: number, y: number, s: string, fs: number, o: {
  fill: string; ol: string; olEm: number; shEm: number; shColor?: string; track?: number; anchor?: TextOpts["anchor"];
}) {
  const sw = 2 * o.olEm * fs, sh = o.shEm * fs;
  const base = { size: fs, track: o.track ?? TRACK, anchor: o.anchor };
  return [
    sh > 0 ? text(x, y, s, { ...base, fill: o.shColor ?? o.ol, stroke: o.shColor ?? o.ol, sw, dx: sh, dy: sh }) : "",
    text(x, y, s, { ...base, fill: o.ol, stroke: o.ol, sw }),
    text(x, y, s, { ...base, fill: o.fill }),
  ].join("");
}

/** Plain text with a hard offset shadow copy (zero blur). */
function shadowed(x: number, y: number, s: string, fs: number, fill: string, shColor: string, sh: number, track = TRACK) {
  return text(x, y, s, { size: fs, fill: shColor, track, dx: sh, dy: sh }) + text(x, y, s, { size: fs, fill, track });
}

/** Black label sticker: rotated rectangle with Montserrat 900 caps, centred on (cx, cy). */
function sticker(cx: number, cy: number, s: string, fs: number, fg: string, bg: string, rot: number) {
  const w = montW(s, fs) + fs * 0.9, h = fs * 1.42;
  return `<g transform="rotate(${rot} ${r1(cx)} ${r1(cy)})">` +
    `<rect x="${r1(cx - w / 2)}" y="${r1(cy - h / 2)}" width="${r1(w)}" height="${r1(h)}" fill="${bg}"/>` +
    text(cx, cy + (MONT_CAP * fs) / 2, s, { family: SMALL, weight: 900, size: fs, fill: fg, anchor: "middle", track: 0.01 }) +
    `</g>`;
}
const stickerSize = (s: string, fs: number) => ({ w: montW(s, fs) + fs * 0.9, h: fs * 1.42 });

// ---------------------------------------------------------------------------------------------------------------

function item(v: ItemView, x: number, y: number, w: number): string {
  const out: string[] = [];
  const lines = v.text.split("\n");
  const lh = v.fs * NAME_LH, nameH = lines.length * lh;
  const top = y + (v.minH - nameH) / 2, mid = y + v.minH / 2;
  let nx = x;
  if (v.sig && v.burst) {
    const r = v.burst / 2, cy = top + lh / 2;
    out.push(`<path d="${star(x + r, cy, r, 8)}" fill="${v.burstFill}" stroke="${v.burstLine}" stroke-width="${r1(Math.max(2, v.burst * 0.06))}" stroke-linejoin="round"/>`);
    nx += v.burst + v.burstGap;
  }
  lines.forEach((ln, i) => {
    const base = top + i * lh + ((NAME_LH + ANTON_CAP) / 2) * v.fs;
    out.push(v.key
      ? outlined(nx, base, ln, v.fs, { fill: v.accent, ol: v.ol, olEm: 0.055, shEm: 0.07, track: KEY_TRACK })
      : text(nx, base, ln, { size: v.fs, fill: v.nameColor, track: TRACK }));
  });
  let right = x + w;
  if (v.hasPrice) {
    const pw = Math.ceil(montW(v.price, v.pf) + v.padX * 2 + 6), ph = v.pillH;
    const px = right - 3 - pw, py = mid - ph / 2;
    out.push(`<rect x="${r1(px + 3)}" y="${r1(py + 3)}" width="${pw}" height="${ph}" rx="${r1(ph / 2)}" fill="${v.pillShadow}"/>`);
    out.push(`<rect x="${r1(px + 1.5)}" y="${r1(py + 1.5)}" width="${pw - 3}" height="${ph - 3}" rx="${r1((ph - 3) / 2)}" fill="${v.pillFill}" stroke="${v.ol}" stroke-width="3"/>`);
    out.push(text(px + pw / 2, mid + (MONT_CAP * v.pf) / 2, v.price, { family: SMALL, weight: 900, size: v.pf, fill: v.pillText, anchor: "middle", track: 0.01 }));
    right = px - v.metaGap;
  }
  if (v.hasTime) {
    out.push(text(right, mid + (MONT_CAP * v.tf) / 2, v.time, { family: SMALL, weight: 900, size: v.tf, fill: v.timeColor, anchor: "end", track: 0.01 }));
  }
  return out.join("");
}

function items(r: RowView, x: number, top: number, innerH: number): string {
  const blocks = r.blocks.map((b) => ({
    b, h: Math.max(0, ...b.cols.map((c) => c.items.reduce((a, it) => a + it.minH, 0) + c.gap * Math.max(0, c.items.length - 1))),
  }));
  const total = blocks.reduce((a, b) => a + b.b.mt + b.h, 0);
  let y = top + Math.max(0, (innerH - total) / 2);
  const out: string[] = [];
  for (const { b, h } of blocks) {
    y += b.mt;
    let cx = x;
    for (const c of b.cols) {
      let cy = y;
      for (const it of c.items) { out.push(item(it, cx, cy, c.w)); cy += it.minH + c.gap; }
      cx += c.w + G.colGap;
    }
    y += h;
  }
  return out.join("");
}

function row(r: RowView, x: number, y: number, w: number): string {
  const h = r.h, out: string[] = [];
  const ix = x + G.border + G.padX, iy = y + G.border + G.padY, ih = h - G.border * 2 - G.padY * 2;
  if (r.isEmpty) {
    out.push(`<rect x="${r1(x + 1.5)}" y="${r1(y + 1.5)}" width="${r1(w - 3)}" height="${r1(h - 3)}" rx="20.5" fill="none" stroke="${r.line}" stroke-width="3"/>`);
    const fs = r.dayFs!, sfs = r.stickerFs!;
    out.push(text(ix, y + (h + ANTON_CAP * fs) / 2, r.day!, { size: fs, fill: r.ol!, track: TRACK }));
    if (r.date) out.push(text(ix + antonW(r.day!, fs) + fs * 0.35, y + (h + MONT_CAP * sfs) / 2, r.date!, { family: SMALL, weight: 900, size: sfs, fill: r.ol!, track: 0.01 }));
    return out.join("");
  }
  const sh = parseShadow(r.shadow);
  if (sh) out.push(`<rect x="${r1(x + sh.dx)}" y="${r1(y + sh.dy)}" width="${r1(w)}" height="${r1(h)}" rx="22" fill="${sh.color}"/>`);
  out.push(`<rect x="${r1(x + 1.5)}" y="${r1(y + 1.5)}" width="${r1(w - 3)}" height="${r1(h - 3)}" rx="20.5" fill="${r.fill}" stroke="${r.line}" stroke-width="3"/>`);

  if (r.isBand) {
    const fs = r.labelFs!, lines = (r.label ?? "EVERY DAY").split("\n"), lh = fs * STACK_LH;
    const t = iy + (ih - lines.length * lh) / 2;
    lines.forEach((ln, i) => out.push(text(ix, t + i * lh + ((STACK_LH + ANTON_CAP) / 2) * fs, ln, { size: fs, fill: r.labelColor!, track: TRACK })));
  } else {
    const fs = r.dayFs!, base = y + (h + ANTON_CAP * fs) / 2;
    out.push(outlined(ix, base, r.day!, fs, { fill: r.dayFill!, ol: r.ol!, olEm: 0.06, shEm: 0.06 }));
    if (r.date) {   // posterWeek() blanks the dates (Kyle, 19 Nov 2026), so no sticker is drawn
      const sfs = r.stickerFs!, st = stickerSize(r.date, sfs), labelEnd = ix + antonW(r.day!, fs) + fs * 0.12;
      // beside the label at cap height; on wide labels (MON at full size) it slaps over the label's corner instead
      const cx = Math.min(labelEnd + 6 + st.w / 2, ix + G.dayW + 8 - st.w / 2);
      const cy = base - ANTON_CAP * fs + st.h / 2;
      out.push(sticker(cx, cy, r.date, sfs, r.stickerText!, r.ol!, -5));
    }
  }
  out.push(items(r, ix + G.dayW + G.dayGap, iy, ih));
  return out.join("");
}

function header(hd: HeadView, x: number, top: number, cw: number, safeTop: boolean): string {
  const out: string[] = [], H = hd.h;
  const sub1 = "WHAT’S ON", sub2 = "THIS WEEK";
  const nameOpts = { fill: hd.display, ol: hd.ol, olEm: 0.08, shEm: 0.05 };
  if (hd.side) {
    const nameW = antonW(hd.name, hd.nameF), nx = x + 0.04 * hd.nameF;
    let nTop = top + (H - STACK_LH * hd.nameF) / 2;
    // story: the outline must not poke into the top 250px safe zone (ink top = baseline - cap - outline)
    if (safeTop) nTop = Math.max(nTop, top + 1 + (ANTON_CAP + 0.08 - (STACK_LH + ANTON_CAP) / 2) * hd.nameF);
    out.push(outlined(nx, nTop + ((STACK_LH + ANTON_CAP) / 2) * hd.nameF, hd.name, hd.nameF, nameOpts));
    const subF = hd.subF, subW = Math.max(antonW(sub1, subF), antonW(sub2, subF));
    const nameEnd = nx + nameW;
    const st = stickerSize(hd.dates, hd.dateFs);
    const blockH = 2 * STACK_LH * subF + (hd.sticker ? 12 + st.h : 0);
    let sx: number;
    if (hd.burst) {
      const bx = x + cw - hd.burstSize;
      sx = nameEnd + 28 + Math.max(0, (bx - 24 - (nameEnd + 28) - subW) / 2);
      const cx = bx + hd.burstSize / 2, cy = top + H / 2, rr = hd.burstSize / 2 - 4;
      out.push(`<path d="${star(cx + 6, cy + 6, rr, 4)}" fill="${hd.ol}"/>`);
      out.push(`<path d="${star(cx, cy, rr, 4)}" fill="${hd.display}" stroke="${hd.ol}" stroke-width="4" stroke-linejoin="round"/>`);
      const bl = hd.burstDates.split("\n"), lh = hd.burstFs * STACK_LH, bt = cy - (bl.length * lh) / 2;
      bl.forEach((ln, i) => out.push(text(cx, bt + i * lh + ((STACK_LH + ANTON_CAP) / 2) * hd.burstFs, ln, { size: hd.burstFs, fill: hd.ol, anchor: "middle", track: TRACK })));
    } else {
      sx = Math.max(nameEnd + 28, x + cw - subW);
    }
    sx = Math.min(sx, x + cw - subW - 6);   // keep the stack (and its 4px shadow) inside the right margin
    const bTop = top + (H - blockH) / 2;
    [sub1, sub2].forEach((s, i) => out.push(shadowed(sx, bTop + i * STACK_LH * subF + ((STACK_LH + ANTON_CAP) / 2) * subF, s, subF, hd.ol, hd.display, 4)));
    if (hd.sticker) out.push(sticker(sx + st.w / 2 + 2, bTop + 2 * STACK_LH * subF + 12 + st.h / 2, hd.dates, hd.dateFs, hd.stickerText, hd.ol, -3));
  } else {
    const subF = hd.subF, line = `${sub1} ${sub2}`;
    out.push(shadowed(x, top + ((STACK_LH + ANTON_CAP) / 2) * subF, line, subF, hd.ol, hd.display, 4));
    const st = stickerSize(hd.dates, hd.dateFs);
    out.push(sticker(x + cw - st.w / 2 - 4, top + (STACK_LH * subF) / 2, hd.dates, hd.dateFs, hd.stickerText, hd.ol, -3));
    const below = top + STACK_LH * subF + 12, room = H - STACK_LH * subF - 12;
    const nTop = below + Math.max(0, (room - STACK_LH * hd.nameF) / 2);
    out.push(outlined(x + 0.08 * hd.nameF, nTop + ((STACK_LH + ANTON_CAP) / 2) * hd.nameF, hd.name, hd.nameF, nameOpts));
  }
  return out.join("");
}

function deco(d: DecoView): string {
  const r = d.size / 2, cx = d.x + r, cy = d.y + r;
  return `<path d="${star(cx + 10, cy + 10, r, d.r)}" fill="${d.line}"/>` +
    `<path d="${star(cx, cy, r, d.r)}" fill="${d.fill}" stroke="${d.line}" stroke-width="5" stroke-linejoin="round"/>`;
}

/** The whole poster as one SVG string. */
export function lineupSvg(v: LineupView, assets: LineupAssets): string {
  const x = G.side, cw = v.W - G.side * 2, out: string[] = [];
  out.push(`<rect width="${v.W}" height="${v.H}" fill="${v.bg}"/>`);
  v.deco.forEach((d) => out.push(deco(d)));
  out.push(header(v.head, x, v.top, cw, v.H > v.W * 1.5));
  // Rows. On an overfull week (more than even the smallest type tier can hold) the whole block is scaled down evenly
  // and centred, so nothing is dropped and nothing runs off the poster; the week is flagged for a human to check.
  const fy = v.H - v.bottom - v.footH;
  const y0 = v.top + v.head.h + v.gapHB, room = fy - G.gapRF - y0;
  const total = v.rows.reduce((a, r) => a + r.mt + r.h, 0);
  const k = total > room ? room / total : 1;
  const rowsOut: string[] = [];
  let y = 0;
  for (const r of v.rows) { y += r.mt; rowsOut.push(row(r, 0, y, cw)); y += r.h; }
  out.push(k < 1
    ? `<g transform="translate(${r1(x + (cw * (1 - k)) / 2)} ${r1(y0)}) scale(${Math.round(k * 1000) / 1000})">${rowsOut.join("")}</g>`
    : `<g transform="translate(${x} ${r1(y0)})">${rowsOut.join("")}</g>`);
  const logo = v.logoSrc === "white" ? assets.logoWhite : assets.logoBlack;
  const lh = 56, lw = (logo.w / logo.h) * lh;
  out.push(`<image href="${esc(logo.href)}" x="${x}" y="${r1(fy + (v.footH - lh) / 2)}" width="${r1(lw)}" height="${lh}"/>`);
  const ah = 78, aw = (assets.allIn.w / assets.allIn.h) * ah, acx = x + cw - aw / 2, acy = fy + v.footH / 2;
  out.push(`<image href="${esc(assets.allIn.href)}" x="${r1(acx - aw / 2)}" y="${r1(acy - ah / 2)}" width="${r1(aw)}" height="${ah}" transform="rotate(-6 ${r1(acx)} ${r1(acy)})"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${v.W}" height="${v.H}" viewBox="0 0 ${v.W} ${v.H}">${out.join("")}</svg>`;
}

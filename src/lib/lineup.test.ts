import { describe, expect, it } from "vitest";
import { lineupView, COLOURWAYS, type LineupWeek, type LineupView } from "../../supabase/functions/_shared/lineup/engine.js";
import { lineupSvg } from "../../supabase/functions/_shared/lineup/svg";
import { applyKeys, lineupFileName, COLOURWAY_KEYS } from "../../supabase/functions/_shared/lineup/week";
import { PAI, SIARGAO, STRESS } from "../../tools/lineup/samples";

// Acceptance checks from the Weekly Lineup spec (costing-tool-prompt.md, section 6).
const ASSETS = { logoBlack: { href: "b.png", w: 600, h: 226 }, logoWhite: { href: "w.png", w: 600, h: 181 }, allIn: { href: "a.png", w: 1130, h: 776 } };
const PALETTE = new Set(["#0081f7", "#ffc000", "#ccff01", "#00fef3", "#ff6600", "#03ff01", "#ab00ff", "#ff01aa", "#0a0a0a", "#f5efe2", "#ffffff"]);
const WEEKS = { siargao: SIARGAO, pai: PAI, stress: STRESS };

const allItems = (v: LineupView) => v.rows.flatMap((r) => r.blocks.flatMap((b) => b.cols.flatMap((c) => c.items)));
const inputCount = (w: LineupWeek) => w.everyDay.length + w.days.reduce((a, d) => a + d.items.length, 0);

describe("weekly lineup engine + renderer", () => {
  for (const [name, week] of Object.entries(WEEKS)) {
    for (const fmt of ["post", "story"] as const) {
      for (const way of COLOURWAY_KEYS) {
        const v = lineupView(week, fmt, way);
        const svg = lineupSvg(v, ASSETS);

        it(`${name} ${fmt} ${way}: never drops an item`, () => expect(allItems(v).length).toBe(inputCount(week)));

        it(`${name} ${fmt} ${way}: names are at most 2 lines and never break inside a word`, () => {
          const names = [...week.everyDay, ...week.days.flatMap((d) => d.items)].map((i) => i.name.replace(/\s+/g, " ").trim().toUpperCase());
          for (const it of allItems(v)) {
            const lines = it.text.split("\n");
            expect(lines.length).toBeLessThanOrEqual(2);
            expect(names).toContain(lines.join(" "));
          }
        });

        it(`${name} ${fmt} ${way}: only palette colours, no gradients or blur`, () => {
          const used = new Set((svg.match(/#[0-9a-f]{6}\b/gi) ?? []).map((c) => c.toLowerCase()));
          for (const c of used) expect(PALETTE.has(c), `${c} is not a palette colour`).toBe(true);
          expect(svg).not.toMatch(/Gradient|feGaussianBlur|filter=|opacity=/);
        });

        it(`${name} ${fmt} ${way}: every day keeps its label`, () => {
          const days = v.rows.filter((r) => !r.isBand).map((r) => r.day);
          expect(days).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
        });

        it(`${name} ${fmt} ${way}: fits without falling back to the smallest tier`, () => {
          expect(v.overfull).toBe(false);
          expect(v.tier).toBeLessThan(2);
        });
      }
    }
  }

  it("story keeps text out of the top 250px and bottom 300px", () => {
    for (const week of Object.values(WEEKS)) {
      const v = lineupView(week, "story", "orange-yellow");
      expect(v.top).toBe(250);
      expect(v.bottom).toBe(300);
      const svg = lineupSvg(v, ASSETS);
      // walk the SVG, adding up translate/scale groups so every text gets its absolute position
      const stack: { dy: number; k: number }[] = [{ dy: 0, k: 1 }];
      for (const m of svg.matchAll(/<g transform="([^"]+)">|<\/g>|<text ([^>]*)>/g)) {
        const top = stack[stack.length - 1];
        if (m[0] === "</g>") { stack.pop(); continue; }
        if (m[1] !== undefined) {
          const t = /translate\(([-\d.]+) ([-\d.]+)\)(?: scale\(([\d.]+)\))?/.exec(m[1]);
          stack.push(t ? { dy: top.dy + top.k * +t[2], k: top.k * +(t[3] ?? 1) } : { ...top });
          continue;
        }
        const attr = (k: string) => new RegExp(`${k}="([^"]+)"`).exec(m[2])?.[1];
        const fs = +attr("font-size")!, sw = +(attr("stroke-width") ?? 0);
        const base = top.dy + top.k * +attr("y")!;
        const cap = (attr("font-family") ?? "").startsWith("Anton") ? 0.859 : 0.7;
        expect(base - top.k * (cap * fs + sw / 2), "ink top").toBeGreaterThanOrEqual(250);
        expect(base + top.k * (sw / 2), "ink bottom").toBeLessThanOrEqual(1920 - 300);
      }
    }
  });

  it("an overfull week (Koh Rong size) keeps every item and stays above the footer", () => {
    const names = ["Beach Olympics", "The Meet-Up", "Beer Pong / Table Games", "Fire Show", "Charity Beer Pong Tournament", "Pub Quiz"];
    const big: LineupWeek = { ...STRESS, days: STRESS.days.map((d) => ({ ...d, items: names.map((n, i) => ({ name: n, time: `${i + 2}PM`, price: 0 })) })) };
    for (const fmt of ["post", "story"] as const) {
      const v = lineupView(big, fmt, "blue-lime");
      expect(v.overfull).toBe(true);
      expect(allItems(v).length).toBe(inputCount(big));
      const svg = lineupSvg(v, ASSETS);
      const g = /<g transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)">/.exec(svg);
      expect(g, "rows are scaled to fit").not.toBeNull();
      const total = v.rows.reduce((a, r) => a + r.mt + r.h, 0);
      expect(+g![2] + total * +g![3]).toBeLessThanOrEqual(v.H - v.bottom - v.footH);
    }
  });

  it("a week with no prices shows no price tags; 0 prints FREE", () => {
    expect(allItems(lineupView(PAI, "post", "retro")).some((i) => i.hasPrice)).toBe(false);
    const siargao = allItems(lineupView(SIARGAO, "post", "orange-yellow"));
    expect(siargao.find((i) => i.text.includes("PUB QUIZ"))?.price).toBe("FREE");
    expect(siargao.find((i) => i.text.includes("ADVENTURE"))?.price).toBe("₱2,200");
  });

  it("the KEY pick goes first in its row and is the biggest item", () => {
    const withIds = { ...SIARGAO, days: SIARGAO.days.map((d, i) => ({ ...d, iso: `2026-11-${23 + i}`, items: d.items.map((it, j) => ({ ...it, id: `${i}-${j}` })) })) };
    const v = lineupView(applyKeys(withIds as never, { "2026-11-23": "0-1" }), "post", "orange-yellow");
    const mon = v.rows.find((r) => r.day === "MON")!;
    const first = mon.blocks[0].cols[0].items[0], other = mon.blocks[1].cols[0].items[0];
    expect(first.text).toBe("PUB QUIZ");
    expect(first.key).toBe(true);
    expect(first.fs).toBeGreaterThan(other.fs);
  });

  it("offers exactly the 5 colourways and names files the spec way", () => {
    expect(COLOURWAY_KEYS).toEqual(Object.keys(COLOURWAYS));
    expect(lineupFileName("Nacpan Beach", "2026-12-29", "post-print")).toBe("mm-lineup-nacpan-beach-2026-12-29-post-print.png");
  });
});

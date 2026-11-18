// Render the reference weeks to PNG with the same resvg-wasm + font files the `lineup` Edge Function uses.
//   deno run -A tools/lineup/render_samples.ts <out dir> [colourway ...]
// Fonts and logos are read from public/lineup/ (the files the app and the Edge Function serve).
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
// @deno-types="../../supabase/functions/_shared/lineup/engine.d.ts"
import { lineupView } from "../../supabase/functions/_shared/lineup/engine.js";
import { lineupSvg } from "../../supabase/functions/_shared/lineup/svg.ts";
import { PAI, SIARGAO, STRESS } from "./samples.ts";

const root = new URL("../../public/lineup/", import.meta.url);
const read = (p: string) => Deno.readFileSync(new URL(p, root));
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const png = (p: string, w: number, h: number) => ({ href: `data:image/png;base64,${b64(read(p))}`, w, h });
const assets = { logoBlack: png("mm-logo-black.png", 600, 226), logoWhite: png("mm-logo-white.png", 600, 181), allIn: png("all-in-sticker.png", 1130, 776) };
const fonts = ["fonts/Anton-Regular.ttf", "fonts/Montserrat-SemiBold.ttf", "fonts/Montserrat-Black.ttf", "fonts/Prompt-Black.ttf"].map(read);

await initWasm(await fetch("https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then((r) => r.arrayBuffer()));
const out = Deno.args[0] ?? "lineup-samples";
const ways = Deno.args.slice(1).length ? Deno.args.slice(1) : ["orange-yellow"];
Deno.mkdirSync(out, { recursive: true });
for (const [name, week] of Object.entries({ siargao: SIARGAO, pai: PAI, stress: STRESS })) {
  for (const way of ways) for (const fmt of ["post", "story"] as const) {
    const v = lineupView(week, fmt, way);
    const svg = lineupSvg(v, assets);
    const t0 = performance.now();
    const img = new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Montserrat" } }).render().asPng();
    Deno.writeFileSync(`${out}/${name}-${way}-${fmt}.png`, img);
    console.log(`${name} ${way} ${fmt}: fit ${v.fit} tier ${v.tier}${v.overfull ? " OVERFULL" : ""} head ${v.head.side ? "side" : "stack"}${v.head.burst ? "+burst" : ""} ${Math.round(performance.now() - t0)}ms`);
  }
}

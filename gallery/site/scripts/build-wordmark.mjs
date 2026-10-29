// Outlines the "Hyper's GALLERY" wordmark into SVG paths (src/data/wordmark.json), so its
// spacing and alignment are fixed rather than left to font loading and CSS baselines.
// Units: 1000 = 1em of the mark's font size; y grows downward from the shared baseline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import { decompress } from "wawoff2";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fv = (p) => path.join(ROOT, "node_modules/@fontsource-variable", p);

// fontkit can only instance variable fonts from plain TrueType, so unpack the WOFF2 first.
const load = async (file, axes) =>
  fontkit.create(Buffer.from(await decompress(fs.readFileSync(fv(file))))).getVariation(axes);
const serif = await load("newsreader/files/newsreader-latin-standard-normal.woff2", { wght: 800, opsz: 60 });
const sans = await load("unbounded/files/unbounded-latin-wght-normal.woff2", { wght: 200 });

const U = 1000; // units per em in the output

// Lay out `text` in `font` at `size` em starting at x (em*U); returns one path per glyph.
function run(font, text, size, x, tracking) {
  const k = (U * size) / font.unitsPerEm;
  const { glyphs, positions } = font.layout(text);
  const out = [];
  glyphs.forEach((g, i) => {
    const p = positions[i];
    const d = g.path.scale(k, -k).translate(x + p.xOffset * k, -p.yOffset * k).toSVG();
    out.push({ d, ch: text[i] });
    x += p.xAdvance * k + tracking * U * size;
  });
  return { glyphs: out, x: x - tracking * U * size };
}

const r = (n) => Math.round(n * 10) / 10;
const round = (d) => d.replace(/-?\d+\.\d+/g, (m) => String(r(parseFloat(m))));

// "Hyper’s": heavy serif, tracking -0.02em. The apostrophe is kept separate so it can float.
const main = run(serif, "Hyper’s", 1, 0, -0.02);
// Gap 0.16em, then GALLERY as small capitals: Unbounded caps (0.75em) scaled to Newsreader's
// x-height so they stand exactly as tall as the "s".
// Measured from the outlines themselves (the fonts' metadata values are approximate).
const glyphTop = (font, ch) => font.layout(ch).glyphs[0].bbox.maxY / font.unitsPerEm;
const xHeight = glyphTop(serif, "x");
const capH = glyphTop(sans, "H");
const subSize = xHeight / capH;
const sub = run(sans, "GALLERY", subSize, main.x + 0.16 * U, 0.1);

const all = [...main.glyphs, ...sub.glyphs].map((g) => g.d).join(" ");
// Vertical extent from the outlines themselves.
const ys = [...all.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[2]));
const top = Math.min(...ys);
const bottom = Math.max(...ys);

const data = {
  width: r(sub.x),
  top: r(top),
  bottom: r(bottom),
  // Per-letter spacing step of GALLERY (its 0.1em tracking in mark units), used for the hover spread.
  subStep: r(0.08 * subSize * U),
  main: main.glyphs.filter((g) => g.ch !== "’").map((g) => round(g.d)),
  tick: round(main.glyphs.find((g) => g.ch === "’").d),
  sub: sub.glyphs.map((g) => round(g.d)),
};
// Keep holiday artwork aligned when the owner's name changes.
const markFile = path.join(ROOT, "src/data/wordmark.json");
const festiveFile = path.join(ROOT, "src/data/festive-marks.json");
if (fs.existsSync(markFile) && fs.existsSync(festiveFile)) {
  const previous = JSON.parse(fs.readFileSync(markFile, "utf8"));
  const x = (d) => Number(/^M([-\d.]+)/.exec(d)[1]);
  const dx = x(data.tick) - x(previous.tick);
  const festive = JSON.parse(fs.readFileSync(festiveFile, "utf8"));
  festive.place = festive.place.replace(/translate\(([-\d.]+)/, (_, n) => `translate(${r(Number(n) + dx)}`);
  fs.writeFileSync(festiveFile, JSON.stringify(festive));
}
fs.writeFileSync(path.join(ROOT, "src/data/wordmark.json"), JSON.stringify(data));
console.log(`[wordmark] ${data.width} × ${r(bottom - top)} units, GALLERY at ${subSize.toFixed(3)}em`);

// Reads the albums in ../content (the same folders Hugo used), generates
// responsive WebP variants into public/img, and writes src/data/gallery.json,
// which the Astro pages render from. Results are cached in .cache/, so only
// new or changed photos are processed on later runs.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import exifr from "exifr";
import { featuredRank } from "./featured.mjs";
import { IMAGE_RE, isHeic, imageInput } from "./heic-input.mjs";
import { load as loadYaml } from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.resolve(ROOT, process.env.GALLERY_CONTENT ?? "../content");
const OUT_DIR = path.join(ROOT, "public/img");
const CACHE_FILE = path.join(ROOT, ".cache/images.json");
const MANIFEST = path.join(ROOT, "src/data/gallery.json");

// 2200 sits between 1600 and 3000 so a ~1000px-wide photo on a 2× screen (the hero,
// single-photo pages) gets a file that is just big enough instead of the 3000px one —
// the same sharpness on screen for roughly half the bytes on slow connections.
const WIDTHS = [480, 960, 1600, 2200, 3000];
// Bump to re-encode every photo. v2: high quality, no colour or tone changes.
// Exports are served as immutable (public/_headers): bump this (or THUMBNAIL_VERSION)
// whenever their contents change, so they get new URLs.
const ENCODE_VERSION = 2;
// Listing thumbnails have their own cache/version; full-size photo exports stay intact.
const THUMBNAIL_PRESETS = [
  { edge: 360, quality: 70 },
  { edge: 480, quality: 80 },
  { edge: 540, quality: 80 },
  { edge: 720, quality: 80 },
  { edge: 960, quality: 80 },
  { edge: 1600, quality: 80 },
];
const THUMBNAIL_VERSION = 1;
const CONCURRENCY = Math.max(2, Math.min(6, os.cpus().length - 2));

sharp.concurrency(2);

// "Actual size" albums print each photo at a physical size on the screen: 1 CSS inch is 96px,
// so a 7-inch diagonal postcard is 672px across no matter how wide the window is. A size is
// written either as a diagonal ("7in", 7) or as a paper size ("148x105mm", "5x7in").
const MM_PER = { mm: 1, cm: 10, in: 25.4 };
const PX_PER_MM = 96 / 25.4;

function parseSize(spec) {
  if (spec == null) return null;
  const text = String(spec).trim().toLowerCase();
  const pair = text.match(/^([\d.]+)\s*(mm|cm|in)?\s*[x×]\s*([\d.]+)\s*(mm|cm|in)?$/);
  if (pair) {
    const unit = pair[4] ?? pair[2] ?? "mm";
    const scale = MM_PER[unit] ?? 1;
    const w = Number(pair[1]) * scale;
    const h = Number(pair[3]) * scale;
    return w > 0 && h > 0 ? { w, h } : null;
  }
  const diag = text.match(/^([\d.]+)\s*(mm|cm|in|")?$/);
  if (diag) {
    const unit = diag[2] === '"' ? "in" : diag[2] ?? "in";
    const value = Number(diag[1]) * (MM_PER[unit] ?? 25.4);
    return value > 0 ? { diag: value } : null;
  }
  return null;
}

/** The size a photo is shown at, in CSS pixels, from its physical size and its own aspect. */
function sizeInPx(physical, width, height) {
  if (!physical) return null;
  if (physical.diag) {
    const ratio = width / height;
    const diagonal = physical.diag * 1;
    const w = (diagonal * ratio) / Math.hypot(ratio, 1);
    const h = diagonal / Math.hypot(ratio, 1);
    return { w: Math.round(w * PX_PER_MM), h: Math.round(h * PX_PER_MM) };
  }
  const scale = Math.min(physical.w / width, physical.h / height);
  return {
    w: Math.round(width * scale * PX_PER_MM),
    h: Math.round(height * scale * PX_PER_MM),
  };
}

// Mirrors Hugo's urlize so existing album links keep working.
export function urlize(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\p{M}._~+#-]/gu, "");
}

function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? (loadYaml(m[1]) ?? {}) : {};
}

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function fmtNumber(v, digits) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.0+$/, "");
}

function fmtShutter(t) {
  if (!t) return null;
  if (t >= 1) return `${fmtNumber(t, 1)}s`;
  return `1/${Math.round(1 / t)}s`;
}

async function readExif(file) {
  try {
    const e = await exifr.parse(file, {
      pick: ["Make", "Model", "LensModel", "FNumber", "ExposureTime", "FocalLength", "ISO", "DateTimeOriginal", "ImageDescription"],
    });
    if (!e) return null;
    const exif = {
      camera: e.Model ? String(e.Model).trim() : null,
      lens: e.LensModel ? String(e.LensModel).trim() : null,
      focal: e.FocalLength ? `${fmtNumber(e.FocalLength, 0)}mm` : null,
      aperture: e.FNumber ? `f/${fmtNumber(e.FNumber, 1)}` : null,
      shutter: fmtShutter(e.ExposureTime),
      iso: e.ISO ? `ISO ${e.ISO}` : null,
      date: e.DateTimeOriginal instanceof Date ? [e.DateTimeOriginal.getFullYear(), String(e.DateTimeOriginal.getMonth() + 1).padStart(2, "0"), String(e.DateTimeOriginal.getDate()).padStart(2, "0")].join("-") : null,
      description: e.ImageDescription ? String(e.ImageDescription).trim() : null,
    };
    return Object.values(exif).some(Boolean) ? exif : null;
  } catch {
    return null;
  }
}

// The photo's leading colour, measured in OKLab. Pixels vote into 36 hue bins weighted by
// chroma (so a red taxi in a blue night scene picks one of the two instead of averaging
// them into grey); the winning cluster's precise hue and chroma are then averaged.
const TONE_VERSION = 4;
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function oklab(r, g, b) {
  r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817028649 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
async function toneOf(input) {
  const { data, info } = await sharp(input).resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const px = [];
  const bins = new Array(36).fill(0);
  let L = 0, A = 0, B = 0;
  for (let i = 0; i < data.length; i += 3) {
    const [l, a, b] = oklab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    L += l; A += a; B += b;
    const c = Math.hypot(a, b);
    if (c < 0.02) continue;
    const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    px.push([h, c, l]);
    bins[Math.floor(h / 10) % 36] += c;
  }
  const smooth = bins.map((v, i) => v + 0.6 * (bins[(i + 35) % 36] + bins[(i + 1) % 36]));
  const top = smooth.indexOf(Math.max(...smooth));
  const centre = top * 10 + 5;
  let x = 0, y = 0, w = 0, cnt = 0;
  for (const [h, c, l] of px) {
    const d = Math.abs(((h - centre + 540) % 360) - 180);
    if (d > 20) continue;
    const r = (h * Math.PI) / 180;
    x += Math.cos(r) * c; y += Math.sin(r) * c; w += c; cnt++;
  }
  const r3 = (v) => +v.toFixed(3);
  return {
    v: TONE_VERSION,
    hue: w ? Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) : centre,
    chroma: cnt ? r3(w / cnt) : 0, // typical chroma of the leading colour
    share: r3(w / n), // how much of the picture it covers, weighted by colourfulness
    lightness: r3(L / n),
    cast: [r3(A / n), r3(B / n)], // overall colour cast, for near-neutral photos
  };
}

const HASH_FILE = path.join(ROOT, ".cache/hashes.json");
const hashes = existsSync(HASH_FILE) ? JSON.parse(await fs.readFile(HASH_FILE, "utf8")) : {};

// A photo's folder name (and so its URLs) must depend only on the photo itself.
// It used to include the file's modification time, which differs on every fresh git
// checkout: each Cloudflare build renamed every image and emptied visitors' caches.
// Content hashes are remembered per path/size/mtime so local builds don't re-read
// unchanged originals.
async function contentHash(file, stat) {
  const memo = `${path.relative(CONTENT, file)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  if (hashes[memo]) return hashes[memo];
  const hash = crypto.createHash("sha1").update(await fs.readFile(file)).digest("hex");
  hashes[memo] = hash;
  return hash;
}

// The photo's four colours for the colour cards, in this order: the most eye-catching
// colour (saturated and bright, almost regardless of area), the main colour (largest
// area, low-saturation colours included; black, white or grey may win but count a
// little less), then two more chosen to
// catch the eye the same way while differing as much as possible from those, with hues
// spread round the colour wheel and a bonus for complementary hues. The picture is split into colour groups (k-means in
// OKLab on a 96px copy, seeded deterministically so builds agree), plus groups of its
// colourful pixels and one per 30° of hue so small accents can be offered. Greys only
// count as "other" colours when the whole picture is muted.
const PALETTE_VERSION = 24;
function linearToSrgb(v) {
  v = Math.min(1, Math.max(0, v));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}
function oklabToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return "#" + rgb.map((v) => Math.round(linearToSrgb(v) * 255).toString(16).padStart(2, "0")).join("");
}
// Vibrance rather than raw saturation: how far a colour goes toward the most saturated
// colour sRGB can show at its lightness and hue (so a deep blue and a bright yellow are
// judged on the same scale), eased so moderately vivid colours count nearly as much as
// the most extreme ones, like a photo editor's vibrance control.
function inSrgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((v) => v >= -0.001 && v <= 1.001);
}
// How far a colour goes toward the most saturated sRGB colour of its lightness and hue.
function relativeSaturation([L, a, b]) {
  const chroma = Math.hypot(a, b);
  if (chroma < 1e-4) return 0;
  const ca = a / chroma, cb = b / chroma;
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgb(L, ca * mid, cb * mid)) lo = mid;
    else hi = mid;
  }
  return Math.min(1, chroma / Math.max(lo, 1e-4));
}
function vibrance(c) {
  return 1 - (1 - relativeSaturation(c)) ** 2;
}
const labDistance = (p, q) => Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
function kmeans(px, k) {
  // Seeds: the fullest cells of a coarse OKLab grid, skipping any too close to one taken.
  const cells = new Map();
  for (const p of px) {
    const key = `${Math.round(p[0] * 10)},${Math.round(p[1] * 25)},${Math.round(p[2] * 25)}`;
    const cell = cells.get(key) ?? { n: 0, sum: [0, 0, 0] };
    cell.n++;
    cell.sum = cell.sum.map((v, i) => v + p[i]);
    cells.set(key, cell);
  }
  const ranked = [...cells.values()].sort((x, y) => y.n - x.n).map((c) => c.sum.map((v) => v / c.n));
  const centres = [];
  for (const minGap of [0.08, 0.04, 0]) {
    for (const c of ranked) {
      if (centres.length >= k) break;
      if (!centres.includes(c) && centres.every((d) => labDistance(c, d) > minGap)) centres.push(c);
    }
  }
  let groups = [];
  for (let iter = 0; iter < 12; iter++) {
    groups = centres.map(() => ({ n: 0, sum: [0, 0, 0] }));
    for (const p of px) {
      let best = 0;
      for (let j = 1; j < centres.length; j++) if (labDistance(p, centres[j]) < labDistance(p, centres[best])) best = j;
      groups[best].n++;
      groups[best].sum = groups[best].sum.map((v, i) => v + p[i]);
    }
    groups.forEach((g, j) => { if (g.n) centres[j] = g.sum.map((v) => v / g.n); });
  }
  return centres.map((c, j) => ({ c, share: groups[j].n / px.length, chroma: Math.hypot(c[1], c[2]) }));
}
async function paletteOf(input, k = 4) {
  const { data } = await sharp(input).resize(96, 96, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += 3) px.push(oklab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255));
  const chromaOf = (c) => Math.hypot(c[1], c[2]);
  const hueOf = (c) => Math.atan2(c[2], c[1]);
  // Colourful pixels, grouped on their own so a small vivid accent gets a group.
  const vivid = px.filter((p) => chromaOf(p) > 0.05);
  const tinted = px.filter((p) => chromaOf(p) > 0.025);
  const colourful = px.filter((p) => chromaOf(p) > 0.03).length / px.length;
  const areaGroups = kmeans(px, 10);
  const groups = [...areaGroups];
  if (vivid.length >= 6) {
    for (const g of kmeans(vivid, Math.min(5, vivid.length))) groups.push({ ...g, share: (g.share * vivid.length) / px.length });
    // And one candidate per 30° slice of the colour wheel, so every hue family that is
    // really present can be offered, however small.
    const slices = Array.from({ length: 12 }, () => ({ n: 0, sum: [0, 0, 0] }));
    for (const p of tinted) {
      const slice = slices[Math.floor(((hueOf(p) + Math.PI) / (2 * Math.PI)) * 12) % 12];
      slice.n++;
      slice.sum = slice.sum.map((v, i) => v + p[i]);
    }
    for (const slice of slices) {
      if (!slice.n) continue;
      const c = slice.sum.map((v) => v / slice.n);
      // A clearly coloured hue may be tiny (a flag on a stage) and still count.
      groups.push({ c, share: slice.n / px.length, chroma: chromaOf(c), tiny: chromaOf(c) >= 0.06 });
    }
  }
  // A muted picture (little colour anywhere) keeps its quiet tones. Otherwise the card
  // is about colour: blacks, whites and greys are left out while enough real colours
  // exist, and hues are spread round the colour wheel instead of four shades of one.
  const muted = colourful < 0.08;
  const isColour = (g) => g.chroma >= 0.03 && g.c[0] > 0.2 && g.c[0] < 0.95;
  let candidates = groups.filter((g) => g.share >= 0.0015 || (g.tiny && g.share >= 0.0004));
  if (!muted && candidates.filter(isColour).length >= k) candidates = candidates.filter(isColour);
  // How much a colour catches the eye: saturated and bright, almost regardless of area.
  // Vibrance leads (it outweighs brightness and area); chroma keeps near-greys, whose
  // relative saturation can look high at the very dark end, from scoring.
  const striking = (g) => vibrance(g.c) ** 2 * Math.min(1, g.chroma / 0.04) * (0.5 + g.c[0]) * g.share ** 0.12;
  const hueGap = (g, h) => Math.abs(((hueOf(g.c) - hueOf(h.c) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  // 1. The most eye-catching colour: the purest, most saturated clear colour present,
  //    however small (in a muted picture, only if it has real colour). Purity is judged
  //    against what the screen can show at that lightness and hue, and murky dark or
  //    washed-out light tones lose out to clear mid-to-bright ones.
  const clarity = (L) => Math.max(0.15, 1 - Math.abs(L - 0.68) * 1.6);
  const purest = (g) => relativeSaturation(g.c) ** 2 * g.chroma * clarity(g.c[0]) * g.share ** 0.05;
  const chosen = [];
  const accent = candidates.reduce((a, b) => (purest(b) > purest(a) ? b : a));
  if (!muted || accent.chroma > 0.05) chosen.push(accent);
  // 2. The main colour: the largest area, where black, white and grey may win but count
  //    a little less than a real colour. Skipped if it is the eye-catching one again.
  // Only true black, white and grey count less; a muted, low-saturation colour does not.
  const neutral = (g) => g.chroma < 0.015 || g.c[0] <= 0.12 || g.c[0] >= 0.97;
  // Pure black, white and grey (no colour at all) are never sought out; only an entirely
  // colourless picture falls back to them.
  const pure = (g) => g.chroma < 0.01;
  const pool = areaGroups.filter((g) => g.share > 0 && chosen.every((h) => labDistance(g.c, h.c) > 0.05));
  const main = (pool.some((g) => !pure(g)) ? pool.filter((g) => !pure(g)) : pool)
    .reduce((a, b) => (b.share * (neutral(b) && !muted ? 0.7 : 1) > a.share * (neutral(a) && !muted ? 0.7 : 1) ? b : a));
  chosen.push(main);
  // 3–4. The rest: real colours as different as possible from the first two. Pure
  //      black, white and grey only fill in when nothing with any colour is left
  //      (a black-and-white photograph), muted pictures included.
  {
    const tinted = candidates.filter((g) => !pure(g));
    if (tinted.filter((g) => !chosen.includes(g)).length >= k - chosen.length) candidates = tinted;
  }
  while (chosen.length < k && candidates.some((g) => !chosen.includes(g))) {
    let best = null;
    let bestScore = -1;
    for (const g of candidates) {
      if (chosen.includes(g)) continue;
      const apart = Math.min(...chosen.map((h) => labDistance(g.c, h.c)));
      const coloured = chosen.filter((h) => h.chroma >= 0.02);
      let spread = 1;
      let complement = 0;
      if (!muted && coloured.length) {
        // New hues score higher the further round the wheel they are from those chosen
        // (full credit from 90° apart); close to one already shown they are held back.
        const nearest = Math.min(...coloured.map((h) => hueGap(g, h)));
        spread = 0.1 + 0.9 * Math.min(1, nearest / (Math.PI / 2));
        complement = Math.max(...coloured.map((h) => (hueGap(g, h) / Math.PI) ** 2));
      }
      // Like the first colour, these are chosen for how much they catch the eye
      // (saturated and bright, area barely counting), held back when they sit close to
      // a colour already shown, in colour or in hue. In a muted picture, a little
      // presence still matters so its few real tones are the ones offered.
      const eye = striking(g) * (muted ? g.share ** 0.2 : 1);
      // Outside muted pictures, washed-out colours count for little.
      const colourWeight = muted ? 1 : Math.min(1, g.chroma / 0.08) ** 2;
      const score = eye * colourWeight * spread * Math.min(1, apart / 0.22) * (1 + 1.2 * complement);
      if (score > bestScore) [best, bestScore] = [g, score];
    }
    if (!best) break;
    chosen.push(best);
  }
  // Show each colour as the eye reads it in the photo. Deep colours (a night harbour's
  // blue is near rgb(2, 44, 57) on average) look clearly coloured beside the scene's
  // darks but nearly black as a small swatch on a light page, so dark colours are lifted
  // to a readable lightness, keeping their hue, with chroma scaled up alongside.
  // The first colour is shown at its purest: the vivid core of its hue, not an average
  // softened by the duller pixels around it.
  const core = (g) => {
    let w = 0;
    const sum = [0, 0, 0];
    for (const p of px) {
      const c = chromaOf(p);
      if (c < g.chroma || Math.abs(((hueOf(p) - hueOf(g.c) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.26) continue;
      const weight = c ** 3;
      w += weight;
      for (let i = 0; i < 3; i++) sum[i] += p[i] * weight;
    }
    return w ? sum.map((v) => v / w) : g.c;
  };
  const shown = [];
  for (const g of chosen) {
    const base = g === accent && g.chroma >= 0.03 ? core(g) : g.c;
    const [L, a, b] = base;
    let c = base;
    if (!muted && g.chroma >= 0.03 && L < 0.42) {
      const lift = Math.min(1.6, 0.42 / L);
      c = [0.42, a * lift, b * lift];
      // Keep the true depth if lifting would make it a twin of a colour already shown.
      if (shown.some((s) => labDistance(s, c) < 0.05)) c = base;
    }
    shown.push(c);
  }
  return { v: PALETTE_VERSION, colors: shown.map(oklabToHex) };
}

async function processImage(file, cache) {
  const stat = await fs.stat(file);
  const rel = path.relative(CONTENT, file);
  const key = crypto
    .createHash("sha1")
    .update(`${rel}:${await contentHash(file, stat)}:${ENCODE_VERSION}`)
    .digest("hex")
    .slice(0, 12);
  // Move exports made under the old, mtime-based name instead of re-encoding them.
  const legacyKey = crypto
    .createHash("sha1")
    .update(`${rel}:${stat.size}:${Math.round(stat.mtimeMs)}:${ENCODE_VERSION}`)
    .digest("hex")
    .slice(0, 12);
  if (!cache[key] && cache[legacyKey] && existsSync(path.join(OUT_DIR, legacyKey)) && !existsSync(path.join(OUT_DIR, key))) {
    await fs.rename(path.join(OUT_DIR, legacyKey), path.join(OUT_DIR, key));
    cache[key] = JSON.parse(JSON.stringify(cache[legacyKey]).replaceAll(`/img/${legacyKey}/`, `/img/${key}/`));
    delete cache[legacyKey];
  }
  const dir = path.join(OUT_DIR, key);
  const cached = cache[key];
  const heic = isHeic(file);
  // Decode lazily: cached HEIC previews need no second decode on local rebuilds.
  let input;
  const getInput = async () => input ??= await imageInput(file);
  const displayUrl = `/img/${key}/full-resolution.jpg`;
  const displayPath = path.join(ROOT, "public", displayUrl);
  // Publish the source bytes as well as the responsive exports, including EXIF.
  const originalUrl = `/img/${key}/original${path.extname(file).toLowerCase()}`;
  await fs.mkdir(dir, { recursive: true });
  const originalPath = path.join(ROOT, "public", originalUrl);
  if (!existsSync(originalPath)) await fs.copyFile(file, originalPath);

  if (cached && (!heic || existsSync(displayPath)) && cached.srcset.every((s) => existsSync(path.join(ROOT, "public", s.url)))) {
    if (cached.tone?.v !== TONE_VERSION) cached.tone = await toneOf(path.join(ROOT, "public", cached.srcset[0].url));
    if (cached.palette?.v !== PALETTE_VERSION) cached.palette = await paletteOf(path.join(ROOT, "public", cached.srcset[0].url));
    // Add any size introduced since this photo was cached, without re-encoding the rest.
    const longest = Math.max(cached.width, cached.height);
    const have = new Set(cached.srcset.map((v) => v.url.match(/\/(\d+)\.webp$/)?.[1]));
    const missing = WIDTHS.filter((w) => w < longest && !have.has(String(w)));
    if (missing.length) {
      const base = sharp(await getInput(), { limitInputPixels: false }).rotate();
      for (const box of missing) {
        const scale = Math.min(1, box / longest);
        const w = Math.round(cached.width * scale);
        const h = Math.round(cached.height * scale);
        const url = `/img/${key}/${box}.webp`;
        await base.clone().resize(w, h, { fit: "fill" }).webp({ quality: 92, smartSubsample: true, effort: 5 }).toFile(path.join(ROOT, "public", url));
        cached.srcset.push({ url, w, h });
      }
      cached.srcset.sort((a, b) => a.w - b.w);
    }
    cached.original = { url: originalUrl, w: cached.width, h: cached.height };
    return { key, ...cached };
  }

  const base = sharp(await getInput(), { limitInputPixels: false }).rotate();
  const meta = await sharp(await getInput(), { limitInputPixels: false }).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  const longest = Math.max(width, height);
  // Browser-compatible full-pixel version for zooming; original HEIC stays downloadable.
  if (heic) await base.clone().jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toFile(displayPath);

  await fs.mkdir(dir, { recursive: true });
  const srcset = [];
  const targets = WIDTHS.filter((w) => w < longest);
  if (!targets.includes(Math.min(3000, longest))) targets.push(Math.min(3000, longest));
  for (const box of targets) {
    // Fit inside a box×box square, like Hugo's "fit WxH".
    const scale = Math.min(1, box / longest);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const url = `/img/${key}/${box}.webp`;
    await base
      .clone()
      .resize(w, h, { fit: "fill" })
      .webp({ quality: 92, smartSubsample: true, effort: 5 })
      .toFile(path.join(ROOT, "public", url));
    srcset.push({ url, w, h });
  }

  const small = await base.clone().resize(64, 64, { fit: "inside" }).toBuffer();
  const { dominant } = await sharp(small).stats();
  const color = `rgb(${dominant.r} ${dominant.g} ${dominant.b})`;
  const lqip = await sharp(small)
    .resize(24, 24, { fit: "inside" })
    .blur(1.2)
    .webp({ quality: 40 })
    .toBuffer()
    .then((b) => `data:image/webp;base64,${b.toString("base64")}`);
  const exif = await readExif(file);

  const tone = await toneOf(small);
  const palette = await paletteOf(small);
  const original = { url: originalUrl, w: width, h: height };
  const entry = { width, height, color, lqip, srcset, exif, tone, palette, original,
    ...(heic ? { displayOriginal: { url: displayUrl, w: width, h: height } } : {}) };
  cache[key] = entry;
  return { key, ...entry };
}

async function ensureThumbnail(photo, cache) {
  const entry = cache[photo.key];
  const cached = entry.thumbnails ?? (entry.thumbnail ? [entry.thumbnail] : []);
  const thumbnails = [];
  for (const { edge, quality } of THUMBNAIL_PRESETS) {
    const url = `/img/${photo.key}/thumb-${edge}-q${quality}-v${THUMBNAIL_VERSION}.webp`;
    const output = path.join(ROOT, "public", url);
    const variant = cached.find((v) => v.url === url);
    if (variant && existsSync(output)) {
      thumbnails.push(variant);
      continue;
    }
    // The small high-quality export has orientation and colour processing applied.
    const source = photo.srcset.find((v) => Math.max(v.w, v.h) >= edge) ?? photo.srcset.at(-1);
    const { data, info } = await sharp(path.join(ROOT, "public", source.url))
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    await fs.writeFile(output, data);
    thumbnails.push({ url, w: info.width, h: info.height });
  }
  // Small originals can yield the same width in several boxes; srcset needs unique widths.
  photo.thumbnails = [...new Map(thumbnails.map((v) => [v.w, v])).values()];
  photo.thumbnail = thumbnails[1];
  entry.thumbnails = photo.thumbnails;
  entry.thumbnail = photo.thumbnail;
}

async function pool(items, fn, size, label = "images") {
  const results = new Array(items.length);
  let i = 0;
  let done = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
      done++;
      if (done % 25 === 0 || done === items.length) {
        process.stdout.write(`\r  ${label}: ${done}/${items.length}`);
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  return results;
}

async function main() {
  console.log(`[gallery] reading albums from ${CONTENT}`);
  const cache = existsSync(CACHE_FILE) ? JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) : {};

  const albums = [];
  const jobs = [];
  for (const dirName of (await fs.readdir(CONTENT)).sort()) {
    const dir = path.join(CONTENT, dirName);
    const indexFile = path.join(dir, "index.md");
    if (!(await fs.stat(dir)).isDirectory() || !existsSync(indexFile)) continue;
    const fm = parseFrontMatter(await fs.readFile(indexFile, "utf8"));
    if (fm.draft === true) continue;
    // Publisher-prepared albums need no access to private originals during Actions builds.
    const preparedFile = path.join(dir, '_processed.json');
    if (existsSync(preparedFile)) {
      const album = JSON.parse(await fs.readFile(preparedFile, 'utf8'));
      album.dir = dirName; album.slug = urlize(dirName);
      album.title = String(fm.title ?? album.title); album.date = toDate(fm.date);
      album.description = fm.description ?? null;
      album.categories = Array.isArray(fm.categories) ? fm.categories.map(String) : [];
      album.showPalette = (fm.showPalette ?? true) === true;
      album.private = Boolean(fm.private); album.featured = Boolean(fm.featured);
      const resources = Array.isArray(fm.resources) ? fm.resources : [];
      album.photos = album.photos.filter(p => !resources.find(r => r.src === p.file)?.params?.hidden);
      for (const photo of album.photos) {
        const params = resources.find(r => r.src === photo.file)?.params ?? {};
        photo.featured = featuredRank(params.featured); photo.description = params.description ?? null;
      }
      album.cover = resources.find(r => r.params?.cover)?.src ?? album.cover;
      album.prepared = true;
      for (const photo of album.photos) {
        if (!/^[a-f0-9]{12}$/.test(photo.key)) throw new Error('Invalid prepared photo key');
        await fs.cp(path.join(dir, '_preview', photo.key), path.join(OUT_DIR, photo.key), { recursive: true });
      }
      albums.push(album);
      continue;
    }
    // Hugo sorts resources by Name ascending by default.
    const files = (await fs.readdir(dir)).filter((f) => IMAGE_RE.test(f)).sort();
    if (files.length === 0) continue;

    const resources = Array.isArray(fm.resources) ? fm.resources : [];
    const hidden = new Set(resources.filter((r) => r?.params?.hidden).map((r) => r.src));
    const coverSrc = resources.find((r) => r?.params?.cover && files.includes(r.src))?.src;
    const params = fm.params ?? {};
    const album = {
      dir: dirName,
      slug: urlize(dirName),
      title: String(fm.title ?? dirName),
      description: fm.description ?? params.description ?? null,
      date: toDate(fm.date),
      categories: Array.isArray(fm.categories) ? fm.categories.map(String) : [],
      layout: fm.layout === "single-big-photo" ? "single" : fm.layout === "actual" ? "actual" : "gallery",
      // "Actual size": every photo printed at a physical size, optionally one per file.
      size: params.size ?? fm.size ?? null,
      sizes: params.sizes ?? fm.sizes ?? null,
      showPalette: (fm.showPalette ?? params.showPalette) === true,
      featured: Boolean(fm.featured ?? params.featured),
      private: Boolean(fm.private ?? params.private),
      cover: coverSrc ?? files.find((f) => /feature/i.test(f)) ?? files[0],
      photos: [...resources.map((r) => r.src).filter((f) => files.includes(f)), ...files.filter((f) => !resources.some((r) => r.src === f))]
        .filter((f) => !hidden.has(f)).map((file) => {
          const resource = resources.find((r) => r.src === file);
          return { file, title: path.parse(file).name, description: resource?.params?.description ?? null,
            featured: featuredRank(resource?.params?.featured) };
        }),
    };
    albums.push(album);
    for (const photo of album.photos) jobs.push({ album, photo });
  }

  console.log(`[gallery] ${albums.length} albums, ${jobs.length} photos (concurrency ${CONCURRENCY})`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await pool(
    jobs,
    async ({ album, photo }) => {
      try {
        Object.assign(photo, await processImage(path.join(CONTENT, album.dir, photo.file), cache));
      } catch (err) {
        console.error(`\n[gallery] failed: ${album.dir}/${photo.file}: ${err.message}`);
        photo.failed = true;
      }
    },
    CONCURRENCY,
  );

  // A failed conversion must fail deployment rather than silently remove a user's photo.
  const failures = jobs.filter(({ photo }) => photo.failed);
  if (failures.length) throw new Error(`${failures.length} photo(s) could not be processed; fix the files listed above and rebuild.`);

  // "Actual size": how big each photo prints, in CSS pixels. A file can carry its own size;
  // otherwise the album's size applies. With neither, the album falls back to the gallery.
  for (const album of albums) {
    if (album.layout !== "actual") continue;
    const fallback = parseSize(album.size);
    const map = album.sizes && typeof album.sizes === "object" ? album.sizes : {};
    for (const photo of album.photos) {
      photo.actual = sizeInPx(parseSize(map[photo.file]) ?? fallback, photo.width, photo.height);
    }
    if (!album.photos.some((p) => p.actual)) album.layout = "gallery";
  }
  const published = albums.filter((a) => a.photos.length > 0);
  published.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title, "zh"));

  const covers = published.filter(a => !a.prepared).map((album) => album.photos.find((p) => p.file === album.cover) ?? album.photos[0]);
  await pool(covers, (photo) => ensureThumbnail(photo, cache), CONCURRENCY, "thumbnails");

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  await fs.writeFile(HASH_FILE, JSON.stringify(hashes));
  await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
  await fs.writeFile(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), albums: published }));

  // Remove variants of photos that no longer exist.
  const live = new Set(published.flatMap((a) => a.photos.map((p) => p.key)));
  for (const d of await fs.readdir(OUT_DIR)) {
    if (!live.has(d)) await fs.rm(path.join(OUT_DIR, d), { recursive: true, force: true });
  }
  console.log(`[gallery] wrote ${path.relative(ROOT, MANIFEST)}`);
}

await main();

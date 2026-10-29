import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import subsetFont from "subset-font";

const SOURCE = fileURLToPath(new URL("../src/", import.meta.url));
const CACHE = fileURLToPath(new URL("../.cache/font-subsets/", import.meta.url));
const require = createRequire(import.meta.url);
const SUBSET_VERSION = require("subset-font/package.json").version;

// Variation ranges the site actually uses, per family. Glyph deltas outside these
// ranges are dropped (HarfBuzz instancer), so the files shrink while every weight
// on the page renders exactly as before. Keep in sync with the CSS if weights change.
const AXES = {
  // Titles only ever use 800 and 900.
  "Noto Serif SC Variable": { wght: { min: 800, max: 900 } },
  "Noto Serif JP Variable": { wght: { min: 800, max: 900 } },
  // Light UI text: 300 body/nav, 400 at most; a little headroom either side.
  "Commissioner Variable": { wght: { min: 200, max: 500 } },
  "Noto Sans SC Variable": { wght: { min: 200, max: 500 } },
  "Noto Sans JP Variable": { wght: { min: 200, max: 500 } },
  // Latin in titles at 800 (the family's maximum); optical size stays automatic.
  "Newsreader Variable": { wght: { min: 800, max: 800 } },
  // The tagline: italic 400 only.
  "Playfair Display Variable": { wght: { min: 400, max: 400 } },
  // Numbers and labels: 300–400, at 87.5% or normal width; 800 (the maximum) for hovered photo counts.
  "Martian Mono Variable": { wght: { min: 300, max: 800 }, wdth: { min: 87.5, max: 100 } },
};
const familyOf = (rule) =>
  rule.nodes.find((node) => node.prop === "font-family")?.value.replace(/^['"]|['"]$/g, "");

async function subsetSource(declaration, points) {
  const match = declaration.value.match(/url\((['"]?)(.*?)\1\)/);
  const stylesheet = declaration.source?.input.file;
  if (!match || !stylesheet || !stylesheet.includes("@fontsource-variable")) return;
  const original = path.resolve(path.dirname(stylesheet), match[2]);
  const input = await fs.readFile(original);
  const text = String.fromCodePoint(...points);
  const rule = declaration.parent;
  const axes = AXES[familyOf(rule)];
  const hash = createHash("sha256")
    .update(SUBSET_VERSION)
    .update(input)
    .update(text)
    .update(JSON.stringify(axes ?? {}))
    .digest("hex")
    .slice(0, 20);
  const output = path.join(CACHE, `${path.basename(original, ".woff2")}-${hash}.woff2`);
  try {
    await fs.access(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // HarfBuzz keeps all layout features, glyph closure, hinting and variation
    // axes by default, including vertical forms used by the exhibition titles.
    const data = await subsetFont(input, text, { targetFormat: "woff2", ...(axes && { variationAxes: axes }) });
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(output, data);
  }
  // Keep resolution relative to the imported font CSS, just like its original URL.
  const relative = path.relative(path.dirname(stylesheet), output).split(path.sep).join("/");
  declaration.value = declaration.value.replace(match[0], `url("${relative}")`);
  // Tell the browser the narrowed ranges, so it never asks the file for more.
  if (axes?.wght) {
    const w = rule.nodes.find((node) => node.prop === "font-weight");
    if (w) w.value = axes.wght.min === axes.wght.max ? String(axes.wght.min) : `${axes.wght.min} ${axes.wght.max}`;
  }
  if (axes?.wdth) {
    const st = rule.nodes.find((node) => node.prop === "font-stretch");
    if (st) st.value = `${axes.wdth.min}% ${axes.wdth.max}%`;
  }
}

async function sourceText(dir, { skipData = false } = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceText(file, { skipData });
    if (!/\.(astro|[cm]?[jt]s|json|css)$/.test(entry.name)) return "";
    if (skipData && path.basename(path.dirname(file)) === "data") return "";
    const text = await fs.readFile(file, "utf8");
    return entry.name.endsWith(".json") ? JSON.stringify(JSON.parse(text)) : text;
  }))).join("\n");
}

// Include album titles, categories and EXIF from the generated manifest as well
// as template/runtime text. Subsetting never changes the CSS font descriptors.
export function fontRanges({ subset = false } = {}) {
  return {
    postcssPlugin: "gallery-font-ranges",
    async Once(root) {
      if (!root.nodes.some((node) => node.type === "atrule" && node.name === "font-face")) return;
      const text = await sourceText(SOURCE);
      const points = new Set(Array.from(text, (c) => c.codePointAt(0)));
      // Runtime numbers, punctuation, dates and escaped characters.
      for (let cp = 0; cp <= 0xff; cp++) points.add(cp);
      for (const match of text.matchAll(/\\u(?:\{([\da-f]+)\}|([\da-f]{4}))/gi)) {
        points.add(parseInt(match[1] ?? match[2], 16));
      }
      const sorted = [...points].sort((a, b) => a - b);
      // The light sans never sets album titles (those are always the heavy serif), so its
      // CJK subset only needs interface text plus category names — a far smaller file.
      const manifest = JSON.parse(await fs.readFile(path.join(SOURCE, "data/gallery.json"), "utf8"));
      const uiText =
        (await sourceText(SOURCE, { skipData: true })) +
        manifest.albums.flatMap((a) => a.categories).join("");
      const uiPoints = new Set(Array.from(uiText, (c) => c.codePointAt(0)));
      for (let cp = 0; cp <= 0xff; cp++) uiPoints.add(cp);
      const uiSorted = [...uiPoints].sort((a, b) => a - b);
      const faces = [];
      root.walkAtRules("font-face", (rule) => faces.push(rule));
      for (const rule of faces) {
        const range = rule.nodes.find((node) => node.prop === "unicode-range");
        if (!range) continue;
        const intervals = range.value.split(",").map((part) => {
          const [start, end = start] = part.trim().slice(2).split("-");
          return [parseInt(start.replaceAll("?", "0"), 16), parseInt(end.replaceAll("?", "f"), 16)];
        });
        const pool = /^Noto Sans (SC|JP)? ?Variable$/.test(familyOf(rule)) ? uiSorted : sorted;
        const used = pool.filter((cp) => intervals.some(([start, end]) => cp >= start && cp <= end));
        if (!used.length) {
          rule.remove();
          continue;
        }
        const compact = [];
        for (const cp of used) {
          const last = compact.at(-1);
          if (last && cp === last[1] + 1) last[1] = cp;
          else compact.push([cp, cp]);
        }
        range.value = compact.map(([start, end]) => `U+${start.toString(16)}${end === start ? "" : `-${end.toString(16)}`}`).join(",");
        if (subset) {
          const src = rule.nodes.find((node) => node.prop === "src");
          if (src) await subsetSource(src, used);
        }
      }
    },
  };
}

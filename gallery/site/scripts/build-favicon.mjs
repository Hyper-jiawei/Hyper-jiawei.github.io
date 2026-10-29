// Reuse the wordmark outlines so the tab icon stays part of the same identity.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mark = JSON.parse(await fs.readFile(path.join(ROOT, "src/data/wordmark.json"), "utf8"));
const out = path.join(ROOT, "public/images");
const colors = {
  light: { paper: "#ebe7df", ink: "#1c1a16", accent: "#a2361f" },
  dark: { paper: "#12110f", ink: "#e8e2d6", accent: "#cf5b40" },
};

function svg(theme = "light") {
  const c = colors[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" fill="none">
  <title>Hyper's Gallery</title>
  <style>
    .paper { fill: ${c.paper}; }
    .letter { color: ${c.ink}; fill: currentColor; stroke: currentColor; stroke-width: 16; stroke-linejoin: miter; }
    .tick { fill: ${c.accent}; }

  </style>
  <rect class="paper" width="1000" height="1000"/>
  <path class="letter" transform="translate(68 835) scale(.92)" d="${mark.main[0]}"/>
  <path class="tick" transform="translate(${(-846.4 - (Number(/^M([-\d.]+)/.exec(mark.tick)[1]) - 1554.6)).toFixed(1)} 802.55) scale(1.02)" d="${mark.tick}"/>
</svg>\n`;
}

await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, "favicon.svg"), svg("light"));
await sharp(Buffer.from(svg())).resize(32, 32).png().toFile(path.join(out, "favicon.png"));
await sharp(Buffer.from(svg())).resize(180, 180).png().toFile(path.join(out, "apple-touch-icon.png"));
console.log("[favicon] N + apostrophe: light SVG, 32px PNG and 180px Apple Touch icon");

// Optional review sheet, outside public assets.
if (process.argv[2]) {
  const panels = await Promise.all(["light", "dark"].map(async (theme, index) => [
    { input: await sharp(Buffer.from(svg(theme))).resize(256, 256).png().toBuffer(), left: 32 + index * 304, top: 32 },
    { input: await sharp(Buffer.from(svg(theme))).resize(32, 32).png().toBuffer(), left: 32 + index * 304, top: 316 },
    { input: await sharp(Buffer.from(svg(theme))).resize(16, 16).png().toBuffer(), left: 80 + index * 304, top: 324 },
  ]));
  await sharp({ create: { width: 624, height: 376, channels: 4, background: "#8b8780" } })
    .composite(panels.flat()).png().toFile(path.resolve(process.argv[2]));
}

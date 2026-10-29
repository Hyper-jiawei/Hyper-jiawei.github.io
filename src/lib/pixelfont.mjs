// Rasterises a pixel font's outlines back onto its own pixel grid, so text
// can be drawn as square dots at build time without stretching anything.
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

function load(file) {
  const b = fs.readFileSync(file);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function contours(path) {
  const out = [];
  let cur = [];
  let last = [0, 0];
  for (const c of path.commands) {
    if (c.type === 'M') { if (cur.length) out.push(cur); cur = [[c.x, c.y]]; last = [c.x, c.y]; }
    else if (c.type === 'L') { cur.push([c.x, c.y]); last = [c.x, c.y]; }
    else if (c.type === 'Q' || c.type === 'C') {
      // pixel fonts are straight-edged; sample curves just in case
      for (let t = 0.25; t <= 1; t += 0.25) {
        const x = c.type === 'Q'
          ? (1 - t) ** 2 * last[0] + 2 * (1 - t) * t * c.x1 + t * t * c.x
          : (1 - t) ** 3 * last[0] + 3 * (1 - t) ** 2 * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t ** 3 * c.x;
        const y = c.type === 'Q'
          ? (1 - t) ** 2 * last[1] + 2 * (1 - t) * t * c.y1 + t * t * c.y
          : (1 - t) ** 3 * last[1] + 3 * (1 - t) ** 2 * t * c.y1 + 3 * (1 - t) * t * t * c.y2 + t ** 3 * c.y;
        cur.push([x, y]);
      }
      last = [c.x, c.y];
    } else if (c.type === 'Z') { if (cur.length) out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

function inside(polys, x, y) {
  let wind = 0;
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if (yj <= y) { if (yi > y && (xi - xj) * (y - yj) - (x - xj) * (yi - yj) > 0) wind++; }
      else if (yi <= y && (xi - xj) * (y - yj) - (x - xj) * (yi - yj) < 0) wind--;
    }
  return wind !== 0;
}

/** px = font units per pixel cell. Returns {dots:[[x,y]...], width, height} in cells. */
export function rasterize(fontFile, text, px, offset = 0.5) {
  const font = load(fontFile);
  const asc = font.ascender, desc = font.descender;
  const top = Math.ceil(asc / px), bottom = Math.floor(desc / px);
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  const dots = [];
  let pen = 0;
  const marks = [];
  for (let gi = 0; gi < glyphs.length; gi++) {
    const g = glyphs[gi];
    const polys = contours(g.getPath(0, 0, font.unitsPerEm));
    // getPath flips y (y down); scale is 1 at fontSize = unitsPerEm
    const x0 = Math.round(pen / px);
    const w = Math.round(g.advanceWidth / px);
    for (let cx = -2; cx < w + 2; cx++)
      for (let cy = -top; cy < -bottom; cy++) {
        const sx = (cx + offset) * px, sy = (cy + offset) * px;
        if (inside(polys, sx, sy)) dots.push([x0 + cx, cy + top, gi]);
      }
    marks.push(x0);
    pen += g.advanceWidth;
    if (gi < glyphs.length - 1 && font.getKerningValue) pen += font.getKerningValue(g, glyphs[gi + 1]);
  }
  const width = Math.round(pen / px);
  const ys = dots.map((d) => d[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  for (const d of dots) d[1] -= minY;
  return { dots, width, height: maxY - minY + 1, marks };
}


/** Proportional pixel fonts available for display text: file + font units per pixel. */
// px: font units per pixel; offset: where in a cell to sample; dot: drawn dot size (0–1).
export const PIXEL_FONTS = {
  // Bitcount Prop Double Cursive Light (OFL, static instance from Google Fonts).
  // Pixels sit on a 100-unit grid.
  bitcount: { file: path.resolve('src/assets/fonts/BitcountPropDouble-CursiveLight.ttf'), px: 100, offset: 0.5, dot: 0.8 },
};

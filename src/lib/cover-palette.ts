import path from 'node:path';
import sharp from 'sharp';

export interface CoverPalette {
  name: string;
  light: string;
  dark: string;
}

// Paired editorial colours: deep ink on paper, muted light on charcoal.
// Each pair is checked for >= 4.5:1 contrast with the site's reading surfaces
// and with the foreground used for selected text and filled controls.
export const COVER_PALETTES: readonly CoverPalette[] = [
  { name: 'terracotta', light: '#a9402c', dark: '#e9a08a' },
  { name: 'copper', light: '#90502c', dark: '#dcb18e' },
  { name: 'ochre', light: '#775c20', dark: '#d4bb80' },
  { name: 'olive', light: '#59652e', dark: '#bbc58e' },
  { name: 'sage', light: '#3f684e', dark: '#a0c6ac' },
  { name: 'teal', light: '#256963', dark: '#8cc8bf' },
  { name: 'petrol', light: '#306579', dark: '#94bfd0' },
  { name: 'slate-blue', light: '#456184', dark: '#a4bad6' },
  { name: 'indigo', light: '#58598b', dark: '#b6b4df' },
  { name: 'plum', light: '#775380', dark: '#ccb0d1' },
  { name: 'rose', light: '#8e4b69', dark: '#dba7bf' },
  { name: 'graphite', light: '#555b65', dark: '#b5becf' },
];

type Lab = { l: number; a: number; b: number; chroma: number; hue: number };

function oklab(r: number, g: number, b: number): Lab {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = [r, g, b].map(linear);
  const l = Math.cbrt(.4122214708 * red + .5363325363 * green + .0514459929 * blue);
  const m = Math.cbrt(.2119034982 * red + .6806995451 * green + .1073969566 * blue);
  const s = Math.cbrt(.0883024619 * red + .2817188376 * green + .6299787005 * blue);
  const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
  const bb = .0259040371 * l + .7827717662 * m - .808675766 * s;
  return {
    l: .2104542553 * l + .793617785 * m - .0040720468 * s,
    a, b: bb,
    chroma: Math.hypot(a, bb),
    hue: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360,
  };
}

const paletteHues = COVER_PALETTES.slice(0, -1).map((palette) => {
  const rgb = palette.light.match(/[a-f\d]{2}/gi)!.map((v) => parseInt(v, 16));
  return { palette, hue: oklab(rgb[0], rgb[1], rgb[2]).hue };
});

/** Match a dominant hue rather than averaging unrelated colours into brown. */
export function paletteFromPixels(pixels: Uint8Array): CoverPalette {
  const buckets = Array.from({ length: 24 }, () => ({ weight: 0, a: 0, b: 0 }));
  let opaque = 0, chromatic = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    opaque++;
    const colour = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (colour.l < .15 || colour.l > .94 || colour.chroma < .035) continue;
    chromatic++;
    const weight = .25 + Math.min(colour.chroma, .18) * 5;
    const bucket = buckets[Math.floor(colour.hue / 15) % 24];
    bucket.weight += weight;
    bucket.a += colour.a * weight;
    bucket.b += colour.b * weight;
  }
  // Tiny coloured details should not dictate the palette of a monochrome photo.
  if (!opaque || chromatic / opaque < .03) return COVER_PALETTES.at(-1)!;
  const neighbors = (i: number) => [buckets[(i + 23) % 24], buckets[i], buckets[(i + 1) % 24]];
  const winner = buckets.reduce((best, _, i) =>
    neighbors(i).reduce((sum, v) => sum + v.weight, 0) >
    neighbors(best).reduce((sum, v) => sum + v.weight, 0) ? i : best, 0);
  const group = neighbors(winner);
  const a = group.reduce((sum, v) => sum + v.a, 0);
  const b = group.reduce((sum, v) => sum + v.b, 0);
  const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  const distance = (other: number) => Math.abs(((hue - other + 540) % 360) - 180);
  return paletteHues.reduce((best, candidate) =>
    distance(candidate.hue) < distance(best.hue) ? candidate : best).palette;
}

const cache = new Map<string, Promise<CoverPalette | undefined>>();

/** Build-time only: sample the same local asset used as the article's cover. */
export function getCoverPalette(source?: string): Promise<CoverPalette | undefined> {
  if (!source) return Promise.resolve(undefined);
  const cached = cache.get(source);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const pixels = await sharp(path.resolve(`.${source}`))
        .rotate()
        .resize(80, 80, { fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer();
      return paletteFromPixels(pixels);
    } catch (error) {
      console.warn(`[cover-palette] Cannot sample ${source}; using the site accent.`, error);
      return undefined;
    }
  })();
  cache.set(source, pending);
  return pending;
}

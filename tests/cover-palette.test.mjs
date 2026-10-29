import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { COVER_PALETTES, getCoverPalette, paletteFromPixels } from '../src/lib/cover-palette.ts';

function pixels(colours) {
  return Uint8Array.from(colours.flatMap(([r, g, b, count, alpha = 255]) =>
    Array.from({ length: count }, () => [r, g, b, alpha]).flat()));
}
function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (high + .05) / (low + .05);
}

test('every curated pair is readable on all site surfaces and as a filled control', () => {
  for (const palette of COVER_PALETTES) {
    for (const bg of ['#f5f5f5', '#fcfcfc', '#ebebeb']) {
      assert.ok(contrast(palette.light, bg) >= 4.5, `${palette.name} light against ${bg}`);
    }
    for (const bg of ['#161616', '#1e1e1e', '#111111', '#181818']) {
      assert.ok(contrast(palette.dark, bg) >= 4.5, `${palette.name} dark against ${bg}`);
    }
  }
});

test('warm and cool covers resolve to different restrained colour families', () => {
  const warm = paletteFromPixels(pixels([[200, 80, 40, 100]]));
  const cool = paletteFromPixels(pixels([[45, 110, 165, 100]]));
  assert.ok(['terracotta', 'copper'].includes(warm.name));
  assert.ok(['petrol', 'slate-blue'].includes(cool.name));
  assert.notEqual(warm.name, cool.name);
});

test('neutral pixels and tiny coloured details do not overpower the photo', () => {
  assert.equal(paletteFromPixels(pixels([[128, 128, 128, 100]])).name, 'graphite');
  assert.equal(paletteFromPixels(pixels([[128, 128, 128, 98], [220, 50, 40, 2]])).name, 'graphite');
  assert.equal(paletteFromPixels(pixels([[30, 100, 150, 100], [255, 255, 255, 400]])).name,
    paletteFromPixels(pixels([[30, 100, 150, 100]])).name);
});

test('transparent samples are ignored and empty covers are safe', () => {
  assert.equal(paletteFromPixels(new Uint8Array()).name, 'graphite');
  const blue = paletteFromPixels(pixels([[30, 100, 150, 100]]));
  assert.equal(paletteFromPixels(pixels([[30, 100, 150, 100], [240, 80, 20, 1000, 0]])).name, blue.name);
});

test('missing cover preserves the global accent', async () => {
  assert.equal(await getCoverPalette(), undefined);
});

test('real image covers are decoded and the build result is cached', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyper-palette-'));
  try {
    for (const [i, colour] of ['#c85028', '#2d6ea5', '#808080'].entries()) {
      const file = path.join(dir, `cover-${i}.png`);
      await sharp({ create: { width: 32, height: 24, channels: 3, background: colour } }).png().toFile(file);
      const source = '/' + path.relative(process.cwd(), file);
      const first = getCoverPalette(source);
      assert.strictEqual(getCoverPalette(source), first);
      const palette = await first;
      assert.ok(palette && COVER_PALETTES.includes(palette), source);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

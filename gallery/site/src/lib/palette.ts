// Colour card for photo and album pages.
//
// 36 hues (every 10°) × 4 intensities, each a pair of tones in OKLCH: a pale paper colour
// for light mode and a deep ink colour for dark mode, plus three neutrals. Working in OKLCH
// keeps every swatch at the same perceived lightness, so a yellow page is no brighter than
// a blue one. A photo's leading colour (measured in OKLab by the image script) picks the
// nearest hue; how much of the picture that colour covers picks the intensity.
import type { Photo } from "./gallery";

export interface Tone {
  light: string;
  dark: string;
}

const LIGHT_L = 0.935;
const DARK_L = 0.2;
const LIGHT_C = [0.008, 0.014, 0.021, 0.03];
const DARK_C = [0.008, 0.013, 0.019, 0.026];

const oklch = (l: number, c: number, h: number) => `oklch(${l} ${c} ${h})`;

export const NEUTRALS = {
  plain: { light: "#ebe7df", dark: "#12110f" },
  warm: { light: oklch(0.93, 0.01, 80), dark: oklch(0.195, 0.008, 70) },
  cool: { light: oklch(0.93, 0.009, 240), dark: oklch(0.195, 0.01, 250) },
};

/** Every swatch on the card, for reference. */
export const CARD: Tone[] = Array.from({ length: 36 }, (_, i) => i * 10).flatMap((h) =>
  LIGHT_C.map((c, t) => ({ light: oklch(LIGHT_L, c, h), dark: oklch(DARK_L, DARK_C[t], h) })),
);

export function toneFor(photo: Photo): Tone {
  const t = photo.tone;
  if (!t) return NEUTRALS.plain;
  if (t.share < 0.0015 || t.chroma < 0.02) {
    // Nearly monochrome: lean warm or cool only if the whole picture has a cast.
    const [, b] = t.cast ?? [0, 0];
    return b > 0.006 ? NEUTRALS.warm : b < -0.006 ? NEUTRALS.cool : NEUTRALS.plain;
  }
  const hue = (Math.round(t.hue / 10) * 10) % 360;
  let tier = Math.min(3, Math.floor(Math.sqrt(Math.min(1, t.share / 0.03)) * 4));
  if (t.chroma > 0.08 && tier < 3) tier++;
  return { light: oklch(LIGHT_L, LIGHT_C[tier], hue), dark: oklch(DARK_L, DARK_C[tier], hue) };
}

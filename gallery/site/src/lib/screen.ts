import { composePrinted, type PrintSize } from "./printed-layout";

// How many CSS pixels a physical inch spans on this screen. Browsers only promise 96 (the W3C
// reference pixel), but most screens are denser: a 27" 5K Mac runs at ~109 CSS px/in, a 14"
// MacBook at ~127. "Actual size" multiplies the printed sizes by the ratio so a 7-inch card
// measures seven inches on the desk, as far as the display can tell us.

// Device pixels across (the number the panel actually draws) → the diagonal of the display in
// inches. Only unambiguous matches are listed; anything else falls back to the platform guess.
const PANELS: Array<[number, number, number]> = [
  [6016, 3384, 32], // Pro Display XDR
  [5120, 2880, 27], // iMac 5K, Studio Display
  [4096, 2304, 24], // LG UltraFine 4K 24"
  [3840, 2160, 27], // 4K monitor, most commonly 27"
  [3456, 2234, 16.2], // MacBook Pro 16" (2021+)
  [3024, 1964, 14.2], // MacBook Pro 14"
  [2880, 1864, 15.3], // MacBook Air 15"
  [2880, 1800, 15.4], // MacBook Pro 15"
  [2732, 2048, 12.9], // iPad Pro 12.9"
  [2560, 1664, 13.6], // MacBook Air 13" (M2/M3)
  [2560, 1600, 13.3], // MacBook Air/Pro 13"
  [2304, 1440, 12], // MacBook 12"
  [2560, 1440, 27], // 1440p monitor, usually 27"
  [1920, 1200, 24], // 16:10 24"
  [1920, 1080, 23.8], // 1080p monitor, usually 24"
  [1680, 1050, 22],
  [1440, 900, 19],
  [1280, 800, 13.3],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Physical inches across the display, guessed from the panel's device-pixel count. */
function diagonalInches(deviceW: number, deviceH: number): number | null {
  const long = Math.max(deviceW, deviceH);
  const short = Math.min(deviceW, deviceH);
  const hit = PANELS.find(([w, h]) => Math.abs(w - long) <= 2 && Math.abs(h - short) <= 2);
  if (hit) return hit[2];
  // No match: on a Mac assume the ~110 CSS px/in of a scaled Retina panel, elsewhere the
  // reference 96, which at least keeps a 1080p Windows monitor close.
  return null;
}

/** The multiplier that turns W3C reference inches into this screen's inches. */
export function sizeScale(): number {
  const dpr = window.devicePixelRatio || 1;
  const deviceW = Math.round(screen.width * dpr);
  const deviceH = Math.round(screen.height * dpr);
  const diagonal = diagonalInches(deviceW, deviceH);
  let cssPpi: number;
  if (diagonal) {
    const ppi = Math.hypot(deviceW, deviceH) / diagonal;
    cssPpi = ppi / dpr;
  } else {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    cssPpi = mac ? 110 : 96;
  }
  return clamp(cssPpi / 96, 0.85, 1.5);
}

/** Publishes the factor as --size-scale, which the printed album multiplies its sizes by. */
export function applySizeScale(root: HTMLElement = document.documentElement): number {
  let scale = 1;
  try {
    const stored = Number(localStorage.getItem("nit:size-scale"));
    scale = Number.isFinite(stored) && stored > 0 ? stored : sizeScale();
  } catch {
    scale = sizeScale();
  }
  const value = String(Math.round(scale * 1000) / 1000);
  if (root.style.getPropertyValue("--size-scale") !== value) root.style.setProperty("--size-scale", value);
  if (root.dataset.sizeScale !== scale.toFixed(3)) root.dataset.sizeScale = scale.toFixed(3);
  return scale;
}

// Keep references for this sheet only; navigation can release the old DOM through the WeakMap.
const printedSheets = new WeakMap<HTMLElement, {
  cards: Array<{ element: HTMLElement; caption: HTMLElement | null; image: HTMLImageElement | null; width: string }>;
  sizes: PrintSize[];
  maxWidth: number;
}>();

/** Compose one responsive sheet using the print widths, rather than fixed column spans. */
export function layoutPrinted(): void {
  const sheet = document.querySelector<HTMLElement>(".sheet-printed");
  if (!sheet) return;
  // Match the editorial layout's breakpoint. CSS restores normal flow immediately;
  // stop composing print coordinates and release desktop image-size hints as well.
  if (matchMedia("(max-width: 900px)").matches) {
    if (sheet.hasAttribute("data-layout-ready")) {
      sheet.removeAttribute("data-layout-ready");
      delete sheet.dataset.rows;
      sheet.querySelectorAll<HTMLImageElement>("img").forEach((image) => { image.sizes = "100vw"; });
    }
    return;
  }
  let cached = printedSheets.get(sheet);
  if (!cached) {
    const elements = [...sheet.querySelectorAll<HTMLElement>(".work")];
    if (!elements.length) return;
    const sizes = elements.map((card) => ({
      width: parseFloat(card.style.getPropertyValue("--w")) || 376,
      height: parseFloat(card.style.getPropertyValue("--h")) || 557,
    }));
    cached = {
      cards: elements.map((element) => ({ element, caption: element.querySelector<HTMLElement>("figcaption"), image: element.querySelector<HTMLImageElement>("img"), width: "" })),
      sizes,
      maxWidth: Math.max(...sizes.map((size) => size.width)),
    };
    printedSheets.set(sheet, cached);
  }
  const { cards, sizes, maxWidth } = cached;
  const available = sheet.clientWidth;
  if (!available) return;
  const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--size-scale")) || 1;
  const printScale = Math.min(scale, available / maxWidth);
  // Derive widths directly; row composition is only needed once, after caption measurements.
  cards.forEach((card, index) => {
    const width = `${(sizes[index].width * printScale).toFixed(3)}px`;
    if (card.width !== width) {
      card.element.style.setProperty("--print-width", width);
      card.width = width;
    }
  });
  if (!sheet.hasAttribute("data-layout-ready")) sheet.dataset.layoutReady = "";
  // Keep reads together, so changing widths causes at most one synchronous layout.
  const measured = sizes.map((size, index) => {
    const caption = cards[index].caption;
    return {
      ...size,
      caption: caption ? caption.getBoundingClientRect().height + (parseFloat(getComputedStyle(caption).marginTop) || 0) : 0,
    };
  });
  const layout = composePrinted(measured, available, scale);
  cards.forEach((card, index) => {
    const placement = layout.items[index];
    card.element.style.setProperty("--print-x", `${placement.x.toFixed(3)}px`);
    card.element.style.setProperty("--print-y", `${placement.y.toFixed(3)}px`);
    const imageSize = `${Math.ceil(placement.width)}px`;
    if (card.image && card.image.sizes !== imageSize) card.image.sizes = imageSize;
  });
  sheet.style.setProperty("--print-height", `${Math.ceil(layout.height)}px`);
  sheet.dataset.rows = String(layout.rows);
}

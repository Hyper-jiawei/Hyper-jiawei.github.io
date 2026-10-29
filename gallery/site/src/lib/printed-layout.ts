/** A print's dimensions in reference CSS pixels, plus its caption's rendered height. */
export interface PrintSize { width: number; height: number; caption?: number }
export interface PrintPlacement { x: number; y: number; width: number; height: number; row: number }
export interface PrintedLayout { items: PrintPlacement[]; height: number; scale: number; rows: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Preserve physical size relationships; only shrink the entire set when a print cannot fit.
 * Rows use actual widths, never portrait/landscape column spans. Dynamic programming avoids
 * unnecessarily isolated cards, while reading order remains the same as the album/lightbox. */
export function composePrinted(items: PrintSize[], available: number, screenScale = 1): PrintedLayout {
  if (!items.length || !Number.isFinite(available) || available <= 0) {
    return { items: [], height: 0, scale: 1, rows: 0 };
  }
  const physicalScale = Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
  const sizes = items.map((item) => ({
    width: Number.isFinite(item.width) && item.width > 0 ? item.width : 376,
    height: Number.isFinite(item.height) && item.height > 0 ? item.height : 557,
    caption: Number.isFinite(item.caption) ? Math.max(0, item.caption!) : 30,
  }));
  const scale = Math.min(physicalScale, available / Math.max(...sizes.map((item) => item.width)));
  const widths = sizes.map((item) => item.width * scale);
  const gap = clamp(available * .032, 20, 52);
  const costs = new Array<number>(items.length + 1).fill(Infinity);
  const counts = new Array<number>(items.length).fill(1);
  costs[items.length] = 0;
  for (let start = items.length - 1; start >= 0; start--) {
    let used = 0;
    for (let count = 1; count <= 4 && start + count <= items.length; count++) {
      used += widths[start + count - 1] + (count > 1 ? gap : 0);
      if (used > available + .001) break;
      const slack = Math.max(0, (available - used) / available);
      const cost = 1 + slack * slack * 3 + costs[start + count];
      if (cost < costs[start]) { costs[start] = cost; counts[start] = count; }
    }
  }

  const placements: PrintPlacement[] = [];
  const leans = [0, .8, .3, 1, .45, .15, .7];
  const rhythms = [1, .82, 1.18, .94];
  let start = 0, row = 0, top = 0;
  while (start < items.length) {
    const count = counts[start];
    const rowWidths = widths.slice(start, start + count);
    const free = Math.max(0, available - rowWidths.reduce((sum, width) => sum + width, 0) - gap * (count - 1));
    // Spend a small part of the spare width on breathing room, then lean the row as a group.
    const extraGap = count > 1 ? free * .22 / (count - 1) : 0;
    let x = (free - extraGap * (count - 1)) * leans[row % leans.length];
    const shortest = Math.min(...sizes.slice(start, start + count).map((item) => item.height * scale));
    const step = Math.min(72, available * .05, shortest * .16);
    const falls = count === 4 ? [0, .75, .25, 1] : count === 3 ? [0, 1, .35] : [0, 1];
    let bottom = top;
    for (let index = 0; index < count; index++) {
      const item = sizes[start + index];
      const fall = count === 1 ? 0 : falls[row % 2 ? count - index - 1 : index];
      const y = top + fall * step;
      const height = item.height * scale + item.caption;
      placements.push({ x, y, width: rowWidths[index], height, row });
      bottom = Math.max(bottom, y + height);
      x += rowWidths[index] + gap + extraGap;
    }
    top = bottom + clamp(available * .055, 34, 92) * rhythms[row % rhythms.length];
    start += count;
    row++;
  }
  const height = Math.max(...placements.map((item) => item.y + item.height));
  return { items: placements, height, scale, rows: row };
}

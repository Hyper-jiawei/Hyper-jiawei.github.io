interface Heading { depth: number; slug: string; text: string }

export function numberHeadings(headings: Heading[]) {
  const rootDepth = Math.min(...headings.map((heading) => heading.depth));
  let section = 0, child = 0;
  return headings.map((heading) => {
    const nested = heading.depth > rootDepth && section > 0;
    if (!nested) { section++; child = 0; }
    else child++;
    return {
      ...heading,
      text: heading.text.replace(/#$/, '').trim(),
      nested,
      section,
      number: nested ? `${String(section).padStart(2, '0')}.${child}` : String(section).padStart(2, '0'),
    };
  });
}

/** Last heading above the reading line, without reading layout during scroll. */
export function activeHeadingIndex(offsets: number[], readingLine: number): number {
  if (!offsets.length) return -1;
  let left = 0, right = offsets.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (offsets[middle] <= readingLine) left = middle + 1;
    else right = middle;
  }
  return Math.max(0, left - 1);
}

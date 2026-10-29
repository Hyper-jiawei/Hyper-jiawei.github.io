// The old posts caption images with a blockquote directly below them
// (`![](x.png)` then `> caption`). Turn that pair into <figure>/<figcaption>,
// and give every content image lazy loading.
import { visit } from 'unist-util-visit';

const READING_WIDTHS = [480, 800, 1200, 1600, 2400];
const READING_SIZES = '(min-width: 1536px) 800px, (min-width: 832px) 768px, calc(100vw - 36px)';

const isWs = (n) => n.type === 'text' && !n.value.trim();
const onlyImage = (n) =>
  n?.type === 'element' &&
  n.tagName === 'p' &&
  n.children.filter((c) => !isWs(c)).length === 1 &&
  n.children.find((c) => !isWs(c))?.tagName === 'img';

// old posts link headings by their Hugo ids (`#FlowShutter-PCB-与-FC-的连接`);
// point such links at the rehype-slug id when the two only differ in case/punctuation
const looseId = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

export function rehypeFigure() {
  return (tree) => {
    const ids = new Map();
    visit(tree, 'element', (node) => {
      if (typeof node.properties?.id === 'string') ids.set(looseId(node.properties.id), node.properties.id);
    });
    visit(tree, 'element', (node) => {
      const href = node.tagName === 'a' && node.properties?.href;
      if (typeof href !== 'string' || !href.startsWith('#') || href.length < 2) return;
      let frag = href.slice(1);
      try { frag = decodeURIComponent(frag); } catch {}
      const id = ids.get(looseId(frag));
      if (id && id !== frag) node.properties.href = `#${id}`;
    });
    visit(tree, 'element', (node) => {
      if (node.tagName === 'img') {
        node.properties.loading ??= 'lazy';
        node.properties.decoding ??= 'async';
        // Astro's markdown image step passes these props to getImage, so the
        // body images get a srcset sized to the reading column (≤ 800px wide)
        // instead of one full-resolution file. Widths above the original are dropped.
        node.properties.widths ??= READING_WIDTHS;
        node.properties.sizes ??= READING_SIZES;
      }
    });
    visit(tree, (parent) => {
      if (!parent.children) return;
      const kids = parent.children;
      for (let i = 0; i < kids.length; i++) {
        // `text\n![](img)\n> caption` puts the image at the end of a text paragraph:
        // split it off so it can become its own captioned figure.
        const node = kids[i];
        if (!onlyImage(node) && node.type === 'element' && node.tagName === 'p') {
          const real = node.children.filter((c) => !isWs(c));
          const last = real.at(-1);
          let j = i + 1;
          while (j < kids.length && isWs(kids[j])) j++;
          if (last?.tagName === 'img' && real.length > 1 && kids[j]?.tagName === 'blockquote') {
            const at = node.children.lastIndexOf(last);
            node.children = node.children.slice(0, at);
            while (node.children.length && (isWs(node.children.at(-1)) || node.children.at(-1).tagName === 'br'))
              node.children.pop();
            const tail = node.children.at(-1);
            if (tail?.type === 'text') tail.value = tail.value.replace(/\s+$/, '');
            kids.splice(i + 1, 0, { type: 'element', tagName: 'p', properties: {}, children: [last] });
          }
          continue;
        }
        if (!onlyImage(node)) continue;
        let j = i + 1;
        while (j < kids.length && isWs(kids[j])) j++;
        const next = kids[j];
        const img = kids[i].children.find((c) => !isWs(c));
        const caption =
          next?.type === 'element' && next.tagName === 'blockquote'
            ? next.children.filter((c) => !isWs(c)).flatMap((c) => (c.tagName === 'p' ? c.children : [c]))
            : null;
        // a caption is introduced by its figure number, so drop a leading
        // note mark (`*`) the old posts used in its place
        const head = caption?.find((c) => !isWs(c));
        if (head?.type === 'text') head.value = head.value.replace(/^\s*[*＊※]\s*/, '');
        const figure = {
          type: 'element',
          tagName: 'figure',
          properties: { className: ['md-figure'] },
          children: [img, ...(caption ? [{ type: 'element', tagName: 'figcaption', properties: {}, children: caption }] : [])],
        };
        kids.splice(i, caption ? j - i + 1 : 1, figure);
      }
    });
  };
}

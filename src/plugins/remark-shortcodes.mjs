// Renders the two Hugo shortcodes the old posts use, so the Markdown files
// can stay exactly as they were written:
//   {{< bilibili BVID [page] [cid] >}}
//   {{< article link="/posts/slug/" showSummary=true >}}
import { visit } from 'unist-util-visit';
import { readFrontmatter } from './unlisted.mjs';

const SHORTCODE = /\{\{<\s*(\w+)\s*(.*?)\s*>\}\}/g;

const esc = (s = '') =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const stripMd = (s = '') =>
  String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function parseArgs(raw) {
  raw = raw.replace(/[“”„″]/g, '"').replace(/[‘’]/g, "'");
  const named = {};
  const positional = [];
  for (const m of raw.matchAll(/(\w+)=("([^"]*)"|\S+)|(\S+)/g)) {
    if (m[1]) named[m[1]] = m[3] ?? m[2];
    else positional.push(m[4]);
  }
  return { named, positional };
}

function bilibili({ positional }) {
  const [bvid, page = '1', cid] = positional;
  let src = `https://player.bilibili.com/player.html?isOutside=true&bvid=${bvid}&p=${page}&autoplay=0`;
  if (cid) src += `&cid=${cid}`;
  return `<figure class="embed embed-video"><div class="embed-frame"><iframe src="${esc(src)}" loading="lazy" scrolling="no" frameborder="0" allowfullscreen title="Bilibili ${esc(bvid)}"></iframe></div><figcaption><a href="https://www.bilibili.com/video/${esc(bvid)}/" target="_blank" rel="noopener">bilibili / ${esc(bvid)}</a></figcaption></figure>`;
}

function article({ named }) {
  const link = named.link || '';
  const slug = decodeURI(link).replace(/^\/posts\//, '').replace(/\/$/, '');
  const fm = /^https?:/.test(link) ? null : readFrontmatter(slug);
  const title = named.title || fm?.title || link;
  const desc = named.description || fm?.subtitle || stripMd(fm?.summary);
  const date = fm?.date ? new Date(fm.date).toISOString().slice(0, 10) : '';
  const external = /^https?:/.test(link);
  return `<a class="link-card" href="${esc(link)}"${external ? ' target="_blank" rel="noopener"' : ''}><span class="link-card-kicker">${external ? '↗ external' : '→ post'}${date ? ` · ${date}` : ''}</span><span class="link-card-title">${esc(title)}</span>${desc && named.showSummary !== 'false' ? `<span class="link-card-desc">${esc(desc)}</span>` : ''}</a>`;
}

const renderers = { bilibili, article };

const render = (raw) => {
  const [, name, args] = raw.match(/\{\{<\s*(\w+)\s*(.*?)\s*>\}\}/);
  return renderers[name]?.(parseArgs(args)) ?? '';
};

// A shortcode may sit alone in a paragraph or share it with text (e.g. a
// line of prose followed by a hard break and the shortcode). Split such
// paragraphs: the prose stays a paragraph, each shortcode becomes HTML.
export function remarkShortcodes() {
  return (tree) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!node.children.some((c) => typeof c.value === 'string' && c.value.includes('{{<'))) return;
      const out = [];
      let inline = [];
      const flush = () => {
        while (inline.length && (inline.at(-1).type === 'break' || (inline.at(-1).type === 'text' && !inline.at(-1).value.trim())))
          inline.pop();
        while (inline.length && inline[0].type === 'text' && !inline[0].value.trim()) inline.shift();
        if (inline.length) out.push({ type: 'paragraph', children: inline });
        inline = [];
      };
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value.includes('{{<')) {
          inline.push(child);
          continue;
        }
        let last = 0;
        for (const m of child.value.matchAll(SHORTCODE)) {
          const before = child.value.slice(last, m.index);
          if (before.trim()) inline.push({ type: 'text', value: before.replace(/\s+$/, '') });
          flush();
          out.push({ type: 'html', value: render(m[0]) });
          last = m.index + m[0].length;
        }
        const after = child.value.slice(last);
        if (after.trim()) inline.push({ type: 'text', value: after.replace(/^\s+/, '') });
      }
      flush();
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

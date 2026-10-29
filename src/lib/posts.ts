import { l, type Lang } from './i18n';
import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';

export type Post = CollectionEntry<'posts'>;

const covers = import.meta.glob<{ default: ImageMetadata }>(
  '/src/content/posts/*/{cover,feature,featured,thumb,thumbnail}*.{jpg,jpeg,png,webp,avif}',
  { eager: true },
);

export function coverOf(post: Post): ImageMetadata | undefined {
  const source = coverSourceOf(post);
  return source ? covers[source].default : undefined;
}

export function coverSourceOf(post: Post): string | undefined {
  return Object.keys(covers).find((p) => p.split('/')[4] === post.id);
}

export const isUnlisted = (p: Post) =>
  Boolean(p.data.private || p.data.build?.list === 'never');

/** Every post that gets a page (unlisted ones included, drafts excluded). */
export async function getRenderablePosts() {
  const all = await getCollection('posts', (p) => !p.data.draft);
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Posts that appear in lists, feeds, tags and search. */
export async function getListedPosts() {
  return (await getRenderablePosts()).filter((p) => !isUnlisted(p));
}

export const postUrl = (p: Post, lang: Lang = 'zh') => l(lang, `/posts/${p.id}/`);
export const tagSlug = (t: string) => t.toLowerCase().trim().replace(/\s+/g, '-');
export const tagUrl = (t: string, lang: Lang = 'zh') => l(lang, `/tags/${tagSlug(t)}/`);

export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
export const fmtDateDot = (d: Date) => fmtDate(d).replaceAll('-', '.');

export function plainSummary(p: Post, max = 120) {
  const raw = p.data.summary ?? firstParagraph(p.body ?? '');
  const text = raw
    .replace(/\{\{<[^>]*>\}\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function firstParagraph(body: string) {
  return (
    body
      .replace(/<!--[\s\S]*?-->/g, '')
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#') && !s.startsWith('!') && !s.startsWith('{{') && !/^-{3,}$/.test(s)) ?? ''
  );
}

/** CJK characters count one each, Latin words count one each. */
export function wordCount(body = '') {
  const clean = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{<[^>]*>\}\}/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\]\([^)]*\)/g, ']');
  const cjk = clean.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0;
  const latin = clean.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9][\w'.-]*/g)?.length ?? 0;
  return cjk + latin;
}

export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 350));

export function tagCounts(posts: Post[]) {
  const map = new Map<string, { name: string; count: number }>();
  for (const p of posts)
    for (const t of p.data.tags) {
      const k = tagSlug(t);
      const cur = map.get(k) ?? { name: t, count: 0 };
      cur.count++;
      map.set(k, cur);
    }
  return [...map.entries()]
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

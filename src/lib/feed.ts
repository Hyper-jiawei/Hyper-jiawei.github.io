import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getListedPosts, plainSummary, postUrl } from './posts';
import { SITE } from './site';

export async function feed(context: APIContext) {
  const posts = await getListedPosts();
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.subtitle ?? plainSummary(p, 200),
      link: postUrl(p),
      categories: p.data.tags,
    })),
    customData: '<language>zh-CN</language>',
  });
}

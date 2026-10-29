import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { albums, albumUrl, coverOf, pick, formatDate } from "../lib/gallery";
import { site } from "../site.config";

export function GET(context: APIContext) {
  return rss({
    title: site.title,
    description: site.description,
    site: context.site!,
    items: albums.map((a) => {
      const cover = pick(coverOf(a), 1600);
      return {
        title: a.title,
        link: albumUrl(a),
        pubDate: a.date ? new Date(a.date) : undefined,
        categories: a.categories,
        content: `<p><img src="${new URL(cover.url, context.site)}" alt="${a.title}" /></p><p>${formatDate(a.date)} · ${a.photos.length} 张照片</p>`,
      };
    }),
    customData: "<language>zh-cn</language>",
  });
}

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  // Keep the folder name as the id so URLs stay /posts/<folder>/ like the Hugo site.
  loader: glob({
    pattern: '*/index.{md,mdx}',
    base: './src/content/posts',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z
    .object({
      title: z.string(),
      date: z.coerce.date(),
      lastmod: z.coerce.date().optional(),
      subtitle: z.string().optional(),
      summary: z.string().optional(),
      tags: z.array(z.coerce.string()).default([]),
      draft: z.boolean().default(false),
      private: z.boolean().default(false),
      build: z.object({ list: z.string().optional() }).passthrough().optional(),
      author: z.string().optional(),
    })
    .passthrough(),
});

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({ title: z.string(), description: z.string().optional() }).passthrough(),
});

export const collections = { posts, pages };

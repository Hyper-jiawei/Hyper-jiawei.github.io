// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import tailwindcss from '@tailwindcss/vite';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { remarkShortcodes } from './src/plugins/remark-shortcodes.mjs';
import { rehypeFigure } from './src/plugins/rehype-figure.mjs';
import { unlistedPaths } from './src/plugins/unlisted.mjs';

const hidden = unlistedPaths();

export default defineConfig({
  site: 'https://hyper-jiawei.github.io',
  trailingSlash: 'always',
  build: { format: 'directory' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  integrations: [
    expressiveCode({
      themes: ['github-dark-default', 'github-light-default'],
      themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
      useDarkModeMediaQuery: false,
      styleOverrides: {
        borderRadius: '0',
        borderColor: 'var(--line)',
        codeFontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        uiFontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        codeFontSize: '14px',
        frames: { shadowColor: 'transparent' },
      },
    }),
    mdx(),
    sitemap({
      filter: (page) => !hidden.some((p) => decodeURI(page).endsWith(p)),
    }),
  ],
  markdown: {
    remarkPlugins: [remarkShortcodes],
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          // a marker hangs in the margin left of the text: ## for h2, a single # below
          behavior: 'prepend',
          properties: { className: ['heading-anchor'], ariaHidden: 'true', tabIndex: -1, dataPagefindIgnore: '' },
          content: (heading) => ({ type: 'text', value: heading.tagName === 'h2' ? '##' : '#' }),
        },
      ],
      rehypeFigure,
    ],
  },
  vite: { plugins: [tailwindcss()] },
});

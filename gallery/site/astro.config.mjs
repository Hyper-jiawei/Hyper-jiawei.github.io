// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import gallery from "./src/data/gallery.json" with { type: "json" };
import { fontRanges } from "./scripts/font-ranges.mjs";
import { modulePreloads } from "./scripts/module-preloads.mjs";

const privatePaths = gallery.albums.filter((a) => a.private).map((a) => `/${encodeURI(a.slug)}/`);
const deployment = process.env.CF_PAGES_URL ? new URL(process.env.CF_PAGES_URL) : null;
if (deployment?.hostname.endsWith(".pages.dev")) deployment.hostname = deployment.hostname.split(".").slice(-3).join(".");
const base = process.env.GALLERY_BASE ?? "/gallery";

export default defineConfig({
  site: new URL(base, process.env.GALLERY_SITE_ORIGIN ?? deployment?.origin ?? "https://hyper-jiawei.github.io").href,
  base,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  vite: {
    // Discover the on-demand lightbox core before the first photo click.
    optimizeDeps: { include: ["photoswipe", "photoswipe/lightbox"] },
    // Small subsets must remain cacheable files, rather than becoming base64
    // inside the render-blocking stylesheet.
    build: { assetsInlineLimit: (filePath) => filePath.endsWith(".woff2") ? false : undefined },
    plugins: [{
      name: "gallery-production-fonts",
      apply: "build",
      config: () => ({ css: { postcss: { plugins: [fontRanges({ subset: true })] } } }),
    }],
  },
  integrations: [
    modulePreloads(base === "/" ? "/" : base + "/"),
    sitemap({
      // Error pages and private albums are built but never advertised.
      filter: (page) =>
        !page.endsWith("/egg/") && !/\/(en|ja)\/404\/$/.test(page) && !privatePaths.some((p) => page.endsWith(p)),
    }),
  ],
});

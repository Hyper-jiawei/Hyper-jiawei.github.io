// Static hosts resolve a missing path to the nearest 404.html beside it — Cloudflare Pages,
// Netlify and GitHub's edge all look for the closest one walking up the path. Astro writes the
// English and Japanese pages in directory form (/en/404/index.html), so they are copied to
// /en/404.html and /ja/404.html after the build.
import fs from "node:fs/promises";

for (const lang of ["en", "ja"]) {
  const from = new URL(`../dist/${lang}/404/index.html`, import.meta.url);
  const to = new URL(`../dist/${lang}/404.html`, import.meta.url);
  await fs.copyFile(from, to);
  console.log(`nested 404: ${lang}/404.html`);
}

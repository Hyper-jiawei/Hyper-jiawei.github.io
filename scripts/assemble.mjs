// Both Astro projects retain their own source tree; only their public output is combined.
import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const galleryOnly = process.argv.includes('--gallery-only');
const output = new URL(galleryOnly ? 'dist/cloudflare/' : 'dist/', root);
const gallery = new URL('gallery/', output);
await fs.rm(gallery, { recursive: true, force: true });
await fs.cp(new URL('gallery/site/dist/', root), gallery, { recursive: true });
if (galleryOnly) {
  const headers = await fs.readFile(new URL('_headers', gallery), 'utf8');
  await fs.writeFile(new URL('_headers', output), headers.replace(/^\//gm, '/gallery/') + '\n/gallery/publish/*\n  Cache-Control: no-cache\n');
  await fs.unlink(new URL('_headers', gallery));
  await fs.writeFile(new URL('_redirects', output), '/ /gallery/ 302\n/publish /gallery/publish/ 302\n/publish/ /gallery/publish/ 302\n');
  await fs.copyFile(new URL('404.html', gallery), new URL('404.html', output));
}
console.log(galleryOnly ? 'Published paths: /gallery/, /gallery/publish/' : 'Published paths: / (Blog), /gallery/ (Gallery)');

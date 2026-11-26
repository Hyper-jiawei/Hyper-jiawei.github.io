// Both Astro projects retain their own source tree; only their public output is combined.
import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const galleryOnly = process.argv.includes('--gallery-only');
const base = (process.env.GALLERY_BASE ?? '/gallery').replace(/\/+$/, '');
const output = new URL(galleryOnly ? 'dist/cloudflare/' : 'dist/', root);
const source = new URL('gallery/site/dist/', root);
if (galleryOnly && !base) {
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(source, output, { recursive: true });
  const headers = await fs.readFile(new URL('_headers', output), 'utf8');
  await fs.writeFile(new URL('_headers', output), headers + '\n/publish/*\n  Cache-Control: no-cache\n');
  const api = process.env.GALLERY_API_ORIGIN;
  if (api) {
    if (!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(api)) throw new Error('GALLERY_API_ORIGIN must be a https://<name>.<subdomain>.workers.dev origin');
    await fs.writeFile(new URL('_redirects', output), `/api/* ${api}/api/:splat 200\n`);
  }
} else {
  const gallery = new URL('gallery/', output);
  await fs.rm(gallery, { recursive: true, force: true });
  await fs.cp(source, gallery, { recursive: true });
  if (galleryOnly) {
    const headers = await fs.readFile(new URL('_headers', gallery), 'utf8');
    await fs.writeFile(new URL('_headers', output), headers.replace(/^\//gm, '/gallery/') + '\n/gallery/publish/*\n  Cache-Control: no-cache\n');
    await fs.unlink(new URL('_headers', gallery));
    await fs.writeFile(new URL('_redirects', output), '/ /gallery/ 302\n/publish /gallery/publish/ 302\n/publish/ /gallery/publish/ 302\n');
    await fs.copyFile(new URL('404.html', gallery), new URL('404.html', output));
  }
}
console.log(galleryOnly ? `Published paths: ${base || ''}/, ${base || ''}/publish/` : 'Published paths: / (Blog), /gallery/ (Gallery)');

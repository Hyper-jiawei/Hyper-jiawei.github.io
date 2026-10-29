// Both Astro projects retain their own source tree; only their public output is combined.
import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const gallery = new URL('dist/gallery/', root);
await fs.rm(gallery, { recursive: true, force: true });
await fs.cp(new URL('gallery/site/dist/', root), gallery, { recursive: true });
console.log('Published paths: / (Blog), /gallery/ (Gallery)');

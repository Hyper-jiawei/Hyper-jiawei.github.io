// Reads post front matter at config time so the sitemap can skip unlisted
// ("private" / build.list: never) posts, matching the old Hugo behaviour.
import fs from 'node:fs';
import path from 'node:path';
import { load as yamlLoad } from 'js-yaml';

export const POSTS_DIR = path.resolve('src/content/posts');

export function readFrontmatter(slug) {
  const file = path.join(POSTS_DIR, slug, 'index.md');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? yamlLoad(m[1]) : {};
}

export function isUnlisted(data) {
  return Boolean(data?.private || data?.build?.list === 'never' || data?.draft);
}

export function unlistedPaths() {
  return fs
    .readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isUnlisted(readFrontmatter(d.name)))
    .map((d) => `/posts/${d.name}/`);
}

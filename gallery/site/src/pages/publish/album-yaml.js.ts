import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const yamlDir = dirname(createRequire(import.meta.url).resolve('js-yaml/package.json'));

export const GET: APIRoute = async () => {
  const [license, yaml] = await Promise.all([
    readFile(join(yamlDir, 'LICENSE'), 'utf8'),
    readFile(join(yamlDir, 'dist/js-yaml.mjs'), 'utf8'),
  ]);
  return new Response(`/*!\n${license}\n*/\n${yaml}`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
};

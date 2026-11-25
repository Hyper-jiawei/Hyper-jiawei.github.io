import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const exifrDir = dirname(createRequire(import.meta.url).resolve('exifr/package.json'));

export const GET: APIRoute = async () => {
  const [license, exifr] = await Promise.all([
    readFile(join(exifrDir, 'LICENSE'), 'utf8'),
    readFile(join(exifrDir, 'dist/full.esm.mjs'), 'utf8'),
  ]);
  return new Response(`/*!\n${license}\n*/\n${exifr}`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
};

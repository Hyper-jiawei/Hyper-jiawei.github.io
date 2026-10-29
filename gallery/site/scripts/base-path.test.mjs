import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { modulePreloads } from './module-preloads.mjs';
import { homePath, albumPath, localeSwitch, langOf } from '../src/i18n/index.ts';

test('gallery routes and language changes stay inside their mount path', () => {
  assert.equal(homePath('zh'), '/gallery/');
  assert.equal(albumPath('en', 'sample'), '/gallery/en/sample/');
  assert.equal(localeSwitch('/gallery/en/sample/', 'ja'), '/gallery/ja/sample/');
  assert.equal(localeSwitch('/gallery/en/404/', 'zh'), '/gallery/');
  assert.equal(langOf('/gallery/ja/sample/'), 'ja');
});

test('module preloads resolve to the gallery bundle under its mount path', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-base-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const integration = modulePreloads('/gallery/');
  let config;
  integration.hooks['astro:config:setup']({ updateConfig: value => { config = value; } });
  config.vite.plugins[0].generateBundle({}, {
    entry: { type: 'chunk', fileName: '_astro/main.js', imports: ['_astro/shared.js'] },
    shared: { type: 'chunk', fileName: '_astro/shared.js', imports: [] },
  });
  const file = path.join(dir, 'index.html');
  await fs.writeFile(file, '<title>Gallery</title><script src="/gallery/_astro/main.js"></script>');
  await integration.hooks['astro:build:done']({ dir: pathToFileURL(dir + path.sep) });
  const html = await fs.readFile(file, 'utf8');
  assert.ok(html.includes('href="/gallery/_astro/shared.js"'));
  assert.ok(!html.includes('href="/_astro/'));
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
const source = stripTypeScriptTypes(await readFile(new URL('../src/lib/original-download.ts', import.meta.url), 'utf8')).replace('export function', 'function');
function setup(fail = false) {
  let click; const saved = [], requests = [], attributes = new Map();
  const link = { href: 'https://raw.githubusercontent.com/Hyper-jiawei/gallery01/commit/手机.HEIC', origin: 'https://raw.githubusercontent.com', download: '手机.HEIC', getAttribute: (k) => attributes.get(k), setAttribute: (k,v) => attributes.set(k,v), removeAttribute: (k) => attributes.delete(k) };
  const context = { document: { addEventListener: (_, fn) => click = fn, body: { append() {} }, createElement: () => ({ click() { saved.push({ href: this.href, download: this.download, target: this.target }); }, remove() {} }) }, location: { origin: 'https://hyper-jiawei.github.io' }, fetch: async (url, options) => { requests.push({url, options}); return { ok: !fail, status: fail ? 503 : 200, blob: async () => new Blob(['unchanged HEIC']) }; }, URL: { createObjectURL: (blob) => { context.blob = blob; return 'blob:original'; }, revokeObjectURL() {} }, setTimeout() {} };
  vm.runInNewContext(source + '\ninstallOriginalDownloads();', context);
  return { link, saved, requests, attributes, context, click: (props = {}) => click({ target: { closest: () => link }, button: 0, preventDefault() {}, ...props }) };
}
test('public archive download saves original bytes with the Chinese HEIC filename and no credentials', async () => {
  const x = setup(); await x.click();
  assert.equal(x.saved[0].href, 'blob:original'); assert.equal(x.saved[0].download, '手机.HEIC');
  assert.equal(await x.context.blob.text(), 'unchanged HEIC');
  assert.equal(x.requests[0].options.credentials, 'omit'); assert.equal(x.attributes.has('aria-busy'), false);
});
test('same-origin downloads and modified clicks keep native browser behavior', async () => {
  const x = setup(); await x.click({ctrlKey: true}); x.link.origin = 'https://hyper-jiawei.github.io'; await x.click();
  assert.equal(x.requests.length, 0); assert.equal(x.saved.length, 0);
});
test('failed archive fetch leaves the public raw original reachable', async () => {
  const x = setup(true); await x.click(); assert.equal(x.saved[0].href, x.link.href); assert.equal(x.saved[0].target, '_blank'); assert.equal(x.attributes.has('aria-busy'), false);
});

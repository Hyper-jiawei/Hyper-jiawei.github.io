import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeBucket, server } from './r2-harness.mjs';

const config = '---\ntitle: "T"\ndate: "2026-11-02"\n---\n';
const auth = { authorization: 'Bearer test-token' };

test('every route requires the exact bearer token; failures never touch the bucket', async () => {
  const bucket = new FakeBucket(); bucket.seed({ 'albums/t/index.md': config });
  const s = server(bucket);
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Basic test-token' }, { authorization: 'Bearer test-token-extra' }]) {
    for (const [method, path] of [['GET', '/api/check'], ['GET', '/api/albums'], ['GET', '/api/albums/t'], ['PUT', '/api/albums/t'], ['DELETE', '/api/albums/t']]) {
      const response = await s.request(path, { method, headers });
      assert.equal(response.status, 401);
    }
  }
  assert.equal(bucket.calls.length, 0);
  await s.settle();
});

test('CORS preflight answers without a token and echoes the requesting origin', async () => {
  const s = server(new FakeBucket());
  const response = await s.request('/api/albums', { method: 'OPTIONS', headers: { origin: 'http://localhost:4321' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:4321');
  assert.match(response.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(response.headers.get('access-control-allow-headers'), /if-match/);
  const denied = await s.request('/api/albums', { headers: { origin: 'https://evil.example' } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('access-control-allow-origin'), 'https://evil.example');
  await s.settle();
});

test('the write probe proves writability without creating, changing or deleting any object', async () => {
  const bucket = new FakeBucket(); bucket.seed({ 'albums/t/index.md': config });
  const before = [...bucket.objects.keys()];
  const s = server(bucket);
  const response = await s.request('/api/check', { headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, storage: 'cloudflare-r2' });
  assert.deepEqual([...bucket.objects.keys()], before);
  assert.ok(bucket.calls.every(c => c.method !== 'DELETE'));
  await s.settle();
});

test('path traversal, encoded separators and non-photo names are rejected before storage access', async () => {
  const bucket = new FakeBucket();
  const s = server(bucket);
  for (const path of ['/api/albums/..', '/api/albums/%2e%2e', '/api/albums/a%2fb', '/api/albums/t/..%2fa.jpg', '/api/albums/t/notes.txt', '/api/albums/t/.hidden.jpg', '/api/albums/t/a.jpg%3fx', '/api/other', '/elsewhere']) {
    const response = await s.request(path, { headers: auth });
    assert.ok([400, 404].includes(response.status), path + ' -> ' + response.status);
  }
  assert.equal(bucket.calls.length, 0);
  await s.settle();
});

test('photo uploads are create-only, size-limited and keep the uploaded content type', async () => {
  const bucket = new FakeBucket();
  const s = server(bucket);
  const created = await s.request('/api/albums/t/a.jpg', { method: 'PUT', headers: { ...auth, 'content-type': 'image/jpeg' }, body: new Blob(['bytes'], { type: 'image/jpeg' }) });
  assert.equal(created.status, 201);
  assert.equal(bucket.objects.get('albums/t/a.jpg').contentType, 'image/jpeg');
  const conflict = await s.request('/api/albums/t/a.jpg', { method: 'PUT', headers: auth, body: new Blob(['other']) });
  assert.equal(conflict.status, 409);
  assert.equal(bucket.text('albums/t/a.jpg'), 'bytes');
  const empty = await s.request('/api/albums/t/b.jpg', { method: 'PUT', headers: auth, body: new Blob([]) });
  assert.equal(empty.status, 413);
  await s.settle();
});

test('config writes demand If-Match and valid front matter; create and update use distinct conditions', async () => {
  const bucket = new FakeBucket();
  const s = server(bucket);
  const missing = await s.request('/api/albums/t', { method: 'PUT', headers: auth, body: config });
  assert.equal(missing.status, 428);
  const badBody = await s.request('/api/albums/t', { method: 'PUT', headers: { ...auth, 'if-match': '*' }, body: 'title: no front matter' });
  assert.equal(badBody.status, 400);
  const created = await s.request('/api/albums/t', { method: 'PUT', headers: { ...auth, 'if-match': '*' }, body: config });
  assert.equal(created.status, 200);
  const { etag } = await created.json();
  const again = await s.request('/api/albums/t', { method: 'PUT', headers: { ...auth, 'if-match': '*' }, body: config });
  assert.equal(again.status, 409);
  const stale = await s.request('/api/albums/t', { method: 'PUT', headers: { ...auth, 'if-match': '"0'.padEnd(33, '0') + '"' }, body: config });
  assert.equal(stale.status, 409);
  const updated = await s.request('/api/albums/t', { method: 'PUT', headers: { ...auth, 'if-match': etag }, body: config + 'more' });
  assert.equal(updated.status, 200);
  await s.settle();
  assert.equal(s.hooks.length, 2);
});

test('original downloads are no-store with etags; deletes verify If-Match and scope', async () => {
  const bucket = new FakeBucket();
  bucket.seed({ 'albums/t/index.md': config, 'albums/t/a.jpg': 'original', 'albums/t/b.jpg': 'other', 'albums/sibling/index.md': config });
  const s = server(bucket);
  const response = await s.request('/api/albums/t/a.jpg', { headers: auth });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('etag'), bucket.objects.get('albums/t/a.jpg').etag);
  assert.equal(await response.text(), 'original');
  const stale = await s.request('/api/albums/t/a.jpg', { method: 'DELETE', headers: { ...auth, 'if-match': '"0'.padEnd(33, '0') + '"' } });
  assert.equal(stale.status, 409);
  assert.ok(bucket.text('albums/t/a.jpg'));
  const gone = await s.request('/api/albums/t/a.jpg', { method: 'DELETE', headers: { ...auth, 'if-match': bucket.objects.get('albums/t/a.jpg').etag } });
  assert.equal(gone.status, 200);
  const missing = await s.request('/api/albums/t/a.jpg', { method: 'DELETE', headers: auth });
  assert.equal(missing.status, 404);
  const album = await s.request('/api/albums/t', { method: 'DELETE', headers: { ...auth, 'if-match': bucket.objects.get('albums/t/index.md').etag } });
  assert.equal((await album.json()).deleted, 2);
  assert.ok(bucket.text('albums/sibling/index.md'));
  assert.ok([...bucket.objects.keys()].every(k => !k.startsWith('albums/t/')));
  await s.settle();
});

test('invalid UTF-8 configs and missing albums fail cleanly', async () => {
  const bucket = new FakeBucket();
  const s = server(bucket);
  const invalid = await s.request('/api/albums/t', { method: 'PUT', headers: { ...auth, 'if-match': '*' }, body: new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a, 0x2d, 0x2d, 0x2d]) });
  assert.equal(invalid.status, 400);
  const missing = await s.request('/api/albums/nope', { headers: auth });
  assert.equal(missing.status, 404);
  assert.equal(bucket.objects.size, 0);
  await s.settle();
});
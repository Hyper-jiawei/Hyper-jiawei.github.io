import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { signedHeaders, fetchContent } from './fetch-r2-content.mjs';

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

test('SigV4 headers match an independent derivation for R2 (region auto, service s3)', () => {
  const now = new Date('2026-11-25T08:09:10.000Z');
  const args = { method: 'GET', host: 'account.r2.cloudflarestorage.com', pathname: '/bucket/albums/trip/照片.jpg', query: 'list-type=2&prefix=albums%2F', accessKey: 'AK', secretKey: 'SK', now };
  const headers = signedHeaders(args);
  const amzDate = '20261125T080910Z', date = '20261125';
  assert.equal(headers['x-amz-date'], amzDate);
  assert.equal(headers['x-amz-content-sha256'], sha256(''));
  // Independent canonical request: query pairs decoded, re-encoded, sorted; path segments percent-encoded.
  const canonicalQuery = 'list-type=2&prefix=albums%2F';
  const canonicalPath = '/bucket/albums/trip/' + encodeURIComponent('照片.jpg');
  const canonical = ['GET', canonicalPath, canonicalQuery, `host:${args.host}\n`, `x-amz-content-sha256:${sha256('')}\n`, `x-amz-date:${amzDate}\n`, 'host;x-amz-content-sha256;x-amz-date', sha256('')].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let key = Buffer.from('AWS4SK');
  for (const part of [date, 'auto', 's3', 'aws4_request']) key = hmac(key, part);
  assert.equal(headers.authorization, `AWS4-HMAC-SHA256 Credential=AK/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${hmac(key, toSign).toString('hex')}`);
});

test('canonical query sorting and encoding are order-independent', () => {
  const base = { method: 'GET', host: 'h', pathname: '/b', accessKey: 'AK', secretKey: 'SK', now: new Date(0) };
  const a = signedHeaders({ ...base, query: 'prefix=albums%2F&list-type=2&continuation-token=a%2Bb' });
  const b = signedHeaders({ ...base, query: 'continuation-token=a+b&list-type=2&prefix=albums/' });
  assert.equal(a.authorization, b.authorization);
});

function xmlList(entries, next) {
  return `<?xml version="1.0"?><ListBucketResult>${entries.map(e => `<Contents><Key>${e.key.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Key><Size>${e.size}</Size></Contents>`).join('')}${next ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${next}</NextContinuationToken>` : '<IsTruncated>false</IsTruncated>'}</ListBucketResult>`;
}

test('fetchContent pages through listings, decodes XML entities and writes verified bytes', async () => {
  const objects = new Map([
    ['albums/trip/index.md', Buffer.from('---\ntitle: "T"\n---\n')],
    ['albums/trip/照片 & 更多.jpg', Buffer.from('original bytes')],
    ['albums/other/index.md', Buffer.from('---\ntitle: "O"\n---\n')],
  ]);
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request/);
    const parsed = new URL(url);
    if (parsed.searchParams.get('list-type') === '2') {
      assert.equal(parsed.searchParams.get('prefix'), 'albums/');
      const token = parsed.searchParams.get('continuation-token');
      const keys = [...objects.keys()].sort();
      return new Response(token ? xmlList(keys.slice(2).map(k => ({ key: k, size: objects.get(k).length }))) : xmlList(keys.slice(0, 2).map(k => ({ key: k, size: objects.get(k).length })), 'page2'));
    }
    const key = decodeURIComponent(parsed.pathname.slice('/bucket/'.length));
    const bytes = objects.get(key);
    return bytes ? new Response(bytes) : new Response('missing', { status: 404 });
  };
  const content = await fs.mkdtemp(path.join(os.tmpdir(), 'r2-content-'));
  try {
    const count = await fetchContent({ accountId: 'account', accessKey: 'AK', secretKey: 'SK', bucket: 'bucket', content, request });
    assert.equal(count, 3);
    assert.equal(await fs.readFile(path.join(content, 'trip/照片 & 更多.jpg'), 'utf8'), 'original bytes');
    assert.ok(await fs.readFile(path.join(content, 'other/index.md'), 'utf8'));
    assert.ok(requests.some(r => r.url.includes('continuation-token=page2')));
  } finally { await fs.rm(content, { recursive: true, force: true }); }
});

test('fetchContent refuses empty buckets, unsafe keys and size mismatches', async () => {
  const content = await fs.mkdtemp(path.join(os.tmpdir(), 'r2-content-'));
  const serve = objects => async url => {
    const parsed = new URL(url);
    if (parsed.searchParams.get('list-type') === '2') return new Response(xmlList([...objects.entries()].map(([key, bytes]) => ({ key, size: bytes.length }))));
    const bytes = objects.get(decodeURIComponent(parsed.pathname.slice('/bucket/'.length)));
    return bytes ? new Response(bytes) : new Response('missing', { status: 404 });
  };
  const base = { accountId: 'a', accessKey: 'AK', secretKey: 'SK', bucket: 'bucket', content };
  try {
    await assert.rejects(fetchContent({ ...base, request: serve(new Map()) }), /no albums/);
    await assert.rejects(fetchContent({ ...base, request: serve(new Map([['albums/../escape/index.md', Buffer.from('x')]])) }), /Unsafe R2 key/);
    const lying = new Map([['albums/t/index.md', Buffer.from('---\n---\n')]]);
    const request = async url => new URL(url).searchParams.get('list-type') === '2'
      ? new Response(xmlList([{ key: 'albums/t/index.md', size: 999 }]))
      : new Response(lying.get('albums/t/index.md'));
    await assert.rejects(fetchContent({ ...base, request }), /size mismatch/);
  } finally { await fs.rm(content, { recursive: true, force: true }); }
});
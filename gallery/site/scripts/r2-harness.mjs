// Test harness: an in-memory R2 bucket with real conditional-write semantics,
// driving the actual Worker so client tests exercise the full request path.
import { createHash } from 'node:crypto';
import worker from '../../worker/storage-api.mjs';
import { storage } from '../public/publish/core.mjs';

const bytesOf = value => typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);

export class FakeBucket {
  constructor(pageSize = 3) { this.objects = new Map(); this.calls = []; this.pageSize = pageSize; this.hook = null; }
  seed(files) { for (const [key, value] of Object.entries(files)) this.objects.set(key, { bytes: bytesOf(value), etag: '"' + createHash('md5').update(bytesOf(value)).digest('hex') + '"', contentType: 'application/octet-stream' }); }
  text(key) { return this.objects.get(key)?.bytes.toString(); }
  bump(key, value = 'changed elsewhere') { this.seed({ [key]: value + Math.random() }); }
  async put(key, value, options = {}) {
    this.calls.push({ method: 'PUT', key, options });
    if (this.hook) await this.hook('PUT', key);
    const existing = this.objects.get(key);
    const onlyIf = options.onlyIf;
    if (onlyIf?.etagDoesNotMatch === '*' && existing) return null;
    if (onlyIf?.etagMatches && (!existing || existing.etag !== onlyIf.etagMatches)) return null;
    const bytes = bytesOf(value);
    const etag = '"' + createHash('md5').update(bytes).digest('hex') + '"';
    this.objects.set(key, { bytes, etag, contentType: options.httpMetadata?.contentType ?? 'application/octet-stream' });
    return { key, httpEtag: etag, size: bytes.length };
  }
  async get(key) {
    this.calls.push({ method: 'GET', key });
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key, size: object.bytes.length, httpEtag: object.etag, httpMetadata: { contentType: object.contentType },
      body: new Blob([object.bytes]).stream(),
      text: async () => object.bytes.toString(),
      arrayBuffer: async () => object.bytes.buffer.slice(object.bytes.byteOffset, object.bytes.byteOffset + object.bytes.length),
    };
  }
  async list({ prefix = '', cursor } = {}) {
    this.calls.push({ method: 'LIST', prefix, cursor });
    const keys = [...this.objects.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + this.pageSize);
    const truncated = start + this.pageSize < keys.length;
    return {
      objects: page.map(key => ({ key, size: this.objects.get(key).bytes.length, httpEtag: this.objects.get(key).etag })),
      truncated, ...(truncated && { cursor: String(start + this.pageSize) }),
    };
  }
  async delete(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    this.calls.push({ method: 'DELETE', keys: list });
    for (const key of list) this.objects.delete(key);
  }
  writes() { return this.calls.filter(c => c.method === 'PUT' || c.method === 'DELETE'); }
}

export function server(bucket, { token = 'test-token', hook = 'https://hooks.test/deploy' } = {}) {
  const env = { AUTH_TOKEN: token, BUCKET: bucket, ...(hook && { DEPLOY_HOOK: hook }) };
  const hooks = [], pending = [];
  const ctx = { waitUntil: promise => pending.push(promise) };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { hooks.push({ url: String(url), options }); return new Response('ok'); };
  const request = (path, options) => worker.fetch(new Request('https://api.test' + path, options), env, ctx);
  return {
    env, hooks, request,
    api: storage(token, request),
    settle: async () => { await Promise.all(pending); globalThis.fetch = previousFetch; },
  };
}
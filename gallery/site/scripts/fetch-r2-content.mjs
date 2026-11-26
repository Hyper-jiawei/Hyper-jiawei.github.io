// Downloads albums/<slug>/… from the R2 bucket into ../content before a
// Cloudflare Pages build, so the site is generated from Cloudflare storage
// alone. Uses the R2 S3 API with a read-only token kept in build env vars.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const EMPTY = sha256('');

export function signedHeaders({ method, host, pathname, query = '', accessKey, secretKey, now = new Date(), payloadHash = EMPTY }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const canonicalQuery = query.split('&').filter(Boolean).map(pair => {
    const [k, v = ''] = pair.split('=');
    return [encodeURIComponent(decodeURIComponent(k)), encodeURIComponent(decodeURIComponent(v))];
  }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalPath = pathname.split('/').map(encodeURIComponent).join('/');
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, canonicalPath, canonicalQuery, ...signed.map(k => `${k}:${headers[k]}\n`), signed.join(';'), payloadHash].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretKey, date), 'auto'), 's3'), 'aws4_request');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${hmac(key, toSign).toString('hex')}` };
}

export async function fetchContent({ accountId, accessKey, secretKey, bucket, content, request = fetch }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  async function call(method, pathname, query = '') {
    const headers = signedHeaders({ method, host, pathname, query, accessKey, secretKey });
    const response = await request(`https://${host}${pathname}${query ? '?' + query : ''}`, { method, headers });
    if (!response.ok) throw new Error(`R2 ${method} ${pathname} failed: ${response.status} ${await response.text()}`);
    return response;
  }
  async function listKeys() {
    const keys = [];
    let token = '';
    do {
      const xml = await (await call('GET', `/${bucket}`, `list-type=2&prefix=albums%2F${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`)).text();
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = match[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
        const size = Number(match[1].match(/<Size>(\d+)<\/Size>/)?.[1]);
        if (key && Number.isInteger(size)) keys.push({ key: key.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), size });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '' : '';
    } while (token);
    return keys;
  }
  const keys = await listKeys();
  if (!keys.some(k => k.key.endsWith('/index.md'))) throw new Error('R2 bucket has no albums yet');
  await fs.rm(content, { recursive: true, force: true });
  let done = 0;
  const queue = [...keys];
  async function worker() {
    for (let item; (item = queue.pop());) {
      const relative = item.key.slice('albums/'.length);
      if (relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe R2 key: ' + item.key);
      const target = path.join(content, relative);
      const response = await call('GET', `/${bucket}/${item.key}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== item.size) throw new Error('R2 size mismatch: ' + item.key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      console.log(`r2 ${++done}/${keys.length} ${relative}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, keys.length) }, worker));
  console.log(`Fetched ${keys.length} objects from R2 into ${content}`);
  return keys.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET');
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await fetchContent({
    accountId: R2_ACCOUNT_ID, accessKey: R2_ACCESS_KEY_ID, secretKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET,
    content: path.resolve(root, process.env.GALLERY_CONTENT ?? '../content'),
  });
}

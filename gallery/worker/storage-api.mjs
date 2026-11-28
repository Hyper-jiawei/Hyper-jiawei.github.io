// Cloudflare Worker: the gallery's only write API. Albums live in R2 as
// albums/<slug>/index.md plus the untouched original files. Every request needs
// the bearer token; the token never reaches the static site or the build.
const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
const SLUG = /^[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*$/u;
const PHOTO_LIMIT = 95 * 1024 ** 2;
const CONFIG_LIMIT = 1024 ** 2;

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const fail = (status, message) => json({ message }, status);

function component(value) {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value.includes('..') || /[\\/\x00-\x1f\x7f?#%]/.test(value)) throw Error('不安全的专辑路径或文件名');
  return value;
}
function slugOf(value) {
  component(value);
  if (!SLUG.test(value)) throw Error('无效的专辑目录名');
  return value;
}
function photoOf(value) {
  component(value);
  if (!IMAGE.test(value) || value.startsWith('.')) throw Error('不支持的照片文件名：' + value);
  return value;
}
async function authorized(request, env) {
  if (!env.AUTH_TOKEN) return false;
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  if (!match) return false;
  const digest = async text => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(match[1]), digest(env.AUTH_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function cors(response, request) {
  const origin = request.headers.get('origin');
  if (origin) {
    response.headers.set('access-control-allow-origin', origin);
    response.headers.set('vary', 'Origin');
  }
  return response;
}
async function listAll(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, ...(cursor && { cursor }) });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}
function rebuild(env, ctx) {
  if (env.DEPLOY_HOOK) ctx.waitUntil(fetch(env.DEPLOY_HOOK, { method: 'POST' }).catch(() => {}));
}
function configCheck(text) {
  if (!/^\uFEFF?---\r?\n[\s\S]*?^---[ \t]*(?=\r?$)/m.test(text) || !text.startsWith('---')) throw Error('配置必须是带 YAML front matter 的 index.md');
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204, headers: {
          'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type, if-match',
          'access-control-max-age': '86400',
        } }), request);
      }
      const url = new URL(request.url);
      const reply = async response => cors(response, request);
      if (!url.pathname.startsWith('/api/')) return reply(fail(404, 'Not found'));
      if (!(await authorized(request, env))) return reply(fail(401, '令牌无效：请连接具有写入权限的发布令牌'));
      const parts = url.pathname.slice('/api/'.length).split('/').filter(Boolean).map(decodeURIComponent);

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'check') {
        // A conditional write that must fail proves the bucket is writable
        // without creating, changing or deleting any object.
        const probe = await env.BUCKET.put('.write-probe', '', { onlyIf: { etagMatches: '00000000000000000000000000000000' } });
        if (probe) { await env.BUCKET.delete('.write-probe'); return reply(fail(500, '写入检查异常，请重试')); }
        return reply(json({ ok: true, storage: 'cloudflare-r2' }));
      }

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'albums') {
        const configs = (await listAll(env.BUCKET, 'albums/')).filter(o => /^albums\/[^/]+\/index\.md$/.test(o.key));
        const albums = await Promise.all(configs.map(async entry => {
          const slug = entry.key.split('/')[1];
          const object = await env.BUCKET.get(entry.key);
          if (!object) return null;
          const photos = (await listAll(env.BUCKET, `albums/${slug}/`))
            .filter(o => o.key !== entry.key && !o.key.slice(`albums/${slug}/`.length).includes('/') && IMAGE.test(o.key))
            .map(o => ({ name: o.key.slice(`albums/${slug}/`.length), size: o.size, etag: o.httpEtag }));
          return { slug, etag: object.httpEtag, config: await object.text(), photos };
        }));
        return reply(json({ albums: albums.filter(Boolean) }));
      }

      if (parts[0] === 'albums' && (parts.length === 2 || parts.length === 3)) {
        const slug = slugOf(parts[1]);
        const key = parts.length === 3 ? `albums/${slug}/${photoOf(parts[2])}` : `albums/${slug}/index.md`;
        if (request.method === 'GET') {
          const object = await env.BUCKET.get(key);
          if (!object) return reply(fail(404, '内容不存在，请刷新专辑列表'));
          if (parts.length === 2) {
            const photos = (await listAll(env.BUCKET, `albums/${slug}/`))
              .filter(o => o.key !== key && !o.key.slice(`albums/${slug}/`.length).includes('/') && IMAGE.test(o.key))
              .map(o => ({ name: o.key.slice(`albums/${slug}/`.length), size: o.size, etag: o.httpEtag }));
            return reply(json({ slug, etag: object.httpEtag, config: await object.text(), photos }));
          }
          return reply(new Response(object.body, { headers: {
            'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
            etag: object.httpEtag,
            'cache-control': 'no-store',
          } }));
        }
        if (request.method === 'PUT') {
          const body = await request.arrayBuffer();
          if (parts.length === 3) {
            if (body.byteLength < 1 || body.byteLength > PHOTO_LIMIT) return reply(fail(413, '照片为空或超过 95 MiB 上传限制'));
            const written = await env.BUCKET.put(key, body, {
              onlyIf: new Headers({ 'if-none-match': '*' }),
              httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
            });
            if (!written) return reply(fail(409, '同名原图已存在，不能覆盖：' + parts[2]));
            return reply(json({ ok: true, etag: written.httpEtag }, 201));
          }
          if (body.byteLength < 1 || body.byteLength > CONFIG_LIMIT) return reply(fail(413, '配置为空或过大'));
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
          configCheck(text);
          const match = request.headers.get('if-match');
          if (!match) return reply(fail(428, '缺少 If-Match：创建新专辑用 *，更新用加载时的 etag'));
          const onlyIf = new Headers({ [match === '*' ? 'if-none-match' : 'if-match']: match });
          const written = await env.BUCKET.put(key, text, { onlyIf, httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
          if (!written) return reply(fail(409, match === '*' ? '同名专辑已存在，请勾选「更新同名作品」' : '专辑已被其他设备修改，请重新加载；不会覆盖别人的更新'));
          rebuild(env, ctx);
          return reply(json({ ok: true, etag: written.httpEtag }));
        }
        if (request.method === 'DELETE' && parts.length === 3) {
          const object = await env.BUCKET.get(key);
          if (!object) return reply(fail(404, '原图不存在，请刷新专辑'));
          const match = request.headers.get('if-match');
          if (match && match !== object.httpEtag) return reply(fail(409, '原图已被其他设备修改，请重新加载'));
          await env.BUCKET.delete(key);
          return reply(json({ ok: true }));
        }
        if (request.method === 'DELETE' && parts.length === 2) {
          const object = await env.BUCKET.get(key);
          if (!object) return reply(fail(404, '专辑不存在，请刷新列表'));
          const match = request.headers.get('if-match');
          if (match && match !== object.httpEtag) return reply(fail(409, '专辑已被其他设备修改，请重新加载'));
          const objects = await listAll(env.BUCKET, `albums/${slug}/`);
          for (let i = 0; i < objects.length; i += 1000) await env.BUCKET.delete(objects.slice(i, i + 1000).map(o => o.key));
          rebuild(env, ctx);
          return reply(json({ ok: true, deleted: objects.length }));
        }
      }
      return reply(fail(404, 'Not found'));
    } catch (error) {
      return cors(fail(400, error.message || '请求无效'), request);
    }
  },
};

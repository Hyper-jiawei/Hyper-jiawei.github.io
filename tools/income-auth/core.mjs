export const APP_ORIGIN = 'https://hyper-jiawei.github.io';
export const RP_ID = 'hyper-jiawei.github.io';
export const OWNER_ID = 209197935;
export const TTL = Object.freeze({ oauth: 300_000, ticket: 30_000, bootstrap: 300_000, challenge: 120_000, idle: 600_000, absolute: 28_800_000 });
export const MAX_CIPHERTEXT_BYTES = 2 * 1024 * 1024;
export const MAX_VAULT_BODY_BYTES = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 + 1024;
export const MAX_AUTH_BODY_BYTES = 64 * 1024;
export const MAX_RECORDS = 2048;
export const CLEANUP_BATCH = 128;
export const COOKIE_NAME = '__Host-income_oauth';

export class HttpError extends Error {
  constructor(status) {
    super('Request failed');
    this.status = status;
  }
}

export function fail(status) { throw new HttpError(status); }
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
export function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function configuration(env) {
  const names = ['APP_ORIGIN', 'RP_ID', 'OWNER_ID', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'STORE_OWNER', 'STORE_REPO', 'STORE_TOKEN', 'STORE_BRANCH'];
  if (!names.every(name => typeof env[name] === 'string' && env[name].length > 0 && env[name].length <= 4096 && !/[\u0000-\u0020\u007f]/u.test(env[name]))) return null;
  if (env.APP_ORIGIN !== APP_ORIGIN || env.RP_ID !== RP_ID || env.OWNER_ID !== String(OWNER_ID)) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(env.STORE_OWNER)) return null;
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(env.STORE_REPO) || ['.', '..'].includes(env.STORE_REPO)) return null;
  if (env.STORE_OWNER.toLowerCase() === 'hyper-jiawei' && env.STORE_REPO.toLowerCase() === 'income') return null;
  if (env.STORE_BRANCH.length > 255 || /[?#[\]\\]/u.test(env.STORE_BRANCH)) return null;
  return Object.fromEntries(names.map(name => [name, env[name]]));
}

export function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export function base64url(bytes) { return base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''); }
export function unbase64url(value, min = 0, max = MAX_CIPHERTEXT_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) fail(400);
  let decoded;
  try { decoded = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)); } catch { fail(400); }
  if (decoded.length < min || decoded.length > max || base64url(decoded) !== value) fail(400);
  return decoded;
}
export function validOpaqueToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value) && (() => {
    try { unbase64url(value, 32, 32); return true; } catch { return false; }
  })();
}
export function randomToken() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function digestToken(token) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))); }
export function sessionExpiry(session) { return Math.min(session.createdAt + TTL.absolute, session.activeAt + TTL.idle); }
export function sessionAlive(session, now) {
  return isObject(session) && Number.isFinite(session.createdAt) && Number.isFinite(session.activeAt) && now >= session.createdAt && now >= session.activeAt && now < sessionExpiry(session);
}
export function validateBox(box) {
  if (!exactKeys(box, ['0', '1', '2']) || box['0'] !== 1) fail(400);
  unbase64url(box['1'], 12, 12);
  unbase64url(box['2'], 16, MAX_CIPHERTEXT_BYTES);
  return { '0': 1, '1': box['1'], '2': box['2'] };
}
export function validRevision(revision) { return typeof revision === 'string' && /^[a-f0-9]{40}$/u.test(revision); }
export function validateVaultWrite(body) {
  if (!exactKeys(body, ['revision', 'box']) || (body.revision !== null && !validRevision(body.revision))) fail(400);
  return { revision: body.revision, box: validateBox(body.box) };
}
export function bearer(request) {
  const value = request.headers.get('Authorization');
  if (!value || value.length > 60 || !/^Bearer [A-Za-z0-9_-]{43}$/u.test(value)) fail(401);
  const token = value.slice(7);
  if (!validOpaqueToken(token)) fail(401);
  return token;
}
export function mutationHeaders(request) {
  if (request.headers.get('Origin') !== APP_ORIGIN) fail(403);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('Content-Type') || '')) fail(415);
  const encoding = request.headers.get('Content-Encoding');
  if (encoding && encoding !== 'identity') fail(415);
}
export async function readBytes(source, max, status = 413) {
  const length = source.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > max)) fail(status);
  if (!source.body) return new Uint8Array();
  const reader = source.body.getReader();
  const chunks = [];
  let size = 0;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(status === 503 ? 503 : 400)), 15_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > max) fail(status);
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Never expose stream failures. */ }
    throw error;
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readJSON(source, max, status = 400) {
  const bytes = await readBytes(source, max, status === 503 ? 503 : 413);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(status); }
}
export function oauthCookie(binding, clear = false) {
  return `${COOKIE_NAME}=${clear ? '' : binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 300}`;
}
export function cookieBinding(request) {
  const header = request.headers.get('Cookie') || '';
  if (header.length > 4096) fail(400);
  const matches = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) fail(401);
  const value = matches[0].slice(COOKIE_NAME.length + 1);
  if (!validOpaqueToken(value)) fail(401);
  return value;
}
export function responseHeaders(request) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Vary': 'Origin',
  });
  if (request.headers.get('Origin') === APP_ORIGIN) headers.set('Access-Control-Allow-Origin', APP_ORIGIN);
  return headers;
}
export function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
export function errorResponse(error) {
  const status = error instanceof HttpError ? error.status : 503;
  const messages = { 400: 'Invalid request', 401: 'Authentication required', 403: 'Forbidden', 404: 'Not found', 405: 'Method not allowed', 409: 'Conflict', 413: 'Request too large', 415: 'Unsupported media type', 429: 'Too many requests', 503: 'Service unavailable' };
  return json({ error: messages[status] || 'Request failed' }, status);
}
export function decorate(response, request) {
  const headers = responseHeaders(request);
  for (const [name, value] of response.headers) headers.set(name, value);
  if (new URL(request.url).pathname === '/auth/callback') headers.set('Set-Cookie', oauthCookie('', true));
  return new Response(response.body, { status: response.status, headers });
}

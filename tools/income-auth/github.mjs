import { base64, configuration, fail, MAX_VAULT_BODY_BYTES, readJSON, validRevision, validateBox, validateVaultWrite } from './core.mjs';

const API = 'https://api.github.com';
const MAX_METADATA = 2 * 1024 * 1024;
const MAX_BLOB_RESPONSE = Math.ceil(MAX_VAULT_BODY_BYTES / 3) * 4 + 8192;

export async function githubRequest(fetcher, url, token, init = {}) {
  try {
    const response = await fetcher(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'income-auth',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) { await discard(response); fail(503); }
    return response;
  } catch { fail(503); }
}
async function discard(response) {
  try { await response.body?.cancel(); } catch { /* No upstream error body is exposed or logged. */ }
}

export async function verifyGithubOwner(config, state, code, fetcher = fetch) {
  let token;
  try {
    let exchange;
    try {
      exchange = await fetcher('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.GITHUB_CLIENT_ID,
          client_secret: config.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: state.redirectUri,
          code_verifier: state.verifier,
        }).toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch { fail(503); }
    if (exchange.status >= 300 && exchange.status < 400) { await discard(exchange); fail(503); }
    if (!exchange.ok) { await discard(exchange); fail(401); }
    const result = await readJSON(exchange, 16 * 1024, 503);
    if (!result || typeof result.access_token !== 'string' || result.access_token.length > 4096 || !/^[A-Za-z0-9_]+$/u.test(result.access_token)) fail(401);
    token = result.access_token;
    // OAuth is identity-only. This token never enters Durable Object storage or a response.
    const response = await githubRequest(fetcher, `${API}/user`, token);
    if (!response.ok) { await discard(response); fail(401); }
    const user = await readJSON(response, 64 * 1024, 503);
    if (!user || user.id !== Number(config.OWNER_ID)) fail(403);
  } finally { token = undefined; }
}

export class GithubVault {
  constructor(env, fetcher = fetch) {
    this.config = configuration(env);
    if (!this.config) fail(503);
    this.fetcher = fetcher;
    this.root = `${API}/repos/${encodeURIComponent(env.STORE_OWNER)}/${encodeURIComponent(env.STORE_REPO)}`;
  }
  request(url, init) { return githubRequest(this.fetcher, url, this.config.STORE_TOKEN, init); }
  async assertPrivate() {
    // Never cache privacy: a missing/inaccessible/public repository fails closed each time.
    const response = await this.request(this.root);
    if (!response.ok) { await discard(response); fail(503); }
    const repo = await readJSON(response, 64 * 1024, 503);
    if (!repo || repo.private !== true || typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== `${this.config.STORE_OWNER}/${this.config.STORE_REPO}`.toLowerCase()) fail(503);
  }
  async metadata() {
    const response = await this.request(`${this.root}/contents/0.bin?ref=${encodeURIComponent(this.config.STORE_BRANCH)}`, {
      headers: { Accept: 'application/vnd.github.object+json' },
    });
    if (response.status === 404) { await discard(response); return null; }
    if (!response.ok) { await discard(response); fail(503); }
    const meta = await readJSON(response, MAX_METADATA, 503);
    if (!meta || meta.type !== 'file' || meta.path !== '0.bin' || !validRevision(meta.sha) || !Number.isInteger(meta.size) || meta.size < 0 || meta.size > MAX_VAULT_BODY_BYTES) fail(503);
    return { sha: meta.sha, size: meta.size };
  }
  async read() {
    await this.assertPrivate();
    const meta = await this.metadata();
    if (meta === null) return { revision: null, box: null };
    // Fetch by immutable blob SHA, not a mutable branch or upstream download URL.
    const response = await this.request(`${this.root}/git/blobs/${meta.sha}`);
    if (!response.ok) { await discard(response); fail(503); }
    const blob = await readJSON(response, MAX_BLOB_RESPONSE, 503);
    if (!blob || blob.sha !== meta.sha || blob.encoding !== 'base64' || blob.size !== meta.size || typeof blob.content !== 'string') fail(503);
    let bytes;
    try {
      const encoded = blob.content.replace(/[\r\n]/gu, '');
      if (encoded.length > Math.ceil(MAX_VAULT_BODY_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail(503);
      bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      if (bytes.length !== meta.size || base64(bytes) !== encoded) fail(503);
      const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
      const input = new Uint8Array(prefix.length + bytes.length);
      input.set(prefix); input.set(bytes, prefix.length);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', input)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== meta.sha) fail(503);
      const box = validateBox(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      return { revision: meta.sha, box };
    } catch { fail(503); }
  }
  async write(body, stillAuthorized = () => {}) {
    const { revision, box } = validateVaultWrite(body);
    await this.assertPrivate();
    const current = await this.metadata();
    if ((current?.sha ?? null) !== revision) fail(409);
    // Recheck after network awaits; an expired session must not initiate a write.
    stillAuthorized();
    const response = await this.request(`${this.root}/contents/0.bin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update 0',
        branch: this.config.STORE_BRANCH,
        content: base64(new TextEncoder().encode(JSON.stringify(box))),
        ...(revision === null ? {} : { sha: revision }),
      }),
    });
    if (response.status === 409 || response.status === 422) { await discard(response); fail(409); }
    if (!response.ok) { await discard(response); fail(503); }
    const result = await readJSON(response, 64 * 1024, 503);
    if (!result?.content || !validRevision(result.content.sha)) fail(503);
    return { revision: result.content.sha };
  }
}

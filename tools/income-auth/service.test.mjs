import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { AuthStore } from './store.mjs';
import { AuthService } from './service.mjs';
import { GithubVault } from './github.mjs';
import {
  APP_ORIGIN, RP_ID, OWNER_ID, base64, base64url, configuration, digestToken, HttpError,
  MAX_CIPHERTEXT_BYTES, MAX_RECORDS, MAX_VAULT_BODY_BYTES, sessionAlive, TTL, validateBox,
  validateVaultWrite, readBytes, errorResponse,
} from './core.mjs';

const ENV = Object.freeze({
  APP_ORIGIN, RP_ID, OWNER_ID: String(OWNER_ID), GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-client-secret', STORE_OWNER: 'hyper-jiawei', STORE_REPO: 'test-private-store',
  STORE_TOKEN: 'test-store-secret', STORE_BRANCH: 'main',
});
const SERVICE_ORIGIN = 'https://auth.example.test';
const ROOT = 'https://api.github.com/repos/hyper-jiawei/test-private-store';
const CREDENTIAL_ID = base64url(new Uint8Array([1, 2, 3, 4]));
const BOX = Object.freeze({ '0': 1, '1': base64url(new Uint8Array(12)), '2': base64url(new Uint8Array(16)) });
const SHA = 'a'.repeat(40);
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Exercise production SQLite statements and synchronous transactions without Cloudflare or files.
function sqliteStorage(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let tx = 0;
  return {
    sql: { exec(query, ...args) {
      const statement = db.prepare(query);
      const rows = statement.columns().length ? statement.all(...args).map(row => ({ ...row })) : (statement.run(...args), []);
      return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } };
    } },
    transactionSync(fn) {
      const name = `tx_${tx++}`;
      db.exec(`SAVEPOINT ${name}`);
      try { const result = fn(); db.exec(`RELEASE ${name}`); return result; }
      catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
    },
  };
}
function fixture(t, overrides = {}) {
  let time = 1_000_000;
  let sequence = 1;
  let challenge = 1;
  const calls = [];
  const store = new AuthStore(sqliteStorage(t));
  const random = () => {
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setUint32(0, sequence++);
    return base64url(bytes);
  };
  const generate = async input => {
    calls.push({ webauthnOptions: input });
    return { challenge: `challenge_${challenge++}`, rpId: RP_ID };
  };
  const verify = async input => {
    calls.push({ verification: input });
    assert.equal(input.expectedOrigin, APP_ORIGIN);
    assert.equal(input.expectedRPID, RP_ID);
    assert.equal(input.requireUserVerification, true);
    if (input.response.response.challenge !== input.expectedChallenge || input.response.response.uv !== true) throw new Error('Invalid assertion');
    return input.credential ? {
      verified: true, authenticationInfo: { newCounter: input.credential.counter + 1, userVerified: true },
    } : {
      verified: true, registrationInfo: {
        userVerified: true, credentialDeviceType: 'multiDevice', credentialBackedUp: true,
        credential: { id: CREDENTIAL_ID, publicKey: new Uint8Array(65).fill(4), counter: 0, transports: ['internal', 'hybrid'] },
      },
    };
  };
  const webauthn = {
    generateRegistrationOptions: generate, generateAuthenticationOptions: generate,
    verifyRegistrationResponse: verify, verifyAuthenticationResponse: verify,
    ...overrides.webauthn,
  };
  const defaultFetch = async url => {
    if (url === 'https://github.com/login/oauth/access_token') return reply({ access_token: 'test_identity_token' });
    if (url === 'https://api.github.com/user') return reply({ id: OWNER_ID });
    if (url === ROOT) return reply({ private: true, full_name: 'hyper-jiawei/test-private-store' });
    if (url.startsWith(`${ROOT}/contents/0.bin`)) return reply({}, 404);
    throw new Error('Unexpected network request');
  };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return (overrides.fetcher || defaultFetch)(url, init, defaultFetch);
  };
  const service = new AuthService({ ...ENV, ...overrides.env }, store, webauthn, { now: () => time, random, fetcher });
  return {
    store, service, random, calls, fetcher,
    setTime(value) { time = value; }, advance(value) { time += value; }, now: () => time,
    async call(path, { method = 'GET', token, body, origin = APP_ORIGIN, headers = {} } = {}) {
      const all = new Headers(headers);
      if (origin !== undefined && origin !== null) all.set('Origin', origin);
      if (token) all.set('Authorization', `Bearer ${token}`);
      if (body !== undefined) all.set('Content-Type', 'application/json');
      return service.fetch(new Request(`${SERVICE_ORIGIN}${path}`, { method, headers: all, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    },
    async issue(kind) { return service.issue(kind); },
    async start() {
      const response = await service.fetch(new Request(`${SERVICE_ORIGIN}/auth/start`, { headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } }));
      assert.equal(response.status, 302);
      return { response, state: new URL(response.headers.get('Location')).searchParams.get('state'), cookie: response.headers.get('Set-Cookie').split(';')[0] };
    },
    callback(start, extra = '') {
      return service.fetch(new Request(`${SERVICE_ORIGIN}/auth/callback?state=${start.state}&code=valid-code${extra}`, { headers: { Cookie: start.cookie } }));
    },
    async options(token) {
      const response = await this.call('/passkey/options', { method: 'POST', token, body: {} });
      assert.equal(response.status, 200);
      return response.json();
    },
    verify(token, options, uv = true, mode = options.mode) {
      return this.call('/passkey/verify', { method: 'POST', token, body: {
        mode, credential: { id: CREDENTIAL_ID, rawId: CREDENTIAL_ID, type: 'public-key', response: { challenge: options.options.challenge, uv } },
      } });
    },
    async login() {
      const bootstrap = await this.issue('bootstrap');
      const options = await this.options(bootstrap);
      const registered = await this.verify(bootstrap, options);
      assert.equal(registered.status, 200);
      const registration = await registered.json();
      assert.equal(registration.registered, true);
      assert.equal(registration.mode, 'login');
      const loginOptions = await this.options(registration.token);
      const response = await this.verify(registration.token, loginOptions);
      assert.equal(response.status, 200);
      return (await response.json()).token;
    },
  };
}
function recordDump(store) {
  return store.sql.exec('SELECT * FROM auth_records ORDER BY kind, key').toArray();
}

for (const [name, delta] of Object.entries({ absent: { STORE_TOKEN: undefined }, origin: { APP_ORIGIN: 'http://hyper-jiawei.github.io' }, rp: { RP_ID: 'example.test' }, owner: { OWNER_ID: '1' }, websiteRepo: { STORE_REPO: 'income' } })) {
  test(`health fails closed for ${name} configuration`, async t => {
    const f = fixture(t, { env: delta });
    assert.equal(configuration({ ...ENV, ...delta }), null);
    assert.deepEqual(await (await f.call('/health')).json(), { ready: false });
    assert.equal((await f.call('/auth/start')).status, 503);
  });
}
test('health reports configured readiness without revealing configuration', async t => {
  const f = fixture(t);
  assert.deepEqual(await (await f.call('/health')).json(), { ready: true });
  assert.equal(f.calls.length, 0);
});

for (const origin of [null, 'null', 'https://evil.test', `${APP_ORIGIN}/`, 'http://hyper-jiawei.github.io']) {
  test(`all mutation routes reject non-exact Origin ${origin}`, async t => {
    const f = fixture(t);
    for (const path of ['/auth/exchange', '/passkey/options', '/passkey/verify', '/session/touch', '/session/logout', '/vault']) {
      const response = await f.call(path, { method: path === '/vault' ? 'PUT' : 'POST', body: {}, origin });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    }
  });
}
test('JSON is mandatory and unauthenticated posts are denied before reading bodies', async t => {
  const f = fixture(t);
  const noJSON = new Request(`${SERVICE_ORIGIN}/auth/exchange`, { method: 'POST', headers: { Origin: APP_ORIGIN }, body: '{}' });
  assert.equal((await f.service.fetch(noJSON)).status, 415);
  for (const path of ['/passkey/options', '/passkey/verify', '/session/touch', '/session/logout']) {
    assert.equal((await f.call(path, { method: 'POST', body: {} })).status, 401);
  }
  assert.equal((await f.call('/auth/exchange', { method: 'POST', body: { ticket: 'x'.repeat(2048) } })).status, 413);
});
test('CORS permits only the exact app origin, method and allowed headers', async t => {
  const f = fixture(t);
  const good = await f.call('/vault', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(good.status, 204);
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), APP_ORIGIN);
  assert.equal(good.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal((await f.call('/vault', { method: 'OPTIONS', origin: 'https://evil.test', headers: { 'Access-Control-Request-Method': 'PUT' } })).status, 403);
  assert.equal((await f.call('/vault', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 405);
  assert.equal((await f.call('/vault', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'x-secret' } })).status, 403);
});

test('OAuth start uses PKCE S256, no repo scope, a host-only cookie and hashed state', async t => {
  const f = fixture(t);
  const start = await f.start();
  const url = new URL(start.response.headers.get('Location'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.searchParams.has('scope'), false);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const record = f.store.get('oauth', await digestToken(start.state), f.now());
  assert.equal(url.searchParams.get('code_challenge'), await digestToken(record.value.verifier));
  assert.equal(record.expiresAt, f.now() + TTL.oauth);
  const cookie = start.response.headers.get('Set-Cookie');
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=300']) assert.ok(cookie.includes(attribute));
  assert.equal(cookie.includes('Domain='), false);
  assert.equal(JSON.stringify(recordDump(f.store)).includes(start.state), false);
  assert.equal((await f.call('/auth/start', { headers: { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' } })).status, 403);
});
test('OAuth cookie mismatch does not consume state; successful callback is owner-only and one-use', async t => {
  const f = fixture(t);
  const start = await f.start();
  const mismatch = { ...start, cookie: `__Host-income_oauth=${f.random()}` };
  assert.equal((await f.callback(mismatch)).status, 401);
  const response = await f.callback(start, '&returnTo=https://evil.test');
  assert.equal(response.status, 302);
  assert.match(response.headers.get('Location'), /^https:\/\/hyper-jiawei\.github\.io\/income\/#ticket=[A-Za-z0-9_-]{43}$/u);
  assert.ok(response.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal((await f.callback(start)).status, 401);
  const identityRequest = f.calls.find(call => call.url === 'https://api.github.com/user');
  assert.equal(identityRequest.init.headers.Authorization, 'Bearer test_identity_token');
  assert.equal(identityRequest.init.redirect, 'manual');
  const exchangeRequest = f.calls.find(call => call.url === 'https://github.com/login/oauth/access_token');
  assert.equal(new URLSearchParams(exchangeRequest.init.body).get('code_verifier').length, 43);
  assert.equal(exchangeRequest.init.redirect, 'manual');
  const dump = JSON.stringify(recordDump(f.store));
  for (const secret of ['test_identity_token', ENV.GITHUB_CLIENT_SECRET, ENV.STORE_TOKEN]) assert.equal(dump.includes(secret), false);
});
for (const [name, target] of [['OAuth exchange', 'https://github.com/login/oauth/access_token'], ['GitHub identity', 'https://api.github.com/user'], ['private repository', ROOT]]) {
  test(`${name} rejects redirects without forwarding credentials`, async t => {
    for (const status of [301, 302, 303, 307, 308]) {
      const f = fixture(t, { fetcher: (url, init, fallback) => {
        assert.equal(init.redirect, 'manual');
        assert.doesNotThrow(() => new Request(url, init));
        return url === target ? new Response(null, { status, headers: { Location: 'https://unexpected.invalid' } }) : fallback(url, init);
      } });
      const response = target === ROOT
        ? await f.call('/vault', { token: await f.issue('session') })
        : await f.callback(await f.start());
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Service unavailable' });
      assert.equal(f.calls.at(-1).url, target);
      assert.equal(f.calls.some(call => call.url === 'https://unexpected.invalid'), false);
    }
  });
}
test('concurrent callback replay has only one winner before the external exchange', async t => {
  const f = fixture(t);
  const start = await f.start();
  const responses = await Promise.all([f.callback(start), f.callback(start)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [302, 401]);
  assert.equal(f.calls.filter(call => call.url === 'https://github.com/login/oauth/access_token').length, 1);
});
for (const id of [1, String(OWNER_ID), OWNER_ID + 1]) {
  test(`GitHub identity rejects incorrect or nonnumeric owner ${id}`, async t => {
    const f = fixture(t, { fetcher: (url, init, fallback) => url === 'https://api.github.com/user' ? reply({ id }) : fallback(url, init) });
    const start = await f.start();
    assert.equal((await f.callback(start)).status, 403);
    assert.equal((await f.callback(start)).status, 401);
    assert.equal(recordDump(f.store).length, 0);
  });
}
test('OAuth state is expired at exactly five minutes', async t => {
  const f = fixture(t);
  const start = await f.start();
  f.advance(TTL.oauth);
  assert.equal((await f.callback(start)).status, 401);
  assert.equal(f.calls.length, 0);
});
test('ticket is one-use under concurrent exchange, expires at exactly 30 seconds', async t => {
  const f = fixture(t);
  const ticket = await f.issue('ticket');
  f.advance(TTL.ticket - 1);
  const responses = await Promise.all([1, 2].map(() => f.call('/auth/exchange', { method: 'POST', body: { ticket } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
  const success = await responses.find(r => r.status === 200).json();
  assert.equal(success.mode, 'register');
  const second = await f.issue('ticket');
  f.advance(TTL.ticket);
  assert.equal((await f.call('/auth/exchange', { method: 'POST', body: { ticket: second } })).status, 401);
});
test('bootstrap is not a data/session credential and expires at exactly five minutes', async t => {
  const f = fixture(t);
  const token = await f.issue('bootstrap');
  for (const [path, method, body] of [['/vault', 'GET', undefined], ['/vault', 'PUT', { revision: null, box: BOX }], ['/session/touch', 'POST', { active: true }], ['/session/logout', 'POST', {}]]) {
    assert.equal((await f.call(path, { method, token, body })).status, 401);
  }
  assert.equal(f.calls.length, 0);
  f.advance(TTL.bootstrap);
  assert.equal((await f.call('/passkey/options', { method: 'POST', token, body: {} })).status, 401);
});
test('challenge is consumed once, including a failed UV verification', async t => {
  const f = fixture(t);
  const token = await f.issue('bootstrap');
  const options = await f.options(token);
  assert.equal((await f.verify(token, options, false)).status, 401);
  assert.equal((await f.verify(token, options)).status, 401);
  assert.equal(f.store.credential(), null);
});
test('challenge expires exactly at two minutes and mode substitution consumes it', async t => {
  const f = fixture(t);
  const token = await f.issue('bootstrap');
  const options = await f.options(token);
  f.advance(TTL.challenge);
  assert.equal((await f.verify(token, options)).status, 401);
  const replacement = await f.options(token);
  assert.equal((await f.verify(token, replacement, true, 'login')).status, 401);
  assert.equal((await f.verify(token, replacement)).status, 401);
});
test('new options replace the prior challenge; old assertion cannot enroll', async t => {
  const f = fixture(t);
  const token = await f.issue('bootstrap');
  const first = await f.options(token);
  await f.options(token);
  assert.equal((await f.verify(token, first)).status, 401);
  assert.equal(f.store.credential(), null);
});
test('registration stores one credential and salt, returns NEW bootstrap, not a data session', async t => {
  const f = fixture(t);
  const token = await f.issue('bootstrap');
  const options = await f.options(token);
  assert.equal(options.mode, 'register');
  assert.equal(options.options.extensions.prf.eval.first, options.salt);
  assert.equal(Buffer.from(options.salt, 'base64url').length, 32);
  const registrationOptions = f.calls.find(call => call.webauthnOptions).webauthnOptions;
  assert.equal(registrationOptions.attestationType, 'none');
  assert.deepEqual(registrationOptions.authenticatorSelection, { residentKey: 'required', userVerification: 'required' });
  const response = await f.verify(token, options);
  const registered = await response.json();
  assert.deepEqual(Object.keys(registered).sort(), ['mode', 'registered', 'token']);
  assert.equal(registered.registered, true);
  assert.equal(registered.mode, 'login');
  assert.notEqual(registered.token, token);
  assert.equal(f.store.credential().salt, options.salt);
  assert.equal(f.store.sql.exec('SELECT COUNT(*) AS count FROM auth_owner').one().count, 1);
  assert.equal((await f.call('/vault', { token: registered.token })).status, 401);
  assert.equal((await f.call('/passkey/options', { method: 'POST', token, body: {} })).status, 401);
  const loginOptions = await f.options(registered.token);
  assert.equal(loginOptions.mode, 'login');
  assert.equal(loginOptions.salt, options.salt);
  const authOptions = f.calls.filter(call => call.webauthnOptions).at(-1).webauthnOptions;
  assert.equal(authOptions.userVerification, 'required');
  assert.equal(authOptions.allowCredentials.length, 1);
  assert.equal(authOptions.allowCredentials[0].id, CREDENTIAL_ID);
  assert.equal(recordDump(f.store).some(row => row.kind === 'session'), false);
});
test('only authentication returns an opaque session; bootstrap/challenge cannot replay', async t => {
  const f = fixture(t);
  const session = await f.login();
  assert.equal(Buffer.from(session, 'base64url').length, 32);
  assert.equal(f.store.credential().credential.counter, 1);
  const rows = recordDump(f.store);
  assert.deepEqual(rows.map(row => row.kind), ['session']);
  assert.equal(JSON.stringify(rows).includes(session), false);
  assert.equal((await f.call('/vault', { token: session })).status, 200);
});
test('session is alive before but not at exact idle/absolute expiry', () => {
  const session = { createdAt: 0, activeAt: 0 };
  assert.equal(sessionAlive(session, TTL.idle - 1), true);
  assert.equal(sessionAlive(session, TTL.idle), false);
  assert.equal(sessionAlive({ createdAt: 0, activeAt: TTL.absolute - 1 }, TTL.absolute), false);
  assert.equal(sessionAlive(session, -1), false);
});
test('vault GET does not extend inactivity; exactly 600 seconds is unauthorized', async t => {
  const f = fixture(t);
  const token = await f.login();
  const key = await digestToken(token);
  const initial = f.store.get('session', key, f.now());
  f.advance(599_000);
  assert.equal((await f.call('/vault', { token })).status, 200);
  assert.deepEqual(f.store.get('session', key, f.now()), initial);
  f.advance(1000);
  assert.equal((await f.call('/vault', { token })).status, 401);
  assert.equal((await f.call('/session/touch', { method: 'POST', token, body: { active: true } })).status, 401);
});
test('only exact active:true touch extends idle expiry; absolute eight hours never moves', async t => {
  const f = fixture(t);
  const token = await f.issue('session');
  const key = await digestToken(token);
  const created = f.now();
  f.advance(599_999);
  for (const body of [{ active: false }, { active: 1 }, { active: true, amount: 42 }]) {
    assert.equal((await f.call('/session/touch', { method: 'POST', token, body })).status, 400);
  }
  assert.equal((await f.call('/session/touch', { method: 'POST', token, body: { active: true } })).status, 200);
  assert.equal(f.store.get('session', key, f.now()).value.activeAt, f.now());
  f.setTime(created + TTL.absolute - 1);
  f.store.put('session', key, { createdAt: created, activeAt: f.now() - 1000 }, created + TTL.absolute);
  assert.equal((await f.call('/session/touch', { method: 'POST', token, body: { active: true } })).status, 200);
  assert.equal(f.store.get('session', key, f.now()).expiresAt, created + TTL.absolute);
  f.advance(1);
  assert.equal((await f.call('/session/touch', { method: 'POST', token, body: { active: true } })).status, 401);
});
test('logout destroys the session immediately', async t => {
  const f = fixture(t);
  const token = await f.issue('session');
  assert.equal((await f.call('/session/logout', { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await f.call('/vault', { token })).status, 401);
  assert.equal((await f.call('/session/logout', { method: 'POST', token, body: {} })).status, 401);
});
test('expiry during a vault read withholds its response and never touches the session', async t => {
  let f;
  f = fixture(t, { fetcher: (url, init, fallback) => {
    if (url.includes('/contents/')) f.advance(TTL.idle);
    return fallback(url, init);
  } });
  const token = await f.issue('session');
  assert.equal((await f.call('/vault', { token })).status, 401);
});

for (const privacy of [false, undefined, 'true', null]) {
  test(`repository privacy ${privacy} fails closed before reading/writing ciphertext`, async t => {
    const f = fixture(t, { fetcher: (url, init, fallback) => url === ROOT ? reply({ private: privacy, full_name: 'hyper-jiawei/test-private-store' }) : fallback(url, init) });
    const token = await f.issue('session');
    for (const method of ['GET', 'PUT']) {
      assert.equal((await f.call('/vault', { method, token, ...(method === 'PUT' ? { body: { revision: null, box: BOX } } : {}) })).status, 503);
    }
    assert.deepEqual(f.calls.filter(call => call.url).map(call => call.url), [ROOT, ROOT]);
  });
}
for (const status of [404, 401, 403, 500]) {
  test(`repository API ${status} fails closed, does not become a missing vault`, async t => {
    const f = fixture(t, { fetcher: (url, init, fallback) => url === ROOT ? reply({ upstreamSecret: 'do-not-emit' }, status) : fallback(url, init) });
    const token = await f.issue('session');
    const response = await f.call('/vault', { token });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Service unavailable' });
    assert.equal(f.calls.filter(call => call.url).length, 1);
  });
}
test('private repo is checked on EVERY read and write, with no cached public fallback', async t => {
  let privateFlag = true;
  const f = fixture(t, { fetcher: (url, init, fallback) => url === ROOT ? reply({ private: privateFlag, full_name: 'hyper-jiawei/test-private-store' }) : fallback(url, init) });
  const token = await f.issue('session');
  assert.deepEqual(await (await f.call('/vault', { token })).json(), { revision: null, box: null });
  assert.equal((await f.call('/vault', { token })).status, 200);
  privateFlag = false;
  assert.equal((await f.call('/vault', { token })).status, 503);
  assert.equal((await f.call('/vault', { method: 'PUT', token, body: { revision: null, box: BOX } })).status, 503);
  assert.equal(f.calls.filter(call => call.url === ROOT).length, 4);
  assert.equal(f.calls.filter(call => call.url?.includes('/contents/')).length, 2);
});
test('vault reads an immutable SHA-bound ciphertext blob with only numeric envelope keys', async t => {
  const bytes = new TextEncoder().encode(JSON.stringify(BOX));
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const f = fixture(t, { fetcher: (url, init, fallback) => {
    if (url.includes('/contents/')) return reply({ type: 'file', path: '0.bin', sha, size: bytes.length });
    if (url.endsWith(`/git/blobs/${sha}`)) return reply({ sha, encoding: 'base64', size: bytes.length, content: base64(bytes) });
    return fallback(url, init);
  } });
  const token = await f.issue('session');
  const before = recordDump(f.store);
  assert.deepEqual(await (await f.call('/vault', { token })).json(), { revision: sha, box: BOX });
  assert.deepEqual(recordDump(f.store), before);
  assert.equal(f.calls.some(call => call.url?.endsWith(`/git/blobs/${sha}`)), true);
});
test('a blob SHA mismatch or plaintext envelope fails closed', async t => {
  for (const content of [JSON.stringify(BOX), JSON.stringify({ amount: 123 })]) {
    const bytes = new TextEncoder().encode(content);
    const sha = content.includes('amount') ? createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') : SHA;
    const f = fixture(t, { fetcher: (url, init, fallback) => {
      if (url.includes('/contents/')) return reply({ type: 'file', path: '0.bin', sha, size: bytes.length });
      if (url.includes('/git/blobs/')) return reply({ sha, encoding: 'base64', size: bytes.length, content: base64(bytes) });
      return fallback(url, init);
    } });
    assert.equal((await f.call('/vault', { token: await f.issue('session') })).status, 503);
  }
});
test('write uses fixed opaque path/message; financial body never enters DO storage or activity', async t => {
  const f = fixture(t, { fetcher: (url, init, fallback) => init.method === 'PUT' ? reply({ content: { sha: SHA } }, 201) : fallback(url, init) });
  const token = await f.issue('session');
  const before = recordDump(f.store);
  const response = await f.call('/vault', { method: 'PUT', token, body: { revision: null, box: BOX } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revision: SHA });
  const write = f.calls.find(call => call.init?.method === 'PUT');
  assert.equal(write.url, `${ROOT}/contents/0.bin`);
  assert.equal(write.init.headers.Authorization, `Bearer ${ENV.STORE_TOKEN}`);
  const body = JSON.parse(write.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['branch', 'content', 'message']);
  assert.equal(body.message, 'Update 0');
  assert.equal(body.branch, 'main');
  assert.deepEqual(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')), BOX);
  assert.deepEqual(recordDump(f.store), before);
  assert.equal(JSON.stringify(recordDump(f.store)).includes(BOX['2']), false);
});
test('optimistic SHA mismatch returns 409 before PUT; upstream conflict never retries', async t => {
  const f = fixture(t, { fetcher: (url, init, fallback) => {
    if (init.method === 'PUT') return reply({ secret: 'do-not-emit' }, 409);
    if (url.includes('/contents/')) return reply({ type: 'file', path: '0.bin', sha: SHA, size: 50 });
    return fallback(url, init);
  } });
  const token = await f.issue('session');
  assert.equal((await f.call('/vault', { method: 'PUT', token, body: { revision: null, box: BOX } })).status, 409);
  assert.equal(f.calls.filter(call => call.init?.method === 'PUT').length, 0);
  const response = await f.call('/vault', { method: 'PUT', token, body: { revision: SHA, box: BOX } });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Conflict' });
  assert.equal(f.calls.filter(call => call.init?.method === 'PUT').length, 1);
  assert.equal(JSON.parse(f.calls.find(call => call.init?.method === 'PUT').init.body).sha, SHA);
});
test('expired session during metadata lookup cannot initiate a write', async t => {
  let f;
  f = fixture(t, { fetcher: (url, init, fallback) => {
    if (url.includes('/contents/')) f.advance(TTL.idle);
    return fallback(url, init);
  } });
  const token = await f.issue('session');
  assert.equal((await f.call('/vault', { method: 'PUT', token, body: { revision: null, box: BOX } })).status, 401);
  assert.equal(f.calls.filter(call => call.init?.method === 'PUT').length, 0);
});

const invalidBoxes = [
  {}, { ...BOX, amount: 123 }, { ...BOX, '0': '1' }, { ...BOX, '0': 2 },
  { ...BOX, '1': base64url(new Uint8Array(11)) }, { ...BOX, '1': `${BOX['1']}=` },
  { ...BOX, '2': base64url(new Uint8Array(15)) }, { ...BOX, '2': 'plaintext with spaces' },
  { ...BOX, '2': { amount: 123 } }, { '0': 1, '1': BOX['1'], '2': BOX['2'], '\u91d1\u989d': 5 },
];
for (const [index, box] of invalidBoxes.entries()) {
  test(`numeric ciphertext envelope rejects invalid box ${index}`, () => {
    assert.throws(() => validateBox(box), error => error instanceof HttpError && error.status === 400);
  });
}
test('box and revision limits reject oversized ciphertext, plaintext and extra fields', () => {
  assert.deepEqual(validateBox(BOX), BOX);
  assert.throws(() => validateBox({ ...BOX, '2': base64url(new Uint8Array(MAX_CIPHERTEXT_BYTES + 1)) }), HttpError);
  assert.throws(() => validateVaultWrite({ revision: null, box: BOX, month: '2026-11' }), HttpError);
  assert.throws(() => validateVaultWrite({ revision: 'bad', box: BOX }), HttpError);
  assert.ok(MAX_VAULT_BODY_BYTES > MAX_CIPHERTEXT_BYTES);
});
test('stream/body limits do not depend on Content-Length, errors contain no internal secrets', async () => {
  const source = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); controller.close(); } }));
  await assert.rejects(readBytes(source, 5), error => error.status === 413);
  const declared = new Response('small', { headers: { 'Content-Length': '9999999' } });
  await assert.rejects(readBytes(declared, 5), error => error.status === 413);
  assert.deepEqual(await errorResponse(new Error('test_identity_token financial secret')).json(), { error: 'Service unavailable' });
});
test('SQLite one-use take is atomic, enrollment is single, expiry cleanup is bounded', t => {
  const store = new AuthStore(sqliteStorage(t));
  store.put('ticket', 'key', {}, 100);
  assert.ok(store.take('ticket', 'key', 99));
  assert.equal(store.take('ticket', 'key', 99), null);
  store.put('ticket', 'exact', {}, 100);
  assert.equal(store.take('ticket', 'exact', 100), null);
  assert.equal(store.enroll({ id: 'one', publicKey: 'test', counter: 0, transports: [] }, 'salt'), true);
  assert.equal(store.enroll({ id: 'two' }, 'different'), false);
  for (let i = 0; i < 200; i++) store.put('challenge', String(i), {}, 100);
  store.put('session', 'live', { createdAt: 101, activeAt: 101 }, 200);
  store.purge(100);
  assert.equal(recordDump(store).length, 73);
  store.purge(100);
  assert.deepEqual(recordDump(store).map(row => row.key), ['live']);
  assert.equal(store.nextExpiry(), 200);
  assert.throws(() => store.put('vault', 'anything', BOX, 200), HttpError);
});
test('OAuth deadline is rechecked after upstream exchange', async t => {
  let f;
  f = fixture(t, { fetcher: (url, init, fallback) => {
    if (url === 'https://api.github.com/user') f.advance(TTL.oauth);
    return fallback(url, init);
  } });
  const start = await f.start();
  assert.equal((await f.callback(start)).status, 401);
  assert.equal(recordDump(f.store).length, 0);
});
test('challenge deadline is enforced even if verifier returns success after expiry', async t => {
  let f;
  f = fixture(t, { webauthn: { verifyRegistrationResponse: async () => {
    f.advance(TTL.challenge);
    return { verified: true, registrationInfo: {
      userVerified: true, credentialDeviceType: 'multiDevice', credentialBackedUp: true,
      credential: { id: CREDENTIAL_ID, publicKey: new Uint8Array(65), counter: 0 },
    } };
  } } });
  const token = await f.issue('bootstrap');
  assert.equal((await f.verify(token, await f.options(token))).status, 401);
  assert.equal(f.store.credential(), null);
});
for (const flags of [{ userVerified: false }, { credentialDeviceType: 'singleDevice' }, { credentialBackedUp: false }]) {
  test(`registration rejects missing UV or unsynced passkey flags ${JSON.stringify(flags)}`, async t => {
    const f = fixture(t, { webauthn: { verifyRegistrationResponse: async () => ({
      verified: true, registrationInfo: {
        userVerified: true, credentialDeviceType: 'multiDevice', credentialBackedUp: true, ...flags,
        credential: { id: CREDENTIAL_ID, publicKey: new Uint8Array(65), counter: 0 },
      },
    }) } });
    const token = await f.issue('bootstrap');
    assert.equal((await f.verify(token, await f.options(token))).status, 401);
    assert.equal(f.store.credential(), null);
  });
}
test('authentication success without UV never yields a data session', async t => {
  const f = fixture(t, { webauthn: { verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { userVerified: false, newCounter: 1 } }) } });
  const token = await f.issue('bootstrap');
  const registered = await (await f.verify(token, await f.options(token))).json();
  assert.equal((await f.verify(registered.token, await f.options(registered.token))).status, 401);
  assert.equal(recordDump(f.store).some(row => row.kind === 'session'), false);
  assert.equal(f.store.credential().credential.counter, 0);
});
test('auth storage admission is bounded rather than unbounded OAuth-state accumulation', t => {
  const store = new AuthStore(sqliteStorage(t));
  for (let i = 0; i < MAX_RECORDS; i++) store.put('oauth', String(i), {}, 100);
  assert.throws(() => store.put('oauth', 'overflow', {}, 100), error => error.status === 429);
  store.put('oauth', '0', { verifier: 'replacement' }, 101);
  assert.equal(recordDump(store).length, MAX_RECORDS);
});

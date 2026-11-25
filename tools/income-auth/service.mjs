import {
  APP_ORIGIN, bearer, configuration, cookieBinding, decorate, digestToken, exactKeys, fail,
  isObject, json, MAX_AUTH_BODY_BYTES, MAX_VAULT_BODY_BYTES, mutationHeaders, randomToken,
  oauthCookie, OWNER_ID, readJSON, sessionAlive, sessionExpiry, TTL, unbase64url,
  validOpaqueToken, validateVaultWrite, base64url, errorResponse,
} from './core.mjs';
import { GithubVault, verifyGithubOwner } from './github.mjs';

const ROUTES = Object.freeze({
  '/health': 'GET', '/auth/start': 'GET', '/auth/callback': 'GET',
  '/auth/exchange': 'POST', '/passkey/options': 'POST', '/passkey/verify': 'POST',
  '/session/touch': 'POST', '/session/logout': 'POST', '/vault': 'GET,PUT',
});
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

export class AuthService {
  constructor(env, store, webauthn, { now = Date.now, random = randomToken, fetcher = fetch } = {}) {
    this.env = env;
    this.config = configuration(env);
    this.store = store;
    this.webauthn = webauthn;
    this.now = now;
    this.random = random;
    this.fetcher = fetcher;
  }
  async fetch(request) {
    let response;
    try { response = await this.route(request); } catch (error) { response = errorResponse(error); }
    return decorate(response, request);
  }
  preflight(request, methods) {
    if (request.headers.get('Origin') !== APP_ORIGIN) fail(403);
    if (!methods.includes(request.headers.get('Access-Control-Request-Method'))) fail(405);
    const requested = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase();
    if (requested.length > 256 || requested.split(',').map(value => value.trim()).some(value => value && !['authorization', 'content-type'].includes(value))) fail(403);
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Methods': methods.join(', '),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '300',
      'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    } });
  }
  async route(request) {
    const url = new URL(request.url);
    if (url.search.length > 4096) fail(400);
    const methods = ROUTES[url.pathname]?.split(',');
    if (!methods) fail(404);
    if (request.method === 'OPTIONS') return this.preflight(request, methods);
    if (!methods.includes(request.method)) fail(405);
    if (request.method === 'GET' && request.body) fail(400);
    if (url.pathname === '/health') return json({ ready: this.config !== null });
    if (!this.config) fail(503);
    if (request.method === 'POST' || request.method === 'PUT') mutationHeaders(request);
    if (url.pathname === '/auth/start') return this.start(request, url);
    if (url.pathname === '/auth/callback') return this.callback(request, url);
    if (url.search) fail(400);
    if (url.pathname === '/auth/exchange') {
      const body = await readJSON(request, 1024);
      if (!exactKeys(body, ['ticket']) || !validOpaqueToken(body.ticket)) fail(400);
      const key = await digestToken(body.ticket);
      if (!this.store.take('ticket', key, this.now())) fail(401);
      const token = await this.issue('bootstrap');
      return json({ token, mode: this.store.credential() ? 'login' : 'register' });
    }
    const key = await digestToken(bearer(request));
    if (url.pathname.startsWith('/passkey/')) {
      this.requireBootstrap(key);
      const body = await readJSON(request, url.pathname === '/passkey/verify' ? MAX_AUTH_BODY_BYTES : 1024);
      if (url.pathname === '/passkey/options') return this.options(key, body);
      return this.verify(key, body);
    }
    // No other unauthenticated POST exists; bootstrap credentials never authorize vault access.
    this.requireSession(key);
    if (request.headers.has('Origin') && request.headers.get('Origin') !== APP_ORIGIN) fail(403);
    if (url.pathname === '/vault') {
      const vault = new GithubVault(this.env, this.fetcher);
      if (request.method === 'GET') {
        const result = await vault.read();
        this.requireSession(key); // Reads never update activity; expiry includes network time.
        return json(result);
      }
      const body = validateVaultWrite(await readJSON(request, MAX_VAULT_BODY_BYTES));
      this.requireSession(key);
      const result = await vault.write(body, () => this.requireSession(key));
      this.requireSession(key);
      return json(result);
    }
    const body = await readJSON(request, 1024);
    const session = this.requireSession(key);
    if (url.pathname === '/session/logout') {
      if (!exactKeys(body, [])) fail(400);
      this.store.remove('session', key);
      return json({ ok: true });
    }
    if (!exactKeys(body, ['active']) || body.active !== true) fail(400);
    // The frontend must send only for visible human activity. This flag does NOT prove activity.
    const next = { createdAt: session.value.createdAt, activeAt: this.now() };
    this.store.put('session', key, next, sessionExpiry(next));
    return json({ ok: true });
  }
  requireBootstrap(key) {
    const record = this.store.get('bootstrap', key, this.now());
    if (!record) fail(401);
    return record;
  }
  requireSession(key) {
    const record = this.store.get('session', key, this.now());
    if (!record || !sessionAlive(record.value, this.now())) {
      this.store.remove('session', key);
      fail(401);
    }
    return record;
  }
  async issue(kind) {
    const token = this.random();
    const key = await digestToken(token);
    const now = this.now();
    const value = kind === 'session' ? { createdAt: now, activeAt: now } : {};
    const expiresAt = kind === 'session' ? sessionExpiry(value) : now + TTL[kind];
    this.store.put(kind, key, value, expiresAt);
    return token;
  }
  navigation(request) {
    const mode = request.headers.get('Sec-Fetch-Mode');
    const dest = request.headers.get('Sec-Fetch-Dest');
    if ((mode && mode !== 'navigate') || (dest && dest !== 'document')) fail(403);
  }
  async start(request, url) {
    this.navigation(request);
    if (url.search) fail(400);
    const state = this.random();
    const binding = this.random();
    const verifier = this.random();
    const stateKey = await digestToken(state);
    const bindingKey = await digestToken(binding);
    const challenge = await digestToken(verifier);
    this.store.put('oauth', stateKey, {
      bindingKey, verifier, redirectUri: `${url.origin}/auth/callback`,
    }, this.now() + TTL.oauth);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: this.config.GITHUB_CLIENT_ID,
      redirect_uri: `${url.origin}/auth/callback`,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // No scope parameter: this service requests identity, never repository OAuth scope.
    }).toString();
    return new Response(null, { status: 302, headers: { Location: authorize.href, 'Set-Cookie': oauthCookie(binding) } });
  }
  async callback(request, url) {
    this.navigation(request);
    if (url.searchParams.has('error')) fail(401);
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1) fail(400);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!validOpaqueToken(state) || typeof code !== 'string' || code.length < 1 || code.length > 1024 || /[\u0000-\u0020\u007f]/u.test(code)) fail(400);
    const bindingKey = await digestToken(cookieBinding(request));
    const stateKey = await digestToken(state);
    const record = this.store.take('oauth', stateKey, this.now(), value => value.bindingKey === bindingKey && value.redirectUri === `${url.origin}/auth/callback`);
    if (!record) fail(401);
    // Consume before any external await. An exchange failure cannot replay an OAuth state.
    await verifyGithubOwner(this.config, record.value, code, this.fetcher);
    if (this.now() >= record.expiresAt) fail(401);
    const ticket = await this.issue('ticket');
    return new Response(null, { status: 302, headers: { Location: `${this.config.APP_ORIGIN}/income/#ticket=${ticket}` } });
  }
  async options(key, body) {
    if (!exactKeys(body, [])) fail(400);
    const enrolled = this.store.credential();
    const mode = enrolled ? 'login' : 'register';
    const salt = enrolled ? enrolled.salt : this.random();
    let options;
    if (!enrolled) {
      options = await this.webauthn.generateRegistrationOptions({
        rpName: 'Income', rpID: this.config.RP_ID,
        userID: new TextEncoder().encode(String(OWNER_ID)), userName: 'Owner', userDisplayName: 'Owner',
        attestationType: 'none', timeout: TTL.challenge,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: [],
      });
    } else {
      options = await this.webauthn.generateAuthenticationOptions({
        rpID: this.config.RP_ID, timeout: TTL.challenge, userVerification: 'required',
        allowCredentials: [{ id: enrolled.credential.id, transports: enrolled.credential.transports }],
      });
    }
    if (!isObject(options) || typeof options.challenge !== 'string' || options.challenge.length > 512) fail(503);
    // JSON wire encoding; the browser must decode first to bytes before navigator.credentials.
    // PRF outputs/AES keys are never received intentionally or stored by this service.
    options.extensions = { ...(options.extensions || {}), prf: { eval: { first: salt } } };
    const bootstrap = this.requireBootstrap(key);
    this.store.put('challenge', key, { challenge: options.challenge, salt, mode }, Math.min(bootstrap.expiresAt, this.now() + TTL.challenge));
    return json({ options, salt, mode });
  }
  async verify(key, body) {
    if (!exactKeys(body, ['credential', 'mode']) || !['register', 'login'].includes(body.mode) || !isObject(body.credential) || body.credential.type !== 'public-key' || typeof body.credential.id !== 'string') fail(400);
    unbase64url(body.credential.id, 1, 1024);
    this.requireBootstrap(key);
    const record = this.store.take('challenge', key, this.now());
    if (!record || record.value.mode !== body.mode) fail(401);
    const enrolled = this.store.credential();
    if ((body.mode === 'register' && enrolled) || (body.mode === 'login' && (!enrolled || enrolled.credential.id !== body.credential.id))) fail(401);
    const expected = {
      response: body.credential,
      expectedChallenge: record.value.challenge,
      expectedOrigin: this.config.APP_ORIGIN,
      expectedRPID: this.config.RP_ID,
      requireUserVerification: true,
    };
    let result;
    try {
      result = body.mode === 'register'
        ? await this.webauthn.verifyRegistrationResponse(expected)
        : await this.webauthn.verifyAuthenticationResponse({ ...expected, credential: {
          ...enrolled.credential, publicKey: unbase64url(enrolled.credential.publicKey, 32, 8192),
        } });
    } catch { fail(401); }
    this.requireBootstrap(key); // Five-minute bootstrap deadline is also enforced after verification.
    if (this.now() >= record.expiresAt || result?.verified !== true) fail(401);
    if (body.mode === 'register') {
      const info = result.registrationInfo;
      const credential = info?.credential;
      if (info?.userVerified !== true || info.credentialDeviceType !== 'multiDevice' || info.credentialBackedUp !== true || !credential || credential.id !== body.credential.id || !(credential.publicKey instanceof Uint8Array) || credential.publicKey.length < 32 || credential.publicKey.length > 8192 || !Number.isInteger(credential.counter) || credential.counter < 0 || credential.counter > 0xffffffff) fail(401);
      // Backup flags require a backup-eligible/backed-up passkey, not proof of a provider's sync.
      const stored = {
        id: credential.id, publicKey: base64url(credential.publicKey), counter: credential.counter,
        transports: Array.isArray(credential.transports) ? [...new Set(credential.transports.filter(value => TRANSPORTS.has(value)))].slice(0, 8) : [],
      };
      if (!this.store.enroll(stored, record.value.salt)) fail(409);
      this.store.remove('bootstrap', key);
      return json({ token: await this.issue('bootstrap'), mode: 'login', registered: true });
    }
    const info = result.authenticationInfo;
    if (info?.userVerified !== true || !Number.isInteger(info.newCounter) || info.newCounter < 0 || info.newCounter > 0xffffffff) fail(401);
    this.store.updateCounter(enrolled.credential.id, info.newCounter);
    this.store.remove('bootstrap', key);
    return json({ token: await this.issue('session') });
  }
}

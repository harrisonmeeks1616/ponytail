// Cloudflare Access JWT verification and route authorisation for the spike.
// Plain ES module. Runs in Node 22 and Cloudflare Workers (WebCrypto only).
// Never logs or stores tokens or emails.

export const JWKS_TTL_MS = 10 * 60 * 1000;
// Minimum gap between forced (unknown-kid) refetches, so a stream of tokens
// with random kids can't turn every request into a subrequest to the certs URL.
export const JWKS_FORCED_REFETCH_MIN_MS = 30 * 1000;
export const CLOCK_SKEW_MS = 60 * 1000;
const MAX_ASSERTION_LENGTH = 16 * 1024;
const RSA_ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

export class AuthError extends Error {
  // status: HTTP status; code: public error code; reason: short internal tag
  // (never contains token material or identity).
  constructor(status, code, reason = code) {
    super(`auth failed: ${code}`);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// JWKS cache (module memory, keyed by certs URL)

let jwksCache = new Map(); // certsUrl -> { fetchedAtMs, lastForcedMs, jwks: Map<kid, jwk>, keys: Map<kid, CryptoKey>, inflight }

export function _resetJwksCache() {
  jwksCache = new Map();
}

function cacheEntry(certsUrl) {
  let entry = jwksCache.get(certsUrl);
  if (!entry) {
    entry = { fetchedAtMs: -Infinity, lastForcedMs: -Infinity, jwks: new Map(), keys: new Map(), inflight: null };
    jwksCache.set(certsUrl, entry);
  }
  return entry;
}

// Each request fetches the keys itself when the cache is cold, with a hard timeout.
// Never share an in-flight fetch promise between requests: on Workers, I/O started by one
// request can't be awaited by another, and if the starting request is cancelled the shared
// promise may never settle, which hung every later signed-in request (live, 2026-10-30).
// Only the parsed result (plain data) is cached across requests.
const JWKS_FETCH_TIMEOUT_MS = 5000;

async function fetchJwks(certsUrl, entry, fetchImpl, nowMs) {
  {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new AuthError(503, 'jwks_unavailable', 'jwks_timeout'));
      }, JWKS_FETCH_TIMEOUT_MS);
    });
    let res;
    let body;
    try {
      try {
        res = await Promise.race([
          fetchImpl(certsUrl, { method: 'GET', headers: { accept: 'application/json' }, signal: controller ? controller.signal : undefined }),
          timeout,
        ]);
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError(503, 'jwks_unavailable', 'jwks_fetch_error');
      }
      if (!res || !res.ok) throw new AuthError(503, 'jwks_unavailable', 'jwks_http_status');
      try {
        body = await Promise.race([res.json(), timeout]);
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError(503, 'jwks_unavailable', 'jwks_bad_json');
      }
    } finally {
      clearTimeout(timer);
    }
    const jwks = new Map();
    if (body && Array.isArray(body.keys)) {
      for (const k of body.keys) {
        if (k && k.kty === 'RSA' && typeof k.kid === 'string' && typeof k.n === 'string' && typeof k.e === 'string') {
          jwks.set(k.kid, { kty: 'RSA', n: k.n, e: k.e });
        }
      }
    }
    if (jwks.size === 0) throw new AuthError(503, 'jwks_unavailable', 'jwks_empty');
    entry.jwks = jwks;
    entry.keys = new Map();
    entry.fetchedAtMs = nowMs;
  }
}

async function getVerifyKey(certsUrl, kid, fetchImpl, nowMs) {
  const entry = cacheEntry(certsUrl);
  let refetched = false;
  if (!(nowMs - entry.fetchedAtMs < JWKS_TTL_MS)) {
    await fetchJwks(certsUrl, entry, fetchImpl, nowMs);
    refetched = true;
  }
  if (!entry.jwks.has(kid) && !refetched && nowMs - entry.lastForcedMs >= JWKS_FORCED_REFETCH_MIN_MS) {
    entry.lastForcedMs = nowMs;
    await fetchJwks(certsUrl, entry, fetchImpl, nowMs);
  }
  const jwk = entry.jwks.get(kid);
  if (!jwk) throw new AuthError(401, 'invalid', 'unknown_kid');
  let key = entry.keys.get(kid);
  if (!key) {
    try {
      key = await globalThis.crypto.subtle.importKey('jwk', jwk, RSA_ALG, false, ['verify']);
    } catch {
      throw new AuthError(401, 'invalid', 'bad_jwk');
    }
    entry.keys.set(kid, key);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Helpers

function b64urlToBytes(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new AuthError(401, 'invalid', 'malformed');
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw new AuthError(401, 'invalid', 'malformed');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJsonSegment(seg) {
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
    return obj;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError(401, 'invalid', 'malformed');
  }
}

// Returns the normalised team origin (e.g. https://team.cloudflareaccess.com) or null.
export function normaliseTeamDomain(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim().replace(/\/+$/, '');
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  let url;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

function isLoopbackHost(request) {
  let host;
  try {
    host = new URL(request.url).hostname;
  } catch {
    return false;
  }
  return host === '127.0.0.1' || host === 'localhost';
}

function getHeader(request, name) {
  const h = request && request.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  return h[name] ?? h[name.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Public API

export async function authenticate(request, env = {}, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  // 1. Local development bypass, loopback only.
  if (env.DEV_ALLOW_UNAUTH === '1') {
    if (isLoopbackHost(request)) return { kind: 'dev' };
    throw new AuthError(503, 'misconfigured', 'dev_flag_on_non_loopback');
  }

  // 2. Fail closed when Access isn't configured.
  const team = normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN);
  // Two Access applications, two audiences: the owner's (whole Worker) and the
  // Shortcut's (path app with a Service Auth policy). Each identity kind is only
  // accepted with its own audience.
  const ownerAud = typeof env.ACCESS_AUD === 'string' ? env.ACCESS_AUD.trim() : '';
  const shortcutAud = typeof env.ACCESS_AUD_SHORTCUT === 'string' ? env.ACCESS_AUD_SHORTCUT.trim() : '';
  if (!team || !ownerAud) throw new AuthError(503, 'not_configured');

  // 3. The assertion header.
  const token = getHeader(request, 'Cf-Access-Jwt-Assertion');
  if (!token) throw new AuthError(401, 'missing_assertion');
  if (token.length > MAX_ASSERTION_LENGTH) throw new AuthError(401, 'invalid', 'too_long');

  // 4. Signature (RS256, key by kid).
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError(401, 'invalid', 'malformed');
  const [h64, p64, s64] = parts;
  const header = parseJsonSegment(h64);
  if (header.alg !== 'RS256') throw new AuthError(401, 'invalid', 'bad_alg');
  if (typeof header.kid !== 'string' || !header.kid) throw new AuthError(401, 'invalid', 'missing_kid');
  const payload = parseJsonSegment(p64);
  const signature = b64urlToBytes(s64);

  const key = await getVerifyKey(`${team}/cdn-cgi/access/certs`, header.kid, fetchImpl, nowMs);
  let valid = false;
  try {
    valid = await globalThis.crypto.subtle.verify(RSA_ALG, key, signature, new TextEncoder().encode(`${h64}.${p64}`));
  } catch {
    valid = false;
  }
  if (!valid) throw new AuthError(401, 'invalid', 'bad_signature');

  // 5. Claims.
  if (payload.iss !== team) throw new AuthError(401, 'invalid', 'bad_iss');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const hasOwnerAud = auds.some((a) => typeof a === 'string' && a === ownerAud);
  const hasShortcutAud = !!shortcutAud && auds.some((a) => typeof a === 'string' && a === shortcutAud);
  if (!hasOwnerAud && !hasShortcutAud) throw new AuthError(401, 'invalid', 'bad_aud');
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) throw new AuthError(401, 'invalid', 'missing_exp');
  const expMs = payload.exp * 1000;
  if (!(expMs > nowMs)) throw new AuthError(401, 'expired');
  for (const claim of ['nbf', 'iat']) {
    const v = payload[claim];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new AuthError(401, 'invalid', `bad_${claim}`);
    if (v * 1000 > nowMs + CLOCK_SKEW_MS) throw new AuthError(401, 'invalid', `${claim}_in_future`);
  }

  // 6. Identity.
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (email) {
    // A person is only ever the owner, and only through the owner's application.
    if (!hasOwnerAud) throw new AuthError(401, 'invalid', 'owner_wrong_aud');
    const owner = typeof env.OWNER_EMAIL === 'string' ? env.OWNER_EMAIL.trim() : '';
    if (owner && owner.toLowerCase() !== email.toLowerCase()) throw new AuthError(403, 'not_owner');
    return { kind: 'owner', email, emailMasked: maskEmail(email), expMs };
  }
  const commonName = typeof payload.common_name === 'string' ? payload.common_name.trim() : '';
  if (commonName) {
    // A service token is only accepted through the Shortcut's application.
    if (!hasShortcutAud) throw new AuthError(401, 'invalid', 'service_wrong_aud');
    return { kind: 'service', commonName, expMs };
  }
  throw new AuthError(401, 'invalid', 'no_identity');
}

export function authorizeRoute(identity, method, pathname) {
  if (!identity || typeof pathname !== 'string') return false;
  const m = typeof method === 'string' ? method.toUpperCase() : '';
  if (identity.kind === 'service') return m === 'POST' && pathname === '/api/shortcut/capture';
  if (identity.kind === 'owner' || identity.kind === 'dev') return pathname === '/api' || pathname.startsWith('/api/');
  return false;
}

export function maskEmail(email) {
  if (typeof email !== 'string') return '***';
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local ? local[0] : ''}***@${domain}`;
}

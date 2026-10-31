// Web Push for the Harrison OS spike.
// VAPID (RFC 8292) ES256 JWTs and aes128gcm payload encryption (RFC 8291 / RFC 8188).
// WebCrypto only (globalThis.crypto.subtle): runs unchanged in Node 22 and Cloudflare Workers.
// Nothing in this module logs. Callers must never log JWTs, push keys or payload text.

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto (crypto.subtle) is not available');
  return s;
};

const enc = new TextEncoder();

const RECORD_SIZE = 4096;
const HEADER_LEN = 16 + 4 + 1 + 65; // salt, rs, idlen, keyid
const TAG_LEN = 16;
// The push service only has to accept 4096 octets of body (RFC 8030 section 7.2; Apple: 4 KB).
const MAX_BODY = 4096;
export const MAX_PLAINTEXT_BYTES = MAX_BODY - HEADER_LEN - TAG_LEN - 1; // 3993

const MAX_VAPID_TTL_SECONDS = 86400;
const JWT_REFRESH_MARGIN_MS = 3600 * 1000;
const URGENCIES = new Set(['very-low', 'low', 'normal', 'high']);

const ALLOWED_PUSH_HOST_SUFFIXES = [
  'push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
];

// ---------------------------------------------------------------- base64url

export function b64urlEncode(bytes) {
  const u8 = toBytes(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  if (typeof str !== 'string') throw new TypeError('b64urlDecode expects a string');
  const s = str.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) {
    throw new TypeError('invalid base64url input');
  }
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new TypeError('expected bytes (Uint8Array, ArrayBuffer or view)');
}

function bytesOrB64(v, what) {
  if (typeof v === 'string') return b64urlDecode(v);
  try {
    return toBytes(v);
  } catch {
    throw new TypeError(`${what} must be base64url or bytes`);
  }
}

function concat(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function jsonB64(obj) {
  return b64urlEncode(enc.encode(JSON.stringify(obj)));
}

// ---------------------------------------------------------------- VAPID (RFC 8292)

function cleanEcJwk(jwk, { requirePrivate }) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new TypeError('expected a P-256 EC JWK');
  }
  if (requirePrivate && typeof jwk.d !== 'string') throw new TypeError('JWK has no private part (d)');
  const out = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  if (jwk.d) out.d = jwk.d;
  return out;
}

function rawPublicFromJwk(jwk) {
  return concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y));
}

export async function generateVapidKeys() {
  const kp = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  const jwk = await subtle().exportKey('jwk', kp.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk: cleanEcJwk(jwk, { requirePrivate: true }) };
}

function assertOrigin(audience) {
  let u;
  try {
    u = new URL(audience);
  } catch {
    throw new TypeError('VAPID audience must be an origin URL');
  }
  if (u.origin !== audience) throw new TypeError('VAPID audience must be exactly an origin (scheme://host[:port])');
}

export async function createVapidJwt({ audience, subject, privateJwk, nowMs = Date.now(), ttlSeconds = 12 * 3600 }) {
  assertOrigin(audience);
  // Contract: sub is the Worker's own https:// origin, never an email address.
  if (typeof subject !== 'string' || !subject.startsWith('https://')) {
    throw new TypeError('VAPID subject must be an https:// URL');
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_VAPID_TTL_SECONDS) {
    throw new RangeError('VAPID ttlSeconds must be an integer in 1..86400');
  }
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be a finite number');
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const key = await subtle().importKey(
    'jwk',
    cleanEcJwk(privateJwk, { requirePrivate: true }),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signingInput = `${jsonB64({ typ: 'JWT', alg: 'ES256' })}.${jsonB64({ aud: audience, exp, sub: subject })}`;
  // WebCrypto ECDSA returns IEEE P1363 r||s (64 bytes), which is exactly what JWS ES256 wants.
  const sig = new Uint8Array(
    await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)),
  );
  if (sig.length !== 64) throw new Error('unexpected ECDSA signature length');
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export function vapidAuthorization({ jwt, publicKey }) {
  if (typeof jwt !== 'string' || typeof publicKey !== 'string') throw new TypeError('jwt and publicKey must be strings');
  return `vapid t=${jwt}, k=${publicKey}`;
}

function jwtExpMs(jwt) {
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split('.')[1])));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** In-memory jwtCache with the contract's get/put shape. The Worker uses its D1 kv table instead. */
export function createMemoryJwtCache() {
  const m = new Map();
  return {
    get(audience) {
      return m.get(audience) || null;
    },
    put(audience, jwt, expMs) {
      m.set(audience, { jwt, expMs });
    },
  };
}

// get() may return null, a JWT string, or { jwt, expMs }; it may be sync or async.
async function cachedJwt(jwtCache, audience, nowMs) {
  if (!jwtCache) return null;
  const hit = await jwtCache.get(audience);
  if (!hit) return null;
  const jwt = typeof hit === 'string' ? hit : hit.jwt;
  if (typeof jwt !== 'string') return null;
  const expMs = typeof hit === 'object' && Number.isFinite(hit.expMs) ? hit.expMs : jwtExpMs(jwt);
  if (!Number.isFinite(expMs)) return null;
  return expMs - JWT_REFRESH_MARGIN_MS > nowMs ? jwt : null;
}

// ---------------------------------------------------------------- aes128gcm (RFC 8291)

async function hkdf(salt, ikm, info, lengthBytes) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, lengthBytes * 8),
  );
}

async function importSenderKeyPair(senderKeyPair) {
  if (senderKeyPair && typeof CryptoKey !== 'undefined' && senderKeyPair.privateKey instanceof CryptoKey) {
    const publicRaw = new Uint8Array(await subtle().exportKey('raw', senderKeyPair.publicKey));
    return { privateKey: senderKeyPair.privateKey, publicRaw };
  }
  // { publicKey: 65-byte uncompressed point, privateKey: 32-byte scalar d }, each b64url or bytes.
  const publicRaw = bytesOrB64(senderKeyPair.publicKey, 'senderKeyPair.publicKey');
  const d = bytesOrB64(senderKeyPair.privateKey, 'senderKeyPair.privateKey');
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new TypeError('sender public key must be 65-byte uncompressed P-256');
  if (d.length !== 32) throw new TypeError('sender private key must be 32 bytes');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(publicRaw.subarray(1, 33)),
    y: b64urlEncode(publicRaw.subarray(33, 65)),
    d: b64urlEncode(d),
  };
  const privateKey = await subtle().importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { privateKey, publicRaw };
}

export async function encryptPayload({ p256dh, auth, plaintext, salt, senderKeyPair }) {
  const uaPublic = bytesOrB64(p256dh, 'p256dh');
  const authSecret = bytesOrB64(auth, 'auth');
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new TypeError('p256dh must be a 65-byte uncompressed P-256 point');
  if (authSecret.length !== 16) throw new TypeError('auth must be 16 bytes');

  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : toBytes(plaintext);
  if (data.length > MAX_PLAINTEXT_BYTES) {
    throw new RangeError(`payload too large: ${data.length} bytes > ${MAX_PLAINTEXT_BYTES}`);
  }

  const saltBytes = salt === undefined ? globalThis.crypto.getRandomValues(new Uint8Array(16)) : bytesOrB64(salt, 'salt');
  if (saltBytes.length !== 16) throw new TypeError('salt must be 16 bytes');

  let sender;
  if (senderKeyPair) {
    sender = await importSenderKeyPair(senderKeyPair);
  } else {
    const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    sender = { privateKey: kp.privateKey, publicRaw: new Uint8Array(await subtle().exportKey('raw', kp.publicKey)) };
  }

  // Importing the UA key validates that it is a point on P-256.
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));

  // RFC 8291 section 3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, sender.publicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 section 2.2 / 2.3
  const cek = await hkdf(saltBytes, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(saltBytes, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Single (last) record: plaintext || 0x02, no padding. Sequence number 0, so the nonce is used as-is.
  const record = concat(data, new Uint8Array([2]));
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));

  const header = new Uint8Array(HEADER_LEN);
  header.set(saltBytes, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = 65;
  header.set(sender.publicRaw, 21);
  return concat(header, sealed);
}

// ---------------------------------------------------------------- endpoint allowlist (SSRF guard)

export function isAllowedPushEndpoint(urlString, { allowTestEndpoints = false } = {}) {
  if (typeof urlString !== 'string' || urlString.length > 2048) return false;
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'https:') {
    if (u.port !== '' && u.port !== '443') return false;
    return ALLOWED_PUSH_HOST_SUFFIXES.some((base) => host === base || host.endsWith('.' + base));
  }
  if (allowTestEndpoints && u.protocol === 'http:') {
    return host === '127.0.0.1' || host === 'localhost';
  }
  return false;
}

// ---------------------------------------------------------------- send

function parseRetryAfter(value, nowMs) {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, t - nowMs);
}

// Push services (Apple in particular) answer errors with { "reason": "BadJwtToken" } etc.
// Only a short, character-restricted reason code is kept; never the raw body.
async function readReason(res) {
  try {
    const text = await res.text();
    if (!text || text.length > 2000) return undefined;
    const reason = JSON.parse(text).reason;
    if (typeof reason === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(reason)) return reason;
  } catch {
    // ignore
  }
  return undefined;
}

export async function sendWebPush({
  subscription,
  payloadObject,
  vapid,
  jwtCache,
  ttl = 3600,
  urgency = 'high',
  topic,
  fetchImpl = fetch,
  nowMs = Date.now(),
  allowTestEndpoints = false,
}) {
  const endpoint = subscription && subscription.endpoint;
  if (!isAllowedPushEndpoint(endpoint, { allowTestEndpoints })) {
    throw new Error('push endpoint is not allowed');
  }
  const keys = subscription.keys || {};
  if (!Number.isInteger(ttl) || ttl < 0) throw new RangeError('ttl must be a non-negative integer');
  if (!URGENCIES.has(urgency)) throw new RangeError('urgency must be very-low, low, normal or high');
  if (topic !== undefined && (typeof topic !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(topic))) {
    throw new RangeError('topic must be 1..32 base64url characters');
  }
  if (!vapid || typeof vapid.subject !== 'string' || !vapid.privateJwk) throw new TypeError('vapid config is incomplete');

  const audience = new URL(endpoint).origin;
  const publicKey = vapid.publicKey || b64urlEncode(rawPublicFromJwk(cleanEcJwk(vapid.privateJwk, { requirePrivate: false })));

  let jwt = await cachedJwt(jwtCache, audience, nowMs);
  if (!jwt) {
    const ttlSeconds = 12 * 3600;
    jwt = await createVapidJwt({ audience, subject: vapid.subject, privateJwk: vapid.privateJwk, nowMs, ttlSeconds });
    if (jwtCache) await jwtCache.put(audience, jwt, (Math.floor(nowMs / 1000) + ttlSeconds) * 1000);
  }

  const body = await encryptPayload({
    p256dh: keys.p256dh,
    auth: keys.auth,
    plaintext: JSON.stringify(payloadObject),
  });

  const headers = {
    TTL: String(ttl),
    Urgency: urgency,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Authorization: vapidAuthorization({ jwt, publicKey }),
  };
  if (topic !== undefined) headers.Topic = topic;

  // redirect: 'manual' so a push service can never bounce us to a host outside the allowlist.
  const res = await fetchImpl(endpoint, { method: 'POST', headers, body, redirect: 'manual' });
  const status = res.status;
  const result = { status, ok: status >= 200 && status < 300, gone: status === 404 || status === 410 };
  const retryAfterMs = parseRetryAfter(res.headers && res.headers.get ? res.headers.get('retry-after') : null, nowMs);
  if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
  if (!result.ok) {
    const reason = await readReason(res);
    if (reason) result.reason = reason;
  }
  return result;
}

// Test-only push RECEIVER: the user-agent side of RFC 8291 plus a VAPID (RFC 8292) verifier.
// Deliberately independent of src/webpush.js (own base64url, own key schedule) so it is a real cross-check.
// Reused by the e2e mock push service. Never logs keys, tokens or plaintext.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export function unb64u(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(str)) throw new TypeError('bad base64url');
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}

// HKDF written out with HMAC (RFC 5869) rather than WebCrypto's HKDF, for independence. L <= 32.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/**
 * createReceiver() -> { subscriptionKeys: { p256dh, auth }, decrypt(bodyBytes) -> Uint8Array }
 * Optional fixed keys (for RFC 8291 Appendix A): { publicKey, privateKey, auth } as base64url,
 * publicKey the 65-byte uncompressed point and privateKey the 32-byte scalar.
 */
export async function createReceiver(fixed) {
  let privateKey;
  let publicRaw;
  let authSecret;
  if (fixed) {
    publicRaw = unb64u(fixed.publicKey);
    authSecret = unb64u(fixed.auth);
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: b64u(publicRaw.subarray(1, 33)),
      y: b64u(publicRaw.subarray(33, 65)),
      d: fixed.privateKey,
    };
    privateKey = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    privateKey = kp.privateKey;
    publicRaw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    authSecret = globalThis.crypto.getRandomValues(new Uint8Array(16));
  }

  async function decrypt(bodyBytes) {
    const body = bodyBytes instanceof Uint8Array ? bodyBytes : new Uint8Array(bodyBytes);
    if (body.length < 21) throw new Error('body too short for aes128gcm header');
    const salt = body.subarray(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(16, false);
    const idlen = body[20];
    if (idlen !== 65) throw new Error(`idlen must be 65, got ${idlen}`);
    if (rs < 18) throw new Error('record size too small');
    const keyid = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    if (ciphertext.length === 0) throw new Error('no records');

    const asKey = await subtle.importKey('raw', keyid, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, privateKey, 256));
    const keyInfo = concat(enc.encode('WebPush: info\0'), publicRaw, keyid);
    const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const baseNonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const aesKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);

    const out = [];
    let seq = 0;
    for (let off = 0; off < ciphertext.length; off += rs, seq++) {
      const rec = ciphertext.subarray(off, Math.min(off + rs, ciphertext.length));
      const isLast = off + rs >= ciphertext.length;
      if (rec.length < 17) throw new Error('record too short');
      const nonce = baseNonce.slice();
      // XOR the 96-bit big-endian sequence number into the nonce (only the low 48 bits are ever non-zero here).
      for (let i = 0, s = seq; i < 6; i++, s = Math.floor(s / 256)) nonce[11 - i] ^= s & 0xff;
      // Throws OperationError on any tampering (tag mismatch).
      const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, rec));
      let end = plain.length - 1;
      while (end >= 0 && plain[end] === 0) end--;
      if (end < 0) throw new Error('record has no delimiter');
      const delim = plain[end];
      if (delim !== (isLast ? 2 : 1)) throw new Error(`bad record delimiter ${delim}`);
      out.push(plain.subarray(0, end));
    }
    return concat(...out);
  }

  return {
    subscriptionKeys: { p256dh: b64u(publicRaw), auth: b64u(authSecret) },
    decrypt,
    async decryptJson(bodyBytes) {
      return JSON.parse(dec.decode(await decrypt(bodyBytes)));
    },
  };
}

/**
 * verifyVapid('vapid t=<jwt>, k=<key>', { expectedAudience, nowMs })
 *   -> { ok: true, claims, publicKey } | { ok: false, reason }
 * Checks: scheme, ES256 signature with the k= key, aud, exp in (now, now + 24h], sub https: or mailto:.
 */
export async function verifyVapid(authorizationHeader, { expectedAudience, nowMs = Date.now() } = {}) {
  const fail = (reason) => ({ ok: false, claims: null, reason });
  if (typeof authorizationHeader !== 'string') return fail('missing_header');
  const m = /^vapid\s+(.*)$/i.exec(authorizationHeader.trim());
  if (!m) return fail('bad_scheme');
  const params = {};
  for (const part of m[1].split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) return fail('malformed_params');
    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const jwt = params.t;
  const k = params.k;
  if (!jwt || !k) return fail('missing_t_or_k');

  const segs = jwt.split('.');
  if (segs.length !== 3) return fail('malformed_jwt');
  let header;
  let claims;
  let sig;
  let keyRaw;
  try {
    header = JSON.parse(dec.decode(unb64u(segs[0])));
    claims = JSON.parse(dec.decode(unb64u(segs[1])));
    sig = unb64u(segs[2]);
    keyRaw = unb64u(k);
  } catch {
    return fail('malformed_jwt');
  }
  if (header.alg !== 'ES256') return fail('bad_alg');
  if (header.typ !== undefined && header.typ !== 'JWT') return fail('bad_typ');
  if (sig.length !== 64) return fail('bad_signature_length');
  if (keyRaw.length !== 65 || keyRaw[0] !== 4) return fail('bad_key');

  let key;
  try {
    key = await subtle.importKey('raw', keyRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch {
    return fail('bad_key');
  }
  const good = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    sig,
    enc.encode(`${segs[0]}.${segs[1]}`),
  );
  if (!good) return fail('bad_signature');

  if (expectedAudience !== undefined && claims.aud !== expectedAudience) return { ...fail('bad_aud'), claims };
  const nowS = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return { ...fail('missing_exp'), claims };
  if (claims.exp <= nowS) return { ...fail('expired'), claims };
  if (claims.exp > nowS + 86400) return { ...fail('exp_too_far'), claims };
  if (typeof claims.sub !== 'string' || !/^(https:|mailto:)/.test(claims.sub)) return { ...fail('bad_sub'), claims };
  return { ok: true, claims, publicKey: k, reason: null };
}

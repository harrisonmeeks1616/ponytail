import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  b64urlEncode,
  b64urlDecode,
  generateVapidKeys,
  createVapidJwt,
  vapidAuthorization,
  encryptPayload,
  isAllowedPushEndpoint,
  sendWebPush,
  createMemoryJwtCache,
  MAX_PLAINTEXT_BYTES,
} from '../src/webpush.js';
import { createReceiver, verifyVapid } from './helpers/push-receiver.mjs';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const SUBJECT = 'https://harrison-os-spike.example.workers.dev';
const APPLE_ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMH9pkTKVR1ra3CzlXlxDq2fNDtFHm3yl2';
const APPLE_AUD = 'https://web.push.apple.com';
const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------ base64url

test('b64url round-trips every length and never pads', () => {
  for (let n = 0; n < 70; n++) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
    const s = b64urlEncode(bytes);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(b64urlDecode(s), bytes);
  }
  assert.deepEqual(b64urlDecode('_-8'), new Uint8Array([0xff, 0xef]));
  assert.throws(() => b64urlDecode('a$b'), TypeError);
  assert.throws(() => b64urlDecode('abcde'), TypeError);
});

// ------------------------------------------------------------ encryption

test('encrypt -> decrypt round-trips a JSON payload', async () => {
  const rx = await createReceiver();
  const payload = {
    web_push: 8030,
    notification: { title: 'Reminder (spike)', body: 'Sample text (for Sat Oct 31, 7:00 AM EDT)', navigate: '/?ack=d1', tag: 'd1' },
    delivery_id: 'd1',
  };
  const body = await encryptPayload({ ...rx.subscriptionKeys, plaintext: JSON.stringify(payload) });
  assert.ok(body instanceof Uint8Array);
  assert.deepEqual(JSON.parse(dec.decode(await rx.decrypt(body))), payload);
});

test('every encryption uses a fresh salt and sender key', async () => {
  const rx = await createReceiver();
  const a = await encryptPayload({ ...rx.subscriptionKeys, plaintext: 'same' });
  const b = await encryptPayload({ ...rx.subscriptionKeys, plaintext: 'same' });
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16));
  assert.notDeepEqual(a.subarray(21, 86), b.subarray(21, 86));
});

test('tampering any ciphertext byte, the tag, or the salt makes decrypt fail', async () => {
  const rx = await createReceiver();
  const body = await encryptPayload({ ...rx.subscriptionKeys, plaintext: '{"hello":"world"}' });
  for (const idx of [86, 90, body.length - 1, 0]) {
    const bad = body.slice();
    bad[idx] ^= 0x01;
    await assert.rejects(rx.decrypt(bad), `flip at ${idx} should fail`);
  }
  // A different receiver (wrong keys) cannot decrypt either.
  const other = await createReceiver();
  await assert.rejects(other.decrypt(body));
});

test('header layout: salt 16, rs 4096, idlen 65, keyid = sender public key, single record', async () => {
  const rx = await createReceiver();
  const salt = new Uint8Array(16).fill(7);
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const plaintext = 'x'.repeat(100);
  const body = await encryptPayload({ ...rx.subscriptionKeys, plaintext, salt, senderKeyPair: kp });
  assert.deepEqual(body.subarray(0, 16), salt);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16, false), 4096);
  assert.equal(body[20], 65);
  assert.deepEqual(body.subarray(21, 86), senderPub);
  assert.equal(body[21], 0x04);
  // one record = plaintext + 0x02 delimiter + 16-byte tag
  assert.equal(body.length, 86 + plaintext.length + 1 + 16);
  assert.equal(dec.decode(await rx.decrypt(body)), plaintext);
});

test('payload size cap keeps the body within 4096 bytes', async () => {
  const rx = await createReceiver();
  const max = await encryptPayload({ ...rx.subscriptionKeys, plaintext: 'a'.repeat(MAX_PLAINTEXT_BYTES) });
  assert.equal(max.length, 4096);
  await assert.rejects(
    encryptPayload({ ...rx.subscriptionKeys, plaintext: 'a'.repeat(MAX_PLAINTEXT_BYTES + 1) }),
    RangeError,
  );
});

test('rejects malformed subscription keys', async () => {
  const rx = await createReceiver();
  await assert.rejects(encryptPayload({ p256dh: rx.subscriptionKeys.p256dh, auth: b64urlEncode(new Uint8Array(8)), plaintext: 'x' }), TypeError);
  await assert.rejects(encryptPayload({ p256dh: b64urlEncode(new Uint8Array(65)), auth: rx.subscriptionKeys.auth, plaintext: 'x' }), TypeError);
  // 65 bytes starting 0x04 but not on the curve
  const offCurve = new Uint8Array(65).fill(1);
  offCurve[0] = 4;
  await assert.rejects(encryptPayload({ p256dh: b64urlEncode(offCurve), auth: rx.subscriptionKeys.auth, plaintext: 'x' }));
});

// RFC 8291 Appendix A. Values are the RFC's base64url strings (line breaks removed).
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('RFC 8291 Appendix A: injected salt and sender keys reproduce the RFC body byte for byte', async () => {
  const body = await encryptPayload({
    p256dh: RFC.uaPublic,
    auth: RFC.auth,
    plaintext: RFC.plaintext,
    salt: RFC.salt,
    senderKeyPair: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate },
  });
  assert.equal(b64urlEncode(body), RFC.body);
});

test('RFC 8291 Appendix A: receiver with the RFC UA keys decrypts the RFC body', async () => {
  const rx = await createReceiver({ publicKey: RFC.uaPublic, privateKey: RFC.uaPrivate, auth: RFC.auth });
  assert.equal(dec.decode(await rx.decrypt(b64urlDecode(RFC.body))), RFC.plaintext);
});

// ------------------------------------------------------------ VAPID

test('generateVapidKeys returns a 65-byte public key and a private JWK', async () => {
  const k = await generateVapidKeys();
  const raw = b64urlDecode(k.publicKey);
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);
  assert.deepEqual(Object.keys(k.privateJwk).sort(), ['crv', 'd', 'kty', 'x', 'y']);
  assert.equal(k.privateJwk.crv, 'P-256');
});

test('VAPID JWT verifies with the k= key and has the right claims', async () => {
  const k = await generateVapidKeys();
  const jwt = await createVapidJwt({ audience: APPLE_AUD, subject: SUBJECT, privateJwk: k.privateJwk, nowMs: NOW });
  const [h, , s] = jwt.split('.');
  assert.deepEqual(JSON.parse(dec.decode(b64urlDecode(h))), { typ: 'JWT', alg: 'ES256' });
  assert.equal(b64urlDecode(s).length, 64);
  const auth = vapidAuthorization({ jwt, publicKey: k.publicKey });
  assert.equal(auth, `vapid t=${jwt}, k=${k.publicKey}`);
  const v = await verifyVapid(auth, { expectedAudience: APPLE_AUD, nowMs: NOW });
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.claims, { aud: APPLE_AUD, exp: NOW / 1000 + 12 * 3600, sub: SUBJECT });
  assert.equal(v.publicKey, k.publicKey);
});

test('VAPID creation rejects exp more than 24h ahead, bad audience and non-https subject', async () => {
  const k = await generateVapidKeys();
  const base = { audience: APPLE_AUD, subject: SUBJECT, privateJwk: k.privateJwk, nowMs: NOW };
  await assert.rejects(createVapidJwt({ ...base, ttlSeconds: 86401 }), RangeError);
  await assert.rejects(createVapidJwt({ ...base, ttlSeconds: 0 }), RangeError);
  const ok = await createVapidJwt({ ...base, ttlSeconds: 86400 });
  assert.equal((await verifyVapid(vapidAuthorization({ jwt: ok, publicKey: k.publicKey }), { expectedAudience: APPLE_AUD, nowMs: NOW })).ok, true);
  await assert.rejects(createVapidJwt({ ...base, audience: 'https://web.push.apple.com/path' }), TypeError);
  await assert.rejects(createVapidJwt({ ...base, subject: 'mailto:someone@example.com' }), TypeError);
  await assert.rejects(createVapidJwt({ ...base, subject: 'http://insecure.example' }), TypeError);
});

async function forgeJwt(privateJwk, claims, header = { typ: 'JWT', alg: 'ES256' }) {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const si = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(claims)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(si)));
  return `${si}.${b64urlEncode(sig)}`;
}

test('verifyVapid rejects wrong aud, expired, exp > 24h, bad sub, bad signature, wrong key', async () => {
  const k = await generateVapidKeys();
  const nowS = NOW / 1000;
  const check = async (claims, opts = {}) => {
    const jwt = await forgeJwt(k.privateJwk, claims);
    return verifyVapid(vapidAuthorization({ jwt, publicKey: opts.publicKey || k.publicKey }), { expectedAudience: APPLE_AUD, nowMs: NOW });
  };
  assert.equal((await check({ aud: APPLE_AUD, exp: nowS + 60, sub: 'mailto:ops@example.com' })).ok, true);
  assert.equal((await check({ aud: 'https://fcm.googleapis.com', exp: nowS + 60, sub: SUBJECT })).reason, 'bad_aud');
  assert.equal((await check({ aud: APPLE_AUD, exp: nowS - 1, sub: SUBJECT })).reason, 'expired');
  assert.equal((await check({ aud: APPLE_AUD, exp: nowS + 86401, sub: SUBJECT })).reason, 'exp_too_far');
  assert.equal((await check({ aud: APPLE_AUD, exp: nowS + 60, sub: 'http://x.example' })).reason, 'bad_sub');
  const other = await generateVapidKeys();
  assert.equal((await check({ aud: APPLE_AUD, exp: nowS + 60, sub: SUBJECT }, { publicKey: other.publicKey })).reason, 'bad_signature');

  const jwt = await createVapidJwt({ audience: APPLE_AUD, subject: SUBJECT, privateJwk: k.privateJwk, nowMs: NOW });
  const parts = jwt.split('.');
  const sig = b64urlDecode(parts[2]);
  sig[10] ^= 1;
  const tampered = `${parts[0]}.${parts[1]}.${b64urlEncode(sig)}`;
  assert.equal((await verifyVapid(vapidAuthorization({ jwt: tampered, publicKey: k.publicKey }), { expectedAudience: APPLE_AUD, nowMs: NOW })).reason, 'bad_signature');
  assert.equal((await verifyVapid('Bearer abc', { nowMs: NOW })).ok, false);
  assert.equal((await verifyVapid(undefined, { nowMs: NOW })).ok, false);
});

// ------------------------------------------------------------ endpoint allowlist

test('isAllowedPushEndpoint is a strict allowlist', () => {
  const yes = [
    'https://web.push.apple.com/abc',
    'https://api.push.apple.com/abc',
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
    'https://WEB.PUSH.APPLE.COM/abc',
    'https://web.push.apple.com:443/abc',
  ];
  const no = [
    'http://web.push.apple.com/abc',
    'https://push.apple.com.evil.com/abc',
    'https://evilpush.apple.com/abc',
    'https://web.push.apple.com.evil.com/abc',
    'https://fcm.googleapis.com.evil.com/x',
    'https://169.254.169.254/latest/meta-data',
    'http://169.254.169.254/latest/meta-data',
    'https://web.push.apple.com:8443/abc',
    'https://user:pw@web.push.apple.com/abc',
    'https://notify.windows.com.evil/abc',
    'http://127.0.0.1:8798/push/abc',
    'http://localhost:8798/push/abc',
    'ftp://web.push.apple.com/abc',
    'not a url',
    '',
    undefined,
  ];
  for (const u of yes) assert.equal(isAllowedPushEndpoint(u), true, u);
  for (const u of no) assert.equal(isAllowedPushEndpoint(u), false, String(u));

  const t = { allowTestEndpoints: true };
  assert.equal(isAllowedPushEndpoint('http://127.0.0.1:8798/push/abc', t), true);
  assert.equal(isAllowedPushEndpoint('http://localhost:8798/push/abc', t), true);
  assert.equal(isAllowedPushEndpoint('http://169.254.169.254/latest', t), false);
  assert.equal(isAllowedPushEndpoint('http://127.0.0.2:8798/x', t), false);
  assert.equal(isAllowedPushEndpoint('http://push.apple.com.evil.com/x', t), false);
});

// ------------------------------------------------------------ sendWebPush

function fakeFetch(status = 201, responseHeaders = {}, responseBody = '') {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : responseBody, { status, headers: responseHeaders });
  };
  return { impl, calls };
}

async function setup() {
  const vapidKeys = await generateVapidKeys();
  const rx = await createReceiver();
  return {
    rx,
    vapid: { publicKey: vapidKeys.publicKey, privateJwk: vapidKeys.privateJwk, subject: SUBJECT },
    subscription: { endpoint: APPLE_ENDPOINT, keys: rx.subscriptionKeys },
  };
}

const PAYLOAD = {
  web_push: 8030,
  notification: { title: 'Reminder (spike)', body: 'b', navigate: '/?ack=d9', tag: 'd9', silent: false },
  delivery_id: 'd9',
  reminder_id: 'r1',
  sent_at_ms: NOW,
};

test('sendWebPush sends the right headers, an aes128gcm body and a valid VAPID token', async () => {
  const { rx, vapid, subscription } = await setup();
  const f = fakeFetch(201);
  const res = await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, jwtCache: createMemoryJwtCache(), fetchImpl: f.impl, nowMs: NOW });
  assert.deepEqual(res, { status: 201, ok: true, gone: false });
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, APPLE_ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'manual');
  const h = new Headers(init.headers);
  assert.equal(h.get('ttl'), '3600');
  assert.equal(h.get('urgency'), 'high');
  assert.equal(h.get('content-encoding'), 'aes128gcm');
  assert.equal(h.get('content-type'), 'application/octet-stream');
  assert.equal(h.get('topic'), null);
  assert.match(h.get('authorization'), /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=[A-Za-z0-9_-]+$/);
  assert.ok(h.get('authorization').endsWith(`, k=${vapid.publicKey}`));
  const v = await verifyVapid(h.get('authorization'), { expectedAudience: APPLE_AUD, nowMs: NOW });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.claims.sub, SUBJECT);
  assert.ok(init.body instanceof Uint8Array);
  assert.equal(new DataView(init.body.buffer, init.body.byteOffset).getUint32(16, false), 4096);
  assert.deepEqual(await rx.decryptJson(init.body), PAYLOAD);
});

test('sendWebPush passes ttl, urgency and topic through and validates them', async () => {
  const { vapid, subscription } = await setup();
  const f = fakeFetch(201);
  await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, ttl: 60, urgency: 'normal', topic: 'reminder-r1', fetchImpl: f.impl, nowMs: NOW });
  const h = new Headers(f.calls[0].init.headers);
  assert.equal(h.get('ttl'), '60');
  assert.equal(h.get('urgency'), 'normal');
  assert.equal(h.get('topic'), 'reminder-r1');
  await assert.rejects(sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, urgency: 'urgent', fetchImpl: f.impl, nowMs: NOW }), RangeError);
  await assert.rejects(sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, topic: 'has space', fetchImpl: f.impl, nowMs: NOW }), RangeError);
  await assert.rejects(sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, ttl: -1, fetchImpl: f.impl, nowMs: NOW }), RangeError);
  assert.equal(f.calls.length, 1);
});

test('JWT cache: second send to the same audience reuses the token; refreshes 1h before expiry', async () => {
  const { vapid, subscription } = await setup();
  const store = new Map();
  let gets = 0;
  let puts = 0;
  // async cache, like a D1-backed one
  const jwtCache = {
    async get(aud) {
      gets++;
      return store.get(aud) || null;
    },
    async put(aud, jwt, expMs) {
      puts++;
      store.set(aud, { jwt, expMs });
    },
  };
  const f = fakeFetch(201);
  const auth = (i) => new Headers(f.calls[i].init.headers).get('authorization');

  await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, jwtCache, fetchImpl: f.impl, nowMs: NOW });
  assert.equal(puts, 1);
  assert.equal(store.get(APPLE_AUD).expMs, NOW + 12 * 3600 * 1000);
  await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, jwtCache, fetchImpl: f.impl, nowMs: NOW + 5 * 60 * 1000 });
  assert.equal(puts, 1, 'no new JWT minted');
  assert.equal(auth(0), auth(1));

  // Different audience mints its own token.
  const fcmSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: subscription.keys };
  await sendWebPush({ subscription: fcmSub, payloadObject: PAYLOAD, vapid, jwtCache, fetchImpl: f.impl, nowMs: NOW });
  assert.equal(puts, 2);
  assert.notEqual(auth(2), auth(0));
  assert.equal((await verifyVapid(auth(2), { expectedAudience: 'https://fcm.googleapis.com', nowMs: NOW })).ok, true);

  // 10h59m later: still more than 1h of life left, reuse.
  await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, jwtCache, fetchImpl: f.impl, nowMs: NOW + (11 * 3600 - 60) * 1000 });
  assert.equal(auth(3), auth(0));
  // 11h later: within the 1h margin, mint a fresh one.
  await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, jwtCache, fetchImpl: f.impl, nowMs: NOW + 11 * 3600 * 1000 });
  assert.equal(puts, 3);
  assert.notEqual(auth(4), auth(0));
  assert.ok(gets >= 5);
});

test('JWT cache accepts a bare JWT string from get() and reads exp from it', async () => {
  const { vapid, subscription } = await setup();
  const jwt = await createVapidJwt({ audience: APPLE_AUD, subject: SUBJECT, privateJwk: vapid.privateJwk, nowMs: NOW });
  let puts = 0;
  const f = fakeFetch(201);
  await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, jwtCache: { get: () => jwt, put: () => { puts++; } }, fetchImpl: f.impl, nowMs: NOW });
  assert.equal(puts, 0);
  assert.equal(new Headers(f.calls[0].init.headers).get('authorization'), `vapid t=${jwt}, k=${vapid.publicKey}`);
});

test('404 and 410 are gone; 429 carries retryAfterMs; 400 carries a sanitized reason', async () => {
  const { vapid, subscription } = await setup();
  for (const status of [404, 410]) {
    const r = await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, fetchImpl: fakeFetch(status).impl, nowMs: NOW });
    assert.equal(r.gone, true);
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
  }
  const accepted = await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, fetchImpl: fakeFetch(202).impl, nowMs: NOW });
  assert.deepEqual(accepted, { status: 202, ok: true, gone: false });

  const busy = await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, fetchImpl: fakeFetch(429, { 'Retry-After': '30' }).impl, nowMs: NOW });
  assert.equal(busy.gone, false);
  assert.equal(busy.ok, false);
  assert.equal(busy.retryAfterMs, 30000);

  const dated = await sendWebPush({
    subscription, payloadObject: PAYLOAD, vapid, nowMs: NOW,
    fetchImpl: fakeFetch(503, { 'Retry-After': new Date(NOW + 120000).toUTCString() }).impl,
  });
  assert.equal(dated.retryAfterMs, 120000);

  const bad = await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, nowMs: NOW, fetchImpl: fakeFetch(403, {}, '{"reason":"BadJwtToken"}').impl });
  assert.deepEqual(bad, { status: 403, ok: false, gone: false, reason: 'BadJwtToken' });
  const junk = await sendWebPush({ subscription, payloadObject: PAYLOAD, vapid, nowMs: NOW, fetchImpl: fakeFetch(400, {}, '{"reason":"<script>"}').impl });
  assert.equal(junk.reason, undefined);
});

test('sendWebPush throws on a disallowed endpoint without calling fetch', async () => {
  const { vapid, subscription } = await setup();
  const f = fakeFetch(201);
  for (const endpoint of ['https://push.apple.com.evil.com/x', 'http://169.254.169.254/latest', 'http://127.0.0.1:8798/push/x']) {
    await assert.rejects(
      sendWebPush({ subscription: { ...subscription, endpoint }, payloadObject: PAYLOAD, vapid, fetchImpl: f.impl, nowMs: NOW }),
      /not allowed/,
    );
  }
  assert.equal(f.calls.length, 0);
  // The local mock push service is reachable only with allowTestEndpoints.
  const local = { ...subscription, endpoint: 'http://127.0.0.1:8798/push/x' };
  const r = await sendWebPush({ subscription: local, payloadObject: PAYLOAD, vapid, fetchImpl: f.impl, nowMs: NOW, allowTestEndpoints: true });
  assert.equal(r.ok, true);
  const v = await verifyVapid(new Headers(f.calls[0].init.headers).get('authorization'), { expectedAudience: 'http://127.0.0.1:8798', nowMs: NOW });
  assert.equal(v.ok, true, v.reason);
});

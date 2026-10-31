import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticate,
  authorizeRoute,
  maskEmail,
  AuthError,
  normaliseTeamDomain,
  _resetJwksCache,
  JWKS_TTL_MS,
} from '../src/auth.js';

const subtle = globalThis.crypto.subtle;
const TEAM = 'https://team.cloudflareaccess.com';
const AUD = 'aud-tag-0123456789abcdef';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

async function makeKey(kid) {
  const pair = await subtle.generateKey(
    { ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}

const keyA = await makeKey('kid-a');
const keyB = await makeKey('kid-b');
const keyEvil = await makeKey('kid-a'); // same kid as A, different key

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}
function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function mint(claims, { key = keyA, header = {} } = {}) {
  const h = b64urlJson({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const p = b64urlJson(claims);
  const sig = await subtle.sign(ALG, key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

function ownerClaims(extra = {}) {
  return {
    aud: [AUD],
    email: 'Harrison@Example.com',
    exp: NOW_S + 3600,
    iat: NOW_S - 10,
    nbf: NOW_S - 10,
    iss: TEAM,
    type: 'app',
    sub: 'user-uuid',
    ...extra,
  };
}

function serviceClaims(extra = {}) {
  return {
    aud: [AUD],
    common_name: 'client-id.access',
    exp: NOW_S + 3600,
    iat: NOW_S - 10,
    iss: TEAM,
    sub: '',
    type: 'app',
    ...extra,
  };
}

// Mock JWKS endpoint.
let published;
let fetchCalls;
function fetchImpl(url, init) {
  fetchCalls.push(String(url));
  return Promise.resolve(
    new Response(JSON.stringify({ keys: published.map((k) => k.jwk), public_cert: {}, public_certs: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function req(token, url = 'https://harrison-os-spike.example.workers.dev/api/session') {
  const headers = new Headers();
  if (token) headers.set('Cf-Access-Jwt-Assertion', token);
  return new Request(url, { headers });
}

const ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const SHORTCUT_AUD = 'aud-shortcut-fedcba9876543210';
const ENV2 = { ...ENV, ACCESS_AUD_SHORTCUT: SHORTCUT_AUD };

async function expectAuthError(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AuthError, `expected AuthError, got ${err && err.name}: ${err && err.message}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

beforeEach(() => {
  _resetJwksCache();
  published = [keyA];
  fetchCalls = [];
});

test('valid owner token', async () => {
  const token = await mint(ownerClaims());
  const id = await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW });
  assert.deepEqual(id, {
    kind: 'owner',
    email: 'Harrison@Example.com',
    emailMasked: 'H***@Example.com',
    expMs: (NOW_S + 3600) * 1000,
  });
  assert.deepEqual(fetchCalls, [`${TEAM}/cdn-cgi/access/certs`]);
});

test('aud as a plain string is accepted', async () => {
  const token = await mint(ownerClaims({ aud: AUD }));
  const id = await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW });
  assert.equal(id.kind, 'owner');
});

test('aud as an array containing the tag among others is accepted', async () => {
  const token = await mint(ownerClaims({ aud: ['other-aud', AUD] }));
  const id = await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW });
  assert.equal(id.kind, 'owner');
});

test('wrong aud (string or array) -> 401 invalid', async () => {
  await expectAuthError(authenticate(req(await mint(ownerClaims({ aud: 'nope' }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  await expectAuthError(authenticate(req(await mint(ownerClaims({ aud: ['nope', 'x'] }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  await expectAuthError(authenticate(req(await mint(ownerClaims({ aud: undefined }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
});

test('wrong iss -> 401 invalid', async () => {
  const token = await mint(ownerClaims({ iss: 'https://evil.cloudflareaccess.com' }));
  await expectAuthError(authenticate(req(token), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  const token2 = await mint(ownerClaims({ iss: `${TEAM}/` }));
  await expectAuthError(authenticate(req(token2), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
});

test('expired -> 401 expired; exp exactly now is expired; missing exp is invalid', async () => {
  await expectAuthError(authenticate(req(await mint(ownerClaims({ exp: NOW_S - 1 }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'expired');
  await expectAuthError(authenticate(req(await mint(ownerClaims({ exp: NOW_S }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'expired');
  await expectAuthError(authenticate(req(await mint(ownerClaims({ exp: undefined }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
});

test('nbf / iat more than 60 s in the future -> 401 invalid; within skew is accepted', async () => {
  await expectAuthError(authenticate(req(await mint(ownerClaims({ nbf: NOW_S + 61 }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  await expectAuthError(authenticate(req(await mint(ownerClaims({ iat: NOW_S + 120 }))), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  const ok = await authenticate(req(await mint(ownerClaims({ nbf: NOW_S + 30, iat: NOW_S + 30 }))), ENV, { fetchImpl, nowMs: NOW });
  assert.equal(ok.kind, 'owner');
});

test('bad signature -> 401 invalid (wrong key with same kid, tampered payload, garbage sig)', async () => {
  const forged = await mint(ownerClaims(), { key: keyEvil });
  await expectAuthError(authenticate(req(forged), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');

  const good = await mint(ownerClaims());
  const [h, , s] = good.split('.');
  const tampered = `${h}.${b64urlJson(ownerClaims({ email: 'attacker@example.com' }))}.${s}`;
  await expectAuthError(authenticate(req(tampered), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');

  await expectAuthError(authenticate(req(`${h}.${good.split('.')[1]}.AAAA`), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  await expectAuthError(authenticate(req(`${h}.${good.split('.')[1]}.not*base64`), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
});

test('malformed token and non-RS256 alg are rejected', async () => {
  await expectAuthError(authenticate(req('abc'), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  await expectAuthError(authenticate(req('a.b.c.d'), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  const none = `${b64urlJson({ alg: 'none', kid: 'kid-a' })}.${b64urlJson(ownerClaims())}.`;
  await expectAuthError(authenticate(req(none), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  const hs = await mint(ownerClaims(), { header: { alg: 'HS256' } });
  await expectAuthError(authenticate(req(hs), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  const noKid = await mint(ownerClaims(), { header: { kid: undefined } });
  await expectAuthError(authenticate(req(noKid), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  // Nothing above should have needed the JWKS except possibly none; no crash either way.
});

test('unknown kid triggers exactly one refetch, then succeeds after rotation', async () => {
  // Warm the cache with key A only.
  await authenticate(req(await mint(ownerClaims())), ENV, { fetchImpl, nowMs: NOW });
  assert.equal(fetchCalls.length, 1);

  // Cloudflare rotates: key B is now published.
  published = [keyA, keyB];
  const tokenB = await mint(ownerClaims(), { key: keyB });
  const id = await authenticate(req(tokenB), ENV, { fetchImpl, nowMs: NOW + 1000 });
  assert.equal(id.kind, 'owner');
  assert.equal(fetchCalls.length, 2);

  // Cached now: no further fetches for A or B within the TTL.
  await authenticate(req(tokenB), ENV, { fetchImpl, nowMs: NOW + 2000 });
  await authenticate(req(await mint(ownerClaims())), ENV, { fetchImpl, nowMs: NOW + 3000 });
  assert.equal(fetchCalls.length, 2);
});

test('kid that stays unknown after the refetch -> 401 invalid, one refetch only', async () => {
  await authenticate(req(await mint(ownerClaims())), ENV, { fetchImpl, nowMs: NOW });
  assert.equal(fetchCalls.length, 1);
  const tokenB = await mint(ownerClaims(), { key: keyB }); // B never published
  await expectAuthError(authenticate(req(tokenB), ENV, { fetchImpl, nowMs: NOW + 1000 }), 401, 'invalid');
  assert.equal(fetchCalls.length, 2);
  // A burst of unknown kids right after doesn't hammer the certs endpoint.
  await expectAuthError(authenticate(req(tokenB), ENV, { fetchImpl, nowMs: NOW + 2000 }), 401, 'invalid');
  assert.equal(fetchCalls.length, 2);
});

test('JWKS is cached for 10 minutes, then refetched', async () => {
  const token = await mint(ownerClaims({ exp: NOW_S + 7200 }));
  await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW });
  await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW + JWKS_TTL_MS - 1 });
  assert.equal(fetchCalls.length, 1);
  await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW + JWKS_TTL_MS });
  assert.equal(fetchCalls.length, 2);
});

test('JWKS fetch failure fails closed with 503 jwks_unavailable', async () => {
  const token = await mint(ownerClaims());
  const failing = () => Promise.resolve(new Response('nope', { status: 500 }));
  await expectAuthError(authenticate(req(token), ENV, { fetchImpl: failing, nowMs: NOW }), 503, 'jwks_unavailable');
  const throwing = () => Promise.reject(new TypeError('network'));
  await expectAuthError(authenticate(req(token), ENV, { fetchImpl: throwing, nowMs: NOW }), 503, 'jwks_unavailable');
  const empty = () => Promise.resolve(new Response(JSON.stringify({ keys: [] }), { status: 200 }));
  await expectAuthError(authenticate(req(token), ENV, { fetchImpl: empty, nowMs: NOW }), 503, 'jwks_unavailable');
});

test('missing assertion header -> 401 missing_assertion', async () => {
  await expectAuthError(authenticate(req(null), ENV, { fetchImpl, nowMs: NOW }), 401, 'missing_assertion');
  assert.equal(fetchCalls.length, 0);
});

test('missing config -> 503 not_configured (fail closed)', async () => {
  const token = await mint(ownerClaims());
  await expectAuthError(authenticate(req(token), {}, { fetchImpl, nowMs: NOW }), 503, 'not_configured');
  await expectAuthError(authenticate(req(token), { ACCESS_AUD: AUD }, { fetchImpl, nowMs: NOW }), 503, 'not_configured');
  await expectAuthError(authenticate(req(token), { ACCESS_TEAM_DOMAIN: TEAM }, { fetchImpl, nowMs: NOW }), 503, 'not_configured');
  await expectAuthError(authenticate(req(token), { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '  ' }, { fetchImpl, nowMs: NOW }), 503, 'not_configured');
  await expectAuthError(authenticate(req(token), { ACCESS_TEAM_DOMAIN: 'http://team.cloudflareaccess.com', ACCESS_AUD: AUD }, { fetchImpl, nowMs: NOW }), 503, 'not_configured');
  // Missing config is checked before the header.
  await expectAuthError(authenticate(req(null), {}, { fetchImpl, nowMs: NOW }), 503, 'not_configured');
  assert.equal(fetchCalls.length, 0);
});

test('DEV_ALLOW_UNAUTH on loopback -> dev, without config or token', async () => {
  const env = { DEV_ALLOW_UNAUTH: '1' };
  assert.deepEqual(await authenticate(req(null, 'http://127.0.0.1:8799/api/session'), env, { fetchImpl, nowMs: NOW }), { kind: 'dev' });
  assert.deepEqual(await authenticate(req(null, 'http://localhost:8799/api/session'), env, { fetchImpl, nowMs: NOW }), { kind: 'dev' });
  assert.equal(fetchCalls.length, 0);
});

test('DEV_ALLOW_UNAUTH on a non-loopback host -> 503 misconfigured, even with a valid token', async () => {
  const env = { ...ENV, DEV_ALLOW_UNAUTH: '1' };
  const token = await mint(ownerClaims());
  await expectAuthError(authenticate(req(token, 'https://harrison-os-spike.example.workers.dev/api/session'), env, { fetchImpl, nowMs: NOW }), 503, 'misconfigured');
  await expectAuthError(authenticate(req(null, 'http://127.0.0.1.evil.example/api/session'), env, { fetchImpl, nowMs: NOW }), 503, 'misconfigured');
  await expectAuthError(authenticate(req(null, 'http://localhost.evil.example/api/session'), env, { fetchImpl, nowMs: NOW }), 503, 'misconfigured');
});

test('DEV_ALLOW_UNAUTH values other than "1" are ignored', async () => {
  const env = { ...ENV, DEV_ALLOW_UNAUTH: 'true' };
  await expectAuthError(authenticate(req(null, 'http://127.0.0.1:8799/api/session'), env, { fetchImpl, nowMs: NOW }), 401, 'missing_assertion');
});

test('OWNER_EMAIL mismatch -> 403 not_owner; match is case-insensitive', async () => {
  const token = await mint(ownerClaims());
  await expectAuthError(authenticate(req(token), { ...ENV, OWNER_EMAIL: 'someone@example.com' }, { fetchImpl, nowMs: NOW }), 403, 'not_owner');
  const id = await authenticate(req(token), { ...ENV, OWNER_EMAIL: 'harrison@EXAMPLE.com' }, { fetchImpl, nowMs: NOW });
  assert.equal(id.kind, 'owner');
});

test('service token -> kind service; authorizeRoute allows only POST /api/shortcut/capture', async () => {
  const token = await mint(serviceClaims({ aud: [SHORTCUT_AUD] }));
  const id = await authenticate(req(token), { ...ENV2, OWNER_EMAIL: 'harrison@example.com' }, { fetchImpl, nowMs: NOW });
  assert.deepEqual(id, { kind: 'service', commonName: 'client-id.access', expMs: (NOW_S + 3600) * 1000 });

  assert.equal(authorizeRoute(id, 'POST', '/api/shortcut/capture'), true);
  assert.equal(authorizeRoute(id, 'post', '/api/shortcut/capture'), true);
  assert.equal(authorizeRoute(id, 'GET', '/api/shortcut/capture'), false);
  assert.equal(authorizeRoute(id, 'POST', '/api/shortcut/capture/'), false);
  assert.equal(authorizeRoute(id, 'POST', '/api/captures'), false);
  assert.equal(authorizeRoute(id, 'GET', '/api/session'), false);
  assert.equal(authorizeRoute(id, 'GET', '/api/evidence'), false);
  assert.equal(authorizeRoute(id, 'POST', '/api/push/test'), false);
});

test('audiences are bound to identities: service only via the Shortcut app, owner only via the owner app', async () => {
  // Service token presenting the owner audience (e.g. a policy mistake on the Worker-level app).
  const svcOwnerAud = await mint(serviceClaims({ aud: [AUD] }));
  await expectAuthError(authenticate(req(svcOwnerAud), ENV2, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  // Service token while no Shortcut audience is configured at all.
  const svc = await mint(serviceClaims({ aud: [SHORTCUT_AUD] }));
  await expectAuthError(authenticate(req(svc), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  await expectAuthError(authenticate(req(await mint(serviceClaims())), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  // A person's token minted for the Shortcut app is never an owner.
  const ownerShortcutAud = await mint(ownerClaims({ aud: [SHORTCUT_AUD] }));
  await expectAuthError(authenticate(req(ownerShortcutAud), ENV2, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  // Owner via the owner app still works when both audiences are configured.
  const owner = await mint(ownerClaims());
  const id = await authenticate(req(owner), ENV2, { fetchImpl, nowMs: NOW });
  assert.equal(id.kind, 'owner');
  // And the Shortcut identity cannot reach owner reads or settings.
  const svcId = await authenticate(req(svc), ENV2, { fetchImpl, nowMs: NOW });
  for (const [m, p] of [['GET', '/api/captures'], ['GET', '/api/reminders'], ['GET', '/api/evidence'],
    ['GET', '/api/settings/test-quiet-hours'], ['PUT', '/api/settings/test-quiet-hours'], ['POST', '/api/push/subscriptions'],
    ['DELETE', '/api/push/subscriptions'], ['POST', '/api/reminders'], ['GET', '/api/session']]) {
    assert.equal(authorizeRoute(svcId, m, p), false, `${m} ${p} must be refused for the Shortcut identity`);
  }
});

test('a JWKS fetch that never answers fails closed (503 jwks_unavailable) after the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const token = await mint(ownerClaims());
  const hanging = () => new Promise(() => {});
  const pending = authenticate(req(token), ENV, { fetchImpl: hanging, nowMs: NOW });
  const settled = expectAuthError(pending, 503, 'jwks_unavailable');
  await Promise.resolve();
  t.mock.timers.tick(5000);
  await settled;
});

test('a hung key fetch in one request does not block the next request (no shared in-flight promise)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const token = await mint(ownerClaims());
  const hanging = () => new Promise(() => {});
  const first = authenticate(req(token), ENV, { fetchImpl: hanging, nowMs: NOW });
  first.catch(() => {});
  // The second request has a working fetch and must succeed without waiting for the first.
  const id = await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW });
  assert.equal(id.kind, 'owner');
  t.mock.timers.tick(5000);
  await assert.rejects(first);
});

test('token with neither email nor common_name -> 401 invalid', async () => {
  const token = await mint(serviceClaims({ common_name: undefined }));
  await expectAuthError(authenticate(req(token), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
  const blank = await mint(ownerClaims({ email: '   ' }));
  await expectAuthError(authenticate(req(blank), ENV, { fetchImpl, nowMs: NOW }), 401, 'invalid');
});

test('owner and dev are allowed everywhere under /api, nowhere else', () => {
  for (const identity of [{ kind: 'owner', email: 'a@b.c' }, { kind: 'dev' }]) {
    for (const [m, p] of [
      ['GET', '/api/session'],
      ['POST', '/api/captures'],
      ['POST', '/api/shortcut/capture'],
      ['DELETE', '/api/push/subscriptions'],
      ['PUT', '/api/settings/test-quiet-hours'],
      ['POST', '/api/deliveries/abc/ack'],
    ]) {
      assert.equal(authorizeRoute(identity, m, p), true, `${identity.kind} ${m} ${p}`);
    }
    assert.equal(authorizeRoute(identity, 'GET', '/apix'), false);
    assert.equal(authorizeRoute(identity, 'GET', '/'), false);
  }
  assert.equal(authorizeRoute(null, 'GET', '/api/session'), false);
  assert.equal(authorizeRoute({ kind: 'stranger' }, 'GET', '/api/session'), false);
});

test('team domain trailing slash is normalised for the certs URL and iss check', async () => {
  const env = { ACCESS_TEAM_DOMAIN: `${TEAM}/`, ACCESS_AUD: AUD };
  const id = await authenticate(req(await mint(ownerClaims())), env, { fetchImpl, nowMs: NOW });
  assert.equal(id.kind, 'owner');
  assert.deepEqual(fetchCalls, [`${TEAM}/cdn-cgi/access/certs`]);

  assert.equal(normaliseTeamDomain('https://team.cloudflareaccess.com//'), TEAM);
  assert.equal(normaliseTeamDomain('  https://team.cloudflareaccess.com  '), TEAM);
  assert.equal(normaliseTeamDomain('team.cloudflareaccess.com'), TEAM);
  assert.equal(normaliseTeamDomain('https://team.cloudflareaccess.com/some/path'), null);
  assert.equal(normaliseTeamDomain(''), null);
  assert.equal(normaliseTeamDomain(undefined), null);
});

test('maskEmail', () => {
  assert.equal(maskEmail('harrison@x.com'), 'h***@x.com');
  assert.equal(maskEmail('a@b.co'), 'a***@b.co');
  assert.equal(maskEmail('@b.co'), '***@b.co');
  assert.equal(maskEmail('no-at-sign'), '***');
  assert.equal(maskEmail(undefined), '***');
});

test('AuthError messages never contain token material', async () => {
  const token = await mint(ownerClaims({ iss: 'https://evil.example' }));
  try {
    await authenticate(req(token), ENV, { fetchImpl, nowMs: NOW });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof AuthError);
    assert.ok(!err.message.includes(token.slice(0, 20)));
    assert.ok(!err.message.toLowerCase().includes('harrison'));
  }
});

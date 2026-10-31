// Harrison OS Slice 1: the HTTP API and the reminder cron.
//
// handleApi():     /api/* routes. JSON in and out, Cache-Control: no-store, errors as { error: { code, message } }.
// runScheduled():  reminder delivery for the cron "* * * * *", at most CRON_BATCH_CAP sends per invocation.
//
// Rules (CONTRACT.md):
// - src/db.js is the only module that touches the database. This file never builds SQL.
// - A scope query or body field is required wherever db.js needs one. It is never defaulted to 'all';
//   'all' is accepted only by today, inbox, the projects list and export.
// - Every request that changes something must carry X-Requested-With: XMLHttpRequest (CSRF), except the
//   Shortcut's service identity, which only ever reaches POST /api/shortcut/capture.
// - Logging: events and console output carry ids, states, timestamps, counts and status codes only.
//   Never capture, item, project or reminder text, tokens, JWTs, push keys, endpoints or emails.
// - The reminder, push and delivery code is ported from the spike's src/worker.js (copied, never imported).

import * as db from './db.js';
import { interpret } from './interpret.js';
import { buildToday } from './today.js';
import { authenticate, authorizeRoute } from './auth.js';
import { instantToZonedParts, nextDailyOccurrence, formatLocal } from './time.js';
import { isAllowedPushEndpoint, sendWebPush, b64urlDecode } from './webpush.js';

// ---------------------------------------------------------------- constants

const CAPTURE_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const CLIENT_REF_RE = /^[A-Za-z0-9_-]{6,60}$/;
const CHANGE_ID_RE = /^[0-9]{1,15}$/;
const ID = '[A-Za-z0-9_.:-]{1,120}';
const CAP = '[A-Za-z0-9_-]{8,80}';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCOPES = new Set(['work', 'personal']);
const RECURRENCES = new Set(['none', 'daily']);
const ACK_VIA = new Set(['notification', 'in_app']);

const MAX_TEXT = 10000;
const MAX_QUERY = 500;
const MAX_BODY_CHARS = 64 * 1024;
const MAX_TZ_LEN = 64;
const DAY_MS = 86_400_000;
// The spike measured about 1 ms CPU per send against the Free plan's 10 ms; Slice 1 caps a run at 3.
export const CRON_BATCH_CAP = 3;
const MAX_SUBS_PER_DELIVERY = 10;
const PAYLOAD_TEXT_MAX = 200; // keeps the encrypted push body far below 4 KB
const HOLD_LEASE_MS = 2 * 60 * 1000;
const EVENTS_KEEP = 5000;
const PUSH_TTL_SECONDS = 3600;
// A delivery still 'scheduled' this long after it was created started a send that never recorded how it
// ended (for example the invocation was stopped mid-send). It may or may not have reached the phone, so it
// is reported as outcome unknown: never as failed, never as sent, and never sent again.
export const STALE_SEND_MS = 3 * 60 * 1000;

const META_LAST_OPEN = 'last_open_at';
const META_LAST_TZ = 'last_time_zone';
const KV_QUIET_HOURS = 'setting:test_quiet_hours';
const KV_CHAOS = 'test:chaos:commit_then_503';
const KV_AUTH_MODE = 'test:auth_mode';
const KV_JWT_PREFIX = 'vapid_jwt:';

const DEFAULT_QUIET_HOURS = { enabled: false, start: '22:00', end: '07:00', time_zone: 'America/New_York' };
const QUIET_HOURS_LABEL = 'TEST quiet hours. Not Harrison policy.';

// ---------------------------------------------------------------- small helpers

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function apiHeaders(extra) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(extra || {}),
  };
}

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), { status, headers: apiHeaders(extraHeaders) });
}

export function apiError(status, code, message, extra) {
  const error = { code, message: message || code };
  if (extra && typeof extra === 'object') Object.assign(error, extra);
  return json(status, { error });
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
}

function testHooksEnabled(env, url) {
  return env.SPIKE_TEST_HOOKS === '1' && isLoopbackHostname(url.hostname);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function randomHex(bytes) {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function newDeliveryId() {
  return 'dl_' + randomHex(16);
}

async function sha256Hex(str) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  let s = '';
  for (const x of new Uint8Array(digest)) s += x.toString(16).padStart(2, '0');
  return s;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeFormatLocal(instantMs, timeZone) {
  try {
    return formatLocal(instantMs, timeZone);
  } catch {
    return iso(instantMs);
  }
}

function truncateChars(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > MAX_BODY_CHARS * 4) throw new HttpError(413, 'too_large', 'Request body is too large');
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, 'too_large', 'Request body is too large');
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  }
  return body;
}

async function readJsonLenient(request) {
  try {
    return await readJson(request);
  } catch {
    return {};
  }
}

function requireText(value, field = 'text', max = MAX_TEXT) {
  if (typeof value !== 'string') throw new HttpError(400, `invalid_${field}`, `${field} must be a string`);
  const t = value.trim();
  if (t.length < 1 || t.length > max) {
    throw new HttpError(400, `invalid_${field}`, `${field} must be 1 to ${max} characters after trim`);
  }
  return t;
}

/**
 * The scope rule. Missing gives 400 scope_required (never a default of 'all'), 'all' where it is not
 * allowed gives 400 scope_all_not_allowed, anything else unknown gives 400 invalid_scope.
 */
export function requireScope(value, { allowAll = false } = {}) {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(400, 'scope_required', allowAll ? "scope must be 'work', 'personal' or 'all'" : "scope must be 'work' or 'personal'");
  }
  if (value === 'all') {
    if (allowAll) return 'all';
    throw new HttpError(400, 'scope_all_not_allowed', "scope 'all' is not allowed here; use 'work' or 'personal'");
  }
  if (!SCOPES.has(value)) throw new HttpError(400, 'invalid_scope', "scope must be 'work' or 'personal'");
  return value;
}

function queryScope(ctx, opts) {
  return requireScope(ctx.url.searchParams.get('scope'), opts);
}

function validTimeZone(value, nowMs) {
  if (typeof value !== 'string' || !value || value.length > MAX_TZ_LEN) return null;
  try {
    instantToZonedParts(nowMs, value);
    return value;
  } catch {
    return null;
  }
}

function requireTimeZone(value, nowMs) {
  const tz = validTimeZone(value, nowMs);
  if (!tz) throw new HttpError(400, 'invalid_time_zone', 'time_zone must be an IANA zone name');
  return tz;
}

// The device's zone as last reported by the app (a real observed value, never a guess).
async function lastKnownTimeZone(ctx) {
  return validTimeZone(await db.getMeta(ctx.env.DB, META_LAST_TZ), ctx.nowMs);
}

async function rememberTimeZone(ctx, tz) {
  if (!tz) return;
  const current = await db.getMeta(ctx.env.DB, META_LAST_TZ);
  if (current !== tz) await db.setMeta(ctx.env.DB, META_LAST_TZ, tz);
}

// Maps data-layer errors to HTTP. Messages from db.js never carry user text.
function dbErrorResponse(err) {
  if (err instanceof db.ScopeError) return apiError(400, 'scope_not_allowed', err.message);
  if (err instanceof db.ValidationError) {
    if (err.field === 'in_past') return apiError(422, 'in_past', err.message);
    return apiError(400, 'invalid', err.message, err.field ? { field: String(err.field) } : null);
  }
  if (err instanceof db.ConflictError) return apiError(409, err.reason || 'conflict', err.message);
  if (err instanceof db.NotFoundError) return apiError(404, 'not_found', err.message);
  return null;
}

// ---------------------------------------------------------------- events and kv

async function logEvent(env, nowMs, kind, ref, detail) {
  try {
    await db.logEvent(env.DB, iso(nowMs), kind, ref, detail);
  } catch (err) {
    console.error(JSON.stringify({ evt: 'event_write_failed', kind, err: err && err.name }));
  }
}

// VAPID JWT cache in the kv table, keyed by key identity + audience so a key rotation never
// reuses a JWT signed by the old key. sendWebPush applies the "reuse until 1 h before exp" rule.
function createKvJwtCache(env, keyTag) {
  const k = (audience) => `${KV_JWT_PREFIX}${keyTag}:${audience}`;
  return {
    async get(audience) {
      const row = await db.kvGetRow(env.DB, k(audience));
      if (!row || row.expires_at == null) return null;
      return { jwt: row.value, expMs: Number(row.expires_at) };
    },
    async put(audience, jwt, expMs) {
      await db.kvPut(env.DB, k(audience), jwt, expMs);
    },
  };
}

// ---------------------------------------------------------------- TEST quiet hours

function validQuietHours(q) {
  return (
    q &&
    typeof q.enabled === 'boolean' &&
    typeof q.start === 'string' &&
    TIME_RE.test(q.start) &&
    typeof q.end === 'string' &&
    TIME_RE.test(q.end) &&
    q.start !== q.end &&
    typeof q.time_zone === 'string'
  );
}

async function getQuietHours(env, nowMs) {
  const raw = await db.kvGet(env.DB, KV_QUIET_HOURS, nowMs);
  if (!raw) return { ...DEFAULT_QUIET_HOURS };
  try {
    const q = JSON.parse(raw);
    if (validQuietHours(q)) return { enabled: q.enabled, start: q.start, end: q.end, time_zone: q.time_zone };
  } catch {
    // fall through
  }
  return { ...DEFAULT_QUIET_HOURS };
}

// Returns the instant the hold ends when nowMs is inside the TEST quiet window, else null.
function quietHoldUntil(qh, nowMs) {
  if (!qh || !qh.enabled) return null;
  try {
    const t = instantToZonedParts(nowMs, qh.time_zone).time;
    const inside = qh.start < qh.end ? t >= qh.start && t < qh.end : t >= qh.start || t < qh.end;
    if (!inside) return null;
    return nextDailyOccurrence({ time: qh.end, timeZone: qh.time_zone, afterMs: nowMs }).instantMs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- test hooks (loopback + SPIKE_TEST_HOOKS only)

async function maybeChaos(ctx, ref) {
  if (!ctx.hooks) return null;
  if (await db.kvDecrementIfPositive(ctx.env.DB, KV_CHAOS)) {
    await logEvent(ctx.env, ctx.nowMs, 'chaos_fired', ref, { mode: 'commit_then_503', path: ctx.path });
    return apiError(503, 'chaos_lost_response', 'TEST chaos: the write was committed but this response is a simulated failure');
  }
  return null;
}

// ---------------------------------------------------------------- web push delivery

function vapidConfig(env) {
  const publicKey = typeof env.VAPID_PUBLIC_KEY === 'string' ? env.VAPID_PUBLIC_KEY.trim() : '';
  const jwkText = typeof env.VAPID_PRIVATE_JWK === 'string' ? env.VAPID_PRIVATE_JWK.trim() : '';
  const subject = typeof env.VAPID_SUBJECT === 'string' ? env.VAPID_SUBJECT.trim() : '';
  if (!publicKey || !jwkText) return { error: 'vapid_not_configured' };
  let privateJwk;
  try {
    privateJwk = JSON.parse(jwkText);
  } catch {
    return { error: 'vapid_private_jwk_invalid' };
  }
  if (!privateJwk || typeof privateJwk !== 'object') return { error: 'vapid_private_jwk_invalid' };
  // The subject is the Worker's own https origin, never an email. Plain http is only accepted
  // for a loopback subject while a local-only flag is on.
  let u;
  try {
    u = new URL(subject);
  } catch {
    return { error: 'vapid_subject_invalid' };
  }
  const localOk =
    u.protocol === 'http:' &&
    isLoopbackHostname(u.hostname) &&
    (env.DEV_ALLOW_UNAUTH === '1' || env.ALLOW_TEST_PUSH_ENDPOINT === '1');
  if (u.protocol !== 'https:' && !localOk) return { error: 'vapid_subject_invalid' };
  // webpush.js only signs https:// subjects. A local loopback subject is rewritten to its https form for
  // the JWT; it only ever reaches the local mock push service.
  const jwtSubject = localOk ? `https://${u.host}` : subject;
  return { vapid: { publicKey, privateJwk, subject: jwtSubject }, appOrigin: u.origin };
}

// Declarative Web Push parses `navigate` as a URL with no page to resolve it against, so it is
// sent absolute (the Worker's own origin). A relative URL is only a fallback with no origin known.
function buildPayload({ deliveryId, reminderId, text, localLabel, nowMs, appOrigin }) {
  const ackPath = `/?ack=${encodeURIComponent(deliveryId)}`;
  return {
    web_push: 8030,
    notification: {
      title: 'Reminder',
      body: `${truncateChars(text, PAYLOAD_TEXT_MAX)} (for ${localLabel})`,
      navigate: appOrigin ? `${appOrigin}${ackPath}` : ackPath,
      tag: deliveryId,
      silent: false,
    },
    delivery_id: deliveryId,
    reminder_id: reminderId,
    sent_at_ms: nowMs,
  };
}

function summariseFailure(results) {
  const withStatus = results.filter((r) => Number.isInteger(r.status));
  if (withStatus.length && withStatus.every((r) => r.gone)) return 'all_subscriptions_gone';
  const last = withStatus[withStatus.length - 1];
  if (last) return `push_status_${last.status}${last.reason ? ':' + last.reason : ''}`;
  const e = results.find((r) => r.error);
  return e ? e.error : 'send_failed';
}

// Sends one delivery row to every subscription and records the outcome. Never moves state
// backwards: a beacon or ack that arrived first is kept (db.recordDeliveryOutcome).
export async function sendDelivery(env, nowMs, delivery, text) {
  const subs = await db.listPushSubscriptions(env.DB, MAX_SUBS_PER_DELIVERY);

  let state;
  let pushStatus = null;
  let error = null;
  let sentAt = null;
  let results = [];

  if (subs.length === 0) {
    state = 'no_route';
  } else {
    const cfg = vapidConfig(env);
    if (cfg.error) {
      state = 'failed';
      error = cfg.error;
      results = subs.map((s) => ({ subscription: s.id.slice(0, 12), status: null, ok: false, gone: false, error: cfg.error }));
    } else {
      const keyTag = (await sha256Hex(`${cfg.vapid.publicKey}|${cfg.vapid.subject}`)).slice(0, 16);
      const jwtCache = createKvJwtCache(env, keyTag);
      const allowTestEndpoints = env.ALLOW_TEST_PUSH_ENDPOINT === '1';
      const payloadObject = buildPayload({
        deliveryId: delivery.id,
        reminderId: delivery.reminder_id,
        text,
        localLabel: delivery.local_label,
        nowMs,
        appOrigin: cfg.appOrigin,
      });
      results = await Promise.all(
        subs.map(async (sub) => {
          const tag = sub.id.slice(0, 12);
          let r;
          try {
            r = await sendWebPush({
              subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payloadObject,
              vapid: cfg.vapid,
              jwtCache,
              ttl: PUSH_TTL_SECONDS,
              urgency: 'high',
              nowMs,
              allowTestEndpoints,
            });
          } catch (err) {
            const code = err && /not allowed/.test(String(err.message)) ? 'endpoint_not_allowed' : 'send_exception';
            await logEvent(env, nowMs, 'push_attempt', delivery.id, {
              sub: tag,
              ok: false,
              error: code,
              exception: (err && err.name) || 'Error',
            });
            return { subscription: tag, status: null, ok: false, gone: false, error: code };
          }
          const out = { subscription: tag, status: r.status, ok: !!r.ok, gone: !!r.gone };
          if (r.reason) out.reason = r.reason;
          if (r.retryAfterMs !== undefined) out.retry_after_ms = r.retryAfterMs;
          try {
            if (r.gone) {
              await db.deletePushSubscription(env.DB, sub.id);
              await logEvent(env, nowMs, 'subscription_gone', tag, { status: r.status, delivery: delivery.id });
            } else {
              await db.updatePushSubscriptionStatus(env.DB, sub.id, r.status, !!r.ok, iso(nowMs));
            }
          } catch (err) {
            console.error(JSON.stringify({ evt: 'subscription_update_failed', err: err && err.name }));
          }
          await logEvent(env, nowMs, 'push_attempt', delivery.id, out);
          return out;
        }),
      );
      const accepted = results.find((r) => r.ok);
      if (accepted) {
        state = 'sent';
        pushStatus = accepted.status;
        sentAt = iso(nowMs);
      } else {
        state = 'failed';
        const lastStatus = [...results].reverse().find((r) => Number.isInteger(r.status));
        pushStatus = lastStatus ? lastStatus.status : null;
        error = summariseFailure(results);
      }
    }
  }

  await db.recordDeliveryOutcome(env.DB, delivery.id, { state, pushStatus, attempts: results.length, sentAt, error });
  await logEvent(env, nowMs, `delivery_${state}`, delivery.id, {
    reminder: delivery.reminder_id,
    scheduled_for: Number(delivery.scheduled_for),
    push_status: pushStatus,
    error,
    subscriptions: subs.length,
  });
  return { state, push_status: pushStatus, error, results };
}

// ---------------------------------------------------------------- serialisers

function serialiseDelivery(d, nowMs) {
  if (!d) return null;
  const createdMs = Date.parse(d.created_at);
  return {
    ...d,
    scheduled_for: d.scheduled_for == null ? null : Number(d.scheduled_for),
    held_until: d.held_until == null ? null : Number(d.held_until),
    // See STALE_SEND_MS: a send that started and never recorded how it ended.
    outcome_unknown: d.state === 'scheduled' && Number.isFinite(createdMs) && nowMs - createdMs > STALE_SEND_MS,
  };
}

function serialiseReminder(row) {
  return {
    id: row.id,
    text: row.text,
    scope: row.scope,
    item_id: row.item_id ?? null,
    time_zone: row.time_zone,
    local_date: row.local_date,
    local_time: row.local_time,
    recurrence: row.recurrence,
    next_fire_at: row.next_fire_at == null ? null : Number(row.next_fire_at),
    next_fire_label: row.next_fire_at == null ? null : safeFormatLocal(Number(row.next_fire_at), row.time_zone),
    state: row.state,
    created_at: row.created_at,
    sample: row.sample,
  };
}

function firstFireFromStored(row) {
  if (row.next_fire_at == null) return null;
  const instantMs = Number(row.next_fire_at);
  return { instantMs, localLabel: safeFormatLocal(instantMs, row.time_zone) };
}

// ---------------------------------------------------------------- captures

// Interpretation is relative to when the words were captured: the phone's clock for an offline capture
// synced later (if plausible), else the time the server received it. Deterministic for a stored capture.
function interpretBasisMs(capture) {
  const received = Date.parse(capture.received_at);
  const client = capture.client_created_at ? Date.parse(capture.client_created_at) : NaN;
  if (Number.isFinite(client) && client <= received + 5 * 60 * 1000 && client >= received - 30 * DAY_MS) return client;
  return received;
}

// Proposals for a capture (idempotent per ordinal). With no known time zone there are no proposals: dates
// cannot be read without one, and none is invented. The capture still waits in the inbox for review.
async function proposalsFor(env, nowMs, capture) {
  let proposals = [];
  if (capture.time_zone) {
    try {
      proposals = interpret(capture.text, { now: interpretBasisMs(capture), timeZone: capture.time_zone }).proposals;
    } catch (err) {
      await logEvent(env, nowMs, 'interpret_failed', capture.id, { err: (err && err.name) || 'Error' });
      proposals = [];
    }
  }
  return db.saveProposals(env.DB, capture.id, proposals, capture.scope);
}

function clientCreatedAtFrom(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 64) {
    throw new HttpError(400, 'invalid_client_created_at', 'client_created_at must be a short string');
  }
  return value;
}

async function postCapture(ctx) {
  const body = await readJson(ctx.request);
  if (typeof body.id !== 'string' || !CAPTURE_ID_RE.test(body.id)) {
    throw new HttpError(400, 'invalid_id', 'id must match ^[A-Za-z0-9_-]{8,80}$');
  }
  const text = requireText(body.text);
  const scope = requireScope(body.scope);
  const clientCreatedAt = clientCreatedAtFrom(body.client_created_at);
  const deviceTz = validTimeZone(body.time_zone, ctx.nowMs);
  const timeZone = deviceTz || (await lastKnownTimeZone(ctx));
  const { capture, duplicate, deleted } = await db.saveCapture(
    ctx.env.DB,
    { id: body.id, text, scope, source: 'app', clientCreatedAt, timeZone },
    iso(ctx.nowMs),
  );
  await rememberTimeZone(ctx, deviceTz);
  if (deleted) {
    // A late retry of a capture he deleted: answer 200 so the outbox marks it synced; nothing is stored.
    await logEvent(ctx.env, ctx.nowMs, 'capture_received', body.id, { source: 'app', scope, duplicate: true, deleted: true, identity: ctx.identity.kind });
    return json(200, { capture: null, duplicate: true, deleted: true, proposals: [] });
  }
  const proposals = await proposalsFor(ctx.env, ctx.nowMs, capture);
  await logEvent(ctx.env, ctx.nowMs, 'capture_received', capture.id, {
    source: 'app',
    scope,
    duplicate,
    proposals: proposals.length,
    time_zone_known: !!capture.time_zone,
    identity: ctx.identity.kind,
  });
  const chaos = await maybeChaos(ctx, capture.id);
  if (chaos) return chaos;
  return json(duplicate ? 200 : 201, { capture, duplicate, proposals });
}

// Spike rules: service identity, scope defaults to personal, dedup by client_ref or by a minute bucket.
async function postShortcutCapture(ctx) {
  const body = await readJson(ctx.request);
  const text = requireText(body.text);
  const scope = body.scope === undefined || body.scope === null ? 'personal' : requireScope(body.scope);
  let id;
  let dedup;
  if (typeof body.client_ref === 'string' && CLIENT_REF_RE.test(body.client_ref)) {
    id = 'sc_' + body.client_ref;
    dedup = 'client_ref';
  } else {
    const bucket = Math.floor(ctx.nowMs / 60000);
    id = 'sc_' + (await sha256Hex(`${text}|${bucket}`)).slice(0, 24);
    dedup = 'minute_bucket';
  }
  const timeZone = validTimeZone(body.time_zone, ctx.nowMs) || (await lastKnownTimeZone(ctx));
  const { capture, duplicate, deleted } = await db.saveCapture(
    ctx.env.DB,
    { id, text, scope, source: 'shortcut', clientCreatedAt: null, timeZone },
    iso(ctx.nowMs),
  );
  if (deleted) {
    await logEvent(ctx.env, ctx.nowMs, 'capture_received', id, { source: 'shortcut', scope, duplicate: true, deleted: true, dedup, identity: ctx.identity.kind });
    return json(200, { ok: true, id, duplicate: true, deleted: true, message: 'This capture was deleted earlier. Nothing was saved.', dedup, proposals: 0 });
  }
  const proposals = await proposalsFor(ctx.env, ctx.nowMs, capture);
  await logEvent(ctx.env, ctx.nowMs, 'capture_received', id, {
    source: 'shortcut',
    scope,
    duplicate,
    dedup,
    proposals: proposals.length,
    identity: ctx.identity.kind,
  });
  const chaos = await maybeChaos(ctx, id);
  if (chaos) return chaos;
  const out = { ok: true, id, duplicate, message: 'Saved to Harrison OS', dedup, proposals: proposals.length };
  if (dedup === 'minute_bucket') {
    out.dedup_note =
      'No valid client_ref (6-60 of A-Z a-z 0-9 _ -). Dedup is lossy: the same text within the same UTC minute ' +
      'counts as one capture, and a retry in a later minute is saved again.';
  }
  return json(duplicate ? 200 : 201, out);
}

async function getInbox(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const rows = await db.getInbox(ctx.env.DB, scope);
  return json(200, { scope, captures: rows.map(({ capture, proposals }) => ({ ...capture, proposals })) });
}

// The UI keys reminder edits as remind_on / remind_time; db.js reads local_date / local_time.
function reviewEdits(edits) {
  if (edits === undefined || edits === null) return {};
  if (typeof edits !== 'object' || Array.isArray(edits)) throw new HttpError(400, 'invalid_edits', 'edits must be an object');
  const out = { ...edits };
  if (Object.prototype.hasOwnProperty.call(out, 'remind_on')) {
    out.local_date = out.remind_on;
    delete out.remind_on;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'remind_time')) {
    out.local_time = out.remind_time;
    delete out.remind_time;
  }
  return out;
}

async function postReview(ctx, captureId) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const accept = body.accept === undefined ? [] : body.accept;
  const drop = body.drop === undefined ? [] : body.drop;
  if (!Array.isArray(accept) || !Array.isArray(drop)) throw new HttpError(400, 'invalid_review', 'accept and drop must be arrays');
  if (accept.length > 100 || drop.length > 100) throw new HttpError(400, 'invalid_review', 'Too many proposals');
  const acceptOut = accept.map((a) => {
    if (Number.isInteger(a)) return { ordinal: a, edits: {} };
    if (!a || typeof a !== 'object' || !Number.isInteger(a.ordinal)) {
      throw new HttpError(400, 'invalid_review', 'accept entries need an integer ordinal');
    }
    return { ordinal: a.ordinal, edits: reviewEdits(a.edits) };
  });
  if (!drop.every((o) => Number.isInteger(o))) throw new HttpError(400, 'invalid_review', 'drop must list integer ordinals');
  const res = await db.reviewCapture(
    ctx.env.DB,
    captureId,
    { accept: acceptOut, drop, keepAsNote: body.keepAsNote === true },
    scope,
    iso(ctx.nowMs),
  );
  await logEvent(ctx.env, ctx.nowMs, 'capture_reviewed', captureId, {
    scope,
    accepted: acceptOut.length,
    dropped: drop.length,
    keep_as_note: body.keepAsNote === true,
    items: res.items.length,
    reminders: res.reminders.length,
    review_state: res.capture && res.capture.review_state,
  });
  return json(200, {
    capture: res.capture,
    items: res.items,
    reminders: res.reminders.map(serialiseReminder),
    changeIds: res.changeIds,
  });
}

async function deleteCaptureRoute(ctx, captureId) {
  const scope = queryScope(ctx);
  const counts = await db.deleteCapture(ctx.env.DB, captureId, scope, iso(ctx.nowMs));
  await logEvent(ctx.env, ctx.nowMs, 'capture_deleted', captureId, { scope, ...counts });
  return json(200, { deleted: counts });
}

// ---------------------------------------------------------------- today

async function getToday(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const asked = ctx.url.searchParams.get('tz');
  const deviceTz = validTimeZone(asked, ctx.nowMs);
  if (asked && !deviceTz) throw new HttpError(400, 'invalid_time_zone', 'tz must be an IANA zone name');
  const timeZone = deviceTz || (await lastKnownTimeZone(ctx));
  if (!timeZone) throw new HttpError(400, 'time_zone_required', 'tz is required (an IANA zone name)');
  const todayOn = instantToZonedParts(ctx.nowMs, timeZone).date;
  const rows = await db.listForToday(ctx.env.DB, scope, todayOn);
  const lastOpenAt = await db.getMeta(ctx.env.DB, META_LAST_OPEN);
  const today = buildToday(rows, { todayOn, nowMs: ctx.nowMs, timeZone, lastOpenAt, scope });
  // Set after returnView was computed from the previous value.
  await db.setMeta(ctx.env.DB, META_LAST_OPEN, iso(ctx.nowMs));
  await rememberTimeZone(ctx, deviceTz);
  return json(200, { ...today, todayOn, timeZone, scope });
}

// ---------------------------------------------------------------- items

async function getItems(ctx) {
  const scope = queryScope(ctx);
  const q = ctx.url.searchParams;
  const items = await db.listItems(ctx.env.DB, scope, {
    kind: q.get('kind') || null,
    state: q.get('state') || null,
    projectId: q.get('project_id') || null,
    limit: clampInt(q.get('limit'), { min: 1, max: 500, fallback: 200 }),
  });
  return json(200, { scope, items });
}

async function postItem(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const nowIso = iso(ctx.nowMs);
  const res =
    body.kind === 'decision'
      ? await db.createDecision(ctx.env.DB, body, scope, nowIso)
      : await db.createItem(ctx.env.DB, body, scope, nowIso);
  await logEvent(ctx.env, ctx.nowMs, 'item_created', res.item.id, { scope, kind: res.item.kind, duplicate: !!res.duplicate });
  const out = { item: res.item, changeId: res.changeId, duplicate: !!res.duplicate };
  if (res.superseded) out.superseded = res.superseded;
  return json(res.duplicate ? 200 : 201, out);
}

async function patchItem(ctx, id) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const res = await db.updateItem(ctx.env.DB, id, body, scope, iso(ctx.nowMs));
  await logEvent(ctx.env, ctx.nowMs, 'item_updated', id, { scope, change: res.changeId, fields: Object.keys(body).filter((k) => k !== 'scope') });
  return json(200, { item: res.item, changeId: res.changeId });
}

async function itemAction(ctx, id, action) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const nowIso = iso(ctx.nowMs);
  let res;
  if (action === 'complete') res = await db.completeItem(ctx.env.DB, id, scope, nowIso);
  else if (action === 'reopen') res = await db.reopenItem(ctx.env.DB, id, scope, nowIso);
  else if (action === 'archive') res = await db.archiveItem(ctx.env.DB, id, scope, nowIso);
  else if (action === 'reply') res = await db.recordReply(ctx.env.DB, id, scope, nowIso);
  else if (action === 'snooze') {
    const on = body.follow_up_on ?? body.followUpOn;
    if (typeof on !== 'string' || !DATE_RE.test(on)) throw new HttpError(400, 'invalid_follow_up_on', 'follow_up_on must be YYYY-MM-DD');
    res = await db.snoozeFollowUp(ctx.env.DB, id, on, scope, nowIso);
  } else {
    throw new HttpError(404, 'not_found', 'Not found');
  }
  await logEvent(ctx.env, ctx.nowMs, `item_${action}`, id, { scope, change: res.changeId });
  return json(200, { item: res.item, changeId: res.changeId });
}

async function postUndo(ctx, changeId) {
  if (!CHANGE_ID_RE.test(changeId)) throw new HttpError(400, 'invalid_change_id', 'change id must be a number');
  const body = await readJson(ctx.request);
  const raw = body.scope ?? ctx.url.searchParams.get('scope');
  // Undo is addressed by the change's own id; a scope, when sent, must match the change's scope.
  const scope = raw === undefined || raw === null || raw === '' ? undefined : requireScope(raw);
  const res = await db.undoChange(ctx.env.DB, Number(changeId), iso(ctx.nowMs), scope);
  await logEvent(ctx.env, ctx.nowMs, 'change_undone', String(changeId), { entity: res.entity });
  return json(200, { undone: res });
}

// ---------------------------------------------------------------- projects

async function getProjects(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  return json(200, { scope, projects: await db.listProjects(ctx.env.DB, scope) });
}

async function postProject(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const res = await db.createProject(ctx.env.DB, body, scope, iso(ctx.nowMs));
  await logEvent(ctx.env, ctx.nowMs, 'project_created', res.project.id, { scope, duplicate: !!res.duplicate });
  return json(res.duplicate ? 200 : 201, { project: res.project, changeId: res.changeId, duplicate: !!res.duplicate });
}

async function getProjectRoute(ctx, id) {
  const scope = queryScope(ctx);
  const res = await db.getProject(ctx.env.DB, id, scope);
  if (!res) throw new HttpError(404, 'not_found', 'No such project');
  return json(200, res);
}

async function patchProject(ctx, id) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const res = await db.updateProject(ctx.env.DB, id, body, scope, iso(ctx.nowMs));
  await logEvent(ctx.env, ctx.nowMs, 'project_updated', id, { scope, change: res.changeId });
  return json(200, { project: res.project, changeId: res.changeId });
}

async function getPrefill(ctx, id) {
  const scope = queryScope(ctx);
  return json(200, { prefill: await db.checkpointPrefill(ctx.env.DB, id, scope) });
}

async function postCheckpoint(ctx, id) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const fields = body.fields === undefined ? null : body.fields;
  if (fields !== null && (typeof fields !== 'object' || Array.isArray(fields))) {
    throw new HttpError(400, 'invalid_fields', 'fields must be an object or null');
  }
  const res = await db.saveCheckpoint(ctx.env.DB, id, fields, scope, iso(ctx.nowMs));
  await logEvent(ctx.env, ctx.nowMs, 'checkpoint_saved', id, { scope, one_tap: fields === null, duplicate: !!res.duplicate });
  return json(res.duplicate ? 200 : 201, res);
}

// ---------------------------------------------------------------- search and export

async function getSearch(ctx) {
  const scope = queryScope(ctx);
  const q = ctx.url.searchParams.get('q');
  if (typeof q !== 'string' || q.length > MAX_QUERY) throw new HttpError(400, 'invalid_q', `q must be 0 to ${MAX_QUERY} characters`);
  const results = await db.search(ctx.env.DB, q, scope);
  return json(200, { scope, results });
}

async function getExport(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const data = await db.exportData(ctx.env.DB, scope);
  const counts = Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length]));
  await logEvent(ctx.env, ctx.nowMs, 'export', null, { scope, counts });
  const filename = `harrison-os-${scope}-${iso(ctx.nowMs).slice(0, 10)}.json`;
  return json(200, { ...data, exported_at: iso(ctx.nowMs) }, { 'Content-Disposition': `attachment; filename="${filename}"` });
}

// ---------------------------------------------------------------- reminders

async function postReminder(ctx) {
  const { env, nowMs } = ctx;
  const body = await readJson(ctx.request);
  if (typeof body.id !== 'string' || !CAPTURE_ID_RE.test(body.id)) {
    throw new HttpError(400, 'invalid_id', 'id must match ^[A-Za-z0-9_-]{8,80}$');
  }
  const scope = requireScope(body.scope);
  const text = requireText(body.text, 'text', 4000);
  if (typeof body.local_date !== 'string' || !DATE_RE.test(body.local_date)) {
    throw new HttpError(400, 'invalid_local_date', 'local_date must be YYYY-MM-DD');
  }
  if (typeof body.local_time !== 'string' || !TIME_RE.test(body.local_time)) {
    throw new HttpError(400, 'invalid_local_time', 'local_time must be HH:MM');
  }
  const timeZone = requireTimeZone(body.time_zone, nowMs);
  const recurrence = body.recurrence === undefined ? 'none' : body.recurrence;
  if (!RECURRENCES.has(recurrence)) throw new HttpError(400, 'invalid_recurrence', "recurrence must be 'none' or 'daily'");
  const itemId = body.item_id ?? body.itemId ?? null;
  if (itemId !== null && (typeof itemId !== 'string' || !new RegExp(`^${ID}$`).test(itemId))) {
    throw new HttpError(400, 'invalid_item_id', 'item_id is not a valid id');
  }
  const res = await db.createReminder(
    env.DB,
    { id: body.id, text, localDate: body.local_date, localTime: body.local_time, timeZone, recurrence, itemId },
    scope,
    iso(nowMs),
  );
  if (!res.duplicate) {
    await logEvent(env, nowMs, 'reminder_created', body.id, {
      recurrence,
      scope,
      linked_item: itemId != null,
      next_fire_at: Number(res.reminder.next_fire_at),
      adjustment: res.firstFire ? res.firstFire.adjustment : null,
      identity: ctx.identity.kind,
    });
  }
  const chaos = await maybeChaos(ctx, body.id);
  if (chaos) return chaos;
  const firstFire = res.firstFire
    ? { instantMs: res.firstFire.instantMs, localLabel: safeFormatLocal(res.firstFire.instantMs, timeZone), adjustment: res.firstFire.adjustment }
    : firstFireFromStored(res.reminder);
  return json(res.duplicate ? 200 : 201, {
    reminder: serialiseReminder(res.reminder),
    first_fire: firstFire,
    route: { push_subscriptions: await db.countPushSubscriptions(env.DB) },
    duplicate: !!res.duplicate,
  });
}

async function getReminders(ctx) {
  const scope = queryScope(ctx);
  const limit = clampInt(ctx.url.searchParams.get('limit'), { min: 1, max: 200, fallback: 100 });
  const rows = await db.listReminders(ctx.env.DB, scope, { limit });
  return json(200, {
    scope,
    items: rows.map((r) => ({ ...serialiseReminder(r), deliveries: r.deliveries.map((d) => serialiseDelivery(d, ctx.nowMs)) })),
  });
}

async function postCancelReminder(ctx, id) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope ?? ctx.url.searchParams.get('scope'));
  const res = await db.cancelReminder(ctx.env.DB, id, scope);
  if (res.cancelled) await logEvent(ctx.env, ctx.nowMs, 'reminder_cancelled', id, { previous_state: res.previousState });
  return json(200, { reminder: serialiseReminder(res.reminder), cancelled: res.cancelled });
}

// ---------------------------------------------------------------- push routes

function decoded(b64) {
  try {
    return b64urlDecode(b64);
  } catch {
    return null;
  }
}

async function getPublicKey(ctx) {
  const publicKey = typeof ctx.env.VAPID_PUBLIC_KEY === 'string' ? ctx.env.VAPID_PUBLIC_KEY.trim() : '';
  if (!publicKey) throw new HttpError(503, 'push_not_configured', 'VAPID_PUBLIC_KEY is not set');
  return json(200, { publicKey });
}

async function postSubscription(ctx) {
  const { env, nowMs } = ctx;
  const body = await readJson(ctx.request);
  const endpoint = body.endpoint;
  const allowTestEndpoints = env.ALLOW_TEST_PUSH_ENDPOINT === '1' && isLoopbackHostname(ctx.url.hostname);
  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint, { allowTestEndpoints })) {
    throw new HttpError(400, 'endpoint_not_allowed', 'This push endpoint is not on the allowlist');
  }
  const keys = body.keys && typeof body.keys === 'object' ? body.keys : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim().replace(/=+$/, '') : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim().replace(/=+$/, '') : '';
  const pk = decoded(p256dh);
  const au = decoded(auth);
  if (!pk || pk.length !== 65 || pk[0] !== 4 || !au || au.length !== 16) {
    throw new HttpError(400, 'invalid_keys', 'keys.p256dh must be a 65-byte P-256 point and keys.auth 16 bytes (base64url)');
  }
  const ua = typeof body.ua === 'string' ? body.ua.slice(0, 300) : null;
  const id = await sha256Hex(endpoint);
  const res = await db.upsertPushSubscription(env.DB, { id, endpoint, p256dh, auth, ua }, iso(nowMs));
  await logEvent(env, nowMs, 'subscription_upserted', id.slice(0, 12), { created: res.created, push_host: new URL(endpoint).hostname });
  return json(201, { id });
}

async function deleteSubscription(ctx) {
  const { env, nowMs } = ctx;
  const body = await readJson(ctx.request);
  if (typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 2048) {
    throw new HttpError(400, 'invalid_endpoint', 'endpoint is required');
  }
  const id = await sha256Hex(body.endpoint);
  const deleted = await db.deletePushSubscription(env.DB, id);
  await logEvent(env, nowMs, 'subscription_deleted', id.slice(0, 12), { deleted });
  return json(200, { deleted });
}

async function postPushTest(ctx) {
  const { env, nowMs } = ctx;
  const body = await readJsonLenient(ctx.request);
  const timeZone = validTimeZone(body.time_zone, nowMs) || 'UTC';
  const delivery = {
    id: newDeliveryId(),
    reminder_id: 'test-' + randomHex(8),
    scheduled_for: nowMs,
    local_label: safeFormatLocal(nowMs, timeZone),
  };
  await db.insertDelivery(
    env.DB,
    { id: delivery.id, reminderId: delivery.reminder_id, scheduledFor: delivery.scheduled_for, localLabel: delivery.local_label },
    iso(nowMs),
  );
  await logEvent(env, nowMs, 'delivery_scheduled', delivery.id, { reminder: delivery.reminder_id, test: true });
  const out = await sendDelivery(env, nowMs, delivery, 'Test notification');
  return json(200, {
    delivery_id: delivery.id,
    reminder_id: delivery.reminder_id,
    state: out.state,
    push_status: out.push_status,
    error: out.error,
    results: out.results,
  });
}

// ---------------------------------------------------------------- delivery beacon and ack

async function postReceived(ctx, id) {
  const { env, nowMs } = ctx;
  const body = await readJsonLenient(ctx.request);
  const row = await db.getDelivery(env.DB, id);
  if (!row) throw new HttpError(404, 'not_found', 'No such delivery');
  const after = await db.markDeliveryReceived(env.DB, id, iso(nowMs));
  if (row.received_at == null) {
    const sentAtMs = Number.isFinite(body.sent_at_ms) ? body.sent_at_ms : null;
    await logEvent(env, nowMs, 'delivery_received', id, {
      reminder: row.reminder_id,
      previous_state: row.state,
      push_to_beacon_ms: sentAtMs != null ? nowMs - sentAtMs : null,
      scheduled_to_beacon_ms: nowMs - Number(row.scheduled_for),
    });
  }
  return json(200, { delivery: serialiseDelivery(after, nowMs) });
}

async function postAck(ctx, id) {
  const { env, nowMs } = ctx;
  const body = await readJson(ctx.request);
  if (!ACK_VIA.has(body.via)) throw new HttpError(400, 'invalid_via', "via must be 'notification' or 'in_app'");
  const row = await db.getDelivery(env.DB, id);
  if (!row) throw new HttpError(404, 'not_found', 'No such delivery');
  const after = await db.acknowledgeDelivery(env.DB, id, body.via, iso(nowMs));
  if (row.acknowledged_at == null) {
    await logEvent(env, nowMs, 'delivery_acknowledged', id, {
      reminder: row.reminder_id,
      via: body.via,
      previous_state: row.state,
      beacon_seen: row.received_at != null,
      scheduled_to_ack_ms: nowMs - Number(row.scheduled_for),
    });
  }
  return json(200, { delivery: serialiseDelivery(after, nowMs) });
}

// ---------------------------------------------------------------- evidence, settings, session

async function getEvidence(ctx) {
  const limit = clampInt(ctx.url.searchParams.get('limit'), { min: 1, max: 500, fallback: 200 });
  return json(200, { events: await db.listEvents(ctx.env.DB, limit), counts: await db.deliveryStats(ctx.env.DB) });
}

function quietHoursResponse(qh) {
  return { enabled: qh.enabled, start: qh.start, end: qh.end, time_zone: qh.time_zone, label: QUIET_HOURS_LABEL };
}

async function getQuietHoursRoute(ctx) {
  return json(200, quietHoursResponse(await getQuietHours(ctx.env, ctx.nowMs)));
}

async function putQuietHours(ctx) {
  const body = await readJson(ctx.request);
  if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'invalid_enabled', 'enabled must be true or false');
  if (typeof body.start !== 'string' || !TIME_RE.test(body.start)) throw new HttpError(400, 'invalid_start', 'start must be HH:MM');
  if (typeof body.end !== 'string' || !TIME_RE.test(body.end)) throw new HttpError(400, 'invalid_end', 'end must be HH:MM');
  if (body.start === body.end) throw new HttpError(400, 'invalid_window', 'start and end must differ');
  const timeZone = requireTimeZone(body.time_zone, ctx.nowMs);
  const qh = { enabled: body.enabled, start: body.start, end: body.end, time_zone: timeZone };
  await db.kvPut(ctx.env.DB, KV_QUIET_HOURS, JSON.stringify(qh));
  await logEvent(ctx.env, ctx.nowMs, 'settings_test_quiet_hours', null, qh);
  return json(200, quietHoursResponse(qh));
}

async function postChaos(ctx) {
  const body = await readJson(ctx.request);
  if (body.mode !== 'commit_then_503') throw new HttpError(400, 'invalid_mode', "mode must be 'commit_then_503'");
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 0 || count > 50) throw new HttpError(400, 'invalid_count', 'count must be 0..50');
  await db.kvPut(ctx.env.DB, KV_CHAOS, String(count));
  await logEvent(ctx.env, ctx.nowMs, 'chaos_armed', null, { mode: body.mode, count });
  return json(200, { mode: body.mode, remaining: count });
}

async function postAuthMode(ctx) {
  if (ctx.env.DEV_ALLOW_UNAUTH !== '1') throw new HttpError(404, 'not_found', 'Not found');
  const body = await readJson(ctx.request);
  if (!['normal', 'expired_401', 'redirect_302'].includes(body.mode)) {
    throw new HttpError(400, 'invalid_mode', "mode must be 'normal', 'expired_401' or 'redirect_302'");
  }
  await db.kvPut(ctx.env.DB, KV_AUTH_MODE, body.mode);
  await logEvent(ctx.env, ctx.nowMs, 'auth_mode_set', null, { mode: body.mode });
  return json(200, { mode: body.mode });
}

async function getSession(ctx) {
  const id = ctx.identity;
  const identity = { kind: id.kind };
  if (id.emailMasked) identity.emailMasked = id.emailMasked;
  if (Number.isFinite(id.expMs)) identity.expMs = id.expMs;
  return json(200, {
    identity,
    serverTime: ctx.nowMs,
    build: ctx.env.BUILD_ID || 'dev',
    testHooks: ctx.hooks,
  });
}

// ---------------------------------------------------------------- router

const r = (pattern) => new RegExp(`^${pattern}$`);

export const ROUTES = [
  ['GET', r('/api/session'), getSession],
  ['POST', r('/api/captures'), postCapture],
  ['POST', r('/api/shortcut/capture'), postShortcutCapture],
  ['GET', r('/api/inbox'), getInbox],
  ['POST', r(`/api/captures/(${CAP})/review`), postReview],
  ['DELETE', r(`/api/captures/(${CAP})`), deleteCaptureRoute],
  ['GET', r('/api/today'), getToday],
  ['GET', r('/api/items'), getItems],
  ['POST', r('/api/items'), postItem],
  ['PATCH', r(`/api/items/(${ID})`), patchItem],
  ['POST', r(`/api/items/(${ID})/(complete|reopen|archive|reply|snooze)`), itemAction],
  ['POST', r('/api/undo/([^/]{1,40})'), postUndo],
  ['GET', r('/api/projects'), getProjects],
  ['POST', r('/api/projects'), postProject],
  ['GET', r(`/api/projects/(${ID})`), getProjectRoute],
  ['PATCH', r(`/api/projects/(${ID})`), patchProject],
  ['GET', r(`/api/projects/(${ID})/checkpoint/prefill`), getPrefill],
  ['POST', r(`/api/projects/(${ID})/checkpoint`), postCheckpoint],
  ['GET', r('/api/search'), getSearch],
  ['GET', r('/api/export'), getExport],
  ['POST', r('/api/reminders'), postReminder],
  ['GET', r('/api/reminders'), getReminders],
  ['POST', r(`/api/reminders/(${ID})/cancel`), postCancelReminder],
  ['GET', r('/api/push/public-key'), getPublicKey],
  ['POST', r('/api/push/subscriptions'), postSubscription],
  ['DELETE', r('/api/push/subscriptions'), deleteSubscription],
  ['POST', r('/api/push/test'), postPushTest],
  ['POST', r(`/api/deliveries/(${ID})/received`), postReceived],
  ['POST', r(`/api/deliveries/(${ID})/ack`), postAck],
  ['GET', r('/api/evidence'), getEvidence],
  ['GET', r('/api/settings/test-quiet-hours'), getQuietHoursRoute],
  ['PUT', r('/api/settings/test-quiet-hours'), putQuietHours],
  ['POST', r('/api/test/chaos'), postChaos],
  ['POST', r('/api/test/auth-mode'), postAuthMode],
];

/**
 * Handles one /api request. Options exist for tests: nowMs (the clock) and authenticateImpl (an identity
 * source in place of Cloudflare Access; authorizeRoute and the CSRF rule still apply to what it returns).
 */
export async function handleApi(request, env, url, { nowMs = Date.now(), authenticateImpl = authenticate } = {}) {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const hooks = testHooksEnabled(env, url);
  const isTestPath = path === '/api/test' || path.startsWith('/api/test/');

  if (isTestPath && !hooks) return apiError(404, 'not_found', 'Not found');
  if (!env.DB) return apiError(503, 'db_not_configured', 'The database binding is missing');

  // Local simulation of an expired Access session (test hook, loopback + DEV_ALLOW_UNAUTH only).
  if (hooks && env.DEV_ALLOW_UNAUTH === '1' && !isTestPath) {
    const mode = await db.kvGet(env.DB, KV_AUTH_MODE, nowMs);
    if (mode === 'expired_401') return apiError(401, 'expired', 'TEST: simulated Access session expiry');
    if (mode === 'redirect_302') {
      // Real Access redirects an expired session to the team's login host, i.e. cross-origin.
      // '.invalid' never resolves (RFC 6761), so a client that wrongly follows it can't reach anything.
      return new Response(null, {
        status: 302,
        headers: {
          Location: 'https://access-login.invalid/cdn-cgi/access/login?simulated=1',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
  }

  let identity;
  try {
    identity = await authenticateImpl(request, env, { nowMs });
  } catch (err) {
    if (err && Number.isInteger(err.status) && typeof err.code === 'string') {
      console.log(JSON.stringify({ evt: 'auth_denied', status: err.status, code: err.code }));
      const message = err.status === 401 ? 'Sign in again' : err.status === 403 ? 'Not allowed' : 'Sign-in is not configured';
      return apiError(err.status, err.code, message);
    }
    throw err;
  }
  if (!authorizeRoute(identity, method, path)) return apiError(403, 'forbidden', 'This identity may not call this route');
  // CSRF: Access authenticates the browser by cookie, so a cross-site form POST would arrive signed in.
  // A cross-origin page can only add X-Requested-With after a CORS preflight, which this Worker never
  // approves. Every first-party client sends it; the Shortcut's service token is not a cookie.
  if (method !== 'GET' && method !== 'HEAD' && identity.kind !== 'service' && request.headers.get('X-Requested-With') !== 'XMLHttpRequest') {
    return apiError(403, 'csrf', 'Missing X-Requested-With');
  }

  const ctx = { request, env, url, nowMs, identity, hooks, path };
  let pathMatched = false;
  for (const [m, re, handler] of ROUTES) {
    const match = path.match(re);
    if (!match) continue;
    pathMatched = true;
    if (m !== method) continue;
    try {
      return await handler(ctx, ...match.slice(1));
    } catch (err) {
      if (err instanceof HttpError) return apiError(err.status, err.code, err.message);
      const mapped = dbErrorResponse(err);
      if (mapped) return mapped;
      throw err;
    }
  }
  if (pathMatched) return apiError(405, 'method_not_allowed', 'Method not allowed');
  return apiError(404, 'not_found', 'Not found');
}

// ---------------------------------------------------------------- the Worker (fetch + scheduled)

// Same as the spike, plus Google Fonts (Archivo and Inter): stylesheets from fonts.googleapis.com and
// font files from fonts.gstatic.com.
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; " +
  "manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

async function serveAsset(request, env, url) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set('Content-Security-Policy', CSP);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'no-referrer');
  out.headers.set('X-Frame-Options', 'DENY');
  if (url.pathname === '/sw.js') out.headers.set('Cache-Control', 'no-cache');
  return out;
}

/**
 * Builds the Worker handler ({ fetch, scheduled }). src/worker.js default-exports createWorker() with the
 * real clock and Cloudflare Access. Tests pass a fixed clock (now) or another identity source
 * (authenticateImpl); authorizeRoute and the CSRF rule still apply to whatever identity it returns.
 */
export function createWorker({ now = () => Date.now(), authenticateImpl = authenticate } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        try {
          return await handleApi(request, env, url, { nowMs: now(), authenticateImpl });
        } catch (err) {
          if (err instanceof HttpError) return apiError(err.status, err.code, err.message);
          console.error(JSON.stringify({ evt: 'api_error', path: url.pathname, err: err && err.name }));
          return apiError(500, 'internal', 'Internal error');
        }
      }
      return serveAsset(request, env, url);
    },

    async scheduled(controller, env) {
      try {
        await runScheduled(env, now());
      } catch (err) {
        console.error(JSON.stringify({ evt: 'cron_error', err: err && err.name }));
      }
    },
  };
}

// ---------------------------------------------------------------- scheduled delivery

async function markFailed(env, nowMs, id, error) {
  try {
    await db.markDeliveryFailed(env.DB, id, error);
    await logEvent(env, nowMs, 'delivery_failed', id, { error });
  } catch (err) {
    console.error(JSON.stringify({ evt: 'mark_failed_error', err: err && err.name }));
  }
}

function nextFireAfter(reminder, scheduledFor, nowMs) {
  if (reminder.recurrence !== 'daily') return { next_fire_at: null };
  // Skips occurrences that were missed while the cron was not running (no catch-up storm).
  const n = nextDailyOccurrence({ time: reminder.local_time, timeZone: reminder.time_zone, afterMs: Math.max(scheduledFor, nowMs) });
  return { next_fire_at: n.instantMs, adjustment: n.adjustment };
}

/**
 * One cron run. At most CRON_BATCH_CAP sends (released holds plus due reminders). A delivery row is
 * inserted before its send (UNIQUE(reminder_id, scheduled_for) guards overlapping runs), and the reminder
 * is advanced only once that insert ran. If the invocation is stopped mid-send the row stays 'scheduled'
 * and is reported as outcome unknown, never re-sent.
 */
export async function runScheduled(env, nowMs = Date.now()) {
  const startedMs = Date.now();
  const stats = { released: 0, extended: 0, fired: 0, held: 0, guarded: 0, errors: 0 };
  let budget = CRON_BATCH_CAP;
  const qh = await getQuietHours(env, nowMs);

  // 1. Release held deliveries whose hold has ended.
  const held = await db.listReleasableDeliveries(env.DB, nowMs, budget);
  for (const d of held) {
    if (budget <= 0) break;
    try {
      const stillHeld = quietHoldUntil(qh, nowMs);
      if (stillHeld != null) {
        await db.setDeliveryHeldUntil(env.DB, d.id, stillHeld, Number(d.held_until));
        await logEvent(env, nowMs, 'delivery_hold_extended', d.id, { held_until: stillHeld });
        stats.extended++;
        continue;
      }
      // Claim with a short lease so an overlapping cron run cannot release the same row.
      const claimed = await db.setDeliveryHeldUntil(env.DB, d.id, nowMs + HOLD_LEASE_MS, Number(d.held_until));
      if (!claimed) continue;
      budget--;
      stats.released++;
      await logEvent(env, nowMs, 'delivery_released', d.id, { reminder: d.reminder_id, held_until: Number(d.held_until) });
      if (d.text == null || d.reminder_state === 'cancelled') {
        await markFailed(env, nowMs, d.id, 'reminder_cancelled_while_held');
      } else {
        await sendDelivery(env, nowMs, d, d.text);
      }
      await db.setDeliveryHeldUntil(env.DB, d.id, Number(d.held_until));
    } catch (err) {
      stats.errors++;
      console.error(JSON.stringify({ evt: 'release_error', delivery: d.id, err: err && err.name }));
      await markFailed(env, nowMs, d.id, 'internal_error');
    }
  }

  // 2. Fire due reminders, one delivery per occurrence.
  if (budget > 0) {
    const due = await db.listDueReminders(env.DB, nowMs, budget);
    for (const rem of due) {
      const scheduledFor = Number(rem.next_fire_at);
      const delivery = {
        id: newDeliveryId(),
        reminder_id: rem.id,
        scheduled_for: scheduledFor,
        local_label: safeFormatLocal(scheduledFor, rem.time_zone),
      };
      budget--;
      let inserted = false;
      let insertRan = false;
      try {
        const ins = await db.insertDelivery(
          env.DB,
          { id: delivery.id, reminderId: rem.id, scheduledFor, localLabel: delivery.local_label },
          iso(nowMs),
        );
        insertRan = true;
        inserted = ins.inserted;
        if (!inserted) {
          stats.guarded++;
          await logEvent(env, nowMs, 'delivery_duplicate_guard', rem.id, { scheduled_for: scheduledFor });
        } else {
          await logEvent(env, nowMs, 'delivery_scheduled', delivery.id, {
            reminder: rem.id,
            scheduled_for: scheduledFor,
            fire_lag_ms: nowMs - scheduledFor,
          });
          const holdUntil = quietHoldUntil(qh, nowMs);
          if (holdUntil != null) {
            await db.holdDelivery(env.DB, delivery.id, holdUntil);
            await logEvent(env, nowMs, 'delivery_held_by_policy', delivery.id, { reminder: rem.id, held_until: holdUntil });
            stats.held++;
          } else {
            await sendDelivery(env, nowMs, delivery, rem.text);
            stats.fired++;
          }
        }
      } catch (err) {
        stats.errors++;
        console.error(JSON.stringify({ evt: 'fire_error', reminder: rem.id, err: err && err.name }));
        if (inserted) await markFailed(env, nowMs, delivery.id, 'internal_error');
      }
      // Advance only once the delivery INSERT has run. If it threw, the reminder stays due and the next
      // cron retries it; UNIQUE(reminder_id, scheduled_for) still prevents a duplicate if it had committed.
      if (insertRan) {
        try {
          const adv = nextFireAfter(rem, scheduledFor, nowMs);
          await db.advanceReminder(env.DB, rem.id, scheduledFor, adv.next_fire_at);
          await logEvent(env, nowMs, 'reminder_advanced', rem.id, { recurrence: rem.recurrence, ...adv });
        } catch (err) {
          stats.errors++;
          console.error(JSON.stringify({ evt: 'advance_error', reminder: rem.id, err: err && err.name }));
        }
      }
    }
  }

  // 3. Keep the events table bounded (once an hour).
  if (new Date(nowMs).getUTCMinutes() === 0) {
    try {
      await db.pruneEvents(env.DB, EVENTS_KEEP);
    } catch (err) {
      console.error(JSON.stringify({ evt: 'events_prune_error', err: err && err.name }));
    }
  }

  // Workers only advance Date.now() across I/O, so wall_ms is wall time, not CPU time.
  const wallMs = Date.now() - startedMs;
  const busy = stats.released + stats.extended + stats.fired + stats.held + stats.guarded + stats.errors;
  if (busy > 0) await logEvent(env, nowMs, 'cron_run', null, { ...stats, wall_ms: wallMs });
  console.log(JSON.stringify({ evt: 'cron_run', ...stats, wall_ms: wallMs }));
  return stats;
}

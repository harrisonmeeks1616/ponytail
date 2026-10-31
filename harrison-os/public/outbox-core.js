// Harrison OS: pure outbox sync engine, attachment upload queue and small pure UI helpers.
// No DOM, no IndexedDB. Importable from Node 22 (tests) and the browser (app.js).
// Item shape: { id, kind: 'capture' | 'reminder', url, body, state, attempts,
//               next_attempt_at, last_error, created_at, synced_at }
// Never stores response bodies or capture text in last_error; error codes only.

// 'deleted': the server answered 410 (the id was deleted on purpose). Terminal, never resent, and the
// text is dropped from this phone too.
export const ITEM_STATES = Object.freeze([
  'saved_on_device', 'sending', 'synced', 'auth_required', 'retry_wait', 'conflict', 'rejected', 'deleted',
]);

// States the engine will try to send. 'sending' at the start of a run means a
// previous page life died mid-request (close/reload), so it is resent; the
// server's idempotent-by-id rule makes that safe.
const SENDABLE = new Set(['saved_on_device', 'retry_wait', 'auth_required', 'sending']);
const TERMINAL = new Set(['synced', 'conflict', 'rejected', 'deleted']);

export const SYNCED_CAP = 200;
export const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

// ---------------------------------------------------------------------------
// Response classification

/**
 * classifyResponse({ type, status, contentType }) -> 'synced' | 'auth_required' | 'retry' | 'conflict' | 'rejected'
 * - type 'opaqueredirect' (browser, redirect: 'manual'), any 3xx (Node / non-browser
 *   manual redirect), 401 and 403 mean the Access session is gone: auth_required.
 * - A 2xx whose content type is HTML is the Access login page served in place of
 *   JSON: auth_required.
 * - type 'error' / status 0 (network error), 408, 429 and 5xx: retry.
 * - 409: conflict. Other 4xx: rejected. Other 2xx: synced.
 */
export function classifyResponse({ type, status, contentType } = {}) {
  if (type === 'opaqueredirect') return 'auth_required';
  if (type === 'error') return 'retry';
  const s = Number(status);
  if (!Number.isFinite(s) || s === 0) return 'retry';
  if (s === 401 || s === 403) return 'auth_required';
  if (s >= 300 && s < 400) return 'auth_required';
  if (s >= 200 && s < 300) {
    if (isHtml(contentType)) return 'auth_required';
    return 'synced';
  }
  if (s === 408 || s === 429) return 'retry';
  if (s >= 500) return 'retry';
  if (s === 409) return 'conflict';
  if (s >= 400 && s < 500) return 'rejected';
  return 'retry'; // 1xx or anything unexpected: keep the item and try later
}

function isHtml(contentType) {
  if (!contentType) return false;
  const ct = String(contentType).toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml');
}

// ---------------------------------------------------------------------------
// Backoff

export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60000;
export const BACKOFF_JITTER = 0.2;

/**
 * backoffMs(attempts, rand = Math.random): 2 s * 2^attempts, capped at 60 s,
 * then +/- 20% jitter. `attempts` is the number of failed attempts before this
 * one (the engine passes the count before incrementing), so the first failure
 * waits about 2 s, the second about 4 s, ... and from the sixth on about 60 s.
 */
export function backoffMs(attempts, rand = Math.random) {
  const n = Math.max(0, Math.floor(Number(attempts) || 0));
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(n, 30), BACKOFF_CAP_MS);
  let r = typeof rand === 'function' ? rand() : Number(rand);
  if (!Number.isFinite(r)) r = 0.5;
  r = Math.min(Math.max(r, 0), 1);
  const jitter = base * BACKOFF_JITTER * (2 * r - 1);
  return Math.max(0, Math.round(base + jitter));
}

// ---------------------------------------------------------------------------
// Client ids

const KIND_PREFIX = { capture: 'cap', reminder: 'rem' };

function randomUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error('crypto_unavailable');
}

/**
 * newClientId(kind) -> e.g. 'cap_1b4e...' (capture), 'rem_...' (reminder).
 * Other kinds use their own sanitised name (max 16 chars) as the prefix.
 * Always matches ^[A-Za-z0-9_-]{8,80}$.
 */
export function newClientId(kind = 'capture') {
  let prefix = KIND_PREFIX[kind];
  if (!prefix) {
    prefix = String(kind || 'id').replace(/[^A-Za-z0-9-]/g, '').slice(0, 16) || 'id';
  }
  return `${prefix}_${randomUuid()}`;
}

// ---------------------------------------------------------------------------
// Items

function isoAt(ms) {
  return new Date(ms).toISOString();
}

/**
 * Helper for app.js: build a fresh outbox item. body must already carry the
 * same id (the server dedupes by body.id); if body.id is missing it is set.
 */
export function createOutboxItem({ id, kind, url, body, nowMs = Date.now() }) {
  if (!ID_PATTERN.test(String(id || ''))) throw new RangeError('bad_id');
  if (kind !== 'capture' && kind !== 'reminder') throw new RangeError('bad_kind');
  if (typeof url !== 'string' || !url.startsWith('/')) throw new RangeError('bad_url');
  const b = { ...(body || {}) };
  if (b.id === undefined) b.id = id;
  if (b.id !== id) throw new RangeError('body_id_mismatch');
  return {
    id, kind, url, body: b,
    state: 'saved_on_device',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    created_at: isoAt(nowMs),
    synced_at: null,
  };
}

export function isTerminal(state) {
  return TERMINAL.has(state);
}

export function isPending(item) {
  return !!item && !TERMINAL.has(item.state);
}

// ---------------------------------------------------------------------------
// In-memory store (tests, and idb.js fallback)

function clone(v) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(v);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function byCreated(a, b) {
  const ca = String(a.created_at || '');
  const cb = String(b.created_at || '');
  if (ca < cb) return -1;
  if (ca > cb) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Store interface used by the engine (all async):
 *   list() -> items (oldest created first), get(id) -> item | undefined,
 *   put(item), remove(id)
 */
export function createMemoryStore(initial = []) {
  const map = new Map();
  for (const it of initial) map.set(it.id, clone(it));
  return {
    async list() {
      return Array.from(map.values(), clone).sort(byCreated);
    },
    async get(id) {
      const v = map.get(id);
      return v === undefined ? undefined : clone(v);
    },
    async put(item) {
      if (!item || typeof item.id !== 'string') throw new TypeError('item.id required');
      map.set(item.id, clone(item));
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// One bounded POST. Resolves { res } or { error: 'timeout' | 'network' }; never reads the body.

export async function postJson(fetchImpl, url, body, headers = {}, timeoutMs = 20000) {
  const h = { 'Content-Type': 'application/json', ...(headers || {}), 'X-Requested-With': 'XMLHttpRequest' };
  const init = {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
    redirect: 'manual',
    credentials: 'same-origin',
    cache: 'no-store',
  };
  let controller = null;
  if (typeof AbortController === 'function') {
    controller = new AbortController();
    init.signal = controller.signal;
  }
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller && controller.abort(); } catch { /* ignore */ }
      const e = new Error('timeout');
      e.code = 'timeout';
      reject(e);
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetchImpl(url, init), timeout]);
    return { res };
  } catch (err) {
    return { error: err && err.code === 'timeout' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function contentTypeOf(res) {
  return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null;
}

function discardBody(res) {
  try { if (res.body && typeof res.body.cancel === 'function' && !res.bodyUsed) res.body.cancel().catch(() => {}); } catch { /* ignore */ }
}

// Keeps only the id and scope of a body whose content was deleted on the server.
function redactedBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = { id: b.id };
  if (b.scope !== undefined) out.scope = b.scope;
  return out;
}

// ---------------------------------------------------------------------------
// Sync engine

/**
 * createSyncEngine({ store, fetchImpl, now, onChange, headers, rand, timeoutMs })
 *   -> { syncOnce({ ignoreBackoff? }), pendingCount() }
 *
 * syncOnce() is single-flight: calls made while a run is in progress get the
 * same promise. A run sends every due item (state sendable and next_attempt_at
 * null or <= now) oldest first, at most once per run. Items enqueued during
 * the run are picked up before it finishes. The run stops early on
 * auth_required (items are kept, never terminal) and on a network error
 * (the phone is offline; the rest wait for the next trigger).
 *
 * Resolves to { attempted, synced, retry, auth_required, conflict, rejected, deleted,
 *               skipped_not_due, stopped: null | 'auth_required' | 'offline' }.
 * A 410 answer marks the item 'deleted' (terminal) and drops its text from the store.
 */
export function createSyncEngine({
  store,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  onChange = () => {},
  headers = {},
  rand = Math.random,
  timeoutMs = 20000,
} = {}) {
  if (!store) throw new TypeError('store required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');

  let inFlight = null;

  function notify(item) {
    try {
      onChange(clone(item));
    } catch {
      // UI errors must never break sync
    }
  }

  async function save(item) {
    await store.put(item);
    notify(item);
  }

  function isDue(item, t, ignoreBackoff) {
    if (!SENDABLE.has(item.state)) return false;
    if (ignoreBackoff) return true;
    return item.next_attempt_at == null || Number(item.next_attempt_at) <= t;
  }

  function send(item) {
    return postJson(fetchImpl, item.url, item.body, headers, timeoutMs);
  }

  async function processItem(item, summary) {
    item.state = 'sending';
    await save(item);

    const { res, error } = await send(item);
    const done = now();

    if (error) {
      item.next_attempt_at = done + backoffMs(item.attempts, rand);
      item.attempts = (item.attempts || 0) + 1;
      item.state = 'retry_wait';
      item.last_error = error;
      await save(item);
      summary.retry += 1;
      return 'offline';
    }

    const contentType = contentTypeOf(res);
    const verdict = classifyResponse({ type: res.type, status: res.status, contentType });
    // Do not read the body: the engine never stores server text.
    discardBody(res);

    const statusLabel = res.type === 'opaqueredirect' ? 'opaqueredirect' : String(res.status);
    switch (verdict) {
      case 'synced':
        item.state = 'synced';
        item.synced_at = isoAt(done);
        item.last_error = null;
        item.next_attempt_at = null;
        await save(item);
        summary.synced += 1;
        return null;
      case 'auth_required':
        item.state = 'auth_required';
        item.last_error = isHtml(contentType) && res.status >= 200 && res.status < 300 ? 'auth_html' : `auth_${statusLabel}`;
        item.next_attempt_at = null; // retried as soon as the session is back
        await save(item);
        summary.auth_required += 1;
        return 'auth_required';
      case 'retry':
        item.next_attempt_at = done + backoffMs(item.attempts, rand);
        item.attempts = (item.attempts || 0) + 1;
        item.state = 'retry_wait';
        item.last_error = `http_${statusLabel}`;
        await save(item);
        summary.retry += 1;
        return null;
      case 'conflict':
        item.state = 'conflict';
        item.last_error = 'http_409';
        item.next_attempt_at = null;
        await save(item);
        summary.conflict += 1;
        return null;
      default:
        if (res.status === 410) {
          // Deleted on purpose (maybe from another device): terminal, and its words leave this phone.
          item.state = 'deleted';
          item.last_error = 'http_410';
          item.next_attempt_at = null;
          item.body = redactedBody(item.body);
          await save(item);
          summary.deleted += 1;
          return null;
        }
        item.state = 'rejected';
        item.last_error = `http_${statusLabel}`;
        item.next_attempt_at = null;
        await save(item);
        summary.rejected += 1;
        return null;
    }
  }

  async function prune() {
    const items = await store.list();
    const synced = items.filter((i) => i.state === 'synced');
    if (synced.length <= SYNCED_CAP) return 0;
    synced.sort((a, b) => {
      const sa = String(a.synced_at || '');
      const sb = String(b.synced_at || '');
      if (sa !== sb) return sa < sb ? 1 : -1; // newest first
      return byCreated(b, a);
    });
    const drop = synced.slice(SYNCED_CAP);
    for (const it of drop) await store.remove(it.id);
    return drop.length;
  }

  async function run(ignoreBackoff) {
    const summary = {
      attempted: 0, synced: 0, retry: 0, auth_required: 0, conflict: 0, rejected: 0, deleted: 0,
      skipped_not_due: 0, stopped: null,
    };
    const tried = new Set();
    const notDue = new Set();
    outer: for (;;) {
      const items = await store.list();
      const t = now();
      const due = [];
      for (const it of items) {
        if (tried.has(it.id) || !SENDABLE.has(it.state)) continue;
        if (isDue(it, t, ignoreBackoff)) due.push(it);
        else notDue.add(it.id);
      }
      if (due.length === 0) break;
      for (const it of due) {
        tried.add(it.id);
        notDue.delete(it.id);
        summary.attempted += 1;
        const stop = await processItem(it, summary);
        if (stop) {
          summary.stopped = stop;
          break outer;
        }
      }
    }
    summary.skipped_not_due = notDue.size;
    await prune();
    return summary;
  }

  // syncOnce({ ignoreBackoff: true }) also sends retry_wait items whose backoff has not
  // elapsed. app.js uses it for events that make an immediate retry sensible (the network
  // came back, the app was opened or brought to the front), so reconnecting never leaves
  // items waiting out a backoff of up to 60 s. Each item is still sent at most once per run.
  function syncOnce({ ignoreBackoff = false } = {}) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        return await run(ignoreBackoff === true);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function pendingCount() {
    const items = await store.list();
    return items.filter(isPending).length;
  }

  return { syncOnce, pendingCount };
}

// ---------------------------------------------------------------------------
// Attachment upload queue
//
// A photo or file added in the capture sheet is kept on this phone (IndexedDB, keyed by its own id) and
// uploaded with POST /api/attachments only after its capture has synced, because the server needs the
// parent capture to exist. The id is fixed at creation, so a retry of the same bytes is idempotent on the
// server (200 duplicate). Item shape:
//   { id, capture_id, scope, name, mime, size, data_b64, state, attempts, next_attempt_at, last_error,
//     created_at, uploaded_at }
// States: waiting (for its capture or a connection), sending, retry_wait, auth_required: pending;
//         uploaded, dropped (its capture was deleted), rejected, conflict: terminal.
// data_b64 is removed once uploaded or dropped; it is kept after a refusal so nothing pasted is lost.

export const ATTACHMENT_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain']);
export const MAX_ATTACHMENT_BYTES = 1000000;
export const MAX_ATTACHMENTS_PER_CAPTURE = 5;
export const IMAGE_MAX_SIDE = 2048;
export const UPLOADED_CAP = 50;
const ATTACHMENT_PENDING = new Set(['waiting', 'sending', 'retry_wait', 'auth_required']);
const SCOPE_RE = /^(work|personal)$/;

const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', pdf: 'application/pdf', txt: 'text/plain' };

/** The allowed mime for a picked file (by its type, else its extension), or null. */
export function attachmentMime(type, name) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (t === 'image/heif') return 'image/heic';
  if (ATTACHMENT_MIME.includes(t)) return t;
  if (t && t !== 'application/octet-stream') return null;
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
  return ext ? EXT_MIME[ext[1].toLowerCase()] || null : null;
}

/** A file name without any path, control characters or more than 120 characters. */
export function safeFileName(name, fallback = 'file') {
  // eslint-disable-next-line no-control-regex
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || fallback).slice(0, 120);
}

/** Decoded byte count of a base64 string. */
export function base64Bytes(b64) {
  const s = String(b64 || '').replace(/\s/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

/** Width and height scaled so the longest side is at most max (never upscaled). */
export function fitWithin(width, height, max = IMAGE_MAX_SIDE) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const hgt = Math.max(1, Math.round(Number(height) || 1));
  const long = Math.max(w, hgt);
  if (long <= max) return { width: w, height: hgt };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(hgt * k)) };
}

export function createAttachmentItem({ id, capture_id, scope, name, mime, data_b64, nowMs = Date.now() }) {
  if (!ID_PATTERN.test(String(id || ''))) throw new RangeError('bad_id');
  if (!ID_PATTERN.test(String(capture_id || ''))) throw new RangeError('bad_capture_id');
  if (!SCOPE_RE.test(String(scope || ''))) throw new RangeError('bad_scope');
  if (!ATTACHMENT_MIME.includes(mime)) throw new RangeError('bad_mime');
  const size = base64Bytes(data_b64);
  if (size < 1) throw new RangeError('empty');
  if (size > MAX_ATTACHMENT_BYTES) throw new RangeError('too_large');
  return {
    id, capture_id, scope, name: safeFileName(name), mime, size, data_b64: String(data_b64),
    state: 'waiting', attempts: 0, next_attempt_at: null, last_error: null,
    created_at: isoAt(nowMs), uploaded_at: null,
  };
}

export function isAttachmentPending(item) {
  return !!item && ATTACHMENT_PENDING.has(item.state);
}

/**
 * syncAttachments({ store, outbox, fetchImpl, now, rand, headers, timeoutMs, onChange })
 * Sends each due pending attachment whose capture has synced (or is no longer in the outbox, i.e. it
 * synced and was pruned). A capture that is still pending keeps its attachments waiting; one that came
 * back deleted (410) drops them; one that was refused or conflicted holds them as rejected.
 * Answers: 2xx uploaded; 404 or 410 dropped ('capture_deleted', the parent is gone); 409 conflict
 * (different bytes under this id); 401/403/redirect/HTML stop the run (auth_required); network errors stop
 * the run (offline); 408/429/5xx retry with backoff; other 4xx rejected.
 * Resolves { attempted, uploaded, dropped, retry, auth_required, rejected, conflict, waiting, stopped }.
 */
export async function syncAttachments({
  store, outbox, fetchImpl = globalThis.fetch, now = () => Date.now(), rand = Math.random,
  headers = {}, timeoutMs = 30000, onChange = () => {}, url = '/api/attachments', ignoreBackoff = false,
} = {}) {
  if (!store || !outbox) throw new TypeError('store and outbox required');
  const summary = { attempted: 0, uploaded: 0, dropped: 0, retry: 0, auth_required: 0, rejected: 0, conflict: 0, waiting: 0, stopped: null };
  const save = async (item) => {
    await store.put(item);
    try { onChange(clone(item)); } catch { /* UI errors never break sync */ }
  };
  const items = (await store.list()).filter(isAttachmentPending);
  for (const item of items) {
    const parent = await outbox.get(item.capture_id);
    if (parent && parent.state === 'deleted') {
      Object.assign(item, { state: 'dropped', last_error: 'capture_deleted', next_attempt_at: null });
      delete item.data_b64;
      await save(item);
      summary.dropped += 1;
      continue;
    }
    if (parent && (parent.state === 'rejected' || parent.state === 'conflict')) {
      Object.assign(item, { state: 'rejected', last_error: 'capture_not_saved', next_attempt_at: null });
      await save(item);
      summary.rejected += 1;
      continue;
    }
    if (parent && parent.state !== 'synced') {
      if (item.state !== 'waiting' && item.state !== 'auth_required') {
        item.state = 'waiting';
        await save(item);
      }
      summary.waiting += 1;
      continue;
    }
    if (!ignoreBackoff && item.state === 'retry_wait' && item.next_attempt_at != null && Number(item.next_attempt_at) > now()) {
      summary.waiting += 1;
      continue;
    }
    summary.attempted += 1;
    item.state = 'sending';
    await save(item);
    const body = { id: item.id, scope: item.scope, capture_id: item.capture_id, name: item.name, mime: item.mime, data_b64: item.data_b64 };
    const { res, error } = await postJson(fetchImpl, url, body, headers, timeoutMs);
    const done = now();
    if (error) {
      Object.assign(item, { state: 'retry_wait', last_error: error, next_attempt_at: done + backoffMs(item.attempts, rand), attempts: (item.attempts || 0) + 1 });
      await save(item);
      summary.retry += 1;
      summary.stopped = 'offline';
      break;
    }
    const contentType = contentTypeOf(res);
    const verdict = classifyResponse({ type: res.type, status: res.status, contentType });
    discardBody(res);
    const status = res.type === 'opaqueredirect' ? 'opaqueredirect' : String(res.status);
    if (verdict === 'synced') {
      Object.assign(item, { state: 'uploaded', uploaded_at: isoAt(done), last_error: null, next_attempt_at: null });
      delete item.data_b64;
      await save(item);
      summary.uploaded += 1;
    } else if (verdict === 'auth_required') {
      Object.assign(item, { state: 'auth_required', last_error: `auth_${status}`, next_attempt_at: null });
      await save(item);
      summary.auth_required += 1;
      summary.stopped = 'auth_required';
      break;
    } else if (verdict === 'retry') {
      Object.assign(item, { state: 'retry_wait', last_error: `http_${status}`, next_attempt_at: done + backoffMs(item.attempts, rand), attempts: (item.attempts || 0) + 1 });
      await save(item);
      summary.retry += 1;
    } else if (res.status === 404 || res.status === 410) {
      Object.assign(item, { state: 'dropped', last_error: 'capture_deleted', next_attempt_at: null });
      delete item.data_b64;
      await save(item);
      summary.dropped += 1;
    } else if (verdict === 'conflict') {
      Object.assign(item, { state: 'conflict', last_error: 'http_409', next_attempt_at: null });
      await save(item);
      summary.conflict += 1;
    } else {
      Object.assign(item, { state: 'rejected', last_error: `http_${status}`, next_attempt_at: null });
      await save(item);
      summary.rejected += 1;
    }
  }
  // Keep the newest uploaded/dropped records for the "On this phone" list; they hold no bytes.
  const finished = (await store.list()).filter((i) => i.state === 'uploaded' || i.state === 'dropped').sort(byCreated).reverse();
  for (const old of finished.slice(UPLOADED_CAP)) await store.remove(old.id);
  return summary;
}

// ---------------------------------------------------------------------------
// Small pure UI helpers (used by app.js; here so node tests can run them)

const ON_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date-only arithmetic: 'YYYY-MM-DD' plus n days (calendar days, no time zone involved). */
export function addDaysOn(on, n) {
  const m = ON_RE.exec(String(on || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(Number(n) || 0)));
  return d.toISOString().slice(0, 10);
}

/** Defer targets for a local date: tomorrow, and next Monday (the start of next week, always after today). */
export function deferTargets(todayOn) {
  const m = ON_RE.exec(String(todayOn || ''));
  if (!m) return null;
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(); // 0 Sunday
  return { tomorrow: addDaysOn(todayOn, 1), nextWeek: addDaysOn(todayOn, ((8 - dow) % 7) || 7) };
}

export const RECURRENCES = Object.freeze(['none', 'daily', 'weekdays', 'weekly', 'monthly']);
export const RECURRENCE_LABEL = Object.freeze({ none: 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' });

/** Problems with a task edit before it is sent, as plain words; null when fine. */
export function taskEditProblem({ title, due_on, start_on, recurrence }) {
  if (!String(title || '').trim()) return 'A title is needed.';
  if (due_on && !ON_RE.test(due_on)) return 'The due date is not a date.';
  if (start_on && !ON_RE.test(start_on)) return 'The "Not before" date is not a date.';
  if (recurrence && !RECURRENCES.includes(recurrence)) return 'Pick how it repeats.';
  if (recurrence && recurrence !== 'none' && !due_on) return 'A repeating task needs a due date.';
  return null;
}

/** Decision options typed one per line: trimmed, blank lines dropped; at most 10, each at most 200 characters. */
export function parseOptionLines(text) {
  const options = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (options.length > 10) return { options: null, error: 'Up to 10 options, one per line.' };
  if (options.some((o) => o.length > 200)) return { options: null, error: 'Each option can be up to 200 characters.' };
  return { options, error: null };
}

/** Options stored as an array or a JSON array string, as an array of strings. */
export function optionsOf(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
}

export const PREF_KEY_RE = /^[a-z0-9_.-]{1,60}$/;

/** A preference key from a typed name: 'Email sign-off' -> 'email-sign-off'. Null when nothing usable is left. */
export function prefKeyFrom(name) {
  const k = String(name || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_.-]/g, '')
    .replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return PREF_KEY_RE.test(k) ? k : null;
}

/** A preference key shown as words: 'email-sign-off' -> 'Email sign off'. */
export function prefLabel(key) {
  const s = String(key || '').replace(/[-_.]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function countValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.values(v).reduce((n, x) => n + countValue(x), 0);
  return 0;
}

const TABLE_WORDS = {
  captures: ['capture', 'captures'], items: ['item', 'items'], projects: ['project', 'projects'], checkpoints: ['saved place', 'saved places'],
  reminders: ['reminder', 'reminders'], attachments: ['attachment', 'attachments'], preferences: ['preference', 'preferences'],
  proposals: ['suggestion', 'suggestions'], changes: ['undo record', 'undo records'],
};

/** A restore result ({ inserted: {table: n}, skipped_existing, skipped_deleted, rejected }) in plain words. */
export function restoreWords(result) {
  const r = result && typeof result === 'object' ? result : {};
  const inserted = r.inserted && typeof r.inserted === 'object' ? r.inserted : {};
  const parts = [];
  for (const [table, n] of Object.entries(inserted)) {
    const c = countValue(n);
    if (!c) continue;
    const w = TABLE_WORDS[table] || ['record', 'records'];
    parts.push(`${c} ${c === 1 ? w[0] : w[1]}`);
  }
  const total = countValue(inserted);
  const existing = countValue(r.skipped_existing);
  const deleted = countValue(r.skipped_deleted);
  const rejected = countValue(r.rejected);
  const out = [total ? `Restored ${parts.join(', ')}.` : 'Nothing new to restore.'];
  if (existing) out.push(`${existing} already here, left as they are.`);
  if (deleted) out.push(`${deleted} you deleted earlier, not brought back.`);
  if (rejected) out.push(`${rejected} could not be restored (wrong scope or not valid).`);
  const quiet = countValue(r.reminders_not_rescheduled);
  if (quiet) out.push(`${quiet} ${quiet === 1 ? 'reminder was' : 'reminders were'} restored without a new alert time.`);
  return out.join(' ');
}

/** Case-insensitive match of every typed word against a task's words (title, notes, who asked, date phrase). */
export function taskMatches(item, filter) {
  const q = String(filter || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [item && item.title, item && item.body, item && item.claim_by, item && item.when_text].filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Capture text from a Web Share Target GET (title, text, url), without repeating a part already included. */
export function shareText({ title, text, url } = {}, max = 4000) {
  const parts = [];
  for (const raw of [title, text, url]) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (parts.some((x) => x.includes(p))) continue;
    parts.push(p);
  }
  return parts.join('\n').slice(0, max);
}

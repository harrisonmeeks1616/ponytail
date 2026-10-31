// Harrison OS spike: pure outbox sync engine.
// No DOM, no IndexedDB. Importable from Node 22 (tests) and the browser (app.js).
// Item shape: { id, kind: 'capture' | 'reminder', url, body, state, attempts,
//               next_attempt_at, last_error, created_at, synced_at }
// Never stores response bodies or capture text in last_error; error codes only.

export const ITEM_STATES = Object.freeze([
  'saved_on_device', 'sending', 'synced', 'auth_required', 'retry_wait', 'conflict', 'rejected',
]);

// States the engine will try to send. 'sending' at the start of a run means a
// previous page life died mid-request (close/reload), so it is resent; the
// server's idempotent-by-id rule makes that safe.
const SENDABLE = new Set(['saved_on_device', 'retry_wait', 'auth_required', 'sending']);
const TERMINAL = new Set(['synced', 'conflict', 'rejected']);

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
 * Resolves to { attempted, synced, retry, auth_required, conflict, rejected,
 *               skipped_not_due, stopped: null | 'auth_required' | 'offline' }.
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

  async function send(item) {
    const h = { 'Content-Type': 'application/json', ...(headers || {}), 'X-Requested-With': 'XMLHttpRequest' };
    const init = {
      method: 'POST',
      headers: h,
      body: JSON.stringify(item.body),
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
      const res = await Promise.race([fetchImpl(item.url, init), timeout]);
      return { res };
    } catch (err) {
      return { error: err && err.code === 'timeout' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
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

    const contentType = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null;
    const verdict = classifyResponse({ type: res.type, status: res.status, contentType });
    // Do not read the body: the engine never stores server text.
    try { if (res.body && typeof res.body.cancel === 'function' && !res.bodyUsed) res.body.cancel().catch(() => {}); } catch { /* ignore */ }

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
      attempted: 0, synced: 0, retry: 0, auth_required: 0, conflict: 0, rejected: 0,
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

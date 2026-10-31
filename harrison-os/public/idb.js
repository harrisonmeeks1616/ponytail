// Harrison OS spike: small IndexedDB wrapper.
// openStores() -> { outbox, drafts, log, persistent, warning? }
//   outbox: engine store interface { list(), get(id), put(item), remove(id) }
//   drafts: { get(key), put(key, value), del(key) }
//   log:    { add(entry), list(n) }  (newest first; entries hold ids/states/codes only)
// Falls back to memory, with a visible warning string, when IndexedDB is
// unavailable or fails to open (e.g. some private-browsing modes).

import { createMemoryStore } from './outbox-core.js';

export const DB_NAME = 'harrison-os-spike';
export const DB_VERSION = 1;
export const LOG_CAP = 500;

const MEMORY_WARNING =
  'Storage unavailable: this page is using memory only. Drafts and unsent items will be lost when the app closes.';

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb_request_failed'));
  });
}

function openDb(factory, name) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = factory.open(name, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
      if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb_open_failed'));
    req.onblocked = () => reject(new Error('idb_open_blocked'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb_tx_failed'));
    tx.onabort = () => reject(tx.error || new Error('idb_tx_aborted'));
  });
}

function byCreated(a, b) {
  const ca = String(a.created_at || '');
  const cb = String(b.created_at || '');
  if (ca < cb) return -1;
  if (ca > cb) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// iOS can drop the IDB connection after the app is backgrounded
// ("Connection to Indexed Database server lost"). Every operation goes
// through withStore(), which reopens once and retries when starting a
// transaction fails on a dead connection.
function createConnection(factory, name, firstDb) {
  let dbPromise = Promise.resolve(firstDb);

  function attach(db) {
    try {
      db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
    } catch { /* ignore */ }
    return db;
  }
  attach(firstDb);

  function getDb() {
    if (!dbPromise) dbPromise = openDb(factory, name).then(attach);
    return dbPromise;
  }

  async function withStore(storeName, mode, fn) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = await getDb();
      let tx;
      try {
        tx = db.transaction(storeName, mode);
      } catch (e) {
        dbPromise = null;
        if (attempt === 0) continue;
        throw e;
      }
      const store = tx.objectStore(storeName);
      const done = txDone(tx);
      let result;
      try {
        result = await fn(store);
      } catch (e) {
        try { tx.abort(); } catch { /* ignore */ }
        done.catch(() => {});
        throw e;
      }
      await done;
      return result;
    }
    throw new Error('idb_unavailable');
  }

  return { withStore };
}

function idbStores(conn) {
  const { withStore } = conn;
  const outbox = {
    async list() {
      const all = await withStore('outbox', 'readonly', (s) => reqToPromise(s.getAll()));
      return (all || []).sort(byCreated);
    },
    async get(id) {
      const v = await withStore('outbox', 'readonly', (s) => reqToPromise(s.get(id)));
      return v === null ? undefined : v;
    },
    async put(item) {
      if (!item || typeof item.id !== 'string') throw new TypeError('item.id required');
      await withStore('outbox', 'readwrite', (s) => reqToPromise(s.put(item)));
    },
    async remove(id) {
      await withStore('outbox', 'readwrite', (s) => reqToPromise(s.delete(id)));
    },
  };
  const drafts = {
    async get(key) {
      const v = await withStore('drafts', 'readonly', (s) => reqToPromise(s.get(key)));
      return v === null ? undefined : v;
    },
    async put(key, value) {
      await withStore('drafts', 'readwrite', (s) => reqToPromise(s.put(value, key)));
    },
    async del(key) {
      await withStore('drafts', 'readwrite', (s) => reqToPromise(s.delete(key)));
    },
  };
  let addsSinceTrim = 0;
  const log = {
    async add(entry) {
      const rec = { at: new Date().toISOString(), ...(entry || {}) };
      delete rec.seq;
      await withStore('log', 'readwrite', (s) => reqToPromise(s.add(rec)));
      addsSinceTrim += 1;
      if (addsSinceTrim >= 50) {
        addsSinceTrim = 0;
        await trimLog().catch(() => {});
      }
    },
    async list(n = 100) {
      const limit = Math.max(0, Math.floor(Number(n) || 0));
      if (limit === 0) return [];
      return withStore('log', 'readonly', (s) => new Promise((resolve, reject) => {
        const out = [];
        const req = s.openCursor(null, 'prev');
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur || out.length >= limit) { resolve(out); return; }
          out.push(cur.value);
          cur.continue();
        };
        req.onerror = () => reject(req.error || new Error('idb_cursor_failed'));
      }));
    },
  };
  async function trimLog() {
    await withStore('log', 'readwrite', (s) => new Promise((resolve, reject) => {
      const countReq = s.count();
      countReq.onerror = () => reject(countReq.error);
      countReq.onsuccess = () => {
        let excess = countReq.result - LOG_CAP;
        if (excess <= 0) { resolve(); return; }
        const cur = s.openCursor();
        cur.onerror = () => reject(cur.error);
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || excess <= 0) { resolve(); return; }
          c.delete();
          excess -= 1;
          c.continue();
        };
      };
    }));
  }
  return { outbox, drafts, log };
}

export function createMemoryStores(warning = MEMORY_WARNING) {
  const outbox = createMemoryStore();
  const draftMap = new Map();
  const logEntries = [];
  let seq = 0;
  const copy = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  return {
    outbox,
    drafts: {
      async get(key) { return draftMap.has(key) ? copy(draftMap.get(key)) : undefined; },
      async put(key, value) { draftMap.set(key, copy(value)); },
      async del(key) { draftMap.delete(key); },
    },
    log: {
      async add(entry) {
        const rec = { at: new Date().toISOString(), ...(entry || {}), seq: ++seq };
        logEntries.push(rec);
        if (logEntries.length > LOG_CAP) logEntries.splice(0, logEntries.length - LOG_CAP);
      },
      async list(n = 100) {
        const limit = Math.max(0, Math.floor(Number(n) || 0));
        if (limit === 0) return [];
        return logEntries.slice(-limit).reverse().map(copy);
      },
    },
    persistent: false,
    warning,
  };
}

/**
 * openStores({ name, indexedDB }) -> Promise<{ outbox, drafts, log, persistent, warning? }>
 * Never rejects: any IndexedDB failure falls back to memory with a warning.
 */
export async function openStores({ name = DB_NAME, indexedDB: factory = globalThis.indexedDB } = {}) {
  if (!factory || typeof factory.open !== 'function') {
    return createMemoryStores();
  }
  try {
    const db = await openDb(factory, name);
    const conn = createConnection(factory, name, db);
    const stores = idbStores(conn);
    // Probe one real read so a factory that opens but cannot transact is caught here.
    await stores.outbox.list();
    return { ...stores, persistent: true };
  } catch (e) {
    const code = e && e.name ? e.name : 'error';
    return createMemoryStores(`${MEMORY_WARNING} (IndexedDB ${code})`);
  }
}

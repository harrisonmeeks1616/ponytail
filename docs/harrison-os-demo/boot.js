// Harrison OS in-browser preview. Runs the real app (public/) against the real Worker code (src/) inside
// this page: /api requests never leave the browser. Storage is SQLite (official WebAssembly build) kept in
// this browser's localStorage. Fictional sample data only. Not production, not a deployment of the Worker.
import sqlite3InitModule from './sqlite/sqlite3.js';
import { D1Wasm } from './d1-wasm.js';
import { createWorker } from './src/api.js';
import { MIGRATIONS, REVISION } from './manifest.js';

const INNER_ORIGIN = 'http://127.0.0.1:8899';
const DAY = 86_400_000;
const $ = (id) => document.getElementById(id);

function fail(message) {
  const el = $('demo-fatal');
  el.textContent = message;
  el.hidden = false;
}

async function openDb() {
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  let raw;
  let persistent = true;
  try {
    raw = new sqlite3.oo1.JsStorageDb('local');
  } catch {
    raw = new sqlite3.oo1.DB(':memory:');
    persistent = false;
  }
  raw.exec('CREATE TABLE IF NOT EXISTS demo_migrations (name TEXT PRIMARY KEY)');
  const done = new Set(raw.selectValues('SELECT name FROM demo_migrations'));
  for (const name of MIGRATIONS) {
    if (done.has(name)) continue;
    const res = await fetch(`./migrations/${name}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`migration ${name}: HTTP ${res.status}`);
    const sql = await res.text();
    raw.exec('BEGIN');
    try {
      raw.exec(sql);
      raw.exec({ sql: 'INSERT INTO demo_migrations (name) VALUES (?)', bind: [name] });
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  }
  return { sqlite3, raw, persistent, fresh: done.size === 0 };
}

function installApi(env) {
  const worker = createWorker({ authenticateImpl: async () => ({ kind: 'dev' }) });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), location.href), init);
    const u = new URL(req.url);
    if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) return realFetch(input, init);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const inner = new Request(INNER_ORIGIN + u.pathname + u.search, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
    });
    // A small delay so loading states are real states, not flashes.
    await new Promise((r) => setTimeout(r, 60));
    return worker.fetch(inner, env);
  };
  return worker;
}

async function call(worker, env, method, path, body) {
  const res = await worker.fetch(
    new Request(INNER_ORIGIN + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`seed ${method} ${path}: ${res.status} ${data && data.error ? data.error.code : ''}`);
  return data;
}

function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * DAY);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Fictional people, companies and jobs. Every record is flagged sample: 1 so the app labels it.
async function seed(worker, env) {
  const p = (await call(worker, env, 'POST', '/api/projects', { scope: 'work', name: 'Maple Street clinic fit-out', purpose: 'Fictional demo project: tenant fit-out, level 2 lighting and power.', sample: 1 })).project;
  await call(worker, env, 'POST', '/api/items', { scope: 'work', kind: 'task', title: 'Send revised panel schedule to the GC', project_id: p.id, due_on: localDate(0), sample: 1 });
  await call(worker, env, 'POST', '/api/items', { scope: 'work', kind: 'task', title: 'Order 14 sheets of fire-rated drywall', project_id: p.id, due_on: localDate(2), sample: 1 });
  await call(worker, env, 'POST', '/api/items', { scope: 'work', kind: 'task', title: 'Walk level 2 with the foreman', project_id: p.id, sample: 1 });
  await call(worker, env, 'POST', '/api/items', {
    scope: 'work', kind: 'waiting', title: 'Light fixture submittal approval', who: 'Jordan Example (fictional GC)', claim_status: 'requested',
    asked_on: localDate(-3), promised_on: localDate(3), follow_up_on: localDate(1), project_id: p.id, sample: 1,
  });
  await call(worker, env, 'POST', '/api/items', { scope: 'work', kind: 'decision', title: 'Use surface conduit in the corridor', reason: 'Ceiling is hard-lid; fictional example.', project_id: p.id, sample: 1 });
  await call(worker, env, 'POST', `/api/projects/${p.id}/checkpoint`, {
    scope: 'work',
    fields: { stopped_at_text: 'Marked up the level 2 lighting plan', open_question: 'Does the GC want occupancy sensors in the exam rooms?', next_step: 'Confirm fixture count with the GC before ordering' },
  });
  await call(worker, env, 'POST', '/api/items', { scope: 'personal', kind: 'task', title: 'Renew car registration', due_on: localDate(5), sample: 1 });
  // Labelled sample connections (no live calendar or PM system is contacted).
  await call(worker, env, 'POST', '/api/calendar/sample', { scope: 'work' }).catch(() => null);
  await call(worker, env, 'POST', '/api/pm/sample', { scope: 'work' }).catch(() => null);
}

function bindDemoBar(db) {
  $('demo-revision').textContent = REVISION;
  $('demo-reset').addEventListener('click', () => {
    if (!confirm('Erase this preview\'s data in this browser and start again with the sample data?')) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('kvvfs-local')) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    indexedDB.deleteDatabase('harrison-os');
    location.hash = '#/today';
    location.reload();
  });
  $('demo-away').addEventListener('click', async () => {
    // Simulates opening the app after eight days away: the app's "last opened" time moves back.
    // Nothing else is changed: dates, tasks and the saved place stay exactly as they were.
    const at = new Date(Date.now() - 8 * DAY).toISOString();
    await db.prepare("INSERT INTO meta (key, value) VALUES ('last_open_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(at).run();
    location.hash = '#/today';
    location.reload();
  });
  const info = $('demo-info');
  $('demo-info-open').addEventListener('click', () => info.showModal());
  $('demo-info-close').addEventListener('click', () => info.close());
}

async function main() {
  // The preview has no service worker: the app's own one belongs to the real deployment.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register = () => Promise.reject(Object.assign(new Error('preview'), { name: 'PreviewNoServiceWorker' }));
  }
  let opened;
  try {
    opened = await openDb();
  } catch (e) {
    fail(`The preview could not start its local database (${e && e.message ? e.message : 'error'}). Try a current Safari or Chrome.`);
    return;
  }
  const db = new D1Wasm(opened.raw);
  const env = {
    DB: db, BUILD_ID: `preview-${REVISION}`, DEV_ALLOW_UNAUTH: '1', SPIKE_TEST_HOOKS: '0', ALLOW_TEST_PUSH_ENDPOINT: '0',
    ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_AUD_SHORTCUT: '', VAPID_PUBLIC_KEY: '', VAPID_SUBJECT: '',
  };
  const worker = installApi(env);
  if (!opened.persistent) $('demo-storage').hidden = false;
  if (opened.fresh) {
    try {
      await seed(worker, env);
    } catch (e) {
      fail(`Sample data did not load (${e.message}). Tap "Start over" to retry.`);
    }
  }
  bindDemoBar(db);
  await import('./public/app.js');
}

main();

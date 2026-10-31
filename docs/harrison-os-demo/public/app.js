// Harrison OS phone client, Slice 1.
// Plain ES module, no framework. Hash routes: #/today (default), #/capture (sheet),
// #/review and #/review/<id>, #/waiting, #/tasks (every open task), #/tasks/archived, #/projects,
// #/project/<id>, #/memory. Task edits and decisions open in the edit sheet (a dialog, not a route).
// Never logs or stores capture text, item text, tokens, push keys or emails in the
// local log. User text only lives in the outbox, the draft store and on screen.
import {
  createSyncEngine, createOutboxItem, newClientId, classifyResponse, isPending,
  createAttachmentItem, syncAttachments, isAttachmentPending, attachmentMime, safeFileName, fitWithin,
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_CAPTURE, IMAGE_MAX_SIDE,
  deferTargets, RECURRENCES, RECURRENCE_LABEL, taskEditProblem, parseOptionLines, optionsOf,
  prefKeyFrom, prefLabel, restoreWords, taskMatches, shareText,
} from './outbox-core.js';
import { openStores } from './idb.js';
import { VIEW_MODULES } from './views/index.js';

const CLIENT_BUILD = 'ui-3';
const IDB_NAME = 'harrison-os';
const API_HEADERS = Object.freeze({ 'X-Requested-With': 'XMLHttpRequest' });
const DRAFT_KEY = 'capture';
const PENDING_ACKS_KEY = 'pending_acks';
const LAST_SESSION_KEY = 'last_session';
const SCOPE_KEY = 'hos.scope';
const CAPTURE_SCOPE_KEY = 'hos.captureScope';
const PROJECT_SCOPES_KEY = 'hos.projectScopes';
const DRAFT_DEBOUNCE_MS = 300;
const SYNC_INTERVAL_MS = 15000;
const TOAST_MS = 10000;
const RESUBSCRIBE_MIN_GAP_MS = 30 * 60 * 1000;
const DELIVERY_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const PATH_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const CHANGE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const ON_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCOPES = ['all', 'work', 'personal'];
const ROUTES = new Set(['today', 'capture', 'review', 'waiting', 'tasks', 'projects', 'project', 'memory']);
// Screens, Today blocks, project blocks, Memory cards and top-bar actions added by public/views/*.js.
const EXT = { routes: new Map(), today: [], project: [], memory: [], topbar: [] };

const KIND_LABEL = {
  task: 'Task',
  waiting: 'Waiting on',
  reminder: 'Reminder',
  reference: 'Reference',
  idea: 'Idea',
  decision: 'Decision',
  capture: 'Capture',
  project: 'Project',
  item: 'Item',
};
const STATUS_LABEL = {
  requested: 'Requested',
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  reported_complete: 'Reported complete',
  verified: 'Verified',
  unspecified: 'Unspecified',
};
const CLAIM_STATUSES = Object.keys(STATUS_LABEL);

const $ = (id) => document.getElementById(id);

let resolveStores;
const storesReady = new Promise((resolve) => {
  resolveStores = resolve;
});
let resolveDraftRestored;
const draftRestored = new Promise((resolve) => {
  resolveDraftRestored = resolve;
});

const state = {
  scope: 'all',
  route: { name: 'today', id: null },
  baseRoute: { name: 'today', id: null },
  routedOnce: false,
  stores: null,
  engine: null,
  items: new Map(),
  authLost: false,
  session: null,
  sessionStatus: 'checking', // checking | ok | auth | offline | error
  sessionError: null,
  lastKnownSession: null,
  draftId: null,
  draftTimer: null,
  draftGen: 0,
  today: null,
  todayError: null,
  returnView: null,
  returnDismissed: false,
  inbox: null,
  inboxError: null,
  reviewDecisions: new Map(), // captureId -> Map(ordinal -> { choice, edits, editing })
  reviewBusy: false,
  waiting: null,
  waitingError: null,
  tasks: null,
  tasksError: null,
  projects: null,
  projectsError: null,
  project: null,
  projectError: null,
  checkpointEdit: null, // { projectId, fields } while the Edit form is open
  projectScopes: {},
  search: null,
  swReg: null,
  vapidKeyBytes: null,
  subscription: null,
  pushKnown: false,
  lastResubscribeAt: 0,
  toastChange: null,
  toastTimer: null,
  seq: { today: 0, review: 0, waiting: 0, tasks: 0, projects: 0, project: 0, search: 0, prefs: 0 },
  attachments: new Map(), // attachment id -> queue item (no bytes kept here)
  sheetFiles: [], // photos and files added in the open capture sheet, not saved yet
  tasksFilter: '',
  tasksMode: 'open', // open | archived (#/tasks/archived)
  prefs: null,
  prefsError: null,
  sheetOpener: null,
};

// ---------------------------------------------------------------------------
// Small helpers

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') node[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendKids(node, kids);
  return node;
}

function appendKids(node, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    node.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
}

let statusTimer = null;
function setStatus(message) {
  const node = $('status');
  if (!node) return;
  node.textContent = '';
  clearTimeout(statusTimer);
  // A tick between clear and set makes screen readers announce repeats.
  statusTimer = setTimeout(() => {
    node.textContent = message;
  }, 30);
}

function enc(value) {
  return encodeURIComponent(String(value));
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.toString();
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function readLocal(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: per-device convenience only */
  }
}

function isScope(s) {
  return s === 'work' || s === 'personal';
}

function listFrom(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of keys) if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function isSample(row) {
  return !!row && (row.sample === 1 || row.sample === true || row.sample === '1');
}

function parseRef(ref) {
  const m = /^(capture|item|project):(.+)$/.exec(String(ref || ''));
  if (!m || !PATH_ID_RE.test(m[2])) return { type: null, id: null };
  return { type: m[1], id: m[2] };
}

function countOf(value) {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function excerpt(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Calendar date (YYYY-MM-DD) on this phone right now.
function localOn(ms = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: deviceTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

// Date-only values are never converted to instants: they are formatted in UTC.
function formatOn(on) {
  const m = ON_RE.exec(String(on || ''));
  if (!m) return String(on || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sameYear = m[1] === localOn().slice(0, 4);
  const opts = { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' };
  if (!sameYear) opts.year = 'numeric';
  try {
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  } catch {
    return String(on);
  }
}

function formatAt(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatTimeOfDay(value) {
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const H = Number(m[1]);
  return `${((H + 11) % 12) + 1}:${m[2]} ${H < 12 ? 'AM' : 'PM'}`;
}

function formatLongToday() {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: deviceTimeZone(), weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  } catch {
    return localOn();
  }
}

// Remember the focused control by key across re-renders.
function focusKey() {
  const a = document.activeElement;
  return a && a.dataset ? a.dataset.fk || null : null;
}

function restoreFocus(container, key) {
  if (!key || !container) return;
  const target = [...container.querySelectorAll('[data-fk]')].find((n) => n.dataset.fk === key);
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

async function logEvent(entry) {
  // Entries hold ids, states, codes and times only. Never text, tokens or keys.
  try {
    const stores = await storesReady;
    await stores.log.add(entry);
  } catch {
    /* logging must never break the app */
  }
}

// Runs fn with the button disabled, so a double tap cannot send twice.
async function guarded(button, fn) {
  if (!button || button.disabled || button.dataset.busy === '1') return undefined;
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.dataset.busy = '';
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Chips

function chip(className, label, hiddenPrefix) {
  return h('span', { class: `chip ${className}` }, hiddenPrefix ? h('span', { class: 'visually-hidden', text: hiddenPrefix }) : null, label);
}

function scopeChip(scope) {
  if (scope === 'work') return chip('chip-work', 'Work');
  if (scope === 'personal') return chip('chip-personal', 'Personal');
  return null;
}

function sampleChip(row) {
  return isSample(row) ? chip('chip-sample', 'Sample') : null;
}

function statusChip(status) {
  if (!STATUS_LABEL[status]) return null;
  return chip(`chip-status chip-status-${status}`, STATUS_LABEL[status], 'Status: ');
}

function kindChip(kind) {
  return chip('chip-kind', KIND_LABEL[kind] || 'Item');
}

// ---------------------------------------------------------------------------
// API

async function api(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const headers = { ...API_HEADERS };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  // A request the server never answers must not leave a screen waiting forever (seen live in the spike).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    return { ok: false, verdict: 'retry', status: 0, offline: !timedOut, timedOut, data: null };
  } finally {
    clearTimeout(timer);
  }
  const contentType = res.headers.get('content-type') || '';
  const verdict = classifyResponse({ type: res.type, status: res.status, contentType });
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (verdict === 'auth_required') markAuthLost();
  else if (verdict === 'synced') markAuthOk();
  return { ok: verdict === 'synced', verdict, status: res.status, offline: false, data };
}

function failWords(r, what) {
  if (!r) return `Could not ${what}.`;
  if (r.timedOut) return `Could not ${what}. The server didn't answer in time.`;
  if (r.offline) return `Could not ${what}. No connection.`;
  if (r.verdict === 'auth_required') return `Could not ${what}. Sign in again first.`;
  if (r.status === 409) return `Could not ${what}. It changed since this screen loaded. Refresh and try again.`;
  const err = (r.data && r.data.error) || {};
  const code = err.code;
  if (r.status === 410) return `Could not ${what}. It was deleted.`;
  if (r.status === 413 || code === 'too_large') return `Could not ${what}. It is too large.`;
  if (r.status === 404) return `Could not ${what}. It was not found. It may have been deleted.`;
  if (code === 'in_past') return `Could not ${what}. A reminder time has already passed. Tap Edit on it and pick a later time.`;
  if (code === 'invalid' && err.field === 'when') return `Could not ${what}. A reminder needs a date and a time. Tap Edit on it and add them.`;
  return `Could not ${what} (${code ? String(code) : `HTTP ${r.status || 0}`}).`;
}

// A visible notice for failures and validation messages. The toast text is a live region, so it is
// announced too. Inside the open capture sheet (a modal) the toast would be covered, so messages
// there go to the sheet's own status line.
function showNotice(message) {
  const sheet = $('capture-sheet');
  if (sheet && sheet.open) {
    setText('draft-status', message);
    return;
  }
  const edit = $('edit-sheet');
  if (edit && edit.open) {
    setText('edit-sheet-status', '');
    setTimeout(() => setText('edit-sheet-status', message), 30);
    return;
  }
  showToast(message, null);
}

function changeIdFrom(data) {
  const v = pick(data, 'changeId', 'change_id');
  if (v === undefined) return null;
  const s = String(v);
  return CHANGE_ID_RE.test(s) ? s : null;
}

function markAuthLost() {
  if (!state.authLost) {
    state.authLost = true;
    logEvent({ kind: 'auth_lost' });
  }
  renderAuthBanner();
}

function markAuthOk() {
  if (state.authLost) {
    state.authLost = false;
    logEvent({ kind: 'auth_ok' });
    renderAuthBanner();
  }
}

// The sync engine never reads bodies. This wrapper peeks at a clone of the capture
// response for the proposal count only. It never delays or changes what the engine sees.
function trackingFetch(url, init) {
  return fetch(url, init).then((res) => {
    try {
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json') && url === '/api/captures') {
        res
          .clone()
          .json()
          .then((data) => onCaptureResponse(res.status, data))
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
    return res;
  });
}

function onCaptureResponse(status, data) {
  if (!data || typeof data !== 'object') return;
  const capture = data.capture && typeof data.capture === 'object' ? data.capture : {};
  const id = typeof capture.id === 'string' ? capture.id : null;
  const proposals = Array.isArray(data.proposals) ? data.proposals.length : null;
  logEvent({ kind: 'capture_response', id, status, duplicate: data.duplicate === true, proposals });
  if (proposals !== null && proposals > 0 && data.duplicate !== true) {
    setStatus(`Capture sent. ${plural(proposals, 'thing', 'things')} to review.`);
  }
  scheduleDataRefresh();
}

// ---------------------------------------------------------------------------
// Toast with Undo

function showToast(message, changeId) {
  const toast = $('toast');
  const undo = $('toast-undo');
  state.toastChange = changeId || null;
  undo.hidden = !state.toastChange;
  undo.disabled = false;
  setText('toast-text', '');
  toast.hidden = false;
  setTimeout(() => setText('toast-text', message), 30);
  armToastTimer();
}

function armToastTimer() {
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    const toast = $('toast');
    // Keep it while the Undo button has focus.
    if (toast.contains(document.activeElement)) {
      armToastTimer();
      return;
    }
    hideToast();
  }, TOAST_MS);
}

function hideToast() {
  clearTimeout(state.toastTimer);
  state.toastChange = null;
  $('toast').hidden = true;
}

async function onUndoClick() {
  const changeId = state.toastChange;
  if (!changeId) return;
  const btn = $('toast-undo');
  await guarded(btn, async () => {
    const r = await api(`/api/undo/${enc(changeId)}`, { method: 'POST', body: {} });
    logEvent({ kind: 'undo', change: changeId, status: r.status, ok: r.ok });
    hideToast();
    if (r.ok) setStatus('Undone.');
    else if (r.status === 409) showNotice('Could not undo. It was changed again since.');
    else showNotice(failWords(r, 'undo'));
    reloadCurrent();
  });
  const h1 = currentHeading();
  if (h1 && (!document.activeElement || document.activeElement === document.body)) h1.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Check-offs (every one shows Undo)

let checkSeq = 0;
function checkRow({ id, scope, title, meta, done, sample, fk, extra }) {
  const li = h('li', { class: `check-row${done ? ' is-done' : ''}` });
  const inputId = `chk-${++checkSeq}`;
  const input = h('input', {
    type: 'checkbox',
    id: inputId,
    class: 'check',
    checked: !!done,
    dataset: { fk: fk || `chk-${id}`, itemId: id },
  });
  input.addEventListener('change', () => onCheckChange(input, li, id, scope));
  const label = h(
    'label',
    { for: inputId, class: 'check-label' },
    h('span', { class: 'check-title', text: title || '(no title)' }),
    meta ? h('span', { class: 'check-meta', text: meta }) : null,
  );
  li.append(input, label);
  const chips = h('span', { class: 'chips' }, state.scope === 'all' ? scopeChip(scope) : null, sampleChip({ sample }));
  if (chips.childNodes.length) li.append(chips);
  if (extra) li.append(h('div', { class: 'row-actions' }, extra));
  return li;
}

// "Pick for today" / "Remove from today" on a task row. Sets items.today_pick; the toast offers Undo.
function pickButton({ id, scope, picked, title }) {
  return h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-pick',
    text: picked ? 'Remove from today' : 'Pick for today',
    'aria-label': `${picked ? 'Remove from today' : 'Pick for today'}: ${title || 'task'}`,
    dataset: { fk: `pick-${id}` },
    onclick: (e) =>
      itemAction(e.currentTarget, {
        id,
        scope,
        method: 'PATCH',
        body: { today_pick: !picked },
        done: picked ? 'Removed from today.' : 'Picked for today.',
        failure: picked ? 'remove it from today' : 'pick it for today',
      }),
  });
}

async function onCheckChange(input, li, id, scope) {
  if (input.dataset.busy === '1') return;
  const want = input.checked;
  if (!isScope(scope)) {
    input.checked = !want;
    showNotice('Could not change it. Its scope is unknown.');
    return;
  }
  input.dataset.busy = '1';
  input.disabled = true;
  // today_on lets a recurring task's next instance start from this phone's own date.
  const body = want ? { scope, today_on: localOn() } : { scope };
  const r = await api(`/api/items/${enc(id)}/${want ? 'complete' : 'reopen'}`, { method: 'POST', body });
  input.disabled = false;
  input.dataset.busy = '';
  logEvent({ kind: want ? 'item_complete' : 'item_reopen', id, status: r.status, ok: r.ok });
  if (r.ok) {
    li.classList.toggle('is-done', want);
    // Optional completion feedback; styles.css turns it off under reduced motion.
    if (want) {
      li.classList.remove('just-done');
      void li.offsetWidth;
      li.classList.add('just-done');
    }
    // The same item can show twice (Next and the Today list): keep both in step.
    for (const other of document.querySelectorAll('input.check')) {
      if (other === input || other.dataset.itemId !== id) continue;
      other.checked = want;
      const row = other.closest('.check-row');
      if (row) row.classList.toggle('is-done', want);
    }
    showToast(want ? completedWords(r.data) : 'Marked not done.', changeIdFrom(r.data));
  } else {
    input.checked = !want;
    showNotice(failWords(r, want ? 'mark it done' : 'mark it not done'));
  }
}

// "Marked done." plus, for a repeating task, when the next one is due.
function completedWords(data) {
  const next = data && data.next && typeof data.next === 'object' ? data.next : null;
  const item = data && data.item && typeof data.item === 'object' ? data.item : null;
  if (next && ON_RE.test(String(next.due_on || ''))) return `Marked done. Next one due ${formatOn(next.due_on)}.`;
  if (item && item.recurrence && item.recurrence !== 'none') return 'Marked done. The next one is already on your list.';
  return 'Marked done.';
}

async function itemAction(button, { id, scope, action, method = 'POST', body = {}, done, failure }) {
  if (!isScope(scope)) {
    showNotice('Could not change it. Its scope is unknown.');
    return null;
  }
  return guarded(button, async () => {
    const path = action ? `/api/items/${enc(id)}/${action}` : `/api/items/${enc(id)}`;
    const r = await api(path, { method, body: { ...body, scope } });
    logEvent({ kind: `item_${action || 'patch'}`, id, status: r.status, ok: r.ok });
    if (r.ok) {
      showToast(done, changeIdFrom(r.data));
      reloadCurrent();
    } else {
      showNotice(failWords(r, failure));
    }
    return r;
  });
}

// ---------------------------------------------------------------------------
// Router

function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('?')[0].split('/').filter(Boolean);
  let name = parts[0] || 'today';
  let id = null;
  if (parts[1]) {
    try {
      id = decodeURIComponent(parts[1]);
    } catch {
      id = null;
    }
    if (!PATH_ID_RE.test(id || '')) id = null;
  }
  if (!ROUTES.has(name)) name = 'today';
  if (name === 'project' && !id) name = 'projects';
  return { name, id };
}

function hashFor(route) {
  return route.id ? `#/${route.name}/${enc(route.id)}` : `#/${route.name}`;
}

function go(name, id) {
  location.hash = hashFor({ name, id: id || null });
}

function currentHeading() {
  const screen = document.querySelector('.screen:not([hidden])');
  return screen ? screen.querySelector('h1') : null;
}

function onRoute() {
  const r = parseHash();
  if (r.name === 'capture') {
    if (!state.routedOnce) showScreen(state.baseRoute, false);
    state.routedOnce = true;
    openCaptureSheet();
    return;
  }
  closeCaptureSheet(false);
  const same = state.routedOnce && r.name === state.route.name && r.id === state.route.id;
  state.route = r;
  state.baseRoute = r;
  const moveFocus = state.routedOnce && !same;
  state.routedOnce = true;
  // The same route again only happens when the sheet closes back onto it: keep the
  // screen as it was. The dialog returns focus to the control that opened it.
  if (same) return;
  showScreen(r, moveFocus);
}

function showScreen(route, moveFocus) {
  const target = `screen-${route.name}`;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== target;
  for (const tab of document.querySelectorAll('.tab[data-tab]')) {
    const name = tab.dataset.tab;
    const active =
      name === route.name ||
      (name === 'projects' && route.name === 'project') ||
      (name === 'today' && (route.name === 'review' || route.name === 'waiting' || route.name === 'tasks'));
    if (active && name !== 'capture') tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = `${titleFor(route)} - Harrison OS`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    const h1 = currentHeading();
    if (h1) h1.focus({ preventScroll: true });
  }
  loadRoute(route);
}

function titleFor(route) {
  switch (route.name) {
    case 'review':
      return 'Review';
    case 'waiting':
      return 'Waiting';
    case 'tasks':
      return route.id === 'archived' ? 'Archived tasks' : 'Open tasks';
    case 'projects':
      return 'Projects';
    case 'project':
      return 'Project';
    case 'memory':
      return 'Memory';
    default:
      return EXT.routes.has(route.name) ? EXT.routes.get(route.name).title : 'Today';
  }
}

function loadRoute(route) {
  switch (route.name) {
    case 'review':
      return loadReview(route.id);
    case 'waiting':
      return loadWaiting();
    case 'tasks':
      return loadTasks();
    case 'projects':
      return loadProjects();
    case 'project':
      return loadProject(route.id);
    case 'memory':
      renderExtBlocks(EXT.memory, 'memory-extra', null);
      loadPreferences();
      return rerunSearch();
    default:
      if (EXT.routes.has(route.name)) {
        const r = EXT.routes.get(route.name);
        return r.load(route, $(`${route.name}-body`));
      }
      return loadToday();
  }
}

function reloadCurrent() {
  return loadRoute(state.route);
}

let dataRefreshTimer = null;
function scheduleDataRefresh() {
  clearTimeout(dataRefreshTimer);
  dataRefreshTimer = setTimeout(() => {
    if (state.route.name === 'today' || (state.route.name === 'review' && !state.route.id)) reloadCurrent();
  }, 600);
}

// ---------------------------------------------------------------------------
// Scope switch (All / Work / Personal), remembered on this phone

function renderScopeSwitch() {
  for (const btn of document.querySelectorAll('.scope-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.scope));
  }
  document.body.dataset.scope = state.scope;
}

function setScope(scope) {
  if (!SCOPES.includes(scope) || scope === state.scope) return;
  state.scope = scope;
  writeLocal(SCOPE_KEY, scope);
  renderScopeSwitch();
  setStatus(scope === 'all' ? 'Showing Work and Personal.' : `Showing ${scope === 'work' ? 'Work' : 'Personal'} only.`);
  reloadCurrent();
}

// ---------------------------------------------------------------------------
// Notices: sign-in banner, offline

function renderAuthBanner() {
  const pendingAuth = [...state.items.values()].some((i) => i.state === 'auth_required');
  const show = state.authLost || pendingAuth;
  const banner = $('auth-banner');
  if (!show) {
    banner.hidden = true;
    return;
  }
  const n = [...state.items.values()].filter(isPending).length;
  setText('auth-banner-text', n > 0 ? `Sign in again to sync ${plural(n, 'item', 'items')}. They're safe on this phone.` : 'Sign in again to keep syncing.');
  banner.hidden = false;
}

function renderOffline() {
  $('offline-banner').hidden = navigator.onLine !== false;
}

function signInAgain() {
  flushDraft();
  location.reload();
}

function noticeBlock(message, retry) {
  const box = h('div', { class: 'notice notice-warn' }, h('p', { text: message }));
  if (retry) box.append(h('button', { type: 'button', class: 'btn btn-secondary', text: 'Try again', onclick: retry }));
  return box;
}

// ---------------------------------------------------------------------------
// Today

function unwrapToday(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.today) || data.next !== undefined || data.fixed !== undefined) return data;
  if (data.today && typeof data.today === 'object') return data.today;
  return data;
}

async function loadToday() {
  const seq = ++state.seq.today;
  const body = $('today-body');
  setText('today-date', formatLongToday());
  body.setAttribute('aria-busy', 'true');
  if (!state.today) body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  const r = await api(`/api/today?${qs({ scope: state.scope, tz: deviceTimeZone() })}`);
  if (seq !== state.seq.today) return;
  if (r.ok) {
    const t = unwrapToday(r.data);
    state.today = t;
    state.todayScope = state.scope;
    state.todayError = null;
    // The server records this open after computing returnView, so a later load returns
    // null. Keep the first one on screen until it is dismissed. A new one (a new time away,
    // even in a session that stayed open for days) shows again after an earlier dismissal.
    if (t && t.returnView) {
      state.returnView = t.returnView;
      state.returnDismissed = false;
    }
  } else {
    state.todayError = failWords(r, 'load Today');
  }
  body.setAttribute('aria-busy', 'false');
  renderToday();
}

function renderToday() {
  const body = $('today-body');
  const key = focusKey();
  body.replaceChildren();
  const t = state.today && state.todayScope === state.scope ? state.today : null;
  if (state.todayError) body.append(noticeBlock(t ? `${state.todayError} Showing what loaded last.` : state.todayError, () => loadToday()));
  if (!t) {
    if (!state.todayError) body.append(h('p', { class: 'subtle', text: 'Loading.' }));
    restoreFocus(body, key);
    return;
  }

  if (state.returnView && !state.returnDismissed) body.append(renderReturnView(state.returnView));

  const fixed = listFrom(t.fixed);
  if (fixed.length) {
    const ul = h('ul', { class: 'list fixed-list' });
    for (const f of fixed) {
      const when = f.at ? formatTimeOfDay(f.at) : f.on ? formatOn(f.on) : '';
      ul.append(h('li', { class: 'fixed-row' }, h('span', { class: 'fixed-when', text: when || 'Today' }), h('span', { class: 'fixed-label', text: f.label || '' })));
    }
    body.append(section('Fixed today', ul, 'today-fixed'));
  }

  body.append(renderNext(t.next));

  const todayList = listFrom(t.today);
  const ul = h('ul', { class: 'list check-list' });
  for (const row of todayList) {
    const ref = parseRef(row.ref);
    if (ref.type === 'item') {
      const picked = row.picked === true || row.picked === 1;
      ul.append(
        checkRow({
          id: ref.id,
          scope: row.scope,
          title: row.title,
          meta: row.meta,
          done: !!row.done,
          sample: row.sample,
          extra: row.done
            ? null
            : [
                picked ? pickButton({ id: ref.id, scope: row.scope, picked: true, title: row.title }) : null,
                editButton({ id: ref.id, scope: row.scope, title: row.title }),
              ],
        }),
      );
    } else {
      ul.append(h('li', { class: 'check-row' }, h('span', { class: 'check-label', text: row.title || '' })));
    }
  }
  const emptyToday = h(
    'p',
    { class: 'subtle' },
    'Nothing picked for today. ',
    h('a', { href: '#/tasks', class: 'inline-link', dataset: { fk: 'pick-from-tasks' }, text: 'Pick from your open tasks' }),
  );
  const todaySection = section('Today', todayList.length ? ul : emptyToday, 'today-list');
  body.append(todaySection);

  const links = h('div', { class: 'link-grid' });
  const inboxCount = countOf(t.needsYou && t.needsYou.inboxCount);
  links.append(
    linkCard('#/review', inboxCount > 0 ? `${plural(inboxCount, 'capture', 'captures')} to review` : 'Nothing to review', inboxCount > 0 ? 'Needs you' : 'Review', inboxCount > 0),
  );
  const wCount = countOf(t.waiting && t.waiting.count);
  const wDue = countOf(t.waiting && t.waiting.dueCount);
  links.append(
    linkCard('#/waiting', wCount > 0 ? `Waiting on others: ${wCount}` : 'Waiting on nobody', wDue > 0 ? `${wDue} to follow up today` : 'Waiting', wDue > 0),
  );
  // Every open task, dated or not, is one tap away (the Today list holds only picks and hard dates).
  const openCount = countOf(t.tasks && t.tasks.openCount);
  links.append(linkCard('#/tasks', `All open tasks · ${openCount}`, 'Tasks', false));
  body.append(links);
  body.append(extSlot(EXT.today, t));

  const resume = listFrom(t.resume);
  if (resume.length) {
    const rl = h('ul', { class: 'list' });
    for (const p of resume) {
      const id = pick(p, 'projectId', 'project_id', 'id');
      if (!PATH_ID_RE.test(String(id || ''))) continue;
      const touched = pick(p, 'lastTouchedAt', 'last_touched_at');
      rl.append(
        h(
          'li',
          null,
          h(
            'a',
            { class: 'row-link', href: `#/project/${enc(id)}`, dataset: { fk: `resume-${id}` } },
            h('span', { class: 'row-title', text: p.name || '(no name)' }),
            h('span', { class: 'row-meta', text: touched ? `Last touched ${formatAt(touched)}` : 'Not touched yet' }),
          ),
        ),
      );
    }
    body.append(section('Pick up where you left off', rl, 'today-resume'));
  }
  restoreFocus(body, key);
}

function section(title, content, id) {
  const headingId = `${id}-h`;
  return h('section', { class: 'block', 'aria-labelledby': headingId }, h('h2', { id: headingId, class: 'block-title', text: title }), content);
}

function linkCard(href, title, eyebrow, highlight) {
  return h(
    'a',
    { class: `link-card${highlight ? ' is-highlight' : ''}`, href, dataset: { fk: `link-${href}` } },
    h('span', { class: 'eyebrow', text: eyebrow }),
    h('span', { class: 'link-card-title', text: title }),
  );
}

function renderNext(next) {
  const card = h('section', { class: 'card next-card', 'aria-labelledby': 'next-h' }, h('h2', { id: 'next-h', class: 'eyebrow', text: 'Next' }));
  if (!next) {
    card.append(h('p', { class: 'subtle', text: 'Nothing is waiting on you right now.' }));
    return card;
  }
  const ref = parseRef(next.ref);
  // A due follow-up is someone else's work: no "done" checkbox here. Waiting has Record reply,
  // Follow up later and Mark done.
  const waiting = next.kind === 'waiting';
  if (ref.type === 'item' && !waiting) {
    const ul = h('ul', { class: 'list check-list' }, checkRow({ id: ref.id, scope: next.scope, title: next.title, meta: null, done: false, sample: next.sample, fk: `next-${ref.id}` }));
    card.append(ul);
  } else {
    card.append(h('p', { class: 'next-title', text: next.title || '' }));
  }
  if (next.why) card.append(h('p', { class: 'why', text: next.why }));
  if (waiting) card.append(h('a', { class: 'btn btn-secondary', href: '#/waiting', dataset: { fk: 'next-open-waiting' }, text: 'Open Waiting' }));
  else if (ref.type === 'project') card.append(h('a', { class: 'btn btn-secondary', href: `#/project/${enc(ref.id)}`, text: 'Open project' }));
  else if (ref.type === 'capture') card.append(h('a', { class: 'btn btn-secondary', href: `#/review/${enc(ref.id)}`, text: 'Review it' }));
  return card;
}

function renderReturnView(rv) {
  const days = Number(rv.daysAway);
  const title = Number.isFinite(days) && days > 0 ? `You've been away ${plural(Math.floor(days), 'day', 'days')}` : "You've been away a while";
  const card = h('section', { class: 'card return-card', 'aria-labelledby': 'return-h' }, h('h2', { id: 'return-h', text: title }));
  card.append(h('p', { class: 'subtle', text: 'Nothing was moved, completed or deleted while you were away.' }));

  const dl = h('dl', { class: 'rows' });
  const row = (label, value) => dl.append(h('div', null, h('dt', { text: label }), h('dd', null, value)));
  const hard = listFrom(rv.hardDates7d);
  if (hard.length) {
    const ul = h('ul', { class: 'plain-list' });
    for (const d of hard) {
      if (typeof d === 'string') {
        ul.append(h('li', { text: d }));
        continue;
      }
      const label = pick(d, 'title', 'label', 'name') || '';
      const on = pick(d, 'on', 'due_on', 'dueOn');
      ul.append(h('li', null, on ? h('strong', { text: `${formatOn(on)}: ` }) : null, label));
    }
    row('Hard dates in the next 7 days', ul);
  } else {
    row('Hard dates in the next 7 days', 'None');
  }
  row('Follow-ups that came due', String(countOf(rv.passedFollowUps)));
  row('Reminders not acknowledged', String(countOf(rv.unacknowledgedReminders)));
  row('Captures to review', String(countOf(rv.inboxCount)));
  card.append(dl);

  const one = rv.oneNext;
  if (one && typeof one === 'object' && one.title) {
    card.append(h('p', { class: 'eyebrow', text: 'One thing to start with' }), h('p', { class: 'next-title', text: one.title }));
    if (one.why) card.append(h('p', { class: 'why', text: one.why }));
  }
  card.append(
    h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Go to Today',
      onclick: () => {
        state.returnDismissed = true;
        state.returnView = null;
        renderToday();
        const h1 = $('today-title');
        if (h1) h1.focus({ preventScroll: true });
      },
    }),
  );
  return card;
}

// ---------------------------------------------------------------------------
// Review

function normaliseProposal(p) {
  let payload = p && p.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  if (!payload || typeof payload !== 'object') payload = {};
  const merged = { ...payload, ...p };
  delete merged.payload;
  const fields = merged.fields && typeof merged.fields === 'object' ? merged.fields : payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
  const needs = Array.isArray(merged.needsReview) ? merged.needsReview : Array.isArray(merged.needs_review) ? merged.needs_review : [];
  return {
    ordinal: Number(merged.ordinal),
    kind: String(merged.kind || ''),
    title: merged.title === undefined || merged.title === null ? '' : String(merged.title),
    fields,
    sourceQuote: pick(merged, 'sourceQuote', 'source_quote') || null,
    needsReview: needs.map(String),
    state: String(merged.state || 'pending'),
  };
}

function normaliseCapture(c) {
  return {
    id: String(c.id || ''),
    text: String(c.text || ''),
    scope: c.scope,
    sample: c.sample,
    receivedAt: pick(c, 'received_at', 'receivedAt'),
    attachments: listFrom(c.attachments),
    proposals: listFrom(c.proposals)
      .map(normaliseProposal)
      .filter((p) => Number.isFinite(p.ordinal) && p.state === 'pending')
      .sort((a, b) => a.ordinal - b.ordinal),
  };
}

async function loadReview(id) {
  const seq = ++state.seq.review;
  const body = $('review-body');
  body.setAttribute('aria-busy', 'true');
  if (!state.inbox) body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  // A single capture is looked up across both scopes: it was opened by its own link.
  const scope = id ? 'all' : state.scope;
  // Active projects, so a filed piece can be put on a project (Edit, Project).
  const [r, pr] = await Promise.all([api(`/api/inbox?${qs({ scope })}`), api(`/api/projects?${qs({ scope: 'all' })}`)]);
  if (seq !== state.seq.review) return;
  if (pr.ok) {
    state.reviewProjects = listFrom(pr.data, 'projects', 'items').filter(
      (p) => p && PATH_ID_RE.test(String(p.id || '')) && isScope(p.scope) && (!p.state || p.state === 'active'),
    );
  }
  if (r.ok) {
    state.inbox = listFrom(r.data, 'captures', 'items', 'inbox').map(normaliseCapture).filter((c) => PATH_ID_RE.test(c.id));
    state.inboxScope = scope;
    state.inboxError = null;
  } else {
    state.inboxError = failWords(r, 'load captures to review');
  }
  body.setAttribute('aria-busy', 'false');
  renderReview();
}

function renderReview() {
  const body = $('review-body');
  const key = focusKey();
  body.replaceChildren();
  const id = state.route.name === 'review' ? state.route.id : null;
  if (state.inboxError) body.append(noticeBlock(state.inbox ? `${state.inboxError} Showing what loaded last.` : state.inboxError, () => reloadCurrent()));
  if (!state.inbox) {
    restoreFocus(body, key);
    return;
  }
  if (!id) renderInboxList(body);
  else renderCaptureReview(body, id);
  restoreFocus(body, key);
}

function renderInboxList(body) {
  setText('review-title', 'Review');
  const list = state.inbox.filter((c) => state.scope === 'all' || c.scope === state.scope);
  if (!list.length) {
    body.append(h('p', { class: 'empty', text: 'Nothing to review.' }));
    return;
  }
  body.append(h('p', { class: 'subtle', text: `${plural(list.length, 'capture', 'captures')} waiting for you to check what was found.` }));
  const ul = h('ul', { class: 'list' });
  for (const c of list) {
    const n = c.proposals.length;
    ul.append(
      h(
        'li',
        null,
        h(
          'a',
          { class: 'row-link', href: `#/review/${enc(c.id)}`, dataset: { fk: `inbox-${c.id}` } },
          h('span', { class: 'row-title', text: excerpt(c.text, 140) }),
          h(
            'span',
            { class: 'row-meta' },
            n ? `${plural(n, 'thing', 'things')} found` : 'Nothing found. Stays a note.',
            c.attachments.length ? ` · ${plural(c.attachments.length, 'attachment', 'attachments')}` : '',
            c.receivedAt ? ` · ${formatAt(c.receivedAt)}` : '',
          ),
          h('span', { class: 'chips' }, scopeChip(c.scope), sampleChip(c)),
        ),
      ),
    );
  }
  body.append(ul);
}

function decisionsFor(captureId) {
  let m = state.reviewDecisions.get(captureId);
  if (!m) {
    m = new Map();
    state.reviewDecisions.set(captureId, m);
  }
  return m;
}

function claimOf(fields) {
  const claim = fields.claim && typeof fields.claim === 'object' ? fields.claim : {};
  return {
    by: pick(claim, 'by') ?? pick(fields, 'claim_by', 'claimBy') ?? null,
    status: pick(claim, 'status') ?? pick(fields, 'claim_status', 'claimStatus') ?? null,
  };
}

function whenOf(fields) {
  const w = fields.when && typeof fields.when === 'object' ? fields.when : null;
  if (w) return w;
  const on = pick(fields, 'on', 'due_on', 'dueOn');
  const time = pick(fields, 'time');
  if (on || time) return { kind: time ? 'datetime' : 'date', on, time };
  return null;
}

function whenWords(w) {
  if (!w) return null;
  if (w.kind === 'none' || (!w.on && !w.time)) return w.original ? `Not understood: “${w.original}”` : 'Not stated';
  const parts = [];
  if (w.on) parts.push(formatOn(w.on));
  if (w.time) parts.push(formatHHMM(w.time));
  return parts.join(', ');
}

function reviewNoteWords(code) {
  const c = String(code).toLowerCase();
  if (c.includes('time')) return 'Check the time.';
  if (c.includes('date') || c.includes('when')) return 'Check the date.';
  if (c.includes('who') || c.includes('name') || c.includes('person')) return 'Check who this is about.';
  if (c.includes('status') || c.includes('claim')) return 'Check the status.';
  return 'Check this before filing.';
}

// Effective value for display: an edit wins over what was found.
function effective(p, dec, key, original) {
  if (dec && dec.edits && Object.prototype.hasOwnProperty.call(dec.edits, key)) return dec.edits[key];
  return original;
}

// Wall-clock time (HH:MM, 24 h) on this phone right now.
function localHHMM(ms = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: deviceTimeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return `${get('hour')}:${get('minute')}`;
  } catch {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

// Why a reminder proposal cannot be filed as it stands: 'incomplete' (no date or no time),
// 'past' (that time has gone), or null. The server refuses both, and the refusal would roll back
// the whole capture, so Review asks for an Edit first.
function reminderProblem(p, dec) {
  if (p.kind !== 'reminder') return null;
  const w = whenOf(p.fields || {}) || {};
  const known = w.kind === 'date' || w.kind === 'datetime' || (!w.kind && (w.on || w.time));
  const on = effective(p, dec, 'remind_on', known ? w.on || null : null);
  const time = effective(p, dec, 'remind_time', known ? w.time || null : null);
  if (!ON_RE.test(String(on || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) return 'incomplete';
  const today = localOn();
  if (on < today || (on === today && time <= localHHMM())) return 'past';
  return null;
}

const REMINDER_PROBLEM_WORDS = {
  incomplete: 'Needs a date and a time. Tap Edit.',
  past: 'That time has already passed. Tap Edit.',
};

function proposalStatus(p, dec) {
  const claim = claimOf(p.fields);
  const hasClaim = p.kind === 'waiting' || claim.by !== null || claim.status !== null;
  if (!hasClaim) return null;
  const s = effective(p, dec, 'claim_status', claim.status);
  return STATUS_LABEL[s] ? s : 'unspecified';
}

function renderCaptureReview(body, id) {
  const capture = state.inbox.find((c) => c.id === id);
  setText('review-title', 'Review');
  if (!capture) {
    body.append(
      h('p', { class: 'empty', text: "This capture isn't waiting for review. It may already be filed or deleted." }),
      h('a', { class: 'btn btn-secondary', href: '#/review', text: 'See captures to review' }),
    );
    return;
  }
  const decs = decisionsFor(capture.id);

  body.append(
    h(
      'section',
      { class: 'card original', 'aria-labelledby': 'orig-h' },
      h('h2', { id: 'orig-h', class: 'eyebrow', text: 'Your words' }),
      h('blockquote', { class: 'original-text', text: capture.text }),
      attachmentStrip(capture.attachments, capture.scope),
      h('p', { class: 'row-meta' }, h('span', { class: 'chips' }, scopeChip(capture.scope), sampleChip(capture)), capture.receivedAt ? ` Saved ${formatAt(capture.receivedAt)}` : ''),
    ),
  );

  if (!capture.proposals.length) {
    body.append(h('p', { class: 'subtle', text: 'Nothing to file was found in this. It stays as a note you can search.' }));
  } else {
    body.append(h('h2', { class: 'block-title', text: `Found ${plural(capture.proposals.length, 'thing', 'things')}` }));
    const anyEditing = capture.proposals.some((p) => decs.get(p.ordinal) && decs.get(p.ordinal).editing);
    capture.proposals.forEach((p, index) => body.append(proposalCard(capture, p, decs.get(p.ordinal) || null, index, anyEditing)));
  }

  const remaining = capture.proposals.filter((p) => !decs.get(p.ordinal) || !decs.get(p.ordinal).choice).length;
  const editing = capture.proposals.some((p) => decs.get(p.ordinal) && decs.get(p.ordinal).editing);
  // An accepted reminder with no date and time (or in the past) would make the server refuse the whole capture.
  const blocked = capture.proposals.some((p) => {
    const d = decs.get(p.ordinal);
    return d && d.choice === 'accept' && reminderProblem(p, d);
  });
  const footer = h('div', { class: 'review-footer' });
  if (capture.proposals.length) {
    footer.append(
      h('p', {
        class: 'subtle',
        'aria-live': 'polite',
        text: editing
          ? 'Finish the edit first.'
          : remaining > 0
            ? `Decide on ${remaining} more.`
            : blocked
              ? 'A reminder needs a date and a later time before filing. Tap Edit on it.'
              : 'Ready to file.',
      }),
      h('button', {
        type: 'button',
        class: 'btn btn-primary btn-block',
        text: 'File these',
        disabled: remaining > 0 || editing || blocked || state.reviewBusy,
        dataset: { fk: `review-save-${capture.id}` },
        onclick: (e) => submitReview(e.currentTarget, capture, false),
      }),
    );
  }
  footer.append(
    h('button', {
      type: 'button',
      class: 'btn btn-secondary btn-block',
      text: capture.proposals.length ? 'Keep as a note only' : 'Keep as a note',
      disabled: state.reviewBusy,
      dataset: { fk: `review-note-${capture.id}` },
      onclick: (e) => submitReview(e.currentTarget, capture, true),
    }),
    h('button', {
      type: 'button',
      class: 'btn btn-danger btn-block',
      text: 'Delete this capture',
      disabled: state.reviewBusy,
      onclick: (e) => deleteCapture(e.currentTarget, capture),
    }),
  );
  body.append(footer);
}

function proposalCard(capture, p, dec, index, anyEditing) {
  const fields = p.fields || {};
  const card = h('article', { class: `card proposal${dec && dec.choice === 'drop' ? ' is-dropped' : ''}`, 'aria-label': `${KIND_LABEL[p.kind] || 'Item'}, ${index + 1} of ${capture.proposals.length}` });
  const status = proposalStatus(p, dec);
  card.append(h('div', { class: 'chips' }, kindChip(p.kind), statusChip(status)));
  card.append(h('h3', { class: 'proposal-title', text: effective(p, dec, 'title', p.title) || '(no title)' }));

  const dl = h('dl', { class: 'rows' });
  const row = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    dl.append(h('div', null, h('dt', { text: label }), h('dd', { text: String(value) })));
  };
  const claim = claimOf(fields);
  let mentionedOn = null;
  if (p.kind === 'task') {
    row('Asked by', effective(p, dec, 'claim_by', claim.by));
    const due = effective(p, dec, 'due_on', pick(fields, 'due_on', 'dueOn') || null);
    const mentioned = whenOf(fields);
    if (due) row('Due', formatOn(due));
    else if (mentioned && mentioned.on && ON_RE.test(String(mentioned.on))) {
      // A date in the sentence is not filed as a due date unless he says so (Use as due date or Edit).
      row('Date mentioned (not a due date)', whenWords(mentioned));
      mentionedOn = mentioned.on;
    } else row('When', whenWords(mentioned));
  } else if (p.kind === 'waiting') {
    row('Who', effective(p, dec, 'who', pick(fields, 'who') || null) || 'not stated');
    const promised = effective(p, dec, 'promised_on', pick(fields, 'promised_on', 'promisedOn') || null);
    row('Promised by', promised ? formatOn(promised) : 'not stated');
    // A date in the sentence that is not a confirmed promise is shown, never filed as one (Edit sets it).
    const mentionedW = whenOf(fields);
    if (!promised && mentionedW && mentionedW.on && ON_RE.test(String(mentionedW.on))) row('Date mentioned (not a confirmed promise)', whenWords(mentionedW));
    const follow = effective(p, dec, 'follow_up_on', pick(fields, 'follow_up_on', 'followUpOn') || null);
    if (follow) row('Follow up', formatOn(follow));
    row('Reply', 'No reply recorded');
  } else if (p.kind === 'reminder') {
    const w = whenOf(fields) || {};
    const on = effective(p, dec, 'remind_on', w.on || null);
    const time = effective(p, dec, 'remind_time', w.time || null);
    row('When', whenWords(on || time ? { kind: 'datetime', on, time } : w) || 'Not stated');
    if (fields.replaced) {
      const rep = fields.replaced;
      row('Replaced', typeof rep === 'object' ? whenWords(rep) : String(rep));
    }
  } else if (p.kind === 'reference') {
    row('Link', pick(fields, 'url'));
  } else if (p.kind === 'decision') {
    row('Reason', effective(p, dec, 'reason', pick(fields, 'reason') || null));
  }
  if (p.kind !== 'reminder') {
    const projectId = effective(p, dec, 'project_id', pick(fields, 'project_id', 'projectId') || null);
    if (projectId) {
      const proj = (state.reviewProjects || []).find((x) => x.id === projectId);
      row('Project', proj && proj.name ? proj.name : 'A project');
    }
  }
  if (dl.childNodes.length) card.append(dl);

  const notes = new Set(p.needsReview.map(reviewNoteWords));
  const w = whenOf(fields);
  if (w && w.needsTimeCheck && !(dec && dec.edits && dec.edits.remind_time)) notes.add('Check the time. It was read from a part of the day.');
  const problem = reminderProblem(p, dec);
  if (problem) notes.add(REMINDER_PROBLEM_WORDS[problem]);
  for (const n of notes) card.append(h('p', { class: 'note-warn', text: n }));

  if (p.sourceQuote) card.append(h('p', { class: 'source' }, h('span', { class: 'visually-hidden', text: 'From your words: ' }), `“${p.sourceQuote}”`));

  if (dec && dec.editing) {
    card.append(editForm(capture, p, dec));
    return card;
  }

  const choice = dec ? dec.choice : null;
  if (mentionedOn && !anyEditing) {
    card.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: 'Use as due date',
        dataset: { fk: `due-${capture.id}-${p.ordinal}` },
        // The date is copied as read from his words, and set only by this tap.
        onclick: () => {
          setDecision(capture.id, p.ordinal, { choice: 'accept', edits: { ...((dec && dec.edits) || {}), due_on: mentionedOn } });
          setStatus(`Due date set to ${formatOn(mentionedOn)}. It will be filed with it.`);
        },
      }),
    );
  }
  const buttons = h('div', { class: 'button-row' });
  buttons.append(
    h('button', {
      type: 'button',
      class: `btn btn-choice${choice === 'accept' ? ' is-on' : ''}`,
      'aria-pressed': String(choice === 'accept'),
      text: 'Looks right',
      // A reminder without a date and time (or in the past) cannot be filed as it is: Edit first.
      disabled: anyEditing || (!!problem && choice !== 'accept'),
      dataset: { fk: `accept-${capture.id}-${p.ordinal}` },
      onclick: () => {
        // After "Use these" the edit is already accepted: a second tap must not silently drop it.
        if (choice === 'accept' && dec && dec.edits && Object.keys(dec.edits).length > 0) {
          setStatus('Already accepted with your edit. Tap Edit to change it, or Drop.');
          return;
        }
        setDecision(capture.id, p.ordinal, { choice: choice === 'accept' ? null : 'accept' });
      },
    }),
    h('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: 'Edit',
      disabled: anyEditing,
      dataset: { fk: `edit-${capture.id}-${p.ordinal}` },
      onclick: () => setDecision(capture.id, p.ordinal, { editing: true, focusEdit: true, draft: {} }),
    }),
    h('button', {
      type: 'button',
      class: `btn btn-choice btn-choice-drop${choice === 'drop' ? ' is-on' : ''}`,
      'aria-pressed': String(choice === 'drop'),
      text: 'Drop',
      disabled: anyEditing,
      dataset: { fk: `drop-${capture.id}-${p.ordinal}` },
      onclick: () => setDecision(capture.id, p.ordinal, { choice: choice === 'drop' ? null : 'drop' }),
    }),
  );
  card.append(buttons);
  const edited = dec && dec.edits && Object.keys(dec.edits).length > 0;
  card.append(
    h('p', {
      class: 'decision-line',
      text:
        choice === 'accept' && problem
          ? 'Cannot be filed yet. Tap Edit, or Drop it.'
          : choice === 'accept'
            ? edited
              ? 'Will be filed with your edits.'
              : 'Will be filed.'
            : choice === 'drop'
              ? 'Will be dropped. Your words stay in the note.'
              : 'Not decided yet.',
    }),
  );
  return card;
}

function setDecision(captureId, ordinal, patch) {
  const decs = decisionsFor(captureId);
  const cur = decs.get(ordinal) || { choice: null, edits: {}, editing: false };
  decs.set(ordinal, { ...cur, ...patch });
  renderReview();
}

let formSeq = 0;
function editForm(capture, p, dec) {
  const fields = p.fields || {};
  const claim = claimOf(fields);
  const w = whenOf(fields) || {};
  const n = ++formSeq;
  const form = h('form', { class: 'form edit-form', novalidate: true });
  const inputs = [];
  const add = (key, label, type, original, options) => {
    const id = `ef-${n}-${key}`;
    // Typed but unsaved values survive a re-render (for example after reconnecting).
    const drafted = dec.draft && Object.prototype.hasOwnProperty.call(dec.draft, key) ? dec.draft[key] : undefined;
    const current = drafted !== undefined ? drafted : effective(p, dec, key, original);
    let input;
    if (type === 'status') {
      input = h('select', { id, name: key });
      for (const s of CLAIM_STATUSES) input.append(h('option', { value: s, text: STATUS_LABEL[s], selected: s === (current || 'unspecified') }));
    } else if (type === 'project') {
      input = h('select', { id, name: key });
      input.append(h('option', { value: '', text: 'No project', selected: !current }));
      for (const pr of options || []) input.append(h('option', { value: pr.id, text: pr.name || '(no name)', selected: pr.id === current }));
    } else if (type === 'textarea') {
      input = h('textarea', { id, name: key, rows: 2, maxlength: 2000, value: current || '' });
    } else {
      input = h('input', { id, name: key, type, value: current || '', autocomplete: 'off', maxlength: type === 'text' ? 500 : null });
    }
    input.addEventListener(type === 'status' || type === 'project' ? 'change' : 'input', () => {
      if (!dec.draft) dec.draft = {};
      dec.draft[key] = input.value;
    });
    inputs.push({ key, input, original: original === undefined ? null : original, type });
    form.append(h('label', { for: id, text: label }), input);
  };
  add('title', 'Title', 'text', p.title);
  if (p.kind === 'task') {
    add('due_on', 'Due date', 'date', pick(fields, 'due_on', 'dueOn') || null);
    add('claim_by', 'Asked by', 'text', claim.by);
    add('claim_status', 'Status', 'status', claim.status || 'unspecified');
  } else if (p.kind === 'waiting') {
    add('who', 'Who', 'text', pick(fields, 'who') || null);
    add('promised_on', 'Promised by', 'date', pick(fields, 'promised_on', 'promisedOn') || null);
    add('follow_up_on', 'Follow up on', 'date', pick(fields, 'follow_up_on', 'followUpOn') || null);
    add('claim_status', 'Status', 'status', claim.status || 'unspecified');
  } else if (p.kind === 'reminder') {
    add('remind_on', 'Date', 'date', w.on || null);
    add('remind_time', 'Time', 'time', w.time || null);
  } else if (p.kind === 'decision') {
    add('reason', 'Reason', 'textarea', pick(fields, 'reason') || null);
  }
  if (p.kind !== 'reminder') {
    // Only projects in the capture's own scope: a filed piece keeps the capture's scope.
    const projects = (state.reviewProjects || []).filter((x) => x.scope === capture.scope);
    if (projects.length) add('project_id', 'Project', 'project', pick(fields, 'project_id', 'projectId') || null, projects);
  }
  const err = h('p', { class: 'field-error', hidden: true });
  form.append(
    err,
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'submit', class: 'btn btn-primary', text: 'Use these' }),
      h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => setDecision(capture.id, p.ordinal, { editing: false, draft: null }) }),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const edits = {};
    for (const { key, input, original } of inputs) {
      const v = input.value.trim();
      const orig = original === null || original === undefined ? '' : String(original);
      if (v === orig) continue;
      edits[key] = v === '' ? null : v;
    }
    if (Object.prototype.hasOwnProperty.call(edits, 'title') && !edits.title) {
      err.textContent = 'A title is needed.';
      err.hidden = false;
      return;
    }
    setDecision(capture.id, p.ordinal, { choice: 'accept', edits, editing: false, draft: null });
    setStatus('Edit kept. It will be filed with your changes.');
  });
  // Focus the first field only when the form has just been opened, not on re-renders.
  if (dec.focusEdit) {
    dec.focusEdit = false;
    setTimeout(() => {
      const first = form.querySelector('input, select, textarea');
      if (first) first.focus({ preventScroll: false });
    }, 0);
  }
  return form;
}

async function submitReview(button, capture, keepAsNote) {
  if (state.reviewBusy) return;
  if (!isScope(capture.scope)) {
    showNotice('Could not file it. Its scope is unknown.');
    return;
  }
  const decs = decisionsFor(capture.id);
  const accept = [];
  const drop = [];
  for (const p of capture.proposals) {
    const d = decs.get(p.ordinal);
    if (!keepAsNote && d && d.choice === 'accept') accept.push({ ordinal: p.ordinal, edits: d.edits || {} });
    else drop.push(p.ordinal);
  }
  state.reviewBusy = true;
  await guarded(button, async () => {
    const r = await api(`/api/captures/${enc(capture.id)}/review`, {
      method: 'POST',
      body: { accept, drop, keepAsNote: !!keepAsNote || accept.length === 0, scope: capture.scope },
    });
    logEvent({ kind: 'review', id: capture.id, accepted: accept.length, dropped: drop.length, status: r.status, ok: r.ok });
    if (r.ok) {
      state.reviewDecisions.delete(capture.id);
      const created = listFrom(r.data, 'items', 'created').length || accept.length;
      setStatus(accept.length ? `Filed ${plural(created, 'item', 'items')}.` : 'Kept as a note.');
      state.inbox = (state.inbox || []).filter((c) => c.id !== capture.id);
      const next = state.inbox.find((c) => state.scope === 'all' || c.scope === state.scope);
      state.reviewBusy = false;
      go('review', next ? next.id : null);
    } else {
      showNotice(failWords(r, 'file it'));
    }
  });
  state.reviewBusy = false;
  if (state.route.name === 'review') renderReview();
}

async function deleteCapture(button, capture) {
  if (state.reviewBusy) return;
  if (!isScope(capture.scope)) return;
  if (!window.confirm('Delete this capture? Your original words and its photos and files are removed for good. Anything already filed from it stays, marked as from a deleted capture.')) return;
  state.reviewBusy = true;
  await guarded(button, async () => {
    const r = await api(`/api/captures/${enc(capture.id)}?${qs({ scope: capture.scope })}`, { method: 'DELETE' });
    logEvent({ kind: 'capture_delete', id: capture.id, status: r.status, ok: r.ok });
    if (r.ok) {
      state.reviewDecisions.delete(capture.id);
      state.inbox = (state.inbox || []).filter((c) => c.id !== capture.id);
      // "Removed for good" includes this phone: drop the outbox copy (its words were shown under
      // "On this phone", and a still-pending copy would be sent again).
      try {
        const stores = await storesReady;
        await stores.outbox.remove(capture.id);
      } catch {
        /* the server refuses a deleted id anyway */
      }
      state.items.delete(capture.id);
      await removeLocalAttachments(capture.id);
      renderOutbox();
      setStatus('Capture deleted.');
      state.reviewBusy = false;
      go('review', null);
    } else {
      showNotice(failWords(r, 'delete it'));
    }
  });
  state.reviewBusy = false;
  if (state.route.name === 'review') renderReview();
}

// ---------------------------------------------------------------------------
// Waiting

function scopesToQuery() {
  return state.scope === 'all' ? ['work', 'personal'] : [state.scope];
}

function normaliseItem(it, fallbackScope) {
  return { ...it, id: String(it.id || ''), scope: isScope(it.scope) ? it.scope : fallbackScope };
}

async function loadWaiting() {
  const seq = ++state.seq.waiting;
  const body = $('waiting-body');
  body.setAttribute('aria-busy', 'true');
  if (!state.waiting) body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  const scopes = scopesToQuery();
  const results = await Promise.all(scopes.map((s) => api(`/api/items?${qs({ kind: 'waiting', state: 'open', scope: s })}`)));
  if (seq !== state.seq.waiting) return;
  const bad = results.find((r) => !r.ok);
  if (bad) {
    state.waitingError = failWords(bad, 'load what you are waiting on');
  } else {
    const all = [];
    results.forEach((r, i) => {
      for (const it of listFrom(r.data, 'items', 'waiting')) all.push(normaliseItem(it, scopes[i]));
    });
    state.waiting = all.filter((it) => PATH_ID_RE.test(it.id) && (it.kind === undefined || it.kind === 'waiting') && (it.state === undefined || it.state === 'open'));
    state.waitingScope = state.scope;
    state.waitingError = null;
  }
  body.setAttribute('aria-busy', 'false');
  renderWaiting();
}

function renderWaiting() {
  const body = $('waiting-body');
  const key = focusKey();
  body.replaceChildren();
  const list = state.waiting && state.waitingScope === state.scope ? state.waiting : null;
  if (state.waitingError) body.append(noticeBlock(list ? `${state.waitingError} Showing what loaded last.` : state.waitingError, () => loadWaiting()));
  if (!list) {
    restoreFocus(body, key);
    return;
  }
  if (!list.length) {
    body.append(h('p', { class: 'empty', text: 'Not waiting on anyone.' }));
    restoreFocus(body, key);
    return;
  }
  const today = localOn();
  const sorted = list.slice().sort((a, b) => {
    const da = a.follow_up_on && a.follow_up_on <= today ? 0 : 1;
    const db = b.follow_up_on && b.follow_up_on <= today ? 0 : 1;
    if (da !== db) return da - db;
    const fa = a.follow_up_on || '9999-99-99';
    const fb = b.follow_up_on || '9999-99-99';
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
  const ul = h('ul', { class: 'list cards' });
  for (const it of sorted) ul.append(h('li', null, waitingCard(it, today)));
  body.append(ul);
  restoreFocus(body, key);
}

function waitingCard(it, today) {
  const due = !!it.follow_up_on && it.follow_up_on <= today;
  const card = h('article', { class: `card waiting-card${due ? ' is-due' : ''}`, 'aria-label': it.title || 'Waiting item' });
  card.append(
    h(
      'div',
      { class: 'chips' },
      due ? chip('chip-due', 'Follow up today') : null,
      statusChip(STATUS_LABEL[it.claim_status] ? it.claim_status : 'unspecified'),
      state.scope === 'all' ? scopeChip(it.scope) : null,
      sampleChip(it),
    ),
  );
  card.append(h('h2', { class: 'card-title', text: it.title || '(no title)' }));
  const dl = h('dl', { class: 'rows' });
  const row = (label, value) => dl.append(h('div', null, h('dt', { text: label }), h('dd', { text: value })));
  row('Who', it.who ? String(it.who) : 'not stated');
  row('Asked on', it.asked_on ? formatOn(it.asked_on) : 'not stated');
  row('Promised by', it.promised_on ? formatOn(it.promised_on) : 'not stated');
  row('Follow up', it.follow_up_on ? formatOn(it.follow_up_on) : 'not set');
  row('Reply', it.reply_recorded_at ? `Reply recorded ${formatAt(it.reply_recorded_at)}` : 'No reply recorded');
  card.append(dl);

  const actions = h('div', { class: 'button-row' });
  actions.append(
    h('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: 'Record reply',
      dataset: { fk: `reply-${it.id}` },
      onclick: (e) => itemAction(e.currentTarget, { id: it.id, scope: it.scope, action: 'reply', done: 'Reply recorded.', failure: 'record the reply' }),
    }),
    h('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: 'Mark done',
      dataset: { fk: `done-${it.id}` },
      onclick: (e) => itemAction(e.currentTarget, { id: it.id, scope: it.scope, action: 'complete', done: 'Marked done.', failure: 'mark it done' }),
    }),
  );
  card.append(actions);

  // Follow up later
  const n = ++formSeq;
  const snooze = h('details', { class: 'inline-form' });
  const dateId = `snz-${n}`;
  const dateInput = h('input', { id: dateId, type: 'date', min: today, value: '' });
  const snoozeBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save follow-up date' });
  const snoozeForm = h('form', { class: 'form', novalidate: true }, h('label', { for: dateId, text: 'Follow up on' }), dateInput, snoozeBtn);
  snoozeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ON_RE.test(dateInput.value)) {
      showNotice('Pick a date first.');
      return;
    }
    itemAction(snoozeBtn, {
      id: it.id,
      scope: it.scope,
      action: 'snooze',
      body: { follow_up_on: dateInput.value },
      done: `Follow-up moved to ${formatOn(dateInput.value)}.`,
      failure: 'move the follow-up',
    });
  });
  snooze.append(h('summary', { class: 'btn btn-ghost', text: 'Follow up later' }), snoozeForm);
  card.append(snooze);

  // Status is a user edit, recorded on the server. Nothing upgrades it by itself.
  const statusId = `st-${n}`;
  const select = h('select', { id: statusId });
  const current = STATUS_LABEL[it.claim_status] ? it.claim_status : 'unspecified';
  for (const s of CLAIM_STATUSES) select.append(h('option', { value: s, text: STATUS_LABEL[s], selected: s === current }));
  const statusBtn = h('button', { type: 'submit', class: 'btn btn-secondary', text: 'Change status' });
  const statusForm = h('form', { class: 'form', novalidate: true }, h('label', { for: statusId, text: 'Status' }), select, statusBtn);
  statusForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (select.value === current) {
      showNotice('Status is unchanged.');
      return;
    }
    itemAction(statusBtn, {
      id: it.id,
      scope: it.scope,
      method: 'PATCH',
      body: { claim_status: select.value },
      done: `Status changed to ${STATUS_LABEL[select.value]}.`,
      failure: 'change the status',
    });
  });
  const statusDetails = h('details', { class: 'inline-form' }, h('summary', { class: 'btn btn-ghost', text: 'Change status' }), statusForm);
  card.append(statusDetails);
  return card;
}

// ---------------------------------------------------------------------------
// Open tasks: every open task in the current scope, so none is reachable only by search.
// Groups: Due (by due date), Picked for today (no date), Anytime (the rest, newest first).

async function loadTasks() {
  const seq = ++state.seq.tasks;
  const body = $('tasks-body');
  const mode = state.route.name === 'tasks' && state.route.id === 'archived' ? 'archived' : 'open';
  if (mode !== state.tasksMode) {
    state.tasksMode = mode;
    state.tasks = null;
  }
  renderTasksHead();
  body.setAttribute('aria-busy', 'true');
  if (!state.tasks) body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  const scopes = scopesToQuery();
  const results = await Promise.all(scopes.map((s) => api(`/api/items?${qs({ kind: 'task', state: mode, scope: s, limit: 500 })}`)));
  if (seq !== state.seq.tasks) return;
  const bad = results.find((r) => !r.ok);
  if (bad) {
    state.tasksError = failWords(bad, mode === 'archived' ? 'load archived tasks' : 'load your open tasks');
  } else {
    const all = [];
    results.forEach((r, i) => {
      for (const it of listFrom(r.data, 'items', 'tasks')) all.push(normaliseItem(it, scopes[i]));
    });
    state.tasks = all.filter((it) => PATH_ID_RE.test(it.id) && (it.kind === undefined || it.kind === 'task') && (it.state === undefined || it.state === mode));
    state.tasksScope = state.scope;
    state.tasksError = null;
  }
  body.setAttribute('aria-busy', 'false');
  renderTasks();
}

function renderTasksHead() {
  const archived = state.tasksMode === 'archived';
  setText('tasks-title', archived ? 'Archived tasks' : 'Open tasks');
  setText(
    'tasks-sub',
    archived
      ? 'Put away without being done. Bring one back to make it open again.'
      : 'Everything still open, dated or not. Pick a few for today; hard dates show on Today by themselves.',
  );
  const link = $('tasks-mode-link');
  if (link) {
    link.href = archived ? '#/tasks' : '#/tasks/archived';
    link.textContent = archived ? 'Back to open tasks' : 'Archived tasks';
  }
  document.title = `${archived ? 'Archived tasks' : 'Open tasks'} - Harrison OS`;
}

function isPicked(it) {
  return it.today_pick === 1 || it.today_pick === true;
}

function taskGroups(list) {
  const byStr = (key) => (a, b) => {
    const x = String(a[key] || '');
    const y = String(b[key] || '');
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const newestFirst = (a, b) => -byStr('created_at')(a, b);
  const due = list.filter((it) => ON_RE.test(String(it.due_on || ''))).sort((a, b) => byStr('due_on')(a, b) || byStr('created_at')(a, b));
  const rest = list.filter((it) => !ON_RE.test(String(it.due_on || '')));
  return {
    due,
    picked: rest.filter(isPicked).sort(byStr('created_at')),
    anytime: rest.filter((it) => !isPicked(it)).sort(newestFirst),
  };
}

function taskMeta(it, today) {
  const parts = [];
  if (ON_RE.test(String(it.due_on || ''))) {
    if (it.due_on < today) parts.push(`Overdue · due ${formatOn(it.due_on)}`);
    else if (it.due_on === today) parts.push('Due today');
    else parts.push(`Due ${formatOn(it.due_on)}`);
  }
  if (ON_RE.test(String(it.start_on || '')) && it.start_on > today) parts.push(`Not before ${formatOn(it.start_on)}`);
  if (it.recurrence && it.recurrence !== 'none' && RECURRENCE_LABEL[it.recurrence]) parts.push(RECURRENCE_LABEL[it.recurrence]);
  if (isPicked(it)) parts.push('Picked for today');
  if (it.claim_by) parts.push(`Asked by ${it.claim_by}`);
  return parts.join(' · ') || null;
}

function editButton({ id, scope, title }) {
  return h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-pick',
    text: 'Edit',
    'aria-label': `Edit: ${title || 'task'}`,
    dataset: { fk: `edit-task-${id}` },
    onclick: (e) => openTaskSheet(e.currentTarget, id, scope),
  });
}

function onTasksFilterInput() {
  state.tasksFilter = $('tasks-filter').value;
  renderTasks();
}

function renderTasks() {
  const body = $('tasks-body');
  const key = focusKey();
  body.replaceChildren();
  const archived = state.tasksMode === 'archived';
  const list = state.tasks && state.tasksScope === state.scope ? state.tasks : null;
  if (state.tasksError) body.append(noticeBlock(list ? `${state.tasksError} Showing what loaded last.` : state.tasksError, () => loadTasks()));
  if (!list) {
    restoreFocus(body, key);
    return;
  }
  if (!list.length) {
    body.append(h('p', { class: 'empty', text: archived ? 'No archived tasks.' : 'No open tasks.' }));
    restoreFocus(body, key);
    return;
  }
  const today = localOn();
  const filter = state.tasksFilter.trim();
  const shown = list.filter((it) => taskMatches(it, filter));
  const noun = archived ? ['archived task', 'archived tasks'] : ['open task', 'open tasks'];
  body.append(
    h('p', {
      class: 'subtle',
      text: filter ? `${shown.length} of ${plural(list.length, noun[0], noun[1])} match “${excerpt(filter, 40)}”.` : `${plural(list.length, noun[0], noun[1])}.`,
    }),
  );
  if (archived) {
    const ul = h('ul', { class: 'list' });
    for (const it of shown.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))) ul.append(archivedRow(it));
    if (shown.length) body.append(section(`Archived (${shown.length})`, ul, 'tasks-archived'));
    restoreFocus(body, key);
    return;
  }
  const groups = taskGroups(shown);
  const group = (title, id, rows) => {
    if (!rows.length) return;
    const ul = h('ul', { class: 'list check-list' });
    for (const it of rows) {
      ul.append(
        checkRow({
          id: it.id,
          scope: it.scope,
          title: it.title,
          meta: taskMeta(it, today),
          done: false,
          sample: it.sample,
          fk: `task-${it.id}`,
          extra: [pickButton({ id: it.id, scope: it.scope, picked: isPicked(it), title: it.title }), editButton({ id: it.id, scope: it.scope, title: it.title })],
        }),
      );
    }
    body.append(section(`${title} (${rows.length})`, ul, id));
  };
  group('Due', 'tasks-due', groups.due);
  group('Picked for today', 'tasks-picked', groups.picked);
  group('Anytime', 'tasks-anytime', groups.anytime);
  restoreFocus(body, key);
}

function archivedRow(it) {
  return h(
    'li',
    { class: 'plain-row' },
    h('span', { class: 'row-title', text: it.title || '(no title)' }),
    it.updated_at ? h('span', { class: 'row-meta', text: `Archived ${formatAt(it.updated_at)}` }) : null,
    h('span', { class: 'chips' }, state.scope === 'all' ? scopeChip(it.scope) : null, sampleChip(it)),
    h(
      'div',
      { class: 'button-row' },
      h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: 'Bring back',
        'aria-label': `Bring back: ${it.title || 'task'}`,
        dataset: { fk: `unarchive-${it.id}` },
        onclick: (e) => itemAction(e.currentTarget, { id: it.id, scope: it.scope, action: 'reopen', done: 'Back on your open tasks.', failure: 'bring it back' }),
      }),
      deleteItemButton(it),
    ),
  );
}

// ---------------------------------------------------------------------------
// Edit sheet (a dialog for task edits and decisions). Not a route: closing returns focus to its opener.

function openEditSheet(title, content, opener) {
  const d = $('edit-sheet');
  state.sheetOpener = opener || document.activeElement;
  setText('edit-sheet-title', title);
  setText('edit-sheet-status', '');
  $('edit-sheet-body').replaceChildren(content);
  if (!d.open) {
    try {
      d.showModal();
    } catch {
      d.setAttribute('open', '');
    }
  }
  setTimeout(() => {
    const first = $('edit-sheet-body').querySelector('input, select, textarea');
    if (first) first.focus();
  }, 30);
}

function closeEditSheet() {
  const d = $('edit-sheet');
  if (d.open) {
    if (typeof d.close === 'function') d.close();
    else {
      d.removeAttribute('open');
      onEditSheetClosed();
    }
  }
}

function onEditSheetClosed() {
  $('edit-sheet-body').replaceChildren();
  const opener = state.sheetOpener;
  state.sheetOpener = null;
  if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  else {
    const h1 = currentHeading();
    if (h1) h1.focus({ preventScroll: true });
  }
}

// One labelled field. kind: text | textarea | date | select. Returns the control.
function field(form, { id, label, kind = 'text', value = '', options = [], hint, maxlength, min }) {
  let input;
  if (kind === 'select') {
    input = h('select', { id, name: id });
    for (const o of options) input.append(h('option', { value: o.value, text: o.label, selected: o.value === (value ?? '') }));
  } else if (kind === 'textarea') {
    input = h('textarea', { id, name: id, rows: 3, maxlength: maxlength || 2000, value: value || '' });
  } else {
    input = h('input', { id, name: id, type: kind, value: value || '', autocomplete: 'off', maxlength: kind === 'text' ? maxlength || 500 : null, min: min || null });
  }
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) input.setAttribute('aria-describedby', hintId);
  form.append(h('label', { for: id, text: label }), hintId ? h('p', { id: hintId, class: 'subtle small', text: hint }) : null, input);
  return input;
}

async function activeProjectsIn(scope) {
  const r = await api(`/api/projects?${qs({ scope })}`);
  if (!r.ok) return [];
  return listFrom(r.data, 'projects', 'items').filter((p) => p && PATH_ID_RE.test(String(p.id || '')) && (!p.state || p.state === 'active'));
}

async function findTask(id, scope) {
  const known = (state.tasks || []).find((t) => t.id === id && t.scope === scope);
  if (known) return { task: known };
  for (const st of ['open', 'archived', 'done']) {
    const r = await api(`/api/items?${qs({ kind: 'task', state: st, scope, limit: 500 })}`);
    if (!r.ok) return { error: failWords(r, 'open the task') };
    const hit = listFrom(r.data, 'items').find((t) => t.id === id);
    if (hit) return { task: normaliseItem(hit, scope) };
  }
  return { error: 'This task was not found. It may have been deleted.' };
}

async function openTaskSheet(button, id, scope) {
  if (!isScope(scope)) {
    showNotice('Could not open it. Its scope is unknown.');
    return;
  }
  await guarded(button, async () => {
    const [found, projects] = await Promise.all([findTask(id, scope), activeProjectsIn(scope)]);
    if (found.error) {
      showNotice(found.error);
      return;
    }
    openEditSheet('Edit task', taskSheet(found.task, projects), button);
  });
}

function taskSheet(it, projects) {
  const wrap = h('div', { class: 'stack' });
  const today = localOn();
  const n = ++formSeq;
  const form = h('form', { class: 'form', novalidate: true });
  const title = field(form, { id: `ts-${n}-title`, label: 'Title', value: it.title, maxlength: 500 });
  const notes = field(form, { id: `ts-${n}-notes`, label: 'Notes', kind: 'textarea', value: it.body || '' });
  const due = field(form, { id: `ts-${n}-due`, label: 'Due date', kind: 'date', value: it.due_on || '', hint: 'A hard date. Leave empty if there is none.' });
  if (it.when_text) form.append(h('p', { class: 'subtle small' }, 'Your words: ', h('q', { text: it.when_text })));
  const start = field(form, { id: `ts-${n}-start`, label: 'Not before', kind: 'date', value: it.start_on || '', hint: 'Keeps it off Today until then. The due date does not change.' });
  const repeat = field(form, {
    id: `ts-${n}-repeat`,
    label: 'Repeat',
    kind: 'select',
    value: RECURRENCES.includes(it.recurrence) ? it.recurrence : 'none',
    options: RECURRENCES.map((r) => ({ value: r, label: RECURRENCE_LABEL[r] })),
    hint: 'Repeats from its due date. Missed ones do not pile up.',
  });
  const projectOptions = [{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name || '(no name)' }))];
  if (it.project_id && !projects.some((p) => p.id === it.project_id)) projectOptions.push({ value: it.project_id, label: 'Current project' });
  const project = field(form, { id: `ts-${n}-project`, label: 'Project', kind: 'select', value: it.project_id || '', options: projectOptions });
  const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save changes' });
  form.append(err, h('div', { class: 'button-row' }, save, h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: closeEditSheet })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = {
      title: title.value.trim(),
      body: notes.value.trim() || null,
      due_on: due.value || null,
      start_on: start.value || null,
      recurrence: repeat.value,
      project_id: project.value || null,
    };
    const problem = taskEditProblem(next);
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    // Only changed fields are sent, so an untouched due date is never rewritten.
    const patch = {};
    for (const [k, v] of Object.entries(next)) {
      const before = it[k] === undefined || it[k] === '' ? null : it[k];
      const was = k === 'recurrence' ? before || 'none' : before;
      if (v !== was) patch[k] = v;
    }
    if (!Object.keys(patch).length) {
      closeEditSheet();
      setStatus('Nothing changed.');
      return;
    }
    await guarded(save, async () => {
      const r = await api(`/api/items/${enc(it.id)}`, { method: 'PATCH', body: { ...patch, scope: it.scope } });
      logEvent({ kind: 'item_patch', id: it.id, fields: Object.keys(patch).length, status: r.status, ok: r.ok });
      if (!r.ok) {
        err.textContent = failWords(r, 'save the changes');
        err.hidden = false;
        return;
      }
      closeEditSheet();
      showToast('Task saved.', changeIdFrom(r.data));
      reloadCurrent();
    });
  });
  wrap.append(form);

  // Defer sets "Not before" only. The due date is never touched.
  if (it.state === 'open' || it.state === undefined) {
    const t = deferTargets(today);
    const defer = (btn, on) =>
      guarded(btn, async () => {
        const r = await api(`/api/items/${enc(it.id)}/defer`, { method: 'POST', body: { scope: it.scope, start_on: on } });
        logEvent({ kind: 'item_defer', id: it.id, status: r.status, ok: r.ok });
        if (!r.ok) {
          showNotice(failWords(r, 'defer it'));
          return;
        }
        closeEditSheet();
        showToast(`Not before ${formatOn(on)}.${it.due_on ? ' Due date unchanged.' : ''}`, changeIdFrom(r.data));
        reloadCurrent();
      });
    const pickId = `ts-${n}-defer`;
    const pickInput = h('input', { id: pickId, type: 'date', min: t.tomorrow, value: '' });
    const pickBtn = h('button', { type: 'submit', class: 'btn btn-secondary', text: 'Defer to this date' });
    const pickForm = h('form', { class: 'form', novalidate: true }, h('label', { for: pickId, text: 'Defer until' }), pickInput, pickBtn);
    pickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ON_RE.test(pickInput.value)) {
        showNotice('Pick a date first.');
        return;
      }
      defer(pickBtn, pickInput.value);
    });
    wrap.append(
      section(
        'Defer',
        h(
          'div',
          null,
          h('p', { class: 'subtle small', text: 'Keeps it off Today until that day. A due date stays as it is and still shows when it comes.' }),
          h(
            'div',
            { class: 'button-row' },
            h('button', { type: 'button', class: 'btn btn-secondary', text: `Tomorrow (${formatOn(t.tomorrow)})`, onclick: (e) => defer(e.currentTarget, t.tomorrow) }),
            h('button', { type: 'button', class: 'btn btn-secondary', text: `Next week (${formatOn(t.nextWeek)})`, onclick: (e) => defer(e.currentTarget, t.nextWeek) }),
          ),
          h('details', { class: 'inline-form' }, h('summary', { class: 'btn btn-ghost', text: 'Pick a date' }), pickForm),
        ),
        `ts-${n}-defer-sec`,
      ),
    );
  }

  const more = h('div', { class: 'button-row' });
  if (it.state !== 'archived') {
    more.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: 'Archive',
        onclick: (e) =>
          guarded(e.currentTarget, async () => {
            const r = await api(`/api/items/${enc(it.id)}/archive`, { method: 'POST', body: { scope: it.scope } });
            logEvent({ kind: 'item_archive', id: it.id, status: r.status, ok: r.ok });
            if (!r.ok) {
              showNotice(failWords(r, 'archive it'));
              return;
            }
            closeEditSheet();
            showToast('Archived. Find it under Archived tasks.', changeIdFrom(r.data));
            reloadCurrent();
          }),
      }),
    );
  }
  more.append(deleteItemButton(it, { inSheet: true }));
  wrap.append(section('Put away', more, `ts-${n}-away`));
  return wrap;
}

// Hard delete with a confirm that says what goes. No Undo: the undo history goes with it.
function deleteItemButton(it, { inSheet = false, after } = {}) {
  return h('button', {
    type: 'button',
    class: 'btn btn-danger',
    text: 'Delete',
    'aria-label': `Delete: ${it.title || 'item'}`,
    dataset: { fk: `delete-${it.id}` },
    onclick: (e) => deleteItem(e.currentTarget, it, { inSheet, after }),
  });
}

async function deleteItem(button, it, { inSheet = false, after } = {}) {
  if (!isScope(it.scope) || !PATH_ID_RE.test(String(it.id || ''))) {
    showNotice('Could not delete it. Its scope is unknown.');
    return;
  }
  const ok = window.confirm(
    `Delete “${excerpt(it.title || 'this item', 80)}” for good?\n\n` +
      'This removes the item, its attachments and its undo history. It will not show in search again. ' +
      'Exports you already downloaded are not changed.',
  );
  if (!ok) return;
  await guarded(button, async () => {
    const r = await api(`/api/items/${enc(it.id)}?${qs({ scope: it.scope })}`, { method: 'DELETE' });
    logEvent({ kind: 'item_delete', id: it.id, status: r.status, ok: r.ok });
    if (!r.ok) {
      showNotice(failWords(r, 'delete it'));
      return;
    }
    if (inSheet) closeEditSheet();
    if (state.tasks) state.tasks = state.tasks.filter((t) => t.id !== it.id);
    showToast('Deleted.', null);
    if (typeof after === 'function') after();
    else reloadCurrent();
  });
}

// ---------------------------------------------------------------------------
// Decisions: options, recommendation, assumptions, reason, outcome, reconsider-when. Replacing one keeps
// the old decision, marked as replaced (supersedes_id); nothing is overwritten.

function decisionRows(d) {
  const dl = h('dl', { class: 'rows rows-stacked' });
  const row = (label, value) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    const dd = Array.isArray(value) ? h('dd', null, h('ul', { class: 'plain-list' }, value.map((v) => h('li', { text: v })))) : h('dd', { text: String(value) });
    dl.append(h('div', null, h('dt', { text: label }), dd));
  };
  row('Options', optionsOf(pick(d, 'options_json', 'options')));
  row('Recommendation', d.recommendation);
  row('Assumptions', d.assumptions);
  row('Reason', d.reason);
  row('Outcome', d.outcome);
  row('Reconsider when', d.reconsider_when);
  if (ON_RE.test(String(d.decided_on || ''))) row('Decided on', formatOn(d.decided_on));
  return dl.childNodes.length ? dl : null;
}

function decisionCard(d, scope, { projectId } = {}) {
  const superseded = !!(d.superseded_by_id || d.supersededById || d.superseded === true || d.superseded === 1);
  const li = h(
    'li',
    { class: `plain-row decision-row${superseded ? ' is-superseded' : ''}` },
    h('span', { class: 'row-title', text: d.title || '' }),
    h('span', { class: 'chips' }, superseded ? chip('chip-kind', 'Replaced by a later decision') : chip('chip-good', 'Current'), sampleChip(d)),
    decisionRows(d),
  );
  if (!superseded && PATH_ID_RE.test(String(d.id || '')) && isScope(scope)) {
    li.append(
      h(
        'div',
        { class: 'button-row' },
        h('button', {
          type: 'button',
          class: 'btn btn-secondary',
          text: 'Replace with a new decision',
          'aria-label': `Replace with a new decision: ${d.title || 'decision'}`,
          dataset: { fk: `replace-${d.id}` },
          onclick: (e) => openDecisionSheet(e.currentTarget, { scope, projectId: projectId || d.project_id || null, replaces: d }),
        }),
      ),
    );
  }
  return li;
}

// scope: a fixed scope (project, replace), or null to choose (Memory with All). replaces: the decision it supersedes.
async function openDecisionSheet(button, { scope = null, projectId = null, replaces = null } = {}) {
  await guarded(button, async () => {
    const fixed = isScope(scope) ? scope : null;
    const projects = fixed && !projectId ? await activeProjectsIn(fixed) : [];
    openEditSheet(replaces ? 'Replace a decision' : 'Record a decision', decisionForm({ scope: fixed, projectId, replaces, projects }), button);
  });
}

function decisionForm({ scope, projectId, replaces, projects }) {
  const n = ++formSeq;
  const form = h('form', { class: 'form', novalidate: true });
  if (replaces) {
    form.append(
      h('p', { class: 'subtle' }, 'Replaces ', h('q', { text: replaces.title || 'the earlier decision' }), '. The earlier one stays, marked as replaced.'),
    );
  }
  const title = field(form, { id: `df-${n}-title`, label: 'Decision', value: replaces ? replaces.title : '', maxlength: 500 });
  const options = field(form, { id: `df-${n}-options`, label: 'Options considered', kind: 'textarea', value: replaces ? optionsOf(pick(replaces, 'options_json', 'options')).join('\n') : '', hint: 'One per line, up to 10.' });
  const rec = field(form, { id: `df-${n}-rec`, label: 'Recommendation', kind: 'textarea' });
  const assumptions = field(form, { id: `df-${n}-assumptions`, label: 'Assumptions', kind: 'textarea' });
  const reason = field(form, { id: `df-${n}-reason`, label: 'Reason', kind: 'textarea' });
  const outcome = field(form, { id: `df-${n}-outcome`, label: 'Outcome', kind: 'textarea', hint: 'What was decided or what happened. Leave empty if not known yet.' });
  const reconsider = field(form, { id: `df-${n}-reconsider`, label: 'Reconsider when', kind: 'text', hint: 'For example: if the supplier price changes.' });
  let scopeInputs = null;
  if (!scope) {
    const name = `df-${n}-scope`;
    const want = preferredCaptureScope();
    scopeInputs = ['work', 'personal'].map((v) => h('input', { type: 'radio', name, value: v, checked: v === want }));
    form.append(
      h(
        'fieldset',
        { class: 'segmented' },
        h('legend', { text: 'Where it goes' }),
        h('label', { class: 'seg' }, scopeInputs[0], ' ', h('span', { text: 'Work' })),
        h('label', { class: 'seg' }, scopeInputs[1], ' ', h('span', { text: 'Personal' })),
      ),
    );
  }
  let project = null;
  if (!projectId && projects.length) {
    project = field(form, { id: `df-${n}-project`, label: 'Project', kind: 'select', value: '', options: [{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name || '(no name)' }))] });
  }
  const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: replaces ? 'Save the new decision' : 'Save decision' });
  form.append(err, h('div', { class: 'button-row' }, save, h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: closeEditSheet })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (m) => {
      err.textContent = m;
      err.hidden = false;
    };
    const t = title.value.trim();
    if (!t) return fail('Write what was decided.');
    const parsed = parseOptionLines(options.value);
    if (parsed.error) return fail(parsed.error);
    const target = scope || (scopeInputs.find((i) => i.checked) || {}).value;
    if (!isScope(target)) return fail('Choose Work or Personal.');
    err.hidden = true;
    const opt = (input) => input.value.trim() || null;
    const body = {
      kind: 'decision',
      scope: target,
      title: t,
      options_json: parsed.options,
      recommendation: opt(rec),
      assumptions: opt(assumptions),
      reason: opt(reason),
      outcome: opt(outcome),
      reconsider_when: opt(reconsider),
    };
    // Empty fields are left out rather than sent as null.
    for (const k of Object.keys(body)) if (body[k] === null || (Array.isArray(body[k]) && !body[k].length)) delete body[k];
    const pid = projectId || (project && project.value) || null;
    if (pid) body.project_id = pid;
    if (replaces && replaces.id) body.supersedes_id = replaces.id;
    await guarded(save, async () => {
      const r = await api('/api/items', { method: 'POST', body });
      logEvent({ kind: 'decision_create', replaces: !!replaces, status: r.status, ok: r.ok });
      if (!r.ok) {
        fail(failWords(r, 'save the decision'));
        return;
      }
      closeEditSheet();
      showToast(replaces ? 'New decision saved. The earlier one stays, marked as replaced.' : 'Decision saved.', changeIdFrom(r.data));
      reloadCurrent();
    });
  });
  return form;
}

// ---------------------------------------------------------------------------
// Projects

function rememberProjectScopes(list) {
  for (const p of list) if (p && PATH_ID_RE.test(String(p.id || '')) && isScope(p.scope)) state.projectScopes[p.id] = p.scope;
  try {
    const keys = Object.keys(state.projectScopes);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete state.projectScopes[k];
    writeLocal(PROJECT_SCOPES_KEY, JSON.stringify(state.projectScopes));
  } catch {
    /* ignore */
  }
}

async function loadProjects() {
  const seq = ++state.seq.projects;
  const body = $('projects-body');
  body.setAttribute('aria-busy', 'true');
  if (!state.projects) body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  defaultProjectScope();
  const r = await api(`/api/projects?${qs({ scope: state.scope })}`);
  if (seq !== state.seq.projects) return;
  if (r.ok) {
    state.projects = listFrom(r.data, 'projects', 'items').filter((p) => p && PATH_ID_RE.test(String(p.id || '')));
    state.projectsScope = state.scope;
    state.projectsError = null;
    rememberProjectScopes(state.projects);
  } else {
    state.projectsError = failWords(r, 'load projects');
  }
  body.setAttribute('aria-busy', 'false');
  renderProjects();
}

function renderProjects() {
  const body = $('projects-body');
  const key = focusKey();
  body.replaceChildren();
  const list = state.projects && state.projectsScope === state.scope ? state.projects : null;
  if (state.projectsError) body.append(noticeBlock(list ? `${state.projectsError} Showing what loaded last.` : state.projectsError, () => loadProjects()));
  if (!list) {
    restoreFocus(body, key);
    return;
  }
  const active = list.filter((p) => !p.state || p.state === 'active');
  const other = list.filter((p) => p.state && p.state !== 'active');
  if (!active.length) body.append(h('p', { class: 'empty', text: 'No active projects.' }));
  else {
    const ul = h('ul', { class: 'list' });
    for (const p of sortByTouched(active)) ul.append(projectRow(p));
    body.append(ul);
  }
  if (other.length) {
    const ul = h('ul', { class: 'list' });
    for (const p of sortByTouched(other)) ul.append(projectRow(p));
    body.append(h('details', { class: 'block' }, h('summary', { class: 'btn btn-ghost', text: `Done and archived (${other.length})` }), ul));
  }
  restoreFocus(body, key);
}

function sortByTouched(list) {
  return list.slice().sort((a, b) => {
    const ta = String(pick(a, 'last_touched_at', 'lastTouchedAt', 'updated_at') || '');
    const tb = String(pick(b, 'last_touched_at', 'lastTouchedAt', 'updated_at') || '');
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
}

function projectRow(p) {
  const touched = pick(p, 'last_touched_at', 'lastTouchedAt');
  const stateWord = p.state === 'done' ? 'Done' : p.state === 'archived' ? 'Archived' : null;
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'row-link', href: `#/project/${enc(p.id)}`, dataset: { fk: `project-${p.id}` } },
      h('span', { class: 'row-title', text: p.name || '(no name)' }),
      p.purpose ? h('span', { class: 'row-meta', text: excerpt(p.purpose, 100) }) : null,
      h('span', { class: 'row-meta', text: [stateWord, touched ? `Last touched ${formatAt(touched)}` : 'Not touched yet'].filter(Boolean).join(' · ') }),
      h('span', { class: 'chips' }, state.scope === 'all' ? scopeChip(p.scope) : null, sampleChip(p)),
    ),
  );
}

function preferredCaptureScope() {
  if (isScope(state.scope)) return state.scope;
  const saved = readLocal(CAPTURE_SCOPE_KEY);
  return isScope(saved) ? saved : 'personal';
}

function defaultProjectScope() {
  const checked = document.querySelector('input[name="pscope"]:checked');
  if (checked && !isScope(state.scope)) return;
  const want = preferredCaptureScope();
  const input = document.querySelector(`input[name="pscope"][value="${want}"]`);
  if (input) input.checked = true;
}

async function onProjectSubmit(event) {
  event.preventDefault();
  const name = $('project-name').value.trim();
  const purpose = $('project-purpose').value.trim();
  const checked = document.querySelector('input[name="pscope"]:checked');
  const scope = checked ? checked.value : null;
  const err = $('project-form-error');
  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
  };
  if (!name) return fail('Give it a name.');
  if (!isScope(scope)) return fail('Choose Work or Personal.');
  err.hidden = true;
  await guarded($('project-save'), async () => {
    const r = await api('/api/projects', { method: 'POST', body: { name, purpose: purpose || null, scope } });
    logEvent({ kind: 'project_create', status: r.status, ok: r.ok });
    if (!r.ok) {
      fail(failWords(r, 'create the project'));
      return;
    }
    $('project-form').reset();
    const details = $('project-form').closest('details');
    if (details) details.open = false;
    setStatus('Project created.');
    const project = r.data && (r.data.project || r.data);
    if (project && PATH_ID_RE.test(String(project.id || ''))) {
      state.projectScopes[project.id] = scope;
      rememberProjectScopes([{ id: project.id, scope }]);
      go('project', project.id);
    } else {
      loadProjects();
    }
  });
}

// ---------------------------------------------------------------------------
// Project

async function loadProject(id) {
  const seq = ++state.seq.project;
  const body = $('project-body');
  if (!id) return;
  body.setAttribute('aria-busy', 'true');
  if (!state.project || state.project.id !== id) {
    body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
    setText('project-title', 'Project');
    setText('project-meta', '');
  }
  const known = state.projectScopes[id];
  const order = isScope(known) ? [known] : ['work', 'personal'];
  let result = null;
  let used = null;
  for (const s of order) {
    const r = await api(`/api/projects/${enc(id)}?${qs({ scope: s })}`);
    if (seq !== state.seq.project) return;
    result = r;
    used = s;
    if (r.ok || r.status !== 404) break;
  }
  if (result && result.ok) {
    const d = result.data || {};
    const project = d.project || {};
    state.project = {
      id,
      scope: isScope(project.scope) ? project.scope : used,
      project,
      nextItem: pick(d, 'nextItem', 'next_item') || null,
      waiting: listFrom(d.waiting),
      decisions: listFrom(d.decisions),
      checkpoint: d.checkpoint || null,
      recentCaptures: listFrom(pick(d, 'recentCaptures', 'recent_captures')),
    };
    state.projectError = null;
    rememberProjectScopes([{ id, scope: state.project.scope }]);
  } else {
    state.projectError = result && result.status === 404 ? 'This project was not found.' : failWords(result, 'load the project');
    if (state.project && state.project.id !== id) state.project = null;
  }
  body.setAttribute('aria-busy', 'false');
  renderProject();
}

function cp(checkpoint, camel, snake) {
  return pick(checkpoint, camel, snake);
}

function renderProject() {
  const body = $('project-body');
  const key = focusKey();
  body.replaceChildren();
  const id = state.route.id;
  const pd = state.project && state.project.id === id ? state.project : null;
  if (state.projectError) body.append(noticeBlock(pd ? `${state.projectError} Showing what loaded last.` : state.projectError, () => loadProject(id)));
  if (!pd) {
    restoreFocus(body, key);
    return;
  }
  const p = pd.project;
  setText('project-title', p.name || 'Project');
  const meta = $('project-meta');
  meta.replaceChildren(
    h('span', { class: 'chips' }, scopeChip(pd.scope), sampleChip(p), p.state && p.state !== 'active' ? chip('chip-kind', p.state === 'done' ? 'Done' : 'Archived') : null),
  );
  if (p.purpose) body.append(h('p', { class: 'purpose', text: p.purpose }));

  body.append(placeCard(pd));

  const nextSection = h('div');
  const ni = pd.nextItem;
  if (ni && PATH_ID_RE.test(String(ni.id || ''))) {
    nextSection.append(
      h(
        'ul',
        { class: 'list check-list' },
        checkRow({ id: ni.id, scope: isScope(ni.scope) ? ni.scope : pd.scope, title: ni.title, meta: ni.due_on ? `Due ${formatOn(ni.due_on)}` : null, done: ni.state === 'done', sample: ni.sample, fk: `pnext-${ni.id}` }),
      ),
    );
  } else {
    nextSection.append(h('p', { class: 'subtle', text: 'No open task on this project.' }));
  }
  body.append(section('Next on this project', nextSection, 'project-next'));

  if (pd.waiting.length) {
    const ul = h('ul', { class: 'list' });
    for (const w of pd.waiting) {
      ul.append(
        h(
          'li',
          { class: 'plain-row' },
          h('span', { class: 'row-title', text: w.title || '' }),
          h('span', { class: 'row-meta', text: `${w.who ? w.who : 'Who: not stated'} · ${w.reply_recorded_at ? 'Reply recorded' : 'No reply recorded'}` }),
          h('span', { class: 'chips' }, statusChip(STATUS_LABEL[w.claim_status] ? w.claim_status : 'unspecified')),
        ),
      );
    }
    body.append(section('Waiting on others', h('div', null, ul, h('a', { class: 'btn btn-ghost', href: '#/waiting', text: 'Open Waiting' })), 'project-waiting'));
  }

  {
    const ul = h('ul', { class: 'list' });
    for (const d of pd.decisions) ul.append(decisionCard(d, pd.scope, { projectId: pd.id }));
    const add = h('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: 'Record a decision',
      dataset: { fk: `decide-${pd.id}` },
      onclick: (e) => openDecisionSheet(e.currentTarget, { scope: pd.scope, projectId: pd.id }),
    });
    body.append(section('Decisions', h('div', null, pd.decisions.length ? ul : h('p', { class: 'subtle', text: 'No decisions recorded on this project.' }), add), 'project-decisions'));
  }

  if (pd.recentCaptures.length) {
    const ul = h('ul', { class: 'list' });
    for (const c of pd.recentCaptures) {
      const pending = c.review_state === 'pending' || c.reviewState === 'pending';
      const at = pick(c, 'received_at', 'receivedAt');
      const inner = [h('span', { class: 'row-title', text: excerpt(c.text, 160) }), at ? h('span', { class: 'row-meta', text: formatAt(at) }) : null];
      ul.append(
        h(
          'li',
          null,
          pending && PATH_ID_RE.test(String(c.id || ''))
            ? h('a', { class: 'row-link', href: `#/review/${enc(c.id)}` }, inner, h('span', { class: 'row-meta', text: 'Waiting for review' }))
            : h('div', { class: 'plain-row' }, inner),
        ),
      );
    }
    body.append(section('Recent captures', ul, 'project-captures'));
  }
  body.append(extSlot(EXT.project, pd));
  restoreFocus(body, key);
}

function placeCard(pd) {
  const card = h('section', { class: 'card place-card', 'aria-labelledby': 'place-h' }, h('h2', { id: 'place-h', text: 'Where you left off' }));
  const editing = state.checkpointEdit && state.checkpointEdit.projectId === pd.id ? state.checkpointEdit : null;
  if (editing) {
    card.append(checkpointForm(pd, editing));
    return card;
  }
  const c = pd.checkpoint;
  if (c) {
    const dl = h('dl', { class: 'rows rows-stacked' });
    const row = (label, value) => dl.append(h('div', null, h('dt', { text: label }), h('dd', { class: value ? null : 'subtle', text: value || 'Not written down' })));
    row('Stopped at', cp(c, 'stoppedAtText', 'stopped_at_text'));
    row('Open question', cp(c, 'openQuestion', 'open_question'));
    row('Next step', cp(c, 'nextStep', 'next_step'));
    card.append(dl);
    const at = cp(c, 'createdAt', 'created_at');
    const src = sourceWords(cp(c, 'sourceRef', 'source_ref'));
    card.append(h('p', { class: 'row-meta', text: [at ? `Saved ${formatAt(at)}` : null, src].filter(Boolean).join(' · ') }));
  } else {
    card.append(h('p', { class: 'subtle', text: 'No saved place yet.' }));
  }
  card.append(
    h(
      'div',
      { class: 'button-row' },
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: 'Save my place',
        dataset: { fk: `save-place-${pd.id}` },
        onclick: (e) => saveCheckpoint(e.currentTarget, pd, null),
      }),
      h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: 'Edit',
        dataset: { fk: `edit-place-${pd.id}` },
        onclick: (e) => openCheckpointEdit(e.currentTarget, pd),
      }),
    ),
  );
  card.append(h('p', { class: 'subtle small', text: 'Save my place copies your latest notes on this project word for word. Use Edit to change them first.' }));
  return card;
}

function sourceWords(ref) {
  if (!ref) return null;
  const s = String(ref);
  if (s.startsWith('capture:')) return 'From a capture';
  if (s.startsWith('item:')) return 'From an item';
  if (/^https?:\/\//i.test(s)) return `From ${excerpt(s, 60)}`;
  return null;
}

async function openCheckpointEdit(button, pd) {
  await guarded(button, async () => {
    const r = await api(`/api/projects/${enc(pd.id)}/checkpoint/prefill?${qs({ scope: pd.scope })}`);
    if (!r.ok) {
      showNotice(failWords(r, 'load your latest notes'));
      return;
    }
    const d = (r.data && (r.data.prefill || r.data)) || {};
    state.checkpointEdit = {
      projectId: pd.id,
      fields: {
        stoppedAtText: cp(d, 'stoppedAtText', 'stopped_at_text') || '',
        openQuestion: cp(d, 'openQuestion', 'open_question') || '',
        nextStep: cp(d, 'nextStep', 'next_step') || '',
        sourceRef: cp(d, 'sourceRef', 'source_ref') || null,
      },
    };
  });
  if (state.checkpointEdit && state.checkpointEdit.projectId === pd.id) {
    renderProject();
    const first = $('cp-stopped');
    if (first) first.focus();
  }
}

function checkpointForm(pd, editing) {
  const form = h('form', { class: 'form', novalidate: true });
  const f = editing.fields;
  const area = (id, label, key) => {
    const ta = h('textarea', { id, rows: 3, maxlength: 4000, value: f[key] || '' });
    // Keep typed text in state so a re-render never loses it.
    ta.addEventListener('input', () => {
      f[key] = ta.value;
    });
    form.append(h('label', { for: id, text: label }), ta);
    return ta;
  };
  const stopped = area('cp-stopped', 'Stopped at', 'stoppedAtText');
  const question = area('cp-question', 'Open question', 'openQuestion');
  const next = area('cp-next', 'Next step', 'nextStep');
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save my place' });
  form.append(
    h(
      'div',
      { class: 'button-row' },
      save,
      h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: 'Cancel',
        onclick: () => {
          state.checkpointEdit = null;
          renderProject();
        },
      }),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveCheckpoint(save, pd, {
      stoppedAtText: stopped.value.trim() || null,
      openQuestion: question.value.trim() || null,
      nextStep: next.value.trim() || null,
      sourceRef: f.sourceRef || null,
    });
  });
  return form;
}

async function saveCheckpoint(button, pd, fields) {
  if (!isScope(pd.scope)) return;
  await guarded(button, async () => {
    const r = await api(`/api/projects/${enc(pd.id)}/checkpoint`, { method: 'POST', body: { scope: pd.scope, fields } });
    logEvent({ kind: 'checkpoint_save', id: pd.id, edited: fields !== null, status: r.status, ok: r.ok });
    if (r.ok) {
      state.checkpointEdit = null;
      setStatus('Place saved.');
      await loadProject(pd.id);
    } else {
      showNotice(failWords(r, 'save your place'));
    }
  });
}

// ---------------------------------------------------------------------------
// Memory (search runs one query per scope; All shows two labelled groups)

let searchTimer = null;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch($('search-q').value), 350);
}

function onSearchSubmit(event) {
  event.preventDefault();
  clearTimeout(searchTimer);
  runSearch($('search-q').value);
}

function rerunSearch() {
  const q = $('search-q').value;
  if (q.trim()) runSearch(q);
  else renderSearch();
}

async function runSearch(raw) {
  const q = String(raw || '').trim();
  const seq = ++state.seq.search;
  if (!q) {
    state.search = null;
    renderSearch();
    return;
  }
  const scopes = scopesToQuery();
  setText('search-summary', 'Searching.');
  $('search-results').setAttribute('aria-busy', 'true');
  const results = await Promise.all(scopes.map((s) => api(`/api/search?${qs({ q, scope: s })}`)));
  if (seq !== state.seq.search) return;
  $('search-results').setAttribute('aria-busy', 'false');
  state.search = {
    q,
    groups: scopes.map((s, i) => ({
      scope: s,
      ok: results[i].ok,
      error: results[i].ok ? null : failWords(results[i], `search ${s === 'work' ? 'Work' : 'Personal'}`),
      rows: results[i].ok ? listFrom(results[i].data, 'results', 'items', 'rows') : [],
    })),
  };
  renderSearch();
}

function renderSearch() {
  const out = $('search-results');
  out.replaceChildren();
  const s = state.search;
  if (!s) {
    setText('search-summary', '');
    return;
  }
  const total = s.groups.reduce((n, g) => n + g.rows.length, 0);
  const failed = s.groups.filter((g) => !g.ok).length;
  setText('search-summary', `${plural(total, 'match', 'matches')} for “${excerpt(s.q, 60)}”${failed ? '. Some results could not load.' : '.'}`);
  const grouped = s.groups.length > 1;
  for (const g of s.groups) {
    const label = g.scope === 'work' ? 'Work' : 'Personal';
    const content = h('div');
    if (g.error) content.append(noticeBlock(g.error, () => runSearch(s.q)));
    else if (!g.rows.length) content.append(h('p', { class: 'subtle', text: grouped ? `No matches in ${label}.` : 'No matches.' }));
    else {
      const ul = h('ul', { class: 'list' });
      for (const row of g.rows) ul.append(searchRow(row));
      content.append(ul);
    }
    if (grouped) {
      const id = `sg-${g.scope}`;
      out.append(
        h(
          'section',
          { class: `block search-group search-group-${g.scope}`, 'aria-labelledby': id },
          h('h2', { id, class: 'block-title' }, label, h('span', { class: 'count', text: ` ${g.ok ? g.rows.length : ''}` })),
          content,
        ),
      );
    } else {
      out.append(content);
    }
  }
}

function searchRow(row) {
  const ref = parseRef(row.ref);
  const kind = row.kind || ref.type;
  const superseded = row.superseded === true || row.superseded === 1;
  const at = pick(row, 'at', 'updated_at', 'created_at', 'received_at');
  const inner = [
    h(
      'span',
      { class: 'chips' },
      kindChip(kind),
      superseded ? chip('chip-kind', 'Replaced by a later decision') : null,
      row.source_deleted === true || row.source_deleted === 1 ? chip('chip-kind', 'From a deleted capture') : null,
      sampleChip(row),
    ),
    h('span', { class: 'row-title', text: row.title || excerpt(row.body || row.text, 120) || '(no title)' }),
    row.title && (row.body || row.text) ? h('span', { class: 'row-meta', text: excerpt(row.body || row.text, 160) }) : null,
    at ? h('span', { class: 'row-meta', text: formatAt(at) }) : null,
  ];
  if (ref.type === 'project') return h('li', null, h('a', { class: 'row-link', href: `#/project/${enc(ref.id)}` }, inner));
  const li = h('li', { class: `plain-row${superseded ? ' is-superseded' : ''}` }, inner, attachmentStrip(row.attachments, row.scope));
  if (ref.type === 'item' && isScope(row.scope)) {
    const it = { id: ref.id, scope: row.scope, title: row.title, project_id: row.project_id || null };
    const actions = h('div', { class: 'button-row' });
    if (kind === 'decision' && !superseded) {
      actions.append(
        h('button', {
          type: 'button',
          class: 'btn btn-secondary',
          text: 'Replace with a new decision',
          'aria-label': `Replace with a new decision: ${row.title || 'decision'}`,
          onclick: (e) => openDecisionSheet(e.currentTarget, { scope: row.scope, projectId: it.project_id, replaces: it }),
        }),
      );
    }
    actions.append(deleteItemButton(it, { after: () => runSearch(state.search ? state.search.q : '') }));
    li.append(actions);
  }
  return li;
}

// Photos as small thumbnails, other files as chips. Both open the stored file (same origin, the
// server sends it sandboxed). Nothing is shown when there are none.
function attachmentStrip(list, scope) {
  const atts = Array.isArray(list) ? list.filter((a) => a && PATH_ID_RE.test(String(a.id || ''))) : [];
  if (!atts.length || !isScope(scope)) return null;
  const strip = h('div', { class: 'att-strip' });
  for (const a of atts) {
    const url = `/api/attachments/${enc(a.id)}?${qs({ scope })}`;
    const name = safeFileName(a.name, 'file');
    if (String(a.mime || '').startsWith('image/') && a.mime !== 'image/heic') {
      strip.append(
        h(
          'a',
          { class: 'att-thumb', href: url, target: '_blank', rel: 'noopener', 'aria-label': `Open photo ${name}` },
          h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', width: 72, height: 72 }),
        ),
      );
    } else {
      const size = Number(a.size) > 0 ? ` · ${Math.max(1, Math.round(Number(a.size) / 1024))} KB` : '';
      strip.append(h('a', { class: 'att-chip', href: url, target: '_blank', rel: 'noopener' }, h('span', { class: 'visually-hidden', text: 'Open file ' }), `${name}${size}`));
    }
  }
  return strip;
}

// ---------------------------------------------------------------------------
// Preferences (editable memory). Only explicit writes here create one; each write is undoable.

let prefEditing = null; // { key, scope } while an existing preference is in the form

async function loadPreferences() {
  const seq = ++state.seq.prefs;
  const list = $('prefs-list');
  list.setAttribute('aria-busy', 'true');
  const r = await api(`/api/preferences?${qs({ scope: state.scope })}`);
  if (seq !== state.seq.prefs) return;
  list.setAttribute('aria-busy', 'false');
  if (r.ok) {
    state.prefs = listFrom(r.data, 'preferences', 'items').filter((p) => p && typeof p.key === 'string' && isScope(p.scope));
    state.prefsScope = state.scope;
    state.prefsError = null;
  } else {
    state.prefsError = r.status === 404 ? 'Preferences are not available on this server yet.' : failWords(r, 'load preferences');
  }
  renderPreferences();
}

function renderPreferences() {
  const list = $('prefs-list');
  list.replaceChildren();
  const prefs = state.prefs && state.prefsScope === state.scope ? state.prefs : null;
  setText('prefs-status', state.prefsError || (prefs && !prefs.length ? 'No preferences yet.' : ''));
  for (const p of prefs || []) {
    list.append(
      h(
        'li',
        { class: 'plain-row' },
        h('span', { class: 'row-title', text: prefLabel(p.key) }),
        h('span', { class: 'pref-value', text: p.value || '' }),
        p.note ? h('span', { class: 'row-meta', text: `Note: ${p.note}` }) : null,
        h('span', { class: 'chips' }, state.scope === 'all' ? scopeChip(p.scope) : null, sampleChip(p)),
        h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'button', class: 'btn btn-secondary', text: 'Edit', 'aria-label': `Edit preference: ${prefLabel(p.key)}`, onclick: () => editPreference(p) }),
          h('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', 'aria-label': `Delete preference: ${prefLabel(p.key)}`, onclick: (e) => deletePreference(e.currentTarget, p) }),
        ),
      ),
    );
  }
  const scopeBox = $('pref-scope');
  // A new preference names one scope; the switch decides unless it shows All.
  scopeBox.hidden = !!prefEditing || isScope(state.scope);
  if (!document.querySelector('input[name="prefscope"]:checked')) {
    const want = document.querySelector(`input[name="prefscope"][value="${preferredCaptureScope()}"]`);
    if (want) want.checked = true;
  }
}

function resetPreferenceForm() {
  prefEditing = null;
  $('prefs-form').reset();
  $('pref-name').disabled = false;
  $('prefs-error').hidden = true;
  setText('prefs-summary', 'Add a preference');
  setText('pref-save', 'Save preference');
  renderPreferences();
}

function editPreference(p) {
  prefEditing = { key: p.key, scope: p.scope };
  $('pref-name').value = prefLabel(p.key);
  $('pref-name').disabled = true;
  $('pref-value').value = p.value || '';
  $('pref-note').value = p.note || '';
  setText('prefs-summary', `Editing: ${prefLabel(p.key)}`);
  setText('pref-save', 'Save changes');
  $('prefs-details').open = true;
  renderPreferences();
  $('pref-value').focus();
}

async function onPreferenceSubmit(event) {
  event.preventDefault();
  const err = $('prefs-error');
  const fail = (m) => {
    err.textContent = m;
    err.hidden = false;
  };
  const key = prefEditing ? prefEditing.key : prefKeyFrom($('pref-name').value);
  if (!key) return fail('Give it a short name using letters or numbers.');
  const value = $('pref-value').value.trim();
  if (!value) return fail('Write the preference.');
  if (value.length > 500) return fail('Keep it to 500 characters.');
  const checked = document.querySelector('input[name="prefscope"]:checked');
  const scope = prefEditing ? prefEditing.scope : isScope(state.scope) ? state.scope : checked && checked.value;
  if (!isScope(scope)) return fail('Choose Work or Personal.');
  err.hidden = true;
  const note = $('pref-note').value.trim() || null;
  await guarded($('pref-save'), async () => {
    const r = await api(`/api/preferences/${enc(key)}`, { method: 'PUT', body: { scope, value, note } });
    logEvent({ kind: 'preference_put', status: r.status, ok: r.ok });
    if (!r.ok) {
      fail(failWords(r, 'save the preference'));
      return;
    }
    $('prefs-details').open = false;
    resetPreferenceForm();
    showToast('Preference saved.', changeIdFrom(r.data));
    loadPreferences();
  });
}

async function deletePreference(button, p) {
  if (!window.confirm(`Delete the preference “${prefLabel(p.key)}”?`)) return;
  await guarded(button, async () => {
    const r = await api(`/api/preferences/${enc(p.key)}?${qs({ scope: p.scope })}`, { method: 'DELETE' });
    logEvent({ kind: 'preference_delete', status: r.status, ok: r.ok });
    if (!r.ok) {
      showNotice(failWords(r, 'delete the preference'));
      return;
    }
    if (prefEditing && prefEditing.key === p.key && prefEditing.scope === p.scope) resetPreferenceForm();
    showToast('Preference deleted.', changeIdFrom(r.data));
    loadPreferences();
  });
}

// ---------------------------------------------------------------------------
// Restore from an export file. Adds missing rows only; the server decides what is inserted.

const MAX_RESTORE_CHARS = 8000000;

async function onRestoreFileChange() {
  setText('restore-result', '');
  const file = $('restore-file').files && $('restore-file').files[0];
  if (!file) return;
  // Default the target to the file's own scope.
  try {
    const head = await file.slice(0, 4096).text();
    const m = /"scope"\s*:\s*"(work|personal|all)"/.exec(head);
    if (m) $('restore-scope').value = m[1];
  } catch {
    /* the full read on Restore reports problems */
  }
}

async function onRestoreSubmit(event) {
  event.preventDefault();
  const file = $('restore-file').files && $('restore-file').files[0];
  if (!file) {
    setText('restore-result', 'Choose an export file first.');
    return;
  }
  if (file.size > MAX_RESTORE_CHARS) {
    setText('restore-result', 'This file is too large to restore from the phone (over 8 MB).');
    return;
  }
  await guarded($('restore-run'), async () => {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setText('restore-result', 'This file is not a Harrison OS export. Nothing was restored.');
      return;
    }
    if (!data || data.format !== 'harrison-os-export' || !data.tables || typeof data.tables !== 'object') {
      setText('restore-result', 'This file is not a Harrison OS export. Nothing was restored.');
      return;
    }
    const scope = $('restore-scope').value;
    setText('restore-result', 'Restoring. This can take a minute.');
    const r = await api('/api/restore', { method: 'POST', body: { scope, data }, timeoutMs: 120000 });
    logEvent({ kind: 'restore', scope, status: r.status, ok: r.ok });
    if (!r.ok) {
      const code = r.data && r.data.error && r.data.error.code;
      // Restoring again is safe: it only ever adds what is still missing.
      const words =
        r.status === 404 && !code
          ? 'Restore is not available on this server yet.'
          : r.status >= 400 && r.status < 500
            ? `${failWords(r, 'restore')} Nothing was restored.`
            : `${failWords(r, 'restore')} Part of it may have been added. Restoring again is safe: it only adds what is still missing.`;
      setText('restore-result', words);
      return;
    }
    setText('restore-result', restoreWords(r.data));
    rerunSearch();
  });
}

// Export: fetched with the CSRF header (a plain link could not carry it), then saved.
async function onExportClick(event) {
  const btn = event.target instanceof Element ? event.target.closest('button[data-export]') : null;
  if (!btn) return;
  const scope = btn.dataset.export;
  if (!SCOPES.includes(scope)) return;
  await guarded(btn, async () => {
    setText('export-result', 'Preparing the file.');
    let res;
    try {
      res = await fetch(`/api/export?${qs({ scope })}`, { headers: { ...API_HEADERS }, credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
    } catch {
      setText('export-result', 'Could not export. No connection.');
      return;
    }
    const ct = res.headers.get('content-type') || '';
    const verdict = classifyResponse({ type: res.type, status: res.status, contentType: ct });
    logEvent({ kind: 'export', scope, status: res.status, ok: verdict === 'synced' });
    if (verdict === 'auth_required') {
      markAuthLost();
      setText('export-result', 'Could not export. Sign in again first.');
      return;
    }
    if (verdict !== 'synced') {
      setText('export-result', `Could not export (HTTP ${res.status}).`);
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const m = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition);
    const name = m ? m[1] : `harrison-os-${scope}-${localOn()}.json`;
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, class: 'visually-hidden' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setText('export-result', `Saved ${name}.`);
  });
}

// ---------------------------------------------------------------------------
// Capture sheet, draft autosave and the outbox

function openCaptureSheet() {
  const d = $('capture-sheet');
  if (!d.open) {
    if (typeof d.showModal === 'function') {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else {
      d.setAttribute('open', '');
    }
  }
  if ($('capture-text').value.trim() === '' || !document.querySelector('input[name="cscope"]:checked')) setCaptureScope(preferredCaptureScope());
  renderOutbox();
  setTimeout(() => $('capture-text').focus(), 30);
}

function closeCaptureSheet(navigate) {
  const d = $('capture-sheet');
  if (d.open) {
    flushDraft();
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }
  if (navigate && parseHash().name === 'capture') location.replace(hashFor(state.baseRoute));
}

function currentCaptureScope() {
  const checked = document.querySelector('input[name="cscope"]:checked');
  return checked && isScope(checked.value) ? checked.value : null;
}

function setCaptureScope(value) {
  const input = document.querySelector(`input[name="cscope"][value="${isScope(value) ? value : 'personal'}"]`);
  if (input) input.checked = true;
}

function onDraftInput() {
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => {
    state.draftTimer = null;
    writeDraft();
  }, DRAFT_DEBOUNCE_MS);
}

function flushDraft() {
  if (state.draftTimer) {
    clearTimeout(state.draftTimer);
    state.draftTimer = null;
    writeDraft();
  }
}

function hhmm(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '?';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function writeDraft() {
  const gen = state.draftGen;
  const text = $('capture-text').value;
  const scope = currentCaptureScope();
  if (!state.draftId) state.draftId = newClientId('capture');
  const id = state.draftId;
  try {
    const stores = await storesReady;
    await draftRestored; // never overwrite the stored draft before it was restored
    if (gen !== state.draftGen) return; // a Save happened meanwhile
    const files = state.sheetFiles.slice();
    if (text.trim() === '' && !files.length) {
      await stores.drafts.del(DRAFT_KEY);
      setText('draft-status', '');
    } else {
      await stores.drafts.put(DRAFT_KEY, { id, text, scope, files, updated_at: new Date().toISOString() });
      setText('draft-status', `Draft kept on this phone at ${hhmm(Date.now())}.`);
    }
  } catch {
    setText('draft-status', 'Could not keep the draft on this phone.');
  }
}

async function restoreDraft() {
  const stores = await storesReady;
  let draft;
  try {
    draft = await stores.drafts.get(DRAFT_KEY);
  } catch {
    draft = undefined;
  }
  const draftFiles = draft && Array.isArray(draft.files) ? draft.files.filter(validDraftFile).slice(0, MAX_ATTACHMENTS_PER_CAPTURE) : [];
  if (!draft || typeof draft.text !== 'string' || (draft.text.trim() === '' && !draftFiles.length)) {
    if (!state.draftId) state.draftId = newClientId('capture');
    return;
  }
  // If this draft's id is already in the outbox, it was saved; the draft is stale.
  let existing;
  try {
    existing = draft.id ? await stores.outbox.get(draft.id) : undefined;
  } catch {
    existing = undefined;
  }
  if (existing) {
    await stores.drafts.del(DRAFT_KEY).catch(() => {});
    if (!state.draftId) state.draftId = newClientId('capture');
    logEvent({ kind: 'draft_discarded_already_saved', id: draft.id });
    return;
  }
  const box = $('capture-text');
  // If typing already started during startup, keep both: nothing is lost.
  box.value = box.value.trim() !== '' ? `${draft.text}\n${box.value}` : draft.text;
  const known = new Set(state.sheetFiles.map((f) => f.id));
  state.sheetFiles = draftFiles.filter((f) => !known.has(f.id)).concat(state.sheetFiles);
  renderSheetFiles();
  if (isScope(draft.scope)) setCaptureScope(draft.scope);
  state.draftId = typeof draft.id === 'string' && CLIENT_ID_RE.test(draft.id) ? draft.id : newClientId('capture');
  setText('draft-status', `Draft restored from this phone (kept ${formatAt(draft.updated_at)}).`);
  logEvent({ kind: 'draft_restored', id: state.draftId });
}

function onCaptureSubmit(event) {
  event.preventDefault();
  const box = $('capture-text');
  const files = state.sheetFiles.slice();
  // A photo on its own still needs words for the server: say plainly what it is.
  const text = box.value.trim() || (files.length ? `Attached: ${files.map((f) => f.name).join(', ')}` : '');
  if (!text) {
    showNotice('Nothing to save.');
    return;
  }
  const scope = currentCaptureScope();
  if (!scope) {
    showNotice('Choose Work or Personal first.');
    return;
  }
  // Everything up to the first await is synchronous: the box and the draft id are
  // cleared before a second tap can run, so one draft can only become one capture.
  const id = state.draftId || newClientId('capture');
  clearTimeout(state.draftTimer);
  state.draftTimer = null;
  state.draftGen += 1;
  state.draftId = newClientId('capture');
  box.value = '';
  state.sheetFiles = [];
  renderSheetFiles();
  setText('draft-status', '');
  writeLocal(CAPTURE_SCOPE_KEY, scope);
  persistCapture({ id, text, scope, files });
}

async function persistCapture({ id, text, scope, files = [] }) {
  let item;
  try {
    item = createOutboxItem({
      id,
      kind: 'capture',
      url: '/api/captures',
      body: { id, text, scope, client_created_at: new Date().toISOString(), time_zone: deviceTimeZone() },
    });
  } catch {
    showNotice('Could not save that capture.');
    return;
  }
  try {
    const stores = await storesReady;
    const existing = await stores.outbox.get(id);
    if (!existing) await stores.outbox.put(item);
    state.items.set(id, existing || item);
    logEvent({ kind: 'capture_saved', id, attachments: files.length });
  } catch {
    // Put the text and files back so nothing is lost.
    const box = $('capture-text');
    if (box.value.trim() === '') {
      box.value = text;
      state.draftId = id;
      state.sheetFiles = files.concat(state.sheetFiles);
      renderSheetFiles();
      onDraftInput();
    }
    showNotice('Could not save on this phone. Your text is back in the box.');
    return;
  }
  const kept = await queueAttachments(id, scope, files);
  if (kept) {
    // Remove the draft only if it is still this capture's (typing may have started a new one).
    const stores = await storesReady;
    const d = await stores.drafts.get(DRAFT_KEY).catch(() => null);
    if (!d || d.id === id) await stores.drafts.del(DRAFT_KEY).catch(() => {});
    setStatus(files.length ? `Saved on this phone with ${plural(files.length, 'attachment', 'attachments')}.` : 'Saved on this phone.');
  } else {
    // The words are saved; the photos go back in the box to be saved again as their own capture.
    state.sheetFiles = files.concat(state.sheetFiles);
    renderSheetFiles();
    writeDraft();
    showNotice('The words are saved, but this phone could not keep the photos with them. They are back in the box: save again.');
  }
  renderOutbox();
  renderAuthBanner();
  syncNow('enqueue');
}

function onItemChange(item) {
  state.items.set(item.id, item);
  logEvent({ kind: 'outbox_state', id: item.id, item_kind: item.kind, state: item.state, attempts: item.attempts, error: item.last_error || null });
  if (item.state === 'synced') {
    markAuthOk();
    scheduleDataRefresh();
  }
  if (item.state === 'auth_required') renderAuthBanner();
  scheduleOutboxRender();
}

async function reloadItems() {
  const stores = await storesReady;
  const list = await stores.outbox.list();
  state.items = new Map(list.map((i) => [i.id, i]));
}

const IGNORE_BACKOFF_REASONS = new Set(['online', 'load', 'visible', 'pageshow']);

let syncRunning = null;
function syncNow(reason) {
  if (!state.engine) return Promise.resolve(null);
  // Known offline: don't burn an attempt; the 'online' event syncs. The interval
  // still tries, in case onLine is ever stale.
  if (navigator.onLine === false && reason !== 'interval') {
    scheduleOutboxRender();
    return Promise.resolve(null);
  }
  if (syncRunning) return syncRunning;
  syncRunning = (async () => {
    let summary = null;
    try {
      summary = await state.engine.syncOnce({ ignoreBackoff: IGNORE_BACKOFF_REASONS.has(reason) });
      if (summary && summary.attempted > 0) {
        logEvent({
          kind: 'sync_run',
          reason,
          attempted: summary.attempted,
          synced: summary.synced,
          retry: summary.retry,
          auth_required: summary.auth_required,
          conflict: summary.conflict,
          rejected: summary.rejected,
          deleted: summary.deleted,
          stopped: summary.stopped,
        });
      }
      await reloadItems();
      // Photos and files go once their capture has synced; signed out or offline, they wait too.
      if (state.stores && state.stores.attachments && (!summary || !summary.stopped)) {
        const att = await syncAttachments({
          store: state.stores.attachments,
          outbox: state.stores.outbox,
          fetchImpl: (u, init) => fetch(u, init),
          headers: API_HEADERS,
          ignoreBackoff: IGNORE_BACKOFF_REASONS.has(reason),
          onChange: onAttachmentChange,
        });
        if (att.attempted > 0) logEvent({ kind: 'attachment_run', reason, attempted: att.attempted, uploaded: att.uploaded, dropped: att.dropped, retry: att.retry, rejected: att.rejected, conflict: att.conflict, stopped: att.stopped });
        if (att.auth_required) markAuthLost();
        await reloadAttachments();
      }
    } catch (e) {
      logEvent({ kind: 'sync_error', reason, error: e && e.name ? e.name : 'error' });
    } finally {
      syncRunning = null;
    }
    flushPendingAcks();
    renderOutbox();
    renderAuthBanner();
    scheduleRetry();
    return summary;
  })();
  return syncRunning;
}

let retryTimer = null;
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (document.visibilityState !== 'visible') return;
  let next = null;
  for (const item of [...state.items.values(), ...state.attachments.values()]) {
    if (item.state === 'retry_wait' && item.next_attempt_at != null) {
      const t = Number(item.next_attempt_at);
      if (next === null || t < next) next = t;
    }
  }
  if (next === null) return;
  const wait = Math.min(Math.max(next - Date.now() + 250, 1000), 60000);
  retryTimer = setTimeout(() => syncNow('retry_timer'), wait);
}

function itemStateWords(item) {
  switch (item.state) {
    case 'saved_on_device':
      return 'Saved on this phone';
    case 'sending':
      return 'Sending';
    case 'synced':
      return 'Synced';
    case 'auth_required':
      return 'Saved on this phone. Sign in to sync';
    case 'retry_wait': {
      const why = item.last_error === 'network' || item.last_error === 'timeout' ? 'No connection, trying again' : 'Trying again';
      return `Saved on this phone. ${why} ${item.next_attempt_at ? `at ${hhmm(Number(item.next_attempt_at))}` : 'soon'}`;
    }
    case 'conflict':
      return 'Not synced: conflict';
    case 'rejected':
      return 'Not synced: refused';
    case 'deleted':
      return 'Deleted, not resent';
    default:
      return String(item.state || 'Unknown');
  }
}

function itemStateClass(stateName) {
  if (stateName === 'synced') return 'chip chip-good';
  if (stateName === 'conflict' || stateName === 'rejected') return 'chip chip-bad';
  if (stateName === 'auth_required' || stateName === 'retry_wait' || stateName === 'saved_on_device') return 'chip chip-wait';
  return 'chip';
}

function itemExplanation(item) {
  switch (item.state) {
    case 'conflict':
      return 'The server already has a different capture with this ID. Nothing was overwritten.';
    case 'rejected':
      return `The server refused it (${item.last_error || 'no code'}). It will not be sent again. The text is still on this phone.`;
    case 'auth_required':
      return 'Kept on this phone until you sign in again.';
    case 'deleted':
      return 'You deleted this capture, so it will not be sent again. Its words were removed from this phone too.';
    default:
      return '';
  }
}

let outboxRenderQueued = false;
function scheduleOutboxRender() {
  if (outboxRenderQueued) return;
  outboxRenderQueued = true;
  const run = () => {
    outboxRenderQueued = false;
    renderOutbox();
    renderAuthBanner();
  };
  if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function renderOutbox() {
  const list = $('outbox-list');
  if (!list) return;
  list.replaceChildren();
  const items = [...state.items.values()].filter((i) => i.kind === 'capture').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const atts = [...state.attachments.values()];
  const pending = items.filter(isPending).length;
  const pendingAtts = atts.filter(isAttachmentPending).length;
  const problems = items.filter((i) => i.state === 'conflict' || i.state === 'rejected').length;
  let summary;
  if (!items.length && !atts.length) summary = 'Nothing saved on this phone yet.';
  else if (pending) summary = `${plural(pending, 'capture', 'captures')} waiting to sync.`;
  else summary = 'Everything on this phone has synced.';
  if (pendingAtts) summary = `${pending ? summary : ''}${pending ? ' ' : ''}${plural(pendingAtts, 'photo or file', 'photos or files')} waiting to upload.`;
  if (problems) summary += ` ${plural(problems, 'capture needs', 'captures need')} a look.`;
  setText('outbox-summary', summary);
  const attsFor = (id) => atts.filter((a) => a.capture_id === id);
  // Pending and problem items first (and any capture with a photo still waiting), then the 10 most recent synced ones.
  const busy = (i) => i.state !== 'synced' || attsFor(i.id).some(isAttachmentPending);
  const shown = items.filter(busy).concat(items.filter((i) => !busy(i)).slice(0, 10));
  for (const item of shown.slice(0, 40)) {
    const b = item.body || {};
    const li = h('li', { class: 'outbox-row' });
    li.append(h('p', { class: 'row-title', text: item.state === 'deleted' ? '(deleted capture)' : excerpt(b.text, 140) }));
    li.append(h('p', null, h('span', { class: itemStateClass(item.state), text: itemStateWords(item) }), ' ', scopeChip(b.scope)));
    const meta = [`Saved ${formatAt(item.created_at)}`];
    if (item.attempts) meta.push(plural(item.attempts, 'retry', 'retries'));
    if (item.synced_at) meta.push(`synced ${formatAt(item.synced_at)}`);
    li.append(h('p', { class: 'row-meta', text: meta.join(' · ') }));
    const why = itemExplanation(item);
    if (why) li.append(h('p', { class: 'row-meta', text: why }));
    for (const a of attsFor(item.id)) {
      li.append(h('p', { class: 'row-meta att-state' }, h('span', { class: attachmentClass(a), text: attachmentWords(a, item) }), ' ', a.name));
    }
    list.append(li);
  }
  // Photos whose capture is no longer listed here (pruned after syncing, or deleted).
  const listed = new Set(shown.map((i) => i.id));
  for (const a of atts.filter((x) => !listed.has(x.capture_id) && (isAttachmentPending(x) || x.state === 'rejected' || x.state === 'conflict')).slice(0, 20)) {
    list.append(h('li', { class: 'outbox-row' }, h('p', { class: 'row-title', text: a.name }), h('p', null, h('span', { class: attachmentClass(a), text: attachmentWords(a, null) }))));
  }
}

// ---------------------------------------------------------------------------
// Photos and files in the capture sheet. Kept with the draft on this phone, queued (IndexedDB, keyed by
// attachment id) when the capture is saved, and uploaded after the capture has synced.

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('read_failed'));
    r.readAsDataURL(blob);
  });
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through: some engines decode only through an image element */
    }
  }
  // The page CSP allows data: images (not blob:), so decode through a data URL.
  const url = await readAsDataUrl(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode_failed'));
    img.src = url;
  });
}

function canvasJpeg(canvas, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}

// A JPEG no larger than MAX_ATTACHMENT_BYTES, longest side IMAGE_MAX_SIDE or less, or null.
async function downscaleImage(blob) {
  const img = await decodeImage(blob);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  try {
    for (const [side, quality] of [[IMAGE_MAX_SIDE, 0.85], [IMAGE_MAX_SIDE, 0.7], [1600, 0.7], [1280, 0.6]]) {
      const { width, height } = fitWithin(w0, h0, side);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const out = await canvasJpeg(canvas, quality);
      if (out && out.size <= MAX_ATTACHMENT_BYTES) return out;
    }
    return null;
  } finally {
    if (typeof img.close === 'function') img.close();
  }
}

async function prepareFile(file) {
  const mime = attachmentMime(file.type, file.name);
  let name = safeFileName(file.name, mime && mime.startsWith('image/') ? 'photo' : 'file');
  if (!mime) return { error: `${name} can't be attached. Photos, PDF and text files only.` };
  let blob = file;
  let outMime = mime;
  if (mime.startsWith('image/') && file.size > MAX_ATTACHMENT_BYTES) {
    const small = await downscaleImage(file).catch(() => null);
    if (!small) return { error: `${name} is over 1 MB and could not be made smaller on this phone.` };
    blob = small;
    outMime = 'image/jpeg';
    name = `${name.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.jpg`;
  }
  if (blob.size > MAX_ATTACHMENT_BYTES) return { error: `${name} is over 1 MB. Only photos can be made smaller.` };
  if (blob.size < 1) return { error: `${name} is empty.` };
  const url = await readAsDataUrl(blob);
  return { file: { id: newClientId('att'), name, mime: outMime, size: blob.size, data_b64: url.slice(url.indexOf(',') + 1) } };
}

async function addFiles(fileList) {
  const files = [...(fileList || [])];
  for (const f of files) {
    if (state.sheetFiles.length >= MAX_ATTACHMENTS_PER_CAPTURE) {
      showNotice(`Up to ${MAX_ATTACHMENTS_PER_CAPTURE} photos or files per capture.`);
      break;
    }
    setText('draft-status', 'Adding.');
    let res;
    try {
      res = await prepareFile(f);
    } catch {
      res = { error: 'That file could not be read on this phone.' };
    }
    if (res.error) {
      showNotice(res.error);
      continue;
    }
    state.sheetFiles.push(res.file);
    setText('draft-status', `${res.file.mime.startsWith('image/') ? 'Photo' : 'File'} added.`);
  }
  renderSheetFiles();
  writeDraft();
}

function onCaptureFileChange() {
  const input = $('capture-file');
  const files = input.files;
  addFiles(files).finally(() => {
    input.value = '';
  });
}

// A pasted picture is added as a photo; pasted text still pastes as text.
function onCapturePaste(e) {
  const cd = e.clipboardData;
  if (!cd) return;
  const images = [...(cd.files || [])].filter((f) => String(f.type || '').startsWith('image/'));
  if (!images.length) return;
  if (!cd.getData('text/plain')) e.preventDefault();
  addFiles(images);
}

function previewable(mime) {
  return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
}

function renderSheetFiles() {
  const ul = $('capture-files');
  ul.replaceChildren();
  ul.hidden = state.sheetFiles.length === 0;
  for (const f of state.sheetFiles) {
    const kb = Math.max(1, Math.round(f.size / 1024));
    ul.append(
      h(
        'li',
        { class: 'att-pending-row' },
        previewable(f.mime) ? h('img', { class: 'att-preview', src: `data:${f.mime};base64,${f.data_b64}`, alt: '', width: 56, height: 56 }) : h('span', { class: 'att-icon', 'aria-hidden': 'true', text: f.mime === 'application/pdf' ? 'PDF' : 'FILE' }),
        h('span', { class: 'att-name' }, h('span', { text: f.name }), h('span', { class: 'row-meta', text: `${kb} KB` })),
        h('button', {
          type: 'button',
          class: 'btn btn-ghost',
          text: 'Remove',
          'aria-label': `Remove ${f.name}`,
          onclick: () => {
            state.sheetFiles = state.sheetFiles.filter((x) => x.id !== f.id);
            renderSheetFiles();
            writeDraft();
            setStatus(`${f.name} removed.`);
            $('capture-file').focus();
          },
        }),
      ),
    );
  }
}

function validDraftFile(f) {
  return !!f && CLIENT_ID_RE.test(String(f.id || '')) && attachmentMime(f.mime, '') === f.mime && typeof f.data_b64 === 'string' && f.data_b64.length > 0 && Number(f.size) <= MAX_ATTACHMENT_BYTES;
}

// Queues the sheet's files for a saved capture. Returns false when this phone could not keep them.
async function queueAttachments(captureId, scope, files) {
  if (!files.length) return true;
  try {
    const stores = await storesReady;
    for (const f of files) {
      const item = createAttachmentItem({ id: f.id, capture_id: captureId, scope, name: f.name, mime: f.mime, data_b64: f.data_b64 });
      if (!(await stores.attachments.get(item.id))) await stores.attachments.put(item);
      state.attachments.set(item.id, withoutBytes(item));
    }
    logEvent({ kind: 'attachments_queued', id: captureId, count: files.length });
    return true;
  } catch {
    return false;
  }
}

function withoutBytes(item) {
  const { data_b64: _drop, ...rest } = item;
  return rest;
}

async function reloadAttachments() {
  const stores = await storesReady;
  const list = await stores.attachments.list();
  state.attachments = new Map(list.map((a) => [a.id, withoutBytes(a)]));
}

function onAttachmentChange(item) {
  state.attachments.set(item.id, withoutBytes(item));
  logEvent({ kind: 'attachment_state', id: item.id, capture: item.capture_id, state: item.state, attempts: item.attempts, error: item.last_error || null });
  if (item.state === 'dropped') showNotice(`${item.mime.startsWith('image/') ? 'A photo was' : 'A file was'} not sent: its capture was deleted. It was removed from this phone.`);
  scheduleOutboxRender();
}

async function removeLocalAttachments(captureId) {
  try {
    const stores = await storesReady;
    for (const a of await stores.attachments.list()) {
      if (a.capture_id === captureId) {
        await stores.attachments.remove(a.id);
        state.attachments.delete(a.id);
      }
    }
  } catch {
    /* the server refuses attachments for a deleted capture anyway */
  }
}

function attachmentWords(a, capture) {
  const noun = String(a.mime || '').startsWith('image/') ? 'Photo' : 'File';
  const offline = navigator.onLine === false;
  switch (a.state) {
    case 'sending':
      return `${noun} sending`;
    case 'waiting':
      if (offline) return `${noun} waiting for a connection`;
      return capture && capture.state === 'auth_required' ? `${noun} waiting: sign in again` : `${noun} waiting for its capture to sync`;
    case 'retry_wait':
      return offline || a.last_error === 'network' || a.last_error === 'timeout' ? `${noun} waiting for a connection` : `${noun} not sent yet, trying again`;
    case 'auth_required':
      return `${noun} waiting: sign in again`;
    case 'uploaded':
      return `${noun} uploaded`;
    case 'dropped':
      return `${noun} not sent: its capture was deleted`;
    case 'conflict':
      return `${noun} not sent: a different file already has this ID`;
    case 'rejected':
      return a.last_error === 'capture_not_saved' ? `${noun} not sent: its capture was not saved` : `${noun} not sent: refused (${a.last_error || 'no code'})`;
    default:
      return `${noun}: ${String(a.state || 'unknown')}`;
  }
}

function attachmentClass(a) {
  if (a.state === 'uploaded') return 'chip chip-good';
  if (a.state === 'dropped' || a.state === 'conflict' || a.state === 'rejected') return 'chip chip-bad';
  return 'chip chip-wait';
}

// Web Share Target (GET ?title=&text=&url=): opens the capture sheet with the shared words. Nothing is
// saved until Save is tapped; shared text is only text.
function handleShareParam() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return;
  }
  if (!['title', 'text', 'url'].some((k) => params.has(k))) return;
  const shared = shareText({ title: params.get('title'), text: params.get('text'), url: params.get('url') });
  try {
    history.replaceState(null, '', `${location.pathname}#/capture`);
  } catch {
    /* ignore */
  }
  logEvent({ kind: 'share_opened', has_text: shared.length > 0 });
  if (shared) {
    const box = $('capture-text');
    box.value = box.value.trim() ? `${box.value}\n${shared}` : shared;
    onDraftInput();
  }
  onRoute();
  setText('draft-status', shared ? 'Shared text added. Check it, then Save.' : 'Nothing came with the share. Type or paste instead.');
}

// ---------------------------------------------------------------------------
// Reminder acknowledgements (?ack=<id>, service worker message)

async function postAck(deliveryId, via) {
  const r = await api(`/api/deliveries/${enc(deliveryId)}/ack`, { method: 'POST', body: { via } });
  logEvent({ kind: 'ack', id: deliveryId, via, status: r.status, ok: r.ok });
  return r;
}

async function addPendingAck(deliveryId, via) {
  try {
    const stores = await storesReady;
    const list = (await stores.drafts.get(PENDING_ACKS_KEY)) || [];
    if (!list.some((a) => a.id === deliveryId)) list.push({ id: deliveryId, via, at: Date.now() });
    await stores.drafts.put(PENDING_ACKS_KEY, list.slice(-50));
  } catch {
    /* ignore */
  }
}

async function removePendingAck(deliveryId) {
  try {
    const stores = await storesReady;
    const list = (await stores.drafts.get(PENDING_ACKS_KEY)) || [];
    await stores.drafts.put(
      PENDING_ACKS_KEY,
      list.filter((a) => a.id !== deliveryId),
    );
  } catch {
    /* ignore */
  }
}

let flushingAcks = false;
async function flushPendingAcks() {
  if (flushingAcks) return;
  flushingAcks = true;
  try {
    const stores = await storesReady;
    const list = (await stores.drafts.get(PENDING_ACKS_KEY)) || [];
    for (const a of list) {
      const r = await postAck(a.id, a.via);
      if (r.ok || r.verdict === 'rejected' || r.verdict === 'conflict') await removePendingAck(a.id);
      else break; // offline or signed out: try again on the next sync
    }
  } catch {
    /* ignore */
  } finally {
    flushingAcks = false;
  }
}

async function handleAck(deliveryId, via) {
  if (!DELIVERY_ID_RE.test(deliveryId)) {
    showNotice('That alert link was not valid.');
    return;
  }
  await addPendingAck(deliveryId, via);
  const r = await postAck(deliveryId, via);
  if (r.ok || r.verdict === 'rejected' || r.verdict === 'conflict') await removePendingAck(deliveryId);
  if (r.ok) setStatus('Reminder acknowledged.');
  else if (r.verdict === 'auth_required') showNotice('Reminder tap kept on this phone. Sign in again to send it.');
  else if (r.offline || r.verdict === 'retry') showNotice('Reminder tap kept on this phone. It will be sent when online.');
  else showNotice(failWords(r, 'acknowledge the reminder'));
}

function handleAckParam() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return undefined;
  }
  if (!params.has('ack')) return undefined;
  const id = params.get('ack') || '';
  const done = handleAck(id, 'notification');
  // Strip the query once the ack is on its way so a reload does not repeat it.
  try {
    history.replaceState(null, '', `${location.pathname}${location.hash || '#/today'}`);
  } catch {
    /* ignore */
  }
  return done;
}

// ---------------------------------------------------------------------------
// Session

async function loadSession() {
  const r = await api('/api/session');
  if (r.ok && r.data && r.data.identity) {
    state.session = r.data;
    state.sessionStatus = 'ok';
    const keep = { kind: r.data.identity.kind, emailMasked: r.data.identity.emailMasked || null, at: Date.now() };
    storesReady.then((s) => s.drafts.put(LAST_SESSION_KEY, keep)).catch(() => {});
  } else if (r.verdict === 'auth_required') {
    state.sessionStatus = 'auth';
  } else if (r.offline) {
    state.sessionStatus = 'offline';
  } else {
    state.sessionStatus = 'error';
    state.sessionError = failWords(r, 'check');
  }
  if (!state.session) {
    try {
      const stores = await storesReady;
      const last = await stores.drafts.get(LAST_SESSION_KEY);
      if (last) state.lastKnownSession = last;
    } catch {
      /* ignore */
    }
  }
  renderSession();
}

function kindWords(kind) {
  if (kind === 'owner') return 'Owner';
  if (kind === 'service') return 'Shortcut service token';
  if (kind === 'dev') return 'Local dev, no sign-in';
  return kind ? String(kind) : 'Unknown';
}

function renderSession() {
  const s = state.session && state.session.identity;
  if (state.sessionStatus === 'ok' && s) {
    setText('session-kind', kindWords(s.kind));
    setText('session-email', s.emailMasked || 'None');
    return;
  }
  const last = state.lastKnownSession;
  if (state.sessionStatus === 'auth') setText('session-kind', 'Signed out. The session ended.');
  else if (state.sessionStatus === 'offline') setText('session-kind', last ? `Offline. Last seen as ${kindWords(last.kind)}` : 'Offline');
  else if (state.sessionStatus === 'error') setText('session-kind', state.sessionError || 'Could not check.');
  else setText('session-kind', 'Checking');
  setText('session-email', last && last.emailMasked ? `${last.emailMasked} (last known)` : 'None');
}

// ---------------------------------------------------------------------------
// Reminder alerts (web push, spike semantics). Never claims an alert arrived.

function isIos() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* ignore */
  }
  return navigator.standalone === true;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function b64urlToBytes(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameBytes(a, b) {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    logEvent({ kind: 'sw_register_failed', error: e && e.name ? e.name : 'error' });
    return;
  }
  const ready = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 15000))]);
  if (ready) state.swReg = ready;
  if (state.swReg && state.swReg.pushManager) {
    try {
      state.subscription = await state.swReg.pushManager.getSubscription();
      state.pushKnown = true;
    } catch {
      state.pushKnown = false;
    }
  }
  renderNotify();
}

async function loadVapidKey() {
  if (state.vapidKeyBytes) return state.vapidKeyBytes;
  const r = await api('/api/push/public-key');
  if (r.ok && r.data && typeof r.data.publicKey === 'string') {
    try {
      state.vapidKeyBytes = b64urlToBytes(r.data.publicKey);
    } catch {
      state.vapidKeyBytes = null;
    }
  }
  return state.vapidKeyBytes;
}

async function subscribeFresh(reg, keyBytes) {
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const current = existing.options && existing.options.applicationServerKey;
    if (!current || sameBytes(current, keyBytes)) return existing;
    await existing.unsubscribe().catch(() => {});
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
}

async function postSubscription(sub) {
  const json = sub.toJSON();
  const body = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth },
    ua: String(navigator.userAgent || '').slice(0, 200),
  };
  const r = await api('/api/push/subscriptions', { method: 'POST', body });
  // Log only the outcome, never the endpoint or keys.
  logEvent({ kind: 'push_subscription_post', status: r.status, ok: r.ok });
  return r;
}

function onEnableClick() {
  if (isIos() && !isStandalone()) {
    renderNotify();
    setText('notify-result', 'Add to Home Screen first, then open the app from there.');
    return;
  }
  if (!pushSupported()) {
    setText('notify-result', 'This browser cannot receive reminder alerts.');
    return;
  }
  // The permission request is the very first thing in the tap handler: no await before it.
  let permissionPromise;
  try {
    permissionPromise = Notification.requestPermission();
  } catch (e) {
    permissionPromise = Promise.reject(e);
  }
  const reg = state.swReg;
  const key = state.vapidKeyBytes;
  let directSubscribe = null;
  if (Notification.permission === 'granted' && reg && key) {
    directSubscribe = reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    directSubscribe.catch(() => {});
  }
  setText('notify-result', 'Asking for permission.');
  Promise.resolve(permissionPromise)
    .then(async (result) => {
      const permission = result || Notification.permission;
      logEvent({ kind: 'notification_permission', result: permission });
      renderNotify();
      if (permission !== 'granted') {
        setText('notify-result', permission === 'denied' ? 'Alerts are blocked. Turn them on in Settings, Notifications, Harrison OS.' : 'Alerts were not allowed.');
        return;
      }
      setText('notify-result', 'Registering this phone for alerts.');
      const r0 = reg || state.swReg;
      const k0 = key || state.vapidKeyBytes;
      let sub = null;
      if (directSubscribe) sub = await directSubscribe.catch(() => null);
      if (!sub && r0 && k0) sub = await r0.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k0 }).catch(() => null);
      if (!sub) {
        const r1 = r0 || (await navigator.serviceWorker.ready);
        const k1 = k0 || (await loadVapidKey());
        if (!r1 || !k1) {
          setText('notify-result', 'Could not get the alert key from the server. Check the connection and try again.');
          return;
        }
        state.swReg = r1;
        sub = await subscribeFresh(r1, k1);
      }
      const posted = await postSubscription(sub);
      state.subscription = sub;
      state.pushKnown = true;
      state.lastResubscribeAt = Date.now();
      setText('notify-result', posted.ok ? 'This phone is registered for alerts.' : `Registered on the phone, but the server did not take it. ${failWords(posted, 'register')}`);
      renderNotify();
    })
    .catch((e) => {
      logEvent({ kind: 'push_subscribe_failed', error: e && e.name ? e.name : 'error' });
      setText('notify-result', `Could not turn on alerts (${e && e.name ? e.name : 'error'}).`);
      renderNotify();
    });
}

// iOS can silently invalidate subscriptions, so re-subscribe on open when allowed.
async function resubscribeSilently(force) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  if (!force && Date.now() - state.lastResubscribeAt < RESUBSCRIBE_MIN_GAP_MS) return;
  const reg = state.swReg;
  if (!reg) return;
  const key = await loadVapidKey();
  if (!key) return;
  state.lastResubscribeAt = Date.now();
  try {
    const sub = await subscribeFresh(reg, key);
    state.subscription = sub;
    state.pushKnown = true;
    const r = await postSubscription(sub);
    logEvent({ kind: 'push_resubscribe', ok: r.ok, status: r.status });
  } catch (e) {
    logEvent({ kind: 'push_resubscribe_failed', error: e && e.name ? e.name : 'error' });
  }
  renderNotify();
}

function renderNotify() {
  const enable = $('notify-enable');
  const iosBrowser = isIos() && !isStandalone();
  $('a2hs').hidden = !iosBrowser;
  if (iosBrowser) {
    setText('notify-permission', 'Alerts need the Home Screen app.');
    enable.hidden = true;
  } else if (!pushSupported()) {
    setText('notify-permission', 'This browser cannot receive reminder alerts.');
    enable.hidden = true;
  } else {
    const p = Notification.permission;
    setText(
      'notify-permission',
      p === 'granted' ? 'Alerts are allowed.' : p === 'denied' ? 'Alerts are blocked. Turn them on in Settings, Notifications, Harrison OS.' : 'Alerts are not set up yet.',
    );
    enable.hidden = p === 'denied';
    enable.textContent = p === 'granted' && state.subscription ? 'Register this phone again' : 'Turn on alerts';
  }
  if (!state.pushKnown) setText('notify-route', iosBrowser ? 'No alert route on this phone yet.' : 'Checking whether this phone has an alert route.');
  else setText('notify-route', state.subscription ? 'This phone has an alert route. That is not proof an alert will show.' : 'No alert route on this phone.');
}

// ---------------------------------------------------------------------------
// Wiring

function bindHandlers() {
  window.addEventListener('hashchange', onRoute);
  for (const btn of document.querySelectorAll('.scope-btn')) btn.addEventListener('click', () => setScope(btn.dataset.scope));
  $('auth-banner-button').addEventListener('click', signInAgain);
  $('session-reload').addEventListener('click', signInAgain);
  $('toast-undo').addEventListener('click', onUndoClick);

  const sheet = $('capture-sheet');
  $('capture-form').addEventListener('submit', onCaptureSubmit);
  $('capture-text').addEventListener('input', onDraftInput);
  for (const input of document.querySelectorAll('input[name="cscope"]')) input.addEventListener('change', onDraftInput);
  $('capture-close').addEventListener('click', () => closeCaptureSheet(true));
  sheet.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeCaptureSheet(true);
  });
  sheet.addEventListener('close', () => {
    if (parseHash().name === 'capture') location.replace(hashFor(state.baseRoute));
  });
  // A tap on the backdrop (outside the sheet's box) closes it.
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeCaptureSheet(true);
  });

  $('capture-file').addEventListener('change', onCaptureFileChange);
  $('capture-text').addEventListener('paste', onCapturePaste);

  const edit = $('edit-sheet');
  $('edit-sheet-close').addEventListener('click', closeEditSheet);
  edit.addEventListener('close', onEditSheetClosed);
  edit.addEventListener('click', (e) => {
    if (e.target !== edit) return;
    const r = edit.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeEditSheet();
  });

  $('tasks-filter').addEventListener('input', onTasksFilterInput);
  $('decision-new').addEventListener('click', (e) => openDecisionSheet(e.currentTarget, { scope: isScope(state.scope) ? state.scope : null }));
  $('prefs-form').addEventListener('submit', onPreferenceSubmit);
  $('pref-cancel').addEventListener('click', () => {
    $('prefs-details').open = false;
    resetPreferenceForm();
    $('prefs-summary').focus();
  });
  $('restore-file').addEventListener('change', onRestoreFileChange);
  $('restore-form').addEventListener('submit', onRestoreSubmit);

  $('project-form').addEventListener('submit', onProjectSubmit);
  $('search-form').addEventListener('submit', onSearchSubmit);
  $('search-q').addEventListener('input', onSearchInput);
  document.querySelector('#screen-memory').addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button[data-export]')) onExportClick(e);
  });
  $('notify-enable').addEventListener('click', onEnableClick);

  window.addEventListener('online', () => {
    renderOffline();
    setStatus('Back online. Syncing.');
    syncNow('online');
    loadSession();
    reloadCurrent();
  });
  window.addEventListener('offline', () => {
    renderOffline();
    setStatus('Offline. New captures stay on this phone.');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      renderOffline();
      syncNow('visible');
      if (state.route.name === 'today') loadToday();
      resubscribeSilently(false);
    } else {
      flushDraft();
    }
  });
  window.addEventListener('pagehide', flushDraft);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) syncNow('pageshow');
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type === 'notification-ack' && typeof data.deliveryId === 'string') handleAck(data.deliveryId, 'notification');
    });
  }
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', renderNotify);
  } catch {
    /* older engines */
  }
}

function startTimers() {
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow('interval');
  }, SYNC_INTERVAL_MS);
}

function loadLocalPrefs() {
  const saved = readLocal(SCOPE_KEY);
  state.scope = SCOPES.includes(saved) ? saved : 'all';
  try {
    const map = JSON.parse(readLocal(PROJECT_SCOPES_KEY) || '{}');
    if (map && typeof map === 'object') {
      for (const [k, v] of Object.entries(map)) if (PATH_ID_RE.test(k) && isScope(v)) state.projectScopes[k] = v;
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// View modules (public/views/*.js). Each exports register(kit) and adds its own screens and blocks.
// A block renderer returns a Node, null, or a Promise of either; a failing block never breaks its screen.

function extSlot(list, arg) {
  const slot = h('div', { class: 'ext-slot' });
  for (const render of list) {
    Promise.resolve()
      .then(() => render(arg, state.scope))
      .then((node) => {
        if (node) slot.append(node);
      })
      .catch(() => slot.append(h('p', { class: 'subtle', text: 'One section could not load. Pull to refresh or try again later.' })));
  }
  return slot;
}

function renderExtBlocks(list, containerId, arg) {
  const el = $(containerId);
  if (el) el.replaceChildren(extSlot(list, arg));
}

function addRoute(name, { title, load, tab = null }) {
  if (ROUTES.has(name) || !/^[a-z][a-z-]{1,30}$/.test(name)) throw new Error(`bad route ${name}`);
  ROUTES.add(name);
  EXT.routes.set(name, { title, load, tab });
  const sec = h(
    'section',
    { id: `screen-${name}`, class: 'screen', 'aria-labelledby': `${name}-title`, hidden: true },
    h('div', { class: 'screen-head' }, h('a', { href: '#/today', class: 'back-link', text: 'Back to Today' }), h('h1', { id: `${name}-title`, tabindex: '-1', text: title })),
    h('div', { id: `${name}-body`, class: 'stack' }),
  );
  $('main').append(sec);
}

function addTopbarButton({ label, onClick, id }) {
  const btn = h('button', { type: 'button', class: 'btn btn-ghost topbar-action', id, text: label });
  btn.addEventListener('click', onClick);
  const holder = document.querySelector('.topbar-inner');
  holder.insertBefore(btn, holder.querySelector('.scope-switch'));
  return btn;
}

const kit = Object.freeze({
  h, api, state, go, section, chip, scopeChip, sampleChip, statusChip, kindChip, noticeBlock, showNotice, showToast,
  setStatus, guarded, failWords, formatOn, formatAt, formatTimeOfDay, excerpt, enc, qs, plural, localOn, deviceTimeZone,
  sourceWords, isScope, PATH_ID_RE, STATUS_LABEL, KIND_LABEL, reloadCurrent,
  addRoute,
  addTodayBlock: (fn) => EXT.today.push(fn),
  addProjectBlock: (fn) => EXT.project.push(fn),
  addMemoryBlock: (fn) => EXT.memory.push(fn),
  addTopbarButton,
  // The scope new content should be written to when the switch shows All: the capture default.
  writeScope: () => (state.scope === 'all' ? preferredCaptureScope() : state.scope),
});

function registerViews() {
  for (const mod of VIEW_MODULES) {
    try {
      mod.register(kit);
    } catch (e) {
      logEvent({ kind: 'view_register_failed', name: e && e.name });
    }
  }
}

async function init() {
  registerViews();
  loadLocalPrefs();
  bindHandlers();
  renderScopeSwitch();
  renderOffline();
  renderNotify();
  setCaptureScope(preferredCaptureScope());
  onRoute();

  const stores = await openStores({ name: IDB_NAME });
  state.stores = stores;
  if (stores.warning) {
    const w = $('storage-warning');
    w.textContent = stores.warning;
    w.hidden = false;
  }
  state.engine = createSyncEngine({ store: stores.outbox, fetchImpl: trackingFetch, onChange: onItemChange, headers: API_HEADERS });
  resolveStores(stores);
  logEvent({ kind: 'app_open', build: CLIENT_BUILD, mode: isStandalone() ? 'standalone' : 'browser', online: navigator.onLine, storage: stores.persistent ? 'idb' : 'memory' });
  try {
    await restoreDraft();
  } finally {
    resolveDraftRestored();
  }
  await reloadItems().catch(() => {});
  await reloadAttachments().catch(() => {});
  renderOutbox();
  renderAuthBanner();
  handleAckParam();
  handleShareParam();
  try {
    if (navigator.storage && navigator.storage.persisted && !(await navigator.storage.persisted()) && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      logEvent({ kind: 'storage_persist_request', granted });
    }
  } catch {
    /* ignore */
  }
  syncNow('load');
  loadSession();
  registerServiceWorker().then(() => resubscribeSilently(true));
  startTimers();
}

init().catch((e) => {
  showNotice(`The app did not start cleanly (${e && e.name ? e.name : 'error'}). Reload to try again.`);
});

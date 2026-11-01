// Extras Log screens and on-device storage (IndexedDB). The rules live in extras.mjs.
// Nothing here talks to a server: the page's CSP only allows its own files, and data never leaves the phone
// except through the share sheet, a copy, print, or a backup file he saves himself.
import * as X from './extras.mjs';

const app = document.getElementById('app');
const S = { jobs: {}, events: [], filter: 'all', showVoid: false, shared: null, typed: {}, photos: new Map(), mount: [] };
const now = () => new Date().toISOString();
const ls = {
  get: k => { try { return localStorage.getItem('extras-log.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('extras-log.' + k) : localStorage.setItem('extras-log.' + k, v); } catch { /* private mode: conveniences only */ } },
};
S.filter = ls.get('filter') || 'all';
// ponytail: a backup is one JSON file with every photo inline, built and read whole in memory. Past a few hundred
// MB a phone may not manage it. Upgrade path: one backup per job, or photos as separate files.
const MAX_BACKUP = 500 * 1048576;

// ---------- DOM helper. User text only ever goes in as text nodes or properties, never as HTML.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'for') el.htmlFor = v;
    else if (k.includes('-') || k === 'role' || !(k in el)) el.setAttribute(k, v === true ? '' : v);
    else el[k] = v;
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== '') el.append(c instanceof Node ? c : String(c));
  return el;
}
let uid = 0;
const nid = () => 'f' + ++uid;
const title = text => h('h1', { tabIndex: -1 }, text);
const back = (to = '#/', label = '‹ All extras') => h('div', { class: 'top noprint' }, h('button', { class: 'link', onclick: () => go(to) }, label));
const chip = (label, on, onclick) => h('button', { type: 'button', 'aria-pressed': String(on), onclick }, label);
const dtdd = (k, v) => v ? [h('dt', null, k), h('dd', null, v)] : null;
const table = (head, rows) => rows.length ? h('table', null, h('thead', null, h('tr', null, head.map(x => h('th', { scope: 'col' }, x)))), h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, String(c))))))) : null;
const errBox = () => h('p', { class: 'err', role: 'alert' });
// The action bar is fixed to the bottom, so its errors sit inside it, next to the button that was tapped.
const bar = (err, ...buttons) => h('div', { class: 'bar noprint' }, err, h('div', null, buttons));
function field(label, input, hint) {
  input.id ||= nid();
  const hid = hint ? nid() : null;
  if (hid) input.setAttribute('aria-describedby', hid);
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), hint ? h('p', { class: 'hint', id: hid }, hint) : null, input);
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}
addEventListener('unhandledrejection', e => toast(e.reason?.message || 'Could not save on this phone. Try again.'));
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = h('textarea', { value: text }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(`${what} copied`);
}
const localInput = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const money = v => { const s = String(v ?? '').replace(/[$,\s]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : NaN; };
const mb = n => `${(n / 1048576).toFixed(1)} MB`;
// A "when did this go out" field: shows now until he changes it, and an unchanged field means the moment of the
// tap, never the moment the screen was drawn (a resumed app can show a screen drawn hours ago).
function whenInput(key) {
  const typed = S.typed[key];
  const el = h('input', { type: 'datetime-local', value: typed ?? localInput(now()), oninput: e => { S.typed[key] = e.target.value; delete el.dataset.now; } });
  if (typed == null) el.dataset.now = '1';
  return el;
}
const whenValue = key => S.typed[key] != null ? new Date(S.typed[key]) : new Date();

// ---------- storage
let db = null;
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('extras-log', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('jobs', { keyPath: 'name' });
      d.createObjectStore('events', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' }); // {id, data: JPEG data URL}; events hold ids so the list never loads images
    };
    r.onsuccess = () => { const d = r.result; d.onclose = () => { if (db === d) db = null; }; d.onversionchange = () => d.close(); res(d); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Close other Extras tabs and reload.'));
  });
}
// iOS can drop the storage connection while a Home Screen app sits suspended; reopen once and retry.
// A transaction commits whole or not at all, so the retry cannot double-write.
async function run(stores, mode, fn, retry = true) {
  db ||= await openDb();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      const out = fn(...[].concat(stores).map(s => t.objectStore(s)));
      t.oncomplete = () => res(out?.result);
      t.onerror = t.onabort = () => rej(t.error || new Error('Could not save on this phone.'));
    });
  } catch (err) {
    if (retry && ['InvalidStateError', 'UnknownError'].includes(err?.name)) { db = null; return run(stores, mode, fn, false); }
    throw err;
  }
}
const getAll = s => run(s, 'readonly', o => o.getAll());
const getOne = (s, id) => run(s, 'readonly', o => o.get(id));
// One transaction, so an event and its photos are saved together or not at all.
const write = ({ events = [], photos = [], dropPhotos = [], jobs = [], dropJobs = [] }) => run(['jobs', 'events', 'photos'], 'readwrite', (J, E, P) => {
  jobs.forEach(j => J.put(j)); dropJobs.forEach(n => J.delete(n));
  events.forEach(e => E.put(e)); photos.forEach(p => P.put(p)); dropPhotos.forEach(id => P.delete(id));
});
async function load() {
  const [jobs, events] = await Promise.all([getAll('jobs'), getAll('events')]);
  S.jobs = Object.fromEntries(jobs.map(j => [j.name, j]));
  S.events = events;
}
let askedPersist = false;
function persist() { if (!askedPersist && navigator.storage?.persist) { askedPersist = true; navigator.storage.persist().catch(() => {}); } }
async function saveEv(e, extra = {}) {
  e.updatedAt = now();
  await write({ events: [e], ...extra });
  S.events = [...S.events.filter(x => x.id !== e.id), e];
  persist();
}
async function photo(id) {
  if (!S.photos.has(id)) S.photos.set(id, (await getOne('photos', id))?.data || null);
  return S.photos.get(id);
}

// ---------- routing
const go = (hash, replace) => replace ? location.replace(hash) : (location.hash = hash);
let lastHash = null;
function render() {
  const hash = location.hash || '#/';
  const [, a = '', id = '', b = ''] = hash.match(/^#\/([^/]*)\/?([^/]*)\/?([^/]*)/) || [];
  const prev = document.activeElement, keep = prev && prev !== app && app.contains(prev) ? prev.textContent : null, keepId = keep != null && prev.id;
  S.mount = [];
  let view;
  try {
    view = a === 'new' ? formScreen(null)
      : a === 'e' && b === 'edit' ? formScreen(id)
      : a === 'e' && b === 'sign' ? signScreen(id)
      : a === 'e' && b === 'refuse' ? refuseScreen(id)
      : a === 'e' && b === 'void' ? voidScreen(id)
      : a === 'e' ? detailScreen(id)
      : a === 'jobs' ? jobsScreen()
      : a === 'backup' ? backupScreen()
      : logScreen();
  } catch (err) {
    view = [back(), title('Something went wrong'), h('p', null, String(err?.message || err))];
  }
  if (!view) return; // the screen redirected
  app.replaceChildren(...[view].flat(Infinity).filter(Boolean));
  S.mount.forEach(f => f());
  if (hash !== lastHash) { lastHash = hash; window.scrollTo(0, 0); app.querySelector('h1')?.focus({ preventScroll: true }); }
  else if (keep != null) ((keepId && document.getElementById(keepId)) || [...app.querySelectorAll('button')].find(x => x.textContent === keep) || app.querySelector('h1'))?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', render);
// A Home Screen app resumes without reloading, so deadline colours would freeze at the last render.
// The log re-renders (it has no fields); a detail screen swaps only its status banner and moves untouched
// "now" times forward, so nothing he is typing is wiped.
const tick = () => {
  if (document.hidden) return;
  const hash = location.hash || '#/', m = hash.match(/^#\/e\/([^/]+)$/), e = m && findEv(m[1]);
  if (hash === '#/' && Object.keys(S.jobs).length) render();
  else if (e) {
    app.querySelector('.banner')?.replaceWith(statusBanner(e, S.jobs[e.job], Date.now()));
    app.querySelectorAll('input[data-now]').forEach(i => { i.value = localInput(now()); });
  }
};
document.addEventListener('visibilitychange', tick);
setInterval(tick, 60000);
const findEv = id => S.events.find(e => e.id === id);
const missing = () => [back(), title('Not found'), h('p', null, 'This item is not on this phone.')];

// ---------- log
function flagText(e, job, t = Date.now()) {
  const f = X.flag(e, job, t), d = X.deadline(e, job), s = X.status(e), late = X.lateBy(e, job);
  if (f === 'late') return `Notice overdue by ${X.span(t - d)}`;
  if (f === 'soon') return `Notice due in ${X.span(d - t)}`;
  if (f === 'ok') return `Notice due ${X.when(d)}`;
  if (f === 'unset') return 'Notice window not set';
  if (f === 'rejected') return `CO rejected ${X.day(e.decidedAt)}`;
  const base = s === 'noticed' ? `Notice sent ${X.day(e.noticeSentAt)}` : s === 'co_submitted' ? `CO submitted${e.coAmount != null ? ' ' + X.usd(e.coAmount) : ''}` : X.STATUS[s];
  return late && (s === 'noticed' || s === 'co_submitted') ? `${base}, ${X.span(late)} after the window` : base;
}
const tone = (e, job, t) => { const f = X.flag(e, job, t); return f === 'done' && X.status(e) !== 'approved' && X.lateBy(e, job) ? 'late' : f; };
function evCard(e) {
  const job = S.jobs[e.job], t = Date.now(), c = tone(e, job, t);
  return h('button', { class: `ev ${c}`, id: 'ev-' + e.id, onclick: () => go('#/e/' + e.id) },
    h('span', { class: 'head' }, h('span', null, `${S.filter === 'all' ? e.job + ' · ' : ''}#${X.pad(e.no)} ${X.KINDS[e.kind]}`), h('span', null, `${X.span(t - Date.parse(e.at))} ago`)),
    h('span', { class: 'what' }, e.what),
    h('span', { class: `tag ${c}` }, flagText(e, job, t)));
}
function banners() {
  const out = [];
  const last = Number(ls.get('lastExport')) || 0;
  if (S.events.length && Date.now() - last > 7 * 864e5) {
    out.push(h('div', { class: 'banner info noprint' }, last ? `Last backup ${X.day(last)}` : 'Not backed up yet',
      h('p', null, 'These records live only on this phone. ', h('button', { class: 'link', onclick: () => go('#/backup') }, 'Export a backup'))));
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iP(hone|ad|od)/.test(navigator.userAgent) && !standalone && !ls.get('homeHint')) {
    const has = S.events.length || Object.keys(S.jobs).length;
    out.push(h('div', { class: 'banner info noprint' }, 'Add Extras to your Home Screen',
      h('p', null, 'In Safari tap Share, then Add to Home Screen. It opens with no signal, and its data is kept apart from Safari. ',
        has ? ['Records made here in Safari do not carry over: ', h('button', { class: 'link', onclick: () => go('#/backup') }, 'export a backup'), ' first, then import it in the Home Screen app. '] : null,
        h('button', { class: 'link', onclick: () => { ls.set('homeHint', '1'); render(); } }, 'Got it'))));
  }
  return out;
}
const stat = (n, label, cls) => h('div', { class: `stat ${cls || ''}` }, h('b', null, n), label);
function logScreen() {
  const jobs = Object.values(S.jobs).sort((a, b) => a.name.localeCompare(b.name));
  if (!jobs.length) return [title('Extras'), banners(),
    h('p', { class: 'sub' }, 'Log directed extra work and delays the moment they happen, send written notice inside the contract window, and track the change order. Everything stays on this phone.'),
    h('div', { class: 'card' }, h('h2', null, 'Start with a job'), jobForm(null)),
    h('p', null, 'New phone, or Safari cleared its data? ', h('button', { class: 'link', onclick: () => go('#/backup') }, 'Restore a backup first'))];
  if (S.filter !== 'all' && !S.jobs[S.filter]) S.filter = 'all';
  const t = Date.now();
  const list = S.events.filter(e => S.filter === 'all' || e.job === S.filter);
  const live = list.filter(e => X.status(e) !== 'void');
  const flags = live.map(e => X.flag(e, S.jobs[e.job], t));
  const count = f => flags.filter(x => x === f).length;
  const pending = live.filter(e => X.status(e) === 'co_submitted');
  const pendingSum = pending.reduce((s, e) => s + (e.coAmount || 0), 0);
  const open = live.filter(e => ['open', 'noticed', 'co_submitted'].includes(X.status(e))).length;
  const voids = list.length - live.length;
  const shown = X.byUrgency(S.showVoid ? list : live, S.jobs, t);
  const setFilter = f => { S.filter = f; ls.set('filter', f); render(); };
  return [
    h('div', { class: 'top noprint' }, h('div', { class: 'grow' }), h('button', { class: 'link', onclick: () => go('#/jobs') }, 'Jobs'), h('button', { class: 'link', onclick: () => go('#/backup') }, 'Backup')),
    title('Extras'),
    banners(),
    h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Show job' }, chip('All jobs', S.filter === 'all', () => setFilter('all')), jobs.map(j => chip(j.name, S.filter === j.name, () => setFilter(j.name)))),
    h('div', { class: 'stats' },
      stat(count('late'), 'past the notice window', count('late') ? 'late' : ''),
      stat(count('soon'), 'notice due within 24 h', count('soon') ? 'soon' : ''),
      stat(open, 'open'),
      stat(pending.length, `CO${pending.length === 1 ? '' : 's'} awaiting a decision${pendingSum ? ` (${X.usd(pendingSum)})` : ''}`)),
    count('unset') ? h('p', { class: 'hint' }, `${count('unset')} with no notice window set. `, h('button', { class: 'link', onclick: () => go('#/jobs') }, 'Set it in Jobs')) : null,
    count('rejected') ? h('p', { class: 'hint' }, `${count('rejected')} rejected CO${count('rejected') > 1 ? 's' : ''}: decide whether to dispute. Subcontracts often set a deadline for that.`) : null,
    h('div', { class: 'row noprint', style: 'margin: 0 0 14px' }, h('button', { onclick: () => copy((S.filter === 'all' ? jobs : [S.jobs[S.filter]]).map(j => X.fridayLine(S.events, j, Date.now())).join('\n'), 'Friday line') }, S.filter === 'all' ? 'Copy Friday lines' : 'Copy Friday line')),
    shown.length ? shown.map(evCard) : h('p', { class: 'empty' }, 'Nothing logged yet. Tap New extra when the GC directs work or something holds you up.'),
    voids ? h('button', { class: 'link noprint', onclick: () => { S.showVoid = !S.showVoid; render(); } }, S.showVoid ? 'Hide void items' : `Show ${voids} void item${voids > 1 ? 's' : ''}`) : null,
    h('button', { class: 'primary fab noprint', onclick: () => go('#/new') }, '+ New extra'),
  ];
}

// ---------- jobs
function jobForm(job) {
  const err = errBox();
  const used = job && S.events.some(e => e.job === job.name);
  const name = h('input', { value: job?.name || '', required: true, maxLength: 120, autocomplete: 'off', readOnly: !!used });
  const days = h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 365, step: 1, value: job?.noticeDays ?? '' });
  const clause = h('input', { value: job?.clauseRef || '', maxLength: 200, autocomplete: 'off', placeholder: 'e.g. Subcontract 7.2' });
  async function submit(ev) {
    ev.preventDefault();
    const n = name.value.trim(), dv = days.value.trim(), d = dv === '' ? null : Number(dv);
    if (!n) return void (err.textContent = 'Give the job a name.');
    if (used && n !== job.name) return void (err.textContent = 'This job has items, so its name is fixed. The window and clause can still change.');
    if (d !== null && !(Number.isInteger(d) && d >= 0 && d <= 365)) return void (err.textContent = 'The notice window is a whole number of days (0 to 365), or blank.');
    if (n !== job?.name && S.jobs[n]) return void (err.textContent = 'There is already a job with that name.');
    const j = { name: n, noticeDays: d, clauseRef: clause.value.trim(), updatedAt: now() };
    await write({ jobs: [j], dropJobs: job && n !== job.name ? [job.name] : [] });
    if (job) delete S.jobs[job.name];
    S.jobs[n] = j;
    if (S.filter === job?.name) S.filter = n;
    persist();
    toast(job ? 'Job saved' : 'Job added');
    render();
  }
  async function remove() {
    if (!confirm(`Remove ${job.name}? It has no items.`)) return;
    await write({ dropJobs: [job.name] });
    delete S.jobs[job.name];
    render();
  }
  return h('form', { onsubmit: submit, novalidate: true },
    field('Job name', name, used ? 'Fixed once the job has items: notices already went out under it.' : null),
    field('Notice window, in calendar days', days, 'The shortest notice period anywhere in this subcontract (changes, delays, claims, concealed conditions). Leave it blank until you have read it: the log says "not set" instead of guessing. Use 0 for "before proceeding".'),
    field('Clause reference (optional)', clause, 'Printed at the end of each notice.'),
    err,
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, job ? 'Save job' : 'Add job'),
      job && !used ? h('button', { type: 'button', class: 'danger', onclick: remove }, 'Remove') : null));
}
function jobsScreen() {
  const jobs = Object.values(S.jobs).sort((a, b) => a.name.localeCompare(b.name));
  return [back(), title('Jobs'), h('p', { class: 'sub' }, 'Each job keeps its own numbering and notice window.'),
    jobs.map(j => h('div', { class: 'card' },
      h('p', { class: 'hint' }, X.fridayLine(S.events, j, Date.now())),
      h('div', { class: 'row noprint', style: 'margin: 0 0 12px' }, h('button', { type: 'button', onclick: () => copy(X.fridayLine(S.events, j, Date.now()), 'Friday line') }, 'Copy Friday line')),
      jobForm(j))),
    h('div', { class: 'card' }, h('h2', null, 'Add a job'), jobForm(null))];
}

// ---------- new / edit
const LINES = {
  labor: { add: 'Add labor', cls: 'line', blank: () => ({ who: '', st: '', ot: '' }), cols: [['who', 'Who'], ['st', 'Reg h', 1], ['ot', 'OT h', 1]] },
  material: { add: 'Add material', cls: 'line two', blank: () => ({ qty: '', item: '' }), cols: [['qty', 'Qty', 1], ['item', 'Item']] },
  equipment: { add: 'Add equipment', cls: 'line eq', blank: () => ({ item: '', hrs: '' }), cols: [['item', 'Equipment'], ['hrs', 'Hours', 1]] },
};
function linesEditor(list, kind, dirty) {
  const cfg = LINES[kind], box = h('div', { class: 'lines' });
  const draw = focusLast => {
    box.replaceChildren(...list.map((r, i) => h('div', { class: cfg.cls },
      cfg.cols.map(([k, label, num]) => {
        const id = nid();
        return h('div', null, h('label', { for: id }, label), h('input', { id, value: r[k] ?? '', inputMode: num ? 'decimal' : 'text', autocomplete: 'off', oninput: e => { r[k] = e.target.value; dirty(); } }));
      }),
      h('button', { type: 'button', 'aria-label': `Remove ${kind} line ${i + 1}`, onclick: () => { list.splice(i, 1); dirty(); draw(); } }, '×'))),
    h('button', { type: 'button', onclick: () => { list.push(cfg.blank()); dirty(); draw(true); } }, cfg.add));
    if (focusLast) box.querySelectorAll('input')[box.querySelectorAll('input').length - cfg.cols.length]?.focus();
  };
  draw();
  return box;
}
function cleanLines(list, kind) {
  const out = [];
  for (const r of list) {
    const vals = LINES[kind].cols.map(([k]) => String(r[k] ?? '').trim());
    if (vals.every(v => !v)) continue;
    const row = {};
    for (const [k, , num] of LINES[kind].cols) {
      const v = String(r[k] ?? '').trim();
      if (num) { const n = v === '' ? 0 : Number(v.replace(',', '.')); if (!(Number.isFinite(n) && n >= 0)) throw new Error(`"${v}" is not a number of hours or a quantity.`); row[k] = n; }
      else row[k] = v;
    }
    if (kind !== 'labor' && !row.item) throw new Error(`Each ${kind} line needs an item.`);
    out.push(row);
  }
  return out;
}
// Phone photos are 3 to 12 MB; 1600 px at JPEG 0.7 keeps a T&M ticket readable at a few hundred KB.
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = h('canvas', { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } finally { URL.revokeObjectURL(url); }
}
function formScreen(id) {
  const old = id ? findEv(id) : null;
  if (id && !old) return missing();
  if (old && X.status(old) === 'void') { go('#/e/' + id, true); return null; }
  const jobs = Object.values(S.jobs).sort((a, b) => a.name.localeCompare(b.name));
  if (!jobs.length) { go('#/', true); return null; }
  const lock = !!old && !X.canEdit(old, 'what'); // signed or refused: the description is fixed, quantities are not
  let draft = null;
  if (!old) try { draft = JSON.parse(ls.get('draft') || 'null'); } catch { /* ignore a bad draft */ }
  // With several jobs and no filter, he picks the job every time: yesterday's job is the wrong default on a new site.
  const pick = S.filter !== 'all' ? S.filter : jobs.length === 1 ? jobs[0].name : '';
  const f = old ? structuredClone(old) : { job: pick, kind: '', at: now(), byRole: '', byName: '', area: '', what: '', refs: '', labor: [], material: [], equipment: [], ...(draft || {}) };
  if (!S.jobs[f.job]) f.job = pick;
  f.photos = old ? [...old.photos] : [];
  const added = new Set(), removed = new Set();
  let saving = false, dirtyFlag = false, gone = false, timer, busy = Promise.resolve();
  const dirty = () => {
    dirtyFlag = true;
    if (old) return;
    clearTimeout(timer); // a call or a dropped app should not cost the words he dictated
    timer = setTimeout(() => ls.set('draft', JSON.stringify({ job: f.job, kind: f.kind, at: f.at, byRole: f.byRole, byName: f.byName, area: f.area, what: f.what, refs: f.refs, labor: f.labor, material: f.material, equipment: f.equipment })), 300);
  };
  const err = errBox();
  const pressed = (box, val) => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === val)));

  const jobBox = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Job' }, jobs.map(j => h('button', { type: 'button', 'data-v': j.name, 'aria-pressed': String(f.job === j.name), onclick: () => { f.job = j.name; pressed(jobBox, j.name); dirty(); } }, j.name)));
  const kindBox = h('div', { class: 'kinds', role: 'group', 'aria-label': 'Kind of change' }, Object.entries(X.KINDS).map(([k, label]) => h('button', { type: 'button', disabled: lock, 'data-v': k, 'aria-pressed': String(f.kind === k), onclick: () => { f.kind = k; pressed(kindBox, k); dirty(); } }, label)));
  const nameLabel = () => f.byRole === X.RELAYED ? "Your foreman's name" : 'Name (optional)';
  const roleBox = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Role' }, X.ROLES.map(r => h('button', { type: 'button', disabled: lock, 'data-v': r, 'aria-pressed': String(f.byRole === r), onclick: () => { f.byRole = f.byRole === r ? '' : r; pressed(roleBox, f.byRole); nameField.querySelector('label').textContent = nameLabel(); dirty(); } }, r)));
  const at = h('input', { type: 'datetime-local', disabled: lock, value: localInput(f.at), onchange: e => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) f.at = d.toISOString(); dirty(); } });
  const text = (k, props = {}) => h(props.rows ? 'textarea' : 'input', { value: f[k] || '', readOnly: lock, autocomplete: 'off', oninput: e => { f[k] = e.target.value; dirty(); }, ...props });
  const nameField = field(nameLabel(), text('byName', { maxLength: 120 }));

  const photoBox = h('div', { class: 'photos' });
  const photoNote = h('p', { class: 'hint', role: 'status' });
  const camBtn = h('button', { type: 'button', onclick: () => cam.click() }, 'Take photo');
  const libBtn = h('button', { type: 'button', onclick: () => lib.click() }, 'Choose photo');
  const drawPhotos = () => {
    photoBox.replaceChildren(...f.photos.map((pid, i) => {
      const img = h('img', { alt: `Photo ${i + 1}` });
      photo(pid).then(src => { if (src) img.src = src; });
      return h('figure', null, img, h('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => {
        f.photos = f.photos.filter(x => x !== pid);
        if (added.delete(pid)) S.photos.delete(pid); else removed.add(pid);
        dirtyFlag = true; drawPhotos();
      } }, 'Remove'));
    }));
    camBtn.disabled = libBtn.disabled = f.photos.length >= 4;
  };
  const takeFiles = async files => {
    for (const file of files.slice(0, 4 - f.photos.length)) {
      try { const pid = crypto.randomUUID(); S.photos.set(pid, await shrink(file)); added.add(pid); f.photos.push(pid); drawPhotos(); }
      catch { toast('That photo could not be read.'); }
    }
    dirtyFlag = true;
  };
  // Copy the files before clearing the input, and queue the work: Save waits for every photo still shrinking.
  const onPick = e => {
    const files = [...e.target.files]; e.target.value = '';
    photoNote.textContent = 'Adding photos…';
    busy = busy.then(() => takeFiles(files)).finally(() => { photoNote.textContent = ''; });
  };
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: onPick });
  const lib = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: onPick });
  drawPhotos();

  async function save() {
    if (saving) return;
    saving = true; err.textContent = '';
    try {
      await busy;
      if (gone) return; // he discarded the entry while photos were still being added
      if (!f.job) throw new Error('Pick the job.');
      if (!f.kind) throw new Error('Pick what kind of change this is.');
      if (!f.what.trim()) throw new Error('Say what changed. Tap the microphone on the keyboard to dictate.');
      if (Number.isNaN(Date.parse(f.at))) throw new Error('Enter when it happened.');
      const lines = { labor: cleanLines(f.labor, 'labor'), material: cleanLines(f.material, 'material'), equipment: cleanLines(f.equipment, 'equipment') };
      const t = now();
      const base = old || { id: crypto.randomUUID(), job: f.job, no: X.nextNo(S.events, f.job), sig: null, noticeSentAt: null, noticeText: null, coNo: '', coAmount: null, coSubmittedAt: null, decision: null, decidedAt: null, voidedAt: null, voidReason: '', replaces: null, createdAt: t };
      const desc = lock ? {} : { kind: f.kind, at: f.at, byRole: f.byRole, byName: f.byName.trim(), area: f.area.trim(), what: f.what.trim(), refs: f.refs.trim() };
      const ev = { ...base, ...desc, ...lines, photos: [...f.photos], updatedAt: t };
      if (!X.validEvent({ ...ev, photos: [] })) throw new Error('A field is too long. Shorten it and save again.');
      await saveEv(ev, { photos: [...added].map(pid => ({ id: pid, data: S.photos.get(pid) })), dropPhotos: [...removed] });
      removed.forEach(pid => S.photos.delete(pid));
      clearTimeout(timer);
      if (!old) ls.set('draft', null);
      go('#/e/' + ev.id, true);
      toast(old ? 'Saved' : `Saved as #${X.pad(ev.no)}`);
    } catch (e) {
      saving = false;
      err.textContent = e.message || 'Could not save.';
    }
  }
  function cancel() {
    if (dirtyFlag && !confirm('Discard this entry?')) return;
    gone = true;
    clearTimeout(timer);
    if (!old) ls.set('draft', null);
    added.forEach(pid => S.photos.delete(pid));
    go(old ? '#/e/' + old.id : '#/', true);
  }
  const anyLines = f.labor.length || f.material.length || f.equipment.length;
  return [
    h('div', { class: 'top noprint' }, h('button', { class: 'link', type: 'button', onclick: cancel }, old ? '‹ Back to the item' : '‹ All extras')),
    title(old ? `Edit #${X.pad(old.no)}` : 'New extra'),
    draft ? h('div', { class: 'banner info noprint' }, 'Picked up your unsaved entry', h('p', null, 'Photos are not kept in a draft. ',
      h('button', { class: 'link', type: 'button', onclick: () => { if (confirm('Clear the unsaved entry?')) { ls.set('draft', null); render(); } } }, 'Start over'))) : null,
    lock ? h('div', { class: 'banner info' }, old.sig.refused ? 'Refusal recorded: the description is fixed' : 'Signed: the description is fixed',
      h('p', null, 'Hours, material, equipment and photos can still be added. The signature keeps a copy of what the rep was shown.')) : null,
    h('form', { onsubmit: e => { e.preventDefault(); save(); }, novalidate: true },
      old ? h('p', { class: 'sub' }, old.job) : h('div', { class: 'field' }, h('label', null, 'Job'), jobBox),
      h('div', { class: 'field' }, h('label', null, 'What kind'), kindBox),
      field('When it was directed or happened', at),
      h('div', { class: 'field' }, h('label', null, 'Who directed it'),
        h('p', { class: 'hint' }, "For a delay: who you raised it with. If your foreman passed the direction on, pick Our foreman (relayed), enter your foreman's name, and say who gave him the direction in What changed. The notice then credits the GC."),
        roleBox, h('div', { style: 'margin-top: 8px' }, nameField)),
      field('Where', text('area', { placeholder: 'Level, area, room, gridline', maxLength: 200 })),
      field('What changed', text('what', { rows: 4, maxLength: 5000, placeholder: 'What you were told to do, or what held you up' }), lock ? null : 'Tap the microphone on the keyboard to dictate.'),
      field('References', text('refs', { placeholder: 'RFI, ASI, drawing, paper T&M ticket number', maxLength: 300 })),
      h('details', { class: 'field', open: !!anyLines || lock }, h('summary', null, 'Labor, material, equipment'),
        h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Record hours and material as they happen. No pricing here: price it in the office.'),
          linesEditor(f.labor, 'labor', dirty), linesEditor(f.material, 'material', dirty), linesEditor(f.equipment, 'equipment', dirty))),
      h('div', { class: 'field' }, h('label', null, 'Photos (up to 4)'), h('p', { class: 'hint' }, 'The work, the condition, or the paper T&M ticket.'), h('div', { class: 'row' }, camBtn, libBtn), cam, lib, photoNote, photoBox),
      bar(err, h('button', { type: 'button', onclick: cancel }, 'Cancel'), h('button', { class: 'primary', type: 'submit' }, 'Save'))),
  ];
}

// ---------- detail
function sigSvg(sig) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1 0.5'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Signature of ${sig.name}`);
  for (const l of sig.strokes) {
    if (l.length < 4) continue;
    const p = document.createElementNS(NS, 'polyline');
    const pts = []; for (let i = 0; i + 1 < l.length; i += 2) pts.push(`${l[i]},${l[i + 1]}`);
    for (const [k, v] of Object.entries({ points: pts.join(' '), fill: 'none', stroke: '#111', 'stroke-width': '0.006', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
    svg.append(p);
  }
  return svg;
}
function sigPng(sig) {
  const c = h('canvas', { width: 1000, height: 500 }), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 500);
  x.strokeStyle = '#111'; x.lineWidth = 6; x.lineCap = x.lineJoin = 'round';
  for (const l of sig.strokes) { x.beginPath(); for (let i = 0; i + 1 < l.length; i += 2) x[i ? 'lineTo' : 'moveTo'](l[i] * 1000, l[i + 1] * 1000); x.stroke(); }
  return c.toDataURL('image/png');
}
function dataFile(url, name) {
  const [head, b64] = url.split(','), type = head.slice(5, head.indexOf(';'));
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
const mailto = (subject, body) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;

async function shareRecord(e, job) {
  // Built synchronously from what the screen already loaded: Safari only allows the share sheet right after
  // a tap, and waiting on storage first can lose that permission.
  const text = X.record(e, job), name = `${e.job} item ${X.pad(e.no)}`, base = `${slug(e.job)}-${X.pad(e.no)}`;
  const photos = e.photos.map(pid => S.photos.get(pid));
  if (photos.some(p => !p)) return toast('A photo could not be loaded. Reopen this item or restore its backup before sharing.');
  const files = photos.map((data, i) => dataFile(data, `${base}-photo-${i + 1}.jpg`));
  if (e.sig && !e.sig.refused) files.push(dataFile(sigPng(e.sig), `${base}-signature.png`));
  try {
    if (files.length) {
      if (!navigator.share || !navigator.canShare?.({ files })) return toast('This browser cannot share the attachments. Use Print or PDF to include them.');
      await navigator.share({ title: name, text, files });
    }
    else if (navigator.share) await navigator.share({ title: name, text });
    else await copy(text, 'Record');
  } catch (err) {
    if (err.name !== 'AbortError') {
      if (files.length) toast('The attachments were not shared. Try again, or use Print or PDF to include them.');
      else await copy(text, 'Record');
    }
  }
}
async function sendNotice(e, job) {
  const { subject, body } = X.notice(e, job);
  const done = () => { S.shared = { id: e.id, text: `${subject}\n\n${body}` }; render(); toast('Once it has left your Outbox, tap Mark notice sent.'); };
  if (navigator.share) {
    try { await navigator.share({ title: subject, text: `${subject}\n\n${body}` }); done(); }
    catch (err) { if (err.name !== 'AbortError') { location.href = mailto(subject, body); done(); } }
  } else { location.href = mailto(subject, body); done(); }
}
async function update(e, patch, msg) {
  await saveEv({ ...e, ...patch });
  if (msg) toast(msg);
  render();
}
const confirmed = (q, fn) => () => { if (confirm(q)) fn(); };
// Deadline readings are his own analysis: shown on screen, never printed into a record that can reach the GC.
function statusBanner(e, job, t) {
  const f = X.flag(e, job, t), d = X.deadline(e, job), s = X.status(e), late = s !== 'approved' && X.lateBy(e, job);
  if (f === 'late') return h('div', { class: 'banner late noprint' }, `Notice overdue by ${X.span(t - d)}`, h('p', null, `It was due ${X.when(d)}. Send it now; a late notice is still better than none.`));
  if (f === 'soon') return h('div', { class: 'banner soon noprint' }, `Notice due in ${X.span(d - t)}`, h('p', null, `Due ${X.when(d)}.`));
  if (f === 'ok') return h('div', { class: 'banner ok noprint' }, `Notice due ${X.when(d)}`, h('p', null, `${job.noticeDays} day window for ${job.name}.`));
  if (f === 'unset') return h('div', { class: 'banner unset noprint' }, 'No notice window set for this job', h('p', null, 'Read the subcontract, then ', h('button', { class: 'link', onclick: () => go('#/jobs') }, 'set it in Jobs'), '.'));
  if (s === 'void') {
    const next = S.events.find(x => x.replaces === e.id);
    return h('div', { class: 'banner void' }, `Void: ${e.voidReason}`, next ? h('p', { class: 'noprint' }, h('button', { class: 'link', onclick: () => go('#/e/' + next.id) }, `Corrected as #${X.pad(next.no)}`)) : null);
  }
  if (f === 'rejected') return h('div', { class: 'banner late noprint' }, `CO rejected ${X.day(e.decidedAt)}`, h('p', null, 'Decide whether to dispute it. Subcontracts often set a deadline for disputing a denial.'));
  const what = { noticed: `Notice sent ${X.when(e.noticeSentAt)}`, co_submitted: `CO submitted ${X.day(e.coSubmittedAt)}`, approved: `CO approved ${X.day(e.decidedAt)}` }[s];
  return h('div', { class: `banner ${late ? 'late' : 'done'} noprint` }, what, late ? h('p', null, `The first written notice went out ${X.span(late)} after the window. Keep proof of when the GC learned of it.`) : null);
}
function detailScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  const job = S.jobs[e.job], t = Date.now(), s = X.status(e), live = s !== 'void', w = X.who(e);
  const prev = e.replaces && findEv(e.replaces);
  const pendingPhotos = [];
  const photos = h('div', { class: 'photos' }, e.photos.map((pid, i) => {
    const img = h('img', { alt: `Photo ${i + 1} of item ${X.pad(e.no)}` });
    pendingPhotos.push(photo(pid).then(src => { if (src) img.src = src; return src; }));
    return h('figure', null, img);
  }));
  const share = h('button', { disabled: !!e.photos.length, onclick: () => shareRecord(e, job) }, 'Share record');
  const photoState = h('p', { class: 'hint', role: 'status' }, e.photos.length ? 'Loading photos before sharing…' : '');
  if (pendingPhotos.length) Promise.all(pendingPhotos).then(loaded => {
    if (loaded.some(p => !p)) { photoState.textContent = 'A photo is missing. Restore its backup, or edit this item to remove the missing photo before sharing.'; return; }
    share.disabled = false; photoState.textContent = '';
  }).catch(() => { photoState.textContent = 'Photos could not be loaded. Reopen this item before sharing.'; });
  const changedSince = X.addedSince(e);
  const record = h('div', { class: 'card' }, h('h2', null, 'Record'),
    h('dl', null, dtdd('When', X.when(e.at)), w && dtdd(w.label, w.text), dtdd('Where', e.area), dtdd('What changed', e.what), dtdd('References', e.refs)),
    table(['Labor', 'Reg h', 'OT h'], (e.labor || []).map(r => [r.who || 'Unnamed', r.st, r.ot])),
    table(['Qty', 'Material'], (e.material || []).map(r => [r.qty, r.item])),
    table(['Equipment', 'Hours'], (e.equipment || []).map(r => [r.item, r.hrs])),
    e.photos.length ? photos : null,
    e.sig ? h('div', { class: 'sig', style: 'margin-top: 14px' },
      e.sig.text ? h('p', null, h('b', null, e.sig.text)) : null,
      e.sig.refused ? h('p', null, h('b', null, 'Rep would not sign. '), `${e.sig.reason || 'No reason given'}. ${X.when(e.sig.at)}`)
        : [sigSvg(e.sig), h('p', null, `Signed by ${e.sig.name}, ${X.when(e.sig.at)}`)],
      changedSince ? [h('p', { class: 'hint' }, 'Hours, material or equipment were added after this. What the rep was shown:'), h('pre', null, e.sig.shown)] : null) : null);

  const sigCard = live && !e.sig ? h('div', { class: 'card noprint' }, h('h2', null, 'Signature (optional)'),
    h('p', null, "Have the GC's rep sign on this screen, or record that they would not. Either one fixes the description; hours and photos can still be added."),
    h('div', { class: 'row' }, h('button', { onclick: () => go(`#/e/${e.id}/sign`) }, 'Get signature'), h('button', { onclick: () => go(`#/e/${e.id}/refuse`) }, 'Rep would not sign'))) : null;

  let noticeCard = null;
  if (live && e.noticeSentAt) {
    noticeCard = h('div', { class: 'card' }, h('h2', null, 'Written notice'), h('p', null, `Sent ${X.when(e.noticeSentAt)}.`),
      e.noticeText ? h('details', { class: 'noprint' }, h('summary', null, 'Text as sent'), h('pre', null, e.noticeText)) : null,
      h('button', { class: 'link noprint', onclick: confirmed('Clear the sent time and the text as sent? They cannot be restored.', () => update(e, { noticeSentAt: null, noticeText: null }, 'Marked not sent')) }, 'Undo: it did not go out'));
  } else if (live) {
    const err = errBox();
    const key = e.id + ':sent', sentAt = whenInput(key);
    const mark = () => {
      const v = whenValue(key);
      if (Number.isNaN(v.getTime())) return void (err.textContent = 'Enter when it was sent.');
      if (v - Date.now() > 6e4) return void (err.textContent = 'The sent time cannot be in the future.');
      const n = X.notice(e, job), text = S.shared?.id === e.id ? S.shared.text : `${n.subject}\n\n${n.body}`; // the words he actually sent
      S.shared = null; delete S.typed[key];
      update(e, { noticeSentAt: v.toISOString(), noticeText: text }, 'Notice marked sent');
    };
    noticeCard = h('div', { class: 'card noprint' }, h('h2', null, 'Written notice'),
      h('p', null, 'Send it from your work email so it lands in the company record. It covers the event, the cause, the impact (to be determined) and a reservation of rights.'),
      h('div', { class: 'row' },
        h('button', { class: S.shared?.id === e.id ? '' : 'primary', onclick: () => sendNotice(e, job) }, 'Send notice'),
        h('button', { onclick: () => { const n = X.notice(e, job), text = `${n.subject}\n\n${n.body}`; copy(text, 'Notice'); S.shared = { id: e.id, text }; render(); } }, 'Copy text')),
      h('div', { style: 'margin-top: 14px' }, field('Sent at', sentAt, 'When it actually left your Outbox. Change it if you sent it earlier.')), err,
      h('button', { class: S.shared?.id === e.id ? 'primary' : '', onclick: mark }, 'Mark notice sent'));
  }

  let coCard = null;
  if (live && !e.coSubmittedAt) {
    const err = errBox();
    const no = h('input', { value: e.coNo || '', maxLength: 40, autocomplete: 'off' });
    const amt = h('input', { inputMode: 'decimal', autocomplete: 'off', value: e.coAmount ?? '', placeholder: '$' });
    const key = e.id + ':co', on = whenInput(key);
    coCard = h('div', { class: 'card noprint' }, h('h2', null, 'Change order'), h('p', { class: 'hint' }, 'After the office prices it and it goes to the GC.'),
      field('CO number', no), field('Amount submitted', amt), field('Submitted at', on, 'When it went to the GC. A CO request counts as written notice.'), err,
      h('button', { onclick: () => {
        const a = money(amt.value), v = whenValue(key);
        if (Number.isNaN(a)) return void (err.textContent = 'Enter the amount as a number, like 4500 or 4,500.50.');
        if (Number.isNaN(v.getTime())) return void (err.textContent = 'Enter when it was submitted.');
        if (v - Date.now() > 6e4) return void (err.textContent = 'The submitted time cannot be in the future.');
        delete S.typed[key];
        update(e, { coNo: no.value.trim(), coAmount: a, coSubmittedAt: v.toISOString() }, 'CO marked submitted');
      } }, 'Mark CO submitted'));
  } else if (live) {
    const decided = h('input', { type: 'date', value: localInput(now()).slice(0, 10) });
    const decide = (decision, msg) => decided.value ? update(e, { decision, decidedAt: new Date(`${decided.value}T12:00`).toISOString() }, msg) : toast('Enter the date of the decision.');
    coCard = h('div', { class: 'card' }, h('h2', null, 'Change order'),
      h('p', null, `CO ${e.coNo || '(no number)'}${e.coAmount != null ? `, ${X.usd(e.coAmount)}` : ''}, submitted ${X.day(e.coSubmittedAt)}.`),
      e.decision ? [h('p', null, `${X.STATUS[e.decision]} ${X.day(e.decidedAt)}.`),
        h('button', { class: 'link noprint', onclick: confirmed('Clear the decision and its date?', () => update(e, { decision: null, decidedAt: null })) }, 'Undo the decision')]
        : [field('Decided on', decided, 'The date on the GC\'s answer.'), h('div', { class: 'row noprint' },
          h('button', { onclick: () => decide('approved', 'Marked approved') }, 'Approved'),
          h('button', { onclick: () => decide('rejected', 'Marked rejected') }, 'Rejected'),
          h('button', { class: 'link', onclick: confirmed('Clear the submitted date?', () => update(e, { coSubmittedAt: null }, 'Submission undone')) }, 'Undo submission'))]);
  }

  const actions = h('div', { class: 'card noprint' }, h('h2', null, 'Share and fix'),
    h('div', { class: 'row' },
      share,
      h('button', { onclick: () => window.print() }, 'Print or PDF'),
      live && s === 'open' ? h('button', { onclick: () => copy(X.todoistLine(e, job, Date.now()), 'Todoist reminder') }, 'Copy Todoist reminder') : null,
      live ? h('button', { onclick: () => go(`#/e/${e.id}/edit`) }, e.sig ? 'Add hours or photos' : 'Edit') : null,
      live ? h('button', { class: 'danger', onclick: () => go(`#/e/${e.id}/void`) }, e.sig ? 'Void and re-issue' : 'Void') : null),
    e.photos.length ? photoState : null);

  // Until notice is out, sending it is the job: it comes first.
  const body = s === 'open' ? [noticeCard, record, sigCard] : [record, sigCard, noticeCard];
  return [back(), title(`#${X.pad(e.no)} ${X.KINDS[e.kind]}`),
    h('p', { class: 'sub' }, e.job, prev ? [' · corrects ', h('button', { class: 'link', onclick: () => go('#/e/' + prev.id) }, `#${X.pad(prev.no)}`)] : null),
    statusBanner(e, job, t), body, coCard, actions];
}

// ---------- signature, refusal, void
function signScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  if (!X.canEdit(e, 'what')) { go('#/e/' + id, true); return null; }
  const strokes = [];
  let cur = null;
  const pad = h('canvas', { class: 'pad', 'aria-label': 'Signature area. Sign with a finger.' });
  const name = h('input', { autocomplete: 'off', maxLength: 120, autocapitalize: 'words' });
  const err = errBox();
  const words = X.ack(e.kind), shown = X.facts(e);
  const draw = () => {
    const c = pad.getContext('2d'), w = pad.width;
    c.clearRect(0, 0, w, pad.height);
    c.strokeStyle = '#111'; c.lineWidth = 2.5 * devicePixelRatio; c.lineCap = c.lineJoin = 'round';
    for (const l of strokes) { c.beginPath(); for (let i = 0; i + 1 < l.length; i += 2) c[i ? 'lineTo' : 'moveTo'](l[i] * w, l[i + 1] * w); c.stroke(); }
  };
  const add = ev => {
    const r = pad.getBoundingClientRect(), clamp = v => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
    cur.push(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.width)); // both by width: keeps the shape
  };
  pad.addEventListener('pointerdown', ev => { ev.preventDefault(); pad.setPointerCapture(ev.pointerId); cur = []; strokes.push(cur); add(ev); draw(); });
  pad.addEventListener('pointermove', ev => { if (cur) { add(ev); draw(); } });
  for (const t of ['pointerup', 'pointercancel']) pad.addEventListener(t, () => { cur = null; });
  // Sized to the screen now and again on rotation (a rep often turns the phone sideways to sign).
  const size = () => {
    if (!pad.isConnected) return removeEventListener('resize', size);
    const w = pad.clientWidth, hgt = Math.round(Math.min(220, w * 0.45));
    pad.style.height = hgt + 'px'; pad.width = Math.round(w * devicePixelRatio); pad.height = Math.round(hgt * devicePixelRatio);
    draw();
  };
  S.mount.push(size);
  addEventListener('resize', size);
  return [back('#/e/' + id, '‹ Back to the item'), title('Signature'),
    h('div', { class: 'card' }, h('p', null, h('b', null, words)), h('pre', null, shown)),
    field('Printed name', name),
    h('div', { class: 'field' }, h('label', null, 'Sign here'), pad, h('button', { type: 'button', class: 'link', onclick: () => { strokes.length = 0; draw(); } }, 'Clear')),
    bar(err, h('button', { onclick: () => go('#/e/' + id, true) }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const n = name.value.trim(), lines = strokes.filter(l => l.length >= 4);
        if (!n) return void (err.textContent = 'Print the name of the person signing.');
        if (!lines.length) return void (err.textContent = 'Sign in the box.');
        await saveEv({ ...e, sig: { name: n, at: now(), strokes: lines, text: words, shown } });
        go('#/e/' + id, true); toast('Signed');
      } }, 'Save signature'))];
}
function refuseScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  if (!X.canEdit(e, 'what')) { go('#/e/' + id, true); return null; }
  const reason = h('input', { maxLength: 300, autocomplete: 'off', placeholder: 'e.g. said to send it to the GC PM' });
  return [back('#/e/' + id, '‹ Back to the item'), title('Rep would not sign'),
    h('p', { class: 'sub' }, 'This records that you asked, and when, and fixes the description. Hours, material and photos can still be added. The written notice matters more than a signature: send it either way.'),
    field('What they said (optional)', reason),
    bar(null, h('button', { onclick: () => go('#/e/' + id, true) }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => { await saveEv({ ...e, sig: { refused: true, reason: reason.value.trim(), at: now(), shown: X.facts(e) } }); go('#/e/' + id, true); toast('Recorded'); } }, 'Record refusal'))];
}
function voidScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  if (X.status(e) === 'void') { go('#/e/' + id, true); return null; }
  const reason = h('input', { maxLength: 300, autocomplete: 'off', placeholder: 'e.g. wrong level, duplicate' });
  const again = h('input', { type: 'checkbox', checked: !!e.sig, style: 'width: 22px; min-height: 22px; margin-right: 10px' });
  const err = errBox();
  let busy = false;
  return [back('#/e/' + id, '‹ Back to the item'), title(`Void #${X.pad(e.no)}`),
    h('p', { class: 'sub' }, 'Nothing is deleted. The item stays in the log as void, with its number and your reason.'),
    field('Reason', reason),
    h('label', { style: 'display: flex; align-items: center; font-weight: 500; min-height: 44px' }, again, 'Make a corrected copy with the next number'),
    bar(err, h('button', { onclick: () => go('#/e/' + id, true) }, 'Cancel'),
      h('button', { class: 'primary danger', onclick: async () => {
        const r = reason.value.trim();
        if (!r) return void (err.textContent = 'Say why, so the log explains the gap.');
        if (busy) return;
        busy = true; err.textContent = '';
        try {
          if (!again.checked) { await saveEv({ ...e, voidedAt: now(), voidReason: r }); go('#/e/' + id, true); toast('Voided'); return; }
          const { voided, fresh } = X.reissue(e, S.events, r, crypto.randomUUID());
          const copies = [];
          for (const pid of e.photos) { const data = await photo(pid); if (data) copies.push({ id: crypto.randomUUID(), data }); }
          fresh.photos = copies.map(p => p.id); // the copy owns its photos, so editing it never touches the void original
          await write({ events: [voided, fresh], photos: copies });
          copies.forEach(p => S.photos.set(p.id, p.data));
          S.events = [...S.events.filter(x => x.id !== e.id), voided, fresh];
          go(`#/e/${fresh.id}/edit`, true); toast(`Corrected copy is #${X.pad(fresh.no)}`);
        } catch (x) { err.textContent = x?.message || 'Could not save on this phone.'; } finally { busy = false; }
      } }, 'Void'))];
}

// ---------- backup
function backupScreen() {
  const last = Number(ls.get('lastExport')) || 0;
  const status = h('p', { class: 'hint' });
  const result = h('p', { role: 'status' });
  let file = null;
  const saveBtn = h('button', { class: 'primary', hidden: true, onclick: async () => {
    // A separate tap: the share sheet must open straight from a tap, and building the file can take a moment.
    const mark = () => { ls.set('lastExport', String(Date.now())); result.textContent = `Backup saved: ${file.name}`; };
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: file.name }); mark(); return; }
    } catch (err) { if (err.name === 'AbortError') return; }
    const a = h('a', { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    mark();
  } }, 'Save backup file');
  const prep = h('button', { onclick: async () => {
    prep.disabled = true; result.textContent = 'Preparing…';
    try {
      const [jobs, events, photos] = await Promise.all([getAll('jobs'), getAll('events'), getAll('photos')]);
      const pm = new Map(photos.map(p => [p.id, p.data]));
      const data = { app: 'extras-log', version: 1, exportedAt: now(), jobs, events: events.map(e => ({ ...e, photos: e.photos.map(id => pm.get(id)).filter(Boolean) })) };
      file = new File([JSON.stringify(data)], `extras-log-${localInput(now()).slice(0, 10)}.json`, { type: 'application/json' });
      result.textContent = `${events.length} items, ${photos.length} photos, ${mb(file.size)}. Tap Save backup file and put it in Files or iCloud Drive.` +
        (file.size > MAX_BACKUP * 0.6 ? ` This is getting close to the ${mb(MAX_BACKUP)} a phone can restore; ask for per-job backups soon.` : '');
      saveBtn.hidden = false; saveBtn.focus();
    } catch (err) { result.textContent = `Could not prepare the backup: ${err.message}`; }
    prep.disabled = false;
  } }, 'Prepare backup');
  const pickIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    result.textContent = 'Reading…';
    try {
      if (f.size > MAX_BACKUP) throw new Error(`That file is over ${mb(MAX_BACKUP)}, too large for a phone to restore.`);
      const { jobs, events, dropped } = X.cleanImport(JSON.parse(await f.text()));
      const incoming = new Map(), photos = [];
      for (const e of events) {
        const ids = e.photos.map((data, i) => { const pid = `${e.id}-p${i}`; photos.push({ id: pid, data }); return pid; });
        incoming.set(e.id, { ...e, photos: ids });
      }
      const clash = X.clashes(S.events, [...incoming.values()]);
      const ev2 = X.merge(S.events, [...incoming.values()], 'id'), jb = X.merge(Object.values(S.jobs), jobs, 'name');
      const taken = ev2.list.filter(e => incoming.get(e.id) === e);
      const keep = new Set(taken.flatMap(e => e.photos));
      const drop = taken.flatMap(e => S.events.find(x => x.id === e.id)?.photos || []).filter(pid => !keep.has(pid));
      // A job made by hand on a fresh phone before the restore has no window yet: take the backup's.
      const fill = jobs.filter(j => !jb.list.includes(j) && j.noticeDays != null && S.jobs[j.name]?.noticeDays == null)
        .map(j => ({ ...S.jobs[j.name], noticeDays: j.noticeDays, clauseRef: S.jobs[j.name].clauseRef || j.clauseRef, updatedAt: now() }));
      const names = new Set(jb.list.map(j => j.name));
      const orphanJobs = [...new Set(taken.map(e => e.job))].filter(n => !names.has(n)).map(n => ({ name: n, noticeDays: null, clauseRef: '', updatedAt: now() }));
      await write({ events: taken, photos: photos.filter(p => keep.has(p.id)), dropPhotos: drop, jobs: [...jb.list.filter(j => jobs.includes(j)), ...fill, ...orphanJobs] });
      await load(); S.photos.clear(); persist();
      result.textContent = `Imported. Items: ${ev2.added} new, ${ev2.updated} updated, ${ev2.kept} already up to date. Jobs: ${jb.added + orphanJobs.length} new, ${jb.updated} updated.` +
        (fill.length ? ` Notice window restored for ${fill.map(j => j.name).join(', ')}.` : '') +
        (dropped ? ` ${dropped} damaged rows skipped.` : '') +
        (clash.length ? ` Number clash: ${clash.join(', ')}. Two items share a number; void and re-issue the newer one so each number is used once.` : '');
    } catch (err) { result.textContent = err instanceof SyntaxError ? 'That file is not a readable backup.' : err.message; }
  } });
  S.mount.push(async () => {
    try {
      const [est, kept] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
      status.textContent = `${est ? `Using ${mb(est.usage)} on this phone. ` : ''}${kept ? 'The browser has agreed to keep this data.' : 'The browser may clear this data if the phone runs low on space.'}`;
    } catch { /* not available */ }
  });
  return [back(), title('Backup'),
    h('p', { class: 'sub' }, 'Your extras live only on this phone. Nothing is uploaded. A weekly backup file is your copy if the phone is lost or Safari clears its data.'),
    h('div', { class: 'card' }, h('h2', null, 'Export'), h('p', null, last ? `Last backup ${X.day(last)}.` : 'No backup yet.'), status,
      h('div', { class: 'row' }, prep, saveBtn), result),
    h('div', { class: 'card' }, h('h2', null, 'Import'), h('p', null, 'Restores from a backup file. Nothing is deleted: for each item the newer copy wins. On a new phone, restore before logging anything.'),
      h('button', { onclick: () => pickIn.click() }, 'Choose backup file'), pickIn)];
}

// ---------- start
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
try {
  db = await openDb();
  await load();
  render();
} catch (err) {
  app.replaceChildren(title('Storage is not available'), h('p', null, 'This browser blocked on-device storage, which Extras needs to keep your records. Private browsing can do this. ' + (err?.message || '')));
}

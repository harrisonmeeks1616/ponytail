// Extras Log screens and on-device storage (IndexedDB). The rules live in extras.mjs.
// Nothing here talks to a server: the page's CSP only allows its own files, and data never leaves the phone
// except through the share sheet, a copy, print, or a backup file he saves himself.
import * as X from './extras.mjs';

const app = document.getElementById('app');
const S = { jobs: {}, events: [], filter: 'all', showVoid: false, shared: null, photos: new Map(), mount: [] };
const now = () => new Date().toISOString();
const ls = {
  get: k => { try { return localStorage.getItem('extras-log.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('extras-log.' + k) : localStorage.setItem('extras-log.' + k, v); } catch { /* private mode: conveniences only */ } },
};
S.filter = ls.get('filter') || 'all';

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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = h('textarea', { value: text }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(`${what} copied`);
}
const localInput = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const money = v => { const s = String(v ?? '').replace(/[$,\s]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : NaN; };

// ---------- storage
let db;
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('extras-log', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('jobs', { keyPath: 'name' });
      d.createObjectStore('events', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' }); // {id, data: JPEG data URL}; events hold ids so the list never loads images
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Close other Extras tabs and reload.'));
  });
}
function run(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(...[].concat(stores).map(s => t.objectStore(s)));
    t.oncomplete = () => res(out?.result);
    t.onerror = t.onabort = () => rej(t.error || new Error('Could not save on this phone.'));
  });
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
async function render() {
  const hash = location.hash || '#/';
  const [, a = '', id = '', b = ''] = hash.match(/^#\/([^/]*)\/?([^/]*)\/?([^/]*)/) || [];
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
}
window.addEventListener('hashchange', render);
const findEv = id => S.events.find(e => e.id === id);
const missing = () => [back(), title('Not found'), h('p', null, 'This item is not on this phone.')];

// ---------- log
function flagText(e, job, t = Date.now()) {
  const f = X.flag(e, job, t), d = X.deadline(e, job), s = X.status(e);
  if (f === 'late') return `Notice overdue by ${X.span(t - d)}`;
  if (f === 'soon') return `Notice due in ${X.span(d - t)}`;
  if (f === 'ok') return `Notice due ${X.when(d)}`;
  if (f === 'unset') return 'Notice window not set';
  if (s === 'noticed') return `Notice sent ${X.day(e.noticeSentAt)}`;
  if (s === 'co_submitted') return `CO submitted${e.coAmount != null ? ' ' + X.usd(e.coAmount) : ''}`;
  return X.STATUS[s];
}
function evCard(e) {
  const job = S.jobs[e.job], t = Date.now(), f = X.flag(e, job, t);
  return h('button', { class: `ev ${f}`, onclick: () => go('#/e/' + e.id) },
    h('span', { class: 'head' }, h('span', null, `${S.filter === 'all' ? e.job + ' · ' : ''}#${X.pad(e.no)} ${X.KINDS[e.kind]}`), h('span', null, `${X.span(t - Date.parse(e.at))} ago`)),
    h('span', { class: 'what' }, e.what),
    h('span', { class: `tag ${f}` }, flagText(e, job, t)));
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
    out.push(h('div', { class: 'banner info noprint' }, 'Add Extras to your Home Screen',
      h('p', null, 'In Safari tap Share, then Add to Home Screen. It opens with no signal, and Safari is less likely to clear its data. ',
        h('button', { class: 'link', onclick: () => { ls.set('homeHint', '1'); render(); } }, 'Got it'))));
  }
  return out;
}
const stat = (n, label, cls) => h('div', { class: `stat ${cls || ''}` }, h('b', null, n), label);
function logScreen() {
  const jobs = Object.values(S.jobs).sort((a, b) => a.name.localeCompare(b.name));
  if (!jobs.length) return [title('Extras'), h('p', { class: 'sub' }, 'Log directed extra work and delays the moment they happen, send written notice inside the contract window, and track the change order. Everything stays on this phone.'),
    h('div', { class: 'card' }, h('h2', null, 'Start with a job'), jobForm(null))];
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
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Show job' }, chip('All jobs', S.filter === 'all', () => setFilter('all')), jobs.map(j => chip(j.name, S.filter === j.name, () => setFilter(j.name)))),
    h('div', { class: 'stats' },
      stat(count('late'), 'past the notice window', count('late') ? 'late' : ''),
      stat(count('soon'), 'notice due within 24 h', count('soon') ? 'soon' : ''),
      stat(open, 'open'),
      stat(pending.length, `CO${pending.length === 1 ? '' : 's'} awaiting a decision${pendingSum ? ` (${X.usd(pendingSum)})` : ''}`)),
    count('unset') ? h('p', { class: 'hint' }, `${count('unset')} with no notice window set. `, h('button', { class: 'link', onclick: () => go('#/jobs') }, 'Set it in Jobs')) : null,
    h('div', { class: 'row noprint', style: 'margin: 0 0 14px' }, h('button', { onclick: () => copy((S.filter === 'all' ? jobs : [S.jobs[S.filter]]).map(j => X.fridayLine(S.events, j, Date.now())).join('\n'), 'Friday line') }, S.filter === 'all' ? 'Copy Friday lines' : 'Copy Friday line')),
    shown.length ? shown.map(evCard) : h('p', { class: 'empty' }, 'Nothing logged yet. Tap New extra when the GC directs work or something holds you up.'),
    voids ? h('button', { class: 'link noprint', onclick: () => { S.showVoid = !S.showVoid; render(); } }, S.showVoid ? 'Hide void items' : `Show ${voids} void item${voids > 1 ? 's' : ''}`) : null,
    h('button', { class: 'primary fab noprint', onclick: () => go('#/new') }, '+ New extra'),
  ];
}

// ---------- jobs
function jobForm(job) {
  const err = h('p', { class: 'err', role: 'alert' });
  const name = h('input', { value: job?.name || '', required: true, maxLength: 120, autocomplete: 'off', enterKeyHint: 'next' });
  const days = h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 365, step: 1, value: job?.noticeDays ?? '' });
  const clause = h('input', { value: job?.clauseRef || '', maxLength: 200, autocomplete: 'off', placeholder: 'e.g. Subcontract 7.2' });
  const used = job && S.events.some(e => e.job === job.name);
  async function submit(ev) {
    ev.preventDefault();
    const n = name.value.trim(), dv = days.value.trim(), d = dv === '' ? null : Number(dv);
    if (!n) return void (err.textContent = 'Give the job a name.');
    if (d !== null && !(Number.isInteger(d) && d >= 0 && d <= 365)) return void (err.textContent = 'The notice window is a whole number of days (0 to 365), or blank.');
    if (n !== job?.name && S.jobs[n]) return void (err.textContent = 'There is already a job with that name.');
    const j = { name: n, noticeDays: d, clauseRef: clause.value.trim(), updatedAt: now() };
    const moved = job && n !== job.name ? S.events.filter(e => e.job === job.name).map(e => ({ ...e, job: n, updatedAt: now() })) : [];
    await write({ jobs: [j], dropJobs: job && n !== job.name ? [job.name] : [], events: moved });
    if (job) delete S.jobs[job.name];
    S.jobs[n] = j;
    S.events = [...S.events.filter(e => !moved.some(m => m.id === e.id)), ...moved];
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
    field('Job name', name),
    field('Notice window, in calendar days', days, 'From the changes clause of this subcontract. Leave it blank until you have read it: the log says "not set" instead of guessing. Use 0 for "before proceeding".'),
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
  if (old && !X.canEdit(old, 'what')) { go('#/e/' + id, true); toast('Signed or void items cannot change. Use Void and re-issue.'); return null; }
  const jobs = Object.values(S.jobs).sort((a, b) => a.name.localeCompare(b.name));
  if (!jobs.length) { go('#/', true); return null; }
  let draft = null;
  if (!old) try { draft = JSON.parse(ls.get('draft') || 'null'); } catch { /* ignore a bad draft */ }
  const lastJob = ls.get('lastJob');
  const pick = S.filter !== 'all' ? S.filter : S.jobs[lastJob] ? lastJob : jobs.length === 1 ? jobs[0].name : '';
  const f = old ? structuredClone(old) : { job: pick, kind: '', at: now(), byRole: '', byName: '', area: '', what: '', refs: '', labor: [], material: [], equipment: [], photos: [], ...(draft || {}) };
  if (!S.jobs[f.job]) f.job = pick;
  f.photos = old ? [...old.photos] : [];
  const added = new Set(), removed = new Set();
  let saving = false, dirtyFlag = false, timer;
  const dirty = () => {
    dirtyFlag = true;
    if (old) return;
    clearTimeout(timer); // a call or a dropped app should not cost the words he dictated
    timer = setTimeout(() => ls.set('draft', JSON.stringify({ job: f.job, kind: f.kind, at: f.at, byRole: f.byRole, byName: f.byName, area: f.area, what: f.what, refs: f.refs, labor: f.labor, material: f.material, equipment: f.equipment })), 300);
  };
  const err = h('p', { class: 'err', role: 'alert' });
  const pressed = (box, val) => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === val)));

  const jobBox = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Job' }, jobs.map(j => h('button', { type: 'button', 'data-v': j.name, 'aria-pressed': String(f.job === j.name), onclick: () => { f.job = j.name; pressed(jobBox, j.name); dirty(); } }, j.name)));
  const kindBox = h('div', { class: 'kinds', role: 'group', 'aria-label': 'Kind of change' }, Object.entries(X.KINDS).map(([k, label]) => h('button', { type: 'button', 'data-v': k, 'aria-pressed': String(f.kind === k), onclick: () => { f.kind = k; pressed(kindBox, k); dirty(); } }, label)));
  const roleBox = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Role' }, X.ROLES.map(r => h('button', { type: 'button', 'data-v': r, 'aria-pressed': String(f.byRole === r), onclick: () => { f.byRole = f.byRole === r ? '' : r; pressed(roleBox, f.byRole); dirty(); } }, r)));
  const at = h('input', { type: 'datetime-local', value: localInput(f.at), onchange: e => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) f.at = d.toISOString(); dirty(); } });
  const text = (k, props = {}) => h(props.rows ? 'textarea' : 'input', { value: f[k] || '', autocomplete: 'off', oninput: e => { f[k] = e.target.value; dirty(); }, ...props });

  const photoBox = h('div', { class: 'photos' });
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
  const takeFiles = async e => {
    for (const file of [...e.target.files].slice(0, 4 - f.photos.length)) {
      try { const pid = crypto.randomUUID(); S.photos.set(pid, await shrink(file)); added.add(pid); f.photos.push(pid); }
      catch { toast('That photo could not be read.'); }
    }
    e.target.value = ''; dirtyFlag = true; drawPhotos();
  };
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: takeFiles });
  const lib = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: takeFiles });
  const camBtn = h('button', { type: 'button', onclick: () => cam.click() }, 'Take photo');
  const libBtn = h('button', { type: 'button', onclick: () => lib.click() }, 'Choose photo');
  drawPhotos();

  async function save() {
    if (saving) return;
    err.textContent = '';
    try {
      if (!f.job) throw new Error('Pick the job.');
      if (!f.kind) throw new Error('Pick what kind of change this is.');
      if (!f.what.trim()) throw new Error('Say what changed. Tap the microphone on the keyboard to dictate.');
      if (Number.isNaN(Date.parse(f.at))) throw new Error('Enter when it happened.');
      const lines = { labor: cleanLines(f.labor, 'labor'), material: cleanLines(f.material, 'material'), equipment: cleanLines(f.equipment, 'equipment') };
      saving = true;
      const t = now();
      const base = old || { id: crypto.randomUUID(), job: f.job, no: X.nextNo(S.events, f.job), sig: null, noticeSentAt: null, noticeText: null, coNo: '', coAmount: null, coSubmittedAt: null, decision: null, decidedAt: null, voidedAt: null, voidReason: '', replaces: null, createdAt: t };
      const ev = { ...base, kind: f.kind, at: f.at, byRole: f.byRole, byName: f.byName.trim(), area: f.area.trim(), what: f.what.trim(), refs: f.refs.trim(), ...lines, photos: f.photos, updatedAt: t };
      if (!X.validEvent({ ...ev, photos: [] })) throw new Error('A field is too long. Shorten it and save again.');
      await saveEv(ev, { photos: [...added].map(pid => ({ id: pid, data: S.photos.get(pid) })), dropPhotos: [...removed] });
      removed.forEach(pid => S.photos.delete(pid));
      clearTimeout(timer);
      if (!old) ls.set('draft', null);
      ls.set('lastJob', f.job);
      go('#/e/' + ev.id, true);
      toast(old ? 'Saved' : `Saved as #${X.pad(ev.no)}`);
    } catch (e) {
      saving = false;
      err.textContent = e.message || 'Could not save.';
    }
  }
  function cancel() {
    if (dirtyFlag && !confirm('Discard this entry?')) return;
    clearTimeout(timer);
    if (!old) ls.set('draft', null);
    added.forEach(pid => S.photos.delete(pid));
    go(old ? '#/e/' + old.id : '#/', true);
  }
  const anyLines = f.labor.length || f.material.length || f.equipment.length;
  return [
    back(old ? '#/e/' + old.id : '#/', old ? '‹ Back to the item' : '‹ All extras'),
    title(old ? `Edit #${X.pad(old.no)}` : 'New extra'),
    draft ? h('div', { class: 'banner info noprint' }, 'Picked up your unsaved entry', h('p', null, 'Photos are not kept in a draft. ', h('button', { class: 'link', type: 'button', onclick: () => { ls.set('draft', null); render(); } }, 'Start over'))) : null,
    h('form', { onsubmit: e => { e.preventDefault(); save(); }, novalidate: true },
      old ? h('p', { class: 'sub' }, old.job) : h('div', { class: 'field' }, h('label', null, 'Job'), jobBox),
      h('div', { class: 'field' }, h('label', null, 'What kind'), kindBox),
      field('When it was directed or happened', at),
      h('div', { class: 'field' }, h('label', null, 'Who directed or caused it'), roleBox, h('div', { style: 'margin-top: 8px' }, text('byName', { placeholder: 'Name (optional)', maxLength: 120, 'aria-label': 'Name of the person' }))),
      field('Where', text('area', { placeholder: 'Level, area, room, gridline', maxLength: 200 })),
      field('What changed', text('what', { rows: 4, maxLength: 5000, placeholder: 'What you were told to do, or what held you up' }), 'Tap the microphone on the keyboard to dictate.'),
      field('References', text('refs', { placeholder: 'RFI, ASI, drawing, paper T&M ticket number', maxLength: 300 })),
      h('details', { class: 'field', open: !!anyLines }, h('summary', null, 'Labor, material, equipment'),
        h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Record hours and material as they happen. No pricing here: price it in the office.'),
          linesEditor(f.labor, 'labor', dirty), linesEditor(f.material, 'material', dirty), linesEditor(f.equipment, 'equipment', dirty))),
      h('div', { class: 'field' }, h('label', null, 'Photos (up to 4)'), h('p', { class: 'hint' }, 'The work, the condition, or the paper T&M ticket.'), h('div', { class: 'row' }, camBtn, libBtn), cam, lib, photoBox),
      err,
      h('div', { class: 'bar noprint' }, h('div', null, h('button', { type: 'button', onclick: cancel }, 'Cancel'), h('button', { class: 'primary', type: 'submit' }, 'Save')))),
  ];
}

// ---------- detail
const byText = e => [e.byName, e.byRole && `(${e.byRole})`].filter(Boolean).join(' ');
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
  // Everything is built synchronously from what the screen already loaded: Safari only allows the share
  // sheet right after a tap, and waiting on storage first can lose that permission.
  const text = X.record(e, job), name = `${e.job} item ${X.pad(e.no)}`, base = `${slug(e.job)}-${X.pad(e.no)}`;
  const files = e.photos.map((pid, i) => S.photos.get(pid) && dataFile(S.photos.get(pid), `${base}-photo-${i + 1}.jpg`)).filter(Boolean);
  if (e.sig && !e.sig.refused) files.push(dataFile(sigPng(e.sig), `${base}-signature.png`));
  try {
    if (files.length && navigator.canShare?.({ files })) await navigator.share({ title: name, text, files });
    else if (navigator.share) await navigator.share({ title: name, text });
    else await copy(text, 'Record');
  } catch (err) { if (err.name !== 'AbortError') await copy(text, 'Record'); }
}
async function sendNotice(e, job) {
  const { subject, body } = X.notice(e, job);
  const done = () => { S.shared = e.id; render(); toast('Sent it? Tap Mark notice sent.'); };
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
function statusBanner(e, job, t) {
  const f = X.flag(e, job, t), d = X.deadline(e, job), s = X.status(e);
  if (f === 'late') return h('div', { class: 'banner late' }, `Notice overdue by ${X.span(t - d)}`, h('p', null, `It was due ${X.when(d)}. Send it now; a late notice is still better than none.`));
  if (f === 'soon') return h('div', { class: 'banner soon' }, `Notice due in ${X.span(d - t)}`, h('p', null, `Due ${X.when(d)}.`));
  if (f === 'ok') return h('div', { class: 'banner ok' }, `Notice due ${X.when(d)}`, h('p', null, `${job.noticeDays} day window for ${job.name}.`));
  if (f === 'unset') return h('div', { class: 'banner unset' }, 'No notice window set for this job', h('p', null, 'Read the changes clause, then ', h('button', { class: 'link', onclick: () => go('#/jobs') }, 'set it in Jobs'), '.'));
  if (s === 'void') {
    const next = S.events.find(x => x.replaces === e.id);
    return h('div', { class: 'banner void' }, `Void: ${e.voidReason}`, next ? h('p', null, h('button', { class: 'link', onclick: () => go('#/e/' + next.id) }, `Corrected as #${X.pad(next.no)}`)) : null);
  }
  const what = { noticed: `Notice sent ${X.when(e.noticeSentAt)}`, co_submitted: `CO submitted ${X.day(e.coSubmittedAt)}`, approved: `CO approved ${X.day(e.decidedAt)}`, rejected: `CO rejected ${X.day(e.decidedAt)}` }[s];
  return h('div', { class: 'banner done' }, what);
}
function detailScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  const job = S.jobs[e.job], t = Date.now(), s = X.status(e), live = s !== 'void';
  const prev = e.replaces && findEv(e.replaces);
  const photos = h('div', { class: 'photos' }, e.photos.map((pid, i) => {
    const img = h('img', { alt: `Photo ${i + 1} of item ${X.pad(e.no)}` });
    photo(pid).then(src => { if (src) img.src = src; });
    return h('figure', null, img);
  }));

  const record = h('div', { class: 'card' }, h('h2', null, 'Record'),
    h('dl', null, dtdd('When', X.when(e.at)), dtdd(e.kind === 'delay' ? 'Caused by' : 'Directed by', byText(e)), dtdd('Where', e.area), dtdd('What changed', e.what), dtdd('References', e.refs)),
    table(['Labor', 'Reg h', 'OT h'], (e.labor || []).map(r => [r.who || 'Unnamed', r.st, r.ot])),
    table(['Qty', 'Material'], (e.material || []).map(r => [r.qty, r.item])),
    table(['Equipment', 'Hours'], (e.equipment || []).map(r => [r.item, r.hrs])),
    e.photos.length ? photos : null,
    e.sig?.refused ? h('p', { style: 'margin-top: 12px' }, h('b', null, 'Rep would not sign. '), `${e.sig.reason || 'No reason given'}. ${X.when(e.sig.at)}`) : null,
    e.sig && !e.sig.refused ? h('div', { class: 'sig', style: 'margin-top: 12px' }, sigSvg(e.sig), h('p', null, `Signed by ${e.sig.name}, ${X.when(e.sig.at)}`)) : null);

  const sigCard = live && !e.sig ? h('div', { class: 'card noprint' }, h('h2', null, 'Signature (optional)'),
    h('p', null, "Have the GC's rep sign on this screen. If they won't, record that: it shows you raised it in writing."),
    h('div', { class: 'row' }, h('button', { onclick: () => go(`#/e/${e.id}/sign`) }, 'Get signature'), h('button', { onclick: () => go(`#/e/${e.id}/refuse`) }, 'Rep would not sign'))) : null;

  const sent = !!e.noticeSentAt;
  const noticeCard = live ? h('div', { class: 'card' }, h('h2', null, 'Written notice'),
    sent ? [h('p', null, `Marked sent ${X.when(e.noticeSentAt)}.`),
      e.noticeText ? h('details', null, h('summary', null, 'Text as sent'), h('pre', null, e.noticeText)) : null,
      h('button', { class: 'link noprint', onclick: () => update(e, { noticeSentAt: null, noticeText: null }, 'Marked not sent') }, 'Undo: it did not go out')]
    : [h('p', null, 'Send it from your work email so it lands in the company record. The text covers the event, the cause, the impact (to be determined) and a reservation of rights.'),
      h('div', { class: 'row noprint' },
        h('button', { class: S.shared === e.id ? '' : 'primary', onclick: () => sendNotice(e, job) }, 'Send notice'),
        h('button', { onclick: () => { const n = X.notice(e, job); copy(`${n.subject}\n\n${n.body}`, 'Notice'); S.shared = e.id; render(); } }, 'Copy text'),
        h('button', { class: S.shared === e.id ? 'primary' : '', onclick: () => { const n = X.notice(e, job); S.shared = null; update(e, { noticeSentAt: now(), noticeText: `${n.subject}\n\n${n.body}` }, 'Notice marked sent'); } }, 'Mark notice sent'))]) : null;

  let coCard = null;
  if (live && !e.coSubmittedAt) {
    const err = h('p', { class: 'err', role: 'alert' });
    const no = h('input', { value: e.coNo || '', maxLength: 40, autocomplete: 'off' });
    const amt = h('input', { inputMode: 'decimal', autocomplete: 'off', value: e.coAmount ?? '', placeholder: '$' });
    const on = h('input', { type: 'date', value: localInput(now()).slice(0, 10) });
    coCard = h('div', { class: 'card noprint' }, h('h2', null, 'Change order'), h('p', { class: 'hint' }, 'After the office prices it and it goes to the GC.'),
      field('CO number', no), field('Amount submitted', amt), field('Submitted on', on), err,
      h('button', { onclick: () => {
        const a = money(amt.value);
        if (Number.isNaN(a)) return void (err.textContent = 'Enter the amount as a number, like 4500 or 4,500.50.');
        if (!on.value) return void (err.textContent = 'Enter the date it was submitted.');
        update(e, { coNo: no.value.trim(), coAmount: a, coSubmittedAt: new Date(`${on.value}T12:00`).toISOString() }, 'CO marked submitted');
      } }, 'Mark CO submitted'));
  } else if (live) {
    coCard = h('div', { class: 'card' }, h('h2', null, 'Change order'),
      h('p', null, `CO ${e.coNo || '(no number)'}${e.coAmount != null ? `, ${X.usd(e.coAmount)}` : ''}, submitted ${X.day(e.coSubmittedAt)}.`),
      e.decision ? [h('p', null, `${X.STATUS[e.decision]} ${X.day(e.decidedAt)}.`), h('button', { class: 'link noprint', onclick: () => update(e, { decision: null, decidedAt: null }) }, 'Undo the decision')]
        : h('div', { class: 'row noprint' },
          h('button', { onclick: () => update(e, { decision: 'approved', decidedAt: now() }, 'Marked approved') }, 'Approved'),
          h('button', { onclick: () => update(e, { decision: 'rejected', decidedAt: now() }, 'Marked rejected') }, 'Rejected'),
          h('button', { class: 'link', onclick: () => update(e, { coSubmittedAt: null }, 'Submission undone') }, 'Undo submission')));
  }

  const actions = h('div', { class: 'card noprint' }, h('h2', null, 'Share and fix'),
    h('div', { class: 'row' },
      h('button', { onclick: () => shareRecord(e, job) }, 'Share record'),
      h('button', { onclick: () => window.print() }, 'Print or PDF'),
      live && !sent && s === 'open' ? h('button', { onclick: () => copy(X.todoistLine(e, job, Date.now()), 'Todoist reminder') }, 'Copy Todoist reminder') : null,
      live && !e.sig ? h('button', { onclick: () => go(`#/e/${e.id}/edit`) }, 'Edit') : null,
      live ? h('button', { class: 'danger', onclick: () => go(`#/e/${e.id}/void`) }, e.sig ? 'Void and re-issue' : 'Void') : null));

  return [back(), title(`#${X.pad(e.no)} ${X.KINDS[e.kind]}`),
    h('p', { class: 'sub' }, e.job, prev ? [' · corrects ', h('button', { class: 'link', onclick: () => go('#/e/' + prev.id) }, `#${X.pad(prev.no)}`)] : null),
    statusBanner(e, job, t), record, sigCard, noticeCard, coCard, actions];
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
  const err = h('p', { class: 'err', role: 'alert' });
  const ctx = () => pad.getContext('2d');
  const draw = () => {
    const c = ctx(), w = pad.width;
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
  S.mount.push(() => {
    const w = pad.clientWidth, hgt = Math.round(Math.min(220, w * 0.45));
    pad.style.height = hgt + 'px'; pad.width = Math.round(w * devicePixelRatio); pad.height = Math.round(hgt * devicePixelRatio);
  });
  const job = S.jobs[e.job];
  return [back('#/e/' + id, '‹ Back to the item'), title('Signature'),
    h('div', { class: 'card' }, h('p', null, h('b', null, 'By signing, I acknowledge that the work below was directed and performed, with the labor and material listed. Pricing to follow.')),
      h('pre', null, X.record({ ...e, noticeSentAt: null, coSubmittedAt: null, decision: null }, { ...job, noticeDays: null }).split('\n').filter(l => !/^Notice/.test(l)).join('\n'))),
    field('Printed name', name),
    h('div', { class: 'field' }, h('label', null, 'Sign here'), pad, h('button', { type: 'button', class: 'link', onclick: () => { strokes.length = 0; draw(); } }, 'Clear')),
    err,
    h('div', { class: 'bar noprint' }, h('div', null, h('button', { onclick: () => go('#/e/' + id, true) }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const n = name.value.trim(), lines = strokes.filter(l => l.length >= 4);
        if (!n) return void (err.textContent = 'Print the name of the person signing.');
        if (!lines.length) return void (err.textContent = 'Sign in the box.');
        await saveEv({ ...e, sig: { name: n, at: now(), strokes: lines } });
        go('#/e/' + id, true); toast('Signed');
      } }, 'Save signature')))];
}
function refuseScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  if (!X.canEdit(e, 'what')) { go('#/e/' + id, true); return null; }
  const reason = h('input', { maxLength: 300, autocomplete: 'off', placeholder: 'e.g. said to send it to the GC PM' });
  return [back('#/e/' + id, '‹ Back to the item'), title('Rep would not sign'),
    h('p', { class: 'sub' }, 'This records that you asked, and when. The written notice matters more than the signature: send it either way.'),
    field('What they said (optional)', reason),
    h('div', { class: 'bar noprint' }, h('div', null, h('button', { onclick: () => go('#/e/' + id, true) }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => { await saveEv({ ...e, sig: { refused: true, reason: reason.value.trim(), at: now() } }); go('#/e/' + id, true); toast('Recorded'); } }, 'Record refusal')))];
}
function voidScreen(id) {
  const e = findEv(id);
  if (!e) return missing();
  if (X.status(e) === 'void') { go('#/e/' + id, true); return null; }
  const reason = h('input', { maxLength: 300, autocomplete: 'off', placeholder: 'e.g. wrong level, duplicate' });
  const again = h('input', { type: 'checkbox', checked: !!e.sig, style: 'width: auto; min-height: 0; margin-right: 8px' });
  const err = h('p', { class: 'err', role: 'alert' });
  return [back('#/e/' + id, '‹ Back to the item'), title(`Void #${X.pad(e.no)}`),
    h('p', { class: 'sub' }, 'Nothing is deleted. The item stays in the log as void, with its number and your reason.'),
    field('Reason', reason),
    h('label', { style: 'display: flex; align-items: center; font-weight: 500; min-height: 44px' }, again, 'Make a corrected copy with the next number'),
    err,
    h('div', { class: 'bar noprint' }, h('div', null, h('button', { onclick: () => go('#/e/' + id, true) }, 'Cancel'),
      h('button', { class: 'primary danger', onclick: async () => {
        const r = reason.value.trim();
        if (!r) return void (err.textContent = 'Say why, so the log explains the gap.');
        if (!again.checked) { await saveEv({ ...e, voidedAt: now(), voidReason: r }); go('#/e/' + id, true); toast('Voided'); return; }
        const { voided, fresh } = X.reissue(e, S.events, r, crypto.randomUUID());
        const copies = [];
        for (const pid of e.photos) { const data = await photo(pid); if (data) { const n = crypto.randomUUID(); S.photos.set(n, data); copies.push({ id: n, data }); } }
        fresh.photos = copies.map(p => p.id); // the copy owns its photos, so editing it never touches the void original
        await write({ events: [voided, fresh], photos: copies });
        S.events = [...S.events.filter(x => x.id !== e.id), voided, fresh];
        go(`#/e/${fresh.id}/edit`, true); toast(`Corrected copy is #${X.pad(fresh.no)}`);
      } }, 'Void')))];
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
      result.textContent = `${events.length} items, ${photos.length} photos, ${(file.size / 1048576).toFixed(1)} MB. Tap Save backup file and put it in Files or iCloud Drive.`;
      saveBtn.hidden = false; saveBtn.focus();
    } catch (err) { result.textContent = `Could not prepare the backup: ${err.message}`; }
    prep.disabled = false;
  } }, 'Prepare backup');
  const pickIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try {
      if (f.size > 500 * 1048576) throw new Error('That file is too large to be a backup.');
      const { jobs, events, dropped } = X.cleanImport(JSON.parse(await f.text()));
      const incoming = new Map(), photos = [];
      for (const e of events) {
        const ids = e.photos.map((data, i) => { const pid = `${e.id}-p${i}`; photos.push({ id: pid, data }); return pid; });
        incoming.set(e.id, { ...e, photos: ids });
      }
      const ev2 = X.merge(S.events, [...incoming.values()], 'id'), jb = X.merge(Object.values(S.jobs), jobs, 'name');
      const taken = ev2.list.filter(e => incoming.get(e.id) === e);
      const keep = new Set(taken.flatMap(e => e.photos));
      const drop = taken.flatMap(e => S.events.find(x => x.id === e.id)?.photos || []).filter(pid => !keep.has(pid));
      const knownJobs = new Set(jb.list.map(j => j.name));
      const orphanJobs = [...new Set(taken.map(e => e.job))].filter(n => !knownJobs.has(n)).map(n => ({ name: n, noticeDays: null, clauseRef: '', updatedAt: now() }));
      await write({ events: taken, photos: photos.filter(p => keep.has(p.id)), dropPhotos: drop, jobs: [...jb.list.filter(j => jobs.includes(j)), ...orphanJobs] });
      await load(); S.photos.clear(); persist();
      result.textContent = `Imported. Items: ${ev2.added} new, ${ev2.updated} updated, ${ev2.kept} already up to date. Jobs: ${jb.added + orphanJobs.length} new, ${jb.updated} updated.${dropped ? ` ${dropped} damaged rows skipped.` : ''}`;
    } catch (err) { result.textContent = err instanceof SyntaxError ? 'That file is not a readable backup.' : err.message; }
  } });
  S.mount.push(async () => {
    try {
      const [est, kept] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
      status.textContent = `${est ? `Using ${(est.usage / 1048576).toFixed(1)} MB on this phone. ` : ''}${kept ? 'The browser has agreed to keep this data.' : 'The browser may clear this data if the phone runs low on space.'}`;
    } catch { /* not available */ }
  });
  return [back(), title('Backup'),
    h('p', { class: 'sub' }, 'Your extras live only on this phone. Nothing is uploaded. A weekly backup file is your copy if the phone is lost or Safari clears its data.'),
    h('div', { class: 'card' }, h('h2', null, 'Export'), h('p', null, last ? `Last backup ${X.day(last)}.` : 'No backup yet.'), status,
      h('div', { class: 'row' }, prep, saveBtn), result),
    h('div', { class: 'card' }, h('h2', null, 'Import'), h('p', null, 'Restores from a backup file. Nothing is deleted: for each item the newer copy wins.'),
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

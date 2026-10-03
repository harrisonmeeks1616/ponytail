// Shared by tasks.html and report.html: storage, link codec, time math, small UI pieces.
// Nothing leaves the phone except a link the user chooses to send. The data rides in the
// part of the URL after "#", which browsers never send to the web server.

export const KEYS = { settings: 'schwab.settings', tasks: 'schwab.tasks', reports: 'schwab.reports' };

// ---------- data ----------

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Copy only the keys and types the template knows; arrays use their first entry as the item template.
// Every link, backup and old save passes through here, so a bad or hostile payload can't break the page.
export function shape(tpl, src) {
  if (Array.isArray(tpl)) return Array.isArray(src) ? src.map(x => shape(tpl[0], x)) : [];
  if (tpl && typeof tpl === 'object') {
    const out = {};
    for (const k of Object.keys(tpl)) out[k] = shape(tpl[k], src && typeof src === 'object' ? src[k] : undefined);
    return out;
  }
  return typeof src === typeof tpl ? src : tpl;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
// ponytail: everything lives in localStorage (~5 MB per site), roughly a year of daily sheets.
// Past that, move to IndexedDB or a shared backend; Backup keeps a copy until then.
export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

export const SETTINGS_TPL = { me: '', role: '', super: '', pm: '', project: '', site: '', floors: [''], crews: [{ name: '', lead: '', members: '' }], checks: [''] };
export const DEFAULT_SETTINGS = {
  me: '', role: 'Superintendent', super: '', pm: '',
  project: 'Charles Schwab Building', site: 'Charlotte, NC',
  floors: ['Basement', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Roof'],
  crews: ['A', 'B', 'C', 'D'].map(x => ({ name: 'Crew ' + x, lead: '', members: '' })),
  checks: ['Supports / strapping', 'Labeling', 'Terminations / torque', 'Testing', 'Covers / plates', 'Cleanup'],
};
export const loadSettings = () => { const s = load(KEYS.settings, null); return s ? shape(SETTINGS_TPL, s) : structuredClone(DEFAULT_SETTINGS); };
export const roster = (s, crew) => (s.crews.find(c => c.name === crew)?.members || '').split(',').map(x => x.trim()).filter(Boolean);

const ITEM = { id: '', text: '', done: false, at: 0 };
export const TASK_TPL = {
  uid: '', origin: '', from: '', id: '', date: '', by: '', floor: '', area: '', crew: '', lead: '', members: [''], size: 0,
  scope: '', refs: '', items: [ITEM], checks: [ITEM],
  allot: 0, allotNote: '', est: 0, estNote: '', pStart: '', pStop: '', checkIn: '',
  aStart: '', aStop: '', delay: 0, status: '', doneText: '', remain: '', comments: '',
  review: '', reviewer: '', followUp: '', sentAt: 0, gotAt: 0, updatedAt: 0,
};
export const normTask = t => shape(TASK_TPL, t);
export const newItem = text => ({ id: uid(), text, done: false, at: 0 });

const ASSIGN = ['id', 'date', 'by', 'floor', 'area', 'crew', 'members', 'size', 'scope', 'refs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn'];
const CREW = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments'];

// part 'crew': take the crew's results and check-offs, keep my assignment.
// part 'assign': take the new assignment and checklist, keep check-offs already made here.
export function mergeTask(local, inc, part) {
  for (const k of part === 'crew' ? CREW : ASSIGN) local[k] = inc[k];
  for (const list of ['items', 'checks']) {
    const [keep, take] = part === 'crew' ? [local[list], inc[list]] : [inc[list], local[list]];
    for (const it of keep) { const m = take.find(x => x.id === it.id); if (m) { it.done = m.done; it.at = m.at; } }
    local[list] = keep;
  }
  local.updatedAt = Math.max(local.updatedAt, inc.updatedAt);
  return local;
}

// The PM owns the decision answers and the review stamp; the superintendent owns everything else.
// An answer whose question was reworded since is added as its own entry, never dropped.
export function mergeAnswers(base, answers) {
  for (const d of answers.decisions) {
    if (!d.pm && !d.pmNote) continue;
    const m = base.decisions.find(x => x.q === d.q);
    if (m) Object.assign(m, { pm: d.pm, pmNote: d.pmNote });
    else base.decisions.push(d);
  }
  base.pmReview = answers.pmReview || base.pmReview;
  return base;
}

// Fresh copy of a task for another day or crew: new identity, empty results.
export function cloneTask(t, date, onlyOpen) {
  const c = normTask(structuredClone(t));
  for (const k of CREW) if (k !== 'lead') c[k] = TASK_TPL[k];
  for (const k of ['review', 'reviewer', 'followUp', 'sentAt', 'gotAt']) c[k] = TASK_TPL[k];
  for (const list of ['items', 'checks']) c[list] = c[list].filter(i => !onlyOpen || !i.done).map(i => newItem(i.text));
  return Object.assign(c, { uid: uid(), origin: 'mine', date, updatedAt: Date.now() });
}

export const CREW_TPL = { name: '', na: true, lead: '', workers: 0, members: '', area: '', ref: '', start: '', stop: '', done: '', quality: '', holdups: '', good: '' };
export const REPORT_TPL = {
  date: '', super: '', shiftStart: '', shiftEnd: '', submittedAt: 0,
  status: '', results: '', wins: '', issues: '', notified: '',
  needs: [{ item: '', qty: '', where: '', confirmed: false, by: '' }],
  decisions: [{ q: '', rec: '', by: '', pm: '', pmNote: '' }],
  floors: [{ floor: '', crews: [CREW_TPL] }],
  next: [{ step: '', prereq: '', start: '', dur: '', finish: '', deadline: '', lead: '', checkin: '' }],
  risks: [{ risk: '', impact: '', prevent: '', fallback: '', owner: '', by: '' }],
  preparedBy: '', pmReview: '', updatedAt: 0,
};
export const normReport = r => shape(REPORT_TPL, r);
export const blank = list => shape(REPORT_TPL[list][0], {});
export const newFloor = (floor, crewNames) => ({ floor, crews: crewNames.map(name => ({ ...CREW_TPL, name })) });

// Roll the day's task sheets up into the report's floor / crew sections.
// Only empty report fields are filled, so the superintendent's own wording is never overwritten.
export function fillFromTasks(rep, tasks, crewNames) {
  const groups = new Map();
  for (const t of tasks) {
    const k = JSON.stringify([t.floor || 'Floor not set', t.crew || 'Crew not set']);
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  for (const [k, ts] of groups) {
    const [floor, crew] = JSON.parse(k);
    let fl = rep.floors.find(f => f.floor === floor);
    if (!fl) rep.floors.push(fl = newFloor(floor, crewNames));
    let c = fl.crews.find(x => x.name === crew);
    if (!c) fl.crews.push(c = { ...CREW_TPL, name: crew });
    const uniq = xs => [...new Set(xs.filter(Boolean))].join(', ');
    const lines = f => ts.map(f).filter(Boolean).join('\n');
    // Actual clock times only: planned times would bill labor-hours for work that never started.
    const starts = ts.map(t => t.aStart).filter(Boolean).sort();
    const stops = ts.map(t => t.aStop).filter(Boolean).sort();
    const fill = {
      lead: uniq(ts.map(t => t.lead)),
      workers: Math.max(0, ...ts.map(t => t.size)),
      members: uniq(ts.flatMap(t => t.members)),
      area: uniq(ts.map(t => t.area)),
      ref: uniq(ts.flatMap(t => [t.id, t.refs])),
      start: starts[0] || '',
      stop: stops.at(-1) || '',
      done: lines(t => {
        const n = t.items.filter(i => i.done).length;
        return `${t.id}${t.status ? ' (' + t.status + ')' : ''}${t.items.length ? ` ${n}/${t.items.length} steps` : ''}: ${t.doneText || t.scope}`;
      }),
      quality: lines(t => {
        const ok = t.checks.filter(c => c.done).map(c => c.text), open = t.checks.filter(c => !c.done).map(c => c.text);
        return ok.length || open.length ? `${t.id}: ${ok.length ? 'done ' + ok.join(', ') : ''}${ok.length && open.length ? '; ' : ''}${open.length ? 'open ' + open.join(', ') : ''}` : '';
      }),
      holdups: lines(t => {
        const bits = [t.status === 'Blocked' && 'Blocked', t.delay && `${t.delay} min delay`, t.comments].filter(Boolean);
        return bits.length ? `${t.id}: ${bits.join(' · ')}` : '';
      }),
    };
    c.na = false;
    for (const [f, v] of Object.entries(fill)) if (!c[f] && v) c[f] = v;
  }
  for (const t of tasks) {
    if (t.followUp && !rep.next.some(s => s.step.endsWith(t.followUp))) {
      rep.next.push({ ...blank('next'), step: `${t.floor} · ${t.crew}: ${t.followUp}`, lead: t.lead });
    }
  }
  return groups.size;
}

// ---------- link codec ----------

export async function pack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const MAX_UNPACKED = 1 << 20; // a crafted link can't balloon into something that freezes the phone
export async function unpack(code) {
  const bytes = Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  for (let n = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((n += value.length) > MAX_UNPACKED) { await reader.cancel(); throw new Error('Link is too large'); }
    chunks.push(value);
  }
  const data = JSON.parse(await new Blob(chunks).text());
  if (!data || typeof data !== 'object' || data.v !== 1) throw new Error('Not a field app link');
  return data;
}

// Pull the code out of a pasted link, a pasted message, or a bare code.
export const codeFrom = text => (/[#&]p=([\w-]+)/.exec(text) || /^\s*([\w-]{24,})\s*$/.exec(text) || [])[1] || '';
export const linkTo = (page, code) => new URL(page, location.href).href.split('#')[0] + '#p=' + code;

// ---------- time ----------

const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
export const niceDate = day => new Date(day + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
// Minutes from start to stop; a stop earlier than the start is an overnight shift.
export const span = (start, stop) => { const a = toMin(start), b = toMin(stop); return a == null || b == null ? 0 : (b - a + 1440) % 1440; };
export const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
export const t12 = t => { const m = toMin(t); return m == null ? '' : `${(Math.floor(m / 60) + 11) % 12 + 1}:${pad(m % 60)} ${m < 720 ? 'AM' : 'PM'}`; };
export const stamp = ts => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const hrs = n => (Math.round(n * 10) / 10).toString();

// ---------- UI pieces ----------

export const crewVar = (s, name) => { const i = s.crews.findIndex(c => c.name === name); return `--crew:var(--c${i < 0 ? 4 : i % 6})`; };

export const dateBar = day => `<div class="datebar">
  <button class="nav-btn" data-go="day/${addDays(day, -1)}" aria-label="Previous day">‹</button>
  <label class="day">${niceDate(day)}<small>${day === today() ? 'Today' : day < today() ? 'Past day' : 'Planning ahead'}</small>
    <input type="date" value="${day}" data-pick aria-label="Pick a date"></label>
  <button class="nav-btn" data-go="day/${addDays(day, 1)}" aria-label="Next day">›</button></div>`;

export const attr = (k, v) => v ? ` ${k}="${esc(v)}"` : '';

export function field(label, k, v, o = {}) {
  const common = `data-k="${k}"${attr('placeholder', o.ph)}${attr('list', o.list)}${attr('inputmode', o.mode)}`;
  const ctl = o.rows
    ? `<textarea ${common} rows="${o.rows}">${esc(v)}</textarea>`
    : `<input ${common} type="${o.type || 'text'}"${o.type === 'number' ? ' min="0" step="any"' : ''} value="${esc(o.type === 'number' ? v || '' : v)}">`;
  return `<label class="field${o.wide ? ' wide' : ''}"><span>${esc(label)}</span>${ctl}</label>`;
}

export const datalist = (id, values) => `<datalist id="${id}">${[...new Set(values.filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;

// Segmented control: one tap sets k to the option, tapping the active one clears it.
export const seg = (k, v, opts) => `<div class="seg" role="group">${opts.map(([val, tone, label]) =>
  `<button type="button" data-act="set" data-k="${k}" data-v="${esc(val)}" data-tone="${tone}" aria-pressed="${v === val}">${esc(label || val)}</button>`).join('')}</div>`;

// Delegated typing handler: inputs carry data-k="root.path.to.field".
export const getPath = (root, path) => path.split('.').reduce((o, k) => o?.[k], root);
export function setPath(root, path, val) {
  const ks = path.split('.'), last = ks.pop();
  const obj = ks.reduce((o, k) => o?.[k], root);
  if (obj && Object.hasOwn(obj, last)) obj[last] = val;
}
export function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? 0 : Math.max(0, +el.value || 0);
  if (el.dataset.lines !== undefined) return el.value.split('\n').map(x => x.trim()).filter(Boolean);
  return el.value;
}

export function toast(msg, tone = '') {
  let el = document.getElementById('toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast' }); el.setAttribute('role', 'status'); }
  (document.querySelector('dialog[open] .sheet-in') || document.body).append(el); // an open sheet would cover it otherwise
  el.textContent = msg;
  el.dataset.tone = tone;
  el.classList.add('show');
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function sheet(html) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.innerHTML = `<div class="sheet-in"><form method="dialog"><button class="sheet-x" aria-label="Close">✕</button></form>${html}</div>`;
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', e => { if (e.target === d) d.close(); }); // tap outside
  document.body.append(d);
  d.showModal();
  return d;
}

// In-page confirm: bigger targets than the browser's, and it can say what the buttons do.
export const ask = (msg, yes, tone = 'primary') => new Promise(res => {
  const d = sheet(`<p class="ask">${esc(msg)}</p><div class="btns"><button class="btn ${tone}" data-a="1">${esc(yes)}</button><button class="btn" data-a="0">Cancel</button></div>`);
  d.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { res(b.dataset.a === '1'); d.close(); } });
  d.addEventListener('close', () => res(false));
});

export function sendSheet({ title, text, url }) {
  const msg = `${text}\n${url}`;
  const d = sheet(`<h3>${esc(title)}</h3><p class="preview">${esc(text)}</p>
    <div class="btns">
      ${navigator.share ? '<button class="btn primary" data-s="share">Share…</button>' : ''}
      <a class="btn" href="sms:?&body=${encodeURIComponent(msg)}">Text message</a>
      <a class="btn" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(msg)}">Email</a>
      <button class="btn" data-s="copy">Copy link</button>
    </div>
    <p class="hint">${url.length > 1800 ? 'Long link: send by iMessage, WhatsApp or email. Some plain SMS apps cut long links. ' : ''}The work details are inside the link itself. Nothing is uploaded.</p>
    <textarea class="linkbox" readonly rows="2" aria-label="Link">${esc(url)}</textarea>`);
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    try {
      if (b.dataset.s === 'share') await navigator.share({ title, text, url });
      else { await navigator.clipboard.writeText(msg); toast('Link copied. Paste it into a text or email.'); }
      d.close();
    } catch (err) {
      if (err.name === 'AbortError') return;
      const box = d.querySelector('.linkbox');
      box.focus(); box.select();
      toast('Select the link below and copy it');
    }
  });
}

// Paste box for when a link was copied instead of tapped.
export const pasteSheet = onCode => {
  const d = sheet(`<h3>Open a link someone sent you</h3><p class="hint">Paste the whole message or just the link. Use this when a link opened in a different browser or app than this one.</p>
    <textarea class="linkbox" rows="3" aria-label="Paste link here"></textarea><div class="btns"><button class="btn primary" data-go>Open</button></div>`);
  d.querySelector('[data-go]').onclick = () => {
    const code = codeFrom(d.querySelector('textarea').value);
    if (!code) return toast("That doesn't look like a field app link", 'bad');
    d.close();
    onCode(code);
  };
};

export function printDoc(title, sub, sections) {
  const el = document.getElementById('print');
  el.innerHTML = `<h1>${esc(title)}</h1><p>${esc(sub)}</p>` + sections.map(([h, rows]) => `<section><h2>${esc(h)}</h2><dl>${
    rows.filter(([, v]) => v !== '' && v != null && v !== 0).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') || '<dd>Nothing recorded</dd>'
  }</dl></section>`).join('');
  window.print();
}

// ---------- settings (same screen in both apps; same phone = same settings) ----------

export function settingsView(s) {
  const roles = ['Superintendent', 'Project manager', 'Crew lead'];
  return `<section class="card"><h2>This phone</h2><div class="grid">
      ${field('Your name', 's.me', s.me, { ph: 'Used for "Assigned by", sign-offs' })}
      <label class="field"><span>Your role</span><select data-k="s.role">${roles.map(r => `<option${r === s.role ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
    </div></section>
    <section class="card"><h2>Project</h2><div class="grid">
      ${field('Project', 's.project', s.project)}${field('Location', 's.site', s.site)}
      ${field('Superintendent', 's.super', s.super)}${field('Project manager', 's.pm', s.pm)}
    </div></section>
    <section class="card"><h2>Floors / levels</h2><p class="hint">One per line. They show up as quick picks; you can still type any floor.</p>
      <textarea data-k="s.floors" data-lines rows="6">${esc(s.floors.join('\n'))}</textarea></section>
    <section class="card"><h2>Crews</h2><p class="hint">Members are separated by commas. Picking a crew on a task fills these in.</p>
      ${s.crews.map((c, i) => `<div class="crew-edit" style="--crew:var(--c${i % 6})"><div class="grid">
        ${field('Crew name', `s.crews.${i}.name`, c.name)}${field('Lead', `s.crews.${i}.lead`, c.lead)}
        ${field('Members', `s.crews.${i}.members`, c.members, { wide: true, ph: 'Mike R, Jose L, Tre W' })}</div>
        <button class="link danger" data-act="delCrew" data-i="${i}">Remove ${esc(c.name || 'crew')}</button></div>`).join('')}
      <button class="btn" data-act="addCrew">+ Add crew</button></section>
    <section class="card"><h2>Finish / accuracy checks</h2><p class="hint">One per line. Tap them onto a task as required checks.</p>
      <textarea data-k="s.checks" data-lines rows="6">${esc(s.checks.join('\n'))}</textarea></section>
    <section class="card"><h2>Backup</h2><p class="hint">Everything is stored on this phone only. Download a backup weekly, or before clearing browser data or switching phones.</p>
      <div class="btns"><button class="btn" data-act="backup">Download backup</button>
      <label class="btn">Restore from backup<input type="file" accept="application/json,.json" data-restore hidden></label></div>
      <p class="hint">Using about ${Math.ceil(Object.values(KEYS).reduce((n, k) => n + JSON.stringify(load(k, '')).length, 0) / 1024)} KB of roughly 5,000 KB.</p></section>`;
}

export async function settingsAct(act, s, el) {
  if (act === 'addCrew') s.crews.push({ name: 'Crew ' + String.fromCharCode(65 + s.crews.length), lead: '', members: '' });
  if (act === 'delCrew' && await ask(`Remove ${s.crews[el.dataset.i].name} from the crew list? Existing sheets keep their crew name.`, 'Remove', 'danger')) s.crews.splice(el.dataset.i, 1);
  if (act === 'backup') {
    const data = Object.fromEntries(Object.values(KEYS).map(k => [k, load(k, null)]));
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })),
      download: `schwab-field-backup-${today()}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  save(KEYS.settings, s);
}

export async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't a field app backup", 'bad'); }
  if (!data || !Object.values(KEYS).some(k => k in data)) return toast("That file isn't a field app backup", 'bad');
  if (!await ask('Replace everything on this phone with this backup?', 'Replace', 'danger')) return;
  for (const k of Object.values(KEYS)) if (data[k] != null) save(k, data[k]);
  location.reload();
}

export function registerSW() {
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

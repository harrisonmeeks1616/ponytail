// The hub screens (docs/schwab/HUB.md, "Screens" and "Translation"): the Live board, Records, Settings > Hub, the
// join sheet, the header status dot and the helpers that show typed text in the reader's language.
// Every view returns an HTML string (the app puts it in #app); every tap goes through act(); text goes through L().
// With no hub everything here still works from this phone's own stores, and nothing waits on the network.
//
// ctx: the one object the app passes to every view, to act() and to after(). Build it fresh for each call.
//   S            the settings object (loadSettings()): crews, me, project, worker, hub fields
//   tasks()      array of normalized task sheets (normTask), this phone's in-memory copy
//   shifts()     array of normalized shifts (normShift) of the PM's crew timesheet (KEYS.crewHours), gone ones included; [] on other phones
//   reports()    the touched daily reports (normReport), as an array or as the date-keyed object
//   role         'pm' | 'super' | 'crew': the office role of this phone. Only 'pm' deletes, exports, sees hours and administers the hub
//   day          'YYYY-MM-DD' the app is on (the Live board always shows the real today, from now())
//   sync         the sync.mjs API: hubStatus, liveData, cycle, connect, disconnect, joinFrom, invite, translate, records, stats, purge, rotate, archive, selftest
//   go(hash)     navigate, hash without '#' (go('clock/2026-10-12'))
//   render()     redraw the current screen after this file changed its own state
//   toast(msg, tone)
//   now()        Date.now (a fixed clock in tests)
//   saveTask(t)  Message and Review. t is a full copy of the sheet with the office fields changed (reply, replyAt, replyBy, review,
//                reviewer, followUp, assignAt, updatedAt). Store it in place of the sheet with the same uid, persist, file it as a review does, redraw.
//   remove(kind, key)  Delete. Take the record out of this phone's stores the way the app's own delete does ('task': a sheet by uid,
//                'report': by date) and persist; resolve true if it removed something. Called after the hub purge, so it may find nothing.
//   ask(msg, yes, tone)  optional, defaults to shared.ask (tests pass their own)
//
// Wiring (tasks.html), all of it mechanical:
//   routes     #live -> liveView(ctx);  #records/people|sheets|reports -> recordsView(ctx, sub);  Settings gets hubSettingsView(ctx)
//   after a view is in the page: after(ctx, app)   (translates the typed text on screen, loads the storage meter)
//   clicks     if (owns(a)) act(ctx, a, el)        (data-act values start with live, rec, hub or tx)
//   typing     onInput(ctx, el)                    (the search box and the translated previews; returns true if it used the event)
//   header     statusDot(hubStatus(), getLang(), 'live') in .top-in; a phone opening a join link: joinSheet(ctx, data)
//   text       txView(ctx, text, lang, viewerLang) wherever typed text is read-only; txField(...) where it is edited
//   delete     a PM deleting a sheet or report anywhere should go through deleteRecord(ctx, kind, key), so the hub copy goes too
//   bar        these screens use no bottom bar: hide it, as Settings does
//   paste      hubSettingsView on a phone with no hub offers the app's own data-act="paste" (Open a link someone sent you)

import { KEYS, COMPANY, L, getLang, esc, iso, addDays, niceDate, t12, fmtMin, worked, nameKey, crewVar, field, sheet, ask, sendSheet, download, load, save, personById, crewById } from './shared.mjs';
import { monday, shiftMin, byPerson, personKey, timesheetCsv } from './report.mjs';
import { duplicateShortIds } from './sync.mjs';

// ---------- small things ----------

const OFF = { state: 'off', message: '', at: 0, pending: 0, role: '', crew: '', rev: 0 };
const hub = ctx => ctx.sync?.hubStatus?.() || OFF;
const list = x => Object.values(x && typeof x === 'object' ? x : {}); // an array, or a date-keyed object of reports
const nowOf = ctx => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
const dayOf = ms => iso(new Date(ms));
const lg = l => (l === 'es' ? 'es' : 'en'); // a missing or unknown language is English
const $ = id => globalThis.document?.getElementById(id);
const roleName = r => (r === 'pm' ? L('Project manager') : r === 'super' ? L('Superintendent') : r === 'crew' ? L('Crew') : '');
const arrOf = x => (Array.isArray(x) ? x : []);
const shiftsOf = ctx => arrOf(ctx.shifts?.());
const sheetHref = u => (typeof u === 'string' && /^https:\/\/docs\.google\.com\/spreadsheets\/[\w\-/.?=&#%]{0,250}$/.test(u) ? u : ''); // the PM taps this: only a Google Sheet
const sheetLink = u => (sheetHref(u) ? `<a class="btn" href="${esc(sheetHref(u))}" target="_blank" rel="noopener noreferrer">${L('Open the Google Sheet')}</a>` : '');
const pill = (label, tone = '') => `<span class="pill" data-tone="${tone}">${esc(label)}</span>`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const MSG_MAX = 1000, PAGE = 100; // PAGE: rows a list draws before "Show more"
const GOT = new Set(['live', 'syncing', 'offline', 'error']);

// What this file remembers between draws (filters, what is open, the last answers from the hub).
const fresh = () => ({ siteOpen: false, sub: '', q: '', crew: '', status: '', person: '', limit: PAGE, old: null, stats: undefined, want: false, archived: null, test: null, busy: '' });
const ui = fresh();
export const resetUi = () => Object.assign(ui, fresh());

// ---------- time ----------

// "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", then the date. now and ts in ms.
export function ago(ts, now, l = getLang()) {
  if (!ts) return '';
  const m = Math.floor(Math.max(0, now - ts) / 6e4);
  if (m < 1) return L('just now', {}, l);
  if (m < 60) return L('{n} min ago', { n: m }, l);
  if (m < 1440) return L('{n} h ago', { n: Math.floor(m / 60) }, l);
  const days = Math.round((Date.parse(dayOf(now) + 'T12:00') - Date.parse(dayOf(ts) + 'T12:00')) / 864e5); // calendar days, so a clock change can't skew it
  return days <= 1 ? L('yesterday', {}, l) : days < 7 ? L('{n} days ago', { n: days }, l) : niceDate(dayOf(ts), l);
}
const at = (date, hm) => new Date(`${date}T${hm}`).getTime() || 0;
const SHIFT_MS = 16 * 36e5; // report.mjs: a shift open longer than this was a missed clock-out

// ---------- task sheets ----------

// The pill on a sheet, as on the Tasks board: [label, tone].
export function stage(t) {
  if (t.review === 'Accepted') return [L('Accepted'), 'good'];
  if (t.review) return [L('Follow-up'), 'warn'];
  if (t.status) return [L(t.status), { Complete: 'good', Partial: 'warn', Blocked: 'bad' }[t.status] || ''];
  if (t.aStart) return [L('Working'), 'info'];
  if (t.sentAt) return [L('Sent'), 'info'];
  return [L('Draft'), ''];
}
// How soon a sheet needs the office, lowest first: blocked, finished and waiting for review, working, follow-up open,
// sent and not started, draft, accepted.
export function rank(t) {
  if (t.review === 'Accepted') return 6;
  if (t.review) return 3;
  if (t.status === 'Blocked') return 0;
  if (t.status) return 1;
  if (t.aStart) return 2;
  return t.sentAt ? 4 : 5;
}
// The newest sign of life from the crew: a tick, results sent, the start or stop they tapped. 0 when there is none.
export function lastActivity(t) {
  let m = t.resultAt || 0;
  for (const i of [...t.items, ...t.checks]) m = Math.max(m, i.at || 0);
  if (t.aStart) m = Math.max(m, at(t.date, t.aStart));
  if (t.aStop) m = Math.max(m, at(t.date, t.aStop) + (t.aStop < t.aStart ? 864e5 : 0)); // a stop before the start is the next morning
  return m;
}
export const progress = t => ({ d: t.items.filter(i => i.done).length, n: t.items.length });
// Where tapping a sheet goes: the review when it waits for one, else the assignment. Always by uid: a short id can repeat.
const taskHref = t => `#task/${esc(t.uid)}/${t.status && !t.review ? 'review' : 'assign'}`;
// The sheet a reference means: its uid, or (from an older hub) its short id, which counts only while one sheet on the
// newest day with it has it.
function sheetFinder(tasks) {
  const byUid = new Map(tasks.map(t => [t.uid, t])), newest = new Map(), twice = new Set();
  for (const t of tasks) {
    if (!t.id) continue;
    const o = newest.get(t.id);
    if (!o || o.date < t.date) { newest.set(t.id, t); twice.delete(t.id); } else if (o.date === t.date) twice.add(t.id);
  }
  return ref => (ref ? byUid.get(ref) || (twice.has(ref) ? undefined : newest.get(ref)) : undefined);
}
const sameNo = () => pill(L('Same number as another sheet'), 'warn');
const finished = t => t.status === 'Complete' || t.review === 'Accepted';
const byRelevance = (a, b) => rank(a) - rank(b) || lastActivity(b) - lastActivity(a) || String(a.id).localeCompare(b.id);
export const sortSheets = l => [...l].sort(byRelevance);
// Crews as groups: the crew with the most urgent sheet first, then the order of the crew list; sheets with no crew last.
export function groupByCrew(sheets, order = []) {
  const m = new Map();
  for (const t of sheets) (m.get(t.crew) || m.set(t.crew, []).get(t.crew)).push(t);
  const pos = c => { const i = order.indexOf(c); return i < 0 ? order.length : i; };
  return [...m].map(([crew, ts]) => ({ crew, sheets: sortSheets(ts) }))
    .sort((a, b) => (a.crew === '') - (b.crew === '') || rank(a.sheets[0]) - rank(b.sheets[0]) || pos(a.crew) - pos(b.crew) || a.crew.localeCompare(b.crew));
}
const haystack = t => nameKey([t.date, t.id, t.crew, t.floor, t.area, t.lead, t.by, t.scope, t.refs, t.members.join(' '), t.doneText, t.remain, t.comments, t.followUp, t.reply].join(' '));
export const SHEET_FILTERS = ['', 'review', 'Blocked', 'Accepted', 'Follow-up needed'];
const inFilter = (t, f) => !f || (f === 'review' ? !!t.status && !t.review : f === 'Blocked' ? t.status === 'Blocked' : f === 'Accepted' ? t.review === 'Accepted' : !!t.review && t.review !== 'Accepted');
// q: every word must appear somewhere on the sheet (case and accents ignored). Newest day first.
export function filterSheets(tasks, { q = '', crew = '', status = '' } = {}) {
  const words = nameKey(q).split(' ').filter(Boolean);
  return tasks.filter(t => (!crew || t.crew === crew) && inFilter(t, status) && (!words.length || words.every(w => haystack(t).includes(w))))
    .sort((a, b) => b.date.localeCompare(a.date) || byRelevance(a, b));
}

// ---------- people and hours ----------

// Payroll hundredths, rounded per shift like report.mjs (cents there is not exported), so rows add up to the totals.
const hundredths = s => Math.round(shiftMin(s) * 5 / 3);
export const h2 = c => (c / 100).toFixed(2);
const byStart = (a, b) => at(a.date, a.in) - at(b.date, b.in);
const missed = (s, now) => !s.out && now - at(s.date, s.in) >= SHIFT_MS;
// Each person (the timesheets of report.mjs byPerson: by roster id, else by name however typed), their Monday to Sunday
// weeks newest first, and the shifts in each. key: which timesheet; two people sharing a name are two. hours: hundredths.
// open: shifts with no clock-out that are past a real shift's length; live: clocked in now.
// ponytail: recomputed on every draw and keystroke; about 40 ms at 3,600 shifts (60 people, 60 days). Cache by length if the timesheet outgrows that.
export function peopleWeeks(shifts, S, now = Date.now()) {
  return byPerson(shifts.filter(s => !s.gone), undefined, S).map(p => {
    const weeks = new Map();
    for (const s of p.shifts) { const m = monday(s.date); (weeks.get(m) || weeks.set(m, []).get(m)).push(s); }
    return {
      key: p.key, pid: p.pid, who: p.who, crew: p.crew, crewId: p.crewId, hours: p.hours, shifts: p.shifts.length,
      weeks: [...weeks].sort((a, b) => b[0].localeCompare(a[0])).map(([mon, ss]) => ({
        mon, shifts: ss.sort(byStart), hours: ss.reduce((n, s) => n + hundredths(s), 0),
        open: ss.filter(s => missed(s, now)).length, live: ss.filter(s => !s.out && !missed(s, now)).length,
      })),
    };
  });
}
// The accountant's spreadsheet for one Monday to Sunday week (one person if key, a peopleWeeks key, is given), the same file Send to accountant makes.
export function weekCsv(shifts, mon, S, key = '') {
  const sun = addDays(mon, 6), week = shifts.filter(s => !s.gone && s.date >= mon && s.date <= sun).sort(byStart);
  return timesheetCsv(byPerson(week, 'en', S).filter(p => !key || p.key === key));
}
// Someone a shift, an on-site line or a feed line is about, as the roster has them now: key (as byPerson), name and crew.
// A person the roster does not know keeps the name and crew the record was made with.
function personNow(S, x) {
  const key = personKey(S, x), p = personById(S, key);
  return { key, name: p?.name || x.who || '', crew: p?.crew || crewById(S, x.crewId)?.name || x.crew || '', crewId: p?.crewId || x.crewId || '' };
}
// Who is on site: open shifts started less than 16 hours ago, one line per person (the newest shift), under the roster's
// current name and crew. entries: [{who, date, in, pid?, crew?, crewId?}]. A line with only a name (from a hub that sends
// no ids) is left out when someone with that name is already on the list.
export function onSite(entries, now, S) {
  const seen = new Map();
  for (const e of entries) {
    const since = at(e.date, e.in);
    if (!e.who || !since || since > now + 5 * 6e4 || now - since >= SHIFT_MS) continue; // a few minutes of clock difference between phones is normal
    const p = personNow(S, e);
    if (!seen.has(p.key) || since > seen.get(p.key).since) seen.set(p.key, { key: p.key, who: p.name, in: e.in, date: e.date, crew: p.crew, crewId: p.crewId, since });
  }
  const named = new Set([...seen.values()].filter(x => !x.key.startsWith('n:')).map(x => nameKey(x.who)));
  return [...seen.values()].filter(x => !x.key.startsWith('n:') || !named.has(nameKey(x.who))).sort((a, b) => a.who.localeCompare(b.who) || a.crew.localeCompare(b.crew));
}
export const openShifts = shifts => shifts.filter(s => !s.gone && !s.out).map(s => ({ who: s.who, pid: s.pid, date: s.date, in: s.in, crew: s.crew, crewId: s.crewId }));

// ---------- the activity feed ----------

// One server event as a sentence in the phone's language. The hub writes English text; names, ids and statuses are
// carried over and the sentence is rebuilt, so only a kind this app doesn't know shows the hub's own words.
export function eventLine(e, l = getLang()) {
  const x = (en, v) => L(en, v, l), who = e.who || '', ref = e.ref || '', text = e.text || '';
  const end = words => words.find(w => text.endsWith(' ' + w));
  switch (e.kind) {
    case 'task.created': return who ? x('{who} created {ref}', { who, ref }) : x('New task {ref}', { ref });
    case 'task.started': return who ? x('{who} started {ref}', { who, ref }) : x('Started {ref}', { ref });
    case 'task.status': { const s = end(['Complete', 'Partial', 'Blocked']); return s ? x('{ref} marked {status}', { ref, status: x(s) }) : text; }
    case 'task.reviewed': { const r = end(['Accepted', 'Follow-up needed']); return r ? x('{ref} reviewed: {review}', { ref, review: x(r) }) : text; }
    case 'task.replied': return x('Message sent on {ref}', { ref });
    case 'clock.in': return x('{who} clocked in', { who });
    case 'clock.out': return x('{who} clocked out', { who });
    case 'report.sent': return /^\d{4}-\d{2}-\d{2}$/.test(ref) ? x('Daily report for {date} sent', { date: niceDate(ref, l) }) : text;
    default: return text || e.kind || '';
  }
}

// ---------- the header dot ----------

export function hubLabel(state, l = getLang()) {
  // literal L() calls, so the Spanish test sees every key
  return state === 'live' ? L('Live', {}, l) : state === 'syncing' ? L('Syncing', {}, l) : state === 'offline' ? L('Offline', {}, l) : state === 'error' ? L('Problem', {}, l) : L('Not connected', {}, l);
}
// The small header indicator: nothing without a hub. go: where a tap leads ('live' on office phones, 'settings' on crew phones).
export function statusDot(status, l = getLang(), go = 'settings') {
  const s = status?.state;
  if (!GOT.has(s)) return '';
  const n = status.pending | 0, label = L('Hub: {state}', { state: hubLabel(s, l) }, l) + (n && s !== 'live' ? `, ${L('{n} not sent yet', { n }, l)}` : '');
  return `<button type="button" class="icon-btn hubdot" data-go="${esc(go)}" data-state="${s}" aria-label="${esc(label)}" title="${esc(label)}"><i></i></button>`;
}

// ---------- typed text in the reader's language ----------
// Text keeps the language it was written in. The reader sees it translated, with "Auto-translated" and one tap back to
// the original. Nothing here waits: the original is drawn at once, after() asks the hub for the rest, and the answers
// are remembered for this session so the next draw already has them. No hub: the text is drawn exactly as it always was.

const mem = new Map(), MEM_MAX = 400;
const memGet = (f, t, s) => mem.get(`${f}>${t}|${s}`);
const memPut = (f, t, s, v) => { mem.set(`${f}>${t}|${s}`, v); if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };

function txInner(mode, state, orig, trans, toggle = true) { // every piece of text is escaped here
  const o = esc(orig), t = esc(trans);
  if (mode === 'pre') {
    const src = `<span class="tx-o" hidden>${o}</span>`;
    return state === 'done' ? `${src}<b>${L('Auto-translated')}:</b> <span class="tx-t">${t}</span>` : state === 'na' ? `${src}${L('A translated preview is not available right now.')}` : src;
  }
  if (state === 'done') { // toggle off (inside a dialog, where a tap would close it): the translation and its caption only
    return `<span class="tx-o">${o}</span><span class="tx-t">${t}</span>` + (toggle
      ? `<small class="tx-cap"><span class="tx-c-t">${L('Auto-translated')} · <button type="button" class="link" data-act="txToggle">${L('See original')}</button></span>`
        + `<span class="tx-c-o">${L('Original text')} · <button type="button" class="link" data-act="txToggle">${L('See translation')}</button></span></small>`
      : `<small class="tx-cap">${L('Auto-translated')}</small>`);
  }
  return `<span class="tx-o">${o}</span>` + (state === 'na' ? `<small class="tx-cap">${L('Original text. Translation is not available right now.')}</small>` : '');
}
const txHost = (mode, state, from, to, attrs = '') => `<${mode === 'pre' ? 'p' : 'span'} class="tx${mode === 'pre' ? ' tx-pre hint' : ''}" data-mode="${mode}" data-state="${state}" data-view="t" data-from="${from}" data-to="${to}"${attrs}`;

// Read-only text: from is the language it was written in (aLang, cLang, report lang; empty means English).
// o.toggle false leaves out the tap to see the original (inside a dialog, where any tap on a button closes it).
export function txView(ctx, text, from, viewer = getLang(), o = {}) {
  text = String(text ?? '');
  const f = lg(from), v = lg(viewer), toggle = o.toggle !== false;
  if (!text.trim() || f === v || hub(ctx).state === 'off') return esc(text);
  const hit = memGet(f, v, text), state = hit === undefined ? 'pending' : hit !== text ? 'done' : 'same';
  return `${txHost('view', state, f, v, toggle ? '' : ' data-toggle="0"')}>${txInner('view', state, text, state === 'done' ? hit : '', toggle)}</span>`;
}
// An editable field keeps its own text; under it, a translated preview when the text is not in the reader's language.
export function txField(ctx, label, k, value, o = {}, from = 'en', viewer = getLang()) {
  const f = lg(from), v = lg(viewer), text = String(value ?? '');
  const base = field(label, k, text, o);
  if (!text.trim() || f === v || hub(ctx).state === 'off') return base;
  const hit = memGet(f, v, text), state = hit === undefined ? 'pending' : hit !== text ? 'done' : 'same';
  return base + `${txHost('pre', state, f, v, ` data-for="${esc(k)}"${state === 'same' || state === 'pending' ? ' hidden' : ''}`)}>${txInner('pre', state, text, state === 'done' ? hit : '')}</p>`;
}
function txSettle(ctx, el, orig, trans) {
  const unreachable = ['off', 'offline', 'error'].includes(hub(ctx).state);
  const state = typeof trans === 'string' && trans.trim() && trans !== orig ? 'done' : unreachable ? 'na' : 'same'; // 'same': names, numbers, or the hub's limit (it says so itself, once)
  el.dataset.state = state;
  el.removeAttribute?.('aria-busy');
  el.innerHTML = txInner(el.dataset.mode, state, orig, state === 'done' ? trans : '', el.dataset.toggle !== '0');
  if (el.dataset.mode === 'pre') el.hidden = state === 'same';
}
// Translate whatever is still waiting inside root, one request per language pair. Safe to call again at any time.
export async function txApply(ctx, root = globalThis.document) {
  if (!root?.querySelectorAll || !ctx.sync?.translate) return;
  const groups = new Map();
  for (const el of root.querySelectorAll('.tx[data-state="pending"]')) {
    el.dataset.state = 'busy'; // a second call while this one waits skips it
    el.setAttribute?.('aria-busy', 'true');
    const k = `${el.dataset.from}>${el.dataset.to}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(el);
  }
  await Promise.all([...groups].map(async ([k, els]) => {
    const [from, to] = k.split('>'), texts = els.map(el => el.querySelector('.tx-o')?.textContent ?? '');
    let out = texts;
    try { const r = await ctx.sync.translate(texts, from, to); if (Array.isArray(r)) out = r; } catch { /* offline: the originals stay */ }
    els.forEach((el, i) => {
      const trans = typeof out[i] === 'string' ? out[i] : texts[i];
      if (trans.trim() && trans !== texts[i]) memPut(from, to, texts[i], trans);
      txSettle(ctx, el, texts[i], trans);
    });
  }));
}

// ---------- Live ----------

export function liveView(ctx) {
  if (ctx.role !== 'pm' && ctx.role !== 'super') return `<div class="empty"><h2>${L('The live board is for the office')}</h2></div>`;
  const now = nowOf(ctx), day = dayOf(now), st = hub(ctx), live = { events: [], onsite: [], at: 0, info: {}, ...ctx.sync?.liveData?.() }, S = ctx.S;
  const sheets = ctx.tasks().filter(t => t.date === day), here = onSite([...openShifts(shiftsOf(ctx)), ...live.onsite], now, S);
  const sheetOf = sheetFinder(ctx.tasks()), shiftOf = new Map(shiftsOf(ctx).map(s => [s.id, s])), dup = duplicateShortIds(sheets);
  const updated = Math.max(live.at || 0, st.at || 0); // live.at moves only when something changed; st.at at every good round trip
  const head = `<section class="card live-head">
    <div class="row1"><span class="live-state"><i class="hub-dot" data-state="${esc(st.state)}"></i><b>${esc(hubLabel(st.state))}</b></span>
      ${st.state === 'off' ? `<button class="btn" data-go="settings">${L('Set up the hub')}</button>` : `<button class="btn" data-act="liveRefresh">${L('Refresh')}</button>`}</div>
    <p class="hint">${esc(st.state === 'off' ? L('Not connected to a hub. This shows what is on this phone.') : updated ? L('Updated {ago}', { ago: ago(updated, now) }) : L('Waiting for the first update'))}</p>
    ${st.pending ? `<p class="hint">${esc(L('{n} not sent yet', { n: st.pending }))}</p>` : ''}
    ${(st.state === 'offline' || st.state === 'error') && st.message ? `<p class="hint">${esc(st.message)}</p>` : ''}</section>`;
  const review = sheets.filter(t => t.status && !t.review).length, working = sheets.filter(t => t.aStart && !t.status).length;
  const stats = `<div class="stats three"><div class="stat"><b>${here.length}</b><span>${L('On site')}</span></div>
    <div class="stat"><b>${working}</b><span>${L('Active')}</span></div>
    <div class="stat"><b class="${review ? 'warn' : ''}">${review}</b><span>${L('To review')}</span></div></div>`;
  const site = siteCard(S, here);
  const groups = groupByCrew(sheets, S.crews.map(c => c.name));
  const board = sheets.length ? groups.map(g => `<h3 class="live-crew" style="${crewVar(S, g.crew)}"><span><i class="dot"></i> ${esc(g.crew || L('No crew yet'))}</span>
      <small>${esc(L('{d} of {n} done', { d: g.sheets.filter(finished).length, n: g.sheets.length }))}</small></h3>${g.sheets.map(t => (rank(t) === 6 ? doneRow(ctx, t) : sheetCard(ctx, t, now, dup.has(t.uid)))).join('')}`).join('')
    : `<div class="empty"><h2>${L('No task sheets for today yet')}</h2><button class="btn" data-go="day/${day}">${L('Open the Tasks tab')}</button></div>`;
  const feed = live.events.slice(0, 50);
  // a clock line names the person as the roster has them now (by the shift it is about); a sheet line says the sheet's crew
  const lineOf = e => {
    const task = String(e.kind).startsWith('task.'), t = task ? sheetOf(e.ref) : undefined, s = !task && shiftOf.get(e.ref);
    const p = s ? personNow(S, s) : personNow(S, { who: e.who }), crew = t ? crewById(S, t.crewId)?.name || t.crew : p.crew;
    return [t, `<span class="feed-x">${esc(eventLine({ ...e, who: p.name || e.who, ref: t?.id || e.ref }))}${crew ? ` <span class="feed-crew">· ${esc(crew)}</span>` : ''}</span>`];
  };
  const events = `<section class="card"><h2>${L('Activity')}</h2>${feed.length
    ? `<ol class="feed">${feed.map(e => { const [t, line] = lineOf(e);
      return `<li><small>${esc(ago(e.ts, now))}</small>${t ? `<a href="${taskHref(t)}">${line}</a>` : line}</li>`; }).join('')}</ol>`
    : `<p class="hint">${st.state === 'off' ? L('Connect the hub to see crews start, finish and clock in.') : L('Nothing yet. Crews starting, finishing and clocking in show up here.')}</p>`}</section>`;
  return `${head}${stats}${site}<h2 class="group-h"><span>${L("Today's sheets")}</span><span>${sheets.length}</span></h2>${board}${events}`;
}

// Who is on site, by crew. Past a dozen people the list folds up to one line of counts, so it can't push the sheets off the screen.
const SITE_FOLD = 12;
function siteCard(S, here) {
  const m = new Map(), order = S.crews.map(c => c.name), ids = new Map(here.map(p => [p.crew, p.crewId]));
  for (const p of here) (m.get(p.crew) || m.set(p.crew, []).get(p.crew)).push(p);
  const pos = c => { const i = order.indexOf(c); return i < 0 ? order.length : i; };
  const groups = [...m].sort((a, b) => (a[0] === '') - (b[0] === '') || pos(a[0]) - pos(b[0]) || a[0].localeCompare(b[0]));
  const label = c => (c ? `<i class="dot"></i> ${esc(c)}` : esc(L('Crew not set')));
  const open = here.length <= SITE_FOLD || ui.siteOpen;
  return `<section class="card"><h2>${L('On site now')}</h2>${!here.length ? `<p class="hint">${L('Nobody is clocked in right now.')}</p>`
    : open ? groups.map(([crew, ps]) => `<div class="onsite-g" style="${crew ? crewVar(S, crew, ids.get(crew)) : ''}"><span class="label">${label(crew)} · ${ps.length}</span>
        <div class="onsite">${ps.map(p => `<span><b>${esc(p.who)}</b><small>${esc(L('since {time}', { time: t12(p.in) }))}</small></span>`).join('')}</div></div>`).join('')
      : `<p class="hint">${groups.map(([crew, ps]) => `${crew ? esc(crew) : esc(L('Crew not set'))} ${ps.length}`).join(' · ')}</p>`}
    ${here.length > SITE_FOLD ? `<button class="link" data-act="liveSite">${ui.siteOpen ? L('Hide the list') : L('Show the list')}</button>` : ''}</section>`;
}
// An accepted sheet needs nothing more from the office: one line, so the sheets that do need it stay in view.
const doneRow = (ctx, t) => `<a class="live-done" style="${crewVar(ctx.S, t.crew, t.crewId)}" href="#task/${esc(t.uid)}/assign"><b class="tid">${esc(t.id || L('New task'))}</b>
  <span>${esc([t.floor, t.area].filter(Boolean).join(' · '))}</span>${pill(stage(t)[0], 'good')}</a>`;

function sheetCard(ctx, t, now, dup) {
  const [label, tone] = stage(t), { d, n } = progress(t), la = lastActivity(t), need = t.status && !t.review;
  const where = [t.floor, t.area].filter(Boolean).join(' · ') || L('Floor not set');
  const last = la ? L('Last activity {ago}', { ago: ago(la, now) }) : t.sentAt ? L('Sent {ago}', { ago: ago(t.sentAt, now) }) : L('Not started');
  const note = t.status === 'Blocked' ? t.comments || t.remain : t.status === 'Partial' ? t.remain || t.comments : '';
  return `<article class="tcard live-card" style="${crewVar(ctx.S, t.crew, t.crewId)}">
    <a class="live-main" href="${taskHref(t)}">
      <div class="row1"><span class="tid">${esc(t.id || L('New task'))}</span>${pill(label, tone || '')}${dup ? sameNo() : ''}</div>
      <div class="meta"><span>${esc(where)}</span>${n ? `<span>${esc(L('{d} of {n} steps done', { d, n }))}</span>` : ''}</div>
      ${n ? `<div class="progress" role="img" aria-label="${esc(L('{d} of {n} steps done', { d, n }))}"><i style="width:${d / n * 100}%"></i></div>` : ''}
      <div class="meta"><span>${esc(last)}</span>${t.reply && t.replyAt ? `<span>${esc(L('Message sent {ago}', { ago: ago(t.replyAt, now) }))}</span>` : ''}</div></a>
    ${note ? `<div class="live-note"><span class="label">${L('Crew notes')}</span>${txView(ctx, clip(note, 240), t.cLang)}</div>` : ''}
    <div class="btns live-acts">${need ? `<button class="btn primary" data-act="liveReview" data-u="${esc(t.uid)}">${L('Review')}</button>` : ''}<button class="btn" data-act="liveMsg" data-u="${esc(t.uid)}">${L('Message')}</button></div></article>`;
}

// What a message or a review writes into a sheet (office fields only), stamped so the newest wins on every phone.
// ponytail: HUB.md has no language field for a reply, so it is read as the sheet's aLang. An office phone that types Spanish
// on an English sheet gets its reply shown untranslated (or mistranslated); add replyLang to the contract when that happens.
export function withMessage(t, text, ms, by) {
  const stamp = Math.max(ms, (t.assignAt || 0) + 1);
  return { ...t, reply: text.trim().slice(0, MSG_MAX), replyAt: stamp, replyBy: by, assignAt: stamp };
}
export function withReview(t, review, note, ms, by) {
  const stamp = Math.max(ms, (t.assignAt || 0) + 1);
  return { ...t, review, reviewer: by, followUp: review === 'Follow-up needed' && note.trim() ? note.trim().slice(0, MSG_MAX) : t.followUp, assignAt: stamp, updatedAt: Math.max(ms, (t.updatedAt || 0) + 1) };
}
const latest = (ctx, uid) => ctx.tasks().find(t => t.uid === uid); // act on the sheet as it is now, not as it was when the sheet opened
const byWho = ctx => ctx.S.me || roleName(ctx.role);

function messageSheet(ctx, t) {
  const now = nowOf(ctx);
  const d = sheet(`<h3>${esc(L('Message to {crew}', { crew: t.crew || L('the crew') }))}</h3>
    <p class="hint">${esc(L('Task {id}', { id: t.id }))} · ${L('The crew sees it on their sheet, in their language.')}</p>
    ${t.reply ? `<p class="preview">${esc(t.reply)}<br><small>${esc(L('Last message {ago}. A new one replaces it.', { ago: ago(t.replyAt, now) }))}</small></p>` : ''}
    <label class="field"><span>${L('Your message')}</span><textarea rows="4" maxlength="${MSG_MAX}"></textarea></label>
    <div class="btns"><button class="btn primary" data-send>${L('Send')}</button></div>`);
  d.querySelector('textarea').focus();
  d.querySelector('[data-send]').onclick = () => {
    const text = d.querySelector('textarea').value;
    if (!text.trim()) return ctx.toast(L('Type a message first'), 'bad');
    const cur = latest(ctx, t.uid);
    if (!cur) { d.close(); return ctx.toast(L('That sheet is gone'), 'bad'); }
    ctx.saveTask(withMessage(cur, text, nowOf(ctx), byWho(ctx)));
    d.close();
    ctx.toast(L('Message sent to {crew}', { crew: t.crew || L('the crew') }));
    ctx.render();
  };
}

function reviewSheet(ctx, t) {
  const w = worked(t), { d: done, n } = progress(t), tx = text => txView(ctx, text, t.cLang, getLang(), { toggle: false });
  const row = (k, html) => (html ? `<dt>${esc(k)}</dt><dd>${html}</dd>` : '');
  const d = sheet(`<h3>${esc(L('Review {id}', { id: t.id }))}</h3>
    <dl class="kv">${row(L('Status'), t.status && esc(L(t.status)))}${row(L('Steps'), n && esc(L('{d} of {n} done', { d: done, n })))}${row(L('Worked'), w && esc(fmtMin(w)))}
      ${row(L('Completed'), t.doneText && tx(t.doneText))}${row(L('Remaining'), t.remain && tx(t.remain))}${row(L('Crew notes'), t.comments && tx(t.comments))}</dl>
    <div class="btns"><button class="btn primary" data-r="Accepted">${L('Accepted')}</button><button class="btn" data-r="Follow-up needed">${L('Follow-up needed')}</button></div>
    <label class="field" data-note hidden><span>${L('Follow-up / next step')}</span><textarea rows="3" maxlength="${MSG_MAX}">${esc(t.followUp)}</textarea></label>
    <div class="btns" data-save hidden><button class="btn primary" data-r="Follow-up needed" data-go-save>${L('Save follow-up')}</button></div>`);
  after(ctx, d);
  const finish = review => {
    const cur = latest(ctx, t.uid);
    if (!cur) { d.close(); return ctx.toast(L('That sheet is gone'), 'bad'); }
    ctx.saveTask(withReview(cur, review, d.querySelector('textarea').value, nowOf(ctx), byWho(ctx)));
    d.close();
    ctx.toast(L('Review saved'));
    ctx.render();
  };
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    if (b.dataset.r === 'Accepted' || b.hasAttribute('data-go-save')) return finish(b.dataset.r);
    d.querySelector('[data-note]').hidden = d.querySelector('[data-save]').hidden = false; // follow-up: say what is needed, then save
    d.querySelector('textarea').focus();
  });
}

// ---------- Records ----------

const weekLabel = mon => L('{start} to {stop}', { start: niceDate(mon), stop: niceDate(addDays(mon, 6)) });
const crewDot = (S, crew, id = '') => (crew ? `<span style="${crewVar(S, crew, id)}"><i class="dot"></i> ${esc(crew)}</span>` : '');

export function recordsView(ctx, sub) {
  if (ctx.role !== 'pm' && ctx.role !== 'super') return `<div class="empty"><h2>${L('Records are for the office')}</h2></div>`;
  const subs = ctx.role === 'pm' ? ['people', 'sheets', 'reports'] : ['sheets', 'reports'], names = { people: L('By person'), sheets: L('Task sheets'), reports: L('Reports') };
  if (!subs.includes(sub)) sub = subs[0];
  if (ui.sub !== sub) Object.assign(ui, { sub, q: '', crew: '', status: '', person: '', limit: PAGE, old: null });
  const tabs = `<nav class="tabs" aria-label="${L('Records')}">${subs.map(s => `<a href="#records/${s}"${s === sub ? ' aria-current="page"' : ''}>${esc(names[s])}</a>`).join('')}</nav>`;
  return tabs + (sub === 'people' ? peopleSub(ctx) : sub === 'sheets' ? sheetsSub(ctx) : reportsSub(ctx)) + olderCard(ctx, { people: 'shifts', sheets: 'tasks', reports: 'reports' }[sub]) + toolsCard(ctx);
}
const searchBox = (ph, aria) => `<input type="search" id="recQ" data-lv="q" data-enter="recSearch" enterkeyhint="search" autocomplete="off" value="${esc(ui.q)}" placeholder="${esc(ph)}" aria-label="${esc(aria)}">`;
const chip = (f, v, label, style = '') => `<button class="chip" data-act="recFilter" data-f="${f}" data-v="${esc(v)}" aria-pressed="${ui[f] === v}"${style ? ` style="${style}"` : ''}>${esc(label)}</button>`;

function peopleSub(ctx) {
  const now = nowOf(ctx), all = peopleWeeks(shiftsOf(ctx), ctx.S, now);
  const one = ui.person && all.find(p => p.key === ui.person); // by timesheet key: two people may share a name
  if (ui.person && !one) ui.person = ''; // gone from the timesheet since
  if (one) return personDetail(ctx, one, now);
  return `<div class="rec-controls">${searchBox(L('Search names'), L('Search names'))}</div><div id="recList" class="stack">${peopleList(ctx, all)}</div>`;
}
function peopleList(ctx, all = peopleWeeks(shiftsOf(ctx), ctx.S, nowOf(ctx))) {
  const mon = monday(dayOf(nowOf(ctx))), last = addDays(mon, -7), q = nameKey(ui.q);
  const ps = all.filter(p => !q || nameKey(p.who).includes(q));
  if (!ps.length) return shiftsOf(ctx).some(s => !s.gone) ? `<p class="hint">${L('Nobody matches.')}</p>`
    : `<div class="empty"><h2>${L('No hours logged yet')}</h2><p>${L("Each worker's Clock in and Clock out texts you a link. Tap it on this phone to log their hours here.")}</p></div>`;
  return `<h2 class="group-h"><span>${L('Hours by person')}</span><span>${ps.length}</span></h2>` + ps.map(p => {
    const wk = d => p.weeks.find(w => w.mon === d), cur = wk(mon), open = p.weeks.reduce((n, w) => n + w.open, 0);
    return `<button class="rec-row" data-act="recPerson" data-v="${esc(p.key)}"><span class="rec-main"><b class="tid">${esc(p.who)}</b>
      <small>${crewDot(ctx.S, p.crew, p.crewId)}${p.crew ? ' · ' : ''}${esc(L('Last week: {n} hrs', { n: h2(wk(last)?.hours || 0) }))}</small>${open ? pill(L('No clock-out'), 'warn') : cur?.live ? pill(L('On the clock'), 'info') : ''}</span>
      <span class="rec-side"><b>${h2(cur?.hours || 0)}</b><small>${L('This week')}</small></span></button>`;
  }).join('');
}
function personDetail(ctx, p, now) {
  const pm = ctx.role === 'pm', byUid = new Map(ctx.tasks().map(t => [t.uid, t]));
  return `<button class="link" data-act="recPerson" data-v="">‹ ${L('All people')}</button>
    <section class="card person"><div class="row1"><h2>${esc(p.who)}</h2><b class="total">${esc(L('{n} hrs', { n: h2(p.hours) }))}</b></div>
      <div class="chips">${crewDot(ctx.S, p.crew, p.crewId)}<span class="hint">${esc(p.shifts === 1 ? L('1 shift') : L('{n} shifts', { n: p.shifts }))}</span></div></section>
    ${p.weeks.map((w, i) => `<details class="card rec-week"${i === 0 ? ' open' : ''}>
      <summary><span class="rec-main"><b>${esc(weekLabel(w.mon))}</b>${w.open ? pill(L('No clock-out'), 'warn') : w.live ? pill(L('On the clock'), 'info') : ''}</span><b class="total">${esc(L('{n} hrs', { n: h2(w.hours) }))}</b></summary>
      ${w.shifts.map(s => shiftRow(s, now, byUid)).join('')}
      ${pm ? `<div class="btns"><button class="btn" data-go="clock/${w.mon}">${L('Edit hours')}</button><button class="btn" data-act="recWeekCsv" data-mon="${w.mon}" data-v="${esc(p.key)}" data-name="${esc(p.who)}">${L('Download week (CSV)')}</button></div>` : ''}</details>`).join('')}`;
}
// A shift's sheets open by uid and show the number the sheet has now; one this phone does not have shows the number it had.
function shiftRow(s, now, byUid) {
  const edited = s.edited.in || s.edited.out;
  const links = s.tasks.map(x => (typeof x === 'string' ? { uid: '', id: x } : x || {})).map(x => { const t = x.uid && byUid.get(x.uid), id = t?.id || x.id; return id ? (t ? `<a href="${taskHref(t)}">${esc(id)}</a>` : esc(id)) : ''; }).filter(Boolean);
  const ids = links.length === 1 ? L('Task {id}', { id: links[0] }) : links.length ? L('Tasks {ids}', { ids: links.join(', ') }) : ''; // the pieces are escaped above
  return `<div class="shift"><div class="row1"><b>${esc(niceDate(s.date))}</b><span class="out">${s.out ? esc(L('{n} hrs', { n: h2(hundredths(s)) })) : missed(s, now) ? pill(L('No clock-out'), 'warn') : pill(L('On the clock'), 'info')}${edited ? ` · ${L('edited')}` : ''}</span></div>
    <p class="hint">${esc(s.out ? L('{start} to {stop}', { start: t12(s.in), stop: t12(s.out) }) : t12(s.in))}${ids ? ' · ' + ids : ''}</p></div>`;
}

function sheetsSub(ctx) {
  const crews = [...new Set([...ctx.S.crews.map(c => c.name), ...ctx.tasks().map(t => t.crew)].filter(Boolean))];
  const st = { '': L('All'), review: L('To review'), Blocked: L('Blocked'), Accepted: L('Accepted'), 'Follow-up needed': L('Follow-up') };
  return `<div class="rec-controls">${searchBox(L('Search sheets'), L('Search sheets'))}
    <div class="chips scroll" role="group" aria-label="${L('Show crew')}">${chip('crew', '', L('All crews'))}${crews.map(c => chip('crew', c, c, crewVar(ctx.S, c))).join('')}</div>
    <div class="chips scroll" role="group" aria-label="${L('Show status')}">${SHEET_FILTERS.map(f => chip('status', f, st[f])).join('')}</div></div>
    <div id="recList" class="stack">${sheetsList(ctx)}</div>`;
}
function sheetsList(ctx) {
  const all = filterSheets(ctx.tasks(), ui), shown = all.slice(0, ui.limit), days = [...new Set(shown.map(t => t.date))], dup = duplicateShortIds(ctx.tasks());
  if (!all.length) return `<p class="hint">${ctx.tasks().length ? L('No sheets match.') : L('No task sheets on this phone yet.')}</p>`;
  return days.map(d => { const ts = shown.filter(t => t.date === d);
    return `<h2 class="group-h"><span>${esc(niceDate(d))}</span><span>${ts.length}</span></h2>${ts.map(t => sheetRow(ctx, t, dup.has(t.uid))).join('')}`; }).join('')
    + (all.length > shown.length ? `<button class="btn" data-act="recMore">${L('Show more')} (${all.length - shown.length})</button>` : '');
}
function sheetRow(ctx, t, dup) {
  const [label, tone] = stage(t), where = [t.floor, t.area].filter(Boolean).join(' · ');
  return `<div class="rec-row" style="${crewVar(ctx.S, t.crew, t.crewId)}"><a class="rec-main" href="${taskHref(t)}">
      <span class="row1"><b class="tid">${esc(t.id || L('New task'))}</b>${pill(label, tone || '')}${dup ? sameNo() : ''}</span>
      <small><i class="dot"></i> ${esc(t.crew || L('No crew yet'))}${where ? ' · ' + esc(where) : ''}</small>${t.scope ? `<small class="clamp">${esc(t.scope)}</small>` : ''}</a>
    ${ctx.role === 'pm' ? `<button class="rec-more" data-act="recMenu" data-kind="task" data-key="${esc(t.uid)}" aria-label="${esc(L('More actions'))}">⋯</button>` : ''}</div>`;
}

const reportsOf = ctx => list(ctx.reports()).filter(r => r.date && r.updatedAt).sort((a, b) => b.date.localeCompare(a.date));
const REPORT_TONE = { 'On plan': 'good', 'At risk': 'warn', 'Behind plan': 'bad' };
function reportsSub(ctx) {
  return `<div class="rec-controls">${searchBox(L('Search reports'), L('Search reports'))}</div><div id="recList" class="stack">${reportsList(ctx)}</div>`;
}
function reportsList(ctx) {
  const words = nameKey(ui.q).split(' ').filter(Boolean), all = reportsOf(ctx);
  const rs = all.filter(r => { const h = nameKey([r.date, r.status, r.super, r.preparedBy, r.results, r.wins, r.issues, r.pmReview].join(' ')); return words.every(w => h.includes(w)); });
  if (!rs.length) return `<p class="hint">${all.length ? L('No reports match.') : L('No daily reports on this phone yet.')}</p>`;
  return rs.slice(0, ui.limit).map(r => { const wait = r.decisions.filter(d => d.q && !d.pm).length;
    return `<div class="rec-row"><a class="rec-main" href="#report/${esc(r.date)}">
        <span class="row1"><b class="tid">${esc(niceDate(r.date))}</b>${r.status ? pill(L(r.status), REPORT_TONE[r.status] || '') : ''}</span>
        <small>${esc([r.super, wait ? L('{n} waiting', { n: wait }) : '', r.pmReview ? L('PM reviewed: {note}', { note: r.pmReview }) : ''].filter(Boolean).join(' · '))}</small>${r.results ? `<small class="clamp">${esc(r.results)}</small>` : ''}</a>
      ${ctx.role === 'pm' ? `<button class="rec-more" data-act="recMenu" data-kind="report" data-key="${esc(r.date)}" aria-label="${esc(L('More actions'))}">⋯</button>` : ''}</div>`; }).join('')
    + (rs.length > ui.limit ? `<button class="btn" data-act="recMore">${L('Show more')} (${rs.length - ui.limit})</button>` : '');
}

// Older records come from the hub a page at a time and are shown, not stored.
const hubFor = (ctx, kind) => { const h = hub(ctx); return h.state !== 'off' && (h.role === 'pm' || (h.role === 'super' && kind !== 'shifts')); };
function olderCard(ctx, kind) {
  if (!hubFor(ctx, kind)) return '';
  const o = ui.old?.kind === kind ? ui.old : null, S = ctx.S, items = o ? o.items : [];
  let body = '';
  if (kind === 'shifts' && items.length) body = peopleWeeks(items, S, nowOf(ctx)).map(p => `<details class="rec-old"><summary><b>${esc(p.who)}</b><span>${esc(L('{n} hrs', { n: h2(p.hours) }))}</span></summary>
      ${p.weeks.map(w => `<p class="hint">${esc(weekLabel(w.mon))} · ${esc(L('{n} hrs', { n: h2(w.hours) }))} · ${esc(L('{n} shifts', { n: w.shifts.length }))}</p>`).join('')}</details>`).join('');
  if (kind === 'tasks') body = items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200).map(t => oldTask(ctx, t)).join('');
  if (kind === 'reports') body = items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200).map(r => oldReport(r)).join('');
  return `<section class="card"><h2>${L('Older records on the hub')}</h2>
    <p class="hint">${L('Records older than this phone keeps are on the hub. Loading them does not save them on this phone.')}</p>
    ${body}${o?.err ? `<p class="hint" role="alert">${esc(o.err)}</p>` : ''}${o && !o.busy && !o.cursor && !o.err ? `<p class="hint">${items.length ? L('That is everything the hub has.') : L('The hub has nothing older.')}</p>` : ''}
    ${!o || o.cursor || o.err ? `<div class="btns"><button class="btn" data-act="recOlder" data-kind="${kind}"${o?.busy ? ' disabled' : ''}>${o?.busy ? L('Loading…') : o ? L('Load more') : L('Load older records')}</button></div>` : ''}</section>`;
}
const kv = (k, html) => (html ? `<dt>${esc(k)}</dt><dd>${html}</dd>` : '');
function oldTask(ctx, t) {
  const [label, tone] = stage(t);
  return `<details class="rec-old"><summary><b>${esc(niceDate(t.date))} · ${esc(t.id)}</b><span>${esc(t.crew)}</span>${pill(label, tone || '')}</summary><dl class="kv">
    ${kv(L('Floor / level'), esc([t.floor, t.area].filter(Boolean).join(' · ')))}${kv(L('Work, quantities and limits of scope'), t.scope && txView(ctx, t.scope, t.aLang))}${kv(L('Completed'), t.doneText && txView(ctx, t.doneText, t.cLang))}
    ${kv(L('Remaining'), t.remain && txView(ctx, t.remain, t.cLang))}${kv(L('Crew notes'), t.comments && txView(ctx, t.comments, t.cLang))}${kv(L('Reviewed by'), esc([t.review ? L(t.review) : '', t.reviewer].filter(Boolean).join(' · ')))}
    ${kv(L('Follow-up / next step'), t.followUp && txView(ctx, t.followUp, t.aLang))}${kv(L('Your message'), t.reply && txView(ctx, t.reply, t.aLang))}</dl></details>`;
}
function oldReport(r) {
  return `<details class="rec-old"><summary><b>${esc(niceDate(r.date))}</b><span>${esc(r.super)}</span>${r.status ? pill(L(r.status), REPORT_TONE[r.status] || '') : ''}</summary><dl class="kv">
    ${kv(L('Overall status & today’s results'), esc(r.results))}${kv(L('Site issues, concerns & coordination'), esc(r.issues))}${kv(L('PM review / time'), esc(r.pmReview))}</dl></details>`;
}

// ---------- Records: export, week CSV, hub storage ----------

export const meter = s => { const pct = s.cellLimit > 0 ? Math.min(100, Math.round(s.cells / s.cellLimit * 100)) || 0 : 0; return { pct, warn: pct >= 70 }; };
const MIN_ARCHIVE_DAYS = 30; // never archive what crews and the office are still working with

function toolsCard(ctx) {
  if (ctx.role !== 'pm') return '';
  const now = nowOf(ctx), mons = [...new Set(shiftsOf(ctx).filter(s => !s.gone).map(s => monday(s.date)))].sort().reverse();
  const h = hub(ctx), onHub = h.state !== 'off' && h.role === 'pm', locale = getLang() === 'es' ? 'es-US' : 'en-US';
  let hubPart = '';
  if (onHub) {
    ui.want = ui.stats === undefined; // after() fetches it once
    const s = ui.stats, m = s && s.ok ? meter(s) : null;
    hubPart = `<h3>${L('Hub storage')}</h3>${m
      ? `<div class="progress meter${m.warn ? ' warn' : ''}" role="img" aria-label="${esc(L('{pct}% of the Google Sheet is used', { pct: m.pct }))}"><i style="width:${m.pct}%"></i></div>
         <p class="hint">${esc(L('{pct}% used ({used} of {limit} cells)', { pct: m.pct, used: s.cells.toLocaleString(locale), limit: s.cellLimit.toLocaleString(locale) }))}${m.warn ? ' ' + pill(L('Almost full'), 'warn') : ''}</p>
         ${m.warn ? `<p class="hint">${L('Archive older records to make room.')}</p>` : ''}`
      : `<p class="hint">${s === 'loading' || s === undefined ? L('Checking…') : esc(s.message || L('Could not read the storage.'))}</p>`}
    <div class="btns">${sheetLink(s?.ok ? s.sheetUrl : ctx.sync.liveData?.().info?.sheetUrl)}<button class="btn" data-act="recStats">${L('Check again')}</button></div>
    <label class="field"><span>${L('Archive records older than')}</span><input type="date" id="recArch" value="${addDays(dayOf(now), -90)}" max="${addDays(dayOf(now), -MIN_ARCHIVE_DAYS)}"></label>
    <div class="btns"><button class="btn" data-act="recArchive"${ui.busy === 'archive' ? ' disabled' : ''}>${L('Archive older records')}</button></div>
    ${ui.archived ? `<p class="hint">${esc(L('Rows archived: {n}', { n: Object.values(ui.archived.moved).reduce((a, b) => a + b, 0) }))}</p><div class="btns">${sheetLink(ui.archived.sheetUrl)}</div>` : ''}`;
  }
  return `<section class="card"><h2>${L('Export and storage')}</h2>
    <div class="btns"><button class="btn" data-act="recExport"${ui.busy === 'export' ? ' disabled' : ''}>${L('Download all (JSON)')}</button></div>
    ${mons.length ? `<label class="field"><span>${L('Week')}</span><select id="recWeek">${mons.map(m => `<option value="${m}">${esc(weekLabel(m))}</option>`).join('')}</select></label>
      <div class="btns"><button class="btn" data-act="recCsv">${L('Download week (CSV)')}</button></div>` : ''}${hubPart}</section>`;
}

// Everything this phone holds, plus (when the hub is up) what the hub holds that this phone does not, a page at a time.
async function fetchAll(ctx, kind, now) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < 100; i++) { // ponytail: 100 pages of 200 is 20,000 records of a kind; past that the Google Sheet itself is the export
    const r = await ctx.sync.records({ kind, from: '2000-01-01', to: dayOf(now), cursor });
    if (!r.ok) throw r;
    out.push(...r.items);
    if (!r.cursor) return out;
    cursor = r.cursor;
  }
  return out;
}
export function exportData(ctx, now, extra = {}) {
  const merge = (mine, theirs = [], key) => { const have = new Set(mine.map(key)); return [...mine, ...theirs.filter(x => !have.has(key(x)))]; };
  return { app: 'schwab-field', project: ctx.S.project, exportedAt: new Date(now).toISOString(),
    tasks: merge(ctx.tasks(), extra.tasks, t => t.uid), shifts: merge(shiftsOf(ctx), extra.shifts, s => s.id), reports: merge(reportsOf(ctx), extra.reports, r => r.date) };
}
async function exportAll(ctx) {
  const now = nowOf(ctx), h = hub(ctx);
  let extra = {};
  if (h.state !== 'off' && h.role === 'pm') {
    ctx.toast(L('Collecting records from the hub…'));
    try { for (const kind of ['tasks', 'shifts', 'reports']) extra[kind] = await fetchAll(ctx, kind, now); } catch {
      extra = {};
      if (!await (ctx.ask || ask)(L('The hub did not answer. Download only what is on this phone?'), L('Download'))) return;
    }
  }
  download(new Blob([JSON.stringify(exportData(ctx, now, extra))], { type: 'application/json' }), `schwab-records-${dayOf(now)}.json`);
}

// ---------- delete (PM only, asks first, hub first) ----------

export async function deleteRecord(ctx, kind, key) {
  if (ctx.role !== 'pm' || !['task', 'report'].includes(kind)) return false;
  const h = hub(ctx), onHub = h.state !== 'off' && h.role === 'pm';
  const t = kind === 'task' ? ctx.tasks().find(x => x.uid === key) : list(ctx.reports()).find(r => r.date === key);
  if (!t) return false;
  const base = kind === 'task' ? L("Delete task {id}? This can't be undone.", { id: t.id }) : L("Delete the {date} report? This can't be undone.", { date: niceDate(t.date) });
  if (!await (ctx.ask || ask)(onHub ? `${base} ${L('It is also removed from the hub.')}` : base, L('Delete'), 'danger')) return false;
  if (onHub) { // a copy kept on the hub would come straight back, so the hub goes first and a failure deletes nothing
    const r = await ctx.sync.purge(kind, key);
    if (!r.ok) { ctx.toast(r.message || L('The hub could not be reached, so nothing was deleted.'), 'bad'); return false; }
  }
  await ctx.remove(kind, key);
  ctx.toast(L('Deleted'));
  ctx.render();
  return true;
}

// ---------- Settings > Hub ----------

export function hubSettingsView(ctx) {
  const st = hub(ctx), now = nowOf(ctx), office = ctx.role === 'pm' || ctx.role === 'super';
  if (st.state === 'off') {
    return office ? `<section class="card"><h2>${L('Hub')}</h2>
        <p class="hint">${L('Optional. One shared log of hours, task sheets and reports, a live board, and translation of what people type. Paste the hub link and your key.')}</p>
        <div class="grid"><label class="field wide"><span>${L('Hub link')}</span><input id="hubUrl" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec"></label>
          <label class="field wide"><span>${L('Hub key')}</span><input id="hubKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>
        <p class="hub-err" id="hubErr" role="alert"></p>
        <div class="btns"><button class="btn primary" data-act="hubConnect">${L('Connect')}</button></div></section>`
      : `<section class="card"><h2>${L('Hub')}</h2><p class="hint">${L('Not connected. Open the hub invite link your PM sent you.')}</p>
        <div class="btns"><button class="btn" data-act="paste">${L('Open a link someone sent you')}</button></div></section>`;
  }
  const pm = st.role === 'pm', test = ui.test;
  const results = test === 'running' ? `<p class="hint" role="status">${L('Testing…')}</p>` : test && !test.ok ? `<p class="hint" role="alert">${esc(test.message || L('The test could not run.'))}</p>`
    : test ? `<ul class="checks">${test.checks.map(c => `<li data-ok="${c.ok}"><span aria-hidden="true">${c.ok ? '✓' : '✗'}</span><span class="sr">${c.ok ? L('Passed') : L('Failed')}</span> ${esc(CHECKS()[c.name] || c.name)}${c.ok ? '' : ` <small>${esc(clip(c.detail, 40))}</small>`}</li>`).join('')}</ul>
      ${test.checks.every(c => c.ok) ? pill(L('Everything works'), 'good') : pill(L('Something failed'), 'bad')}` : '';
  return `<section class="card"><h2>${L('Hub')}</h2>
      <div class="row1"><span class="live-state"><i class="hub-dot" data-state="${esc(st.state)}"></i><b>${esc(hubLabel(st.state))}</b></span><small class="hint">${esc(st.at ? L('Updated {ago}', { ago: ago(st.at, now) }) : '')}</small></div>
      ${st.message && st.state !== 'live' ? `<p class="hint">${esc(st.message)}</p>` : ''}${st.pending ? `<p class="hint">${esc(L('{n} not sent yet', { n: st.pending }))}</p>` : ''}
      <dl class="kv"><dt>${L('This phone')}</dt><dd>${esc(roleName(st.role))}</dd>${st.role === 'crew' && st.crew ? `<dt>${L('Crew')}</dt><dd>${esc(st.crew)}</dd>` : ''}</dl>
      <div class="btns"><button class="btn" data-act="hubSync">${L('Sync now')}</button>${pm ? `<button class="btn" data-act="hubTest"${test === 'running' ? ' disabled' : ''}>${L('Test the hub')}</button>` : ''}</div>${results}</section>
    ${pm ? `<section class="card"><h2>${L('Invite people')}</h2><p class="hint">${L('An invite link carries the hub key. Send it only to the person it is for. If a phone is lost, replace the key.')}</p>
      <div class="btns"><button class="btn primary" data-act="hubInvite" data-v="crew">${L('Invite crew')}</button><button class="btn" data-act="hubInvite" data-v="super">${L('Invite superintendent')}</button></div>
      <div class="btns"><button class="btn" data-act="hubRotate" data-v="crew">${L('Replace the crew key')}</button><button class="btn" data-act="hubRotate" data-v="super">${L('Replace the superintendent key')}</button></div>
      <div class="btns">${sheetLink(ctx.sync.liveData?.().info?.sheetUrl)}</div></section>` : ''}
    <section class="card"><div class="btns"><button class="btn danger" data-act="hubDisconnect">${L('Disconnect this phone')}</button></div>
      <p class="hint">${L('Your work stays on this phone.')}</p></section>`;
}
const CHECKS = () => ({ write: L('Write a record'), read: L('Read it back'), 'merge rules': L('Who may change what'), translate: L('Translate a sentence with a drawing number'), delete: L('Delete the test record') });

async function invite(ctx, role) {
  const make = async crew => {
    const r = await ctx.sync.invite(role, crew);
    if (!r.ok) return ctx.toast(r.message || L('The invite link could not be made.'), 'bad');
    const msg = l => L('Join the {project} hub: open this link on your phone and follow the steps.', { project: ctx.S.project || COMPANY }, l);
    sendSheet({ title: role === 'crew' ? L('Hub invite for the crew') : L('Hub invite for the superintendent'), url: r.url, text: role === 'crew' ? `${msg('en')}\n\n${msg('es')}` : msg('en') });
  };
  const names = ctx.S.crews.map(c => c.name).filter(Boolean);
  if (role === 'super' || !names.length) return make('');
  const d = sheet(`<h3>${L('Which crew is this invite for?')}</h3><div class="menu">${names.map(n => `<button class="btn" data-crew="${esc(n)}" style="${crewVar(ctx.S, n)}"><i class="dot"></i>${esc(n)}</button>`).join('')}
    <button class="btn" data-crew="">${L('Not sure: they pick')}</button></div>`);
  d.addEventListener('click', e => { const b = e.target.closest('[data-crew]'); if (b) { d.close(); make(b.dataset.crew); } });
}

// A phone opening a join link: name and crew, then the hub does the rest. data: the unpacked link.
export function joinSheet(ctx, data) {
  const crewRole = data?.role === 'crew', names = ctx.S.crews.map(c => c.name).filter(Boolean);
  let crew = '';
  const d = sheet(`<h3>${L('Join the hub')}</h3>
    <p class="hint">${crewRole ? L('This link connects this phone to the project hub, so your task sheets arrive by themselves.') : L('This link connects this phone to the project hub as the superintendent.')}</p>
    ${crewRole ? `<label class="field"><span>${L('Your name')}</span><input name="who" autocomplete="name" value="${esc(ctx.S.worker)}" placeholder="${esc(L('First and last name'))}"></label>` : ''}
    ${crewRole && !data.crew && names.length ? `<div class="field"><span>${L('Your crew')}</span><div class="chips" role="group">${names.map(n => `<button type="button" class="chip" data-crew="${esc(n)}" aria-pressed="false" style="${crewVar(ctx.S, n)}"><i class="dot"></i>${esc(n)}</button>`).join('')}</div></div>` : ''}
    <p class="hub-err" role="alert" data-err></p>
    <div class="btns"><button class="btn primary" data-join>${L('Join')}</button></div>`);
  const err = m => { d.querySelector('[data-err]').textContent = m; };
  (d.querySelector('[name=who]') || d.querySelector('[data-join]')).focus(); // the dialog would otherwise put the cursor on its close button
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-crew]');
    if (!b) return;
    crew = b.dataset.crew;
    d.querySelectorAll('[data-crew]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  d.querySelector('[data-join]').onclick = async e => {
    const name = (d.querySelector('[name=who]')?.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (crewRole && !name) return err(L('Type your name first'));
    if (crewRole && !data.crew && names.length && !crew) return err(L('Pick your crew'));
    e.target.disabled = true;
    err('');
    const r = await ctx.sync.joinFrom({ ...data, ...(crewRole && crew && { crew }) });
    e.target.disabled = false;
    if (!r.ok) return err(r.message || L('That hub invite is not valid'));
    if (crewRole) patchSettings(ctx, { worker: name });
    d.close();
    ctx.toast(L('Connected to the hub'));
    ctx.render();
  };
}
function patchSettings(ctx, p) { // the stored settings keep the hub fields the sync engine wrote, so this merges rather than replaces
  Object.assign(ctx.S, p);
  save(KEYS.settings, { ...load(KEYS.settings, {}), ...p });
}

// ---------- taps and typing ----------

const ACTS = new Set(['liveRefresh', 'liveSite', 'liveMsg', 'liveReview', 'recPerson', 'recFilter', 'recSearch', 'recMore', 'recMenu', 'recOlder', 'recCsv', 'recWeekCsv', 'recExport', 'recStats', 'recArchive',
  'hubConnect', 'hubDisconnect', 'hubSync', 'hubTest', 'hubInvite', 'hubRotate', 'txToggle']);
export const owns = a => ACTS.has(a);

export async function act(ctx, a, el) {
  if (!owns(a)) return false;
  const v = el.dataset.v ?? '';
  try {
    switch (a) {
      case 'txToggle': { const box = el.closest('.tx'); if (box) box.dataset.view = box.dataset.view === 't' ? 'o' : 't'; break; }
      case 'liveSite': ui.siteOpen = !ui.siteOpen; ctx.render(); break;
      case 'liveRefresh': el.disabled = true; el.textContent = L('Refreshing…'); await ctx.sync.cycle(); ctx.render(); break;
      case 'liveMsg': case 'liveReview': { const t = latest(ctx, el.dataset.u); if (t) (a === 'liveMsg' ? messageSheet : reviewSheet)(ctx, t); break; }
      case 'recPerson': ui.person = v; ui.q = ''; ui.old = null; ctx.render(); break;
      case 'recFilter': ui[el.dataset.f === 'crew' ? 'crew' : 'status'] = v; ui.limit = PAGE; ui.old = null; ctx.render(); break;
      case 'recSearch': globalThis.document?.activeElement?.blur?.(); break;
      case 'recMore': ui.limit += PAGE; ctx.render(); break;
      case 'recMenu': recMenu(ctx, el.dataset.kind, el.dataset.key); break;
      case 'recOlder': await older(ctx, el.dataset.kind); break;
      case 'recCsv': case 'recWeekCsv': {
        const mon = a === 'recCsv' ? $('recWeek')?.value : el.dataset.mon;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(mon || '') || monday(mon) !== mon) break;
        download(new Blob(['﻿' + weekCsv(shiftsOf(ctx), mon, ctx.S, a === 'recWeekCsv' ? v : '')], { type: 'text/csv' }), `timesheet-week-of-${mon}${a === 'recWeekCsv' ? '-' + (nameKey(el.dataset.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person') : ''}.csv`);
        break;
      }
      case 'recExport': if (ctx.role === 'pm' && ui.busy !== 'export') { ui.busy = 'export'; ctx.render(); try { await exportAll(ctx); } finally { ui.busy = ''; ctx.render(); } } break;
      case 'recStats': ui.stats = undefined; ctx.render(); break;
      case 'recArchive': await archive(ctx); break;
      case 'hubConnect': await connect(ctx, el); break;
      case 'hubDisconnect':
        if (await (ctx.ask || ask)(L('Disconnect this phone from the hub? Your work stays on this phone.'), L('Disconnect'), 'danger')) { ctx.sync.disconnect(); ui.test = null; ui.stats = undefined; ctx.render(); }
        break;
      case 'hubSync': el.disabled = true; el.textContent = L('Refreshing…'); await ctx.sync.cycle(); ctx.render(); break;
      case 'hubTest': ui.test = 'running'; ctx.render(); ui.test = await ctx.sync.selftest(); ctx.render(); break;
      case 'hubInvite': await invite(ctx, v === 'super' ? 'super' : 'crew'); break;
      case 'hubRotate': await rotate(ctx, v === 'super' ? 'super' : 'crew'); break;
    }
  } catch (e) {
    if (a === 'hubTest') ui.test = null;
    el.disabled = false;
    ctx.toast(L('That did not work. Try again.'), 'bad');
    if (globalThis.console) console.error(e);
  }
  return true;
}

async function connect(ctx, el) {
  const url = $('hubUrl')?.value || '', key = $('hubKey')?.value || '', err = m => { const p = $('hubErr'); if (p) p.textContent = m; };
  if (!url.trim() || !key.trim()) return err(L('Paste the hub link and the key.'));
  el.disabled = true;
  err('');
  const r = await ctx.sync.connect(url, key);
  el.disabled = false;
  if (!r.ok) return err(r.message || L('That did not work. Try again.'));
  ctx.toast(L('Connected as {role}', { role: roleName(r.role) }));
  ctx.render();
}
async function rotate(ctx, role) {
  if (!await (ctx.ask || ask)(L('Replace the {role} key? Everyone using the old key is disconnected until they open a new invite link.', { role: role === 'crew' ? L('crew') : L('superintendent') }), L('Replace key'), 'danger')) return;
  const r = await ctx.sync.rotate(role);
  ctx.toast(r.ok ? L('New key made. Send new invite links.') : r.message || L('That did not work. Try again.'), r.ok ? '' : 'bad');
}
async function archive(ctx) {
  const before = $('recArch')?.value || '', limit = addDays(dayOf(nowOf(ctx)), -MIN_ARCHIVE_DAYS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before) || addDays(before, 0) !== before) return ctx.toast(L('Pick a date'), 'bad');
  if (before > limit) return ctx.toast(L('Pick a date at least 30 days back.'), 'bad');
  if (!await (ctx.ask || ask)(L('Move everything before {date} from the hub into an archive Sheet? It leaves the live Sheet and stops syncing to phones.', { date: niceDate(before) }), L('Archive'), 'danger')) return;
  ui.busy = 'archive';
  ctx.render();
  const r = await ctx.sync.archive(before);
  ui.busy = '';
  if (r.ok) ui.archived = r;
  ctx.toast(r.ok ? L('Archived') : r.message || L('That did not work. Try again.'), r.ok ? '' : 'bad');
  ui.stats = undefined;
  ctx.render();
}
async function older(ctx, kind) {
  if (!['tasks', 'shifts', 'reports'].includes(kind) || !hubFor(ctx, kind)) return;
  const o = ui.old?.kind === kind ? ui.old : (ui.old = { kind, items: [], cursor: '', busy: false, err: '' });
  if (o.busy) return;
  o.busy = true;
  o.err = '';
  ctx.render();
  const local = { tasks: ctx.tasks(), shifts: shiftsOf(ctx), reports: reportsOf(ctx) }[kind].map(x => x.date).sort()[0];
  const who = kind === 'shifts' && ui.person ? peopleWeeks(shiftsOf(ctx), ctx.S).find(p => p.key === ui.person)?.who || '' : ''; // the hub looks a person up by name
  const r = await ctx.sync.records({ kind, from: '2000-01-01', to: local ? addDays(local, -1) : dayOf(nowOf(ctx)), q: ui.q, who, cursor: o.cursor });
  o.busy = false;
  if (r.ok) { o.items.push(...r.items); o.cursor = r.cursor; } else o.err = r.message || L('The hub could not be reached.');
  ctx.render();
}
function recMenu(ctx, kind, key) {
  const t = kind === 'task' ? ctx.tasks().find(x => x.uid === key) : list(ctx.reports()).find(r => r.date === key);
  if (!t || ctx.role !== 'pm') return;
  const d = sheet(`<h3>${esc(kind === 'task' ? t.id : niceDate(t.date))}</h3><div class="menu">
    <button class="btn" data-go="${kind === 'task' ? `task/${esc(t.uid)}/review` : `report/${esc(t.date)}`}">${L('Open')}</button>
    <button class="btn danger" data-del>${kind === 'task' ? L('Delete this task sheet') : L('Delete this report')}</button></div>`);
  d.querySelector('[data-del]').onclick = () => { d.close(); deleteRecord(ctx, kind, key); };
}

// Typing: the search boxes filter the list in place; an edited field with a translated preview asks for a fresh one.
let previewTimer = 0;
export function onInput(ctx, el) {
  if (el.dataset.lv === 'q') {
    ui.q = el.value;
    ui.limit = PAGE;
    ui.old = null;
    const box = $('recList');
    if (box) { box.innerHTML = { people: peopleList, sheets: sheetsList, reports: reportsList }[ui.sub]?.(ctx) || ''; after(ctx, box); }
    return true;
  }
  const pre = el.dataset.k && [...globalThis.document?.querySelectorAll?.('.tx-pre') || []].find(p => p.dataset.for === el.dataset.k);
  if (pre) {
    pre.dataset.state = 'pending';
    pre.hidden = true;
    pre.querySelector('.tx-o').textContent = el.value;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => txApply(ctx, pre.parentNode), 800);
  }
  return false;
}

// Call after a view of this file is in the page: translates the typed text on screen, reads the hub's storage once.
export function after(ctx, root = globalThis.document) {
  txApply(ctx, root).catch(() => {});
  if (ui.want && ctx.role === 'pm' && hubFor(ctx, 'shifts')) {
    ui.want = false;
    ui.stats = 'loading';
    Promise.resolve(ctx.sync.stats?.()).then(r => { ui.stats = r || { ok: false }; ctx.render(); }, () => { ui.stats = { ok: false }; ctx.render(); });
  }
}

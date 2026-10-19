// Shared by the field app (tasks.html) and its daily report and time clock (report.mjs):
// storage, link codec, time math, the office passcode, small UI pieces.
// Handoff data rides in the URL fragment after "#", which browsers don't send to the host.
// An explicitly configured review receiver also receives PDF copies of finished records.

import ES from './es.mjs';

// The passcode also keeps a key of its own: a tab still running the version before it (phones keep old
// tabs open for days) rewrites settings without it, and an old backup has none. hours: this phone's own
// clock-ins; crewHours: the PM's timesheet of everyone's; device: this phone's hub secret, and hub: the hub link, key, role
// and crew (HUB_FIELDS), each in a key of its own for the same reason as the passcode. Backups and restores carry every
// key here (a backup leaves out the hub key).
export const KEYS = { settings: 'schwab.settings', tasks: 'schwab.tasks', reports: 'schwab.reports', pin: 'schwab.pin', hours: 'schwab.hours', crewHours: 'schwab.crewHours', device: 'schwab.device', hub: 'schwab.hub' };
export const HUB_FIELDS = ['hubUrl', 'hubKey', 'hubRole', 'hubCrew'];
export const COMPANY = 'H.A. Sack-Electrical', COMPANY_ALT = 'Sack Company-Electrical', COMPANIES = `${COMPANY} · ${COMPANY_ALT}`;
// The top lines of every PDF: who did the work, then the job.
export const letterhead = (s, more = '') => `${COMPANIES}\n${[s.project, s.site, more].filter(Boolean).join(' · ')}`;

// ---------- language ----------
// Spanish mode: every phrase on screen has a Spanish twin in es.mjs, looked up by its English text.
// What people type is never translated; it shows and prints exactly as written.

let lang = 'en';
export const setLang = l => { lang = l === 'es' ? 'es' : 'en'; if (globalThis.document) document.documentElement.lang = lang; };
export const getLang = () => lang;
export function L(en, vars, l = lang) {
  let s = l === 'es' && Object.hasOwn(ES, en) ? ES[en] : en;
  for (const k in vars) s = s.replaceAll(`{${k}}`, () => vars[k]); // a function, so "$&" in typed text stays literal
  return s;
}
const locale = l => (l === 'es' ? 'es-US' : 'en-US');

// ---------- data ----------

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Copy only the keys and types the template knows; arrays use their first entry as the item template.
// Every link, backup and old save passes through here, so a bad or hostile payload can't break the page.
export function shape(tpl, src) {
  // ponytail: lists stop at 500 entries, far past a real sheet or report, so a short crafted link can't
  // expand into hundreds of thousands that freeze the phone and fill its storage. Raise it if a real list nears it.
  if (Array.isArray(tpl)) return Array.isArray(src) ? src.slice(0, 500).map(x => shape(tpl[0], x)) : [];
  if (tpl && typeof tpl === 'object') {
    const out = {};
    for (const k of Object.keys(tpl)) out[k] = shape(tpl[k], src && typeof src === 'object' ? src[k] : undefined);
    return out;
  }
  return typeof src === typeof tpl ? src : tpl;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function load(key, fallback) {
  // A list key holding something else (say, from a restored file) would crash the page that maps over it.
  try { const v = localStorage.getItem(key), x = v ? JSON.parse(v) : fallback; return Array.isArray(fallback) && !Array.isArray(x) ? fallback : x; } catch { return fallback; }
}
// ponytail: everything lives in localStorage (~5 MB per site), roughly a year of daily sheets.
// Past that, move to IndexedDB or a shared backend; Backup keeps a copy until then.
export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { return false; }
  saved(key);
  return true;
}
// The app's one hook into every save (tasks.html pokes the hub sync with it); nothing by default.
let saved = () => {};
export const onSave = f => { saved = f; };

// hubKey is a secret: never in a backup, a link or the hub's config. hubRole and hubCrew are set by the sync engine.
// workerId: the roster person this phone's time clock name is (empty when the name matches nobody here).
export const SETTINGS_TPL = {
  lang: '', me: '', role: '', super: '', pm: '', project: '', site: '', floors: [''],
  crews: [{ id: '', name: '', lead: '', members: '' }], people: [{ id: '', name: '', crewId: '' }], checks: [''],
  folderUrl: '', siteCode: '', pin: '', worker: '', workerId: '', device: '', hubUrl: '', hubKey: '', hubRole: '', hubCrew: '',
};
export const DEFAULT_SETTINGS = {
  lang: '', me: '', role: 'Superintendent', super: '', pm: '', folderUrl: '', siteCode: '', pin: '', worker: '', workerId: '', device: '',
  hubUrl: '', hubKey: '', hubRole: '', hubCrew: '',
  project: 'Charles Schwab Building', site: 'Charlotte, NC',
  floors: ['Basement', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Roof'],
  crews: ['A', 'B', 'C', 'D'].map(x => ({ id: '', name: 'Crew ' + x, lead: '', members: '' })), people: [],
  checks: ['Supports / strapping', 'Labeling', 'Terminations / torque', 'Testing', 'Covers / plates', 'Cleanup'],
};
// Settings from storage, a backup or the hub: known fields only, every crew and person with an id, the roster checked.
export function normSettings(raw) {
  const s = raw ? shape(SETTINGS_TPL, raw) : structuredClone(DEFAULT_SETTINGS);
  fixRoster(s, Array.isArray(raw?.people));
  return s;
}
export function loadSettings() {
  const s = normSettings(load(KEYS.settings, null)), pin = load(KEYS.pin, ''), hub = load(KEYS.hub, null);
  if (PIN_FORMAT.test(pin)) s.pin = pin;
  if (hub && typeof hub === 'object') for (const k of HUB_FIELDS) s[k] = typeof hub[k] === 'string' ? hub[k] : ''; // its own key wins over an old tab's settings, a disconnect included
  return s;
}

// ---------- people and crews ----------
// settings.people is the roster, the one list of people for the sheets, the time clock and the crew hours. A person
// and a crew each have an id that never changes: a rename keeps every sheet and shift attached. Names are matched
// (nameKey) only when someone types or picks one; two people may share a name. crews[].members is the comma list of
// each crew's people, rewritten from the roster for older versions of the app, which still read it.
// A name matches however it was typed, so 'José  L' on a sheet is 'jose l' on the time clock. Only letters and digits
// count: a comma, a period or an iPhone's curly apostrophe is a space, so 'Mike O’Neil' is "Mike O'Neil" and 'José L.' is 'Jose L'.
export const nameKey = name => String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
// A name as the lists keep it: no comma (the members list is comma separated), single spaces, up to 60 characters.
export const cleanName = name => String(name ?? '').replace(/,/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 60);
const split = members => (members || '').split(',').map(cleanName).filter(nameKey);
// ponytail: an id made while migrating comes from the name (a 53-bit hash), so phones migrating the same lists agree,
// and a tab still on the old version (its save drops people and crew ids) re-migrates to the same ids. Someone renamed
// in between gets a new id that one time. New people and crews get random ids.
const hash = s => {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
};
const newId = (prefix, taken, seed = uid() + Math.random()) => {
  let id = prefix + hash(seed);
  for (let n = 2; taken.has(id); n++) id = prefix + hash(seed + '#' + n);
  taken.add(id);
  return id;
};
const idsIn = s => new Set([...s.crews, ...s.people].map(x => x.id));
const syncMembers = s => { for (const c of s.crews) c.members = s.people.filter(p => p.crewId === c.id).map(p => p.name).join(', '); };
// hasPeople: the stored settings have a roster. Without one (made before people had ids) it is built from the crews'
// member lists: one person per name, on the first crew that lists it, as names were matched before.
function fixRoster(s, hasPeople) {
  const taken = new Set();
  for (const c of s.crews) c.id = FORMAT.uid.test(c.id) && !taken.has(c.id) ? (taken.add(c.id), c.id) : newId('c', taken, 'crew|' + nameKey(c.name));
  if (!hasPeople) s.people = s.crews.flatMap(c => split(c.members).map(name => ({ id: '', name, crewId: c.id }))).slice(0, 500); // a list's cap, as shape() keeps it
  const crewIds = new Set(s.crews.map(c => c.id)), seen = new Set();
  s.people = s.people.map(p => ({ ...p, name: cleanName(p.name) })).filter(p => nameKey(p.name) && (hasPeople || (!seen.has(nameKey(p.name)) && seen.add(nameKey(p.name)))));
  for (const p of s.people) {
    p.id = FORMAT.uid.test(p.id) && !taken.has(p.id) ? (taken.add(p.id), p.id) : newId('p', taken, 'person|' + nameKey(p.name));
    if (!crewIds.has(p.crewId)) p.crewId = '';
  }
  syncMembers(s);
}
export const crewById = (s, id) => (id ? s?.crews.find(c => c.id === id) : undefined);
// The roster with each person's crew name: [{ id, name, crewId, crew }].
export const people = s => (s?.people || []).map(p => ({ id: p.id, name: p.name, crewId: p.crewId, crew: crewById(s, p.crewId)?.name || '' }));
export const personById = (s, id) => (id ? people(s).find(p => p.id === id) : undefined);
// The person a typed name is. Among people sharing the name, the one on crewId, else the first on the roster.
export const findPerson = (s, name, crewId = '') => {
  const k = nameKey(name), ms = k ? people(s).filter(p => nameKey(p.name) === k) : [];
  return ms.find(p => crewId && p.crewId === crewId) || ms[0];
};
// Always a new person, even with a name already on the roster (the screens ask first). id: to restore one whose
// hours already carry it. Returns the person, or undefined for no name.
export function addPerson(s, name, crewId = '', id = '') {
  const n = cleanName(name), taken = idsIn(s);
  if (!nameKey(n)) return undefined;
  s.people.push({ id: isId(id) && !taken.has(id) ? id : newId('p', taken), name: n, crewId: crewById(s, crewId) ? crewId : '' });
  syncMembers(s);
  return personById(s, s.people.at(-1).id);
}
const edit = (s, id, f) => { const p = id && s.people.find(x => x.id === id); if (p) { f(p); syncMembers(s); } return !!p; };
// Renames keep the id, so assignments and hours stay with the person; old sheets keep the name they were made with.
export const renamePerson = (s, id, name) => !!nameKey(cleanName(name)) && edit(s, id, p => { p.name = cleanName(name); });
export const movePerson = (s, id, crewId) => edit(s, id, p => { p.crewId = crewById(s, crewId) ? crewId : ''; });
export const removePerson = (s, id) => { const n = s.people.length; s.people = s.people.filter(p => p.id !== id); syncMembers(s); return s.people.length < n; };
export const renameCrew = (s, id, name) => { const c = crewById(s, id); if (c) c.name = String(name ?? '').trim().slice(0, 60); return !!c; };
export const addCrew = (s, name) => { const c = { id: newId('c', idsIn(s)), name, lead: '', members: '' }; s.crews.push(c); return c; };
export function removeCrew(s, id) {
  s.crews = s.crews.filter(c => c.id !== id);
  for (const p of s.people) if (p.crewId === id) p.crewId = ''; // they stay on the roster, under "Not on a crew"
  syncMembers(s);
}

// Whether a sheet lists a person: by id when both the sheet and the caller have one, else by name, so a sheet made
// before ids, or on a phone that doesn't know the person, still finds them.
const lists = (t, k, pid) => t.members.some((m, i) => (pid && t.memberIds[i] ? t.memberIds[i] === pid : !!k && nameKey(m) === k));
// The sheets of that day that list the person: their crew (the first sheet that names one) and the sheets as task
// links [{ uid, id }]: the uid finds the sheet, the short id is its label.
export function assignmentFor(tasks, name, day, pid = '') {
  const k = nameKey(name), sheets = k || pid ? tasks.filter(t => t.date === day && lists(t, k, pid)) : [], first = sheets.find(t => t.crew);
  return { crew: first?.crew || '', crewId: first?.crewId || '', tasks: taskLinks(sheets.map(t => ({ uid: t.uid, id: t.id }))), sheets };
}

const ITEM = { id: '', text: '', done: false, at: 0 };
// crewId and memberIds (one per name in members, '' for a name typed before people had ids) are who the sheet is for;
// crew and members are the names it was made with. aLang and cLang: the language the office and the crew typed in.
// reply: the office's message to the crew. assignAt and crewAt: when the office part and the crew part last changed (the hub's merge stamps).
export const TASK_TPL = {
  uid: '', origin: '', from: '', id: '', date: '', by: '', floor: '', area: '', crew: '', crewId: '', lead: '', members: [''], memberIds: [''], size: 0,
  scope: '', refs: '', items: [ITEM], checks: [ITEM], aLang: '',
  allot: 0, allotNote: '', est: 0, estNote: '', pStart: '', pStop: '', checkIn: '',
  aStart: '', aStop: '', delay: 0, status: '', doneText: '', remain: '', comments: '', cLang: '',
  review: '', reviewer: '', followUp: '', reply: '', replyAt: 0, replyBy: '', sentAt: 0, resultAt: 0, gotAt: 0, updatedAt: 0, filedAt: 0, assignAt: 0, crewAt: 0,
};
// Ids, dates and times end up in addresses and page markup, so they must keep their exact format.
// Anything else in them (a damaged or crafted link) is dropped here, once, for every link, backup and save.
const FORMAT = { uid: /^[\w-]{1,40}$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/ };
const isDay = d => FORMAT.date.test(d) && addDays(d, 0) === d; // a real calendar day, not 2026-02-30
const isId = x => typeof x === 'string' && FORMAT.uid.test(x); // not undefined, which a regex reads as 'undefined'
export function normTask(t) {
  const n = shape(TASK_TPL, t);
  if (!FORMAT.uid.test(n.uid)) n.uid = '';
  if (!FORMAT.uid.test(n.crewId)) n.crewId = '';
  n.memberIds = n.members.map((_, i) => (isId(n.memberIds[i]) ? n.memberIds[i] : ''));
  for (const k of ['pStart', 'pStop', 'checkIn', 'aStart', 'aStop']) if (!FORMAT.time.test(n[k])) n[k] = '';
  // Every sheet belongs to a day; one with no usable date would vanish from every board.
  // It goes back on the day it was last edited (or today), and is filed again under that date.
  if (!isDay(n.date)) {
    const edited = iso(new Date(n.updatedAt || Date.now()));
    n.date = isDay(edited) ? edited : today();
    n.filedAt = 0;
  }
  return n;
}
export const newItem = text => ({ id: uid(), text, done: false, at: 0 });

const ASSIGN = ['id', 'date', 'by', 'floor', 'area', 'crew', 'crewId', 'members', 'memberIds', 'size', 'scope', 'refs', 'aLang', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn', 'reply', 'replyAt', 'replyBy'];
const CREW = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'resultAt'];

// part 'crew': take the crew's results and check-offs, keep my assignment.
// part 'assign': take the new assignment and checklist, keep check-offs already made here.
export function mergeTask(local, inc, part) {
  for (const k of part === 'crew' ? CREW : ASSIGN) local[k] = inc[k];
  for (const list of ['items', 'checks']) {
    const [keep, take] = part === 'crew' ? [local[list], inc[list]] : [inc[list], local[list]];
    for (const it of keep) { const m = take.find(x => x.id === it.id); if (m) { it.done = m.done; it.at = m.at; } }
    local[list] = keep;
  }
  for (const k of ['updatedAt', 'sentAt']) local[k] = Math.max(local[k], inc[k]); // newest send seen, so an older link can't revert it
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
  for (const k of ['review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'sentAt', 'gotAt', 'assignAt', 'crewAt']) c[k] = TASK_TPL[k];
  for (const list of ['items', 'checks']) c[list] = c[list].filter(i => !onlyOpen || !i.done).map(i => newItem(i.text));
  return Object.assign(c, { uid: uid(), origin: 'mine', date, updatedAt: Date.now() });
}

// Short task ids (T1019-02) are labels for people. Two office phones working offline can both make one, so anything
// that points at a sheet keeps its uid too; the number is only what is shown.
export function nextId(tasks, date) {
  const mmdd = date.slice(5).replace('-', '');
  for (let i = 1; ; i++) {
    const id = `T${mmdd}-${String(i).padStart(2, '0')}`;
    if (!tasks.some(t => t.date === date && t.id === id)) return id;
  }
}
// A sheet arrived (a link now, the hub later) with the date and number of one of this phone's own sheets. Ours takes
// the next free number when it was never sent, since no one else has seen its number; returns [[sheet, old id]].
// onHub(uid): the sheet is on the hub already, so other phones know its number and it keeps it.
export function renumberClashes(tasks, inc, onHub = () => false) {
  const out = [];
  for (const t of tasks) {
    if (t === inc || t.uid === inc.uid || t.origin !== 'mine' || t.sentAt || !t.id || t.id !== inc.id || t.date !== inc.date || onHub(t.uid)) continue;
    out.push([t, t.id]);
    t.id = nextId(tasks, t.date);
    t.updatedAt = Date.now();
  }
  return out;
}
// Both already sent with the same date and number: each shows a warning until someone changes one's Task ID.
export const sameNumber = (tasks, t) => !!(t.id && t.sentAt) && tasks.some(x => x.uid !== t.uid && x.date === t.date && x.id === t.id && x.sentAt);

export const CREW_TPL = { name: '', na: true, lead: '', workers: 0, labor: 0, laborFromTasks: false, members: '', area: '', ref: '', start: '', stop: '', done: '', quality: '', holdups: '', good: '' };
export const REPORT_TPL = {
  date: '', super: '', shiftStart: '', shiftEnd: '', submittedAt: 0,
  status: '', results: '', wins: '', issues: '', notified: '',
  needs: [{ item: '', qty: '', where: '', confirmed: false, by: '' }],
  decisions: [{ q: '', rec: '', by: '', pm: '', pmNote: '' }],
  floors: [{ floor: '', crews: [CREW_TPL] }],
  next: [{ step: '', prereq: '', start: '', dur: '', finish: '', deadline: '', lead: '', checkin: '' }],
  risks: [{ risk: '', impact: '', prevent: '', fallback: '', owner: '', by: '' }],
  preparedBy: '', pmReview: '', updatedAt: 0, filedAt: 0, lang: '', pmAt: 0, // lang: the language it was typed in; pmAt: the PM part's merge stamp
};
const REPORT_STATUS = ['On plan', 'At risk', 'Behind plan', 'No work today']; // same list as STATUS in report.mjs
export function normReport(r) {
  const n = shape(REPORT_TPL, r);
  if (!REPORT_STATUS.includes(n.status)) n.status = ''; // one the page doesn't know would break it
  if (!isDay(n.date)) n.date = ''; // an impossible day (2026-02-30) is refused by the review folder forever
  return n;
}

// One clock-in to clock-out, under the name it was clocked in with. Only taps on the worker's own phone make
// one; only the PM changes one. edited marks what the PM changed, so a worker's later link can't undo it;
// gone, a shift the PM removed; at, when the newest link that named it was sent. pid: the roster person, when the
// phone knew who it was. crew, crewId and tasks: the crew and the task sheets the worker's phone had them on that day.
export const SHIFT_TPL = { id: '', device: '', who: '', pid: '', crew: '', crewId: '', tasks: [{ uid: '', id: '' }], date: '', in: '', out: '', edited: { who: false, in: false, out: false }, gone: false, at: 0 };
// Task links [{ uid, id }]: the uid finds the sheet; id is the number it had, for display. A link from an older phone is
// the number alone ('T1019-02' becomes { uid: '', id: 'T1019-02' }), dropped once the same number arrives with its uid.
// The Task ID is typed on the sheet ('L3 East-14', 'Baño-2', 'E-301/4'), so an id keeps letters, digits, spaces and
// . _ # / -; it is shown escaped and quoted in the CSV. At most 10.
export function taskLinks(list) {
  const ls = (Array.isArray(list) ? list : []).slice(0, 500).map(x => shape(SHIFT_TPL.tasks[0], typeof x === 'string' ? { id: x } : x))
    .map(x => ({ uid: FORMAT.uid.test(x.uid) ? x.uid : '', id: /^[\p{L}\p{M}\p{N}_ .#\/-]{1,20}$/u.test(x.id.trim()) ? x.id.trim() : '' }));
  return ls.filter((x, i) => (x.uid ? ls.findIndex(y => y.uid === x.uid) === i : x.id && !ls.some(y => y.uid && y.id === x.id) && ls.findIndex(y => !y.uid && y.id === x.id) === i)).slice(0, 10);
}
export function normShift(x) {
  const n = shape(SHIFT_TPL, x);
  n.who = n.who.trim().slice(0, 60);
  n.crew = n.crew.trim().slice(0, 60);
  n.tasks = taskLinks(x?.tasks);
  for (const k of ['in', 'out']) if (!FORMAT.time.test(n[k])) n[k] = '';
  for (const k of ['device', 'pid', 'crewId']) if (!FORMAT.uid.test(n[k])) n[k] = '';
  return FORMAT.uid.test(n.id) && isDay(n.date) && n.in ? n : null; // no id, day or clock-in: nothing to log
}
export const blank = list => shape(REPORT_TPL[list][0], {});
export const newFloor = (floor, crewNames) => ({ floor, crews: crewNames.map(name => ({ ...CREW_TPL, name })) });

// Roll the day's task sheets up into the report's floor / crew sections.
// Only empty text fields are filled, so the superintendent's own wording is never overwritten.
// The work window and labor-hours come from the sheets' clock times and follow them on every fill.
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
    // ponytail: the window only widens, by plain "HH:MM" string compare, so an overnight shift (stop past
    // midnight) isn't handled. Compare minutes from the shift start if night work comes up.
    if (starts[0] && (!c.start || starts[0] < c.start)) c.start = starts[0];
    if (stops.length && (!c.stop || stops.at(-1) > c.stop)) c.stop = stops.at(-1);
    // Each sheet's worked hours, so a crew moving between floors isn't billed its whole day on each one.
    c.labor = ts.reduce((n, t) => n + worked(t) / 60 * (t.size || 1), 0);
    c.laborFromTasks = true;
  }
  for (const t of tasks) {
    if (t.followUp && !rep.next.some(s => s.step.endsWith(t.followUp))) {
      rep.next.push({ ...blank('next'), step: `${t.floor} · ${t.crew}: ${t.followUp}`, lead: t.lead });
    }
  }
  return groups.size;
}

// ---------- office passcode ----------
// The superintendent's screens (making or changing assignments, the daily report, settings) and the PM's
// crew hours open with a 4-digit code; crew sheets and the time clock are open to everyone. The code is kept as a salted SHA-256 hash, never as typed, and
// rides along in the links an office phone sends, so a crew phone asks for the office's code instead of
// offering to make its own. A phone keeps the first code it learns; links never replace it.
// ponytail: a 4-digit code in a phone web app is a door lock, not a vault: 10,000 codes, and anyone holding
// a link or this phone's storage can try them all offline. It keeps crews on the crew screens and a
// picked-up phone out of the office records. Sign-ins on a shared server are the upgrade past that.
export const UNLOCK = 'schwab.unlock';
export const PIN_FORMAT = /^[0-9a-f]{16}:[0-9a-f]{64}$/;
export const hasPin = s => PIN_FORMAT.test(s.pin);
export const setPin = (s, pin) => { s.pin = pin; return save(KEYS.pin, pin) && save(KEYS.settings, s); };
export function adoptPin(s, pin) {
  if (hasPin(s) || typeof pin !== 'string' || !PIN_FORMAT.test(pin)) return false;
  return setPin(s, pin);
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function pinHash(pin, salt = hex(crypto.getRandomValues(new Uint8Array(8)))) {
  return `${salt}:${hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)))}`;
}
// ---------- this phone's device identity (HUB.md, Identity) ----------
// A private secret of 32 letters and digits in its own key; the device id is the first 32 hex characters of its SHA-256.
// The hub learns the id only from the secret, so knowing another phone's id (it is in texts and the Sheet) opens nothing.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const devRec = () => { const d = load(KEYS.device, null); return /^[A-Za-z0-9]{32}$/.test(d?.secret) && /^[0-9a-f]{32}$/.test(d?.id) ? d : null; };
export const deviceId = () => devRec()?.id || '';
export const deviceSecret = () => devRec()?.secret || '';
const idOf = async secret => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).slice(0, 32);
// Makes the secret once (a restored backup brings the old phone's back). Resolves to the id, or '' where the phone
// can't (no crypto.subtle off https): the time clock then keeps using the older settings.device. Calls made while one is
// still working share it, so two first calls can never make two secrets.
let making = null;
export const ensureDevice = () => (making ||= makeDevice().finally(() => { making = null; }));
async function makeDevice() {
  try {
    let secret = load(KEYS.device, null)?.secret;
    if (!/^[A-Za-z0-9]{32}$/.test(secret)) {
      secret = '';
      while (secret.length < 32) for (const b of crypto.getRandomValues(new Uint8Array(48))) if (b < 248 && secret.length < 32) secret += ALNUM[b % 62]; // 248 = 4 x 62: no bias
    }
    const id = await idOf(secret);
    if (deviceId() !== id && !save(KEYS.device, { secret, id })) return '';
    return id;
  } catch { return ''; }
}

const OPEN_MS = 12 * 36e5, TRIES = 5, WAIT_MS = 60e3; // signed in for a work shift; 5 wrong codes, then a 1 minute wait
const lockState = () => shape({ until: 0, fails: 0, wait: 0 }, load(UNLOCK, {}));
export const unlocked = (now = Date.now()) => lockState().until > now;
export const signIn = (now = Date.now()) => save(UNLOCK, { until: now + OPEN_MS, fails: 0, wait: 0 });
export const signOut = () => save(UNLOCK, { until: 0, fails: 0, wait: 0 });
export const waitLeft = (now = Date.now()) => Math.max(0, lockState().wait - now);
// 'ok' (signed in), 'wrong', or 'wait' (too many wrong codes; waitLeft() says how long).
export async function tryPin(s, pin, now = Date.now()) {
  const st = lockState();
  if (st.wait > now) return 'wait';
  if (hasPin(s) && await pinHash(pin, s.pin.slice(0, 16)) === s.pin) return signIn(now) ? 'ok' : 'wrong';
  const fails = st.fails + 1, out = fails >= TRIES;
  save(UNLOCK, { until: st.until, fails: out ? 0 : fails, wait: out ? now + WAIT_MS : 0 }); // a wrong code never signs anyone out
  return out ? 'wait' : 'wrong';
}

// ---------- link codec ----------

export const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

export async function pack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return b64(new Uint8Array(await new Response(stream).arrayBuffer())).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
export const niceDate = (day, l = lang) => new Date(day + 'T12:00').toLocaleDateString(locale(l), { weekday: 'short', month: 'short', day: 'numeric' });
export const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
// Minutes from start to stop; a stop earlier than the start is an overnight shift.
export const span = (start, stop) => { const a = toMin(start), b = toMin(stop); return a == null || b == null ? 0 : (b - a + 1440) % 1440; };
export const worked = t => (t.aStart && t.aStop ? Math.max(0, span(t.aStart, t.aStop) - t.delay) : 0); // a sheet's minutes on task, less delays
export const fmtMin = (m, l = lang) => m >= 60 ? L('{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 }, l) : L('{m}m', { m }, l); // PDFs and English message lines pass 'en'
export const t12 = t => { const m = toMin(t); return m == null ? '' : `${(Math.floor(m / 60) + 11) % 12 + 1}:${pad(m % 60)} ${m < 720 ? 'AM' : 'PM'}`; };
export const stamp = (ts, l = lang) => ts ? new Date(ts).toLocaleString(locale(l), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const timeOf = ts => new Date(ts).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' });
export const hrs = n => (Math.round(n * 10) / 10).toString();

// ---------- UI pieces ----------

// A crew's color: by its id when the sheet or shift has one (a renamed crew keeps its color), else by name.
export const crewVar = (s, name, id = '') => { let i = id ? s.crews.findIndex(c => c.id === id) : -1; if (i < 0) i = s.crews.findIndex(c => c.name === name); return `--crew:var(--c${i < 0 ? 4 : i % 6})`; };

// v: the screen the arrows and the date picker stay on (day = task sheets, report).
export const dateBar = (day, v = 'day') => `<div class="datebar">
  <button class="nav-btn" data-go="${v}/${addDays(day, -1)}" aria-label="${L('Previous day')}">‹</button>
  <label class="day">${niceDate(day)}<small>${day === today() ? L('Today') : day < today() ? L('Past day') : L('Planning ahead')}</small>
    <input type="date" value="${day}" data-pick="${v}" aria-label="${L('Pick a date')}"></label>
  <button class="nav-btn" data-go="${v}/${addDays(day, 1)}" aria-label="${L('Next day')}">›</button></div>`;

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
  d.innerHTML = `<div class="sheet-in"><form method="dialog"><button class="sheet-x" aria-label="${L('Close')}">✕</button></form>${html}</div>`;
  d.addEventListener('close', () => { const t = d.querySelector('#toast'); if (t) document.body.append(t); d.remove(); }); // a toast shown in the sheet outlives it
  d.addEventListener('click', e => { if (e.target === d) d.close(); }); // tap outside
  document.body.append(d);
  d.showModal();
  return d;
}

// In-page question: bigger targets than the browser's, and the buttons say what they do. opts: [[value, label, tone]];
// resolves to the value tapped, or null for Cancel or closing it.
export const choose = (msg, opts) => new Promise(res => {
  const d = sheet(`<p class="ask">${esc(msg)}</p><div class="btns">${opts.map(([, label, tone], i) => `<button class="btn ${tone || ''}" data-a="${i + 1}">${esc(label)}</button>`).join('')}<button class="btn" data-a="0">${L('Cancel')}</button></div>`);
  d.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { res(+b.dataset.a ? opts[b.dataset.a - 1][0] : null); d.close(); } });
  d.addEventListener('close', () => res(null));
});
export const ask = async (msg, yes, tone = 'primary') => (await choose(msg, [[true, yes, tone]])) === true;

export function sendSheet({ title, text, url }) {
  const msg = `${text}\n${url}`;
  const d = sheet(`<h3>${esc(title)}</h3><p class="preview">${esc(text)}</p>
    <div class="btns">
      ${navigator.share ? `<button class="btn primary" data-s="share">${L('Share…')}</button>` : ''}
      <a class="btn" href="sms:?&body=${encodeURIComponent(msg)}">${L('Text message')}</a>
      <a class="btn" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(msg)}">${L('Email')}</a>
      <button class="btn" data-s="copy">${L('Copy link')}</button>
    </div>
    <p class="hint">${url.length > 1800 ? L('Long link: send by iMessage, WhatsApp or email. Some plain SMS apps cut long links.') + ' ' : ''}${L('The work details are inside the link itself.')}</p>
    <textarea class="linkbox" readonly rows="2" aria-label="${L('Link')}">${esc(url)}</textarea>`);
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    try {
      if (b.dataset.s === 'share') await navigator.share({ title, text, url });
      else { await navigator.clipboard.writeText(msg); toast(L('Link copied. Paste it into a text or email.')); }
      d.close();
    } catch (err) {
      if (err.name === 'AbortError') return;
      const box = d.querySelector('.linkbox');
      box.focus(); box.select();
      toast(L('Select the link below and copy it'));
    }
  });
}

// Paste box for when a link was copied instead of tapped.
export const pasteSheet = onCode => {
  const d = sheet(`<h3>${L('Open a link someone sent you')}</h3><p class="hint">${L('Paste the whole message or just the link. Use this when a link opened in a different browser or app than this one.')}</p>
    <textarea class="linkbox" rows="3" aria-label="${L('Paste link here')}"></textarea><div class="btns"><button class="btn primary" data-open>${L('Open')}</button></div>`);
  d.querySelector('[data-open]').onclick = () => {
    const code = codeFrom(d.querySelector('textarea').value);
    if (!code) return toast(L("That doesn't look like a field app link"), 'bad');
    d.close();
    onCode(code);
  };
};

export function download(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- PDF ----------
// A plain text PDF written by hand: Letter pages, the built-in Helvetica fonts, nothing embedded.
// ponytail: built-in fonts only cover Windows-1252, so symbols outside it print as "?".
// Embedding a font (or a PDF library) is the upgrade if crews start typing other scripts.

// Helvetica glyph widths in 1/1000 em for ASCII 32 to 126, from the standard font metrics.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space to /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, // 0 to @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // A to Z
  278, 278, 278, 469, 556, 333, // [ to `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // a to z
  334, 260, 334, 584, // { to ~
];
const CP1252 = { '€': 128, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153 };
const SWAP = { '\u202f': ' ', '\u00a0': ' ', '\u2009': ' ', '\t': ' ', '✓': 'x', '⚠': '!', '−': '-' };
const codes = text => [...String(text).replace(/[\u202f\u00a0\u2009\t✓⚠−]/g, c => SWAP[c])].map(c => {
  const n = c.codePointAt(0);
  return (n > 31 && n < 127) || (n > 159 && n < 256) ? n : CP1252[c] || 63;
});
const lit = cs => `(${cs.map(n => (n > 126 ? '\\' + n.toString(8) : (n === 40 || n === 41 || n === 92 ? '\\' : '') + String.fromCharCode(n))).join('')})`;
// Bold is wider than regular; 1.15x over-estimates it so a label never runs into its value.
const textW = (cs, size, bold) => cs.reduce((w, n) => w + (n > 31 && n < 127 ? HELV[n - 32] : 600), 0) * size / 1000 * (bold ? 1.15 : 1);

function wrap(text, maxW, size, bold) {
  const lines = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    let line = [];
    for (const word of para.split(' ').map(codes)) {
      const next = line.length ? [...line, 32, ...word] : word;
      if (textW(next, size, bold) <= maxW) { line = next; continue; }
      if (line.length) lines.push(line);
      line = word;
      while (textW(line, size, bold) > maxW) { // one word wider than the column, like a long link
        let n = line.length;
        while (n > 1 && textW(line.slice(0, n), size, bold) > maxW) n--;
        lines.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    lines.push(line);
  }
  return lines;
}

// sections: [heading, [[label, value], ...]]; empty values are left out, like a clean paper copy.
export function makePdf(title, sub, sections, footer) {
  const W = 612, H = 792, M = 54, COL = 150, GAP = 12, LH = 13;
  const pages = [];
  let ops, y;
  const page = () => { pages.push(ops = []); y = H - M; };
  const text = (cs, x, size, bold) => ops.push(`BT /F${bold ? 2 : 1} ${size} Tf ${x} ${y.toFixed(1)} Td ${lit(cs)} Tj ET`);
  const room = h => { if (y - h < M) page(); };
  page();
  for (const l of wrap(title.toUpperCase(), W - 2 * M, 18, true)) { text(l, M, 18, true); y -= 22; }
  for (const l of wrap(sub, W - 2 * M, 10)) { text(l, M, 10); y -= LH; }
  for (const [heading, rows] of sections) {
    const filled = rows.filter(([, v]) => v !== '' && v != null && v !== 0);
    y -= 10;
    room(48);
    ops.push(`1 w ${M} ${(y + 12).toFixed(1)} m ${W - M} ${(y + 12).toFixed(1)} l S`);
    for (const l of wrap(heading.toUpperCase(), W - 2 * M, 11, true)) { text(l, M, 11, true); y -= 15; }
    for (const [k, v] of filled.length ? filled : [['', 'Nothing recorded']]) {
      const kl = wrap(k, COL, 10, true), vl = wrap(v, W - 2 * M - COL - GAP, 10);
      for (let i = 0; i < Math.max(kl.length, vl.length); i++) {
        room(LH);
        if (kl[i]) text(kl[i], M, 10, true);
        if (vl[i]) text(vl[i], M + COL + GAP, 10);
        y -= LH;
      }
      y -= 3;
    }
  }
  pages.forEach((p, i) => p.push(`BT /F1 8 Tf ${M} 30 Td ${lit(codes(`${footer} · Saved ${stamp(Date.now(), 'en')} · Page ${i + 1} of ${pages.length}`))} Tj ET`));

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ...pages.flatMap((p, i) => {
      const body = p.join('\n');
      return [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
        `<< /Length ${body.length} >>\nstream\n${body}\nendstream`];
    }),
  ];
  // Everything above is plain ASCII (lit escapes the rest), so string length is byte offset.
  let out = '%PDF-1.4\n';
  const at = objs.map((o, i) => { const pos = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return pos; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}`
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));
}

// Phones get the share sheet (Save to Files, Mail, AirDrop, Drive); computers get a normal download.
export async function savePdf(filename, bytes) {
  const file = new File([bytes], filename.replace(/[\\/:*?"<>|]/g, '-'), { type: 'application/pdf' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { return await navigator.share({ files: [file] }); } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(file, file.name);
}

// ---------- review folder ----------
// Finished records are queued on the phone first, then uploaded as PDFs to the shared folder
// (review-folder.gs). No signal, a closed app or a refused upload never loses one: the queue
// retries when an app opens or the phone reconnects. The queue keeps the latest pending edit
// per date and name; the receiver preserves earlier uploaded edits as separate files.

const OUTBOX = 'schwab.outbox';
// A record with no valid date (saved before blank dates were fixed) is refused forever; drop it.
// Its sheet is re-dated on load and filed again, so nothing is lost.
const box = () => load(OUTBOX, []).filter(x => isDay(x?.date));
const same = (a, b) => a.date === b.date && a.name === b.name;
const sameCopy = (a, b) => same(a, b) && a.pdf === b.pdf && a.v === b.v;
export const queue = item => save(OUTBOX, [...box().filter(x => !same(x, item)), item]);
export const queued = () => box().length;

// review-folder.gs answers in English. These are its replies, so Spanish mode can show them in Spanish; any other text stays as it came.
const folderSays = e => {
  const known = {
    'Invalid request': L('Invalid request'),
    'Upload integration not configured': L('Upload integration not configured'),
    'Wrong site code': L('Wrong site code'),
    'Invalid date or PDF': L('Invalid date or PDF'),
    'Invalid record version': L('Invalid record version'),
    'Busy; try again shortly': L('Busy; try again shortly'),
    'Daily upload limit reached; ask the owner': L('Daily upload limit reached; ask the owner'),
    'Upload failed; owner must review Drive setup': L('Upload failed; owner must review Drive setup'),
  };
  return Object.hasOwn(known, e) ? known[e] : e;
};

async function post(s, body) {
  const url = String(s.folderUrl || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error(L('Use the Apps Script upload link ending in /exec'));
  // A plain-text body keeps this a "simple" request, which Apps Script answers without a CORS preflight.
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ ...body, code: s.siteCode }) });
  const reply = await res.json().catch(() => ({}));
  if (!reply.ok) throw new Error(reply.error || L('the folder answered with error {status}', { status: res.status }));
}

let busy = null;
// Resolves to { left, error }. error stays empty for "no signal", which simply waits for the next try.
export const flush = s => (busy ||= (async () => {
  let error = '';
  for (const item of s.folderUrl ? box() : []) {
    if (!box().some(x => sameCopy(x, item))) continue; // replaced by a newer copy while this ran; that one goes next time
    try {
      await post(s, item);
      save(OUTBOX, box().filter(x => !sameCopy(x, item))); // only this copy: an edit saved meanwhile stays queued
    } catch (e) {
      if (!(e instanceof TypeError)) { // refused: back of the line, so it can't hold up the records behind it
        error = e.message;
        save(OUTBOX, [...box().filter(x => !sameCopy(x, item)), item]);
      }
      break; // no signal or a refusal: one try per flush keeps a wrong site code from re-sending every PDF
    }
  }
  return { left: queued(), error };
})().finally(() => { busy = null; }));

// file: { date, name, bytes, v }. v is the record's last edit time, preserved in the receiver's
// metadata so an older offline edit can be distinguished without deleting newer records.
export async function fileAway(s, f) {
  if (!s.folderUrl) return;
  const item = { date: f.date, name: f.name, pdf: b64(f.bytes), v: f.v || 0 };
  if (!isDay(item.date)) return; // the folder refuses an impossible day; never claim it was filed
  if (!queue(item)) return toast(L("This phone is out of space, so the PDF wasn't queued. Use Save as PDF."), 'bad');
  const waiting = () => box().some(x => sameCopy(x, item));
  let r = await flush(s);
  if (waiting()) r = await flush(s); // another upload was mid-way, or a refused record went first; go again for this one
  // Report on this record only; another record's refusal is not this one's failure.
  toast(!waiting() ? L('Saved to the review folder') : r.error ? L('Review folder said: {error}. Kept on this phone; check Settings.', { error: folderSays(r.error) })
    : L('Saved on this phone. It goes to the review folder when there is signal.'), waiting() && r.error ? 'bad' : '');
}

export function retryUploads(s) {
  const before = queued();
  if (before && s.folderUrl) flush(s).then(r => r.left < before && toast(L('Uploaded to the review folder: {n}', { n: before - r.left })));
}

// ---------- settings (office only: behind the passcode) ----------

export function settingsView(s) {
  const roles = ['Superintendent', 'Project manager'];
  const n = queued();
  return `<section class="card"><h2>${L('This phone')}</h2><div class="grid">
      <label class="field"><span>${L('Language')}</span><select data-k="s.lang">${[['en', 'English'], ['es', 'Español']].map(([v, name]) => `<option value="${v}"${v === getLang() ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
      ${field(L('Your name'), 's.me', s.me, { ph: L('Used for "Assigned by", sign-offs') })}
      <label class="field"><span>${L('Your role')}</span><select data-k="s.role">${roles.map(r => `<option value="${r}"${r === s.role ? ' selected' : ''}>${L(r)}</option>`).join('')}</select></label>
    </div></section>
    <section class="card"><h2>${L('Office passcode')}</h2><p class="hint">${L("Opens task setup, the daily report, settings and the PM's crew hours. Crew sheets and the time clock stay open to everyone. Use the same code on the PM's and the superintendent's phones. Crew phones learn it from the first task sheet they open.")}</p>
      <div class="btns"><button class="btn" data-act="changePin">${L('Change the passcode')}</button></div></section>
    <section class="card"><h2>${L('Project')}</h2><div class="grid">
      ${field(L('Project'), 's.project', s.project)}${field(L('Location'), 's.site', s.site)}
      ${field(L('Superintendent'), 's.super', s.super)}${field(L('Project manager'), 's.pm', s.pm)}
    </div></section>
    <section class="card"><h2>${L('Floors / levels')}</h2><p class="hint">${L('One per line. They show up as quick picks; you can still type any floor.')}</p>
      <textarea data-k="s.floors" data-lines rows="6">${esc(s.floors.join('\n'))}</textarea></section>
    <section class="card"><h2>${L('Crews')}</h2><p class="hint">${L('Tap a name to rename the person or move them to another crew. Picking a crew on a task fills in its people.')}</p>
      ${s.crews.map((c, i) => `<div class="crew-edit" style="--crew:var(--c${i % 6})"><div class="grid">
        ${field(L('Crew name'), `s.crews.${i}.name`, c.name)}${field(L('Lead'), `s.crews.${i}.lead`, c.lead)}</div>
        ${peopleEditor(s, c, 'Mike R, Jose L, Tre W')}
        <button class="link danger" data-act="delCrew" data-i="${i}">${L('Remove {name}', { name: esc(c.name || L('crew')) })}</button></div>`).join('')}
      ${people(s).some(p => !p.crew) ? `<div class="crew-edit">${peopleEditor(s, null)}</div>` : ''}
      <button class="btn" data-act="addCrew">${L('+ Add crew')}</button></section>
    <section class="card"><h2>${L('Finish / accuracy checks')}</h2><p class="hint">${L('One per line. Tap them onto a task as required checks.')}</p>
      <textarea data-k="s.checks" data-lines rows="6">${esc(s.checks.join('\n'))}</textarea></section>
    <section class="card"><h2>${L('Review folder')}</h2><p class="hint">${L('Optional PDF filing needs an owner-approved Google Drive receiver. Enter its upload link and code manually on each phone that should upload. Task links do not carry the upload code or change these settings.')}</p>
      <div class="grid">${field(L('Folder upload link'), 's.folderUrl', s.folderUrl, { wide: true, ph: 'https://script.google.com/macros/s/.../exec', mode: 'url' })}${field(L('Site code'), 's.siteCode', s.siteCode, { type: 'password' })}</div>
      <div class="btns"><button class="btn" data-act="testFolder">${L('Test the connection')}</button></div>
      <p class="hint">${n ? L('Waiting to upload: {n}', { n }) : L('Nothing waiting to upload.')}</p></section>
    <section class="card"><h2>${L('Backup')}</h2><p class="hint">${L('Everything is stored on this phone only. Download a backup weekly, or before clearing browser data or switching phones.')}</p>
      <div class="btns"><button class="btn" data-act="backup">${L('Download backup')}</button>
      <label class="btn">${L('Restore from backup')}<input type="file" accept="application/json,.json" data-restore hidden></label></div>
      <p class="hint">${L('Using about {kb} KB of roughly 5,000 KB.', { kb: Math.ceil([...Object.values(KEYS), OUTBOX].reduce((n, k) => n + JSON.stringify(load(k, '')).length, 0) / 1024) })}</p></section>`;
}

// A crew's people as chips (c null: the people on no crew): tap a name to rename or move the person, ✕ to take them
// off the list, and a box to add people (several at once with commas). Big targets: a chip is a 40 px row, the add button 44 px.
function peopleEditor(s, c, ph = '') {
  const ps = people(s).filter(p => (c ? p.crewId === c.id : !p.crew)), plain = 'background:none;border:0;font:inherit;color:inherit;cursor:pointer;min-height:40px';
  return `<div class="field"><span>${c ? L('People') : L('Not on a crew')}</span>
    ${ps.length ? `<div class="chips">${ps.map(p => `<span class="chip" style="padding:0 0 0 14px;gap:0"><button type="button" data-act="pEdit" data-pid="${esc(p.id)}" style="${plain};padding:0;text-align:left">${esc(p.name)}</button><button type="button" data-act="pDel" data-pid="${esc(p.id)}" aria-label="${esc(L('Remove {name}', { name: p.name }))}" style="${plain};min-width:40px;padding:0 4px;color:var(--bad)">✕</button></span>`).join('')}</div>`
      : c ? `<p class="hint">${L('No one on this crew yet.')}</p>` : ''}
    </div>${c ? `<div class="field"><span>${L('Add people')}</span><div class="edit-row"><input placeholder="${esc(ph)}" aria-label="${esc(L('Add people to {crew}', { crew: c.name || L('crew') }))}" enterkeyhint="done" autocomplete="off" data-enter="pAdd" data-crew="${esc(c.id)}">
      <button class="x add" data-act="pAdd" data-crew="${esc(c.id)}" aria-label="${esc(L('Add to {crew}', { crew: c.name || L('crew') }))}">+</button></div></div>` : ''}`;
}

// Tap a person: rename them, or move them to another crew. Resolves when the sheet closes.
const editPerson = (s, id) => new Promise(res => {
  const p = personById(s, id);
  if (!p) return res();
  const d = sheet(`<h3>${esc(p.name)}</h3><div class="edit-row"><input name="who" value="${esc(p.name)}" aria-label="${esc(L('Name'))}" autocomplete="off" enterkeyhint="done">
      <button class="btn primary" data-save>${L('Rename')}</button></div>
    <p class="label">${L('Move to another crew')}</p>
    <div class="menu">${s.crews.map(c => `<button class="btn" data-move="${esc(c.id)}" style="${crewVar(s, c.name, c.id)}"${c.id === p.crewId ? ' aria-current="true"' : ''}><i class="dot"></i>${c.id === p.crewId ? '✓ ' : ''}${esc(c.name || L('crew'))}</button>`).join('')}</div>`);
  const rename = () => {
    if (!renamePerson(s, id, d.querySelector('[name=who]').value)) return toast(L('Type the name'), 'bad');
    d.close();
  };
  d.querySelector('[name=who]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
  d.addEventListener('click', e => {
    if (e.target.closest('[data-save]')) return rename();
    const m = e.target.closest('[data-move]');
    if (m) { movePerson(s, id, m.dataset.move); d.close(); }
  });
  d.addEventListener('close', () => res());
});

// Adding a name someone on the roster already has asks first: the same person (moved here) or a second person.
async function addFromSettings(s, el) {
  const box = el.closest('.edit-row').querySelector('input'), names = box.value.split(',').map(cleanName).filter(nameKey), c = crewById(s, el.dataset.crew);
  if (!c || !names.length) return box.focus();
  const crew = c.name || L('crew');
  for (const name of names) {
    const twin = findPerson(s, name, c.id);
    const pick = !twin ? 'new' : twin.crewId === c.id
      ? await choose(L('{name} is already on {crew}. Add a second person with the same name?', { name: twin.name, crew }), [['new', L('Add a second {name}', { name: twin.name })]])
      : await choose(L('{name} is already on {crew}. Is that the same person?', { name: twin.name, crew: twin.crew || L('the list') }),
        [['move', L('Same person: move to {crew}', { crew }), 'primary'], ['new', L('Someone else: add a second {name}', { name: twin.name })]]);
    if (pick === 'move') { movePerson(s, twin.id, c.id); toast(L('{name} moved to {crew}', { name: twin.name, crew })); }
    if (pick === 'new') addPerson(s, name, c.id);
  }
}

export async function settingsAct(act, s, el) {
  if (act === 'addCrew') addCrew(s, L('Crew {x}', { x: String.fromCharCode(65 + s.crews.length) }));
  if (act === 'delCrew' && await ask(L('Remove {name} from the crew list? Existing sheets keep their crew name.', { name: s.crews[el.dataset.i].name }), L('Remove'), 'danger')) removeCrew(s, s.crews[el.dataset.i].id);
  if (act === 'pAdd') await addFromSettings(s, el);
  if (act === 'pEdit') await editPerson(s, el.dataset.pid);
  if (act === 'pDel') {
    const p = personById(s, el.dataset.pid);
    if (p && await ask(L('Take {name} off the list? Sheets and hours keep the name.', { name: p.name }), L('Remove'), 'danger')) removePerson(s, p.id);
  }
  if (act === 'backup') download(new Blob([JSON.stringify(backupData())], { type: 'application/json' }), `schwab-field-backup-${today()}.json`);
  if (act === 'testFolder') {
    try {
      await post(s, { ping: true });
      toast(L('Connected. Finished sheets and reports will save to the review folder.'));
      retryUploads(s);
    } catch (e) {
      toast(e instanceof TypeError ? L("Couldn't reach the review folder. Check the link and your signal.") : L('Review folder said: {error}', { error: folderSays(e.message) }), 'bad');
    }
  }
  save(KEYS.settings, s);
}

// Everything this phone keeps, as stored, except the hub key: a backup file gets passed around, and the PM can send a
// new invite. The device secret goes along, so a restored phone keeps its own hours.
export function backupData() {
  const data = Object.fromEntries(Object.values(KEYS).map(k => [k, load(k, null)]));
  for (const k of [KEYS.settings, KEYS.hub]) if (data[k] && typeof data[k] === 'object') data[k] = { ...data[k], hubKey: '' };
  return data;
}
export const isBackup = data => !!data && typeof data === 'object' && Object.values(KEYS).some(k => k in data);
// Writes every key the backup has; false if the phone ran out of space part way.
export const restoreData = data => Object.values(KEYS).every(k => data[k] == null || save(k, data[k]));

export async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast(L("That file isn't a field app backup"), 'bad'); }
  if (!isBackup(data)) return toast(L("That file isn't a field app backup"), 'bad');
  if (!await ask(L('Replace everything on this phone with this backup?'), L('Replace'), 'danger')) return;
  if (!restoreData(data)) return toast(L('Restore stopped: this phone is out of space. Free space and restore again.'), 'bad');
  location.reload();
}

export function registerSW() {
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

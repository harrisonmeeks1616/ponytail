// Shared by the field app (tasks.html) and its daily report and time clock (report.mjs):
// storage, link codec, time math, the office passcode, small UI pieces.
// Handoff data rides in the URL fragment after "#", which browsers don't send to the host.
// An explicitly configured review receiver also receives PDF copies of finished records.

import ES from './es.mjs';

// The passcode also keeps a key of its own: a tab still running the version before it (phones keep old
// tabs open for days) rewrites settings without it, and an old backup has none. hours: this phone's own
// clock-ins; crewHours: the PM's timesheet of everyone's; device: this phone's hub secret, and hub: the hub link, key, role
// and crew (HUB_FIELDS), each in a key of its own for the same reason as the passcode. roster: the people and crews with
// their ids, kept apart for the same reason (see normSettings). Backups and restores carry every key here (a backup
// leaves out the hub key).
export const KEYS = { settings: 'schwab.settings', tasks: 'schwab.tasks', reports: 'schwab.reports', pin: 'schwab.pin', hours: 'schwab.hours', crewHours: 'schwab.crewHours', device: 'schwab.device', roster: 'schwab.roster', hub: 'schwab.hub' };
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
// Settings with a roster also write it to its own key, wherever they are saved from.
export function save(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    if (key === KEYS.settings && Array.isArray(val?.people) && Array.isArray(val.crews)) localStorage.setItem(KEYS.roster, JSON.stringify(rosterOf(val)));
  } catch { return false; }
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
// A required check as the reader sees it: a default is stored in English and shown in the reader's language; a check
// someone typed shows as typed (the stored text stays the identity a tap or a tick matches on).
export const checkLabel = (text, l) => (DEFAULT_SETTINGS.checks.includes(text) ? L(text, undefined, l) : text);
// Settings from storage, a backup or the hub: known fields only, every crew and person with an id, the roster checked.
// Settings with no people (a tab on a version before the roster saved them, see below) take this phone's roster back.
export function normSettings(raw) {
  const roster = raw && typeof raw === 'object' && !Array.isArray(raw.people) && load(KEYS.roster, null);
  if (Array.isArray(roster?.people)) raw = withRoster(raw, shape(ROSTER_TPL, roster));
  const s = raw ? shape(SETTINGS_TPL, raw) : structuredClone(DEFAULT_SETTINGS);
  fixRoster(s, Array.isArray(raw?.people));
  return s;
}
// A tab still running the version before people had ids (phones keep old tabs open for days) saves settings with no
// people and no crew ids. Rebuilt from the crews' member lists, people added since would get new ids (cut off from their
// sheets and hours) and a second person with someone else's name would be dropped, so those settings take this
// phone's roster back instead: every person keeps their id, each crew its id by name. A name the old tab typed into a
// crew's list that the roster lacks joins that crew (with the id a migration gives it, so every reload agrees).
// ponytail: a crew renamed in the old tab matches no name, so it gets a new id and its people show under "Not on a
// crew" (ids kept). Match by members too if old tabs ever rename crews.
export function loadSettings() {
  const raw = load(KEYS.settings, null), pin = load(KEYS.pin, ''), hub = load(KEYS.hub, null);
  const s = normSettings(raw);
  if (raw && Array.isArray(raw.people)) save(KEYS.roster, rosterOf(s)); // kept current from the first open of this version
  if (PIN_FORMAT.test(pin)) s.pin = pin;
  if (hub && typeof hub === 'object') for (const k of HUB_FIELDS) s[k] = typeof hub[k] === 'string' ? hub[k] : ''; // its own key wins over an old tab's settings, a disconnect included
  return s;
}
const ROSTER_TPL = { crews: [{ id: '', name: '' }], people: [{ id: '', name: '', crewId: '' }] };
const rosterOf = s => ({ crews: s.crews.map(c => ({ id: c.id, name: c.name })), people: s.people });
function withRoster(raw, r) {
  const crews = shape(SETTINGS_TPL.crews, raw.crews), ids = crews.map(c => r.crews.find(x => x.name === c.name)?.id || 'c' + hash('crew|' + nameKey(c.name)));
  const known = new Set(r.people.map(p => nameKey(p.name)));
  const typed = crews.flatMap((c, i) => split(c.members).filter(n => !known.has(nameKey(n)) && known.add(nameKey(n))).map(name => ({ id: '', name, crewId: ids[i] })));
  return { ...raw, crews: crews.map((c, i) => ({ ...c, id: ids[i] })), people: [...r.people, ...typed] };
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
// ponytail: an id made while migrating comes from the name (a 53-bit hash), so phones migrating the same lists agree.
// New people and crews get random ids. A tab still on the old version (its save drops people and crew ids) gets the
// roster back from its own key (KEYS.roster, normSettings), so random ids and two people sharing a name survive it.
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
// crew and members are the names it was made with. aLangs and cLangs: the language each office and crew text was typed in, by
// its field ('scope', 'remain') or a step's id (typedIn, langOf); aLang and cLang: each part's first one, for text typed before those.
// reply: the office's message to the crew. assignAt and crewAt: when the office part and the crew part last changed (the hub's merge stamps).
// news (this phone only): an office message or follow-up reached this crew phone through the hub; the board marks it until the sheet is opened.
export const TASK_TPL = {
  uid: '', origin: '', from: '', id: '', date: '', by: '', floor: '', area: '', crew: '', crewId: '', lead: '', members: [''], memberIds: [''], size: 0,
  scope: '', refs: '', items: [ITEM], checks: [ITEM], aLang: '', aLangs: {},
  allot: 0, allotNote: '', est: 0, estNote: '', pStart: '', pStop: '', checkIn: '',
  aStart: '', aStop: '', delay: 0, status: '', doneText: '', remain: '', comments: '', cLang: '', cLangs: {},
  review: '', reviewer: '', followUp: '', reply: '', replyAt: 0, replyBy: '', sentAt: 0, resultAt: 0, gotAt: 0, updatedAt: 0, filedAt: 0, assignAt: 0, crewAt: 0, news: false,
};
// Ids, dates and times end up in addresses and page markup, so they must keep their exact format.
// Anything else in them (a damaged or crafted link) is dropped here, once, for every link, backup and save.
const FORMAT = { uid: /^[\w-]{1,40}$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/ };
const isDay = d => FORMAT.date.test(d) && addDays(d, 0) === d; // a real calendar day, not 2026-02-30
const isId = x => typeof x === 'string' && FORMAT.uid.test(x); // not undefined, which a regex reads as 'undefined'
const LANG_KEY = /^[A-Za-z0-9][\w-]{0,39}$/; // a field name or a step id; never "__proto__"
const langsOf = m => Object.fromEntries(Object.entries(m && typeof m === 'object' && !Array.isArray(m) ? m : {}).filter(([k, v]) => LANG_KEY.test(k) && (v === 'en' || v === 'es')).slice(0, 300));
export function normTask(t) {
  const n = shape(TASK_TPL, t);
  for (const k of ['aLangs', 'cLangs']) n[k] = langsOf(t?.[k]);
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
// The language a sheet's typed text is in: its own (k: the field, or a step's or check's id), else its part's. The PM and the
// superintendent, or two crew phones, may type in different languages, so each text keeps the one it was typed in.
const CREW_TEXT = new Set(['doneText', 'remain', 'comments']);
export const langOf = (t, k) => (CREW_TEXT.has(k) ? t.cLangs?.[k] || t.cLang : t.aLangs?.[k] || t.aLang);
export function typedIn(t, k, l) {
  const crew = CREW_TEXT.has(k), m = crew ? 'cLangs' : 'aLangs', part = crew ? 'cLang' : 'aLang';
  t[m] = { ...t[m], [k]: l }; // a new object: a template's or another sheet's map is never changed
  t[part] ||= l;
  return t;
}

const ASSIGN = ['id', 'date', 'by', 'floor', 'area', 'crew', 'crewId', 'members', 'memberIds', 'size', 'scope', 'refs', 'aLang', 'aLangs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn', 'reply', 'replyAt', 'replyBy'];
const CREW = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'cLangs', 'resultAt'];

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

// The PM owns the decision answers and the review stamp; the superintendent owns everything else. answers is the
// PM's copy. own: it is this phone's own (the PM phone), so it decides, an answer the PM took back included. Else it is
// a text of unknown age (the superintendent phone, no hub to order it): it only adds, so an older text never takes a
// newer answer back. One whose question was reworded since is added as its own entry, never dropped.
export function mergeAnswers(base, answers, own) {
  for (const d of answers.decisions) {
    if (!own && !d.pm && !d.pmNote) continue;
    const m = base.decisions.find(x => x.q === d.q);
    if (m) Object.assign(m, { pm: d.pm, pmNote: d.pmNote });
    else if (d.pm || d.pmNote) base.decisions.push(d);
  }
  base.pmReview = own ? answers.pmReview : answers.pmReview || base.pmReview;
  base.pmLang = answers.pmLang || base.pmLang;
  return base;
}

// Fresh copy of a task for another day or crew: new identity, empty results.
export function cloneTask(t, date, onlyOpen) {
  const c = normTask(structuredClone(t));
  for (const k of CREW) if (k !== 'lead') c[k] = TASK_TPL[k];
  for (const k of ['review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'sentAt', 'gotAt', 'assignAt', 'crewAt']) c[k] = TASK_TPL[k];
  for (const list of ['items', 'checks']) c[list] = c[list].filter(i => !onlyOpen || !i.done).map(i => { const n = newItem(i.text); if (c.aLangs[i.id]) c.aLangs[n.id] = c.aLangs[i.id]; return n; }); // a step keeps its language under its new id
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
  preparedBy: '', pmReview: '', updatedAt: 0, filedAt: 0, lang: '', pmLang: '', pmAt: 0, // lang, pmLang: the language the superintendent's part and the PM's (answers, review) are typed in; pmAt: the PM part's merge stamp
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
// 'ok' (signed in), 'wrong', 'wait' (too many wrong codes; waitLeft() says how long), or 'unsaved' (the right code, but a full
// phone could not record the sign-in: never reported as a wrong code).
export async function tryPin(s, pin, now = Date.now()) {
  const st = lockState();
  if (st.wait > now) return 'wait';
  if (hasPin(s) && await pinHash(pin, s.pin.slice(0, 16)) === s.pin) return signIn(now) ? 'ok' : 'unsaved';
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
export const weekday = (day, l = lang) => new Date(day + 'T12:00').toLocaleDateString(locale(l), { weekday: 'short' }); // "Thu" ("jue")
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowHM = () => hm(new Date());
export const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
// Minutes from start to stop; a stop earlier than the start is an overnight shift.
export const span = (start, stop) => { const a = toMin(start), b = toMin(stop); return a == null || b == null ? 0 : (b - a + 1440) % 1440; };
export const worked = t => (t.aStart && t.aStop ? Math.max(0, span(t.aStart, t.aStop) - t.delay) : 0); // a sheet's minutes on task, less delays
export const fmtMin = (m, l = lang) => m >= 60 ? L('{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 }, l) : L('{m}m', { m }, l); // PDFs and English message lines pass 'en'
export const t12 = t => { const m = toMin(t); return m == null ? '' : `${(Math.floor(m / 60) + 11) % 12 + 1}:${pad(m % 60)} ${m < 720 ? 'AM' : 'PM'}`; };
// A moment as "Oct 19, 8:15 AM" ("19 oct, 8:15 AM"): the time written like every other time on screen (t12).
export const stamp = (ts, l = lang) => ts ? `${new Date(ts).toLocaleDateString(locale(l), { month: 'short', day: 'numeric' })}, ${t12(hm(new Date(ts)))}` : '';
export const timeOf = ts => t12(hm(new Date(ts)));
export const hrs = n => (Math.round(n * 10) / 10).toString();

// ---------- UI pieces ----------

// A crew's color: by its id when the sheet or shift has one (a renamed crew keeps its color), else by name.
export const crewVar = (s, name, id = '') => { let i = id ? s.crews.findIndex(c => c.id === id) : -1; if (i < 0) i = s.crews.findIndex(c => c.name === name); return `--crew:var(--c${i < 0 ? 4 : i % 6})`; };

// < date >: the arrows move a day (a week: day is its Monday, here this week's), the date opens the calendar, and once
// you have moved off it a chip leads back. v: the screen the arrows and the picker stay on (day, report, clock).
// upcoming: the office board's chip to the next 7 days. The chips keep together, on their own line when the date needs it.
// iconOnly: the title already says the date (a board off today), so the pill shows the calendar alone (the date stays for a screen reader).
export const dateBar = (day, v = 'day', { week = false, here = today(), upcoming = false, iconOnly = false } = {}) => `<div class="datebar daynav">
  <button class="nav-btn" data-go="${v}/${addDays(day, week ? -7 : -1)}" aria-label="${week ? L('Previous week') : L('Previous day')}">${icon('back')}</button>
  <label class="day${iconOnly ? ' icon-only' : ''}">${icon('cal')}<span>${niceDate(day)}</span>
    <input type="date" value="${day}" data-pick="${v}" aria-label="${week ? L('Pick a week') : L('Pick a date')}"></label>
  <button class="nav-btn" data-go="${v}/${addDays(day, week ? 7 : 1)}" aria-label="${week ? L('Next week') : L('Next day')}">${icon('chev')}</button>
  ${day === here && !upcoming ? '' : `<span class="datebar-chips">${day === here ? '' : `<button class="chip today-btn" data-go="${v}/${today()}">${week ? L('This week') : L('Today')}</button>`}${upcoming ? `<button class="chip up-btn" data-go="upcoming/${day}">${L('Upcoming')}</button>` : ''}</span>`}</div>`;

// The day in one quiet line, as Things' Today has no stat tiles: only the parts that are not zero. The board: "6 sheets ·
// 2 ready for review · 1 blocked · 14.5 of 18 crew-hrs"; Live, given here (who is on site): "6 people in 3 crews
// · 2 working · 2 ready for review · 1 blocked". Ready for review and blocked are taps in their status color
// (data-act="sum"; data-uids: the sheets the app scrolls to). '' when there is nothing to say.
export function daySummary(sheets, here = null) {
  const n1 = (n, one, many) => (!n ? '' : n === 1 ? one : many); // the words for n things, nothing for none
  const crews = xs => new Set(xs.map(x => x.crew).filter(Boolean)).size, c = here ? crews(here) : crews(sheets);
  const ofCrews = n1(c, L('1 crew'), L('{n} crews', { n: c }));
  const tap = (ts, tone, words) => (ts.length ? `<button type="button" class="sum-go" data-act="sum" data-tone="${tone}" data-uids="${esc(ts.map(t => t.uid).join(' '))}">${esc(words)}</button>` : '');
  const per = f => sheets.reduce((n, t) => n + f(t) * (t.size || 1), 0), est = per(t => t.est), act = per(t => worked(t) / 60);
  const review = sheets.filter(t => t.origin !== 'link' && t.status && !t.review), blocked = sheets.filter(t => t.status === 'Blocked'), working = sheets.filter(t => t.aStart && !t.status).length;
  let parts;
  if (here) {
    const people = n1(here.length, L('1 person'), L('{n} people', { n: here.length }));
    parts = [people && (ofCrews ? L('{people} in {crews}', { people, crews: ofCrews }) : people), n1(working, L('1 working'), L('{n} working', { n: working }))]; // the On site now heading is right under it
  } else parts = [n1(sheets.length, L('1 sheet'), L('{n} sheets', { n: sheets.length }))]; // the board's crew chips are right under it
  parts = parts.map(esc);
  parts.push(tap(review, 'warn', n1(review.length, L('1 ready for review'), L('{n} ready for review', { n: review.length }))), tap(blocked, 'bad', n1(blocked.length, L('1 blocked'), L('{n} blocked', { n: blocked.length }))));
  if (!here && (est || act)) parts.push(esc(est ? L('{act} of {est} crew-hrs', { act: hrs(act), est: hrs(est) }) : L('{n} crew-hrs', { n: hrs(act) })));
  const shown = parts.filter(Boolean);
  return shown.length ? `<p class="day-sum">${shown.map((p, i) => `<span>${p}${i < shown.length - 1 ? ' ·' : ''}</span>`).join(' ')}</p>` : ''; // a line breaks between parts, never before a dot
}

export const attr = (k, v) => v ? ` ${k}="${esc(v)}"` : '';

export function field(label, k, v, o = {}) {
  const common = `data-k="${k}"${attr('placeholder', o.ph)}${attr('list', o.list)}${attr('inputmode', o.mode)}${attr('data-id', o.id)}`; // id: the list entry this field belongs to, so typing survives a pull that redraws the list
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

// Line icons, 24 x 24 in the text color. An icon is never the only label: its button carries aria-label (or text).
const ICONS = {
  today: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.6 1.6L8 4.7M3.5 12l1.6 1.6L8 10.7M3.5 18l1.6 1.6L8 16.7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  report: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  live: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  records: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" stroke="none"/>',
  del: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM13 9.5l5 5M18 9.5l-5 5"/>',
  updown: '<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>',
  share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1.5"/>',
  message: '<path d="M12 4c4.97 0 9 3.36 9 7.5S16.97 19 12 19c-1.1 0-2.15-.16-3.12-.46L4 20.5l1.4-3.7C3.9 15.5 3 13.6 3 11.5 3 7.36 7.03 4 12 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.1-3.1a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.1 3.1a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9"/>',
};
export const icon = (name, cls = '') => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// The large title each screen opens with: the title, a quiet line under it (sub), the screen's ⋯ menu (more: the
// data-act it opens) and, on a drill-in screen, the way back (back: { go, label }, a data-go address; or { act, v,
// label }, a tap the screen handles). render() clears it, so a screen that doesn't call it shows no stale title.
export function screenHead(title, { sub = '', more = '', back = null } = {}) {
  const $ = id => globalThis.document?.getElementById(id);
  if (!$('title')) return;
  $('title').textContent = title;
  $('subtitle').textContent = sub;
  $('titleMore').innerHTML = more ? `<button class="icon-btn more" data-act="${esc(more)}" aria-label="${L('More actions')}">${icon('more')}</button>` : '';
  const to = back?.act ? `data-act="${esc(back.act)}" data-v="${esc(back.v ?? '')}"` : `data-go="${esc(back?.go)}"`; // a drill-in inside a screen goes back by its tap
  $('headBack').innerHTML = back ? `<button class="link back" ${to}>${icon('back')}<span>${esc(back.label)}</span></button>` : '';
}

// An Undo offer that lasts ms. tap() runs undo once, if the offer is still open; it ends by itself after ms, or when
// end() is called (another message took its place). done(undone) runs once when it ends, either way: after an Undo, or
// the moment a removal becomes final (then, and only then, send a hub purge). Timers are passed in so tests need no page.
export const UNDO_MS = 6000, TOAST_MS = 3200;
export function undoOffer(undo, { ms = UNDO_MS, done, set = setTimeout, clear = clearTimeout } = {}) {
  let open = true;
  const end = undone => { if (!open) return false; open = false; clear(timer); done?.(undone); return true; };
  const timer = set(() => end(false), ms);
  return {
    tap() { if (!open) return false; try { undo(); } finally { end(true); } return true; },
    end: () => end(false),
    get open() { return open; },
  };
}

// A short message above the tab bar. tone 'bad' for something that went wrong. With undo, the message carries an Undo
// button for 6 seconds (see undoOffer; done is passed on).
export function toast(msg, tone = '', { undo, done } = {}) {
  let el = document.getElementById('toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast' }); el.setAttribute('role', 'status'); }
  (document.querySelector('dialog[open] .sheet-in') || document.body).append(el); // an open sheet would cover it otherwise
  el.offer?.end(); // a new message ends the last one's Undo: that removal is final now
  el.offer = undo ? undoOffer(undo, { done }) : null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" class="toast-undo">${L('Undo')}</button>` : ''}`;
  if (undo) el.querySelector('.toast-undo').onclick = () => { el.offer?.tap(); el.classList.remove('show'); };
  el.dataset.tone = tone;
  el.classList.add('show');
  el.at = Date.now(); // tasks.html route(): a toast older than the move to another screen goes
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove('show'), undo ? UNDO_MS : TOAST_MS);
}

// A double tap is one tap. When a finger taps the same spot again within 350 ms, the second tap does nothing: the first
// one changed what is under it (opened or closed a sheet, moved to another screen, set a toggle, removed a row), so the
// second would land on something the person never saw (Copy link, Send anyway, a crew to move to, the next question,
// the next row's ✕) or undo what the first just set (a checkbox, a segment, a chip). Only what is made for tapping again
// and again counts every tap: the delay stepper and the date arrows, known by their hooks rather than their node (they
// are drawn again under the finger; an arrow's data-go names the next day each time, so its date is left out), and a key
// that stays put (the passcode pad, a text box). A mouse (a deliberate double-click) and a keyboard's click (detail 0)
// always count; a tap that turns into a scroll is forgotten.
const HOOKS = ['act', 'go', 'v', 'i', 'list'];
const tapKey = c => (HOOKS.some(k => c.dataset?.[k] != null) ? HOOKS.map(k => (k === 'go' ? c.dataset.go?.replace(/\d{4}-\d{2}-\d{2}/g, '') : c.dataset[k])).join('|') : c);
let lastTap = null, dropTap = false;
globalThis.document?.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') { lastTap = null; dropTap = false; return; }
  const c = e.target.closest?.('[data-act], [data-go], button, a, input, select, textarea, label') || e.target;
  const tap = { at: e.timeStamp, x: e.clientX, y: e.clientY, key: tapKey(c) };
  const again = tap.key === lastTap?.key && (typeof tap.key !== 'string' || !!c.matches?.('.nav-btn, .stepper > .x'));
  dropTap = !!lastTap && tap.at - lastTap.at < 350 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 30 && !again;
  if (!dropTap) lastTap = tap;
}, true);
globalThis.document?.addEventListener('pointercancel', () => { lastTap = null; dropTap = false; }, true);
globalThis.document?.addEventListener('click', e => { if (dropTap && e.isTrusted && e.detail) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

// A button whose work sends, shares, downloads or saves: while the work runs the button is off and shows a spinner, and
// another tap on it (or on its redrawn twin with the same data-act) does nothing, so a double tap can't send twice.
// work: a function (it never starts on a refused tap) or a promise. Resolves to the work's result; undefined if refused.
const running = new Set();
export async function busy(btn, work) {
  const key = btn?.dataset?.act || btn;
  if (running.has(key)) return undefined;
  running.add(key);
  const was = btn.disabled;
  btn.disabled = true;
  btn.setAttribute?.('aria-busy', 'true');
  try { return await (typeof work === 'function' ? work() : work); } finally {
    running.delete(key);
    btn.disabled = was;
    btn.removeAttribute?.('aria-busy');
  }
}

// A sheet slides up from the bottom. It closes with its ✕, a tap outside it, Escape, or a swipe down from its top.
export function sheet(html) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.dataset.at = location.hash; // the screen it was opened on: leaving that screen (the Back button) closes it
  d.innerHTML = `<div class="sheet-in"><div class="grabber" aria-hidden="true"></div><form method="dialog"><button class="sheet-x" aria-label="${L('Close')}">${icon('close')}</button></form>${html}</div>`;
  d.addEventListener('close', () => { const t = d.querySelector('#toast'); if (t) document.body.append(t); d.remove(); }); // a toast shown in the sheet outlives it
  const opened = Date.now(); // the second tap of a double tap that opened it isn't a tap outside
  d.addEventListener('click', e => { if (e.target === d && Date.now() - opened > 350) d.close(); }); // tap outside
  swipeDown(d);
  document.body.append(d);
  d.showModal();
  const shown = document.querySelector('#toast.show');
  if (shown) d.firstElementChild.append(shown); // an Undo still on offer stays in reach above the sheet
  const box = d.firstElementChild; // focus starts on the sheet itself, not its ✕ (no ring flashing on the close button)
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
  return d;
}
// The sheet follows a finger pulling down while it is scrolled to its top (never from a text box); let go past 80 px
// and it closes, short of that it springs back.
function swipeDown(d) {
  let y0 = null, dy = 0;
  d.addEventListener('touchstart', e => { dy = 0; y0 = d.scrollTop <= 0 && e.touches.length === 1 && !e.target.closest('input, textarea, select') ? e.touches[0].clientY : null; }, { passive: true });
  d.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy < 0 && !d.style.transform) { y0 = null; return; } // scrolling the sheet up: not a swipe
    e.preventDefault();
    d.style.transition = 'none';
    d.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    d.style.transition = d.style.transform = '';
    if (dy > 80) d.close();
  };
  d.addEventListener('touchend', end);
  d.addEventListener('touchcancel', end);
}

// In-page question as an action sheet: bigger targets than the browser's, and the buttons say what they do.
// opts: [[value, label, tone]] (tone 'danger' or 'primary'); resolves to the value tapped, or null for Cancel or closing it.
export const choose = (msg, opts) => new Promise(res => {
  const d = sheet(`<p class="ask">${esc(msg)}</p><div class="acts">${opts.map(([, label, tone], i) => `<button class="btn ${tone || ''}" data-a="${i + 1}">${esc(label)}</button>`).join('')}</div><button class="btn cancel" data-a="0">${L('Cancel')}</button>`);
  d.classList.add('action');
  d.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { res(+b.dataset.a ? opts[b.dataset.a - 1][0] : null); d.close(); } });
  d.addEventListener('close', () => res(null));
});
export const ask = async (msg, yes, tone = 'primary') => (await choose(msg, [[true, yes, tone]])) === true;

// The share sheet: the message, then one big row per way to send it (Share, Text message, Email, Copy link). The link
// itself sits quietly at the bottom, for when copying is refused and it has to be selected by hand. The title's hyphens
// don't break (T1019-01 stays on one line).
export function sendSheet({ title, text, url, note = L('The work details are inside the link itself.') }) { // note: the line under the ways to send it
  const msg = `${text}\n${url}`, way = (ic, label) => `${icon(ic)}<span>${label}</span>`;
  const d = sheet(`<h3>${esc(title).replace(/(\w)-(\w)/g, '$1\u2011$2')}</h3><p class="preview">${esc(text)}</p>
    <div class="btns share-acts">
      ${navigator.share ? `<button class="btn" data-s="share">${way('share', L('Share…'))}</button>` : ''}
      <a class="btn" href="sms:?&body=${encodeURIComponent(msg)}">${way('message', L('Text message'))}</a>
      <a class="btn" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(msg)}">${way('mail', L('Email'))}</a>
      <button class="btn" data-s="copy">${way('link', L('Copy link'))}</button>
    </div>
    <p class="hint">${url.length > 1800 ? L('Long link: send by iMessage, WhatsApp or email. Some plain SMS apps cut long links.') + ' ' : ''}${note}</p>
    <textarea class="linkbox" readonly rows="2" aria-label="${L('Link')}">${esc(url)}</textarea>`);
  d.classList.add('share');
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (b) busy(b, async () => { // a double tap can't open the share sheet twice
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
  });
}

// Paste box for when a link was copied instead of tapped.
export const pasteSheet = onCode => {
  const d = sheet(`<h3>${L('Open a link someone sent you')}</h3><p class="hint">${L('Paste the whole message or just the link. Use this when a link opened in a different browser or app than this one.')}</p>
    <textarea class="linkbox paste" rows="3" aria-label="${L('Paste link here')}" placeholder="${L('Paste link here')}"></textarea><div class="btns"><button class="btn primary big" data-open>${L('Open')}</button></div>`);
  d.classList.add('paste');
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
// Its sheet is re-dated on load and filed again, so nothing is lost. A backup file gets passed around, so only a PDF
// (base64 of %PDF-...) and only its own fields go out: whatever else a crafted item carries (ping, url) is never sent.
const clean = list => (Array.isArray(list) ? list : []).filter(x => isDay(x?.date) && typeof x.pdf === 'string' && x.pdf.length % 4 === 0 && /^JVBERi[0-3][A-Za-z0-9+/]*={0,2}$/.test(x.pdf))
  .map(({ date, name, pdf, v }) => ({ date, name, pdf, v }));
const box = () => clean(load(OUTBOX, []));
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

let flushing = null;
// Resolves to { left, error }. error stays empty for "no signal", which simply waits for the next try.
export const flush = s => (flushing ||= (async () => {
  let error = '';
  for (const item of s.folderUrl ? box() : []) {
    if (!box().some(x => sameCopy(x, item))) continue; // replaced by a newer copy while this ran; that one goes next time
    try {
      await post(s, item);
      save(OUTBOX, box().filter(x => !sameCopy(x, item))); // only this copy: an edit saved meanwhile stays queued
    } catch (e) {
      if (!(e instanceof TypeError)) { // refused: back of the line, so it can't hold up the records behind it
        error = e.message;
        if (box().some(x => sameCopy(x, item))) save(OUTBOX, [...box().filter(x => !sameCopy(x, item)), item]); // a newer edit already replaced this refused copy
      }
      break; // no signal or a refusal: one try per flush keeps a wrong site code from re-sending every PDF
    }
  }
  return { left: queued(), error };
})().finally(() => { flushing = null; }));

// file: { date, name, bytes, v }. v is the record's last edit time, preserved in the receiver's
// metadata so an older offline edit can be distinguished without deleting newer records.
// onQueued() runs once the PDF is queued, before any upload: the caller marks its record filed there, so a screen left
// mid-upload (or a page closed) doesn't queue the same version again with a new "Saved" minute, a second PDF.
export async function fileAway(s, f, onQueued) {
  if (!s.folderUrl) return false;
  const item = { date: f.date, name: f.name, pdf: b64(f.bytes), v: f.v || 0 };
  if (!isDay(item.date)) return false; // the folder refuses an impossible day; never claim it was filed
  if (!queue(item)) { toast(L("This phone is out of space, so the PDF wasn't queued. Use Save as PDF."), 'bad'); return false; }
  onQueued?.();
  const waiting = () => box().some(x => sameCopy(x, item));
  let r = await flush(s);
  if (waiting()) r = await flush(s); // another upload was mid-way, or a refused record went first; go again for this one
  // Report on this record only; another record's refusal is not this one's failure.
  toast(!waiting() ? L('Saved to the review folder') : r.error ? L('Review folder said: {error}. Kept on this phone; check Settings.', { error: folderSays(r.error) })
    : L('Saved on this phone. It goes to the review folder when there is signal.'), waiting() && r.error ? 'bad' : '');
  return true; // queued durably, even if delivery must retry later
}

export function retryUploads(s) {
  const before = queued();
  if (before && s.folderUrl) flush(s).then(r => r.left < before && toast(L('Uploaded to the review folder: {n}', { n: before - r.left })));
}

// ---------- settings (office only: behind the passcode) ----------

// Everything this app keeps on the phone, the hub sync's record and the translation cache included (they are as large as the records they describe).
const storedChars = () => { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('schwab.')) n += (localStorage.getItem(k) || '').length; } } catch {} return n; };
// hub: the Settings > Hub group (live.mjs hubSettingsView), between the checks and the review folder.
export function settingsView(s, hub = '') {
  const roles = ['Crew member', 'Superintendent', 'Project manager']; // a crew phone (set on its first run) shows no office words
  const n = queued();
  return `<div class="settings">
    ${setSec(L('This phone'), `<div class="fgroup">
      ${pickRow(L('Language'), 's.lang', getLang(), [['en', 'English'], ['es', 'Español']])}
      ${field(L('Your name'), 's.me', s.me, { ph: L('Used for "Assigned by", sign-offs') })}
      ${pickRow(L('Your role'), 's.role', s.role, roles.map(r => [r, L(r)]))}</div>`)}
    ${setSec(L('Office passcode'), `<div class="fgroup">${actRow('changePin', L('Change the passcode'))}</div>`,
      L("Opens the office screens. Use the same code on the PM's and the superintendent's phones."))}
    ${setSec(L('Project'), `<div class="fgroup">${field(L('Project'), 's.project', s.project)}${field(L('Location'), 's.site', s.site)}
      ${field(L('Superintendent'), 's.super', s.super)}${field(L('Project manager'), 's.pm', s.pm)}</div>`)}
    ${setSec(L('Floors / levels'), linesBox('s.floors', s.floors, L('Floors / levels')), L('One per line. They show up as quick picks; you can still type any floor.'))}
    ${setSec(L('People and crews'), `<p class="hint set-note">${L('Tap a name to rename the person or move them to another crew. Picking a crew on a task fills in its people.')}</p>
      ${s.crews.map((c, i) => crewEditor(s, c, i, 'Mike R, Jose L, Tre W')).join('')}
      ${s.people.some(p => !p.crewId) ? `<div class="crew-edit"><h4 class="caption">${L('Not on a crew')}</h4><div class="fgroup">${whoRows(s, '')}</div></div>` : ''}
      <button class="btn wide" data-act="addCrew">${L('+ Add crew')}</button>`)}
    ${setSec(L('Finish / accuracy checks'), linesBox('s.checks', s.checks, L('Finish / accuracy checks')), L('One per line. Tap them onto a task as required checks.'))}
    ${hub}
    ${setSec(L('Review folder'), `<div class="fgroup">${field(L('Folder upload link'), 's.folderUrl', s.folderUrl, { wide: true, ph: 'https://script.google.com/macros/s/.../exec', mode: 'url' })}
      ${field(L('Site code'), 's.siteCode', s.siteCode, { type: 'password' })}${actRow('testFolder', L('Test the connection'))}</div>`,
      [n ? L('Waiting to upload: {n}', { n }) : L('Nothing waiting to upload.'), L('Optional PDF filing needs an owner-approved Google Drive receiver. Enter its upload link and code manually on each phone that should upload. Task links do not carry the upload code or change these settings.')])}
    ${setSec(L('Backup'), `<div class="fgroup">${actRow('backup', L('Download backup'))}
      <label class="row set-act">${L('Restore from backup')}<input type="file" accept="application/json,.json" data-restore class="sr"></label></div>`,
      [L('Everything is stored on this phone only. Download a backup weekly, or before clearing browser data or switching phones.'),
        L('Using about {kb} KB of roughly 5,000 KB.', { kb: Math.ceil(storedChars() / 1024) })])}
  </div>`;
}
// iOS Settings: a caption over each grouped list and quiet notes under it. Fields are .fgroup rows (the Daily
// report's); a choice is a row that opens the phone's own picker; an action is a tinted row.
export const setSec = (title, body, notes = []) => `<section class="set"><h3 class="caption">${title}</h3>${body}${[].concat(notes).map(t => `<p class="hint set-note">${t}</p>`).join('')}</section>`;
export const actRow = (act, label, attrs = '') => `<button type="button" class="row set-act" data-act="${act}"${attrs}>${label}</button>`;
const linesBox = (k, list, label) => `<div class="fgroup"><label class="field"><textarea data-k="${k}" data-lines rows="6" aria-label="${esc(label)}">${esc(list.join('\n'))}</textarea></label></div>`;
// The name on the left, the value on the right; the select lies over the whole row, so a tap anywhere opens the
// phone's picker. A value not in the list (no role yet) shows blank, so picking the first option still counts.
const pickRow = (label, k, v, opts) => {
  const on = opts.find(o => o[0] === v);
  return `<label class="row set-pick"><span class="row-main">${label}</span><span class="row-end">${esc(on ? on[1] : '')}</span>${icon('updown', 'chev')}<select data-k="${k}" aria-label="${esc(label)}">${on ? '' : '<option value="" selected disabled hidden></option>'}${opts.map(([val, name]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
};

// A crew as one group: its name and lead, its people (tap one to rename, move or remove them), and a box to add people
// (several at once with commas), then the crew's own Remove.
function crewEditor(s, c, i, ph) {
  const crew = c.name || L('crew');
  return `<div class="crew-edit" style="--crew:var(--c${i % 6})"><div class="fgroup">
      ${field(L('Crew name'), `s.crews.${i}.name`, c.name, { id: c.id })}${field(L('Lead'), `s.crews.${i}.lead`, c.lead, { id: c.id })}
      ${whoRows(s, c.id) || `<p class="hint">${L('No one on this crew yet.')}</p>`}
      <div class="edit-row"><label class="field"><span>${L('Add people')}</span><input placeholder="${esc(ph)}" aria-label="${esc(L('Add people to {crew}', { crew }))}" enterkeyhint="done" autocomplete="off" data-enter="pAdd" data-crew="${esc(c.id)}"></label>
        <button class="x add" data-act="pAdd" data-crew="${esc(c.id)}" aria-label="${esc(L('Add to {crew}', { crew }))}">+</button></div>
    </div><button class="link danger" data-act="delCrew" data-i="${i}">${L('Remove {name}', { name: esc(crew) })}</button></div>`;
}
// The people on a crew (crewId '': on none) as rows. The initials are drawn by CSS from data-ini, so a row's text is the name alone.
export const initials = name => name.split(' ').slice(0, 2).map(w => Array.from(w)[0]).join('').toUpperCase();
const whoRows = (s, crewId) => s.people.filter(p => p.crewId === crewId).map(p =>
  `<button type="button" class="row who-row" data-act="pEdit" data-pid="${esc(p.id)}" data-ini="${esc(initials(p.name))}"><span class="row-main">${esc(p.name)}</span>${icon('chev', 'chev')}</button>`).join('');

// Tap a person: rename them, move them to another crew, or take them off the list (with Undo). Resolves when the sheet closes.
const editPerson = (s, id) => new Promise(res => {
  const p = personById(s, id);
  if (!p) return res();
  const d = sheet(`<h3>${esc(p.name)}</h3>
    <div class="fgroup"><div class="edit-row"><label class="field"><span>${L('Name')}</span><input name="who" value="${esc(p.name)}" autocomplete="off" enterkeyhint="done"></label>
      <button class="btn" data-save>${L('Rename')}</button></div></div>
    <p class="caption">${L('Move to another crew')}</p>
    <div class="menu">${s.crews.map(c => `<button class="btn" data-move="${esc(c.id)}" style="${crewVar(s, c.name, c.id)}"${c.id === p.crewId ? ' aria-current="true"' : ''}><i class="dot"></i><span>${esc(c.name || L('crew'))}</span>${c.id === p.crewId ? icon('check', 'on') : ''}</button>`).join('')}</div>
    <div class="menu"><button class="btn danger" data-act="pDel" data-pid="${esc(p.id)}">${esc(L('Remove {name}', { name: p.name }))}</button></div>`);
  d.classList.add('who');
  const rename = () => {
    if (!renamePerson(s, id, d.querySelector('[name=who]').value)) return toast(L('Type the name'), 'bad');
    d.close();
  };
  d.querySelector('[name=who]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
  d.addEventListener('click', e => {
    if (e.target.closest('[data-save]')) return rename();
    const m = e.target.closest('[data-move]');
    if (m && m.dataset.move !== p.crewId) { movePerson(s, id, m.dataset.move); toast(L('{name} moved to {crew}', { name: p.name, crew: crewById(s, m.dataset.move)?.name || L('crew') })); }
    if (m) d.close();
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

// change(f) applies f to the settings as they are by then (another tab may have reloaded them), saves and redraws: a
// removal's Undo goes through it. Removing a person or a crew takes effect at once, with Undo for 6 seconds; sheets and
// hours keep the names either way. A removed crew's people wait under "Not on a crew" and go back with the Undo.
export async function settingsAct(act, s, el, change = f => { f(s); save(KEYS.settings, s); }) {
  if (act === 'addCrew') addCrew(s, L('Crew {x}', { x: String.fromCharCode(65 + s.crews.length) }));
  if (act === 'delCrew') {
    const at = +el.dataset.i, c = s.crews[at];
    if (c) {
      const ids = s.people.filter(p => p.crewId === c.id).map(p => p.id);
      removeCrew(s, c.id);
      toast(L('{name} removed from the crew list', { name: c.name || L('crew') }), '', { undo: () => change(t => {
        if (crewById(t, c.id)) return;
        t.crews.splice(Math.min(at, t.crews.length), 0, c);
        for (const id of ids) if (t.people.some(p => p.id === id && !p.crewId)) movePerson(t, id, c.id);
      }) });
    }
  }
  if (act === 'pAdd') await addFromSettings(s, el);
  if (act === 'pEdit') await editPerson(s, el.dataset.pid);
  if (act === 'pDel') {
    const at = s.people.findIndex(p => p.id === el.dataset.pid), p = s.people[at];
    if (p && removePerson(s, p.id)) toast(L('{name} taken off the list', { name: p.name }), '', { undo: () => change(t => {
      if (personById(t, p.id)) return;
      t.people.splice(Math.min(at, t.people.length), 0, p);
      movePerson(t, p.id, p.crewId); // back on their crew if it is still there, and the crew lists rewritten
    }) });
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
  save(KEYS.settings, s) || toast(L("This phone wouldn't save. Open Settings and download a backup."), 'bad'); // a full phone says so, as a sheet does
}

// Everything this phone keeps, including pending PDFs, as stored, except the hub key: a backup file gets passed around, and the PM can send a
// new invite. The device secret goes along, so a restored phone keeps its own hours.
const SYNC = 'schwab.hubSync'; // sync.mjs keeps it, and restoreData below says why it travels with a backup
export function backupData() {
  const data = Object.fromEntries([...Object.values(KEYS), OUTBOX, SYNC].map(k => [k, load(k, null)]));
  for (const k of [KEYS.settings, KEYS.hub]) if (data[k] && typeof data[k] === 'object') data[k] = { ...data[k], hubKey: '' };
  return data;
}
export const isBackup = data => !!data && typeof data === 'object' && Object.values(KEYS).some(k => k in data);
// Writes every key the backup has; false if the phone ran out of space part way. A backup's settings bring their own
// roster (or, from before people had ids, none), never this phone's old one. The hub sync's record of what the hub had of
// each record (sync.mjs schwab.hubSync) comes along and is written last: it describes the restored records, so only what
// was unsynced at backup time goes up and what the hub got since comes back. This phone's own record described the old
// stores, so it goes first; with none in the backup (or a restore cut short) the next round merges pull-first.
// This phone's own hub key, when the backup names the hub and role this phone is on: the key never comes from a file (backupData
// leaves it out; README, Backups), but a phone restoring its own backup stays connected. '' for another hub, another role, or none.
const ownKeyFor = data => { const own = load(KEYS.hub, null), h = data[KEYS.hub]; return own?.hubKey && h && typeof h === 'object' && h.hubUrl === own.hubUrl && h.hubRole === own.hubRole ? own.hubKey : ''; };
export const restoreData = data => {
  const hubKey = ownKeyFor(data);
  for (const k of [KEYS.settings, KEYS.hub]) if (data[k] && typeof data[k] === 'object') data[k] = { ...data[k], hubKey }; // a file never connects a phone to a hub
  try { localStorage.removeItem(SYNC); } catch {}
  return (data[KEYS.settings] == null || save(KEYS.roster, null)) && [...Object.values(KEYS), OUTBOX, SYNC].every(k => data[k] == null || save(k, k === OUTBOX ? clean(data[k]) : data[k]));
};

export async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast(L("That file isn't a field app backup"), 'bad'); }
  if (!isBackup(data)) return toast(L("That file isn't a field app backup"), 'bad');
  const leaves = load(KEYS.hub, null)?.hubKey && data[KEYS.hub] && !ownKeyFor(data); // on a hub, and the file names another hub or role (or none): say what that costs, as Disconnect does
  if (!await ask(leaves ? L('Replace everything on this phone with this backup? It is from another hub or role, so this phone leaves its hub: to connect again you need the PM key or a new invite.') : L('Replace everything on this phone with this backup?'), L('Replace'), 'danger')) return;
  if (!restoreData(data)) { toast(L('Restore stopped: this phone is out of space. Free space and restore again.'), 'bad'); return 'partial'; } // the keys before the full one are written: the page reloads what it shows from storage
  location.reload();
}

export function registerSW() {
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Quick Find (Things 3): search everything on this phone ----------
// The search sheet, the days a search names, the matches in bold and the pull down that opens it. What there is to find
// is the app's (tasks.html quickFind): only what this phone shows, so a crew phone never finds the office's records.

// Every typed word must be found (AND); case, accents and punctuation don't count, as in nameKey ('jose l3' finds 'José, L3-14').
export const findWords = q => [...new Set(nameKey(q).split(' ').filter(Boolean))];
// Each character folded on its own the way nameKey folds, with where it came from, so a match maps back to what was typed.
function fold(text) {
  const cs = Array.from(String(text ?? '')), at = [];
  let f = '';
  cs.forEach((c, i) => { const k = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, ' ').toLowerCase(); for (let j = 0; j < k.length; j++) at.push(i); f += k; });
  return { cs, at, f };
}
// The text, escaped, with every match of a word in bold (an accent typed as its own mark stays with its letter).
export function marked(text, words) {
  const { cs, at, f } = fold(text), on = cs.map(() => false), has = new Set(at);
  for (const w of words) for (let p = f.indexOf(w); p >= 0; p = f.indexOf(w, p + 1)) for (let i = at[p]; i <= at[p + w.length - 1]; i++) on[i] = true;
  for (let i = 1; i < cs.length; i++) if (!has.has(i)) on[i] = on[i - 1];
  return cs.map((c, i) => (on[i] && !on[i - 1] ? '<b>' : '') + esc(c) + (on[i] && !on[i + 1] ? '</b>' : '')).join('');
}
// A long text from a little before its first match, on one line (the end is cut by CSS).
function around(text, words) {
  const { cs, at, f } = fold(text), p = Math.min(...words.map(w => f.indexOf(w)).filter(x => x >= 0)), i = at[p] ?? 0;
  const sp = i > 24 ? cs.indexOf(' ', i - 18) : -1, start = sp >= 0 && sp < i ? sp + 1 : i > 24 ? i - 18 : 0;
  return (start ? '…' : '') + cs.slice(start).join('').replace(/\s+/g, ' ');
}

// Quick Find's days: those a search names ('tomorrow', 'oct 21', 'mié 21', '10/21', '2026-10-21'), nearest to here first
// (a year either way, at most 31). A word with a letter starts a word of the day's name in English or Spanish (weekday,
// month, today, tomorrow, yesterday); a number is one of its numbers. A lone number names no day: '3' is not a date.
let dayWords = null; // [day, its words] for the year either side of here, made once a day
export function daysNamed(words, here = today()) {
  if (!words.length || (words.length === 1 && !/\D/.test(words[0]))) return [];
  if (dayWords?.here !== here) {
    const names = (k, d) => ['en', 'es'].flatMap(l => ['long', 'short'].map(w => new Intl.DateTimeFormat(locale(l), { [k]: w }).format(d)));
    const wd = Array.from({ length: 7 }, (_, i) => names('weekday', new Date(2026, 0, 4 + i, 12))), mo = Array.from({ length: 12 }, (_, i) => names('month', new Date(2026, i, 15, 12))); // 2026-01-04 is a Sunday
    const rel = { [here]: 'Today', [addDays(here, 1)]: 'Tomorrow', [addDays(here, -1)]: 'Yesterday' };
    dayWords = { here, list: Array.from({ length: 731 }, (_, i) => addDays(here, i % 2 ? (i + 1) / 2 : -i / 2)).map(d => {
      const dt = new Date(d + 'T12:00'), [y, m, n] = d.split('-');
      return [d, nameKey([...wd[dt.getDay()], ...mo[dt.getMonth()], y, m, n, +m, +n, ...(rel[d] ? ['en', 'es'].map(l => L(rel[d], {}, l)) : [])].join(' ')).split(' ')];
    }) };
  }
  return dayWords.list.filter(([, ks]) => words.every(w => (/\D/.test(w) ? ks.some(k => k.startsWith(w)) : ks.includes(w)))).slice(0, 31).map(([d]) => d);
}

// The Quick Find sheet: a search box, focused at once so the phone's keyboard opens, and the results as you type under
// small headings, 8 a group until Show all. search(words) returns [[heading, items]] of matches (no words: the recent
// sheets). An item is { lead (markup), title, tag (quiet, after the title), sub (plain text), dot (a crew dot before sub),
// style, texts (everything it was found in) } and whatever pick needs; a word the title, tag and sub lack shows in a line
// of the text it was found in.
// A tap on a result, or Enter for the first, closes the sheet and calls pick(item). Esc, the ✕ or a swipe down closes it.
const FIND_MAX = 8;
export function findSheet(search, pick) {
  const d = sheet(`<h3 class="sr">${L('Quick Find')}</h3><div class="find-top"><label class="find-box">${icon('search')}<input type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="${L('Search sheets, people and days')}" placeholder="${L('Sheets, people and days')}"></label></div>
    <p class="sr" role="status"></p><div class="find-out"></div>`);
  d.classList.add('find');
  d.querySelector('.find-top').append(d.querySelector('.sheet-in > form')); // the ✕ stays beside the box while the results scroll
  const box = d.querySelector('.find-box input'), out = d.querySelector('.find-out'), say = d.querySelector('[role=status]'), all = new Set();
  let shown = [], timer = 0;
  const row = (it, words) => {
    const seen = nameKey(`${it.title} ${it.tag} ${it.sub}`), miss = words.filter(w => !seen.includes(w)), more = miss.length ? (it.texts || []).find(s => miss.some(w => nameKey(s).includes(w))) : '';
    shown.push(it);
    return `<button type="button" class="row" data-find="${shown.length - 1}"${it.style ? ` style="${it.style}"` : ''}><span class="row-lead">${it.lead}</span><span class="row-main"><span class="row-title">${marked(it.title, words)}${it.tag ? ` <span class="find-tag">${marked(it.tag, words)}</span>` : ''}</span>`
      + `${it.sub ? `<span class="row-sub">${it.dot ? '<i class="dot"></i> ' : ''}${marked(it.sub, words)}</span>` : ''}${more ? `<span class="row-sub find-more">${marked(around(more, words), words)}</span>` : ''}</span>${icon('chev', 'chev')}</button>`;
  };
  const draw = () => {
    const q = box.value.trim(), words = findWords(q), groups = search(words).filter(([, items]) => items.length), n = groups.reduce((s, [, items]) => s + items.length, 0);
    shown = [];
    out.innerHTML = groups.map(([head, items]) => {
      const some = all.has(head) ? items : items.slice(0, FIND_MAX);
      return `<h4 class="caption find-h">${esc(head)}</h4><div class="list lead" data-g="${esc(head)}">${some.map(it => row(it, words)).join('')}</div>`
        + (some.length < items.length ? `<button type="button" class="link find-all" data-all="${esc(head)}">${L('Show all')} (${items.length})</button>` : '');
    }).join('') || `<p class="find-none">${esc(words.length ? L('No matches for “{q}”', { q }) : L('Try a room, a name or a day, like “tomorrow”.'))}</p>`;
    say.textContent = !words.length ? '' : n === 1 ? L('1 result') : n ? L('{n} results', { n }) : L('No matches for “{q}”', { q });
  };
  d.addEventListener('click', e => {
    const a = e.target.closest('[data-all]'), r = e.target.closest('[data-find]');
    if (a) { all.add(a.dataset.all); draw(); out.querySelector(`[data-g="${CSS.escape(a.dataset.all)}"]`)?.children[FIND_MAX]?.focus(); } // focus goes on to the first row it showed
    if (r) { d.close(); pick(shown[+r.dataset.find]); }
  });
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 80); });
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); d.close(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    draw();
    if (shown[0]) { d.close(); pick(shown[0]); }
  });
  draw();
  box.focus();
  return d;
}

// Pull down past the top of the page by about 64 px and let go: open(), as in Things. Touch only, only while can() says so,
// and never from the + (it drags). The page's own bounce is left alone. mark() is the element that shows the pull (the
// search button): it grows a little as the finger pulls, and fills in once letting go will open it.
export function pullDown(can, open, mark) {
  let y0 = null, x0 = 0, el = null;
  const show = p => {
    el ||= mark();
    el?.style.setProperty('--pull', p.toFixed(2));
    el?.classList.toggle('armed', p >= 1);
  };
  const stop = () => { y0 = null; if (el) { show(0); el = null; } };
  addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches.length === 1 && scrollY <= 0 && !e.target.closest?.('.fab') && can() ? e.touches[0].clientY : null; }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy < -8 || scrollY > 0 || e.touches.length > 1 || Math.abs(e.touches[0].clientX - x0) > Math.max(24, dy)) return stop(); // a scroll, a pinch or a sideways swipe
    show(Math.min(1, Math.max(0, dy) / 64));
  }, { passive: true });
  addEventListener('touchend', () => { const go = y0 != null && !!el?.classList.contains('armed'); stop(); if (go && can()) open(); });
  addEventListener('touchcancel', stop);
}

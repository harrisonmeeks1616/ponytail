// Hub sync engine (docs/schwab/HUB.md, "Client contract" and "Translation").
// Offline first: this phone's localStorage stays the truth. Each cycle hashes the stores, pushes the parts whose
// hash moved, pulls what the hub has and merges it by the ownership rules, then calls onChange(kinds) so the app can
// reload its in-memory copies. Nothing here touches the DOM except the browser events initHub listens to.
//
// How a conflict is decided: a task or report has two parts, each with one owning role and a stamp (assignAt and
// crewAt; updatedAt and pmAt). The newest stamp wins a part; a part this phone has not pushed yet is "mine" and is
// stamped when the scan first sees it change. Per part, schwab.hubSync keeps s (hash of the local copy the hub
// has), v and vh (stamp and content hash of the hub's version last seen), p and at (the unsynced copy and its stamp),
// x (a copy the hub refused), b (the part as last had from the hub: a sheet's crewBase and assignBase, the settings' base),
// tx (the time of a text merged here).
//
// Who is who (HUB.md, Identity): the hub knows this phone only by its device secret (devSecret, on every request), people
// and crews by their ids in the shared settings, and task sheets by uid. Short task ids are labels that two office phones
// working offline can both hand out.

import { KEYS, HUB_FIELDS, load, save, shape, L, normTask, normShift, normReport, normSettings, mergeAnswers, pack, linkTo, PIN_FORMAT, ensureDevice, nextId, nameKey, findPerson, personById, crewById } from './shared.mjs';

const ROLES = ['crew', 'super', 'pm'];
const URL_OK = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;
const KEY_OK = /^[A-Za-z0-9]{32}$/;
const ERRORS = ['bad_request', 'unauthorized', 'forbidden', 'busy', 'too_large', 'quota', 'not_ready', 'server'];
const BACKOFF = [5, 10, 20, 40, 60]; // seconds after the 1st, 2nd, ... failure in a row
const LIVE_MS = 60e3, TICK_MS = 20e3, POKE_MS = 1500, HALT_MS = 600e3;
const TIMEOUT = { translate: 20e3, archive: 120e3, selftest: 90e3, stats: 40e3 };
const ST = 'schwab.hubSync', TR = 'schwab.tr', TR_MAX = 800;
const CAP = { push: 100, bytes: 500e3, entity: 45e3 }; // the hub takes 200 entities, 1,000,000 characters and 45,000 per entity

const EV_TPL = { rev: 0, ts: 0, who: '', role: '', kind: '', text: '', ref: '' }, ON_TPL = { who: '', in: '', date: '', pid: '', crewId: '', crew: '' }; // pid and crew when the hub sends them
const DEV_ID = /^[0-9a-f]{32}$/;
const SHEET_OK = /^https:\/\/docs\.google\.com\/spreadsheets\/[\w\-/.?=&#%]{0,250}$/; // the PM taps this link: only a Google Sheet
const sheetUrl = u => (typeof u === 'string' && SHEET_OK.test(u) ? u : '');
const CFG_TPL = { project: '', site: '', super: '', pm: '', floors: [''], crews: [{ id: '', name: '', lead: '', members: '' }], people: [{ id: '', name: '', crewId: '' }], checks: [''], pin: '' };

export const A_KEYS = ['id', 'date', 'by', 'floor', 'area', 'crew', 'crewId', 'members', 'memberIds', 'size', 'scope', 'refs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn',
  'review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'aLang', 'aLangs', 'sentAt'];
export const C_KEYS = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'cLangs', 'resultAt'];
const ticks = l => l.filter(i => i.done || i.at).map(i => [i.id, i.done, i.at]); // unticked steps are left out, so a new step is not an edit
const aPart = t => ({ ...pick(t, A_KEYS), items: t.items.map(i => [i.id, i.text]), checks: t.checks.map(i => [i.id, i.text]) });
const cPart = t => ({ ...pick(t, C_KEYS), items: ticks(t.items), checks: ticks(t.checks) });
// A part as this phone last had it from the hub, in wire form (assignBase and crewBase, HUB.md): the hub takes only what changed since.
const aBase = t => { const l = x => x.map(i => ({ id: i.id, text: i.text })); return { ...pick(t, A_KEYS), items: l(t.items), checks: l(t.checks) }; };
const cBase = t => { const l = x => x.filter(i => i.done || i.at).map(i => ({ id: i.id, done: i.done, at: i.at })); return { ...pick(t, C_KEYS), items: l(t.items), checks: l(t.checks) }; };
const TPARTS = [['assign', aPart, 'assignAt', aBase], ['crew', cPart, 'crewAt', cBase]];
const supPart = r => { const { pmReview, pmLang, pmAt, updatedAt, filedAt, decisions, ...rest } = r; return { ...rest, decisions: decisions.map(d => [d.q, d.rec, d.by]) }; };
const pmPart = r => ({ pmReview: r.pmReview, pmLang: r.pmLang, answers: r.decisions.filter(d => d.pm || d.pmNote).map(d => [d.q, d.pm, d.pmNote]) });
// The superintendent part as this phone last had it from the hub, in wire form (supBase, HUB.md): the hub takes only what changed since.
const sBase = r => { const { pmReview, pmLang, pmAt, updatedAt, filedAt, decisions, supBase, ...rest } = r; return { ...rest, decisions: decisions.map(d => ({ q: d.q, rec: d.rec, by: d.by })) }; };
const pBase = r => ({ pmReview: r.pmReview, pmLang: r.pmLang, decisions: r.decisions.map(d => ({ q: d.q, pm: d.pm, pmNote: d.pmNote })) }); // the PM part the same way (pmBase): two PM devices
const RPARTS = [['sup', supPart, 'updatedAt', sBase], ['pm', pmPart, 'pmAt', pBase]];
const PARTS = { t: TPARTS, r: RPARTS, g: [['v', s => cfgPart(s), 'at', s => cfgPart(s)]] };
// A worker's shift is the phone's own words (never edited or gone); a PM-ruled one is everything.
const shiftPart = (s, full) => [s.id, s.device, s.who, s.pid, s.date, s.in, s.out, s.crew, s.crewId, s.tasks, ...(full ? [s.edited.who, s.edited.in, s.edited.out, s.gone] : [])];
// The roster always goes normalized, every crew and person with an id. A tab still on an older version saves settings with
// no people; pushing that would empty the roster on every phone. A config with member lists and no people was written by
// such a phone, so normSettings takes the people back from this phone's own roster key (shared.mjs KEYS.roster), ids and all.
const noRoster = s => !arr(s.people).length && arr(s.crews).some(c => String(obj(c).members || '').trim());
const cfgPart = s => { s = obj(s); const c = shape(CFG_TPL, normSettings(noRoster(s) ? { ...s, people: undefined } : s)); if (!PIN_FORMAT.test(c.pin)) c.pin = ''; return c; };
const inC = raw => ({ ...cfgPart(raw), at: num(obj(raw).at) });

const str = (x, n) => String(x ?? '').slice(0, n);
const num = x => (Number.isFinite(+x) ? +x : 0);
const arr = x => (Array.isArray(x) ? x : []);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const obj = x => (isObj(x) ? x : {});
const dict = x => Object.assign(Object.create(null), obj(x)); // keys come from the hub: "__proto__" must be an ordinary key
const pick = (o, ks) => { const r = {}; for (const k of ks) r[k] = o[k]; return r; };
const canon = x => (Array.isArray(x) ? `[${x.map(canon)}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k]))}}` : JSON.stringify(x));
// ponytail: a 53-bit string hash (cyrb53) tells "changed since the hub last had it"; a collision (about 1 in 9e15) would only delay one push until its next edit.
const hs = x => {
  const s = canon(x);
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
};
const pad = n => String(n).padStart(2, '0');
const dayOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const cutoff = (ms, days) => { const d = new Date(ms); d.setDate(d.getDate() - days); return dayOf(d.getTime()); };
const winDays = role => (role === 'crew' ? 14 : 60);
const ent = (map, k) => (map[k] && typeof map[k] === 'object' ? map[k] : (map[k] = {}));
const sameDoc = (a, b) => canon(a) === canon(b);

export function makeSync(o = {}) {
  const fetchImpl = o.fetchImpl || ((...a) => globalThis.fetch(...a));
  const now = o.now || Date.now;
  const store = o.storage || { get: load, set: save };
  const norm = { task: normTask, shift: normShift, report: normReport, ...o.norm };
  const tm = o.timers || { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) };
  const hidden = o.hidden || (() => typeof document !== 'undefined' && document.hidden === true);
  const toast = o.toast || (() => {});
  const packFn = o.pack || pack, linkFn = o.linkTo || linkTo, ensure = o.ensureDevice || ensureDevice;

  // ---------- settings, state, normalizing ----------

  // The hub fields live in their own key (KEYS.hub), so a tab still on an older version that saves settings without them
  // cannot disconnect the phone; settings keep a copy, as with the passcode. A phone from before that key reads settings.
  const hubRec = s => Object.fromEntries(HUB_FIELDS.map(k => [k, typeof s[k] === 'string' ? s[k] : '']));
  const cfg = () => { const s = obj(store.get(KEYS.settings, null)), h = store.get(KEYS.hub, null); return isObj(h) ? { ...s, ...hubRec(h) } : s; };
  function patchSettings(p) { // the stored settings, and the app's own object if it gave us one, so its next save keeps them
    const next = { ...cfg(), ...p }, ok = store.set(KEYS.settings, next) && store.set(KEYS.hub, hubRec(next));
    if (o.S) Object.assign(o.S, p);
    return ok;
  }
  // This phone's secret and the id the hub derives from it (shared.mjs ensureDevice writes both); empty until it has run.
  const device = () => { const d = obj(store.get(KEYS.device, null)); return KEY_OK.test(d.secret) && DEV_ID.test(d.id) ? d : { secret: '', id: '' }; };
  function hub() {
    const s = cfg();
    if (!URL_OK.test(s.hubUrl) || !KEY_OK.test(s.hubKey)) return null;
    const d = device(), role = ROLES.includes(s.hubRole) ? s.hubRole : '', w = role === 'crew' ? person(s) : { crew: str(s.hubCrew, 60), pid: '' }; // dev labels and finds this phone's own shifts; only secret goes to the hub
    return { url: s.hubUrl, key: s.hubKey, role, crew: w.crew, pid: w.pid, dev: d.id, secret: d.secret };
  }
  // A crew phone is its person's (the time clock name; among namesakes, the one tapped). It pulls their crew on the shared
  // roster, so a person the PM moves to another crew takes the phone along, and the sheets that list them (HUB.md, pull);
  // a name the roster does not know keeps the crew the phone joined.
  function person(s) {
    const R = { crews: arr(s.crews).filter(isObj), people: arr(s.people).filter(isObj) }, joined = str(s.hubCrew, 60), byId = personById(R, s.workerId);
    const me = byId && nameKey(byId.name) === nameKey(s.worker) ? byId : findPerson(R, s.worker, R.crews.find(c => c.name === joined)?.id);
    return { crew: str(crewById(R, me?.crewId)?.name, 60) || joined, pid: str(me?.id, 40) };
  }
  const sigOf = c => [c.role, c.crew, winDays(c.role), ...(c.pid ? [c.pid] : [])].join('|'); // a new one: the next pull is a full one
  function loadState() {
    // url and away: the hub this phone was disconnected from, and true until the first scan after (disconnect)
    const s = obj(store.get(ST, null)), st = { rev: num(s.rev), sig: String(s.sig || ''), skew: num(s.skew), ok: num(s.ok), url: String(s.url || ''), away: s.away === true };
    for (const k of ['t', 'h', 'm', 'r', 'g', 'told', 'del']) st[k] = dict(s[k]);
    return st;
  }
  let meta = null; // what hubStatus shows, so a screen can ask on every draw without reading the whole state
  const saveState = st => { meta = pick(st, ['rev', 'ok', 'skew']); return store.set(ST, st); };
  const inT = raw => {
    const t = norm.task(raw);
    for (const l of ['items', 'checks']) { const seen = new Set(); t[l] = t[l].filter(i => i.id && !seen.has(i.id) && seen.add(i.id)); }
    return t;
  };
  const inS = raw => norm.shift(raw); // the person, crew and task links (pid, crewId, tasks [{uid, id}]) are in SHIFT_TPL
  const inR = (raw, key) => { const r = norm.report(raw); return r.date && r.date === key ? r : null; };
  function readLocal(c) {
    const rawR = c.role === 'crew' ? {} : obj(store.get(KEYS.reports, {})), reports = [], other = {}, rawT = arr(store.get(KEYS.tasks, []));
    for (const [d, r] of Object.entries(rawR)) { const n = inR(r, d); if (n) reports.push(n); else other[d] = r; }
    return {
      tasks: rawT.map(inT).filter(t => t.uid),
      older: new Set(rawT.filter(x => isObj(x) && !('assignAt' in x)).map(x => x.uid)), // sheets a tab of a version before the hub saved
      hours: arr(store.get(KEYS.hours, [])).map(inS).filter(Boolean),
      crewH: c.role === 'pm' ? arr(store.get(KEYS.crewHours, [])).map(inS).filter(Boolean) : [], // only the PM's phone keeps (and pushes) the timesheet
      reports, other,
    };
  }

  // ---------- status ----------

  let cur = { state: 'off', message: '', at: 0 }, pending = 0, info = {}, live = { events: [], onsite: [], at: 0 };
  let epoch = 0, running = null, again = false, timer = 0, pokeT = 0, fails = 0, nextAllowed = 0, lastTry = 0, refused = false; // refused: a refused key was said out loud
  const err = (code, m) => Object.assign(new Error(m || say(code)), { code });
  const pmHere = () => { const s = cfg(); return s.hubRole ? s.hubRole === 'pm' : s.role === 'Project manager'; }; // connecting, the role is not known yet: the phone's own
  const bad = code => ({ ok: false, error: code, message: say(code) });
  // connect, invite and the PM's one-off actions: nothing retries them, so no "trying again" or "goes to the hub" wording
  const lost = e => { const code = e.code || 'server'; return { ok: false, error: code, message: ['offline', 'busy', 'quota', 'server'].includes(code) ? L('That did not work. Try again.') : e.message }; };
  function say(code) {
    return ({
      offline: L('No signal. Your work is saved on this phone and goes to the hub when you are back online.'),
      unauthorized: pmHere() ? L('The hub did not accept this PM key. Copy it again from the Execution log of the hub script and paste all of it. If it is lost, run resetPmKey there.')
        : L('The hub did not accept this phone. Ask the PM for a new invite link.'), // the PM pastes its key from the setup; everyone else joins by invite
      forbidden: L('This phone is not allowed to do that on the hub.'),
      busy: L('The hub is busy. Trying again in a minute.'),
      quota: L('The hub has reached its daily limit. It will try again later.'),
      not_ready: L('The hub is not set up yet. Ask the PM to finish the hub setup.'),
      bad_reply: L('That address did not answer like the hub. Check the hub link.'),
      space: L('This phone is out of space, so hub updates could not be saved. Download a backup and free some space.'),
      bad_url: L('Use the hub link that ends in /exec'),
      bad_key: L('The hub key is 32 letters and numbers'),
      bad_join: L('That hub invite is not valid'),
      mismatch: L('This invite does not match the hub. Ask for a new one.'),
      already: L('This phone is already connected to a different hub. Disconnect it first to join this one.'),
      crew_key: L('That is the crew key: crew phones join with the crew invite. On this phone, paste the PM key from the Execution log of the hub script, or open the superintendent invite.'),
      pm_key: L('That is not the PM key. This phone is set to Project manager, so it connects only with the PM key from the Execution log of the hub script.'),
      no_reach: L('That did not work. Check the signal and try again. If it still fails, check that the hub deployment is set to Who has access: Anyone.'),
      off: L('This phone is not connected to a hub'),
    })[code] || L('The hub had a problem. Trying again shortly.');
  }
  function setStatus(state, message = '', at = cur.at) {
    const changed = cur.state !== state || cur.message !== message;
    cur = { state, message, at };
    if (changed) try { o.onStatus?.(hubStatus()); } catch (e) { queueMicrotask(() => { throw e; }); }
  }
  function hubStatus() {
    const c = hub();
    if (!c) return { state: 'off', message: '', at: 0, pending: 0, role: '', crew: '', rev: 0 };
    let { state, message } = cur;
    if (state === 'off') state = 'offline'; // a hub is set but no round has said how it is yet (the page just opened): not off, not live
    if (state === 'live' && now() - cur.at >= LIVE_MS) { state = 'offline'; message = say('offline'); }
    const m = meta ||= pick(loadState(), ['rev', 'ok', 'skew']);
    return { state, message, at: cur.at || m.ok, pending, role: c.role, crew: c.crew, rev: m.rev, skew: m.skew }; // skew: hub time minus this phone's clock, sent with texts (fromText)
  }
  const notify = kinds => { if (kinds.size) try { o.onChange?.([...kinds]); } catch (e) { queueMicrotask(() => { throw e; }); } };

  // ---------- transport ----------

  async function call(action, extra = {}, opt = {}) {
    const c = opt.cfg || hub();
    if (!c) throw err('off');
    const ac = typeof AbortController === 'undefined' ? null : new AbortController(), t0 = now();
    const timeout = tm.set(() => ac?.abort(), opt.timeout || TIMEOUT[action] || 30e3);
    let j = null, status = 0;
    try {
      // A plain-text body keeps this a "simple" request, which Apps Script answers without a CORS preflight. The key and the
      // device secret ride in the body, never the address; the hub works out the device from the secret, so no dev is sent.
      const res = await fetchImpl(c.url, { method: 'POST', body: JSON.stringify({ ...extra, v: 1, key: c.key, action, ...(c.secret && { devSecret: c.secret }) }), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        signal: ac?.signal, credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store' });
      status = res.status;
      j = await res.json().catch(() => null);
    } catch { throw err('offline'); } finally { tm.clear(timeout); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw err(status && status < 500 && (opt.cfg || status >= 400) ? 'bad_reply' : 'server'); // Google's error page (200) from a working hub: its problem, not the link
    if (j.ok !== true) {
      const code = ERRORS.includes(j.error) ? j.error : 'server'; // our own wording: the hub's text is never shown
      if (code === 'unauthorized' && !opt.cfg) setStatus('error', say(code));
      throw err(code);
    }
    if (!opt.cfg && num(j.now) > 1e12 && hub()?.url === c.url) { const st = loadState(); st.skew = Math.round(j.now - (t0 + now()) / 2); saveState(st); } // not after a disconnect
    return j;
  }

  // ---------- scan: which local parts the hub does not have yet ----------

  const skewed = st => now() + st.skew;
  // A part seen for the first time, or changed while disconnected (st.away), is stamped with its sheet's own last-edit time, never "now": a phone
  // joining with old data, or edited while disconnected, cannot beat a newer hub copy.
  // Always above the last version this phone knew, so an edit cannot lose to the phone's own earlier push.
  function stampOf(st, pr, edited, seen) {
    const floor = Math.max(num(pr.v), num(seen)) + 1;
    return Math.max(floor, pr.s === undefined || pr.v === undefined || st.away ? (edited > 0 ? Math.min(skewed(st), edited + st.skew) : 0) : skewed(st));
  }
  const wireTask = (t, sent) => {
    const w = { uid: t.uid, date: t.date }, A = sent.assign, C = sent.crew; // the hub validates every sheet by uid and day, so the day goes with a crew part too; the crew key ignores it
    if (A) Object.assign(w, pick(t, A_KEYS), { assignAt: A.at }, A.b && { assignBase: A.b });
    if (C) Object.assign(w, pick(t, C_KEYS), { crewAt: C.at }, C.b && { crewBase: C.b });
    for (const l of ['items', 'checks']) w[l] = t[l].map(i => ({ id: i.id, ...(A && { text: i.text }), ...(C && { done: i.done, at: i.at }) })); // a crew phone sends ticks, never wording
    return w;
  };
  const wireReport = (r, sent, rec) => { // the base's pmAt: the PM part this phone last had, so an answer it saw goes with a question it takes out
    const { filedAt, ...w } = r, S = sent.sup && { updatedAt: sent.sup.at, supBase: sent.sup.b ? { ...sent.sup.b, pmAt: num(rec.pm?.v) } : null }, P = sent.pm && { pmAt: sent.pm.at, pmBase: sent.pm.b || null }; // null: this phone never had the hub's copy
    if (sent.sup && sent.pm) return { ...w, ...S, ...P };
    if (sent.sup) return { ...w, decisions: r.decisions.map(d => ({ ...d, pm: '', pmNote: '' })), pmReview: '', pmLang: '', pmAt: 0, ...S };
    return { date: r.date, decisions: r.decisions.filter(d => d.q || d.pm || d.pmNote).map(d => ({ q: d.q, pm: d.pm, pmNote: d.pmNote })), pmReview: r.pmReview, pmLang: r.pmLang, ...P, updatedAt: 0 }; // every question, so an answer the PM took back is taken back on the hub too
  };
  const wireShift = (s, full, at) => ({ id: s.id, device: s.device, who: s.who, pid: s.pid, date: s.date, in: s.in, out: s.out, crew: s.crew, crewId: s.crewId, tasks: s.tasks,
    edited: full ? s.edited : { who: false, in: false, out: false }, gone: full ? s.gone : false, at: full ? s.at : at });

  // Returns the pushable items; stamps new edits and forgets records of things no longer here. Pure bookkeeping: no network, no store writes.
  function scan(st, c, lc) {
    const items = [], seen = { t: new Set(), h: new Set(), m: new Set(), r: new Set() };
    const tw = c.role === 'crew' ? ['crew'] : ['assign', 'crew'], rw = c.role === 'pm' ? ['sup', 'pm'] : c.role === 'super' ? ['sup'] : [];
    const parts = (k, key, doc, defs, writes, edited, wire) => {
      const rec = ent(st[k], key), sent = {};
      seen[k].add(key);
      for (const [p, fn, at] of defs) {
        const pr = ent(rec, p), h = hs(fn(doc)), tx = pr.tx; // tx: a texted copy merged here is as old as the text (fromText)
        delete pr.tx;
        if (!writes.includes(p)) continue; // not this role's part: left as the hub last had it, so a role that owns it later sends what changed (OWNER3-01)
        if (pr.s === h) { delete pr.p; delete pr.at; } else if (pr.x !== h) {
          if (pr.p !== h) Object.assign(pr, { p: h, at: tx || stampOf(st, pr, edited, doc[at]) });
          sent[p] = { h, at: pr.at, b: pr.b };
        }
      }
      if (Object.keys(sent).length) items.push({ k, key, sent, wire: wire(doc, sent, rec) });
    };
    for (const t of lc.tasks) {
      // A tab on a version before the hub saved this sheet without the office fields it cannot hold (message, crew and people ids).
      // Its office part is not pushed over the hub's: the next pull is a full one and brings the hub's copy back (that tab's own
      // edit to it is dropped). ponytail: seen only until this phone saves its sheets again; a tab reload ends the old version.
      const a = st.t[t.uid]?.assign, h = a && hs(aPart(t));
      if (lc.older?.has(t.uid) && a && a.s !== h && tw.includes('assign')) { Object.assign(a, { s: h }); for (const k of ['v', 'vh', 'p', 'at']) delete a[k]; st.sig = ''; }
      parts('t', t.uid, t, TPARTS, tw, t.updatedAt, wireTask);
    }
    for (const r of lc.reports) parts('r', r.date, r, RPARTS, rw, r.updatedAt, wireReport);
    const shifts = (k, list, can, full) => {
      for (const s of list) {
        const pr = ent(ent(st[k], s.id), 'v'), h = hs(shiftPart(s, full));
        seen[k].add(s.id);
        if (!can(s, pr, h)) pr.s = h;
        else if (pr.s === h) delete pr.p;
        else if (pr.x !== h) {
          if (pr.p !== h) Object.assign(pr, { p: h, at: Math.max(skewed(st), num(pr.at) + 1) });
          items.push({ k, key: s.id, sent: { v: { h, at: pr.at } }, wire: { ...wireShift(s, full, pr.at), ...(full && { pmAt: pr.at, base: pr.b }) } }); // the PM's edit stamp and base (HUB.md, PM rules)
        }
      }
    };
    shifts('h', lc.hours, s => c.dev && s.device === c.dev, false);
    shifts('m', lc.crewH, (s, pr, h) => !(c.dev && s.device === c.dev) || s.gone || Object.values(s.edited).some(Boolean) || (pr.b && hs(shiftPart(pr.b, true)) !== h), true); // own punches go from the clock; corrections made in Crew hours go from its hub base
    const pr = ent(ent(st.g, 'c'), 'v'), cp = cfgPart(cfg()), h = hs(cp);
    if (c.role === 'crew') { /* never sends settings: left as the hub last had them, as an office part is above */ } else if (pr.s === h) { delete pr.p; delete pr.at; } else if (pr.x !== h) {
      if (pr.p !== h) Object.assign(pr, { p: h, at: Math.max(skewed(st), num(pr.v) + 1, num(pr.at) + 1) }); // the hub orders two office phones' settings by this stamp
      items.push({ k: 'g', key: 'c', sent: { v: { h, at: pr.at, b: pr.b } }, wire: { ...cp, at: pr.at, ...(pr.b && { base: pr.b }) } });
    }
    for (const k of Object.keys(seen)) for (const key of Object.keys(st[k])) if (!seen[k].has(key)) delete st[k][key];
    st.away = false; // every change made while disconnected now has its stamp
    pending = items.length;
    return items;
  }

  // ---------- push ----------

  const chunks = items => {
    const out = []; let cur1 = [], n = 0;
    for (const it of items) {
      if (cur1.length >= CAP.push || n + it.len > CAP.bytes) { out.push(cur1); cur1 = []; n = 0; }
      cur1.push(it); n += it.len;
    }
    return cur1.length ? [...out, cur1] : out;
  };
  const wireBody = batch => ({ tasks: batch.filter(i => i.k === 't').map(i => i.wire), shifts: batch.filter(i => i.k === 'h' || i.k === 'm').map(i => i.wire),
    reports: batch.filter(i => i.k === 'r').map(i => i.wire), deleted: [], ...(batch.some(i => i.k === 'g') && { config: batch.find(i => i.k === 'g').wire }) });
  // One request; a request the hub calls malformed or too big is halved until the one bad entity is alone and can be set aside.
  async function sendBatch(batch, ep, out) {
    try {
      const rep = await call('push', wireBody(batch));
      if (ep !== epoch) throw err('aborted');
      const by = new Map([...arr(rep.tasks).map(x => ['t', x]), ...arr(rep.shifts).map(x => ['s', x]), ...arr(rep.reports).map(x => ['r', x])].map(([k, x]) => [k + ':' + obj(x).key, obj(x)]));
      const lists = { t: rep.tasks, s: rep.shifts, r: rep.reports };
      for (const it of batch) { // a kind the hub did not list at all is taken as accepted (its ok:true); one it listed without this entity stays unsynced
        const kind = it.k === 'h' || it.k === 'm' ? 's' : it.k;
        out.push([it, kind === 'g' ? { status: rep.configStatus === 'rejected' ? 'rejected' : 'ok', reason: rep.configReason, config: rep.config } : !Array.isArray(lists[kind]) ? { status: 'ok' } : by.get(kind + ':' + it.key) || null]);
      }
    } catch (e) {
      if (!['bad_request', 'too_large'].includes(e.code)) throw e;
      if (batch.length === 1) return void out.push([batch[0], { status: 'rejected' }]);
      const mid = batch.length >> 1;
      await sendBatch(batch.slice(0, mid), ep, out);
      await sendBatch(batch.slice(mid), ep, out);
    }
  }
  function ack(st, it, res) {
    const rec = ent(st[it.k], it.key);
    if (!res) return 0;
    if (res.status === 'rejected' && res.reason !== 'archived') { // reported once per version of the sheet; left alone until it changes
      let fresh = 0; // a record the PM deleted is refused too, and leaves this phone as its tombstone would (pushPhase): no notice
      for (const p in it.sent) { ent(rec, p).x = it.sent[p].h; const tk = `${it.k}:${it.key}:${p}`; if (st.told[tk] !== it.sent[p].h && res.reason !== 'deleted') { st.told[tk] = it.sent[p].h; fresh = 1; } }
      for (const k of Object.keys(st.told).slice(0, -200)) delete st.told[k];
      return fresh;
    }
    if (res.status !== 'ok' && res.reason !== 'archived') return 0; // archived: the hub already keeps it in its archive sheet, which is as good as synced
    const inc = it.k === 't' && res.task ? inT(res.task) : it.k === 'r' && res.report ? inR(res.report, it.key) : it.k === 'g' && isObj(res.config) ? inC(res.config) : null;
    for (const p in it.sent) {
      const pr = ent(rec, p), { h, at, b } = it.sent[p], [, , stamp, base] = PARTS[it.k]?.find(x => x[0] === p) || [], theirs = inc ? num(inc[stamp]) : 0;
      if (theirs > at && !b) continue; // someone's newer version won: the pull right behind this brings it (sent with a base, only what changed went in, so it is in)
      // v and vh name the hub's version: stamp and content, since two phones can tie on a stamp. A sheet, report or settings the
      // hub merged with another phone's edits are not the copy here: vh stays this copy's, so the pull right behind brings the merged one.
      Object.assign(pr, { s: h, v: theirs || at, vh: h });
      if (base) pr.b = base(it.wire);
      if (pr.p === h) { delete pr.p; delete pr.at; }
    }
    return 0;
  }
  async function pushPhase(c, ep, hold = false) {
    let st = loadState(), fresh = 0, held = false;
    const items = scan(st, c, readLocal(c)), send = [];
    for (const it of items) { // a single entity over the hub's cap can never be accepted
      if (it.k === 't' && !it.sent.assign && st.t[it.key]?.assign?.v === undefined) continue; // a sheet the hub never had goes with its office part, never as a blank one (a crew phone: a texted sheet the hub never sent stays counted as not sent)
      if (hold && it.k === 't' && st.t[it.key]?.assign?.v === undefined && it.wire.id && !it.wire.sentAt) { held = true; continue; } // a new unsent sheet waits for the pull (renumber)
      it.len = JSON.stringify(it.wire).length + 1;
      if (it.len > CAP.entity) { for (const p in it.sent) delete it.sent[p].b; for (const k of ['assignBase', 'crewBase', 'base', 'supBase', 'pmBase']) if (it.wire[k]) delete it.wire[k]; it.len = JSON.stringify(it.wire).length + 1; } // too big with its bases: the whole part goes by its stamp, as before (a supBase of null is no copy and stays)
      if (it.len > CAP.entity) fresh += ack(st, it, { status: 'rejected' }); else send.push(it);
    }
    saveState(st);
    try {
      for (const batch of chunks(send)) {
        const done = [];
        try { await sendBatch(batch, ep, done); } finally { // what the hub did accept is recorded even if a later request fails
          if (ep === epoch) { st = loadState(); for (const [it, res] of done) fresh += ack(st, it, res); saveState(st); }
          // A record the PM deleted: the hub says so here, and its tombstone may never come in a pull (this phone can be past it), so it leaves now.
          const gone = ep === epoch ? done.filter(([, res]) => res?.reason === 'deleted') : [];
          if (gone.length) try { const s2 = loadState(), lc = readLocal(c), dirty = {}, kinds = new Set(); for (const [it] of gone) dropKey(lc, s2, dirty, { t: 'task', r: 'report' }[it.k] || 'shift', it.key); flush(lc, dirty, kinds); saveState(s2); notify(kinds); } catch { /* a full phone: it stays here, refused */ }
        }
      }
    } finally { if (fresh && ep === epoch) toast(L('Items the hub did not accept: {n}. They stay on this phone.', { n: fresh }), 'bad'); }
    return held;
  }

  // ---------- merge ----------

  // A hub task into the local list. Per part: a version already held is skipped; my own unsynced edit stays if it is newer; else the hub's wins.
  // The checklist is rebuilt from the assign side's structure with the crew side's ticks, by item id.
  function mergeTask(loc, inc, rec, writes, role, ts) {
    const took = {};
    for (const [p, fn, at] of TPARTS) {
      const pr = ent(rec, p), theirs = num(inc[at]), vh = hs(fn(inc));
      if (loc && pr.v === theirs && pr.vh === vh) continue; // a version this phone already holds (its own push coming back, say)
      delete pr.x; // the hub changed since this was refused: it may take it now
      if (loc && writes.includes(p)) {
        const mine = hs(fn(loc));
        if (mine !== pr.s && mine !== vh && (pr.b || theirs <= num(pr.at))) { Object.assign(pr, { v: theirs, vh }); continue; }
      }
      took[p] = 1;
    }
    if (!Object.keys(took).length) return loc;
    const out = loc ? structuredClone(loc) : { ...inc, origin: role === 'crew' ? 'link' : 'mine', from: '', gotAt: ts, filedAt: 0, updatedAt: 0 };
    if (loc) {
      for (const k of took.assign ? A_KEYS : []) out[k] = inc[k];
      for (const k of took.crew ? C_KEYS : []) out[k] = inc[k];
      for (const [p, , at] of TPARTS) if (took[p]) out[at] = inc[at];
      for (const l of ['items', 'checks']) {
        const mark = new Map((took.crew ? inc : loc)[l].map(i => [i.id, i]));
        out[l] = (took.assign ? inc : loc)[l].map(i => ({ id: i.id, text: i.text, done: !!mark.get(i.id)?.done, at: mark.get(i.id)?.at || 0 }));
      }
    }
    for (const [p, fn, at, base] of TPARTS) if (took[p]) {
      Object.assign(ent(rec, p), { s: hs(fn(out)), v: num(inc[at]), vh: hs(fn(inc)), b: base(inc) });
      delete rec[p].p; delete rec[p].at;
    }
    if (loc && sameDoc(loc, out)) return loc;
    out.updatedAt = ts; // edited, as far as this phone is concerned: the app files a finished sheet again when it changes
    return out;
  }
  function mergeReport(loc, inc, rec, writes) {
    const took = {};
    for (const [p, fn, at] of RPARTS) {
      const pr = ent(rec, p), theirs = num(inc[at]), vh = hs(fn(inc));
      if (loc && pr.v === theirs && pr.vh === vh) continue;
      delete pr.x;
      if (loc && writes.includes(p)) {
        const mine = hs(fn(loc));
        if (mine !== pr.s && mine !== vh && (pr.b || theirs <= num(pr.at))) { Object.assign(pr, { v: theirs, vh }); continue; }
      }
      took[p] = 1;
    }
    if (!Object.keys(took).length) return loc;
    const out = loc ? structuredClone(loc) : { ...inc, filedAt: 0 };
    if (loc) {
      if (took.sup) { for (const k of Object.keys(inc)) if (!['pmReview', 'pmLang', 'pmAt', 'updatedAt', 'filedAt', 'decisions'].includes(k)) out[k] = inc[k]; out.updatedAt = inc.updatedAt; }
      const tmp = { decisions: (took.sup ? inc : loc).decisions.map(d => ({ ...d, pm: '', pmNote: '' })), pmReview: '', pmLang: '' }, from = took.pm || !writes.includes('pm') ? inc : loc; // a phone that never answers has the hub's answers
      mergeAnswers(tmp, { decisions: from.decisions.filter(d => d.pm || d.pmNote).map(d => ({ ...d })), pmReview: from.pmReview, pmLang: from.pmLang }); // an answer to a reworded question stays as its own entry
      Object.assign(out, { decisions: tmp.decisions, pmReview: tmp.pmReview, pmLang: tmp.pmLang });
      if (took.pm) out.pmAt = inc.pmAt;
    }
    for (const [p, fn, at, base] of RPARTS) if (took[p]) {
      Object.assign(ent(rec, p), { s: hs(fn(out)), v: num(inc[at]), vh: hs(fn(inc)), ...(base && { b: base(inc) }) });
      delete rec[p].p; delete rec[p].at;
      out.updatedAt = Math.max(out.updatedAt, num(inc[at]));
    }
    return loc && sameDoc(loc, out) ? loc : out;
  }
  // Keep my unsynced words where I own them. full: the PM's timesheet (my flags decide, and so does my removal or its Undo,
  // which may land while the removal's own echo is on the wire); else a worker's own clock (the hub's flags decide).
  function blend(l, i, full) {
    const flags = full ? { who: l.edited.who || i.edited.who, in: l.edited.in || i.edited.in, out: l.edited.out || i.edited.out } : i.edited;
    const r = { ...i, edited: { ...flags }, gone: full ? l.gone : i.gone, at: Math.max(l.at, i.at) };
    const [a, b] = full ? [l, i] : [i, l]; // a: wins when flagged; b: otherwise
    for (const k of ['who', 'in', 'out']) r[k] = (full ? l.edited : i.edited)[k] ? a[k] : k === 'out' ? b.out || a.out : b[k]; // a clock-out is never undone
    // who it is and what they were on (pid, crew, task links) follow the phone until the PM has touched the shift
    if (full || !(i.edited.who || i.edited.in || i.edited.out)) Object.assign(r, { pid: l.pid, crew: l.crew, crewId: l.crewId, tasks: l.tasks });
    return r;
  }
  function upsert(list, map, inc, full) {
    const i = list.findIndex(s => s.id === inc.id), loc = list[i], pr = ent(ent(map, inc.id), 'v');
    if (!full && inc.gone) { // removed by the PM: off the worker's own clock
      delete map[inc.id];
      return i >= 0 && !!list.splice(i, 1);
    }
    let next = inc;
    if (loc) {
      const mine = hs(shiftPart(loc, full));
      if (mine !== pr.s && mine !== hs(shiftPart(inc, full))) next = blend(loc, inc, full);
    }
    if (next === inc) pr.s = hs(shiftPart(inc, full));
    if (full) pr.b = structuredClone(inc); // the PM's base: with it the hub takes only what this phone changes since (two PM devices)
    if (loc && sameDoc(loc, next)) return false;
    list[i < 0 ? list.length : i] = next;
    return true;
  }

  const taskClean = (st, t, writes) => writes.every(p => { const pr = st.t[t.uid]?.[p], fn = TPARTS.find(x => x[0] === p)[1]; return pr && pr.s === hs(fn(t)) && pr.x === undefined; });
  const reportClean = (st, r, writes) => writes.every(p => { const pr = st.r[r.date]?.[p], fn = RPARTS.find(x => x[0] === p)[1]; return pr && pr.s === hs(fn(r)) && pr.x === undefined; });
  const shiftClean = (map, s, full) => { const pr = map[s.id]?.v; return pr && pr.s === hs(shiftPart(s, full)) && pr.x === undefined; };

  // Two office phones working offline can hand two sheets one number (HUB.md, Identity). A sheet the hub has never had and
  // that was never texted takes the next free number when a sheet on the hub has its day and number; two that both got out
  // keep theirs, and the screens mark them (duplicateShortIds). Shifts and links point at the uid, so nothing moves with it.
  function renumber(st, tasks, ts) {
    const out = [], onHub = t => st.t[t.uid]?.assign?.v !== undefined;
    for (const t of tasks) {
      if (!t.id || t.sentAt || onHub(t) || !tasks.some(x => x !== t && x.date === t.date && x.id === t.id && onHub(x))) continue;
      out.push({ old: t.id, id: (t.id = nextId(tasks, t.date)) });
      t.updatedAt = ts;
    }
    return out;
  }

  // A hub tombstone, or a purge from this phone: the entity leaves the phone even with an unsynced edit.
  function dropKey(lc, st, dirty, kind, key) {
    const cutOut = (list, f, map, flag) => { const keep = list.filter(x => !f(x)); delete map[key]; if (keep.length !== list.length) { list.splice(0, list.length, ...keep); dirty[flag] = true; } };
    kind = String(kind).toLowerCase().replace(/s$/, '');
    if (kind === 'task') cutOut(lc.tasks, t => t.uid === key, st.t, 'tasks');
    if (kind === 'report') cutOut(lc.reports, r => r.date === key, st.r, 'reports');
    if (kind === 'shift') { cutOut(lc.hours, s => s.id === key, st.h, 'hours'); cutOut(lc.crewH, s => s.id === key, st.m, 'crewHours'); }
  }
  // Save the stores that changed. A store that will not save (phone full) stops the merge before anything is recorded as synced.
  function flush(lc, dirty, kinds) {
    const put = (flag, key, val) => { if (dirty[flag]) { if (!store.set(key, val)) throw err('space'); kinds.add(flag); } };
    put('tasks', KEYS.tasks, lc.tasks);
    put('hours', KEYS.hours, lc.hours);
    put('crewHours', KEYS.crewHours, lc.crewH);
    put('reports', KEYS.reports, { ...lc.other, ...Object.fromEntries(lc.reports.map(r => [r.date, r])) });
  }

  // Merge a pull reply into the stores. Everything is computed first, saved to the stores, and only then recorded as synced.
  function applyPull(c, rep, sig) {
    const st = loadState(), kinds = new Set(), ts = now();
    const win = winDays(c.role), cut = cutoff(ts, win);
    let moved = [];
    const news = []; // sheets an office message or follow-up just reached (a crew phone)
    if (rep.same !== true) {
      const lc = readLocal(c), tw = c.role === 'crew' ? ['crew'] : ['assign', 'crew'], rw = c.role === 'pm' ? ['sup', 'pm'] : c.role === 'super' ? ['sup'] : [];
      scan(st, c, lc);
      const dirty = { tasks: false, hours: false, crewHours: false, reports: false };
      const at = new Map(lc.tasks.map((t, i) => [t.uid, i]));
      for (const raw of arr(rep.tasks).slice(0, 500)) {
        const inc = inT(raw);
        if (!inc.uid) continue;
        const i = at.get(inc.uid), loc = i === undefined ? null : lc.tasks[i];
        if (!loc && inc.date < cut) continue;
        const next = mergeTask(loc, inc, ent(st.t, inc.uid), tw, c.role, ts);
        if (next === loc) continue;
        // an office message or follow-up reaching a crew phone is said, and marked on the board until the sheet is opened
        if (c.role === 'crew' && ((next.reply && (next.reply !== loc?.reply || next.replyAt !== loc?.replyAt)) || (next.followUp && next.followUp !== loc?.followUp))) { next.news = true; news.push(next.id); }
        if (loc) lc.tasks[i] = next; else { at.set(inc.uid, lc.tasks.length); lc.tasks.push(next); }
        dirty.tasks = true;
      }
      // only the office writes a sheet's number; on the last page, so a sheet of this phone in a later page is not taken for new
      if (c.role !== 'crew' && rep.more !== true && (moved = renumber(st, lc.tasks, ts)).length) dirty.tasks = true;
      if (c.role !== 'crew') {
        const ri = new Map(lc.reports.map((r, i) => [r.date, i]));
        for (const raw of arr(rep.reports).slice(0, 500)) {
          const inc = inR(raw, obj(raw).date);
          if (!inc) continue;
          const i = ri.get(inc.date), loc = i === undefined ? null : lc.reports[i];
          if (!loc && inc.date < cut) continue;
          const next = mergeReport(loc, inc, ent(st.r, inc.date), rw);
          if (next === loc) continue;
          if (loc) lc.reports[i] = next; else { ri.set(inc.date, lc.reports.length); lc.reports.push(next); }
          dirty.reports = true;
        }
      }
      for (const raw of arr(rep.shifts).slice(0, 500)) {
        const inc = inS(raw);
        if (!inc) continue;
        if (c.dev && inc.device === c.dev && upsert(lc.hours, st.h, inc, false)) dirty.hours = true;
        if (c.role === 'pm' && upsert(lc.crewH, st.m, inc, true)) dirty.crewHours = true;
      }
      for (const d of arr(rep.deleted).slice(0, 500)) {
        const key = String(obj(d).key), t = obj(d).moved === true && lc.tasks.find(x => x.uid === key);
        if (t && !(st.t[key]?.assign?.v !== undefined && taskClean(st, t, tw))) continue; // moved to another crew: one only texted here, or with work not sent yet, stays
        dropKey(lc, st, dirty, obj(d).kind, key);
      }
      // the window: older sheets that the hub holds are dropped from the phone; an unsynced or refused one never is
      const prune = (list, old, clean, map, key, flag) => { const n = list.length, keep = list.filter(x => !(old(x) && clean(x))); for (const x of list) if (!keep.includes(x)) delete map[key(x)]; if (keep.length !== n) { list.splice(0, n, ...keep); dirty[flag] = true; } };
      prune(lc.tasks, t => t.date < cut, t => taskClean(st, t, tw), st.t, t => t.uid, 'tasks');
      prune(lc.reports, r => r.date < cut, r => reportClean(st, r, rw), st.r, r => r.date, 'reports');
      prune(lc.hours, s => s.date < cut, s => shiftClean(st.h, s, false), st.h, s => s.id, 'hours');
      prune(lc.crewH, s => s.date < cut, s => shiftClean(st.m, s, true), st.m, s => s.id, 'crewHours');
      // the shared settings: the hub is the project's record. First contact adopts them; an office phone's newer unsynced edit stays and is pushed.
      if (isObj(rep.config)) {
        const inc = inC(rep.config), s0 = cfg(), pr = ent(ent(st.g, 'c'), 'v'), vh = hs(cfgPart(inc)), mine = hs(cfgPart(s0));
        if (!(pr.v === inc.at && pr.vh === vh)) {
          if (c.role !== 'crew' && pr.s !== undefined && mine !== pr.s && mine !== vh && (pr.b || inc.at <= num(pr.at))) Object.assign(pr, { v: inc.at, vh });
          else {
            // only fields that arrived with the right type: a damaged setting cannot blank a good one
            const patch = pick(cfgPart(rep.config), ['project', 'site', 'super', 'pm', 'floors', 'crews', 'people', 'checks'].filter(k => Array.isArray(rep.config[k]) === Array.isArray(CFG_TPL[k]) && typeof rep.config[k] === typeof CFG_TPL[k]));
            if (PIN_FORMAT.test(inc.pin) && !PIN_FORMAT.test(s0.pin) && !PIN_FORMAT.test(store.get(KEYS.pin, ''))) patch.pin = inc.pin; // a phone keeps the first code it learns
            // a crew phone follows its crew through a rename: the crew keeps its id, the phone takes the new name
            // ponytail: the hub picks a crew's sheets by name, so sheets made before a rename keep the old name and stop
            // reaching this phone; matching the pull's crews by crewId on the hub closes that.
            const was = c.role === 'crew' && pr.s !== undefined && cfgPart(s0).crews.find(x => x.name === c.crew); // a crew list from this hub, not a new phone's defaults
            const renamed = was && arr(patch.crews).find(x => x.id === was.id);
            if (renamed?.name) patch.hubCrew = renamed.name;
            const next = cfgPart({ ...s0, ...patch });
            if (hs(next) !== mine) {
              if (!patchSettings(patch)) throw err('space');
              if (patch.pin) store.set(KEYS.pin, patch.pin);
              kinds.add('settings');
            }
            // the base holds the code this phone kept: keeping its first code is not a change, so it never writes the hub's back (DATA2-09)
            Object.assign(pr, { s: hs(next), v: inc.at, vh, b: { ...cfgPart(inc), pin: next.pin } });
            delete pr.p; delete pr.at; delete pr.x;
          }
        }
      }
      flush(lc, dirty, kinds);
      if (moved.length) toast(moved.map(m => L('Your sheet {old} is now {id}: another sheet has that number.', m)).join(' '));
      if (news.length) toast(L('Message from the office on sheet {id}', { id: news.join(', ') }));
      if (arr(rep.events).length) live.events = [...shape([EV_TPL], rep.events), ...live.events].filter((e, i, a) => a.findIndex(x => x.rev === e.rev && x.ts === e.ts) === i).sort((a, b) => b.rev - a.rev).slice(0, 50);
      if (Array.isArray(rep.onsite)) live.onsite = shape([ON_TPL], rep.onsite).slice(0, 100);
      live.at = ts;
    }
    const rev = Number.isFinite(rep.rev) ? rep.rev : st.rev;
    if (rev < st.rev) Object.assign(st, { rev: 0, sig: '' }); // the hub was rebuilt behind us: start over with a full pull
    else Object.assign(st, { rev, sig });
    st.ok = ts;
    saveState(st);
    notify(kinds);
  }
  async function pullPhase(c, ep) {
    const sig = sigOf(c);
    for (let page = 0; page < 20; page++) { // the hub sends at most 500 of a kind and says `more`; it lowers rev so the next pull starts where this one stopped
      const st = loadState();
      const req = { since: st.sig !== sig ? 0 : st.rev, days: winDays(c.role), ...(c.role === 'crew' && c.crew && { crews: [c.crew] }), ...(c.role === 'crew' && c.pid && { pid: c.pid }) };
      const rep = await call('pull', req);
      if (ep !== epoch) throw err('aborted');
      applyPull(c, rep, sig);
      if (rep.more !== true) return;
    }
  }

  // ---------- the cycle ----------

  async function whoami(c, opt) {
    const rep = await call('whoami', {}, opt);
    if (!ROLES.includes(rep.role)) throw err('bad_reply');
    info = { role: rep.role, name: str(rep.name, 60), sheetUrl: sheetUrl(rep.sheetUrl) };
    return rep;
  }
  // A phone that clocked in before it had a device secret labeled its own shifts with an older random id (settings.device).
  // They take the id the hub derives from the secret. A copy already texted to the PM stays under the old id there, and one
  // a hub took under the old id before this version refuses the relabeled copy once, with the usual notice (HUB.md tradeoff).
  function relabel(c) {
    const old = String(cfg().device || '');
    if (!c.dev || old === c.dev) return;
    const list = arr(store.get(KEYS.hours, []));
    let n = 0;
    if (old) for (const s of list) if (isObj(s) && s.device === old) { s.device = c.dev; n++; }
    if ((n && !store.set(KEYS.hours, list)) || !patchSettings({ device: c.dev })) throw err('space');
    if (n) notify(new Set(['hours']));
  }
  async function run(ep) {
    await ensure(); // the secret exists before the first request: the hub knows this phone by nothing else
    if (ep !== epoch) throw err('aborted');
    let c = hub();
    if (!c) return setStatus('off');
    relabel(c);
    if (!c.role) { const rep = await whoami(c); if (ep !== epoch) throw err('aborted'); patchSettings({ hubRole: rep.role }); c = hub(); }
    for (const [k, due] of Object.entries(loadState().del)) if (due <= now() && !mine.has(k)) { // a delete whose Undo ran out with the app closed
      const [kind, key] = k.split('|'), r = await purge(kind, key);
      if (ep !== epoch) throw err('aborted');
      if (['forbidden', 'bad_request'].includes(r.error)) purgeLater(kind, key, 0); // the hub will never take it (not the PM key any more)
    }
    // First contact (or a new role, crew or window): merge what the hub has before pushing anything, so old local copies cannot overwrite newer ones.
    const first = loadState().sig !== sigOf(c);
    if (first) await pullPhase(c, ep);
    const held = await pushPhase(c, ep, !first && c.role !== 'crew'); // else an office phone's sheet the hub has never had goes after the pull, which renumbers it if a synced sheet has its day and number
    await pullPhase(c, ep);
    if (held) { await pushPhase(c, ep); await pullPhase(c, ep); }
  }
  function cycle() {
    if (running) again = true;
    else {
      const ep = epoch;
      lastTry = now();
      running = (async () => {
        if (!hub()) return setStatus('off');
        setStatus('syncing', '', cur.at);
        let delay = TICK_MS;
        try {
          await run(ep);
          fails = 0; nextAllowed = 0; refused = false;
          setStatus('live', '', now());
        } catch (e) {
          if (e.code === 'aborted' || ep !== epoch) return void (hub() && schedule(POKE_MS)); // the settings changed under this cycle: start over with the new ones
          const code = e.code || 'server';
          if (!e.code) console.error(e); // not a hub answer: a bug worth seeing in the console (the screen only says the hub had a problem)
          fails++;
          delay = BACKOFF[Math.min(fails, BACKOFF.length) - 1] * 1000;
          if (code === 'busy') delay = Math.max(delay, 60e3);
          if (code === 'unauthorized') delay = HALT_MS; // a wrong key will not fix itself: look again in 10 minutes, not every 20 seconds
          if (code === 'unauthorized' && !refused) { refused = true; toast(e.message, 'bad'); } // a replaced key: the person is told what to do, not just a red dot
          if (code === 'forbidden') patchSettings({ hubRole: '' }); // maybe the key's role changed: ask the hub again next time
          nextAllowed = now() + delay;
          setStatus(['offline', 'busy', 'quota'].includes(code) ? 'offline' : 'error', e.code ? e.message : say('server'));
        }
        if (ep === epoch) schedule(again && delay === TICK_MS ? POKE_MS : delay); // a poke during the cycle gets its follow-up, but never inside a backoff
      })().finally(() => { running = null; again = false; });
    }
    return running.then(hubStatus);
  }
  function schedule(ms) {
    tm.clear(timer);
    timer = tm.set(() => { timer = 0; if (hidden()) return schedule(TICK_MS); cycle(); }, ms);
  }
  // Called after the app saves: one sync within 1.5 s of the first change, however long the typing goes on.
  function poke() {
    if (!hub() || pokeT) return;
    pokeT = tm.set(() => { pokeT = 0; if (now() >= nextAllowed) cycle(); }, POKE_MS); // inside a backoff the timer already knows when to retry
  }
  function wake(kind) { // visibility, focus and online events
    if (!hub()) return;
    if (kind === 'online') { fails = 0; nextAllowed = 0; return cycle(); }
    if (kind === 'hidden' || now() - lastTry > 5e3) return cycle();
  }
  function start() {
    if (!hub()) return setStatus('off');
    schedule(0);
  }

  // ---------- connecting ----------

  async function connect(url, key, extra = {}) {
    url = String(url || '').trim(); key = String(key || '').trim();
    if (!URL_OK.test(url)) return bad('bad_url');
    if (!KEY_OK.test(key)) return bad('bad_key');
    await ensure();
    const s = cfg();
    let rep;
    try { rep = await whoami(null, { cfg: { url, key, secret: device().secret, role: '' } }); } catch (e) { return e.code === 'offline' && extra.office ? bad('no_reach') : lost(e); } // a private deployment answers like no signal (OWNER3-07)
    if (s.role === 'Project manager' && rep.role !== 'pm') return bad('pm_key'); // the PM's phone on another key: its review and timesheet would never reach the hub, and the first pull would blank them (GATE2-OWNER-01)
    if (extra.office && rep.role === 'crew') return bad('crew_key'); // the office's Connect: as a crew phone none of its office work would reach the hub (OWNER3-02)
    if (extra.role && extra.role !== rep.role) return bad('mismatch');
    epoch++; fails = 0; nextAllowed = 0;
    // The same hub, also after a Disconnect: everything this phone knew of it stays (bases, stamps, where it was), so its unsynced
    // work goes up first and merges step by step, as if it had never left. A different hub: only what changed is new work there.
    // A required pull keeps unsynced parts with a base until the push: the hub merges their changed fields, rather than
    // a newer part replacing unrelated offline work. A part without a base still follows its edit stamp.
    const same = url === (s.hubUrl || loadState().url);
    if (!same) store.set(ST, keepHashes());
    patchSettings({ hubUrl: url, hubKey: key, hubRole: rep.role, hubCrew: typeof extra.crew === 'string' ? extra.crew : same ? String(s.hubCrew || '') : '' });
    setStatus('syncing');
    poke();
    return { ok: true, role: rep.role, name: info.name, sheetUrl: info.sheetUrl };
  }
  // A "join" link: only a deliberate, PM-made invite sets a phone up, and it never replaces a hub this phone already uses unless told to.
  async function joinFrom(data, opt = {}) {
    const d = obj(data), h = obj(d.hub);
    if (d.v !== 1 || d.kind !== 'join' || !['crew', 'super'].includes(d.role)) return bad('bad_join');
    const c0 = hub();
    if (c0 && !opt.replace && c0.url !== h.url) return bad('already');
    const crew = typeof d.crew === 'string' && d.role === 'crew' ? d.crew.trim().slice(0, 60) : '';
    const r = await connect(h.url, h.key, { role: d.role, crew });
    if (!r.ok) return r;
    return { ...r, crew, needsName: r.role === 'crew' && !String(cfg().worker || '').trim(), needsCrew: r.role === 'crew' && !crew };
  }
  // What the old hub had of each record (s, v, vh, the base b, an unsynced copy p and its stamp at), not where this phone was in
  // its history nor what it refused: a phone moving to another hub address does not upload the records it already synced, and
  // its first round there merges pull-first, with changes not yet sent stamped by their edit time (away). Later edits still go up.
  function keepHashes() {
    const st = loadState(), out = { t: {}, h: {}, m: {}, r: {} };
    for (const k of Object.keys(out)) for (const [key, rec] of Object.entries(st[k])) for (const [p, pr] of Object.entries(obj(rec))) if (obj(pr).s !== undefined) { const { x, tx, ...kept } = pr; ent(out[k], key)[p] = kept; }
    return Object.values(out).some(x => Object.keys(x).length) ? { ...out, away: true } : null;
  }
  function disconnect() {
    epoch++; fails = 0; again = false; pending = 0; live = { events: [], onsite: [], at: 0 };
    tm.clear(timer); tm.clear(pokeT); timer = pokeT = 0;
    const st = loadState(), url = String(cfg().hubUrl || '');
    patchSettings({ hubUrl: '', hubKey: '', hubRole: '', hubCrew: '' });
    if (url) saveState(Object.assign(st, { url, away: true })); // kept whole, for this hub (connect): "Your work stays on this phone"
    setStatus('off');
    notify(new Set(['settings']));
  }
  async function invite(role, crew = '', crews = [], people = []) {
    const c = hub();
    if (!['crew', 'super'].includes(role)) return bad('bad_join');
    if (!c || c.role !== 'pm') return bad('forbidden');
    try {
      const rep = await call('keys');
      if (!KEY_OK.test(rep[role])) return bad('bad_reply');
      const pick = role === 'crew' && !crew ? arr(crews).filter(x => typeof x === 'string' && x.trim()).slice(0, 50).map(x => x.trim().slice(0, 60)) : []; // the person picks from the job's crews
      const who = role === 'crew' ? arr(people).filter(p => isObj(p) && typeof p.name === 'string' && p.name.trim()).slice(0, 100).map(p => ({ name: p.name.trim().slice(0, 60), crew: str(p.crew, 60) })) : []; // the joining phone taps its name (joinSheet)
      const data = { v: 1, kind: 'join', hub: { url: c.url, key: rep[role] }, role, ...(role === 'crew' && crew && { crew: String(crew).slice(0, 60) }), ...(pick.length && { crews: pick }), ...(who.length && { people: who }) };
      return { ok: true, url: linkFn('tasks.html', await packFn(data)) };
    } catch (e) { return lost(e); }
  }

  // A texted copy opened on a hub phone (HUB.md, Texts on a hub phone): kind 't' or 'r', the sheet's uid or the report's day,
  // the part the text would change and the text's own time. False when this phone already holds that part as new as the
  // text (from the hub, or its own unsynced edit): the app keeps its copy. Else true: the app merges it, and the change goes
  // up stamped with the text's time, never "now", so newer work the hub has is not undone by an old text.
  // skew: the sending phone's hub offset (hubStatus().skew, carried in the text), so its clock reads as hub time.
  // ponytail: a text from a phone with no hub has no offset; its clock is taken as is, and a clock minutes off misjudges
  // only edits made within those minutes.
  // copy: the text from a hub phone becomes this phone's copy (it had none). It is a copy of the hub's (its sender sends its
  // own work up), so it is every part's base: only what is changed here after goes up, and an old text brings back nothing
  // the hub has taken out since, nor a record the PM deleted. A text from a phone with no hub has no base: all of it is new.
  // parts: the parts the copy is the base of (all when not given). A results text's crew part is its sender's own work, so it
  // goes up from here whole, by its stamp, as it did before: the office relays the results of a crew phone with no signal.
  function fromText(kind, key, part, at, skew = 0, copy = null, parts = null) {
    if (!hub()) return true;
    at = num(at) && num(at) + num(skew);
    const st = loadState(), rec = ent(st[kind], key), pr = ent(rec, part);
    if ((pr.v !== undefined || pr.at !== undefined) && num(at) <= Math.max(num(pr.v), num(pr.at))) return false;
    pr.tx = num(at);
    if (copy) for (const [p, , , base] of PARTS[kind]) if (base && (!parts || parts.includes(p)) && ent(rec, p).s === undefined) rec[p].b = base(copy);
    saveState(st);
    return true;
  }
  // A sheet's office part stamp for a day plan text this phone sends (fromText where it is opened, in hub time): the hub's
  // version when this copy is the hub's, else this phone's edit not sent yet (now, until the scan stamps it); a sheet never
  // synced here, its last edit. Never the last change of any kind: a pulled crew tick is not an office edit.
  function officeAt(t) {
    const st = loadState(), pr = st.t[t.uid]?.assign, h = hs(aPart(t));
    return Math.max(num(t.assignAt), pr?.s === undefined ? num(t.updatedAt) : pr.s === h ? num(pr.v) : pr.p === h ? num(pr.at) : skewed(st));
  }

  // ---------- thin wrappers ----------

  const act = async (action, extra) => { try { return await call(action, extra); } catch (e) { return lost(e); } };
  const records = async q => {
    q = obj(q);
    const r = await act('records', { kind: str(q.kind, 20), from: str(q.from, 10), to: str(q.to, 10), who: str(q.who, 60), q: str(q.q, 100), cursor: str(q.cursor, 200) });
    const one = { task: x => (inT(x).uid ? inT(x) : null), report: x => inR(x, obj(x).date), shift: inS, event: x => shape(EV_TPL, x) }[str(q.kind, 20).toLowerCase().replace(/s$/, '')];
    return r.ok ? { ok: true, items: one ? arr(r.items).slice(0, 200).map(one).filter(Boolean) : [], cursor: str(r.cursor, 200) } : r; // archive rows pass the same normalizers as live ones
  };
  const stats = async () => {
    const r = await act('stats');
    return r.ok ? { ok: true, ...shape({ rows: { tasks: 0, shifts: 0, reports: 0, events: 0 }, cells: 0, cellLimit: 0 }, r), sheetUrl: sheetUrl(r.sheetUrl) } : r;
  };
  const rotate = async role => {
    if (!['crew', 'super'].includes(role)) return bad('bad_join');
    const r = await act('rotate', { role });
    return r.ok ? { ok: true, key: KEY_OK.test(r.key) ? r.key : '' } : r;
  };
  const archive = async before => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return bad('bad_request');
    const r = await act('archive', { before });
    return r.ok ? { ok: true, sheetUrl: sheetUrl(r.sheetUrl), moved: Object.fromEntries(Object.entries(obj(r.moved)).slice(0, 10).map(([k, v]) => [k.slice(0, 20), num(v)])) } : r;
  };
  const selftest = async () => {
    const r = await act('selftest');
    return r.ok ? { ok: true, checks: shape([{ name: '', ok: false, detail: '' }], r.checks) } : r;
  };
  async function purge(kind, key) {
    // HUB.md lists the purge request as `kind, key`, but `key` is the request's own credential field: the sheet to delete goes as `target` (a spec deviation, as in Code.gs).
    const r = await act('purge', { kind: str(kind, 20), target: str(key, 60) });
    const c = r.ok && hub();
    if (c) { // the tombstone comes back on the next pull; the sheet leaves this phone now, before a push could bring it back
      purgeLater(kind, key, 0);
      const st = loadState(), lc = readLocal(c), dirty = {}, kinds = new Set();
      dropKey(lc, st, dirty, kind, str(key, 60));
      try { flush(lc, dirty, kinds); saveState(st); } catch { /* full phone: the pull's tombstone retries it */ }
      notify(kinds);
    }
    return r.ok ? { ok: true, rev: num(r.rev) } : r;
  }
  // A PM delete waiting out its Undo (live.mjs deleteRecord) is stored, so it still reaches the hub if the app is closed
  // first: a later start sends it once due (when the Undo runs out). This page's own Undo offer sends its own (mine).
  // due 0 takes it back (the Undo, or the purge went).
  const mine = new Set();
  function purgeLater(kind, key, due) {
    const st = loadState(), k = `${kind}|${key}`;
    if (due) { st.del[k] = num(due); mine.add(k); } else { delete st.del[k]; mine.delete(k); }
    return saveState(st);
  }

  // ---------- translation ----------

  const trKey = (from, to, text) => `${from}|${to}|${hs(text)}`;
  const hinted = new Set(), inflight = new Map();
  let trBlock = { until: 0, kind: '' };
  function hint(kind) {
    if (hinted.has(kind)) return;
    hinted.add(kind);
    toast(kind === 'quota' ? L('Translation limit reached for today. Showing the original text.') : kind === 'off' ? L('Translation needs the hub. Showing the original text.')
      : L('Translation is not available right now. Showing the original text.'));
  }
  function split(s, max) { // pieces of at most max characters, cut at a line break or space where there is one
    const parts = [], seps = [];
    while (s.length > max) {
      let i = Math.max(s.lastIndexOf('\n', max), s.lastIndexOf(' ', max)), n = max;
      if (i > max / 2) { parts.push(s.slice(0, i)); seps.push(s[i]); s = s.slice(i + 1); continue; }
      if (/[\ud800-\udbff]/.test(s[n - 1])) n--;
      parts.push(s.slice(0, n)); seps.push(''); s = s.slice(n);
    }
    parts.push(s);
    return { parts, seps };
  }
  async function translateBatch(texts, from, to) { // Map(text -> translation) for the ones that came back
    const jobs = texts.map(text => ({ text, ...split(text, 2000) })), out = new Map(), pieces = [];
    for (const j of jobs) { j.out = j.parts.map(p => (p.trim() ? null : p)); j.parts.forEach((p, i) => j.out[i] === null && pieces.push([j, i])); }
    for (let n = 0; n < pieces.length; n += 25) {
      const group = pieces.slice(n, n + 25);
      let rep;
      try { rep = await call('translate', { items: group.map(([j, i]) => j.parts[i]), from, to }); } catch (e) {
        const code = e.code || 'server';
        const d = new Date(now());
        trBlock = { until: code === 'quota' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) : now() + (code === 'offline' ? 20e3 : 60e3), kind: code }; // the hub's allowance resets at UTC midnight
        hint(code === 'quota' ? 'quota' : 'down');
        break;
      }
      const got = arr(rep.items);
      group.forEach(([j, i], k) => { if (typeof got[k] === 'string' && got[k].trim()) j.out[i] = got[k].slice(0, 6000); });
    }
    for (const j of jobs) if (j.out.every(x => x !== null)) out.set(j.text, j.out.map((x, i) => x + (j.seps[i] ?? '')).join(''));
    return out;
  }
  // Same order in, same order out; whatever could not be translated comes back as it was typed.
  async function translate(items, from, to) {
    const src = arr(items).map(x => (typeof x === 'string' ? x : '')), out = src.slice();
    if (from === to || !['en', 'es'].includes(from) || !['en', 'es'].includes(to)) return out;
    let cache = dict(store.get(TR, null));
    const need = new Map();
    src.forEach((text, i) => {
      if (!text.trim()) return;
      const hit = cache[trKey(from, to, text)];
      if (typeof hit === 'string') out[i] = hit; else need.set(text, [...(need.get(text) || []), i]);
    });
    if (!need.size) return out;
    const c = hub();
    if (!c) { hint('off'); return out; }
    if (trBlock.until > now()) { hint(trBlock.kind === 'quota' ? 'quota' : 'down'); return out; }
    const waits = [], mine = [];
    for (const text of [...need.keys()].slice(0, 100)) { // 100 new texts a call at most: the hub's daily allowance is shared by everyone
      const f = inflight.get(trKey(from, to, text));
      if (f) waits.push([text, f]); else mine.push(text);
    }
    const batch = mine.length ? translateBatch(mine, from, to) : null;
    if (batch) for (const text of mine) { const k = trKey(from, to, text); inflight.set(k, batch.then(m => m.get(text) ?? null).catch(() => null)); batch.finally(() => inflight.delete(k)).catch(() => {}); }
    const got = new Map(batch ? await batch.catch(() => []) : []);
    for (const [text, f] of waits) { const v = await f.catch(() => null); if (v !== null) got.set(text, v); }
    cache = dict(store.get(TR, null));
    for (const [text, v] of got) { cache[trKey(from, to, text)] = v; for (const i of need.get(text)) out[i] = v; }
    if (got.size) {
      for (const k of Object.keys(cache).slice(0, -TR_MAX)) delete cache[k]; // oldest out
      if (!store.set(TR, cache)) { for (const k of Object.keys(cache).slice(0, TR_MAX / 2)) delete cache[k]; store.set(TR, cache); }
    }
    return out;
  }

  return { hubStatus, poke, cycle, wake, start, joinFrom, connect, disconnect, invite, translate, records, stats, purge, purgeLater, rotate, archive, selftest, fromText, officeAt,
    liveData: () => ({ ...live, info }), onHub: (key, kind = 'task') => (kind === 'report' ? loadState().r[key]?.sup : loadState().t[key]?.assign)?.v !== undefined, // onHub: the hub has this sheet (so its number is known) or report
    replyOnHub: t => { const b = loadState().t[t?.uid]?.assign?.b; return !!b && b.reply === t.reply && b.replyAt === t.replyAt; } }; // the hub took this sheet's message as it is here (the office part as last had from the hub)
}

// Sheets that share a day and a short id with another sheet: uid -> the uids of the others. Pure, for any list of sheets.
export function duplicateShortIds(tasks) {
  const by = new Map(), out = new Map();
  for (const t of arr(tasks)) if (t?.id && t.uid) { const k = t.date + '|' + t.id, l = by.get(k) || by.set(k, []).get(k); if (!l.includes(t.uid)) l.push(t.uid); }
  for (const l of by.values()) if (l.length > 1) for (const u of l) out.set(u, l.filter(x => x !== u));
  return out;
}

// ---------- the app's instance ----------

let inst = null, off = () => {};
const get = () => (inst ||= makeSync());
export function initHub(opts = {}) { // { S, onChange, toast, onStatus }; anything else is for makeSync (tests)
  off();
  inst = makeSync(opts);
  if (typeof document !== 'undefined') {
    const vis = () => inst.wake(document.hidden ? 'hidden' : 'visible'), on = () => inst.wake('online'), focus = () => inst.wake('focus');
    document.addEventListener('visibilitychange', vis); addEventListener('online', on); addEventListener('focus', focus);
    off = () => { document.removeEventListener('visibilitychange', vis); removeEventListener('online', on); removeEventListener('focus', focus); };
  }
  inst.start();
  return inst;
}
export const hubStatus = () => get().hubStatus();
export const poke = () => get().poke();
export const cycle = () => get().cycle();
export const joinFrom = (data, opt) => get().joinFrom(data, opt);
export const connect = (url, key, extra) => get().connect(url, key, extra);
export const disconnect = () => get().disconnect();
export const invite = (role, crew, crews, people) => get().invite(role, crew, crews, people);
export const translate = (items, from, to) => get().translate(items, from, to);
export const records = q => get().records(q);
export const stats = () => get().stats();
export const purge = (kind, key) => get().purge(kind, key);
export const purgeLater = (kind, key, due) => get().purgeLater(kind, key, due);
export const rotate = role => get().rotate(role);
export const archive = before => get().archive(before);
export const selftest = () => get().selftest();
export const liveData = () => get().liveData();
export const onHub = (key, kind) => get().onHub(key, kind);
export const replyOnHub = t => get().replyOnHub(t);
export const fromText = (kind, key, part, at, skew, copy, parts) => get().fromText(kind, key, part, at, skew, copy, parts);
export const officeAt = t => get().officeAt(t);

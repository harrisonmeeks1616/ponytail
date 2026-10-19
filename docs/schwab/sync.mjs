// Hub sync engine (docs/schwab/HUB.md, "Client contract" and "Translation").
// Offline first: this phone's localStorage stays the truth. Each cycle hashes the stores, pushes the parts whose
// hash moved, pulls what the hub has and merges it by the ownership rules, then calls onChange(kinds) so the app can
// reload its in-memory copies. Nothing here touches the DOM except the browser events initHub listens to.
//
// How a conflict is decided: a task or report has two parts, each with one owning role and a stamp (assignAt and
// crewAt; updatedAt and pmAt). The newest stamp wins a part; a part this phone has not pushed yet is "mine" and is
// stamped when the scan first sees it change. Per part, schwab.hubSync keeps s (hash of the local copy the hub
// has), v and vh (stamp and content hash of the hub's version last seen), p and at (the unsynced copy and its stamp),
// x (a copy the hub refused).

import { KEYS, load, save, shape, uid, L, normTask, normShift, normReport, mergeAnswers, pack, linkTo, PIN_FORMAT } from './shared.mjs';

const ROLES = ['crew', 'super', 'pm'];
const URL_OK = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;
const KEY_OK = /^[A-Za-z0-9]{32}$/;
const ERRORS = ['bad_request', 'unauthorized', 'forbidden', 'busy', 'too_large', 'quota', 'not_ready', 'server'];
const BACKOFF = [5, 10, 20, 40, 60]; // seconds after the 1st, 2nd, ... failure in a row
const LIVE_MS = 60e3, TICK_MS = 20e3, POKE_MS = 1500, HALT_MS = 600e3;
const TIMEOUT = { translate: 20e3, archive: 120e3, selftest: 90e3, stats: 40e3 };
const ST = 'schwab.hubSync', TR = 'schwab.tr', TR_MAX = 800;
const CAP = { push: 100, bytes: 500e3, entity: 45e3 }; // the hub takes 200 entities, 1,000,000 characters and 45,000 per entity

// Fields the templates in shared.mjs may not have yet (see requiredIntegration): kept from the raw data when norm drops them.
const X_TASK = { aLang: '', assignAt: 0, crewAt: 0, reply: '', replyAt: 0, replyBy: '' };
const X_REPORT = { lang: '', pmAt: 0 };
const X_SHIFT = { crew: '', tasks: [''] };
const EV_TPL = { rev: 0, ts: 0, who: '', role: '', kind: '', text: '', ref: '' }, ON_TPL = { who: '', in: '', date: '' };
const SHEET_OK = /^https:\/\/docs\.google\.com\/spreadsheets\/[\w\-/.?=&#%]{0,250}$/; // the PM taps this link: only a Google Sheet
const sheetUrl = u => (typeof u === 'string' && SHEET_OK.test(u) ? u : '');
const CFG_TPL = { project: '', site: '', super: '', pm: '', floors: [''], crews: [{ name: '', lead: '', members: '' }], checks: [''], pin: '' };

const A_KEYS = ['id', 'date', 'by', 'floor', 'area', 'crew', 'members', 'size', 'scope', 'refs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn',
  'review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'aLang', 'sentAt'];
const C_KEYS = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'resultAt'];
const ticks = l => l.filter(i => i.done || i.at).map(i => [i.id, i.done, i.at]); // unticked steps are left out, so a new step is not an edit
const aPart = t => ({ ...pick(t, A_KEYS), items: t.items.map(i => [i.id, i.text]), checks: t.checks.map(i => [i.id, i.text]) });
const cPart = t => ({ ...pick(t, C_KEYS), items: ticks(t.items), checks: ticks(t.checks) });
const TPARTS = [['assign', aPart, 'assignAt'], ['crew', cPart, 'crewAt']];
const supPart = r => { const { pmReview, pmAt, updatedAt, filedAt, decisions, ...rest } = r; return { ...rest, decisions: decisions.map(d => [d.q, d.rec, d.by]) }; };
const pmPart = r => ({ pmReview: r.pmReview, answers: r.decisions.filter(d => d.pm || d.pmNote).map(d => [d.q, d.pm, d.pmNote]) });
const RPARTS = [['sup', supPart, 'updatedAt'], ['pm', pmPart, 'pmAt']];
const PARTS = { t: TPARTS, r: RPARTS, g: [['v', s => cfgPart(s), 'at']] };
// A worker's shift is the phone's own words (never edited or gone); a PM-ruled one is everything.
const shiftPart = (s, full) => [s.id, s.device, s.who, s.date, s.in, s.out, s.crew, s.tasks, ...(full ? [s.edited.who, s.edited.in, s.edited.out, s.gone] : [])];
const cfgPart = s => { const c = shape(CFG_TPL, s); if (!PIN_FORMAT.test(c.pin)) c.pin = ''; return c; };
const inC = raw => ({ ...cfgPart(raw), at: num(obj(raw).at) });

const str = (x, n) => String(x ?? '').slice(0, n);
const num = x => (Number.isFinite(+x) ? +x : 0);
const arr = x => (Array.isArray(x) ? x : []);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const dict = x => Object.assign(Object.create(null), obj(x)); // keys come from the hub: "__proto__" must be an ordinary key
const pick = (o, ks) => { const r = {}; for (const k of ks) r[k] = o[k]; return r; };
const withX = (n, raw, tpl) => { for (const k in tpl) if (!(k in n)) n[k] = shape(tpl[k], obj(raw)[k]); return n; };
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
  const packFn = o.pack || pack, linkFn = o.linkTo || linkTo;

  // ---------- settings, state, normalizing ----------

  const cfg = () => obj(store.get(KEYS.settings, null));
  function patchSettings(p) { // the stored settings, and the app's own object if it gave us one, so its next save keeps them
    const ok = store.set(KEYS.settings, { ...cfg(), ...p });
    if (o.S) Object.assign(o.S, p);
    return ok;
  }
  function hub() {
    const s = cfg();
    if (!URL_OK.test(s.hubUrl) || !KEY_OK.test(s.hubKey)) return null;
    const dev = String(s.device || uid()); // shifts are owned by device: the id must exist before the first request
    if (!s.device) patchSettings({ device: dev });
    return { url: s.hubUrl, key: s.hubKey, role: ROLES.includes(s.hubRole) ? s.hubRole : '', crew: String(s.hubCrew || '').slice(0, 60), dev };
  }
  function loadState() {
    const s = obj(store.get(ST, null)), st = { rev: num(s.rev), sig: String(s.sig || ''), skew: num(s.skew), ok: num(s.ok) };
    for (const k of ['t', 'h', 'm', 'r', 'g', 'told']) st[k] = dict(s[k]);
    return st;
  }
  const saveState = st => store.set(ST, st);
  const inT = raw => {
    const t = withX(norm.task(raw), raw, X_TASK);
    for (const l of ['items', 'checks']) { const seen = new Set(); t[l] = t[l].filter(i => i.id && !seen.has(i.id) && seen.add(i.id)); }
    return t;
  };
  const inS = raw => { const s = norm.shift(raw); if (!s) return null; withX(s, raw, X_SHIFT); s.crew = s.crew.trim().slice(0, 60); s.tasks = s.tasks.map(x => x.slice(0, 40)).filter(Boolean).slice(0, 20); return s; };
  const inR = (raw, key) => { const r = withX(norm.report(raw), raw, X_REPORT); return r.date && r.date === key ? r : null; };
  function readLocal(c) {
    const rawR = c.role === 'crew' ? {} : obj(store.get(KEYS.reports, {})), reports = [], other = {};
    for (const [d, r] of Object.entries(rawR)) { const n = inR(r, d); if (n) reports.push(n); else other[d] = r; }
    return {
      tasks: arr(store.get(KEYS.tasks, [])).map(inT).filter(t => t.uid),
      hours: arr(store.get(KEYS.hours, [])).map(inS).filter(Boolean),
      crewH: c.role === 'pm' ? arr(store.get(KEYS.crewHours, [])).map(inS).filter(Boolean) : [], // only the PM's phone keeps (and pushes) the timesheet
      reports, other,
    };
  }

  // ---------- status ----------

  let cur = { state: 'off', message: '', at: 0 }, pending = 0, info = {}, live = { events: [], onsite: [], at: 0 };
  let epoch = 0, running = null, again = false, timer = 0, pokeT = 0, fails = 0, nextAllowed = 0, lastTry = 0;
  const err = (code, m) => Object.assign(new Error(m || say(code)), { code });
  const bad = code => ({ ok: false, error: code, message: say(code) });
  const lost = e => ({ ok: false, error: e.code || 'server', message: e.code ? e.message : say('server') });
  function say(code) {
    return ({
      offline: L('No signal. Your work is saved on this phone and goes to the hub when you are back online.'),
      unauthorized: L('The hub did not accept this phone. Ask the PM for a new invite link.'),
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
    if (state === 'live' && now() - cur.at >= LIVE_MS) { state = 'offline'; message = say('offline'); }
    const st = loadState();
    return { state, message, at: cur.at || st.ok, pending, role: c.role, crew: c.crew, rev: st.rev };
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
      // A plain-text body keeps this a "simple" request, which Apps Script answers without a CORS preflight. The key rides in the body, never the address.
      const res = await fetchImpl(c.url, { method: 'POST', body: JSON.stringify({ ...extra, v: 1, key: c.key, action, dev: c.dev }), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        signal: ac?.signal, credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store' });
      status = res.status;
      j = await res.json().catch(() => null);
    } catch { throw err('offline'); } finally { tm.clear(timeout); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw err(status && status < 500 ? 'bad_reply' : 'server');
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
  // A part seen for the first time is stamped with its sheet's own last-edit time, never "now": a phone joining with old data cannot beat a newer hub copy.
  // Always above the last version this phone knew, so an edit cannot lose to the phone's own earlier push.
  function stampOf(st, pr, edited, seen) {
    const floor = Math.max(num(pr.v), num(seen)) + 1;
    return Math.max(floor, pr.s === undefined ? (edited > 0 ? Math.min(skewed(st), edited + st.skew) : 0) : skewed(st));
  }
  const wireTask = (t, sent) => {
    const w = { uid: t.uid, date: t.date }, A = sent.assign, C = sent.crew; // the hub validates every sheet by uid and day, so the day goes with a crew part too; the crew key ignores it
    if (A) Object.assign(w, pick(t, A_KEYS), { assignAt: A.at });
    if (C) Object.assign(w, pick(t, C_KEYS), { crewAt: C.at });
    for (const l of ['items', 'checks']) w[l] = t[l].map(i => ({ id: i.id, ...(A && { text: i.text }), ...(C && { done: i.done, at: i.at }) })); // a crew phone sends ticks, never wording
    return w;
  };
  const wireReport = (r, sent) => {
    const { filedAt, ...w } = r;
    if (sent.sup && sent.pm) return { ...w, updatedAt: sent.sup.at, pmAt: sent.pm.at };
    if (sent.sup) return { ...w, decisions: r.decisions.map(d => ({ ...d, pm: '', pmNote: '' })), pmReview: '', pmAt: 0, updatedAt: sent.sup.at };
    return { date: r.date, decisions: r.decisions.filter(d => d.q || d.pm || d.pmNote).map(d => ({ q: d.q, pm: d.pm, pmNote: d.pmNote })), pmReview: r.pmReview, pmAt: sent.pm.at, updatedAt: 0 }; // every question, so an answer the PM took back is taken back on the hub too
  };
  const wireShift = (s, full, at) => ({ id: s.id, device: s.device, who: s.who, date: s.date, in: s.in, out: s.out, crew: s.crew, tasks: s.tasks,
    edited: full ? s.edited : { who: false, in: false, out: false }, gone: full ? s.gone : false, at: full ? s.at : at });

  // Returns the pushable items; stamps new edits and forgets records of things no longer here. Pure bookkeeping: no network, no store writes.
  function scan(st, c, lc) {
    const items = [], seen = { t: new Set(), h: new Set(), m: new Set(), r: new Set() };
    const tw = c.role === 'crew' ? ['crew'] : ['assign', 'crew'], rw = c.role === 'pm' ? ['sup', 'pm'] : c.role === 'super' ? ['sup'] : [];
    const parts = (k, key, doc, defs, writes, edited, wire) => {
      const rec = ent(st[k], key), sent = {};
      seen[k].add(key);
      for (const [p, fn, at] of defs) {
        const pr = ent(rec, p), h = hs(fn(doc));
        if (!writes.includes(p)) pr.s = h; // not this role's part: whatever it holds counts as in sync
        else if (pr.s === h) { delete pr.p; delete pr.at; } else if (pr.x !== h) {
          if (pr.p !== h) Object.assign(pr, { p: h, at: stampOf(st, pr, edited, doc[at]) });
          sent[p] = { h, at: pr.at };
        }
      }
      if (Object.keys(sent).length) items.push({ k, key, sent, wire: wire(doc, sent) });
    };
    for (const t of lc.tasks) parts('t', t.uid, t, TPARTS, tw, t.updatedAt, wireTask);
    for (const r of lc.reports) parts('r', r.date, r, RPARTS, rw, r.updatedAt, wireReport);
    const shifts = (k, list, can, full) => {
      for (const s of list) {
        const pr = ent(ent(st[k], s.id), 'v'), h = hs(shiftPart(s, full));
        seen[k].add(s.id);
        if (!can(s)) pr.s = h;
        else if (pr.s === h) delete pr.p;
        else if (pr.x !== h) {
          if (pr.p !== h) Object.assign(pr, { p: h, at: Math.max(skewed(st), num(pr.at) + 1) });
          items.push({ k, key: s.id, sent: { v: { h, at: pr.at } }, wire: wireShift(s, full, pr.at) });
        }
      }
    };
    shifts('h', lc.hours, s => c.dev && s.device === c.dev, false);
    shifts('m', lc.crewH, s => !(c.dev && s.device === c.dev), true); // the PM's own clock-ins go up from their own clock, not the timesheet
    const pr = ent(ent(st.g, 'c'), 'v'), cp = cfgPart(cfg()), h = hs(cp);
    if (c.role === 'crew') pr.s = h;
    else if (pr.s === h) { delete pr.p; delete pr.at; } else if (pr.x !== h) {
      if (pr.p !== h) Object.assign(pr, { p: h, at: Math.max(skewed(st), num(pr.v) + 1, num(pr.at) + 1) }); // the hub orders two office phones' settings by this stamp
      items.push({ k: 'g', key: 'c', sent: { v: { h, at: pr.at } }, wire: { ...cp, at: pr.at } });
    }
    for (const k of Object.keys(seen)) for (const key of Object.keys(st[k])) if (!seen[k].has(key)) delete st[k][key];
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
      let fresh = 0; // a sheet the PM deleted is refused too, but the tombstone in the pull right behind removes it: no notice
      for (const p in it.sent) { ent(rec, p).x = it.sent[p].h; const tk = `${it.k}:${it.key}:${p}`; if (st.told[tk] !== it.sent[p].h && res.reason !== 'deleted') { st.told[tk] = it.sent[p].h; fresh = 1; } }
      for (const k of Object.keys(st.told).slice(0, -200)) delete st.told[k];
      return fresh;
    }
    if (res.status !== 'ok' && res.reason !== 'archived') return 0; // archived: the hub already keeps it in its archive sheet, which is as good as synced
    const inc = it.k === 't' && res.task ? inT(res.task) : it.k === 'r' && res.report ? inR(res.report, it.key) : it.k === 'g' && isObj(res.config) ? inC(res.config) : null;
    for (const p in it.sent) {
      const pr = ent(rec, p), { h, at } = it.sent[p], [, fn, stamp] = PARTS[it.k]?.find(x => x[0] === p) || [], theirs = inc ? num(inc[stamp]) : 0;
      if (theirs > at) continue; // someone's newer version won: the pull right behind this brings it
      Object.assign(pr, { s: h, v: theirs || at, vh: inc ? hs(fn(inc)) : h }); // v and vh name the hub's version: stamp and content, since two phones can tie on a stamp
      if (pr.p === h) { delete pr.p; delete pr.at; }
    }
    return 0;
  }
  async function pushPhase(c, ep) {
    let st = loadState(), fresh = 0;
    const items = scan(st, c, readLocal(c)), send = [];
    for (const it of items) { // a single entity over the hub's cap can never be accepted
      it.len = JSON.stringify(it.wire).length + 1;
      if (it.len > CAP.entity) fresh += ack(st, it, { status: 'rejected' }); else send.push(it);
    }
    saveState(st);
    try {
      for (const batch of chunks(send)) {
        const done = [];
        try { await sendBatch(batch, ep, done); } finally { // what the hub did accept is recorded even if a later request fails
          if (ep === epoch) { st = loadState(); for (const [it, res] of done) fresh += ack(st, it, res); saveState(st); }
        }
      }
    } finally { if (fresh && ep === epoch) toast(L('Items the hub did not accept: {n}. They stay on this phone.', { n: fresh }), 'bad'); }
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
        if (mine !== pr.s && mine !== vh && theirs <= num(pr.at)) { Object.assign(pr, { v: theirs, vh }); continue; }
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
    for (const [p, fn, at] of TPARTS) if (took[p]) {
      Object.assign(ent(rec, p), { s: hs(fn(out)), v: num(inc[at]), vh: hs(fn(inc)) });
      delete rec[p].p; delete rec[p].at;
      out.updatedAt = Math.max(out.updatedAt, num(inc[at]));
    }
    return loc && sameDoc(loc, out) ? loc : out;
  }
  function mergeReport(loc, inc, rec, writes) {
    const took = {};
    for (const [p, fn, at] of RPARTS) {
      const pr = ent(rec, p), theirs = num(inc[at]), vh = hs(fn(inc));
      if (loc && pr.v === theirs && pr.vh === vh) continue;
      delete pr.x;
      if (loc && writes.includes(p)) {
        const mine = hs(fn(loc));
        if (mine !== pr.s && mine !== vh && theirs <= num(pr.at)) { Object.assign(pr, { v: theirs, vh }); continue; }
      }
      took[p] = 1;
    }
    if (!Object.keys(took).length) return loc;
    const out = loc ? structuredClone(loc) : { ...inc, filedAt: 0 };
    if (loc) {
      if (took.sup) { for (const k of Object.keys(inc)) if (!['pmReview', 'pmAt', 'updatedAt', 'filedAt', 'decisions'].includes(k)) out[k] = inc[k]; out.updatedAt = inc.updatedAt; }
      const tmp = { decisions: (took.sup ? inc : loc).decisions.map(d => ({ ...d, pm: '', pmNote: '' })), pmReview: '' }, from = took.pm ? inc : loc;
      mergeAnswers(tmp, { decisions: from.decisions.filter(d => d.pm || d.pmNote).map(d => ({ ...d })), pmReview: from.pmReview }); // an answer to a reworded question stays as its own entry
      Object.assign(out, { decisions: tmp.decisions, pmReview: tmp.pmReview });
      if (took.pm) out.pmAt = inc.pmAt;
    }
    for (const [p, fn, at] of RPARTS) if (took[p]) {
      Object.assign(ent(rec, p), { s: hs(fn(out)), v: num(inc[at]), vh: hs(fn(inc)) });
      delete rec[p].p; delete rec[p].at;
      out.updatedAt = Math.max(out.updatedAt, num(inc[at]));
    }
    return loc && sameDoc(loc, out) ? loc : out;
  }
  // Keep my unsynced words where I own them. full: the PM's timesheet (my flags decide); else a worker's own clock (the hub's flags decide).
  function blend(l, i, full) {
    const flags = full ? { who: l.edited.who || i.edited.who, in: l.edited.in || i.edited.in, out: l.edited.out || i.edited.out } : i.edited;
    const r = { ...i, edited: { ...flags }, gone: l.gone || i.gone, at: Math.max(l.at, i.at) };
    const [a, b] = full ? [l, i] : [i, l]; // a: wins when flagged; b: otherwise
    for (const k of ['who', 'in', 'out']) r[k] = (full ? l.edited : i.edited)[k] ? a[k] : k === 'out' ? b.out || a.out : b[k]; // a clock-out is never undone
    if (full) Object.assign(r, { crew: l.crew, tasks: l.tasks });
    else if (!(i.edited.who || i.edited.in || i.edited.out)) Object.assign(r, { crew: l.crew, tasks: l.tasks }); // crew and tasks follow the phone until the PM has touched the shift
    return r;
  }
  function upsert(list, map, inc, full) {
    const i = list.findIndex(s => s.id === inc.id), loc = list[i], pr = ent(ent(map, inc.id), 'v');
    if (!full && inc.gone) { // a twin of a day the PM added by hand: the PM's entry stands, so it never shows on the worker's own clock
      delete map[inc.id];
      return i >= 0 && !!list.splice(i, 1);
    }
    let next = inc;
    if (loc) {
      const mine = hs(shiftPart(loc, full));
      if (mine !== pr.s && mine !== hs(shiftPart(inc, full))) next = blend(loc, inc, full);
    }
    if (next === inc) pr.s = hs(shiftPart(inc, full));
    if (loc && sameDoc(loc, next)) return false;
    list[i < 0 ? list.length : i] = next;
    return true;
  }

  const taskClean = (st, t, writes) => writes.every(p => { const pr = st.t[t.uid]?.[p], fn = TPARTS.find(x => x[0] === p)[1]; return pr && pr.s === hs(fn(t)) && pr.x === undefined; });
  const reportClean = (st, r, writes) => writes.every(p => { const pr = st.r[r.date]?.[p], fn = RPARTS.find(x => x[0] === p)[1]; return pr && pr.s === hs(fn(r)) && pr.x === undefined; });
  const shiftClean = (map, s, full) => { const pr = map[s.id]?.v; return pr && pr.s === hs(shiftPart(s, full)) && pr.x === undefined; };

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
        if (loc) lc.tasks[i] = next; else { at.set(inc.uid, lc.tasks.length); lc.tasks.push(next); }
        dirty.tasks = true;
      }
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
      for (const d of arr(rep.deleted).slice(0, 500)) dropKey(lc, st, dirty, obj(d).kind, String(obj(d).key));
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
          if (c.role !== 'crew' && pr.s !== undefined && mine !== pr.s && mine !== vh && inc.at <= num(pr.at)) Object.assign(pr, { v: inc.at, vh });
          else {
            // only fields that arrived with the right type: a damaged setting cannot blank a good one
            const patch = pick(cfgPart(rep.config), ['project', 'site', 'super', 'pm', 'floors', 'crews', 'checks'].filter(k => Array.isArray(rep.config[k]) === Array.isArray(CFG_TPL[k]) && typeof rep.config[k] === typeof CFG_TPL[k]));
            if (PIN_FORMAT.test(inc.pin) && !PIN_FORMAT.test(s0.pin) && !PIN_FORMAT.test(store.get(KEYS.pin, ''))) patch.pin = inc.pin; // a phone keeps the first code it learns
            if (hs(cfgPart({ ...s0, ...patch })) !== mine) {
              if (!patchSettings(patch)) throw err('space');
              if (patch.pin) store.set(KEYS.pin, patch.pin);
              kinds.add('settings');
            }
            Object.assign(pr, { s: hs(cfgPart({ ...s0, ...patch })), v: inc.at, vh });
            delete pr.p; delete pr.at; delete pr.x;
          }
        }
      }
      flush(lc, dirty, kinds);
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
    const sig = [c.role, c.crew, winDays(c.role)].join('|');
    for (let page = 0; page < 20; page++) { // the hub sends at most 500 of a kind and says `more`; it lowers rev so the next pull starts where this one stopped
      const st = loadState();
      const req = { since: st.sig !== sig ? 0 : st.rev, days: winDays(c.role), ...(c.role === 'crew' && c.crew && { crews: [c.crew] }) };
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
  async function run(ep) {
    let c = hub();
    if (!c) return setStatus('off');
    if (!c.role) { const rep = await whoami(c); if (ep !== epoch) throw err('aborted'); patchSettings({ hubRole: rep.role }); c = hub(); }
    // First contact (or a new role, crew or window): merge what the hub has before pushing anything, so old local copies cannot overwrite newer ones.
    if (loadState().sig !== [c.role, c.crew, winDays(c.role)].join('|')) await pullPhase(c, ep);
    await pushPhase(c, ep);
    await pullPhase(c, ep);
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
          fails = 0; nextAllowed = 0;
          setStatus('live', '', now());
        } catch (e) {
          if (e.code === 'aborted' || ep !== epoch) return;
          const code = e.code || 'server';
          fails++;
          delay = BACKOFF[Math.min(fails, BACKOFF.length) - 1] * 1000;
          if (code === 'busy') delay = Math.max(delay, 60e3);
          if (code === 'unauthorized') delay = HALT_MS; // a wrong key will not fix itself: look again in 10 minutes, not every 20 seconds
          if (code === 'forbidden') patchSettings({ hubRole: '' }); // maybe the key's role changed: ask the hub again next time
          nextAllowed = now() + delay;
          setStatus(['offline', 'busy', 'quota'].includes(code) ? 'offline' : 'error', e.code ? e.message : say('server'));
        }
        if (ep === epoch) schedule(again ? POKE_MS : delay);
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
    const s = cfg(), dev = s.device || uid();
    let rep;
    try { rep = await whoami(null, { cfg: { url, key, dev, role: '' } }); } catch (e) { return lost(e); }
    if (extra.role && extra.role !== rep.role) return bad('mismatch');
    epoch++; fails = 0; nextAllowed = 0;
    const same = s.hubUrl === url;
    if (!same) store.set(ST, null); // a different hub knows none of what this phone has synced
    patchSettings({ hubUrl: url, hubKey: key, hubRole: rep.role, hubCrew: typeof extra.crew === 'string' ? extra.crew : same ? String(s.hubCrew || '') : '', device: dev });
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
  function disconnect() {
    epoch++; fails = 0; again = false; pending = 0; live = { events: [], onsite: [], at: 0 };
    tm.clear(timer); tm.clear(pokeT); timer = pokeT = 0;
    patchSettings({ hubUrl: '', hubKey: '', hubRole: '', hubCrew: '' });
    store.set(ST, null);
    setStatus('off');
    notify(new Set(['settings']));
  }
  async function invite(role, crew = '') {
    const c = hub();
    if (!['crew', 'super'].includes(role)) return bad('bad_join');
    if (!c || c.role !== 'pm') return bad('forbidden');
    try {
      const rep = await call('keys');
      if (!KEY_OK.test(rep[role])) return bad('bad_reply');
      const data = { v: 1, kind: 'join', hub: { url: c.url, key: rep[role] }, role, ...(role === 'crew' && crew && { crew: String(crew).slice(0, 60) }) };
      return { ok: true, url: linkFn('tasks.html', await packFn(data)) };
    } catch (e) { return lost(e); }
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
      const st = loadState(), lc = readLocal(c), dirty = {}, kinds = new Set();
      dropKey(lc, st, dirty, kind, str(key, 60));
      try { flush(lc, dirty, kinds); saveState(st); } catch { /* full phone: the pull's tombstone retries it */ }
      notify(kinds);
    }
    return r.ok ? { ok: true, rev: num(r.rev) } : r;
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

  return { hubStatus, poke, cycle, wake, start, joinFrom, connect, disconnect, invite, translate, records, stats, purge, rotate, archive, selftest,
    liveData: () => ({ ...live, info }) };
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
export const connect = (url, key) => get().connect(url, key);
export const disconnect = () => get().disconnect();
export const invite = (role, crew) => get().invite(role, crew);
export const translate = (items, from, to) => get().translate(items, from, to);
export const records = q => get().records(q);
export const stats = () => get().stats();
export const purge = (kind, key) => get().purge(kind, key);
export const rotate = role => get().rotate(role);
export const archive = before => get().archive(before);
export const selftest = () => get().selftest();
export const liveData = () => get().liveData();

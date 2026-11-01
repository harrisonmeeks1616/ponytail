// Extras Log: the rules, with no DOM and no storage, so node can test them (tests/extras-log.test.js).
// An "event" is one change on a job: directed extra work, a delay, an RFI/ASI answer with cost, or other.
// What protects the money: a written notice inside the subcontract's window, and a record of the work.

export const KINDS = { directive: 'Directed extra work', delay: 'Delay or impact', rfi: 'RFI / ASI response', other: 'Other change' };
export const RELAYED = 'Our foreman (relayed)';
export const ROLES = ['GC super', 'GC PM', 'Owner rep', 'Architect / engineer', 'Inspector', RELAYED];
export const STATUS = { open: 'Open', noticed: 'Notice sent', co_submitted: 'CO submitted', approved: 'Approved', rejected: 'Rejected', void: 'Void' };
const DAY = 864e5;
const LIVE = ['open', 'noticed', 'co_submitted'];

// Status is derived from the facts recorded, never stored, so it cannot disagree with them.
export const status = ev => ev.voidedAt ? 'void' : ev.decision || (ev.coSubmittedAt ? 'co_submitted' : ev.noticeSentAt ? 'noticed' : 'open');

// Numbers are per job and never reused: events are voided, not deleted, so the max only grows.
export const nextNo = (events, job) => 1 + events.reduce((m, e) => e.job === job ? Math.max(m, e.no) : m, 0);
export const pad = n => String(n).padStart(3, '0');

// ponytail: calendar days at the same clock time, no business-day or holiday math. The window entered is the
// shortest notice period in the subcontract; add business days only if a subcontract counts them.
export function deadline(ev, job) {
  if (!job || !Number.isInteger(job.noticeDays)) return null;
  const d = new Date(ev.at);
  d.setDate(d.getDate() + job.noticeDays);
  return d;
}

// The first thing in writing: the notice, or a CO request (which is written notice too).
const firstWritten = ev => Math.min(...[ev.noticeSentAt, ev.coSubmittedAt].filter(Boolean).map(Date.parse));
// How long after the window the first written notice went out (0 if on time or no window). A late notice is
// still the item where the GC can raise a notice defense, so it stays visible.
// ponytail: for a 0-day ("before proceeding") window a notice the same day counts as on time, because the log
// cannot know when work started. Open 0-day items still turn red at once (flag() is unchanged).
export function lateBy(ev, job) {
  const d = job?.noticeDays === 0 ? new Date(new Date(ev.at).setHours(23, 59, 59, 999)) : deadline(ev, job), first = firstWritten(ev);
  return d && Number.isFinite(first) && first > d ? first - d : 0;
}

// done: notice sent or a CO went in. unset: no window entered, so no false green. rejected: needs a decision
// (dispute or let go), so it is not shown as settled.
export function flag(ev, job, now = Date.now()) {
  const s = status(ev);
  if (s === 'void' || s === 'rejected') return s;
  if (s !== 'open') return 'done';
  const d = deadline(ev, job);
  if (!d) return 'unset';
  const left = d - now;
  return left < 0 ? 'late' : left < DAY ? 'soon' : 'ok';
}

const RANK = { late: 0, soon: 1, rejected: 2, unset: 3, ok: 4, done: 5, void: 6 };
export function byUrgency(events, jobs, now = Date.now()) {
  const key = e => [RANK[flag(e, jobs[e.job], now)], deadline(e, jobs[e.job])?.getTime() ?? Infinity];
  return [...events].sort((a, b) => {
    const [ra, da] = key(a), [rb, db] = key(b);
    return ra - rb || da - db || b.at.localeCompare(a.at);
  });
}

// A signature (or a recorded refusal) fixes the description: what happened, when, who, where. Hours, material,
// equipment and photos keep accumulating (T&M grows over days); the signature stores a snapshot of exactly what
// the rep was shown, so later additions never blur what was signed. The job never changes (it owns the number).
const FACTS = ['kind', 'at', 'byRole', 'byName', 'area', 'what', 'refs'];
export function canEdit(ev, field) {
  if (status(ev) === 'void' || field === 'job' || field === 'no') return false;
  return FACTS.includes(field) ? !ev.sig : true;
}

// The words the rep signs, stored with the signature. Conservative: an acknowledgement of facts, not of cost.
export const ack = kind => kind === 'delay'
  ? 'I acknowledge that the condition described in this record occurred on the date shown.'
  : 'I acknowledge that the work described in this record was directed on the date shown. Labor and material listed are recorded to date. Cost and time to follow.';

// Correcting a signed event: the original stays (void, with its number and reason), a fresh copy gets the next
// number and links back. The notice already sent still counts, so the copy keeps it and the deadline stays met.
export function reissue(ev, events, reason, id, now = new Date().toISOString()) {
  const voided = { ...ev, voidedAt: now, voidReason: reason, updatedAt: now };
  const fresh = { ...ev, id, no: nextNo(events, ev.job), sig: null, voidedAt: null, voidReason: '', replaces: ev.id, replacesNo: ev.no, createdAt: now, updatedAt: now };
  return { voided, fresh };
}

const fmt = (opts, tz) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz });
export const when = (d, tz) => fmt({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, tz).format(new Date(d));
export const day = (d, tz) => fmt({ month: 'short', day: 'numeric', year: 'numeric' }, tz).format(new Date(d));
export const usd = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });
export function span(ms) {
  const h = Math.abs(ms) / 36e5;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
}

const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
export function recorded(ev) {
  const parts = [];
  const st = sum(ev.labor || [], 'st'), ot = sum(ev.labor || [], 'ot');
  if (st || ot) parts.push(`${st} regular and ${ot} overtime labor hours`);
  if (ev.material?.length) parts.push(`${ev.material.length} material item${ev.material.length > 1 ? 's' : ''}`);
  if (ev.equipment?.length) parts.push(`${ev.equipment.length} equipment item${ev.equipment.length > 1 ? 's' : ''}`);
  return parts.join('; ');
}

// Who is named, and how. A delay is "raised with" someone: the notice never says the GC's person caused it.
// A direction relayed by our own foreman is attributed to the GC's field staff: a written statement that our
// foreman directed the work would support a "volunteered work" defense.
export function who(ev) {
  const name = (ev.byName || '').trim();
  if (ev.byRole === RELAYED) return { label: 'Relayed by', text: `our foreman${name ? ' ' + name : ''}` };
  const text = name && ev.byRole ? `${name} (${ev.byRole})` : name || ev.byRole || '';
  return text ? { label: ev.kind === 'delay' ? 'Raised with' : 'Directed by', text } : null;
}

// The four parts every notice needs: event, cause or direction, cost and schedule impact (even "to be
// determined"), reservation of rights. Plain text so it pastes into any mail app.
export function notice(ev, job, tz) {
  const so = recorded(ev), delay = ev.kind === 'delay', w = who(ev), what = delay ? 'delay' : 'change';
  const cause = delay
    ? `2. Cause: as described in item 1.${w && ev.byRole !== RELAYED ? ` Raised with ${w.text}.` : ''}`
    : ev.byRole === RELAYED ? `2. Cause or direction: Directed by the GC's field staff, as relayed to us by ${w.text}.`
    : `2. Cause or direction: ${w ? `Directed by ${w.text}` : 'As described above'}.`;
  const subject = `Notice of ${what}: ${ev.job}, item ${pad(ev.no)}`;
  const body = [
    `This is written notice of a ${what} on ${ev.job} (our item ${pad(ev.no)}).`,
    '',
    `1. Event: ${KINDS[ev.kind]}. ${ev.what}`,
    ev.area ? `   Where: ${ev.area}` : null,
    `   When: ${when(ev.at, tz)}`,
    cause,
    ev.refs ? `   References: ${ev.refs}` : null,
    `3. Impact on cost and schedule: to be determined.${so ? ` Recorded so far: ${so}.` : ''}`,
    `4. Reservation of rights: we reserve our rights to an adjustment of the contract sum and contract time for this ${what} and its impacts, including costs not yet known.`,
    job?.clauseRef ? `Contract reference: ${job.clauseRef}` : null,
    '',
    'Please confirm receipt.',
  ].filter(l => l !== null).join('\n');
  return { subject, body };
}

// The description and quantities: what a rep is shown when signing, stored with the signature.
export function facts(ev, tz) {
  const w = who(ev);
  return [
    `${ev.job}, item ${pad(ev.no)}: ${KINDS[ev.kind]}`,
    `When: ${when(ev.at, tz)}`,
    w && `${w.label}: ${w.text}`,
    ev.area && `Where: ${ev.area}`,
    `What: ${ev.what}`,
    ev.refs && `References: ${ev.refs}`,
    ...(ev.labor || []).map(r => `Labor: ${r.who || 'unnamed'}, ${r.st || 0} regular h, ${r.ot || 0} overtime h`),
    ...(ev.material || []).map(r => `Material: ${r.qty} ${r.item}`),
    ...(ev.equipment || []).map(r => `Equipment: ${r.item}, ${r.hrs || 0} h`),
  ].filter(Boolean).join('\n');
}

// True when hours, material or equipment changed after the rep signed (or refused). The When line is left out
// of the comparison: it is formatted in the phone's time zone, which can differ from the one at signing.
export function addedSince(ev) {
  const q = s => s.split('\n').filter(l => !l.startsWith('When: ')).join('\n');
  return !!ev.sig?.shown && q(ev.sig.shown) !== q(facts(ev));
}

// The whole record as text, for sharing or printing. It can reach the GC, so it states facts only: no deadline
// analysis, no "not sent yet". Photos and the signature travel as files beside it.
export function record(ev, job, tz) {
  const s = ev.sig;
  return [
    facts(ev, tz),
    addedSince(ev) && `Added after the signature. What the rep was shown:\n${s.shown}`,
    s?.text && `Acknowledged: ${s.text}`,
    s?.refused ? `Signature: refused by the rep (${s.reason || 'no reason given'}), ${when(s.at, tz)}` : s && `Signed: ${s.name}, ${when(s.at, tz)}`,
    ev.replacesNo && `Corrects item ${pad(ev.replacesNo)}. Notice for this event went out under item ${pad(ev.replacesNo)}.`,
    ev.noticeSentAt && `Notice sent: ${when(ev.noticeSentAt, tz)}`,
    ev.coSubmittedAt && `CO ${ev.coNo || '(no number)'} submitted ${day(ev.coSubmittedAt, tz)}${ev.coAmount != null ? `, ${usd(ev.coAmount)}` : ''}`,
    ev.decision && `Decision: ${STATUS[ev.decision]} ${day(ev.decidedAt, tz)}`,
    ev.voidedAt && `Void: ${ev.voidReason}`,
  ].filter(Boolean).join('\n');
}

// One line per job for the Friday report (internal: it states where notice is late).
export function fridayLine(events, job, now = Date.now()) {
  const mine = events.filter(e => e.job === job.name && status(e) !== 'void');
  const live = mine.filter(e => LIVE.includes(status(e)));
  const noNotice = live.filter(e => flag(e, job, now) !== 'done');
  const late = noNotice.filter(e => flag(e, job, now) === 'late').length;
  const noticedLate = live.filter(e => flag(e, job, now) === 'done' && lateBy(e, job)).length;
  const notSubmitted = live.filter(e => status(e) !== 'co_submitted').length;
  const pending = live.filter(e => status(e) === 'co_submitted');
  const rejected = mine.filter(e => status(e) === 'rejected').length;
  const money = pending.reduce((s, e) => s + (e.coAmount || 0), 0);
  const window = Number.isInteger(job.noticeDays) ? `${late} past the notice window` : 'notice window not set';
  return `Extras, ${job.name}: ${live.length} open, ${noNotice.length} without written notice (${window}), ` +
    `${notSubmitted} not yet submitted as a CO, ${pending.length} CO${pending.length === 1 ? '' : 's'} awaiting a decision${money ? ` (${usd(money)})` : ''}` +
    `${noticedLate ? `, ${noticedLate} noticed after the window` : ''}${rejected ? `, ${rejected} rejected` : ''}.`;
}

// A Todoist Quick Add line, due before the window closes (12 h ahead, or halfway if less time is left), so the
// reminder arrives while there is still time. Todoist reads # as a project, @ as a label, / as a section,
// + as an assignee and ! as a reminder, so those are stripped from free text.
export function todoistLine(ev, job, now = Date.now(), tz) {
  const d = deadline(ev, job);
  const due = d && d > now ? new Date(d - Math.min(12 * 36e5, (d - now) / 2)) : null;
  const clean = s => s.replace(/[#@/+!*]/g, ' ').replace(/\s+/g, ' ').trim();
  const p = due ? Object.fromEntries(fmt({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }, tz).formatToParts(due).map(x => [x.type, x.value])) : null;
  const at = p ? `${p.month} ${p.day} at ${p.hour}:${p.minute}${p.dayPeriod.toLowerCase()}` : 'today';
  return `Send written notice: ${clean(ev.job)} extra ${pad(ev.no)} (${KINDS[ev.kind].toLowerCase()}) ${at} p1`;
}

// ---- Backup file: the only way data enters from outside, so it is checked field by field.
const str = (v, max) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v == null || str(v, max);
const iso = v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const optIso = v => v == null || iso(v);
const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9;
const optNum = v => v == null || v === '' || num(v);
const rows = (v, ok) => Array.isArray(v) && v.length <= 50 && v.every(r => r && typeof r === 'object' && ok(r));
const ID = /^[A-Za-z0-9-]{1,64}$/; // ids end up in the URL hash, so no "/" or "#"
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const photoOk = p => typeof p === 'string' && p.length <= 8e6 && PHOTO.test(p) && (p.length - p.indexOf(',') - 1) % 4 === 0;
const strokes = s => Array.isArray(s) && s.length <= 500 && s.every(l => Array.isArray(l) && l.length <= 4000 && l.every(n => typeof n === 'number' && n >= 0 && n <= 1));
const sigOk = s => s == null || (typeof s === 'object' && iso(s.at) && optStr(s.text, 500) && optStr(s.shown, 20000) &&
  (s.refused === true ? optStr(s.reason, 300) : str(s.name, 120) && strokes(s.strokes)));

export function validJob(j) {
  return !!j && str(j.name, 120) && j.name.trim() !== '' && (j.noticeDays == null || (Number.isInteger(j.noticeDays) && j.noticeDays >= 0 && j.noticeDays <= 365)) &&
    optStr(j.clauseRef, 200) && optIso(j.updatedAt);
}

export function validEvent(e) {
  return !!e && typeof e.id === 'string' && ID.test(e.id) && str(e.job, 120) && Number.isInteger(e.no) && e.no > 0 && e.no < 1e6 &&
    typeof e.kind === 'string' && Object.hasOwn(KINDS, e.kind) && iso(e.at) &&
    optStr(e.byRole, 60) && optStr(e.byName, 120) && optStr(e.area, 200) && str(e.what, 5000) && e.what.trim() !== '' && optStr(e.refs, 300) &&
    rows(e.labor, r => optStr(r.who, 120) && optNum(r.st) && optNum(r.ot)) &&
    rows(e.material, r => num(r.qty) && str(r.item, 200)) &&
    rows(e.equipment, r => str(r.item, 200) && optNum(r.hrs)) &&
    Array.isArray(e.photos) && e.photos.length <= 4 && e.photos.every(photoOk) && sigOk(e.sig) &&
    optIso(e.noticeSentAt) && optStr(e.noticeText, 10000) && optStr(e.coNo, 40) && optNum(e.coAmount) && optIso(e.coSubmittedAt) &&
    (e.decision == null || ((e.decision === 'approved' || e.decision === 'rejected') && iso(e.decidedAt) && iso(e.coSubmittedAt))) &&
    optIso(e.decidedAt) && optIso(e.voidedAt) && optStr(e.voidReason, 300) && (e.replaces == null || (typeof e.replaces === 'string' && ID.test(e.replaces))) &&
    (e.replacesNo == null || (Number.isInteger(e.replacesNo) && e.replacesNo > 0 && e.replacesNo < 1e6)) &&
    iso(e.createdAt) && iso(e.updatedAt);
}

export function cleanImport(data) {
  if (!data || data.app !== 'extras-log' || data.version !== 1 || !Array.isArray(data.jobs) || !Array.isArray(data.events)) throw new Error('This is not an Extras Log backup file.');
  const jobs = data.jobs.filter(validJob), events = data.events.filter(validEvent);
  return { jobs, events, dropped: data.jobs.length - jobs.length + data.events.length - events.length };
}

// Merge by id (events) or name (jobs); the newer updatedAt wins, so importing an old backup never undoes newer work.
// ponytail: one phone is the assumption. Logging on a fresh phone before restoring (or on two phones) can issue a
// number twice; both items are kept and clashes() names them so he can void and re-issue one. Never renumbered
// automatically: a notice may already have gone out under that number.
export function merge(local, incoming, key) {
  const out = new Map(local.map(x => [x[key], x]));
  let added = 0, updated = 0, kept = 0;
  for (const x of incoming) {
    const cur = out.get(x[key]);
    if (!cur) { out.set(x[key], x); added++; }
    else if (Date.parse(x.updatedAt || 0) > Date.parse(cur.updatedAt || 0)) { out.set(x[key], x); updated++; }
    else kept++;
  }
  return { list: [...out.values()], added, updated, kept };
}
export function clashes(local, incoming) {
  const used = new Map(local.map(e => [`${e.job}\n${e.no}`, e.id]));
  return incoming.filter(e => used.has(`${e.job}\n${e.no}`) && used.get(`${e.job}\n${e.no}`) !== e.id).map(e => `${e.job} #${pad(e.no)}`);
}

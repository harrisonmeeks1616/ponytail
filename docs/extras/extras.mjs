// Extras Log: the rules, with no DOM and no storage, so node can test them (tests/extras-log.test.js).
// An "event" is one change on a job: directed extra work, a delay, an RFI/ASI answer with cost, or other.
// What protects the money: a written notice inside the subcontract's window, and a record of the work.

export const KINDS = { directive: 'Directed extra work', delay: 'Delay or impact', rfi: 'RFI / ASI response', other: 'Other change' };
export const ROLES = ['GC super', 'GC PM', 'Owner rep', 'Architect / engineer', 'Inspector', 'Foreman (relayed)'];
export const STATUS = { open: 'Open', noticed: 'Notice sent', co_submitted: 'CO submitted', approved: 'Approved', rejected: 'Rejected', void: 'Void' };
const DAY = 864e5;
const LIVE = ['open', 'noticed', 'co_submitted'];

// Status is derived from the facts recorded, never stored, so it cannot disagree with them.
export const status = ev => ev.voidedAt ? 'void' : ev.decision || (ev.coSubmittedAt ? 'co_submitted' : ev.noticeSentAt ? 'noticed' : 'open');

// Numbers are per job and never reused: events are voided, not deleted, so the max only grows.
export const nextNo = (events, job) => 1 + events.reduce((m, e) => e.job === job ? Math.max(m, e.no) : m, 0);
export const pad = n => String(n).padStart(3, '0');

// ponytail: calendar days at the same clock time, no business-day or holiday math. Enter the window
// conservatively; add business days only if a subcontract counts them.
export function deadline(ev, job) {
  if (!job || !Number.isInteger(job.noticeDays)) return null;
  const d = new Date(ev.at);
  d.setDate(d.getDate() + job.noticeDays);
  return d;
}

// done: notice sent or a CO went in (a CO submission is written notice). unset: no window entered, so no false green.
export function flag(ev, job, now = Date.now()) {
  const s = status(ev);
  if (s === 'void') return 'void';
  if (s !== 'open') return 'done';
  const d = deadline(ev, job);
  if (!d) return 'unset';
  const left = d - now;
  return left < 0 ? 'late' : left < DAY ? 'soon' : 'ok';
}

const RANK = { late: 0, soon: 1, unset: 2, ok: 3, done: 4, void: 5 };
export function byUrgency(events, jobs, now = Date.now()) {
  const key = e => [RANK[flag(e, jobs[e.job], now)], deadline(e, jobs[e.job])?.getTime() ?? Infinity];
  return [...events].sort((a, b) => {
    const [ra, da] = key(a), [rb, db] = key(b);
    return ra - rb || da - db || b.at.localeCompare(a.at);
  });
}

// A signature (or a recorded refusal) is a record of what was shown to the rep, so it freezes what was shown.
// The job never changes (it owns the number). Notice and CO tracking stay editable until voided.
const SHOWN = ['kind', 'at', 'byRole', 'byName', 'area', 'what', 'refs', 'labor', 'material', 'equipment', 'photos'];
export function canEdit(ev, field) {
  if (status(ev) === 'void' || field === 'job' || field === 'no') return false;
  return SHOWN.includes(field) ? !ev.sig : true;
}

// Correcting a signed event: the original stays (void, with its number and reason), a fresh copy gets the next
// number and links back. The notice already sent still counts, so the copy keeps it and the deadline stays met.
export function reissue(ev, events, reason, id, now = new Date().toISOString()) {
  const voided = { ...ev, voidedAt: now, voidReason: reason, updatedAt: now };
  const fresh = { ...ev, id, no: nextNo(events, ev.job), sig: null, voidedAt: null, voidReason: '', replaces: ev.id, createdAt: now, updatedAt: now };
  return { voided, fresh };
}

const fmt = (opts, tz) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz });
export const when = (d, tz) => fmt({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, tz).format(new Date(d));
export const day = (d, tz) => fmt({ month: 'short', day: 'numeric', year: 'numeric' }, tz).format(new Date(d));
export const usd = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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

const by = ev => [ev.byName, ev.byRole && `(${ev.byRole})`].filter(Boolean).join(' ');

// The four parts every notice of change needs: event, cause or direction, cost and schedule impact
// (even "to be determined"), reservation of rights. Plain text so it pastes into any mail app.
export function notice(ev, job, tz) {
  const so = recorded(ev);
  const subject = `Notice of change: ${ev.job}, item ${pad(ev.no)}`;
  const body = [
    `This is written notice of a change on ${ev.job} (our item ${pad(ev.no)}).`,
    '',
    `1. Event: ${KINDS[ev.kind]}. ${ev.what}`,
    ev.area ? `   Where: ${ev.area}` : null,
    `   When: ${when(ev.at, tz)}`,
    `2. Cause or direction: ${by(ev) ? `${ev.kind === 'delay' ? 'Caused by' : 'Directed by'} ${by(ev)}` : 'as described above'}.`,
    `   References: ${ev.refs || 'none'}`,
    `3. Impact on cost and schedule: to be determined.${so ? ` Recorded so far: ${so}.` : ''}`,
    '4. Reservation of rights: we reserve our rights to an adjustment of the contract sum and contract time for this change and its impacts, including costs not yet known.',
    job?.clauseRef ? `Contract reference: ${job.clauseRef}` : null,
    '',
    'Please confirm receipt.',
  ].filter(l => l !== null).join('\n');
  return { subject, body };
}

// The whole record as text, for sharing or pasting. Photos and the signature travel as files beside it.
export function record(ev, job, tz) {
  const lines = [
    `${ev.job}, item ${pad(ev.no)}: ${KINDS[ev.kind]} (${STATUS[status(ev)]})`,
    `When: ${when(ev.at, tz)}`,
    by(ev) && `By: ${by(ev)}`,
    ev.area && `Where: ${ev.area}`,
    `What: ${ev.what}`,
    ev.refs && `References: ${ev.refs}`,
    ...(ev.labor || []).map(r => `Labor: ${r.who || 'unnamed'}, ${r.st || 0} regular h, ${r.ot || 0} overtime h`),
    ...(ev.material || []).map(r => `Material: ${r.qty} ${r.item}`),
    ...(ev.equipment || []).map(r => `Equipment: ${r.item}, ${r.hrs || 0} h`),
    ev.sig?.refused ? `Signature: refused by the rep (${ev.sig.reason || 'no reason given'}), ${when(ev.sig.at, tz)}` : ev.sig && `Signed: ${ev.sig.name}, ${when(ev.sig.at, tz)}`,
    ev.noticeSentAt ? `Notice sent: ${when(ev.noticeSentAt, tz)}` : `Notice: not sent${deadline(ev, job) ? `, due ${when(deadline(ev, job), tz)}` : ''}`,
    ev.coSubmittedAt && `CO ${ev.coNo || '(no number)'} submitted ${day(ev.coSubmittedAt, tz)}${ev.coAmount != null ? `, ${usd(ev.coAmount)}` : ''}`,
    ev.decision && `Decision: ${STATUS[ev.decision]} ${day(ev.decidedAt, tz)}`,
    ev.voidedAt && `Void: ${ev.voidReason}`,
  ];
  return lines.filter(Boolean).join('\n');
}

// One line per job for the Friday report.
export function fridayLine(events, job, now = Date.now()) {
  const mine = events.filter(e => e.job === job.name && status(e) !== 'void');
  const live = mine.filter(e => LIVE.includes(status(e)));
  const noNotice = live.filter(e => flag(e, job, now) !== 'done');
  const late = noNotice.filter(e => flag(e, job, now) === 'late').length;
  const notSubmitted = live.filter(e => status(e) !== 'co_submitted').length;
  const pending = live.filter(e => status(e) === 'co_submitted');
  const money = pending.reduce((s, e) => s + (e.coAmount || 0), 0);
  const window = Number.isInteger(job.noticeDays) ? `${late} past the notice window` : 'notice window not set';
  return `Extras, ${job.name}: ${live.length} open, ${noNotice.length} without written notice (${window}), ` +
    `${notSubmitted} not yet submitted as a CO, ${pending.length} CO${pending.length === 1 ? '' : 's'} awaiting a decision${money ? ` (${usd(money)})` : ''}.`;
}

// A Todoist Quick Add line. Todoist reads # as a project, @ as a label, / as a section, + as an assignee and
// ! as a reminder, so those are stripped from free text. The date is spelled the way Quick Add parses it.
export function todoistLine(ev, job, now = Date.now(), tz) {
  const d = deadline(ev, job);
  const clean = s => s.replace(/[#@/+!*]/g, ' ').replace(/\s+/g, ' ').trim();
  const p = d && d > now ? Object.fromEntries(fmt({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }, tz).formatToParts(d).map(x => [x.type, x.value])) : null;
  const due = p ? `${p.month} ${p.day} at ${p.hour}:${p.minute}${p.dayPeriod.toLowerCase()}` : 'today';
  return `Send written notice: ${clean(ev.job)} extra ${pad(ev.no)} (${KINDS[ev.kind].toLowerCase()}) ${due} p1`;
}

// ---- Backup file: the only way data enters from outside, so it is checked field by field.
const str = (v, max) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v == null || str(v, max);
const iso = v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const optIso = v => v == null || iso(v);
const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9;
const optNum = v => v == null || v === '' || num(v);
const rows = (v, ok) => Array.isArray(v) && v.length <= 50 && v.every(r => r && typeof r === 'object' && ok(r));
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const strokes = s => Array.isArray(s) && s.length <= 500 && s.every(l => Array.isArray(l) && l.length <= 4000 && l.every(n => typeof n === 'number' && n >= 0 && n <= 1));

export function validJob(j) {
  return !!j && str(j.name, 120) && j.name.trim() !== '' && (j.noticeDays == null || (Number.isInteger(j.noticeDays) && j.noticeDays >= 0 && j.noticeDays <= 365)) &&
    optStr(j.clauseRef, 200) && optIso(j.updatedAt);
}

export function validEvent(e) {
  return !!e && str(e.id, 64) && str(e.job, 120) && Number.isInteger(e.no) && e.no > 0 && e.no < 1e6 && e.kind in KINDS && iso(e.at) &&
    optStr(e.byRole, 60) && optStr(e.byName, 120) && optStr(e.area, 200) && str(e.what, 5000) && e.what.trim() !== '' && optStr(e.refs, 300) &&
    rows(e.labor ?? [], r => optStr(r.who, 120) && optNum(r.st) && optNum(r.ot)) &&
    rows(e.material ?? [], r => num(r.qty) && str(r.item, 200)) &&
    rows(e.equipment ?? [], r => str(r.item, 200) && optNum(r.hrs)) &&
    Array.isArray(e.photos ?? []) && (e.photos ?? []).length <= 4 && (e.photos ?? []).every(p => typeof p === 'string' && p.length <= 8e6 && PHOTO.test(p)) &&
    (e.sig == null || (e.sig.refused === true ? optStr(e.sig.reason, 300) && iso(e.sig.at) : str(e.sig.name, 120) && iso(e.sig.at) && strokes(e.sig.strokes))) &&
    optIso(e.noticeSentAt) && optStr(e.noticeText, 10000) && optStr(e.coNo, 40) && optNum(e.coAmount) && optIso(e.coSubmittedAt) &&
    (e.decision == null || e.decision === 'approved' || e.decision === 'rejected') && optIso(e.decidedAt) &&
    optIso(e.voidedAt) && optStr(e.voidReason, 300) && optStr(e.replaces, 64) && iso(e.createdAt) && iso(e.updatedAt);
}

export function cleanImport(data) {
  if (!data || data.app !== 'extras-log' || data.version !== 1 || !Array.isArray(data.jobs) || !Array.isArray(data.events)) throw new Error('This is not an Extras Log backup file.');
  const jobs = data.jobs.filter(validJob), events = data.events.filter(validEvent);
  return { jobs, events, dropped: data.jobs.length - jobs.length + data.events.length - events.length };
}

// Merge by id (events) or name (jobs); the newer updatedAt wins, so importing an old backup never undoes newer work.
// ponytail: one phone is the assumption. Two phones creating events offline could both issue the same number;
// both are kept and show side by side. Upgrade path: per-device number prefixes if he ever logs from two phones.
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

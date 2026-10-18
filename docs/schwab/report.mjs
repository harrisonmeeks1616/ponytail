// Daily report and time clock: the office's record of each day, one per date, kept on this phone.
// The report is the English office form for the PM. The time clock (everyone on site, superintendent
// included) is saved with that day's report, so it goes to the PM with it and prints in its PDF.
// The report sits behind the office passcode; the time clock is open to everyone, so workers can clock
// themselves in on the superintendent's phone. tasks.html routes here for #report/<day> and #clock/<day>.

import {
  KEYS, COMPANY, esc, load, save, normTask, normReport, blank, newFloor, fillFromTasks, mergeAnswers, CREW_TPL, pack, linkTo,
  niceDate, nowHM, span, fmtMin, t12, stamp, hrs, field, datalist, seg, setPath, getPath, readInput, roster,
  toast, sheet, ask, sendSheet, pasteSheet, makePdf, savePdf, fileAway, dateBar, crewVar, letterhead, L,
} from './shared.mjs';

let R = loadReports();
const open = new Set(['sum']);

function loadReports() {
  const raw = load(KEYS.reports, {});
  return Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).map(([d, r]) => [d, normReport(r)]));
}
export const reloadReports = () => { R = loadReports(); };
// Only reports someone has touched get stored; browsing an empty day leaves nothing behind.
const persist = () => save(KEYS.reports, Object.fromEntries(Object.entries(R).filter(([, r]) => r.updatedAt)))
  || toast(L("This phone wouldn't save. Open Settings and download a backup."), 'bad');
const isPM = S => S.role === 'Project manager';
const rep = (S, day) => (R[day] ||= normReport({
  date: day, floors: [],
  super: S.super || (S.role === 'Superintendent' ? S.me : ''),
  preparedBy: S.role === 'Superintendent' ? S.me : '',
}));
const go = h => (location.hash === '#' + h ? dispatchEvent(new HashChangeEvent('hashchange')) : (location.hash = h));
const $ = id => document.getElementById(id);
// The report is the office's English record, whatever language this phone shows.
const dayEn = d => niceDate(d, 'en'), stampEn = ts => stamp(ts, 'en');

const STATUS = [['On plan', 'good'], ['At risk', 'warn'], ['Behind plan', 'bad'], ['No work today', '']];
export const crewHours = c => c.laborFromTasks || c.labor ? c.labor : span(c.start, c.stop) / 60 * c.workers; // labor: summed from the task sheets by Fill
const active = r => r.floors.flatMap(f => f.crews.filter(c => !c.na));
const laborHrs = r => active(r).reduce((n, c) => n + crewHours(c), 0);
const waiting = r => r.decisions.filter(d => d.q && !d.pm);
const isLate = s => s.finish && s.deadline && s.finish > s.deadline; // datetime-local strings sort as times
const when = v => (v ? new Date(v).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function lateLine(s) {
  if (!s.finish || !s.deadline) return 'Add the expected finish and the deadline to check the forecast.';
  const h = (new Date(s.finish) - new Date(s.deadline)) / 36e5;
  const amt = Math.abs(h) >= 24 ? `${hrs(Math.abs(h) / 24)} days` : `${hrs(Math.abs(h))} hrs`;
  return h > 0 ? `⚠ Forecast finishes ${amt} after the deadline` : `On track: ${amt} of float before the deadline`;
}

// ---------- time clock ----------

// ponytail: 500 is shape()'s cap on every saved list, so a day past 500 people would be cut on reload.
// Raise both together if a site ever gets that big.
export const MIN_ON_SITE = 2, MAX_ON_SITE = 500; // at least the superintendent and one worker
export const clockRow = (name = '') => ({ name, in: '', out: '' });
const used = p => !!(p.name.trim() || p.in || p.out);
export const clockMin = p => (p.in && p.out ? span(p.in, p.out) : 0); // an out time before the in time is an overnight shift
// One box per person: new boxes go on the end, extra ones come off the end.
// lost counts removed boxes that had something in them, so the screen can ask first.
export function headcount(list, n) {
  n = Math.min(MAX_ON_SITE, Math.max(MIN_ON_SITE, Math.floor(n) || MIN_ON_SITE));
  return { list: n <= list.length ? list.slice(0, n) : [...list, ...Array.from({ length: n - list.length }, () => clockRow())], lost: list.slice(n).filter(used).length };
}
// The latest earlier day with names on its clock, for "Same people as".
const lastClock = day => Object.keys(R).filter(d => d < day && R[d].updatedAt && R[d].clock.some(p => p.name.trim())).sort().at(-1);

function personLine(p) {
  if (!p) return '';
  if (p.in && p.out) return L('{w} worked', { w: fmtMin(clockMin(p)) });
  return p.in ? L('On site since {time}', { time: t12(p.in) }) : L('Not clocked in yet');
}
function clockStats(r) {
  const inn = r.clock.filter(p => p.in), on = inn.filter(p => !p.out).length;
  return `<div class="stat"><b>${on}</b> <span>${L('On site')}</span></div>
    <div class="stat"><b>${inn.length}<small> / ${r.clock.length}</small></b> <span>${L('Clocked in')}</span></div>
    <div class="stat"><b>${hrs(r.clock.reduce((n, p) => n + clockMin(p), 0) / 60)}</b> <span>${L('Hours')}</span></div>`;
}

function clockView(S, day) {
  const r = rep(S, day);
  // Two boxes to start, the first for the superintendent. Not saved until someone types or taps.
  if (r.clock.length < MIN_ON_SITE) r.clock = headcount(r.clock.length ? r.clock : [clockRow(r.super)], MIN_ON_SITE).list;
  const names = [r.super, S.super, S.me, ...S.crews.flatMap(c => [c.lead, ...roster(S, c.name)])];
  const prev = !r.clock.some(p => p.in || p.out) && lastClock(day);
  const stampBtn = (p, i, f, label, primary) => p[f]
    ? `<input type="time" data-k="r.clock.${i}.${f}" value="${esc(p[f])}" aria-label="${esc(`${label} · ${L('Person {n}', { n: i + 1 })}`)}">`
    : `<button class="btn${primary ? ' primary' : ''}" data-act="cStamp" data-i="${i}" data-v="${f}">${esc(label)}</button>`;
  $('app').innerHTML = dateBar(day, 'clock') + `
    <section class="card"><h2>${L('Time clock')}</h2>
      <label class="field headcount"><span>${L('People on site')}</span>
        <input type="number" inputmode="numeric" min="${MIN_ON_SITE}" max="${MAX_ON_SITE}" step="1" value="${r.clock.length}" data-headcount></label>
      <p class="hint">${L('Type how many people are on site, the superintendent included (2 or more). Each person gets a box below.')}</p>
      <div class="stats three" id="clockStats">${clockStats(r)}</div>
      <div class="btns"><button class="btn" data-act="cAll" data-v="in">${L('Everyone in')}</button><button class="btn" data-act="cAll" data-v="out">${L('Everyone out')}</button></div>
      ${prev ? `<button class="link" data-act="cSame">${esc(L('Same people as {date}', { date: niceDate(prev) }))}</button>` : ''}
    </section>
    ${r.clock.map((p, i) => `<section class="card person">
      <div class="row1"><span class="label">${esc(L('Person {n}', { n: i + 1 }))}</span>
        ${r.clock.length > MIN_ON_SITE ? `<button class="link danger" data-act="cDel" data-i="${i}">${esc(L('Remove'))}</button>` : ''}</div>
      ${field(L('Name'), `r.clock.${i}.name`, p.name, { list: 'people' })}
      <div class="grid two"><div class="field"><span>${L('In')}</span>${stampBtn(p, i, 'in', L('Clock in'), true)}</div>
        <div class="field"><span>${L('Out')}</span>${stampBtn(p, i, 'out', L('Clock out'), !!p.in)}</div></div>
      <p class="out" data-out="person" data-i="${i}">${esc(personLine(p))}</p></section>`).join('')}
    ${datalist('people', names)}
    <p class="hint">${esc(L("Times are saved on this phone with the {date} daily report, which goes to the PM. Clock in on the superintendent's phone or the site tablet.", { date: niceDate(day) }))}</p>`;
  $('bar').innerHTML = `<div class="bar-in"><button class="btn primary big" data-act="cAdd">${L('+ Add a person')}</button>
    <button class="btn more" data-act="cMenu" aria-label="${L('More actions')}">⋯</button></div>`;
}

// The people-on-site box: whatever number is typed, that many boxes (2 at the least).
export async function setHeadcount(n, S, day) {
  const r = rep(S, day), next = headcount(r.clock, n);
  if (next.list.length === r.clock.length) return;
  if (+n > MAX_ON_SITE) toast(L('Up to {n} people per day', { n: MAX_ON_SITE }));
  if (next.lost && !await ask(L('Remove the last {n} people and their times?', { n: r.clock.length - next.list.length }), L('Remove'), 'danger')) return;
  r.clock = next.list;
  r.updatedAt = Date.now();
  persist();
}

export const OUT = {
  lh: (r, d) => { const c = r.floors[d.f].crews[d.c]; return `Total labor-hours: ${hrs(crewHours(c))}${c.laborFromTasks || c.labor ? ' (from the task sheets)' : c.start && c.stop ? ` (${c.workers} × ${fmtMin(span(c.start, c.stop))})` : ''}`; },
  late: (r, d) => lateLine(r.next[d.i]),
  person: (r, d) => personLine(r.clock[d.i]),
};

// ---------- daily report ----------

const sec = (id, num, title, body, badge = '') => `<details class="card sec" id="sec-${id}" data-sec="${id}"${open.has(id) ? ' open' : ''}>
  <summary><h2>${num ? `<span class="num">${num}</span>` : ''}${title}</h2>${badge}</summary><div class="sec-body">${body}</div></details>`;
const remove = (list, i, label) => `<button class="link danger" data-act="del" data-list="${list}" data-i="${i}">Remove ${label}</button>`;
const count = (n, label, tone = '') => (n ? `<span class="pill" data-tone="${tone}">${n} ${label}</span>` : '');
const clocked = r => r.clock.filter(used);
const clockLine = r => { const ps = clocked(r); return ps.length ? `Time clock: ${ps.length} ${ps.length === 1 ? 'person' : 'people'}, ${hrs(ps.reduce((n, p) => n + clockMin(p), 0) / 60)} hrs` : 'Time clock: nobody clocked in yet'; };

function reportView(S, day) {
  const r = rep(S, day), late = r.next.filter(isLate).length, pend = waiting(r).length;
  $('app').innerHTML = dateBar(day, 'report') + `<div id="summary" class="stack">${summary(r)}</div>
    <section class="card"><div class="grid">
      ${field('Superintendent', 'r.super', r.super)}${field('Shift start', 'r.shiftStart', r.shiftStart, { type: 'time' })}${field('Shift end', 'r.shiftEnd', r.shiftEnd, { type: 'time' })}
    </div><p class="hint">${r.submittedAt ? `Sent to the PM ${stampEn(r.submittedAt)}` : 'Not sent to the PM yet'}${r.pmReview ? ` · PM reviewed: ${esc(r.pmReview)}` : ''}</p>
    <p class="hint"><a href="#clock/${day}">${clockLine(r)}</a></p></section>
    ${sec('sum', 1, 'Overall status & today’s results', `${seg('r.status', r.status, STATUS)}
      ${field('Most important results today, planned work missed, and effect on the job', 'r.results', r.results, { rows: 4 })}`,
      r.status ? `<span class="pill" data-tone="${STATUS.find(s => s[0] === r.status)?.[1] || ''}">${esc(r.status)}</span>` : '')}
    ${sec('wins', 2, 'Good results & lessons to repeat', field('Crew wins, quality improvements, faster methods, repeat-floor lessons', 'r.wins', r.wins, { rows: 3 }))}
    ${sec('issues', 3, 'Site issues, concerns & coordination', field('Safety / quality issues, other trades, access, inspections, scope changes', 'r.issues', r.issues, { rows: 3 })
      + field('Who was notified / when', 'r.notified', r.notified))}
    ${sec('needs', 4, 'Material, equipment & manpower', r.needs.map((n, i) => `<div class="item"><div class="grid">
        ${field('Item / resource', `r.needs.${i}.item`, n.item, { wide: true, ph: 'e.g. 2" EMT, scissor lift, 2 more journeymen' })}
        ${field('Quantity', `r.needs.${i}.qty`, n.qty)}${field('Floor / crew', `r.needs.${i}.where`, n.where, { list: 'floors' })}
        ${field('Needed by', `r.needs.${i}.by`, n.by, { type: 'datetime-local' })}</div>
        <label class="switch"><input type="checkbox" data-k="r.needs.${i}.confirmed"${n.confirmed ? ' checked' : ''}> Availability confirmed</label>
        ${remove('needs', i, 'need')}</div>`).join('') + '<button class="btn" data-act="add" data-v="needs">+ Add a need</button>',
      count(r.needs.filter(n => n.item && !n.confirmed).length, 'unconfirmed', 'warn'))}
    ${sec('pm', 5, 'Project manager decision help', `<p class="hint">State the decision, your recommendation, and when you need an answer. The PM answers right here.</p>`
      + r.decisions.map((d, i) => `<div class="item">
        ${field('Decision / support needed', `r.decisions.${i}.q`, d.q, { rows: 2 })}
        <div class="grid">${field('Recommendation', `r.decisions.${i}.rec`, d.rec, { wide: true })}${field('Needed by', `r.decisions.${i}.by`, d.by, { type: 'datetime-local' })}</div>
        ${d.by && !d.pm && new Date(d.by) < new Date() ? '<span class="pill" data-tone="bad">Past due</span>' : ''}
        <div class="field"><span>PM response</span>${seg(`r.decisions.${i}.pm`, d.pm, [['Approved', 'good'], ['Declined', 'bad'], ['Discuss', 'info']])}</div>
        ${field('PM note', `r.decisions.${i}.pmNote`, d.pmNote)}
        ${remove('decisions', i, 'decision')}</div>`).join('') + '<button class="btn" data-act="add" data-v="decisions">+ Add a decision</button>',
      count(pend, 'waiting', 'warn'))}
    ${sec('floors', '', 'Floor reports · crew detail', r.floors.map((f, fi) => `<div class="floor">
        <div class="edit-row">${field('Actual floor / level', `r.floors.${fi}.floor`, f.floor, { list: 'floors' })}<button class="x" data-act="delFloor" data-i="${fi}" aria-label="Remove floor">✕</button></div>
        ${f.crews.map((c, ci) => crewBlock(S, r, fi, ci, c)).join('')}
        <button class="link" data-act="addCrewTo" data-i="${fi}">+ Add another crew to this floor</button></div>`).join('')
      + `${r.floors.length ? '' : '<p class="hint">Add each floor worked today, or fill them in from the crews’ task sheets on this phone.</p>'}
        <div class="btns"><button class="btn" data-act="addFloor">+ Add floor</button><button class="btn primary" data-act="fill">Fill from task sheets</button></div>
        ${datalist('floors', S.floors)}`,
      count(active(r).filter(c => !c.done).length, 'need notes', 'warn'))}
    ${sec('next', '', 'Next steps & completion forecast', r.next.map((s, i) => `<div class="item">
        ${field('Next step / floor / crew', `r.next.${i}.step`, s.step, { rows: 2 })}
        ${field('Prerequisites / resources', `r.next.${i}.prereq`, s.prereq)}
        <div class="grid">${field('Planned start', `r.next.${i}.start`, s.start, { type: 'datetime-local' })}${field('Estimated duration', `r.next.${i}.dur`, s.dur, { ph: 'e.g. 2 days' })}
        ${field('Expected finish', `r.next.${i}.finish`, s.finish, { type: 'datetime-local' })}${field('Required deadline', `r.next.${i}.deadline`, s.deadline, { type: 'datetime-local' })}
        ${field('Responsible lead', `r.next.${i}.lead`, s.lead)}${field('Confirm / check-in by', `r.next.${i}.checkin`, s.checkin, { type: 'datetime-local' })}</div>
        <p class="out ${isLate(s) ? 'late' : ''}" data-out="late" data-i="${i}">${lateLine(s)}</p>
        ${remove('next', i, 'step')}</div>`).join('') + '<button class="btn" data-act="add" data-v="next">+ Add next step</button>',
      count(late, 'late', 'bad'))}
    ${sec('risks', '', 'Potential delays & workarounds', r.risks.map((x, i) => `<div class="item">
        ${field('Risk / affected floor & crew', `r.risks.${i}.risk`, x.risk, { rows: 2 })}
        ${field('Expected impact / time at risk', `r.risks.${i}.impact`, x.impact)}
        ${field('Prevention / workaround', `r.risks.${i}.prevent`, x.prevent, { rows: 2 })}
        ${field('Fallback work if blocked', `r.risks.${i}.fallback`, x.fallback)}
        <div class="grid">${field('Action owner', `r.risks.${i}.owner`, x.owner)}${field('Action needed by', `r.risks.${i}.by`, x.by, { type: 'datetime-local' })}</div>
        ${remove('risks', i, 'risk')}</div>`).join('') + '<button class="btn" data-act="add" data-v="risks">+ Add a risk</button>'
      + '<p class="hint">Escalate urgent issues when you find them, and note who you told in section 3.</p>')}
    ${sec('sign', '', 'Sign-off', `<div class="grid">${field('Prepared by', 'r.preparedBy', r.preparedBy)}${field('PM review / time', 'r.pmReview', r.pmReview)}</div>
      ${isPM(S) ? '<button class="btn" data-act="stampPM">Stamp my review now</button>' : ''}`)}
    <p class="hint">Changes save on this phone as you type.${S.folderUrl ? ' Sending the report also files a PDF in the review folder.' : ''}</p>`;
  $('bar').innerHTML = `<div class="bar-in"><button class="btn primary big" data-act="send">${isPM(S) ? 'Send back to superintendent' : 'Send to PM'}</button>
    <button class="btn more" data-act="menu" aria-label="More actions">⋯</button></div>`;
}

// Totals and section check marks, redrawn as the superintendent types.
function summary(r) {
  const late = r.next.filter(isLate).length, pend = waiting(r).length;
  const ready = [
    ['sum', 'Summary', r.status && (r.results || r.status === 'No work today')],
    ['floors', 'Floors', active(r).length && active(r).every(c => c.done)],
    ['next', 'Next steps', r.next.some(s => s.step)],
    ['risks', 'Risks', r.risks.some(x => x.risk)],
    ['sign', 'Sign-off', r.preparedBy],
  ];
  return `<div class="stats">
      <div class="stat"><b>${hrs(laborHrs(r))}</b><span>Labor-hrs</span></div>
      <div class="stat"><b>${active(r).length}</b><span>Crew sections</span></div>
      <div class="stat"><b class="${pend ? 'warn' : ''}">${pend}</b><span>Decisions waiting</span></div>
      <div class="stat"><b class="${late ? 'bad' : ''}">${late}</b><span>Late forecasts</span></div>
    </div>
    <div class="chips" role="group" aria-label="Jump to section">${ready.map(([id, label, ok]) => `<button class="chip${ok ? ' ok' : ''}" data-act="jump" data-v="${id}">${ok ? '✓ ' : ''}${label}</button>`).join('')}</div>`;
}

function crewBlock(S, r, fi, ci, c) {
  const k = `r.floors.${fi}.crews.${ci}`;
  return `<div class="crew-edit" style="${crewVar(S, c.name)}">
    <div class="row1"><strong>${esc(c.name)}</strong>
      <button class="chip" data-act="na" data-f="${fi}" data-c="${ci}" aria-pressed="${!c.na}">${c.na ? 'N/A, tap to add' : 'Worked here'}</button></div>
    ${c.na ? '' : `<div class="grid">
      ${field('Crew / lead', `${k}.lead`, c.lead)}${field('Worker count', `${k}.workers`, c.workers, { type: 'number', mode: 'numeric' })}
      ${field('Members', `${k}.members`, c.members, { wide: true })}
      ${field('Room / area', `${k}.area`, c.area)}${field('Task / drawing ref.', `${k}.ref`, c.ref)}
      ${field('Work start', `${k}.start`, c.start, { type: 'time' })}${field('Work stop', `${k}.stop`, c.stop, { type: 'time' })}</div>
      <p class="out" data-out="lh" data-f="${fi}" data-c="${ci}">${OUT.lh(r, { f: fi, c: ci })}</p>
      ${field('Work completed: installation, quantities, exact locations, remaining work', `${k}.done`, c.done, { rows: 3 })}
      ${field('Quality / testing / accuracy', `${k}.quality`, c.quality, { rows: 2 })}
      ${field('Hold-ups / delays: cause, duration, workers affected, action taken', `${k}.holdups`, c.holdups, { rows: 2 })}
      ${field('Good results / improvements', `${k}.good`, c.good, { rows: 2 })}`}</div>`;
}

// ---------- PDF and the review folder ----------

const clockRows = r => clocked(r).map(p => [p.name || `Person ${r.clock.indexOf(p) + 1}`,
  [p.in && `in ${t12(p.in)}`, p.out && `out ${t12(p.out)}`, clockMin(p) && `${fmtMin(clockMin(p))} on site`].filter(Boolean).join(' · ') || 'no times']);
const clockTotal = r => hrs(r.clock.reduce((n, p) => n + clockMin(p), 0) / 60);

const recordSecs = r => [
  ['Daily summary & PM actions', [['Report date', dayEn(r.date)], ['Superintendent', r.super],
    ['Shift / work hours', r.shiftStart && `${t12(r.shiftStart)} to ${t12(r.shiftEnd)}`], ['Submitted at', stampEn(r.submittedAt)], ['Labor-hours', hrs(laborHrs(r))],
    ['People on site', clocked(r).length], ['Clocked hours', clocked(r).length && clockTotal(r)]]],
  ['Time clock', clockRows(r)],
  ['1 Overall status & today’s results', [['Status', r.status], ['Results', r.results]]],
  ['2 Good results & lessons to repeat', [['Notes', r.wins]]],
  ['3 Site issues, concerns & coordination', [['Issues', r.issues], ['Who was notified / when', r.notified]]],
  ['4 Material, equipment & manpower needs', r.needs.map((n, i) => [`Need ${i + 1}`,
    [n.item, n.qty && `qty ${n.qty}`, n.where, n.confirmed ? 'availability confirmed' : 'not confirmed', n.by && `needed by ${when(n.by)}`].filter(Boolean).join(' · ')])],
  ['5 Project manager decision help', r.decisions.flatMap((d, i) => [[`Decision ${i + 1}`, d.q], ['Recommendation', d.rec], ['Needed by', when(d.by)], ['PM response', [d.pm, d.pmNote].filter(Boolean).join(' · ')]])],
  ...r.floors.map(f => [`Floor report · ${f.floor}`, f.crews.flatMap(c => (c.na ? [[c.name, 'N/A']] : [
    [c.name, [c.lead && `lead ${c.lead}`, c.workers && `${c.workers} workers`, c.members].filter(Boolean).join(' · ')],
    ['Room / area', c.area], ['Task / drawing ref.', c.ref], ['Work hours', c.start && `${t12(c.start)} to ${t12(c.stop)}`], ['Total labor-hours', hrs(crewHours(c))],
    ['Work completed', c.done], ['Quality / testing', c.quality], ['Hold-ups / delays', c.holdups], ['Good results', c.good]]))]),
  ['Next work & completion forecast', r.next.flatMap((s, i) => [[`Next step ${i + 1}`, s.step], ['Prerequisites', s.prereq], ['Planned start', when(s.start)],
    ['Estimated duration', s.dur], ['Expected finish', when(s.finish)], ['Required deadline', when(s.deadline)], ['Forecast', s.finish && s.deadline && lateLine(s)],
    ['Responsible lead', s.lead], ['Confirm / check-in by', when(s.checkin)]])],
  ['Potential delays & workarounds', r.risks.flatMap((x, i) => [[`Risk ${i + 1}`, x.risk], ['Impact / time at risk', x.impact], ['Prevention / workaround', x.prevent],
    ['Fallback work', x.fallback], ['Action owner', x.owner], ['Needed by', when(x.by)]])],
  ['Sign-off', [['Prepared by', r.preparedBy], ['PM review / time', r.pmReview]]],
];

const record = (S, r) => makePdf('Superintendent daily report', letterhead(S, dayEn(r.date)), recordSecs(r), `${COMPANY} · ${S.project} · Daily report ${r.date}`);
const clockPdf = (S, r) => makePdf('Time clock', letterhead(S, dayEn(r.date)),
  [[`Clock in / out · ${dayEn(r.date)}`, [...clockRows(r), ['Total', `${clocked(r).length} people · ${clockTotal(r)} hrs`]]]], `${COMPANY} · ${S.project} · Time clock ${r.date}`);
const fileReport = (S, r) => { if (!S.folderUrl) return; r.filedAt = Date.now(); persist(); return fileAway(S, { date: r.date, name: `Daily Report ${r.date}`, bytes: record(S, r), v: r.updatedAt }); };
// A sent report edited afterwards (a clock-out after sending, say) is filed again when you leave it.
export const fileReportIfChanged = (S, day) => { const r = R[day]; return r?.submittedAt && r.updatedAt > r.filedAt && fileReport(S, r); };

// ---------- report links ----------

// A report link opened on this phone. Returns the report's day, or '' if the link had none.
export async function openReport(data, S) {
  const inc = normReport(data.report);
  if (!inc.date) { toast('That link has no report in it', 'bad'); return ''; }
  const mine = R[inc.date], pmSent = data.from === 'Project manager';
  if (mine?.updatedAt && mine.updatedAt !== inc.updatedAt && pmSent !== isPM(S)) {
    // Normal back-and-forth: neither side's work is lost, so there's nothing to ask.
    R[inc.date] = pmSent ? mergeAnswers(mine, inc) : mergeAnswers(inc, mine);
    R[inc.date].updatedAt = Date.now();
    toast(pmSent ? 'PM answers added to your report' : 'Updated report loaded. Your answers are kept.');
    open.add('pm');
    fileReport(S, R[inc.date]);
  } else if (!mine?.updatedAt || mine.updatedAt === inc.updatedAt
    || await ask(`Replace your copy of the ${dayEn(inc.date)} report with the one in this link? Link copy saved ${stampEn(inc.updatedAt)}. Yours saved ${stampEn(mine.updatedAt)}.`, 'Use the link copy')) {
    R[inc.date] = inc;
    inc.updatedAt ||= Date.now();
    toast('Report loaded');
    if (isPM(S)) open.add('pm');
    fileReport(S, inc);
  }
  persist();
  return inc.date;
}

async function send(S, day) {
  const r = rep(S, day);
  if (!r.status) { open.add('sum'); reportView(S, day); return toast('Set the overall status first', 'bad'); }
  if (!isPM(S)) r.submittedAt = Date.now();
  r.updatedAt = Date.now();
  persist();
  reportView(S, day);
  const url = linkTo('tasks.html', await pack({ v: 1, kind: 'report', from: S.role, pin: S.pin, report: r }));
  const answered = r.decisions.filter(d => d.q && d.pm).length, asked = r.decisions.filter(d => d.q).length;
  const firstDue = waiting(r).map(d => d.by).filter(Boolean).sort()[0];
  sendSheet(isPM(S)
    ? { title: `PM review · ${dayEn(r.date)}`, url, text: `PM review of the ${dayEn(r.date)} daily report: ${answered} of ${asked} decisions answered.` }
    : { title: `Daily report · ${dayEn(r.date)}`, url,
      text: `${COMPANY} daily report ${dayEn(r.date)}, ${S.project}: ${r.status}. ${active(r).length} crew sections, ${hrs(laborHrs(r))} labor-hrs, ${clocked(r).length} people on the time clock.`
        + (asked - answered ? ` ${asked - answered} decision${asked - answered === 1 ? ' needs' : 's need'} you${firstDue ? ' by ' + when(firstDue) : ''}.` : '') });
  fileReport(S, r);
}

// ---------- screens, actions and typing (the app shell hands these over) ----------

export const renderOffice = (v, S, day) => (v === 'clock' ? clockView : reportView)(S, day);

const menu = items => sheet(`<h3>${L('More')}</h3><div class="menu">${items.filter(Boolean).map(([a, label, cls]) => `<button class="btn ${cls || ''}" data-act="${a}">${esc(label)}</button>`).join('')}</div>`);

export async function reportAct(a, el, S, day, v) {
  const r = rep(S, day), val = el.dataset.v, i = +el.dataset.i;
  switch (a) {
    case 'set': { const ctx = { r, s: S }; setPath(ctx, el.dataset.k, getPath(ctx, el.dataset.k) === val ? '' : val); break; }
    case 'jump': open.add(val); reportView(S, day); return $('sec-' + val).scrollIntoView({ behavior: 'smooth', block: 'start' });
    case 'add': r[val].push(blank(val)); open.add({ needs: 'needs', decisions: 'pm', next: 'next', risks: 'risks' }[val]); break;
    case 'del': if (!await ask('Remove this entry?', 'Remove', 'danger')) return; r[el.dataset.list].splice(i, 1); break;
    case 'addFloor': r.floors.push(newFloor('', S.crews.map(c => c.name))); open.add('floors'); break;
    case 'delFloor': if (!await ask(`Remove ${r.floors[i].floor || 'this floor'} and its crew notes?`, 'Remove', 'danger')) return; r.floors.splice(i, 1); break;
    case 'addCrewTo': r.floors[i].crews.push({ ...CREW_TPL, na: false, name: `Crew ${String.fromCharCode(65 + r.floors[i].crews.length)}` }); break;
    case 'na': { const c = r.floors[+el.dataset.f].crews[+el.dataset.c]; c.na = !c.na; break; }
    case 'fill': {
      const ts = load(KEYS.tasks, []).map(normTask).filter(t => t.date === day);
      if (!ts.length) return toast(`No task sheets for ${dayEn(day)} on this phone. Make or load them on the Tasks tab first.`, 'bad');
      const n = fillFromTasks(r, ts, S.crews.map(c => c.name));
      open.add('floors');
      toast(`Filled ${n} crew section${n === 1 ? '' : 's'} from ${ts.length} task sheet${ts.length === 1 ? '' : 's'}. Typed notes kept; work hours updated.`);
      break;
    }
    case 'carry': {
      const prev = Object.keys(R).filter(d => d < day && R[d].updatedAt).sort().at(-1);
      if (!prev) return toast('No earlier report on this phone to copy from');
      const p = R[prev], copy = x => structuredClone(x);
      Object.assign(r, { super: r.super || p.super, shiftStart: r.shiftStart || p.shiftStart, shiftEnd: r.shiftEnd || p.shiftEnd });
      if (!r.floors.length) r.floors = p.floors.map(f => ({ floor: f.floor, crews: f.crews.map(c => ({ ...CREW_TPL, name: c.name, na: c.na, lead: c.lead, workers: c.workers, members: c.members })) }));
      r.needs.push(...p.needs.filter(n => !n.confirmed && !r.needs.some(x => x.item === n.item)).map(copy));
      r.next.push(...p.next.filter(s => !r.next.some(x => x.step === s.step)).map(copy));
      r.risks.push(...p.risks.filter(x => !r.risks.some(y => y.risk === x.risk)).map(copy));
      toast(`Copied crews, open needs, next steps and risks from ${dayEn(prev)}`);
      break;
    }
    case 'stampPM': r.pmReview = `${S.me || 'PM'} · ${stampEn(Date.now())}`; break;
    case 'send': return send(S, day);
    case 'menu':
      return menu([['fill', 'Fill floors from task sheets'], ['carry', 'Copy crews, needs and risks from last report'], ['paste', 'Open a link someone sent you'],
        ['pdf', 'Save as PDF'], S.folderUrl && ['fileNow', 'Save to the review folder now'], ['settings', 'Settings, crews and backup'], ['clear', 'Clear this report', 'danger']]);
    case 'pdf': return savePdf(`Daily Report ${r.date}.pdf`, record(S, r));
    case 'fileNow': return fileReport(S, r);
    case 'paste': return pasteSheet(code => go('p=' + code));
    case 'settings': return go('settings');
    case 'clear':
      if (!await ask(`Clear everything in the ${dayEn(day)} report, time clock included?`, 'Clear', 'danger')) return;
      delete R[day];
      persist();
      return renderOffice(v, S, day);

    // time clock
    case 'cStamp': {
      const p = r.clock[i];
      if (val === 'out' && !p.in) return toast(L('Clock in first'));
      p[val] = nowHM();
      navigator.vibrate?.(12);
      break;
    }
    case 'cAll': {
      const named = r.clock.filter(p => p.name.trim());
      const who = val === 'in' ? named.filter(p => !p.in) : r.clock.filter(p => p.in && !p.out);
      if (!who.length) return toast(val === 'out' ? L('Nobody on site to clock out') : named.length ? L('Everyone named is already clocked in') : L('Type the names first'));
      const now = nowHM();
      for (const p of who) p[val] = now;
      toast(val === 'in' ? L('Clocked in: {n}', { n: who.length }) : L('Clocked out: {n}', { n: who.length }));
      break;
    }
    case 'cAdd': r.clock.push(clockRow()); break;
    case 'cDel': {
      const p = r.clock[i];
      if (r.clock.length <= MIN_ON_SITE) return;
      if (used(p) && !await ask(L('Remove {name} and their times?', { name: p.name.trim() || L('Person {n}', { n: i + 1 }) }), L('Remove'), 'danger')) return;
      r.clock.splice(i, 1);
      break;
    }
    case 'cSame': {
      const prev = lastClock(day);
      if (!prev) return;
      r.clock = headcount(R[prev].clock.filter(p => p.name.trim()).map(p => clockRow(p.name)), Math.max(MIN_ON_SITE, R[prev].clock.filter(p => p.name.trim()).length)).list;
      toast(L('Same people as {date}', { date: niceDate(prev) }));
      break;
    }
    case 'cMenu': {
      const prev = !r.clock.some(p => p.in || p.out) && lastClock(day);
      return menu([prev && ['cSame', L('Same people as {date}', { date: niceDate(prev) })], ['cPdf', L('Save the time clock as PDF')],
        ['paste', L('Open a link someone sent you')], ['settings', L('Settings, crews and backup')]]);
    }
    case 'cPdf': return savePdf(`Time clock ${r.date}.pdf`, clockPdf(S, r));
    default: return;
  }
  r.updatedAt = Date.now();
  persist();
  renderOffice(v, S, day);
  if (a === 'cAdd') [...$('app').querySelectorAll('.person input')].at(-1)?.focus(); // ready for the new name
}

// Typing in a report or time clock field: data-k="r.path.to.field".
export function applyInput(r, k, val) {
  setPath({ r }, k, val);
  if (/^r\.floors\.\d+\.crews\.\d+\.(start|stop|workers)$/.test(k)) { // typed hours take over from the sheets
    const c = getPath({ r }, k.replace(/\.\w+$/, ''));
    c.labor = 0; c.laborFromTasks = false;
  }
}
export function reportInput(el, S, day) {
  const r = rep(S, day);
  applyInput(r, el.dataset.k, readInput(el));
  r.updatedAt = Date.now();
  persist();
  for (const o of $('app').querySelectorAll('[data-out]')) if (OUT[o.dataset.out]) o.textContent = OUT[o.dataset.out](r, o.dataset);
  if ($('summary')) $('summary').innerHTML = summary(r);
  if ($('clockStats')) $('clockStats').innerHTML = clockStats(r);
}

// Remember which report sections are open across re-renders.
export const sectionToggle = e => { const id = e.target.dataset?.sec; if (id) e.target.open ? open.add(id) : open.delete(id); };

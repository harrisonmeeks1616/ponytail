// Daily report and time clock. The report is the office's record of each day, one per date, kept on
// this phone for the superintendent and the PM, behind the office passcode. The time clock is open to
// everyone on their own phone; the PM's phone keeps the crew timesheet built from it. The screens follow
// the phone's language; the PDFs, the spreadsheet and the messages to the office are always English.
// tasks.html routes here for #report/<day> and #clock/<day>.

import {
  KEYS, COMPANIES, esc, uid, load, save, normTask, normReport, normShift, blank, newFloor, fillFromTasks, mergeAnswers, CREW_TPL, pack, linkTo,
  today, addDays, niceDate, nowHM, span, fmtMin, t12, stamp, hrs, field, datalist, seg, setPath, getPath, readInput,
  toast, sheet, ask, sendSheet, pasteSheet, makePdf, savePdf, download, fileAway, dateBar, crewVar, letterhead, L, getLang, unlocked,
} from './shared.mjs';

const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
export const loadReports = () => Object.fromEntries(Object.entries(obj(load(KEYS.reports, {}))).map(([d, r]) => [d, normReport(r)]));
const loadShifts = key => load(key, []).map(normShift).filter(Boolean);
let R = loadReports(), MY = loadShifts(KEYS.hours), CREW = loadShifts(KEYS.crewHours);
const open = new Set(['sum']);
export const reloadReports = () => { R = loadReports(); MY = loadShifts(KEYS.hours); CREW = loadShifts(KEYS.crewHours); }; // the time clock too
const unsaved = () => toast(L("This phone wouldn't save. Open Settings and download a backup."), 'bad');
// Only reports someone has touched get stored; browsing an empty day leaves nothing behind.
const persist = () => save(KEYS.reports, Object.fromEntries(Object.entries(R).filter(([, r]) => r.updatedAt))) || unsaved();
const keep = (key, list) => save(key, list) || unsaved();
const isPM = S => S.role === 'Project manager';
// Daily reports of its own make this an office phone.
export const hasReports = () => Object.values(R).some(r => r.updatedAt);
const rep = (S, day) => (R[day] ||= normReport({
  date: day, floors: [],
  super: S.super || (S.role === 'Superintendent' ? S.me : ''),
  preparedBy: S.role === 'Superintendent' ? S.me : '',
}));
const go = h => (location.hash === '#' + h ? dispatchEvent(new HashChangeEvent('hashchange')) : (location.hash = h));
const $ = id => document.getElementById(id);
// The English office record (PDF, spreadsheet, messages), whatever language this phone shows. The screen uses niceDate and stamp.
const dayEn = d => niceDate(d, 'en'), stampEn = ts => stamp(ts, 'en');

const STATUS = () => [['On plan', 'good', L('On plan')], ['At risk', 'warn', L('At risk')], ['Behind plan', 'bad', L('Behind plan')], ['No work today', '', L('No work today')]]; // stored in English, shown in the phone's language
export const crewHours = c => c.laborFromTasks || c.labor ? c.labor : span(c.start, c.stop) / 60 * c.workers; // labor: summed from the task sheets by Fill
const active = r => r.floors.flatMap(f => f.crews.filter(c => !c.na));
const laborHrs = r => active(r).reduce((n, c) => n + crewHours(c), 0);
const waiting = r => r.decisions.filter(d => d.q && !d.pm);
const isLate = s => s.finish && s.deadline && s.finish > s.deadline; // datetime-local strings sort as times
const when = v => (v ? new Date(v).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

// l: the language of the words. The record asks for 'en'; the screen takes the phone's.
function lateLine(s, l) {
  if (!s.finish || !s.deadline) return L('Add the expected finish and the deadline to check the forecast.', {}, l);
  const h = (new Date(s.finish) - new Date(s.deadline)) / 36e5, a = Math.abs(h);
  // English keeps its old "1 days"; Spanish says "1 día".
  const amt = a >= 24 ? (hrs(a / 24) === '1' && (l || getLang()) === 'es' ? L('1 day', {}, l) : L('{n} days', { n: hrs(a / 24) }, l)) : L('{n} hrs', { n: hrs(a) }, l);
  return h > 0 ? L('⚠ Forecast finishes {amt} after the deadline', { amt }, l) : L('On track: {amt} of float before the deadline', { amt }, l);
}

// ---------- time clock ----------
// Everyone clocks in and out on their own phone, and only there: no typed times. Each tap opens a text to
// the PM whose link carries this phone's last two weeks, so a text that never went out is caught up by the
// next one. The PM's phone logs them into the crew timesheet, the one place hours change, and sends each
// Monday to Sunday week to the accountant.
// ponytail: times come from the worker's own phone clock, and a link can be hand-made; the PM reviewing
// the week is the check. A shared server with real sign-ins is the upgrade past that.

export const monday = d => addDays(d, -((new Date(d + 'T12:00').getDay() + 6) % 7)); // weeks run Monday to Sunday
const started = s => new Date(`${s.date}T${s.in}`).getTime();
const byTime = (a, b) => started(a) - started(b);
// Minutes on the clock, from the real times: an out time before the in time is the next morning, and a night
// shift across a clock change counts the hour gained or lost.
export const shiftMin = s => (s.in && s.out ? Math.round((new Date(`${s.out < s.in ? addDays(s.date, 1) : s.date}T${s.out}`) - started(s)) / 6e4) : 0);
// Payroll hours in hundredths (7h 45m is 775, shown 7.75), rounded per shift so the rows always add up to the totals.
const cents = s => Math.round(shiftMin(s) * 5 / 3);
const total = ss => ss.reduce((n, s) => n + cents(s), 0);
const h2 = c => (c / 100).toFixed(2);
// The shift this phone is clocked in on. One open longer than any real shift (16 hours) was a missed
// clock-out: the next tap starts a new shift, and the PM fills in the missing time.
const onShift = (now = Date.now()) => MY.filter(s => !s.out && now - started(s) < 16 * 36e5).sort(byTime).at(-1);
const deviceOf = S => S.device || ((S.device = uid()), save(KEYS.settings, S), S.device);

function clockView(S) {
  const on = onShift(), mon = monday(today());
  const week = MY.filter(s => s.date >= mon).sort(byTime), last = MY.filter(s => s.date >= addDays(mon, -7) && s.date < mon);
  const missed = MY.filter(s => !s.out && s !== on && s.date >= addDays(mon, -7)).sort(byTime).at(-1);
  const row = s => `<dt>${esc(niceDate(s.date))}</dt><dd>${s.out ? `${esc(L('{start} to {stop}', { start: t12(s.in), stop: t12(s.out) }))} · ${esc(L('{n} hrs', { n: h2(cents(s)) }))}`
    : `${esc(t12(s.in))} · ${s === on ? L('On the clock') : `<span class="pill" data-tone="warn">${L('No clock-out')}</span>`}`}</dd>`;
  $('app').innerHTML = `<section class="card"><h2>${L('Time clock')}</h2>
      ${field(L('Your name'), 's.worker', S.worker, { ph: L('First and last name') })}
      <p class="clock-now${on ? ' on' : ''}">${esc(on ? L('Clocked in since {time}', { time: t12(on.in) }) : L('Not clocked in'))}</p>
      ${missed ? `<p class="hint">${esc(L('No clock-out on {date}. The PM will fix that shift.', { date: niceDate(missed.date) }))}</p>` : ''}</section>
    <section class="card"><h2>${L('This week')}</h2>
      ${week.length ? `<dl class="kv">${week.map(row).join('')}</dl>` : `<p class="hint">${L('No hours yet this week.')}</p>`}
      <p class="out">${esc(L('Week total: {n} hrs', { n: h2(total(week)) }))} · ${esc(L('Last week: {n} hrs', { n: h2(total(last)) }))}</p></section>
    <p class="hint">${L('Each Clock in and Clock out opens a text to the PM. Send it every time: it carries your last two weeks, so a missed text catches up. Only the PM can change hours.')}</p>`;
  $('bar').innerHTML = `<div class="bar-in"><button class="btn primary big" data-act="hTap">${on ? L('Clock out') : L('Clock in')}</button>
    <button class="btn more" data-act="hMenu" aria-label="${L('More actions')}">⋯</button></div>`;
}

// The text to the PM: this phone's last two weeks, each shift under the name it was clocked in with, so a
// borrowed phone never moves its owner's hours to someone else. at orders texts opened out of turn.
async function sendMine(S, s, what) {
  const who = S.worker.trim(), since = addDays(today(), -13);
  const url = linkTo('tasks.html', await pack({ v: 1, kind: 'hours', at: Date.now(), shifts: MY.filter(x => x.date >= since) }));
  const text = what === 'in' ? `${who} clocked in at ${t12(s.in)}, ${dayEn(s.date)}.`
    : what === 'out' ? `${who} clocked out at ${t12(s.out)}, ${dayEn(s.date)}: ${h2(cents(s))} hrs.` : `${who}: hours for the last two weeks.`;
  sendSheet({ title: L('Send your hours to the PM'), url, text: `${text} Open the link on the PM's phone to log it.` });
}

// A worker's link opened on the PM's phone (at: when it was sent): new shifts are added, and what the PM
// hasn't changed follows the worker's phone (a clock-out since; a name fixed in a newer text). A shift the PM
// removed stays removed, and a link only speaks for shifts its own phone made. Returns what changed.
export function importShifts(log, shifts, at = 0) {
  let added = 0, updated = 0, skipped = 0;
  const same = (a, b) => a.who.toLowerCase() === b.who.toLowerCase() && a.date === b.date;
  for (const s of shifts) {
    if (!s.device) continue;
    const m = log.find(x => x.id === s.id);
    if (!m) {
      // ponytail: the PM already added this person's day by hand (the texts never came), so the PM's entry
      // stands and this one is filed as removed, never doubling the day. A real second shift that day is
      // added back by hand; match on overlapping times instead if split shifts become common.
      const twin = log.some(x => !x.gone && !x.device && same(x, s));
      log.push({ ...s, at, edited: { who: false, in: false, out: false }, gone: twin });
      if (twin) skipped++; else added++;
      continue;
    }
    if (m.gone || m.device !== s.device) continue;
    const before = [m.who, m.in, m.out].join();
    if (!m.edited.who && at > m.at) Object.assign(m, { who: s.who, at }); // an older text opened late keeps the newer name
    if (!m.edited.in) m.in = s.in;
    if (!m.edited.out && s.out) m.out = s.out; // and never undoes a clock-out
    if ([m.who, m.in, m.out].join() !== before) updated++;
  }
  return { added, updated, skipped };
}
// Returns the latest day in the link, to open that week.
export function openHours(data) {
  const inc = (Array.isArray(data.shifts) ? data.shifts : []).slice(0, 200).map(normShift).filter(Boolean);
  if (!inc.length) { toast(L('That link has no hours in it'), 'bad'); return ''; }
  const { added, updated, skipped } = importShifts(CREW, inc, Number.isFinite(data.at) ? data.at : 0);
  keep(KEYS.crewHours, CREW);
  const who = inc.at(-1).who || L('the crew');
  toast((added || updated ? L('Hours from {who}: {added} new, {updated} updated', { who, added, updated }) : L('Hours from {who} were already logged', { who }))
    + (skipped ? `. ${L('{n} skipped: you already added that day by hand', { n: skipped })}` : ''), skipped ? 'bad' : '');
  return inc.map(s => s.date).sort().at(-1);
}

// ---------- crew timesheet (the PM's phone, behind the passcode) ----------

const weekOf = day => { const mon = monday(day), sun = addDays(mon, 6); return CREW.filter(s => !s.gone && s.date >= mon && s.date <= sun).sort(byTime); };
// One timesheet per person, by name as typed (any case), in name order.
export function byPerson(shifts, l) { // l: 'en' for the accountant's copy; the screen takes the phone's language
  const m = new Map();
  for (const s of shifts) {
    const k = s.who.toLowerCase();
    if (!m.has(k)) m.set(k, { who: s.who || L('Name not set', {}, l), shifts: [] });
    m.get(k).shifts.push(s);
  }
  return [...m.values()].map(p => ({ ...p, hours: total(p.shifts) })).sort((a, b) => a.who.localeCompare(b.who));
}
const edited = s => s.edited.in || s.edited.out;
const shiftLine = s => `${s.out ? L('{n} hrs', { n: h2(cents(s)) }) : L('No clock-out')}${edited(s) ? ` · ${L('edited')}` : ''}`;
const crewStats = week => `<div class="stat"><b>${byPerson(week).length}</b><span>${L('People')}</span></div>
  <div class="stat"><b>${h2(total(week))}</b><span>${L('Hours')}</span></div>
  <div class="stat"><b class="${week.some(s => !s.out) ? 'warn' : ''}">${week.filter(s => !s.out).length}</b><span>${L('Open shifts')}</span></div>`;

function crewView(S, day) {
  const mon = monday(day), week = weekOf(day), people = byPerson(week);
  const shiftRow = s => `<div class="shift"><div class="row1"><b>${esc(niceDate(s.date))}</b><span class="out" data-out="shift" data-id="${s.id}">${shiftLine(s)}</span>
      <button class="x" data-act="hDel" data-id="${s.id}" aria-label="${esc(L('Remove the {date} shift', { date: niceDate(s.date) }))}">✕</button></div>
    <div class="grid two"><label class="field"><span>${L('In')}</span><input type="time" data-k="h.${s.id}.in" value="${s.in}"></label>
      <label class="field"><span>${L('Out')}</span><input type="time" data-k="h.${s.id}.out" value="${s.out}"></label></div></div>`;
  $('app').innerHTML = `<div class="datebar">
      <button class="nav-btn" data-go="clock/${addDays(mon, -7)}" aria-label="${L('Previous week')}">‹</button>
      <label class="day">${esc(niceDate(mon))}<small>${mon === monday(today()) ? L('This week') : mon < today() ? L('Past week') : L('Week ahead')} · ${esc(L('to {date}', { date: niceDate(addDays(mon, 6)) }))}</small>
        <input type="date" value="${mon}" data-pick="clock" aria-label="${L('Pick a week')}"></label>
      <button class="nav-btn" data-go="clock/${addDays(mon, 7)}" aria-label="${L('Next week')}">›</button></div>
    <div class="stats three" id="hoursStats">${crewStats(week)}</div>
    ${people.map((p, i) => `<section class="card person"><div class="row1"><h2>${esc(p.who)}</h2><b class="total" data-out="who" data-i="${i}">${L('{n} hrs', { n: h2(p.hours) })}</b></div>
      ${p.shifts.map(shiftRow).join('')}
      <div class="row1"><button class="link" data-act="hAdd" data-v="${esc(p.who)}">${esc(L('+ Add a shift for {name}', { name: p.who }))}</button>
        <button class="link" data-act="hRename" data-v="${esc(p.who)}">${L('Rename')}</button></div></section>`).join('')
    || `<div class="empty"><h2>${L('No hours logged this week')}</h2><p>${L("Each worker's Clock in and Clock out texts you a link. Tap it on this phone to log their hours here.")}</p></div>`}
    <p class="hint">${L("Only this phone changes hours. Times you change are marked edited and stay as you set them when that worker's next text comes in.")}</p>`;
  $('bar').innerHTML = `<div class="bar-in"><button class="btn primary big" data-act="hSend">${L('Send to accountant')}</button>
    <button class="btn more" data-act="hPmMenu" aria-label="${L('More actions')}">⋯</button></div>`;
}

// Typing a time on the timesheet: data-k="h.<shift id>.in|out". A shift keeps its clock-in; remove it instead.
export function hoursInput(el, S, day) {
  const [, id, f] = el.dataset.k.split('.'), s = CREW.find(x => x.id === id);
  if (!s || !['in', 'out'].includes(f) || (f === 'in' && !el.value)) return;
  s[f] = el.value;
  s.edited[f] = true;
  keep(KEYS.crewHours, CREW);
  const week = weekOf(day), people = byPerson(week);
  for (const o of $('app').querySelectorAll('[data-out]')) {
    if (o.dataset.out === 'shift') o.textContent = shiftLine(CREW.find(x => x.id === o.dataset.id));
    if (o.dataset.out === 'who') o.textContent = L('{n} hrs', { n: h2(people[o.dataset.i]?.hours ?? 0) });
  }
  $('hoursStats').innerHTML = crewStats(week);
}

function addShift(day, who = '') {
  const mon = monday(day), d0 = today() >= mon && today() <= addDays(mon, 6) ? today() : mon;
  const d = sheet(`<h3>${L('Add a shift')}</h3><div class="grid">
      <label class="field wide"><span>${L('Name')}</span><input name="who" value="${esc(who)}" list="crewNames" autocomplete="off"></label>
      <label class="field"><span>${L('Date')}</span><input type="date" name="date" value="${d0}"></label><span></span>
      <label class="field"><span>${L('In')}</span><input type="time" name="in"></label><label class="field"><span>${L('Out')}</span><input type="time" name="out"></label></div>
    ${datalist('crewNames', byPerson(CREW.filter(s => !s.gone)).map(p => p.who))}
    <div class="btns"><button class="btn primary" data-save>${L('Add the shift')}</button></div>`);
  d.querySelector('[data-save]').onclick = () => {
    const v = n => d.querySelector(`[name=${n}]`).value;
    const s = normShift({ id: uid(), who: v('who'), date: v('date'), in: v('in'), out: v('out'), edited: { who: true, in: true, out: true } });
    if (!s?.who) return toast(L('Add the name, the date and the clock-in time'), 'bad');
    CREW.push(s);
    keep(KEYS.crewHours, CREW);
    d.close();
    go('clock/' + s.date);
  };
}

// A name fixed by the PM (a typo, a nickname) on every shift logged under it; the worker's later texts keep it.
function renameWorker(day, who) {
  const d = sheet(`<h3>${esc(L('Rename {name}', { name: who }))}</h3><label class="field"><span>${L('Name on the timesheet')}</span><input name="who" value="${esc(who)}" autocomplete="off"></label>
    <div class="btns"><button class="btn primary" data-save>${L('Rename')}</button></div>`);
  d.querySelector('[data-save]').onclick = () => {
    const name = d.querySelector('[name=who]').value.trim().slice(0, 60);
    if (!name) return toast(L('Type the name'), 'bad');
    for (const s of CREW) if (!s.gone && s.who.toLowerCase() === who.toLowerCase()) Object.assign(s, { who: name, edited: { ...s.edited, who: true } });
    keep(KEYS.crewHours, CREW);
    d.close();
    go('clock/' + day);
  };
}

// Accountant's copy: a spreadsheet and a PDF of the week. A leading = + - @ is quoted so a typed name
// can't run as a spreadsheet formula.
const cell = v => { const s = String(v).replace(/^[=+\-@\t\r]/, "'$&"); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const weekday = d => new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' });
export function timesheetCsv(people) {
  const rows = [['Name', 'Date', 'Day', 'Clock in', 'Clock out', 'Hours', 'Note']];
  for (const p of people) {
    for (const s of p.shifts) rows.push([p.who, s.date, weekday(s.date), t12(s.in), t12(s.out), s.out ? h2(cents(s)) : '', [!s.out && 'No clock-out', edited(s) && 'Edited by PM'].filter(Boolean).join('; ')]);
    rows.push([p.who, '', '', '', 'Week total', h2(p.hours), '']);
  }
  rows.push(['All crew', '', '', '', 'Week total', h2(people.reduce((n, p) => n + p.hours, 0)), '']);
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
const timesheetPdf = (S, mon, people) => makePdf('Weekly timesheet', letterhead(S, `Week of ${dayEn(mon)} to ${dayEn(addDays(mon, 6))}`), [
  ...people.map(p => [`${p.who} · ${h2(p.hours)} hrs`, p.shifts.map(s => [dayEn(s.date),
    `${t12(s.in)} to ${s.out ? `${t12(s.out)} · ${h2(cents(s))} hrs` : '(no clock-out)'}${edited(s) ? ' · edited by PM' : ''}`])]),
  ['Week total', [['All crew', `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${h2(people.reduce((n, p) => n + p.hours, 0))} hrs`], ['Approved by', S.me || S.pm]]],
], `${COMPANIES} · Timesheet week of ${mon}`);

async function toAccountant(S, day) {
  const mon = monday(day), week = weekOf(day), people = byPerson(week, 'en'), gaps = week.filter(s => !s.out).length;
  if (!week.length) return toast(L('No hours logged this week'), 'bad');
  if (gaps && !await ask(gaps === 1 ? L('1 shift has no clock-out and count as 0 hours. Fill in the out times first, or send anyway?')
    : L('{n} shifts have no clock-out and count as 0 hours. Fill in the out times first, or send anyway?', { n: gaps }), L('Send anyway'))) return;
  const name = `Timesheet week of ${mon}`;
  const files = [new File(['﻿' + timesheetCsv(people)], `${name}.csv`, { type: 'text/csv' }), new File([timesheetPdf(S, mon, people)], `${name}.pdf`, { type: 'application/pdf' })];
  // Phones get the share sheet (Mail to the accountant, Save to Files); computers download both files.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files })) {
    try { return await navigator.share({ files, title: name }); } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (const f of files) download(f, f.name);
}

export const OUT = {
  lh: (r, d) => {
    const c = r.floors[d.f].crews[d.c], n = hrs(crewHours(c));
    return c.laborFromTasks || c.labor ? L('Total labor-hours: {n} (from the task sheets)', { n })
      : c.start && c.stop ? L('Total labor-hours: {n} ({workers} × {time})', { n, workers: c.workers, time: fmtMin(span(c.start, c.stop)) })
      : L('Total labor-hours: {n}', { n });
  },
  late: (r, d) => lateLine(r.next[d.i]),
};

// ---------- daily report ----------

const sec = (id, num, title, body, badge = '') => `<details class="card sec" id="sec-${id}" data-sec="${id}"${open.has(id) ? ' open' : ''}>
  <summary><h2>${num ? `<span class="num">${num}</span>` : ''}${title}</h2>${badge}</summary><div class="sec-body">${body}</div></details>`;
const remove = (list, i, label) => `<button class="link danger" data-act="del" data-list="${list}" data-i="${i}">${label}</button>`;
const count = (n, text, tone = '') => (n ? `<span class="pill" data-tone="${tone}">${text}</span>` : '');

function reportView(S, day) {
  const r = rep(S, day), late = r.next.filter(isLate).length, pend = waiting(r).length;
  const unconfirmed = r.needs.filter(n => n.item && !n.confirmed).length, bare = active(r).filter(c => !c.done).length;
  const cur = STATUS().find(s => s[0] === r.status);
  $('app').innerHTML = dateBar(day, 'report') + `<div id="summary" class="stack">${summary(r)}</div>
    <section class="card"><div class="grid">
      ${field(L('Superintendent'), 'r.super', r.super)}${field(L('Shift start'), 'r.shiftStart', r.shiftStart, { type: 'time' })}${field(L('Shift end'), 'r.shiftEnd', r.shiftEnd, { type: 'time' })}
    </div><p class="hint">${r.submittedAt ? esc(L('Sent to the PM {time}', { time: stamp(r.submittedAt) })) : L('Not sent to the PM yet')}${r.pmReview ? ` · ${esc(L('PM reviewed: {note}', { note: r.pmReview }))}` : ''}</p></section>
    ${sec('sum', 1, L('Overall status & today’s results'), `${seg('r.status', r.status, STATUS())}
      ${field(L('Most important results today, planned work missed, and effect on the job'), 'r.results', r.results, { rows: 4 })}`,
      r.status ? `<span class="pill" data-tone="${cur?.[1] || ''}">${esc(cur?.[2] || r.status)}</span>` : '')}
    ${sec('wins', 2, L('Good results & lessons to repeat'), field(L('Crew wins, quality improvements, faster methods, repeat-floor lessons'), 'r.wins', r.wins, { rows: 3 }))}
    ${sec('issues', 3, L('Site issues, concerns & coordination'), field(L('Safety / quality issues, other trades, access, inspections, scope changes'), 'r.issues', r.issues, { rows: 3 })
      + field(L('Who was notified / when'), 'r.notified', r.notified))}
    ${sec('needs', 4, L('Material, equipment & manpower'), r.needs.map((n, i) => `<div class="item"><div class="grid">
        ${field(L('Item / resource'), `r.needs.${i}.item`, n.item, { wide: true, ph: L('e.g. 2" EMT, scissor lift, 2 more journeymen') })}
        ${field(L('Quantity'), `r.needs.${i}.qty`, n.qty)}${field(L('Floor / crew'), `r.needs.${i}.where`, n.where, { list: 'floors' })}
        ${field(L('Needed by'), `r.needs.${i}.by`, n.by, { type: 'datetime-local' })}</div>
        <label class="switch"><input type="checkbox" data-k="r.needs.${i}.confirmed"${n.confirmed ? ' checked' : ''}> ${L('Availability confirmed')}</label>
        ${remove('needs', i, L('Remove need'))}</div>`).join('') + `<button class="btn" data-act="add" data-v="needs">${L('+ Add a need')}</button>`,
      count(unconfirmed, L('{n} unconfirmed', { n: unconfirmed }), 'warn'))}
    ${sec('pm', 5, L('Project manager decision help'), `<p class="hint">${L('State the decision, your recommendation, and when you need an answer. The PM answers right here.')}</p>`
      + r.decisions.map((d, i) => `<div class="item">
        ${field(L('Decision / support needed'), `r.decisions.${i}.q`, d.q, { rows: 2 })}
        <div class="grid">${field(L('Recommendation'), `r.decisions.${i}.rec`, d.rec, { wide: true })}${field(L('Needed by'), `r.decisions.${i}.by`, d.by, { type: 'datetime-local' })}</div>
        ${d.by && !d.pm && new Date(d.by) < new Date() ? `<span class="pill" data-tone="bad">${L('Past due')}</span>` : ''}
        <div class="field"><span>${L('PM response')}</span>${seg(`r.decisions.${i}.pm`, d.pm, [['Approved', 'good', L('Approved')], ['Declined', 'bad', L('Declined')], ['Discuss', 'info', L('Discuss')]])}</div>
        ${field(L('PM note'), `r.decisions.${i}.pmNote`, d.pmNote)}
        ${remove('decisions', i, L('Remove decision'))}</div>`).join('') + `<button class="btn" data-act="add" data-v="decisions">${L('+ Add a decision')}</button>`,
      count(pend, L('{n} waiting', { n: pend }), 'warn'))}
    ${sec('floors', '', L('Floor reports · crew detail'), r.floors.map((f, fi) => `<div class="floor">
        <div class="edit-row">${field(L('Actual floor / level'), `r.floors.${fi}.floor`, f.floor, { list: 'floors' })}<button class="x" data-act="delFloor" data-i="${fi}" aria-label="${L('Remove floor')}">✕</button></div>
        ${f.crews.map((c, ci) => crewBlock(S, r, fi, ci, c)).join('')}
        <button class="link" data-act="addCrewTo" data-i="${fi}">${L('+ Add another crew to this floor')}</button></div>`).join('')
      + `${r.floors.length ? '' : `<p class="hint">${L('Add each floor worked today, or fill them in from the crews’ task sheets on this phone.')}</p>`}
        <div class="btns"><button class="btn" data-act="addFloor">${L('+ Add floor')}</button><button class="btn primary" data-act="fill">${L('Fill from task sheets')}</button></div>
        ${datalist('floors', S.floors)}`,
      count(bare, L('{n} need notes', { n: bare }), 'warn'))}
    ${sec('next', '', L('Next steps & completion forecast'), r.next.map((s, i) => `<div class="item">
        ${field(L('Next step / floor / crew'), `r.next.${i}.step`, s.step, { rows: 2 })}
        ${field(L('Prerequisites / resources'), `r.next.${i}.prereq`, s.prereq)}
        <div class="grid">${field(L('Planned start'), `r.next.${i}.start`, s.start, { type: 'datetime-local' })}${field(L('Estimated duration'), `r.next.${i}.dur`, s.dur, { ph: L('e.g. 2 days') })}
        ${field(L('Expected finish'), `r.next.${i}.finish`, s.finish, { type: 'datetime-local' })}${field(L('Required deadline'), `r.next.${i}.deadline`, s.deadline, { type: 'datetime-local' })}
        ${field(L('Responsible lead'), `r.next.${i}.lead`, s.lead)}${field(L('Confirm / check-in by'), `r.next.${i}.checkin`, s.checkin, { type: 'datetime-local' })}</div>
        <p class="out ${isLate(s) ? 'late' : ''}" data-out="late" data-i="${i}">${lateLine(s)}</p>
        ${remove('next', i, L('Remove step'))}</div>`).join('') + `<button class="btn" data-act="add" data-v="next">${L('+ Add next step')}</button>`,
      count(late, L('{n} late', { n: late }), 'bad'))}
    ${sec('risks', '', L('Potential delays & workarounds'), r.risks.map((x, i) => `<div class="item">
        ${field(L('Risk / affected floor & crew'), `r.risks.${i}.risk`, x.risk, { rows: 2 })}
        ${field(L('Expected impact / time at risk'), `r.risks.${i}.impact`, x.impact)}
        ${field(L('Prevention / workaround'), `r.risks.${i}.prevent`, x.prevent, { rows: 2 })}
        ${field(L('Fallback work if blocked'), `r.risks.${i}.fallback`, x.fallback)}
        <div class="grid">${field(L('Action owner'), `r.risks.${i}.owner`, x.owner)}${field(L('Action needed by'), `r.risks.${i}.by`, x.by, { type: 'datetime-local' })}</div>
        ${remove('risks', i, L('Remove risk'))}</div>`).join('') + `<button class="btn" data-act="add" data-v="risks">${L('+ Add a risk')}</button>`
      + `<p class="hint">${L('Escalate urgent issues when you find them, and note who you told in section 3.')}</p>`)}
    ${sec('sign', '', L('Sign-off'), `<div class="grid">${field(L('Prepared by'), 'r.preparedBy', r.preparedBy)}${field(L('PM review / time'), 'r.pmReview', r.pmReview)}</div>
      ${isPM(S) ? `<button class="btn" data-act="stampPM">${L('Stamp my review now')}</button>` : ''}`)}
    <p class="hint">${L('Changes save on this phone as you type.')}${S.folderUrl ? ` ${L('Sending the report also files a PDF in the review folder.')}` : ''}</p>`;
  $('bar').innerHTML = `<div class="bar-in"><button class="btn primary big" data-act="send">${isPM(S) ? L('Send back to Supt.') : L('Send to PM')}</button>
    <button class="btn more" data-act="menu" aria-label="${L('More actions')}">⋯</button></div>`;
}

// Totals and section check marks, redrawn as the superintendent types.
function summary(r) {
  const late = r.next.filter(isLate).length, pend = waiting(r).length;
  const ready = [
    ['sum', L('Summary'), r.status && (r.results || r.status === 'No work today')],
    ['floors', L('Floors'), active(r).length && active(r).every(c => c.done)],
    ['next', L('Next steps'), r.next.some(s => s.step)],
    ['risks', L('Risks'), r.risks.some(x => x.risk)],
    ['sign', L('Sign-off'), r.preparedBy],
  ];
  return `<div class="stats">
      <div class="stat"><b>${hrs(laborHrs(r))}</b><span>${L('Labor-hrs')}</span></div>
      <div class="stat"><b>${active(r).length}</b><span>${L('Crew sections')}</span></div>
      <div class="stat"><b class="${pend ? 'warn' : ''}">${pend}</b><span>${L('Decisions waiting')}</span></div>
      <div class="stat"><b class="${late ? 'bad' : ''}">${late}</b><span>${L('Late forecasts')}</span></div>
    </div>
    <div class="chips" role="group" aria-label="${L('Jump to section')}">${ready.map(([id, label, ok]) => `<button class="chip${ok ? ' ok' : ''}" data-act="jump" data-v="${id}">${ok ? '✓ ' : ''}${label}</button>`).join('')}</div>`;
}

function crewBlock(S, r, fi, ci, c) {
  const k = `r.floors.${fi}.crews.${ci}`;
  return `<div class="crew-edit" style="${crewVar(S, c.name)}">
    <div class="row1"><strong>${esc(c.name === 'Crew not set' ? L('Crew not set') : c.name)}</strong>
      <button class="chip" data-act="na" data-f="${fi}" data-c="${ci}" aria-pressed="${!c.na}">${c.na ? L('N/A, tap to add') : L('Worked here')}</button></div>
    ${c.na ? '' : `<div class="grid">
      ${field(L('Crew / lead'), `${k}.lead`, c.lead)}${field(L('Worker count'), `${k}.workers`, c.workers, { type: 'number', mode: 'numeric' })}
      ${field(L('Members'), `${k}.members`, c.members, { wide: true })}
      ${field(L('Room / area'), `${k}.area`, c.area)}${field(L('Task / drawing ref.'), `${k}.ref`, c.ref)}
      ${field(L('Work start'), `${k}.start`, c.start, { type: 'time' })}${field(L('Work stop'), `${k}.stop`, c.stop, { type: 'time' })}</div>
      <p class="out" data-out="lh" data-f="${fi}" data-c="${ci}">${OUT.lh(r, { f: fi, c: ci })}</p>
      ${field(L('Work completed: installation, quantities, exact locations, remaining work'), `${k}.done`, c.done, { rows: 3 })}
      ${field(L('Quality / testing / accuracy'), `${k}.quality`, c.quality, { rows: 2 })}
      ${field(L('Hold-ups / delays: cause, duration, workers affected, action taken'), `${k}.holdups`, c.holdups, { rows: 2 })}
      ${field(L('Good results / improvements'), `${k}.good`, c.good, { rows: 2 })}`}</div>`;
}

// ---------- PDF and the review folder ----------

const recordSecs = r => [
  ['Daily summary & PM actions', [['Report date', dayEn(r.date)], ['Superintendent', r.super],
    ['Shift / work hours', r.shiftStart && `${t12(r.shiftStart)} to ${t12(r.shiftEnd)}`], ['Submitted at', stampEn(r.submittedAt)], ['Labor-hours', hrs(laborHrs(r))]]],
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
    ['Estimated duration', s.dur], ['Expected finish', when(s.finish)], ['Required deadline', when(s.deadline)], ['Forecast', s.finish && s.deadline && lateLine(s, 'en')],
    ['Responsible lead', s.lead], ['Confirm / check-in by', when(s.checkin)]])],
  ['Potential delays & workarounds', r.risks.flatMap((x, i) => [[`Risk ${i + 1}`, x.risk], ['Impact / time at risk', x.impact], ['Prevention / workaround', x.prevent],
    ['Fallback work', x.fallback], ['Action owner', x.owner], ['Needed by', when(x.by)]])],
  ['Sign-off', [['Prepared by', r.preparedBy], ['PM review / time', r.pmReview]]],
];

const record = (S, r) => makePdf('Superintendent daily report', letterhead(S, dayEn(r.date)), recordSecs(r), `${COMPANIES} · Daily report ${r.date}`);
const fileReport = (S, r) => { if (!S.folderUrl) return; r.filedAt = Date.now(); persist(); return fileAway(S, { date: r.date, name: `Daily Report ${r.date}`, bytes: record(S, r), v: r.updatedAt }); };
// A sent report edited afterwards is filed again when you leave it.
export const fileReportIfChanged = (S, day) => { const r = R[day]; return r?.submittedAt && r.updatedAt > r.filedAt && fileReport(S, r); };

// ---------- report links ----------

// A report link opened on this phone. Returns the report's day, or '' if the link had none.
export async function openReport(data, S) {
  const inc = normReport(data.report);
  if (!inc.date) { toast(L('That link has no report in it'), 'bad'); return ''; }
  const mine = R[inc.date], pmSent = data.from === 'Project manager';
  if (mine?.updatedAt && mine.updatedAt !== inc.updatedAt && pmSent !== isPM(S)) {
    // Normal back-and-forth: neither side's work is lost, so there's nothing to ask.
    R[inc.date] = pmSent ? mergeAnswers(mine, inc) : mergeAnswers(inc, mine);
    R[inc.date].updatedAt = Date.now();
    toast(pmSent ? L('PM answers added to your report') : L('Updated report loaded. Your answers are kept.'));
    open.add('pm');
    fileReport(S, R[inc.date]);
  } else if (!mine?.updatedAt || mine.updatedAt === inc.updatedAt
    || await ask(L('Replace your copy of the {date} report with the one in this link? Link copy saved {link}. Yours saved {mine}.',
      { date: niceDate(inc.date), link: stamp(inc.updatedAt), mine: stamp(mine.updatedAt) }), L('Use the link copy'))) {
    R[inc.date] = inc;
    inc.updatedAt ||= Date.now();
    toast(L('Report loaded'));
    if (isPM(S)) open.add('pm');
    fileReport(S, inc);
  }
  persist();
  return inc.date;
}

async function send(S, day) {
  const r = rep(S, day);
  if (!r.status) { open.add('sum'); reportView(S, day); return toast(L('Set the overall status first'), 'bad'); }
  if (!isPM(S)) r.submittedAt = Date.now();
  r.updatedAt = Date.now();
  persist();
  reportView(S, day);
  const url = linkTo('tasks.html', await pack({ v: 1, kind: 'report', from: S.role, pin: S.pin, report: r }));
  const answered = r.decisions.filter(d => d.q && d.pm).length, asked = r.decisions.filter(d => d.q).length;
  const firstDue = waiting(r).map(d => d.by).filter(Boolean).sort()[0];
  sendSheet(isPM(S)
    ? { title: L('PM review · {date}', { date: niceDate(r.date) }), url, text: `PM review of the ${dayEn(r.date)} daily report: ${answered} of ${asked} decisions answered.` }
    : { title: L('Daily report · {date}', { date: niceDate(r.date) }), url,
      text: `Daily report ${dayEn(r.date)}, ${S.project} (${COMPANIES}): ${r.status}. ${active(r).length} crew sections, ${hrs(laborHrs(r))} labor-hrs.`
        + (asked - answered ? ` ${asked - answered} decision${asked - answered === 1 ? ' needs' : 's need'} you${firstDue ? ' by ' + when(firstDue) : ''}.` : '') });
  fileReport(S, r);
}

// ---------- screens, actions and typing (the app shell hands these over) ----------

// The time clock is the crew timesheet on the PM's phone (tasks.html asks for the passcode first), a worker's own clock anywhere else.
export const renderOffice = (v, S, day) => (v === 'clock' ? (isPM(S) && unlocked() ? crewView : clockView)(S, day) : !unlocked() ? go('report/' + day) : reportView(S, day));

const menu = items => sheet(`<h3>${L('More')}</h3><div class="menu">${items.filter(Boolean).map(([a, label, cls]) => `<button class="btn ${cls || ''}" data-act="${a}">${esc(label)}</button>`).join('')}</div>`);

export async function reportAct(a, el, S, day, v) {
  const r = rep(S, day), val = el.dataset.v, i = +el.dataset.i;
  switch (a) {
    case 'set': { const ctx = { r, s: S }; setPath(ctx, el.dataset.k, getPath(ctx, el.dataset.k) === val ? '' : val); break; }
    case 'jump': open.add(val); reportView(S, day); return $('sec-' + val).scrollIntoView({ behavior: 'smooth', block: 'start' });
    case 'add': r[val].push(blank(val)); open.add({ needs: 'needs', decisions: 'pm', next: 'next', risks: 'risks' }[val]); break;
    case 'del': if (!await ask(L('Remove this entry?'), L('Remove'), 'danger')) return; r[el.dataset.list].splice(i, 1); break;
    case 'addFloor': r.floors.push(newFloor('', S.crews.map(c => c.name))); open.add('floors'); break;
    case 'delFloor': if (!await ask(r.floors[i].floor ? L('Remove {floor} and its crew notes?', { floor: r.floors[i].floor }) : L('Remove this floor and its crew notes?'), L('Remove'), 'danger')) return; r.floors.splice(i, 1); break;
    case 'addCrewTo': r.floors[i].crews.push({ ...CREW_TPL, na: false, name: L('Crew {x}', { x: String.fromCharCode(65 + r.floors[i].crews.length) }) }); break;
    case 'na': { const c = r.floors[+el.dataset.f].crews[+el.dataset.c]; c.na = !c.na; break; }
    case 'fill': {
      const ts = load(KEYS.tasks, []).map(normTask).filter(t => t.date === day);
      if (!ts.length) return toast(L('No task sheets for {date} on this phone. Make or load them on the Tasks tab first.', { date: niceDate(day) }), 'bad');
      const n = fillFromTasks(r, ts, S.crews.map(c => c.name));
      open.add('floors');
      toast(L('Filled {sections} from {sheets}. Typed notes kept; work hours updated.', {
        sections: n === 1 ? L('1 crew section') : L('{n} crew sections', { n }), sheets: ts.length === 1 ? L('1 task sheet') : L('{n} task sheets', { n: ts.length }) }));
      break;
    }
    case 'carry': {
      const prev = Object.keys(R).filter(d => d < day && R[d].updatedAt).sort().at(-1);
      if (!prev) return toast(L('No earlier report on this phone to copy from'));
      const p = R[prev], copy = x => structuredClone(x);
      Object.assign(r, { super: r.super || p.super, shiftStart: r.shiftStart || p.shiftStart, shiftEnd: r.shiftEnd || p.shiftEnd });
      if (!r.floors.length) r.floors = p.floors.map(f => ({ floor: f.floor, crews: f.crews.map(c => ({ ...CREW_TPL, name: c.name, na: c.na, lead: c.lead, workers: c.workers, members: c.members })) }));
      r.needs.push(...p.needs.filter(n => !n.confirmed && !r.needs.some(x => x.item === n.item)).map(copy));
      r.next.push(...p.next.filter(s => !r.next.some(x => x.step === s.step)).map(copy));
      r.risks.push(...p.risks.filter(x => !r.risks.some(y => y.risk === x.risk)).map(copy));
      toast(L('Copied crews, open needs, next steps and risks from {date}', { date: niceDate(prev) }));
      break;
    }
    case 'stampPM': r.pmReview = `${S.me || 'PM'} · ${stampEn(Date.now())}`; break;
    case 'send': return send(S, day);
    case 'menu':
      return menu([['fill', L('Fill floors from task sheets')], ['carry', L('Copy crews, needs and risks from last report')], ['paste', L('Open a link someone sent you')],
        ['pdf', L('Save as PDF')], S.folderUrl && ['fileNow', L('Save to the review folder now')], ['settings', L('Settings, crews and backup')], ['clear', L('Clear this report'), 'danger']]);
    case 'pdf': return savePdf(`Daily Report ${r.date}.pdf`, record(S, r));
    case 'fileNow': return fileReport(S, r);
    case 'paste': return pasteSheet(code => go('p=' + code));
    case 'settings': return go('settings');
    case 'clear':
      if (!await ask(L('Clear everything in the {date} report?', { date: niceDate(day) }), L('Clear'), 'danger')) return;
      delete R[day];
      persist();
      return renderOffice(v, S, day);

    // time clock: a worker's own phone
    case 'hTap': {
      if (!S.worker.trim()) { toast(L('Type your name first'), 'bad'); return $('app').querySelector('[data-k="s.worker"]')?.focus(); }
      const on = onShift(), s = on || normShift({ id: uid(), device: deviceOf(S), who: S.worker, date: today(), in: nowHM() });
      if (on) Object.assign(on, { out: nowHM(), who: S.worker.trim() }); else MY.push(s); // a name fixed while on the clock goes on this shift
      keep(KEYS.hours, MY);
      navigator.vibrate?.(12);
      renderOffice(v, S, day);
      return sendMine(S, s, on ? 'out' : 'in');
    }
    case 'hResend': return S.worker.trim() ? sendMine(S, null, 'all') : toast(L('Type your name first'), 'bad');
    case 'hMenu': return menu([MY.length && ['hResend', L('Send my hours to the PM again')], ['paste', L('Open a link someone sent you')], !unlocked() && ['lockBtn', L('Office sign-in')]]);
    // the PM's crew timesheet
    case 'hSend': return toAccountant(S, day);
    case 'hAdd': return addShift(day, val);
    case 'hRename': return renameWorker(day, val);
    case 'hDel': {
      const s = CREW.find(x => x.id === el.dataset.id);
      if (!s || !await ask(s.who ? L("Remove {name}'s {date} shift? A later text from their phone won't bring it back.", { name: s.who, date: niceDate(s.date) })
        : L("Remove this {date} shift? A later text from their phone won't bring it back.", { date: niceDate(s.date) }), L('Remove'), 'danger')) return;
      s.gone = true;
      keep(KEYS.crewHours, CREW);
      return renderOffice(v, S, day);
    }
    case 'hPmMenu': return menu([['hAdd', L('Add a shift')], ['paste', L('Open a link someone sent you')], ['settings', L('Settings, crews and backup')]]);
    default: return;
  }
  r.updatedAt = Date.now();
  persist();
  renderOffice(v, S, day);
}

// Typing in a report field: data-k="r.path.to.field".
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
}

// Remember which report sections are open across re-renders.
export const sectionToggle = e => { const id = e.target.dataset?.sec; if (id) e.target.open ? open.add(id) : open.delete(id); };

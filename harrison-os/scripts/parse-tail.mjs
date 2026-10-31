// Summarise a `wrangler tail --format json` capture: outcome and CPU/wall time per invocation.
// Prints no logs bodies (they could contain identifiers); only outcome, timing and the event kind.
import fs from 'node:fs';

const file = process.argv[2];
const txt = fs.readFileSync(file, 'utf8');
const objs = [];
let depth = 0, start = -1, inStr = false, esc = false;
for (let i = 0; i < txt.length; i++) {
  const c = txt[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') { inStr = true; continue; }
  if (c === '{') { if (depth === 0) start = i; depth++; }
  else if (c === '}') {
    depth--;
    if (depth === 0) { try { objs.push(JSON.parse(txt.slice(start, i + 1))); } catch { /* partial */ } }
  }
}
console.log(`events: ${objs.length}`);
for (const o of objs) {
  const ev = o.event || {};
  const kind = ev.cron ? `cron ${ev.cron}` : ev.request ? `${ev.request.method} ${new URL(ev.request.url).pathname}` : 'other';
  const probe = (o.logs || []).map((l) => (Array.isArray(l.message) ? l.message.join(' ') : String(l.message))).filter((m) => m.startsWith('cpu-probe')).join(' | ');
  console.log(JSON.stringify({ outcome: o.outcome, cpuTime: o.cpuTime, wallTime: o.wallTime, kind, exceptions: (o.exceptions || []).length, probe: probe || undefined }));
}
if (objs[0]) console.log('fields:', Object.keys(objs[0]).join(','));

#!/usr/bin/env node
// Static check that no user-visible English is hard-coded outside L() in the Schwab field app.
//
//   node --test es-lint.test.js                  (ROOT=/path/to/docs/schwab picks another copy of the app)
//
// Scans tasks.html, shared.mjs and report.mjs and FAILS when it finds, outside L(...) / x(...):
//   field('Label' ...)                      a literal first argument
//   toast('...') and ask('...', 'Yes')      a literal message or button label
//   aria-label="Literal", placeholder="Literal", title="Literal", alt="Literal"
//                                           in markup, and setAttribute('aria-label', 'Literal')
//   HTML text nodes in markup strings and template literals: <h3>Some English</h3>
//   ph: 'Literal' (a field's placeholder) and title: 'Literal' (a share sheet's heading)
//   any other sentence-like literal: capitalized, two or more words (a menu label, a heading, a message)
// Whatever the sources hold inside L('...') is fine: that is the Spanish lookup.
//
// Every exception is in ALLOW below, with the reason. A test fails if an exception no longer matches anything,
// so the list cannot rot. The last test runs the detector on small samples, so a broken detector fails loudly
// instead of passing everything.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = [process.env.ROOT, path.join(__dirname, '..', 'docs', 'schwab')].filter(Boolean).find(d => fs.existsSync(path.join(d, 'tasks.html')));
// The app's own pages and modules: tasks.html, shared.mjs, report.mjs, and any module a later phase adds next to them (sync.mjs).
// es.mjs is the Spanish itself, and index.html / report.html only forward to the app.
const FILES = ROOT ? ['tasks.html', ...fs.readdirSync(ROOT).filter(f => f.endsWith('.mjs') && f !== 'es.mjs').sort()] : [];

// ---------------------------------------------------------------------------------------------
// Exceptions. A finding is excused when every field given in an entry matches it.
//   file: the source file   decl: the top-level function or const it sits in   text: substring or RegExp of the literal
//   rule: which detector (A field, B toast/ask, C attribute, D markup text, E sentence)
// ---------------------------------------------------------------------------------------------
const COMPANY = ['H.A. Sack-Electrical', 'Sack Company-Electrical']; // company names are the same in every language; removed from every literal before checking
const ALLOW = [
  { why: 'language names are written in their own language so a person can find theirs', text: /^(English|Español|EN|ES)$/ },
  { why: 'the first-open language chooser is bilingual on purpose: no language is picked yet', file: 'tasks.html', text: /^(Language · Idioma|Close · Cerrar)$/ },
  { why: 'shown only if the app fails to load, before any language exists; bilingual on purpose', file: 'tasks.html', text: /finish loading|Get signal|Reload|La app no termin|Con señal|Recargar/ },
  { why: 'static header attribute, overwritten by header() with L(...) before the first paint', file: 'tasks.html', rule: 'C', text: /^(Office sign-in|Screens)$/ },
  { why: 'example names in a placeholder; names need no translation', file: 'shared.mjs', decl: 'settingsView', text: 'Mike R, Jose L, Tre W' },

  // Stored values: kept in English in the data, compared in code, shown through L(...) (e.g. L(t.status)).
  { why: 'stored role and status values are English keys in the data; the screen shows L(value)', text: /^(Project manager|Crew member|Follow-up needed|On plan|At risk|Behind plan|No work today)$/ },
  { why: 'stored default floor and crew names in the data; people rename them', text: /^(Floor not set|Crew not set)$/ },
  { why: 'default project and site names, finish checks and floors are settings data that people edit', file: 'shared.mjs', decl: 'DEFAULT_SETTINGS' },

  // The office record: PDFs, spreadsheet and messages to the office are English by design (README).
  { why: 'PDF builder: the paper form is always English', decl: 'recordRows' },
  { why: 'PDF builder: the paper form is always English', decl: 'recordSecs' },
  { why: 'PDF builder: the paper form is always English', decl: 'record' },
  { why: 'PDF builder: the accountant\'s spreadsheet is always English', decl: 'timesheetCsv' },
  { why: 'PDF builder: the accountant\'s timesheet is always English', decl: 'timesheetPdf' },
  { why: 'PDF writer: "Nothing recorded" is printed on the English paper form', file: 'shared.mjs', decl: 'makePdf' },
  { why: 'PDF title and file name of the day\'s sheets: the paper form is always English', file: 'tasks.html', decl: 'act', text: /^(Electrical task sheets|Task sheets)/ },
  { why: 'spreadsheet and PDF file name: files go to the accountant in English', file: 'report.mjs', decl: 'toAccountant', text: /^Timesheet week of/ },
  { why: 'PDF file name and review-folder record name: files are filed in English', file: 'report.mjs', text: /^Daily Report/ },
  { why: 'roll-up text written into the stored report is the office record, in English', decl: 'fillFromTasks' },
  { why: 'message body to the PM is always English', file: 'report.mjs', decl: 'sendMine' },
  { why: 'message body to the PM is always English', file: 'report.mjs', decl: 'send', text: /^(PM review of the|Daily report |\s*decisions? need|\s*needs? you| by )/ },
];
const used = new Set();

// ---------------------------------------------------------------------------------------------
// Tokenizer: just enough JavaScript to find string literals and what calls enclose them.
// ---------------------------------------------------------------------------------------------
const decode = s => s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');

function tokenize(src, base = 0, lineOf) { return lex(src, 0, base, lineOf, false).toks; }

// Reads tokens from position i; with braced, stops at the } that closes a ${ ... } and returns where it was.
function lex(src, i, base, lineOf, braced) {
  const toks = [];
  let depth = 0;
  const last = () => toks.at(-1);
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
    const line = lineOf(base + i);
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      toks.push({ type: 'str', text: decode(src.slice(i + 1, j)), line });
      i = j + 1; continue;
    }
    if (c === '`') {
      const quasis = [''], inner = [];
      let j = i + 1;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { quasis[quasis.length - 1] += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { // the expression is code: read it with this same tokenizer
          const r = lex(src, j + 2, base, lineOf, true);
          inner.push(...r.toks); quasis.push(''); j = r.end + 1; continue;
        }
        quasis[quasis.length - 1] += src[j++];
      }
      toks.push({ type: 'tpl', text: quasis.map(decode).join('\u0001'), line });
      toks.push(...inner);
      i = j + 1; continue;
    }
    if (c === '/') { // a regex literal unless it follows something that ends an expression
      const p = last();
      if (!p || (p.type === 'punct' && !/^[)\]}]$/.test(p.text)) || (p.type === 'id' && /^(return|typeof|case|in|of)$/.test(p.text))) {
        let j = i + 1, cls = false;
        while (j < src.length && (src[j] !== '/' || cls)) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
        j++; while (/[a-z]/.test(src[j] || '')) j++;
        toks.push({ type: 'regex', text: src.slice(i, j), line }); i = j; continue;
      }
    }
    if (braced) { if (c === '{') depth++; else if (c === '}') { if (!depth) return { toks, end: i }; depth--; } }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 80));
    if (id) { toks.push({ type: 'id', text: id[0], line }); i += id[0].length; continue; }
    const num = /^\d[\w.]*/.exec(src.slice(i, i + 40));
    if (num) { toks.push({ type: 'num', text: num[0], line }); i += num[0].length; continue; }
    const op = /^(===|!==|==|!=|=>|&&|\|\||\?\?|\?\.|\.\.\.|<=|>=)/.exec(src.slice(i, i + 3));
    toks.push({ type: 'punct', text: op ? op[0] : c, line }); i += op ? op[0].length : 1;
  }
  return { toks, end: i };
}

// For every literal: the calls around it (innermost last) and which argument of each it is in; and the top-level
// function or const it sits in.
function annotate(toks) {
  const stack = [];
  let decl = '', depth0 = 0;
  toks.forEach((t, i) => {
    if (t.type === 'punct' && '([{'.includes(t.text)) {
      const p = toks[i - 1];
      stack.push({ name: t.text === '(' && p && p.type === 'id' && !/^(if|for|while|switch|catch|function|return|typeof|await)$/.test(p.text) ? p.text : '', arg: 0, open: t.text });
    } else if (t.type === 'punct' && ')]}'.includes(t.text)) stack.pop();
    else if (t.type === 'punct' && t.text === ',' && stack.length) stack.at(-1).arg++;
    // The name of a top-level declaration: const NAME = / function NAME( at brace depth 0.
    if (!stack.length && t.type === 'id' && /^(const|let|var|function)$/.test(t.text)) {
      const n = toks[i + 1]?.type === 'id' && toks[i + 1].text === 'function' ? toks[i + 2] : toks[i + 1];
      if (n?.type === 'id') decl = n.text;
    }
    t.calls = stack.filter(s => s.name).map(s => ({ name: s.name, arg: s.arg }));
    t.arrays = stack.filter(s => s.open === '[').length;
    t.decl = decl;
    t.prev = toks[i - 1]; t.prev2 = toks[i - 2]; t.next = toks[i + 1];
  });
  if (stack.length) throw new Error(`the scanner lost its place (${stack.length} brackets still open at the end): a new kind of syntax needs teaching to tokenize()`);
  return toks;
}

// ---------------------------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------------------------
const words = s => (s.replaceAll('\u0001', ' ').replace(/&#?\w+;/g, ' ').replace(/https?:\/\/\S+/g, ' ').match(/[A-Za-z]{2,}/g) || []);
const clean = s => COMPANY.reduce((a, c) => a.replaceAll(c, ''), s);
const SAFE = new Set(['L', 'x']); // the Spanish lookup: whatever sits in its arguments is the English key

// Text nodes and attribute values in a piece of markup. \u0001 stands for a ${...} substitution.
function markup(text) {
  const out = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/\b(aria-label|placeholder|title|alt)\s*=\s*"([^"]*)"/g)) out.push({ rule: 'C', text: m[2], what: m[1] });
  if (/<\w[^>]*>/.test(body)) for (const m of body.matchAll(/>([^<>]+)(?=<)/g)) out.push({ rule: 'D', text: m[1], what: 'text' });
  return out;
}

function scanSource(src, file = 'sample.mjs') {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const found = [];
  const add = (t, rule, text, what) => { text = clean(text.replaceAll('\u0001', '\u0001')).trim(); if (words(text).length) found.push({ file, line: t.line, decl: t.decl, rule, text: text.replaceAll('\u0001', '…'), what }); };

  let scripts = [[src, 0]];
  if (file.endsWith('.html')) { // scripts get tokenized; the rest is markup
    scripts = [];
    let rest = '';
    let at = 0;
    for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      rest += src.slice(at, m.index); at = m.index + m[0].length;
      scripts.push([m[1], m.index + m[0].indexOf(m[1])]);
    }
    rest += src.slice(at);
    for (const m of markup(rest.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<head>[\s\S]*?<\/head>/, h => h.replace(/<meta[^>]*>|<link[^>]*>/g, ''))))
      add({ line: 1, decl: '' }, m.rule, m.text, m.what);
  }
  for (const [code, base] of scripts) {
    const toks = annotate(tokenize(code, base, lineOf));
    for (const t of toks) {
      if (t.type !== 'str' && t.type !== 'tpl') continue;
      if (t.calls.some(c => SAFE.has(c.name))) continue;
      if (/^(===|!==|==|!=)$/.test(t.prev?.text) || /^(===|!==|==|!=)$/.test(t.next?.text)) continue; // compared with, not shown
      if (t.next?.text === ':' && /^[{,]$/.test(t.prev?.text || '{')) continue; // an object key, e.g. the server's English replies that folderSays() maps to L(...)
      if (t.calls.some(c => c.name === 'Error')) continue; // thrown and caught; the places that show one wrap it in L() (the audit catches the rest)
      const text = t.text;
      const inner = t.calls.at(-1);
      // C and D: markup inside the string
      const isMarkup = /<\w[^>]*>/.test(text);
      if (isMarkup) { for (const m of markup(text)) add(t, m.rule, m.text, m.what); }
      // A and B: the argument is the text
      const hit = t.calls.slice().reverse().find(c => (c.name === 'field' && c.arg === 0) || (c.name === 'toast' && c.arg === 0) || (c.name === 'ask' && c.arg <= 1));
      if (hit && !isMarkup) { add(t, hit.name === 'field' ? 'A' : 'B', text, `${hit.name}(...)`); continue; }
      if (t.type === 'tpl' && !isMarkup && !text.includes('\u0001')) { /* plain template string: falls through to E */ }
      // C: setAttribute('aria-label', '...') and a field's ph: '...'
      if (inner?.name === 'setAttribute' && inner.arg === 1 && /^(aria-label|placeholder|title|alt)$/.test(t.prev2?.text || '')) { add(t, 'C', text, 'setAttribute'); continue; }
      if (t.prev?.text === ':' && /^(ph|placeholder)$/.test(t.prev2?.text || '')) { add(t, 'A', text, 'ph:'); continue; }
      if (t.prev?.text === ':' && t.prev2?.text === 'title' && t.calls.some(c => c.name === 'sendSheet')) { add(t, 'B', text, 'sendSheet title:'); continue; }
      // E: a sentence-like literal anywhere else (not markup, not a selector or key)
      if (!isMarkup && words(text).length >= 2 && /^[^a-z]*[A-Z]/.test(text.replaceAll('\u0001', '')) && !/[<>{}[\]=#]/.test(text) && !/^[A-Z][A-Z0-9 ]+$/.test(text)) add(t, 'E', text, 'literal');
    }
  }
  return found;
}

// Every literal key passed to L(...) or x(...): the English text that must have a Spanish twin in es.mjs.
function keysOf(src, file = 'sample.mjs') {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const scripts = file.endsWith('.html') ? [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => [m[1], m.index + m[0].indexOf(m[1])]) : [[src, 0]];
  const keys = [];
  for (const [code, base] of scripts) for (const t of annotate(tokenize(code, base, lineOf))) {
    if ((t.type !== 'str' && t.type !== 'tpl') || t.text.includes('\u0001')) continue;
    const c = t.calls.at(-1);
    if (c && SAFE.has(c.name) && c.arg === 0) keys.push({ file, line: t.line, key: t.text });
  }
  return keys;
}
const DATA_KEYS = ['Complete', 'Partial', 'Blocked', 'Accepted', 'Follow-up needed', 'Superintendent', 'Project manager']; // looked up from data: L(t.status), L(role)

function excused(f) {
  let hit = false;
  ALLOW.forEach((a, i) => {
    if ((a.file && a.file !== f.file) || (a.decl && a.decl !== f.decl) || (a.rule && a.rule !== f.rule)) return;
    if (a.text && !(a.text instanceof RegExp ? a.text.test(f.text) : f.text.includes(a.text))) return;
    used.add(i); hit = true;
  });
  return hit;
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------
const all = ROOT ? FILES.flatMap(f => scanSource(fs.readFileSync(path.join(ROOT, f), 'utf8'), f)) : [];
const bad = all.filter(f => !excused(f));
if (process.env.LINT_VERBOSE) for (const f of all.filter(f => !bad.includes(f))) console.log('excused:', `${f.file}:${f.line} [${f.rule}] ${f.decl}: ${JSON.stringify(f.text)}`);
const show = f => `${f.file}:${f.line} [${f.rule}] ${f.what}${f.decl ? ` in ${f.decl}` : ''}: ${JSON.stringify(f.text)}`;
const RULES = { A: "field('Label') and ph: 'Literal'", B: "toast('...'), ask('...', 'Yes') and a share sheet's title:", C: 'aria-label, placeholder, title and alt written in English', D: 'English text between HTML tags', E: 'other sentence-like English literals outside L()' };

test('the app files to check are found', () => assert.ok(ROOT, 'set ROOT to the docs/schwab folder'));
for (const [rule, what] of Object.entries(RULES)) {
  test(`no hard-coded English: ${what}`, () => {
    const mine = bad.filter(f => f.rule === rule);
    assert.equal(mine.length, 0, `\n${mine.length} hard-coded English strings; wrap each in L('...') and add it to es.mjs:\n  ${mine.map(show).join('\n  ')}`);
  });
}
test('every L() phrase has a Spanish version with the same placeholders', async () => {
  const ES = (await import(require('url').pathToFileURL(path.join(ROOT, 'es.mjs')).href)).default;
  const keys = FILES.flatMap(f => keysOf(fs.readFileSync(path.join(ROOT, f), 'utf8'), f)).concat(DATA_KEYS.map(key => ({ file: 'data', line: 0, key })));
  const holes = t => (t.match(/\{\w+\}/g) || []).sort().join(' ');
  const missing = keys.filter(k => !Object.hasOwn(ES, k.key));
  const skewed = keys.filter(k => Object.hasOwn(ES, k.key) && holes(ES[k.key]) !== holes(k.key));
  const lines = [...new Map(missing.map(k => [k.key, k])).values()].map(k => `${k.file}:${k.line} missing in es.mjs: ${JSON.stringify(k.key)}`)
    .concat([...new Map(skewed.map(k => [k.key, k])).values()].map(k => `${k.file}:${k.line} placeholders differ: ${JSON.stringify(k.key)}`));
  assert.equal(lines.length, 0, `\n${lines.length} phrases need a Spanish entry in es.mjs:\n  ${lines.join('\n  ')}`);
});
test('every exception in the list still matches something', () => {
  const stale = ALLOW.filter((_, i) => !used.has(i));
  assert.equal(stale.length, 0, `stale exceptions (remove them):\n  ${stale.map(a => `${a.why} ${JSON.stringify(a)}`).join('\n  ')}`);
});

test('the detector flags English outside L() and passes L(), on samples', () => {
  const scan = src => scanSource(src).map(f => f.rule);
  assert.deepEqual(scan("const a = field('Floor', 'x', 1);"), ['A']);
  assert.deepEqual(scan("const a = field(L('Floor'), 'x', 1, { ph: 'e.g. Level 3' });"), ['A']);
  assert.deepEqual(scan("const a = field(L('Floor'), 'x', 1, { ph: L('e.g. Level 3') });"), []);
  assert.deepEqual(scan("toast('Saved on this phone');"), ['B']);
  assert.deepEqual(scan("toast(ok ? L('Saved') : 'Not saved at all', 'bad');"), ['B']);
  assert.deepEqual(scan("toast(L('Saved on this phone'), 'bad');"), []);
  assert.deepEqual(scan("ask('Delete this sheet?', 'Delete', 'danger');"), ['B', 'B']);
  assert.deepEqual(scan("ask(L('Delete this sheet?'), L('Delete'), 'danger');"), []);
  assert.deepEqual(scan('const h = `<button aria-label="Close">x</button>`;'), ['C']);
  assert.deepEqual(scan('const h = `<button aria-label="${L(\'Close\')}">x</button>`;'), []);
  assert.deepEqual(scan('const h = `<input placeholder="Type your name">`;'), ['C']);
  assert.deepEqual(scan('const h = `<h3>Open a link</h3><p>${L(\'Hint text here\')}</p>`;'), ['D']);
  assert.deepEqual(scan('const h = `<h3>${L(\'Open a link\')}</h3><b>${n}</b> <i>1</i>`;'), []);
  assert.deepEqual(scan("el.setAttribute('aria-label', 'Close this');"), ['C']);
  assert.deepEqual(scan("el.setAttribute('aria-label', L('Close this'));"), []);
  assert.deepEqual(scan("menu([['dup', 'Duplicate for another crew']]);"), ['E']);
  assert.deepEqual(scan("menu([['dup', L('Duplicate for another crew')]]);"), []);
  assert.deepEqual(scan("const k = 'good', cls = 'sheet-in', s = 'dialog[open] .sheet-in', r = /[\"']/g;"), [], 'class names, selectors and regexes are not prose');
  assert.deepEqual(scan('const x = `H.A. Sack-Electrical`; const y = "Sack Company-Electrical";'), [], 'company names are fine');
  assert.deepEqual(scan("sendSheet({ title: 'Task for the crew', url, text });"), ['B']);
  assert.deepEqual(scan("const m = { 'Wrong site code': L('Wrong site code') }; if (mode === 'change plan') x = 1; throw new Error('Link is too large');"), [], 'object keys, comparisons and thrown errors are not screen text');
  assert.deepEqual(keysOf("toast(L('a b')); x('c d'); L(ok ? '1 x' : 'n y', { n: 'zz' }); L(v); const o = `${L('e f')}`;").map(k => k.key), ['a b', 'c d', '1 x', 'n y', 'e f'], 'the keys that need Spanish');
  assert.deepEqual(scan('// toast(\'Not code\')\n/* field(\'No\') */ const a = 1;'), [], 'comments are skipped');
  assert.deepEqual(scan("const a = `${field('Inside a template', 'k', 1)}`;"), ['A'], 'code inside ${...} is scanned');
});

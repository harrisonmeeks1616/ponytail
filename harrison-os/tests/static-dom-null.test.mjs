// The DOM's own append/prepend/replaceChildren/before/after turn a null child into the text "null" (seen live:
// "null" under form labels). Optional children must go through h()/appendKids, which skip null. This scans the
// UI sources for a native insert whose top-level argument can be null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../public/', import.meta.url);
const files = ['app.js', ...readdirSync(new URL('views/', root)).filter((f) => f.endsWith('.js')).map((f) => `views/${f}`)];

function offenders(src) {
  const out = [];
  const re = /(?<![A-Za-z_$])[A-Za-z_$][\w$.]*\.(append|prepend|replaceChildren|before|after)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    let top = '';
    while (depth && i < src.length) {
      const c = src[i++];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (depth === 1) top += c;
    }
    if (/:\s*null\b|\?\?\s*null\b|&&\s*h\(/.test(top)) out.push(src.slice(0, m.index).split('\n').length);
  }
  return out;
}

test('no native DOM insert receives a possibly-null child', () => {
  const found = files.flatMap((f) => offenders(readFileSync(new URL(f, root), 'utf8')).map((line) => `public/${f}:${line}`));
  assert.deepEqual(found, []);
});

test('the scan catches the shapes that printed "null"', () => {
  assert.deepEqual(offenders("form.append(h('label'), hintId ? h('p') : null, input);"), [1]);
  assert.deepEqual(offenders('body.replaceChildren(\n  a,\n  n ? b(n) : null,\n);'), [1]);
  assert.deepEqual(offenders("appendKids(form, [x ? h('p') : null]); node.append(h('li', null, a ? b : null));"), []);
});

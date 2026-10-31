// T1b: reduced motion must stop every animation, including the completion pop on .check::before.
// `*` does not match pseudo-elements, so the reduce block has to name ::before and ::after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('reduced-motion rule covers pseudo-elements wherever an animation runs on one', () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*([^{]+)\{([^}]*)\}/);
  assert.ok(block, 'reduced-motion block exists');
  const selectors = block[1].split(',').map((s) => s.trim());
  assert.match(block[2], /animation:\s*none !important/);
  assert.match(block[2], /transition:\s*none !important/);
  const animated = [...css.matchAll(/([^{}]+)\{[^}]*\banimation\s*:\s*(?!none)[^;]+;/g)].map((m) => m[1].trim());
  assert.ok(animated.length > 0, 'expected at least the completion animation');
  for (const sel of animated) {
    for (const pseudo of ['::before', '::after']) {
      if (sel.includes(pseudo)) assert.ok(selectors.includes(`*${pseudo}`), `${sel} animates ${pseudo} but reduce block lacks *${pseudo}`);
    }
  }
});

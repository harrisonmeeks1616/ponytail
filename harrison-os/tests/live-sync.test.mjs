import test from 'node:test';
import assert from 'node:assert/strict';
import { createLivePull } from '../public/live-sync.js';

function fixture() {
  let version = 'one', key = 'tasks:work', busy = false, generation = 0, reads = 0, renders = 0, waiting = false;
  let render = async guard => { assert.equal(guard(), true); renders++; return true; };
  const pull = createLivePull({ readVersion: async () => { reads++; return version; }, viewKey: () => key,
    blocked: () => busy, epoch: () => generation, refresh: guard => render(guard), pending: value => { waiting = value; } });
  return { pull, version: v => { version = v; }, view: v => { key = v; }, busy: v => { busy = v; },
    type: () => { generation++; }, render: fn => { render = fn; }, counts: () => ({ reads, renders, waiting }) };
}

test('unchanged versions avoid expensive content reloads; view/scope changes are checked separately', async () => {
  const f = fixture();
  assert.equal(await f.pull.poll(), true); await f.pull.poll();
  assert.deepEqual(f.counts(), { reads: 2, renders: 1, waiting: false });
  f.version('two'); await f.pull.poll(); f.view('projects:personal'); await f.pull.poll();
  assert.equal(f.counts().renders, 3);
});

test('an open editor defers refresh and does not swallow the new version', async () => {
  const f = fixture(); f.busy(true);
  assert.equal(await f.pull.poll(), false); assert.equal(f.counts().waiting, true);
  f.busy(false); assert.equal(await f.pull.poll(), true); assert.equal(f.counts().renders, 1);
});

test('typing or navigating DURING the fetch prevents a stale commit and is retried', async () => {
  for (const race of ['typing','navigation','failure']) {
    const f = fixture(); let commits = 0;
    f.render(async guard => {
      if (race === 'typing') f.type();
      if (race === 'navigation') f.view('memory:work');
      if (race === 'failure') return false;
      if (!guard()) return false;
      commits++; return true;
    });
    assert.equal(await f.pull.poll(), false); assert.equal(commits, 0);
    f.render(async guard => { if (guard()) commits++; return true; });
    assert.equal(await f.pull.poll(), true); assert.equal(commits, 1);
  }
});

test('polls share one in-flight check and recover after a failed read', async () => {
  let resolve, reads = 0, fail = true;
  const pull = createLivePull({ readVersion: () => { reads++; if (fail) throw new Error('offline'); return new Promise(r => { resolve = r; }); },
    viewKey: () => 'tasks:work', blocked: () => false, epoch: () => 0, refresh: async () => true });
  assert.equal(await pull.poll(),false); fail = false;
  const a = pull.poll(), b = pull.poll(); assert.equal(a,b); resolve('v2'); assert.equal(await a,true); assert.equal(reads,2);
});

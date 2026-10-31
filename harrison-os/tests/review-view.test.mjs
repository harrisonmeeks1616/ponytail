// Weekly review screen (public/views/weekly.js) driven with a fake kit: date-only values stay date-only,
// and a "Not this week" answer is described as what the server actually did. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { register, deferWords } from '../public/views/weekly.js';

// Minimal kit: h() builds plain nodes; formatOn/formatAt tag their output so the test sees which ran.
function fakeKit(review, deferAnswer) {
  const toasts = [];
  const node = (tag, props, kids) => ({
    tag,
    props: props || {},
    kids,
    closest: () => null,
    append(...k) { this.kids.push(...k); },
    get childNodes() { return this.kids; },
  });
  const kit = {
    h: (tag, props, ...kids) => node(tag, props, kids.flat(Infinity).filter((k) => k != null && k !== false)),
    api: async (path) => ({ ok: true, data: path.startsWith('/api/review/weekly/defer') ? deferAnswer : review }),
    state: { scope: 'work' },
    section: (title, n) => node('section', { title }, [n]),
    chip: () => null,
    scopeChip: () => null,
    sampleChip: () => null,
    statusChip: () => null,
    noticeBlock: () => null,
    showToast: (m) => toasts.push(m),
    showNotice: () => {},
    guarded: (_b, fn) => fn(),
    failWords: () => '',
    formatOn: (s) => `ON(${s})`,
    formatAt: (s) => `AT(${s})`,
    excerpt: (s) => s,
    enc: encodeURIComponent,
    qs: (o) => new URLSearchParams(o).toString(),
    plural: (n, a, b) => `${n} ${n === 1 ? a : b}`,
    deviceTimeZone: () => 'America/New_York',
    reloadCurrent: () => {},
    sourceWords: () => null,
    addTodayBlock: () => {},
    addRoute: (name, def) => (kit.route = def),
  };
  register(kit);
  return { kit, toasts };
}

const texts = (n, out = []) => {
  if (typeof n === 'string') out.push(n);
  else if (n && typeof n === 'object') {
    if (n.props && typeof n.props.text === 'string') out.push(n.props.text);
    for (const k of n.kids || []) texts(k, out);
  }
  return out;
};
const find = (n, pred) => (n && typeof n === 'object' ? (n.props && pred(n) ? n : (n.kids || []).map((k) => find(k, pred)).find(Boolean)) : null);

function review(hard, decisions) {
  return {
    todayOn: '2026-10-29',
    next_monday: '2026-11-02',
    follow_up_by: '2026-11-08',
    idea_count: 0,
    sources: { calendar: 'included', pm: 'included' },
    status: { due: true },
    sections: {
      hard,
      follow_ups: [],
      completed: [],
      changes: { decisions, replies: [], captures: { sorted: 0, pending: 0 } },
      decisions,
      resume: [],
      quiet: [],
      ideas: [],
    },
  };
}

async function load(kit) {
  const body = { dataset: {}, querySelector: () => null, replaceChildren(...k) { this.kids = k; } };
  await kit.route.load({}, body);
  return body;
}

test('decision dates that are date-only (decided_on) are formatted as dates, not instants', async () => {
  const dec = { ref: 'item:d1', kind: 'decision', title: 'Use LED troffers', scope: 'work', sample: 1, date: '2026-10-28', claim_status: 'proposed' };
  const { kit } = fakeKit(review([], [dec]));
  const all = texts(await load(kit)).join('\n');
  assert.ok(all.includes('Recorded ON(2026-10-28)'));
  assert.ok(all.includes('ON(2026-10-28)'));
  assert.ok(!all.includes('AT(2026-10-28)'));
});

test('a review-only task deferral never claims the task moved', async () => {
  const task = { ref: 'item:t1', kind: 'task', title: 'Permit filing', scope: 'work', sample: 1, date: '2026-11-04', start_on: null, deferred_until: null };
  const { kit, toasts } = fakeKit(review([task], []), { applied: 'review_only', until: '2026-11-02', changeId: null });
  const body = await load(kit);
  const btn = find(body, (n) => n.tag === 'button' && n.props.text === 'Not this week');
  await btn.props.onclick({ currentTarget: btn });
  assert.deepEqual(toasts, ['Set aside in this review until ON(2026-11-02). It still shows on Today and in Tasks.']);

  // The reloaded row: set aside in the review only, so no "Shows from".
  const after = texts(await load(fakeKit(review([{ ...task, deferred_until: '2026-11-02', deferred_field: null }], [])).kit)).join('\n');
  assert.ok(!after.includes('Shows from'));
  assert.ok(after.includes('still on Today and in Tasks'));
  // When start_on really was written, the row says when it shows.
  const moved = texts(await load(fakeKit(review([{ ...task, start_on: '2026-11-02', deferred_until: '2026-11-02', deferred_field: 'start_on' }], [])).kit)).join('\n');
  assert.ok(moved.includes('Shows from ON(2026-11-02)'));
});

test('deferWords names only what changed', () => {
  assert.match(deferWords('start_on', 'task', 'Mon'), /^Shows from Mon\./);
  assert.equal(deferWords('follow_up_on', 'waiting', 'Mon'), 'Follow-up moved to Mon.');
  assert.match(deferWords('review_only', 'task', 'Mon'), /still shows on Today and in Tasks/);
  assert.equal(deferWords('review_only', 'project', 'Mon'), 'Hidden from this review until Mon. Nothing else changed.');
});

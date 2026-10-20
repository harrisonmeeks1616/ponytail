const test = require('node:test');
const assert = require('node:assert/strict');
const lib = import('../docs/schwab/shared.mjs');

test('a restored backup retains PDFs queued offline and retries them', async () => {
  const { queue, queued, backupData, restoreData, flush } = await lib;
  const store = new Map(), originalFetch = globalThis.fetch;
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  try {
    const item = { date: '2026-10-19', name: 'Fictional report', pdf: 'offline-pdf', v: 42 };
    queue(item);
    const backup = JSON.parse(JSON.stringify(backupData()));
    store.clear(); // Restore on a different phone.
    assert.equal(restoreData(backup), true);
    assert.equal(queued(), 1, 'pending PDFs survive phone replacement');
    let uploaded;
    globalThis.fetch = async (_, opts) => {
      uploaded = JSON.parse(opts.body);
      return { json: async () => ({ ok: true }) };
    };
    assert.deepEqual(await flush({ folderUrl: 'https://script.google.com/macros/s/TEST/exec' }), { left: 0, error: '' });
    for (const k of Object.keys(item)) assert.equal(uploaded[k], item[k]);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  }
});

test('a refused in-flight upload cannot put its obsolete copy behind a newer edit', async () => {
  const { queue, queued, flush } = await lib;
  const store = new Map(), originalFetch = globalThis.fetch;
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    const item = { date: '2026-10-19', name: 'Fictional report', pdf: 'old', v: 1 };
    queue(item);
    globalThis.fetch = async () => {
      queue({ ...item, pdf: 'new', v: 2 }); // Edit while the earlier POST is in flight.
      return { json: async () => ({ ok: false, error: 'Busy; try again shortly' }) };
    };
    const settings = { folderUrl: 'https://script.google.com/macros/s/TEST/exec' };
    await flush(settings);
    assert.equal(queued(), 1, 'only the latest edit remains pending');
    const sent = [];
    globalThis.fetch = async (_, opts) => {
      sent.push(JSON.parse(opts.body).pdf);
      return { json: async () => ({ ok: true }) };
    };
    await flush(settings);
    assert.deepEqual(sent, ['new']);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  }
});

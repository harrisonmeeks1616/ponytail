// A20 for the feature tables: export/restore of drafts, calendar, PM and weekly reviews. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.mjs';
import * as db from '../src/db.js';
import { exportFeatures, restoreFeatures, FEATURE_TABLES } from '../src/featuredata.js';

const T0 = '2026-10-29T12:00:00.000Z';
const CANARY = 'ZZ-FEATURE-PERSONAL-CANARY';
const SECRET = 'https://calendar.example.invalid/secret-feed-token.ics';

async function seed(d) {
  for (const scope of ['work', 'personal']) {
    const t = scope[0];
    const word = scope === 'personal' ? CANARY : 'work';
    await d.prepare(`INSERT INTO drafts (id, scope, kind, title, source_refs, body, generated_by, created_at, updated_at) VALUES (?, ?, 'email', ?, ?, ?, 'template', ?, ?)`)
      .bind(`draft-${t}-keep1`, scope, `${word} draft`, '[]', `${word} body`, T0, T0).run();
    await d.prepare(`INSERT INTO drafts (id, scope, kind, title, source_refs, body, generated_by, created_at, updated_at) VALUES (?, ?, 'email', ?, ?, ?, 'template', ?, ?)`)
      .bind(`draft-${t}-gone1`, scope, `${word} stale`, '["capture:cap-gone-0001"]', 'x', T0, T0).run();
    await d.prepare(`INSERT INTO calendar_connections (id, scope, label, kind, url, host, state, created_at) VALUES (?, ?, ?, 'ics_url', ?, 'calendar.example.invalid', 'ok', ?)`)
      .bind(`cal-${t}-url01`, scope, `${word} link`, SECRET, T0).run();
    await d.prepare(`INSERT INTO calendar_connections (id, scope, label, kind, state, created_at) VALUES (?, ?, ?, 'ics_import', 'ok', ?)`)
      .bind(`cal-${t}-imp01`, scope, `${word} import`, T0).run();
    await d.prepare(`INSERT INTO calendar_events (id, connection_id, scope, title, start_ms, end_ms, fetched_at) VALUES (?, ?, ?, ?, 1, 2, ?)`)
      .bind(`ev-${t}-0001`, `cal-${t}-imp01`, scope, `${word} appointment`, T0).run();
    await d.prepare(`INSERT INTO pm_sources (id, scope, label, kind, state, created_at) VALUES (?, ?, ?, 'import', 'ok', ?)`).bind(`pms-${t}-0001`, scope, `${word} pm`, T0).run();
    await d.prepare(`INSERT INTO pm_records (id, source_id, scope, provider_id, kind, title, imported_at) VALUES (?, ?, ?, 'p1', 'project', ?, ?)`)
      .bind(`pmr-${t}-0001`, `pms-${t}-0001`, scope, `${word} fit-out`, T0).run();
    await d.prepare(`INSERT INTO weekly_reviews (id, scope, week_of, selections, deferrals) VALUES (?, ?, '2026-10-26', ?, ?)`)
      .bind(`wk-${t}-0001`, scope, '["item:it-keep-0001","item:it-gone-0001"]', '[{"ref":"item:it-gone-0001","note":"later"},{"ref":"item:it-keep-0001","note":"x"}]').run();
  }
}
const asDoc = (tables) => JSON.parse(JSON.stringify({ format: 'harrison-os-export', version: 2, tables }));

test('export: every feature table, scope-filtered, feed URL never present', async () => {
  const a = createTestDb();
  await seed(a);
  const all = await exportFeatures(a, 'all');
  for (const t of FEATURE_TABLES) assert.equal(all[t].length >= 2, true, t);
  assert.ok(!JSON.stringify(all).includes('secret-feed-token'));
  const work = JSON.stringify(await exportFeatures(a, 'work'));
  assert.ok(!work.includes(CANARY), 'work export carries no personal text');
  assert.ok(work.includes('work appointment'));
});

test('round trip into a fresh database; second restore changes nothing; link calendars come back honestly unfetchable', async () => {
  const a = createTestDb();
  await seed(a);
  const doc = asDoc(await exportFeatures(a, 'all'));
  const b = createTestDb();
  const res = await restoreFeatures(b, doc, 'all');
  assert.equal(res.rejected, 0);
  assert.equal(res.skipped_deleted, 0);
  const back = await exportFeatures(b, 'all');
  // Same rows, except drafts citing nothing deleted here (no tombstone yet) and link calendars (state changed).
  assert.deepEqual(back.calendar_events, doc.tables.calendar_events);
  assert.deepEqual(back.pm_records, doc.tables.pm_records);
  const link = back.calendar_connections.find((c) => c.id === 'cal-w-url01');
  assert.equal(link.state, 'error');
  assert.equal(link.last_error_code, 'link_not_restored');
  assert.equal((await b.prepare('SELECT url FROM calendar_connections WHERE id = ?').bind('cal-w-url01').first()).url, null);
  const again = await restoreFeatures(b, doc, 'all');
  assert.deepEqual(again.inserted, {});
  assert.equal(again.rejected, 0);
});

test('restore skips drafts citing deleted records and scrubs deleted refs from weekly reviews', async () => {
  const a = createTestDb();
  await seed(a);
  const doc = asDoc(await exportFeatures(a, 'all'));
  const b = createTestDb();
  await b.prepare("INSERT INTO kv (key, value) VALUES ('deleted_capture:cap-gone-0001', '1'), ('deleted_item:it-gone-0001', '1')").run();
  const res = await restoreFeatures(b, doc, 'all');
  assert.equal(res.skipped_deleted, 2);
  assert.equal((await b.prepare("SELECT COUNT(*) AS n FROM drafts WHERE id LIKE '%gone1'").first()).n, 0);
  const wk = await b.prepare("SELECT selections, deferrals FROM weekly_reviews WHERE id = 'wk-w-0001'").first();
  assert.equal(wk.selections, '["item:it-keep-0001"]');
  assert.ok(!wk.deferrals.includes('it-gone-0001'));
  assert.ok(wk.deferrals.includes('it-keep-0001'));
});

test('restore refuses other-scope rows and orphans', async () => {
  const a = createTestDb();
  await seed(a);
  const doc = asDoc(await exportFeatures(a, 'personal'));
  const b = createTestDb();
  const intoWork = await restoreFeatures(b, doc, 'work');
  assert.deepEqual(intoWork.inserted, {});
  assert.ok(intoWork.rejected >= 8);
  assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM drafts').first()).n, 0);
  // An event whose connection is absent, and a PM record whose source is in the other scope.
  const orphan = asDoc({
    calendar_events: [{ ...doc.tables.calendar_events[0], connection_id: 'cal-nope-0001' }],
    pm_records: [doc.tables.pm_records[0]],
    pm_sources: [{ ...doc.tables.pm_sources[0], scope: 'work' }],
  });
  const res = await restoreFeatures(b, orphan, 'all');
  assert.equal(res.inserted.pm_sources, 1);
  assert.equal(res.inserted.calendar_events, undefined);
  assert.equal(res.inserted.pm_records, undefined);
  assert.equal(res.rejected, 2);
});

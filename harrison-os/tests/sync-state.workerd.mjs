// Optional real workerd/D1 transaction proof; no cloud, credentials, or real records.
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { withSyncState } from '../src/sync-state.js';
const mf = new Miniflare({ host:'127.0.0.1',port:0,cf:false,modules:true,
  script:'export default {fetch(){return new Response("fixture")}}', d1Databases:{DB:'sync-state-fixture'} });
try {
  const raw = await mf.getD1Database('DB');
  await raw.batch([
    raw.prepare('CREATE TABLE items(id TEXT PRIMARY KEY, title TEXT NOT NULL)'),
    raw.prepare('CREATE TABLE sync_state(id INTEGER PRIMARY KEY, version TEXT NOT NULL)'),
    raw.prepare("INSERT INTO sync_state VALUES (1,'initial')"),
  ]);
  const DB = withSyncState(raw);
  const version = () => DB.prepare('SELECT version FROM sync_state').first('version');
  const result = await DB.batch([
    DB.prepare("INSERT INTO items VALUES ('fixture','first') RETURNING id"),
    DB.prepare('SELECT changes() AS changed'),
  ]);
  assert.equal(result.length,2); assert.equal(result[0].meta.changes,1);
  assert.equal(result[0].results[0].id,'fixture'); assert.equal(result[1].results[0].changed,1);
  const before = await version(); assert.match(before,/^[0-9a-f]{32}$/);
  const noop = await DB.prepare("UPDATE items SET title='absent' WHERE id='missing'").run();
  assert.equal(noop.meta.changes,0); assert.equal(await version(),before);
  await assert.rejects(DB.batch([
    DB.prepare("UPDATE items SET title='must-roll-back' WHERE id='fixture'"),
    DB.prepare("INSERT INTO items VALUES ('fixture','duplicate')"),
  ]));
  assert.equal(await version(),before); assert.equal(await DB.prepare('SELECT title FROM items').first('title'),'first');
  const single = await DB.prepare("UPDATE items SET title='second' WHERE id='fixture' RETURNING title").first();
  assert.deepEqual(single,{title:'second'}); assert.notEqual(await version(),before);
  console.log(JSON.stringify({workerdSync:'passed',originalChangesPreserved:true,sqlChangesDependencyPreserved:true,
    noOpStable:true,atomicRollback:true,returningPreserved:true,cloudCalls:0}));
} finally { await mf.dispose(); }

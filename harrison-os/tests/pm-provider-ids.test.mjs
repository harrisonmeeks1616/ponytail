import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import * as pm from '../src/pm.js';

const NOW=Date.parse('2026-10-29T12:00:00.000Z');
const iso=new Date(NOW).toISOString();
function dto(name='Fixture',present=true){return {format:pm.FORMAT,version:1,source:{system:'Fictional PM',exported_at:iso,base_url:'https://fixture.example/'},projects:present?[{id:'provider-shared',name,status:'active',open_items:[{id:'provider-shared',title:'Fixture task',status:'open'}]}]:[]};}
function setup(t){
  const DB=createTestDb();t.after(()=>DB.close());
  const worker=createWorker({now:()=>NOW});
  const env={DB,BUILD_ID:'test',DEV_ALLOW_UNAUTH:'1',SPIKE_TEST_HOOKS:'0',ACCESS_TEAM_DOMAIN:'',ACCESS_AUD:''};
  const call=async(method,path,body)=>{const response=await worker.fetch(new Request('http://127.0.0.1:8899'+path,{method,headers:method==='GET'?{}:{'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:response.status,data:await response.json()};};
  const save=(scope,content,sourceId)=>call('POST','/api/pm/import',{scope,format:'json',content:JSON.stringify(content),...(sourceId?{source_id:sourceId}:{label:scope+' fixture'})});
  const records=(id)=>DB.prepare('SELECT kind,provider_id,id FROM pm_records WHERE source_id=? ORDER BY kind,provider_id').bind(id).all().then(r=>r.results);
  return {DB,call,save,records};
}

test('migration backfills legacy IDs without renaming existing citations',async(t)=>{
  const s=setup(t);
  await s.DB.exec('DROP TABLE pm_provider_ids;');
  await s.DB.prepare("INSERT INTO pm_sources(id,scope,label,kind,state,created_at) VALUES('legacy-source','work','Fixture','import','never',?)").bind(iso).run();
  await s.DB.prepare("INSERT INTO pm_records(id,source_id,scope,provider_id,kind,title,imported_at) VALUES('pmr_legacy_citation','legacy-source','work','provider-shared','project','Legacy',?)").bind(iso).run();
  await s.DB.exec(readFileSync(new URL('../migrations/0012_pm_provider_ids.sql',import.meta.url),'utf8'));
  assert.equal(await s.DB.prepare("SELECT record_id FROM pm_provider_ids WHERE source_id='legacy-source'").first('record_id'),'pmr_legacy_citation');
  assert.equal((await s.save('work',dto(),'legacy-source')).status,200);
  assert.equal((await s.records('legacy-source')).find(r=>r.kind==='project').id,'pmr_legacy_citation');
});

test('absence, close/reopen and restoration of a source snapshot keep the same canonical IDs',async(t)=>{
  const s=setup(t);
  const created=await s.save('work',dto());assert.equal(created.status,201);
  const id=created.data.source.id,original=await s.records(id);
  assert.equal(original.length,2);assert.notEqual(original[0].id,original[1].id,'project/item provider-ID namespaces differ');
  assert.equal((await s.save('work',dto('Absent',false),id)).status,200);
  assert.deepEqual(await s.records(id),[]);
  assert.equal(await s.DB.prepare('SELECT COUNT(*) AS n FROM pm_provider_ids WHERE source_id=?').bind(id).first('n'),2);
  assert.equal((await s.save('work',dto('Restored original snapshot'),id)).status,200);
  assert.deepEqual(await s.records(id),original);
  const closed=dto();closed.projects[0].open_items[0].status='closed';
  assert.equal((await s.save('work',closed,id)).status,200);
  assert.equal((await s.save('work',dto('Reopened'),id)).status,200);
  assert.deepEqual(await s.records(id),original);
  const columns=(await s.DB.prepare('PRAGMA table_info(pm_provider_ids)').all()).results.map(r=>r.name);
  assert.deepEqual(columns,['source_id','scope','kind','provider_id','record_id'],'map stores identities only, never source text');
});

test('source removal purges maps atomically; Work/Personal and separate sources remain isolated',async(t)=>{
  const s=setup(t);
  const work=(await s.save('work',dto('Work canary'))).data.source.id;
  const personal=(await s.save('personal',dto('Personal canary'))).data.source.id;
  const workIds=await s.records(work),personalIds=await s.records(personal);
  assert.notDeepEqual(workIds.map(r=>r.id),personalIds.map(r=>r.id));
  assert.equal((await s.save('work',dto('Wrong-scope overwrite'),personal)).status,404);
  assert.equal((await s.call('DELETE',`/api/pm/sources/${work}?scope=personal`)).status,404);
  assert.deepEqual(await s.records(personal),personalIds);
  assert.equal((await s.call('DELETE',`/api/pm/sources/${work}?scope=work`)).status,200);
  assert.equal(await s.DB.prepare('SELECT COUNT(*) AS n FROM pm_provider_ids WHERE source_id=?').bind(work).first('n'),0);
  assert.deepEqual(await s.records(work),[]);
  assert.equal(await s.DB.prepare('SELECT COUNT(*) AS n FROM pm_provider_ids WHERE source_id=?').bind(personal).first('n'),2);
  const next=(await s.save('work',dto())).data.source.id;
  assert.notEqual(next,work,'deliberately removed source is a new source when added again');
  assert.notDeepEqual((await s.records(next)).map(r=>r.id),workIds.map(r=>r.id));
  const personalView=await s.call('GET','/api/pm/digest?scope=personal');
  assert.doesNotMatch(JSON.stringify(personalView.data),/Work canary|Wrong-scope overwrite/);
});

test('a failed replacement rolls back new identity mappings together with source rows',async(t)=>{
  const s=setup(t),source=(await s.save('work',dto())).data.source.id;
  const original=await s.records(source);
  await s.DB.exec("CREATE TRIGGER fail_fixture_copy BEFORE INSERT ON pm_records WHEN NEW.title='Fail fixture' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");
  const bad=dto();bad.projects[0].open_items.push({id:'brand-new-provider',title:'Fail fixture',status:'open'});
  await assert.rejects(pm.importInto(s.DB,{sourceId:source,scope:'work'},pm.normalizeDigest(bad,{nowMs:NOW}),iso),/fixture rollback/);
  assert.deepEqual(await s.records(source),original);
  assert.equal(await s.DB.prepare("SELECT COUNT(*) AS n FROM pm_provider_ids WHERE source_id=? AND provider_id='brand-new-provider'").bind(source).first('n'),0);
});

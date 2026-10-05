// Local mocked checks only. These do not authorize or exercise Google services.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'docs', 'schwab');
const source = fs.readFileSync(path.join(dir, 'review-folder.gs'), 'utf8');
const code = 'fictional-test-code-with-at-least-32-characters';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const body = overrides => ({ code, date: '2026-10-04', name: 'FICTIONAL Crew Test',
  v: 123, pdf: Buffer.from('%PDF-1.4\nFictional mock bytes\n%%EOF').toString('base64'), ...overrides });

function session(options = {}) {
  const changes = [];
  const state = { UPLOAD_CODE_SHA256: sha(code), RECORDS_FOLDER_ID: 'APP_UPLOAD_FOLDER', ...options.properties };
  let driveReads = 0;
  const context = {
    Date, JSON, Number, String, isNaN,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: name => state[name] || null,
      setProperties: values => Object.assign(state, values)
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algorithm, value) => Array.from(crypto.createHash('sha256')
        .update(typeof value === 'string' ? value : Buffer.from(value)).digest()),
      base64Decode: value => Array.from(Buffer.from(value, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name,
        getDataAsString: () => Buffer.from(bytes).toString('utf8') })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => options.busy !== true,
      releaseLock: () => changes.push({ type: 'unlock' }) }) },
    ContentService: { MimeType: { JSON: 'application/json' },
      createTextOutput: value => ({ value, setMimeType() { return this; } }) },
    Drive: { Files: {
      get: (id, params) => {
        driveReads++;
        assert.equal(id, 'APP_UPLOAD_FOLDER');
        if (options.noFolder) throw new Error('Private API detail');
        return { id, mimeType: 'application/vnd.google-apps.folder',
          capabilities: { canAddChildren: true } };
      },
      list: params => {
        driveReads++;
        if (params.q.includes("key='schwabDay'")) return { files: options.newDay ? [] : [{ id: 'APP_DAY_FOLDER' }] };
        if (options.duplicate) return { files: [{ id: 'PRIOR_APP_PDF', webViewLink: 'https://example.invalid/prior' }] };
        return { files: [] };
      },
      create: (metadata, blob, params) => {
        if (metadata.mimeType === 'application/pdf' && options.failCreate) throw new Error('Private upload detail');
        changes.push({ type: 'create', metadata, blob, params });
        return { id: metadata.mimeType === 'application/pdf' ? 'NEW_PDF' : metadata.parents ? 'APP_DAY_FOLDER' : 'APP_UPLOAD_FOLDER',
          webViewLink: 'https://example.invalid/new' };
      }
      // No remove/update/trash methods are available: destructive use fails the checks.
    } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    request: d => JSON.parse(context.doPost({ postData: { contents: typeof d === 'string' ? d : JSON.stringify(d) } }).value),
    changes, state, reads: () => driveReads,
    initialize: () => context.initializeOwnerUploadFolder()
  };
}

let passed = 0;
function check(label, fn) { fn(); passed++; console.log('PASS ' + label); }
check('missing configuration fails closed', () => {
  const s = session({ properties: { UPLOAD_CODE_SHA256: '' } });
  assert.equal(s.request(body()).ok, false); assert.equal(s.reads(), 0);
});
check('wrong code performs no Drive reads or writes', () => {
  const s = session(); assert.equal(s.request(body({ code: 'wrong' })).ok, false);
  assert.equal(s.reads(), 0); assert.equal(s.changes.length, 0);
});
check('malformed/oversized input performs no Drive writes', () => {
  for (const input of ['bad json', 'x'.repeat(6800001), []]) {
    const s = session(); assert.equal(s.request(input).ok, false); assert.equal(s.changes.length, 0);
  }
});
check('calendar date, PDF header, and version validation reject invalid input', () => {
  for (const change of [{ date: '2026-02-30' }, { date: "x' in parents" },
    { pdf: Buffer.from('hello').toString('base64') }, { pdf: '%%%=' }, { v: Infinity }, { v: -1 }, { v: '123' }]) {
    const s = session(); assert.equal(s.request(body(change)).ok, false); assert.equal(s.changes.length, 0);
  }
});
check('valid ping verifies fixed folder without writing', () => {
  const s = session(); const r = s.request(body({ ping: true }));
  assert.equal(r.ok, true); assert.equal(r.folderVerified, true); assert.equal(s.changes.length, 0);
});
check('inaccessible selected folder fails without exposing private error', () => {
  const s = session({ noFolder: true }); const r = s.request(body({ ping: true }));
  assert.equal(r.ok, false); assert.ok(!r.error.includes('Private')); assert.equal(s.changes.length, 0);
});
check('new date folder and PDF stay within fixed parent, without deleting existing files', () => {
  const s = session({ newDay: true }); assert.equal(s.request(body()).ok, true);
  const creates = s.changes.filter(x => x.type === 'create'); assert.equal(creates.length, 2);
  assert.equal(creates[0].metadata.parents[0], 'APP_UPLOAD_FOLDER');
  assert.equal(creates[1].metadata.parents[0], 'APP_DAY_FOLDER');
  assert.equal(creates[1].metadata.mimeType, 'application/pdf');
  assert.equal(creates[1].metadata.appProperties.recordVersion, '123');
});
check('repeat identical receipt returns prior link without another PDF', () => {
  const s = session({ duplicate: true }); const r = s.request(body());
  assert.equal(r.ok, true); assert.equal(r.duplicate, true);
  assert.equal(s.changes.filter(x => x.type === 'create').length, 0);
});
check('PDF creation failure preserves earlier files and releases lock', () => {
  const s = session({ failCreate: true }); const r = s.request(body());
  assert.equal(r.ok, false); assert.deepEqual(s.changes, [{ type: 'unlock' }]);
});
check('daily cap prevents new date folders as well as PDF creation', () => {
  const s = session({ newDay: true, properties: {
    RATE_UTC_DAY: new Date().toISOString().slice(0, 10), RATE_COUNT: '300' } });
  assert.equal(s.request(body()).ok, false);
  assert.equal(s.changes.filter(x => x.type === 'create').length, 0);
});
check('manifest requests only drive.file and starts owner-only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/drive.file']);
  assert.equal(manifest.webapp.access, 'MYSELF');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
});
check('owner initializer creates and pins one app folder, and reuses it', () => {
  const s = session({ properties: { RECORDS_FOLDER_ID: '' } });
  assert.equal(s.initialize(), 'APP_UPLOAD_FOLDER');
  assert.equal(s.state.RECORDS_FOLDER_ID, 'APP_UPLOAD_FOLDER');
  assert.equal(s.initialize(), 'APP_UPLOAD_FOLDER');
  assert.equal(s.changes.filter(x => x.type === 'create').length, 1);
  assert.equal(s.changes.find(x => x.type === 'create').metadata.parents, undefined);
});
check('upload before owner folder initialization fails without writing', () => {
  const s = session({ properties: { RECORDS_FOLDER_ID: '' } });
  assert.equal(s.request(body()).ok, false);
  assert.equal(s.changes.filter(x => x.type === 'create').length, 0);
});
console.log(passed + ' local mocked checks passed; no Google services exercised.');

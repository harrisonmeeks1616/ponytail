// Optional review receiver; copying this source does not authorize or deploy it.
// Read README.md and copy appsscript.json before running anything in Apps Script.
// Advanced Drive v3 + explicit drive.file scope; no DriveApp calls.
// After owner approval of the exact manifest scope, run initializeOwnerUploadFolder
// in the private editor. It creates and pins a folder that this app can access.
// Move that folder into the existing Records folder using Drive's UI, then verify
// a private ping and fictional upload before approving anonymous deployment.
// Do not substitute an existing folder ID: drive.file needs a Picker grant for it.
const MAX_PDF_BYTES = 5000000;
const MAX_BODY_CHARS = 6800000;
const MAX_UPLOADS_PER_UTC_DAY = 300;

function initializeOwnerUploadFolder() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('RECORDS_FOLDER_ID')) return requireFolder_();
    const folder = Drive.Files.create({
      name: 'Schwab Field Uploads', mimeType: 'application/vnd.google-apps.folder'
    }, null, { fields: 'id' });
    props.setProperties({ RECORDS_FOLDER_ID: folder.id });
    return folder.id;
  } finally { lock.releaseLock(); }
}

function doGet() {
  return reply_({ ok: false, error: 'Use the field app upload action' });
}

function doPost(e) {
  let locked = false;
  let lock;
  try {
    const body = e && e.postData && e.postData.contents;
    if (typeof body !== 'string' || body.length > MAX_BODY_CHARS) {
      return reply_({ ok: false, error: 'Invalid request' });
    }
    const d = JSON.parse(body);
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return reply_({ ok: false, error: 'Invalid request' });
    }
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('UPLOAD_CODE_SHA256');
    if (!/^[a-f0-9]{64}$/.test(expected || '')) {
      return reply_({ ok: false, error: 'Upload integration not configured' });
    }
    if (typeof d.code !== 'string' || d.code.length < 32 || d.code.length > 128 ||
        !sameDigest_(digest_(d.code), expected)) {
      return reply_({ ok: false, error: 'Wrong site code' });
    }
    if (d.ping === true) {
      requireFolder_();
      return reply_({ ok: true, mode: 'append-only', folderVerified: true });
    }
    if (!validDate_(d.date) || typeof d.pdf !== 'string' ||
        d.pdf.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(d.pdf) || d.pdf.length % 4 !== 0) {
      return reply_({ ok: false, error: 'Invalid date or PDF' });
    }
    const pdf = Utilities.base64Decode(d.pdf);
    if (pdf.length < 5 || pdf.length > MAX_PDF_BYTES ||
        Utilities.newBlob(pdf.slice(0, 5)).getDataAsString() !== '%PDF-') {
      return reply_({ ok: false, error: 'Invalid date or PDF' });
    }
    const version = d.v === undefined ? 0 : d.v;
    if (!Number.isSafeInteger(version) || version < 0) {
      return reply_({ ok: false, error: 'Invalid record version' });
    }
    const name = String(d.name || 'Record').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .trim().slice(0, 100) || 'Record';
    const receipt = digest_(JSON.stringify([d.date, name, version, digest_(pdf)]));
    lock = LockService.getScriptLock();
    locked = lock.tryLock(20000);
    if (!locked) return reply_({ ok: false, error: 'Busy; try again shortly' });
    const root = requireFolder_();
    const now = new Date();
    const utcDay = now.toISOString().slice(0, 10);
    const lastDay = props.getProperty('RATE_UTC_DAY');
    const count = lastDay === utcDay ? Number(props.getProperty('RATE_COUNT') || 0) : 0;
    if (!Number.isSafeInteger(count) || count >= MAX_UPLOADS_PER_UTC_DAY) {
      return reply_({ ok: false, error: 'Daily upload limit reached; ask the owner' });
    }
    const day = dayFolder_(d.date, root);
    const existing = Drive.Files.list({
      q: "'" + day.id + "' in parents and trashed = false and appProperties has { key='schwabReceipt' and value='" + receipt + "' }",
      pageSize: 1,
      fields: 'files(id,webViewLink)'
    }).files || [];
    if (existing.length) {
      return reply_({ ok: true, duplicate: true, url: existing[0].webViewLink || '' });
    }
    // Reserve capacity before creation: a failed create never deletes an old file.
    props.setProperties({ RATE_UTC_DAY: utcDay, RATE_COUNT: String(count + 1) });
    const suffix = now.toISOString().replace(/[-:.]/g, '') + '-' + receipt.slice(0, 12);
    const fileName = name.replace(/\.pdf$/i, '') + '__' + suffix + '.pdf';
    const file = Drive.Files.create({
      name: fileName,
      mimeType: 'application/pdf',
      parents: [day.id],
      appProperties: { schwabReceipt: receipt, recordVersion: String(version) }
    }, Utilities.newBlob(pdf, 'application/pdf', fileName), { fields: 'id,webViewLink' });
    return reply_({ ok: true, url: file.webViewLink || '' });
  } catch (err) {
    // Never expose Drive/OAuth details or submitted personnel data in an error.
    return reply_({ ok: false, error: 'Upload failed; owner must review Drive setup' });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function requireFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('RECORDS_FOLDER_ID');
  if (!/^[\w-]+$/.test(id || '')) throw new Error('Upload folder not initialized');
  const folder = Drive.Files.get(id, {
    fields: 'id,mimeType,trashed,capabilities(canAddChildren)'
  });
  if (folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed ||
      !folder.capabilities || folder.capabilities.canAddChildren !== true) {
    throw new Error('Selected records folder cannot accept uploads');
  }
  return folder.id;
}

function dayFolder_(date, root) {
  const found = Drive.Files.list({
    q: "'" + root + "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='schwabDay' and value='" + date + "' }",
    pageSize: 2,
    fields: 'files(id),nextPageToken'
  });
  if ((found.files || []).length > 1 || found.nextPageToken) {
    throw new Error('Ambiguous app-created date folder');
  }
  if ((found.files || []).length) return found.files[0];
  return Drive.Files.create({
    name: date,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [root],
    appProperties: { schwabDay: date }
  }, null, { fields: 'id' });
}

function validDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function sameDigest_(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

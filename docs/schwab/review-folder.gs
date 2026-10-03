// Review folder for the Schwab field apps.
// Translates Spanish mode text with Google Translate, and files every finished task sheet and
// daily report as a PDF in your Google Drive:
//   Schwab Field Records / 2026-10-03 / T1003-01 Crew A Level 3.pdf
//   Schwab Field Records / 2026-10-03 / T1003-01 Crew A Level 3 (Español).pdf
//   Schwab Field Records / 2026-10-03 / Daily Report 2026-10-03.pdf
//
// Set up once (about 5 minutes, free):
// 1. Go to script.google.com, click New project, delete what's there and paste this whole file.
// 2. Change SITE_CODE below to a word only your team knows. Save.
// 3. Deploy > New deployment > gear icon > Web app.
//    Execute as: Me.  Who has access: Anyone.  Deploy, then allow access when Google asks.
// 4. Copy the Web app URL (ends in /exec). In either field app: Settings > Review folder,
//    paste the URL and the site code, tap Test the connection.
// 5. In Google Drive, share the "Schwab Field Records" folder with your superintendent.
//
// "Anyone" lets crew phones upload without Google accounts. Uploads without the site code are
// refused, and the link can only add PDFs to this one folder and translate text; it cannot read or delete anything.
// Already deployed an older copy? Paste this version, then Deploy > Manage deployments > edit > New version.

const SITE_CODE = 'change-me';
const ROOT = 'Schwab Field Records';

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.code !== SITE_CODE) return reply({ ok: false, error: 'Wrong site code' });
  if (d.ping) return reply({ ok: true });
  if (d.translate) return reply({ ok: true, out: translateAll(d.translate) });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // two phones saving at once must not create the same day's folder twice
  try {
    const pdf = Utilities.base64Decode(String(d.pdf || ''));
    const isPdf = Utilities.newBlob(pdf.slice(0, 5)).getDataAsString() === '%PDF-';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !isPdf || pdf.length > 5e6) return reply({ ok: false, error: 'Not a field app PDF' });
    const name = String(d.name || 'Record').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) + '.pdf';
    const day = folder(folder(DriveApp.getRootFolder(), ROOT), d.date);
    const mine = { v: Number(d.v) || 0, full: d.full !== false };
    const old = day.getFilesByName(name);
    while (old.hasNext()) {
      const f = old.next();
      let was = {};
      try { was = JSON.parse(f.getDescription() || '{}'); } catch (err) { /* filed by hand: replace it */ }
      // Keep the newer record; on a tie keep the fully translated one. A phone that sat offline can't roll the folder back.
      if ((was.v || 0) > mine.v || ((was.v || 0) === mine.v && was.full && !mine.full)) return reply({ ok: true, kept: 'a newer copy is already filed' });
      f.setTrashed(true); // the earlier copy stays in Drive's Trash for 30 days
    }
    const file = day.createFile(Utilities.newBlob(pdf, 'application/pdf', name));
    file.setDescription(JSON.stringify(mine));
    return reply({ ok: true, url: file.getUrl() });
  } finally {
    lock.releaseLock();
  }
}

// Spanish <-> English for Spanish mode. The source language is detected, so text already in the
// target language comes back unchanged. A text Google can't translate comes back as null and stays as written.
function translateAll(req) {
  const to = req.to === 'es' ? 'es' : 'en';
  const texts = Array.isArray(req.texts) ? req.texts.slice(0, 40) : [];
  return texts.map(text => {
    try { return LanguageApp.translate(String(text).slice(0, 4000), '', to, { contentType: 'text' }); } catch (err) { return null; }
  });
}

function folder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

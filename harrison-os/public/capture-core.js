// Capture persistence on this phone: the ordering rules that keep typed words and photos from being lost.
// No DOM: app.js passes the stores and reads the capture box through callbacks, so tests can drive the exact
// interleavings (slow IndexedDB at start, a write that fails while new typing is in the box, two tabs saving
// the same restored draft, a photo store that fills up half-way).

/** The words a capture is saved with: the typed text, or, for files alone, a plain line naming them. */
export function captureTextOf(boxText, files) {
  return String(boxText || '').trim() || (files.length ? `Attached: ${files.map((f) => f.name).join(', ')}` : '');
}

/** Same capture? An id may be reused only for identical words and scope (a retry), never for different content. */
export function sameCapture(existing, text, scope) {
  return !!existing && !!existing.body && existing.body.text === text && existing.body.scope === scope;
}

/**
 * Writes the draft only once the startup restore has finished, and reads the box only then: a restore that
 * merged the stored draft into new typing must not be overwritten by a snapshot taken before it ran.
 * read() -> { id, text, scope, files } is called after the waits; gen/currentGen skip a write a Save superseded.
 */
export async function writeDraftWhenReady({ storesReady, restored, gen, currentGen, read, key, onWritten = () => {} }) {
  const stores = await storesReady;
  await restored;
  if (gen !== currentGen()) return 'skipped';
  const { id, text, scope, files } = read();
  if (text.trim() === '' && !files.length) {
    await stores.drafts.del(key);
    return 'deleted';
  }
  const record = { id, text, scope, files, updated_at: new Date().toISOString() };
  await stores.drafts.put(key, record);
  onWritten(record);
  return 'written';
}

/**
 * Puts a capture in the outbox exactly once, with the store's atomic insert (add-if-absent), never a read
 * then a write: two tabs saving the same restored draft id at the same moment cannot both "find it free".
 * The loser compares: the same words and scope is a retry and reuses the row; different words (another tab's
 * capture) are stored under a fresh id, so neither text is lost. make(id) builds the outbox item.
 * Returns { item, status: 'stored' | 'same' | 'renamed' }.
 */
export async function putCaptureOnce(outbox, { id, text, scope }, make, freshId) {
  const item = make(id);
  if (await outbox.insert(item)) return { item, status: 'stored' };
  const existing = await outbox.get(id);
  if (sameCapture(existing, text, scope)) return { item: existing, status: 'same' };
  for (let i = 0; i < 3; i++) {
    const other = make(freshId());
    if (await outbox.insert(other)) return { item: other, status: 'renamed' };
  }
  throw new Error('no_free_capture_id');
}

/**
 * Stores each file for captureId, in order, with the atomic insert. A file id already stored is never
 * rebound: if it belongs to this capture (a retry) it counts as stored; if another capture got it first (two
 * tabs queueing the same draft's photo at once) it stays there and is reported in elsewhere with its real
 * binding. On the first failure the remaining files are returned in failed, untouched, so only those go back
 * to the box. make(file) builds the attachment item.
 * Returns { stored: item[], elsewhere: item[], failed: file[] }.
 */
export async function queueFiles(store, captureId, files, make) {
  const out = { stored: [], elsewhere: [], failed: [] };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const item = make(f);
      if (await store.insert(item)) {
        out.stored.push(item);
        continue;
      }
      const existing = await store.get(f.id);
      if (existing && existing.capture_id === captureId) out.stored.push(existing);
      else if (existing) out.elsewhere.push(existing);
      else throw new Error('vanished'); // deleted between the two steps: treat as not stored
    } catch {
      out.failed = files.slice(i);
      break;
    }
  }
  return out;
}

/**
 * After a failed save: what the box should hold. With an empty box the capture comes back as it was (same id,
 * so a retry stays idempotent). With new typing already there, both are kept: the earlier words first, the
 * new words after, the earlier files before the new ones (no duplicates), and the current draft id, because
 * the failed id was never stored.
 */
export function mergeBack({ boxText, draftId, sheetFiles }, failed) {
  const files = mergeFiles(failed.files, sheetFiles);
  if (boxText.trim() === '') return { text: failed.text, draftId: failed.id, files, merged: false };
  return { text: `${failed.text}\n${boxText}`, draftId, files, merged: true };
}

/** first, then the rest of then: one entry per file id. */
export function mergeFiles(first, then) {
  const seen = new Set();
  return first.concat(then).filter((f) => f && !seen.has(f.id) && seen.add(f.id));
}

/** The draft files that never reached photo storage (by id). */
export async function unstoredFiles(store, files) {
  const out = [];
  for (const f of files) if (!(await store.get(f.id))) out.push(f);
  return out;
}

/**
 * Is this stored draft the one a Save consumed? Only if it has the saved capture's id and either holds the
 * saved words and scope, or is exactly the last draft this tab itself wrote (ownLast: { updated_at, text }),
 * which may be a few keystrokes behind the saved words. A draft another tab wrote under the same id matches
 * neither, so it is kept. saved: { id, text, scope }.
 */
export function draftConsumedBy(draft, saved, ownLast) {
  if (!draft || draft.id !== saved.id) return false;
  if (captureTextOf(draft.text, Array.isArray(draft.files) ? draft.files : []) === saved.text && draft.scope === saved.scope) return true;
  return !!ownLast && draft.updated_at === ownLast.updated_at && draft.text === ownLast.text;
}

/**
 * Resolves with the promise's value, or rejects with Error('storage_timeout') after ms: storage that never
 * answers (an IndexedDB open or transaction that hangs) must turn into a visible failure, not a silent wait.
 */
export function settleWithin(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('storage_timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

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
export async function writeDraftWhenReady({ storesReady, restored, gen, currentGen, read, key }) {
  const stores = await storesReady;
  await restored;
  if (gen !== currentGen()) return 'skipped';
  const { id, text, scope, files } = read();
  if (text.trim() === '' && !files.length) {
    await stores.drafts.del(key);
    return 'deleted';
  }
  await stores.drafts.put(key, { id, text, scope, files, updated_at: new Date().toISOString() });
  return 'written';
}

/**
 * Puts a capture in the outbox exactly once. An existing row with the same words and scope is a retry and is
 * reused; one with different words (another tab saved the same restored draft) is left alone and this capture
 * is stored under a fresh id, so neither text is lost. make(id) builds the outbox item.
 * Returns { item, status: 'stored' | 'same' | 'renamed' }.
 */
export async function putCaptureOnce(outbox, { id, text, scope }, make, freshId) {
  const existing = await outbox.get(id);
  if (!existing) {
    const item = make(id);
    await outbox.put(item);
    return { item, status: 'stored' };
  }
  if (sameCapture(existing, text, scope)) return { item: existing, status: 'same' };
  const nid = freshId();
  const item = make(nid);
  await outbox.put(item);
  return { item, status: 'renamed' };
}

/**
 * Stores each file for captureId, in order. A file already stored is never rebound: if it belongs to this
 * capture it counts as stored, if it belongs to another capture it stays there (reported in elsewhere, with
 * its real binding). On the first failure the remaining files are returned in failed, untouched, so only
 * those go back to the box. make(file) builds the attachment item.
 * Returns { stored: item[], elsewhere: item[], failed: file[] }.
 */
export async function queueFiles(store, captureId, files, make) {
  const out = { stored: [], elsewhere: [], failed: [] };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const existing = await store.get(f.id);
      if (existing) {
        (existing.capture_id === captureId ? out.stored : out.elsewhere).push(existing);
        continue;
      }
      const item = make(f);
      await store.put(item);
      out.stored.push(item);
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

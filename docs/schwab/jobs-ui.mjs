import { jobScope, L, esc, toast, ask, download, restoreRecoveryData, today, sheet, recoveryPinAvailable, recoveryUnlocked, tryRecoveryPin, signOut } from './shared.mjs';

export function jobsView() {
  const jobs = jobScope.list(), blocked = jobScope.status();
  const restoreBlocked = blocked.startsWith('restore_');
  const changedCopy = blocked === 'restore_changed';
  const restoreMessage = changedCopy ? L('Another tab selected a different copy. Reload before working.') : L('An older tab changed this phone, or recovery could not be verified. Both copies are kept. Sync and edits are paused so nothing is overwritten.');
  let archives = 0;
  try { archives = jobScope.storage.listGenerations().length; } catch { /* the alert keeps invalid copies read-only */ }
  return `<div class="settings"><h3>${L('Jobs on this phone')}</h3>
    <p class="hint">${L('Each job keeps its own tasks, hours, reports and connection. Switching opens a fresh page.')}</p>
    ${restoreBlocked ? `<section role="alert"><h3>${L('Restore needs review')}</h3><p>${restoreMessage}</p><p><button class="btn" data-act="restore-reload">${L('Reload')}</button></p></section>` : blocked ? `<p role="alert">${L('Migration is paused. An old tab changed the Schwab data, or the copy did not finish. Close old tabs and reconcile before using this job.')}</p>` : ''}
    ${archives || restoreBlocked ? `<section><h3>${L('Retained restore copies')}</h3><p class="hint">${L('Download the original and restored copies for owner review. Returning to the original keeps the restored copy too.')}</p><p class="hint">${L('Recovery downloads include private phone data. Keep the file for owner review.')}</p>${recoveryUnlocked() ? `<p><button class="btn" data-act="restore-export">${L('Download recovery copies')}</button> <button class="btn" data-act="restore-original">${L('Reopen original data')}</button> <button class="btn" data-act="restore-lock">${L('Lock office and recovery')}</button></p>` : recoveryPinAvailable() ? `<p><button class="btn" data-act="restore-signin">${L('Office sign-in')}</button></p>` : `<p role="alert">${L('Recovery needs an existing office passcode. Ask the owner to recover the original passcode data. These copies stay on this phone.')}</p>`}</section>` : ''}
    <div class="list"><a class="row" href="${esc(jobScope.url(''))}">${L('Original Schwab (legacy)')}</a>${jobs.map(j => `<a class="row" href="${esc(jobScope.url(j.id))}"${j.id === jobScope.id ? ' aria-current="page"' : ''}><span class="row-main"><span class="row-title">${esc(j.label)}</span><small class="row-sub">${esc(j.id)}</small></span></a>`).join('')}</div>
    ${jobScope.pmUrl() ? `<p><a class="btn" href="${esc(jobScope.pmUrl())}" target="_blank" rel="noopener noreferrer">${L('PM records — Only you')}</a></p><p class="hint">${L('Opens Electrical PM sign-in. Private records stay there and are never stored in this field app.')}</p>` : ''}
    <h3>${L('Add or rename a job')}</h3><label>${L('Canonical job ID')}<input id="job-id" maxlength="80" autocomplete="off"></label>
    <label>${L('Job name')}<input id="job-label" maxlength="120" autocomplete="off"></label>
    <p class="hint">${L('Use the exact job ID from Electrical PM. A new job starts empty; connect its own scoped Hub key in Settings.')}</p>
    <p><button class="btn primary" data-act="job-add">${L('Save job and open')}</button></p>
    <h3>${L('Move this phone’s original Schwab data')}</h3>
    <p class="hint">${L('Close old Schwab tabs first. This copies and verifies local data, retains the originals, and binds them only to the original job ID entered above. It does not merge with an existing job.')}</p>
    <label><input id="job-original" type="checkbox">${L('I verified this is the original Schwab job ID')}</label>
    <p><button class="btn" data-act="job-migrate">${L('Verify and copy original data')}</button></p>
    <p class="hint">${L('If both copies changed, automatic reconciliation stops. Keep both copies and have the owner review them before continuing.')}</p>
    ${openShiftLinks()}
  </div>`;
}
export function openShiftLinks() {
  const shifts = jobScope.openShifts().filter(s => s.jobId !== jobScope.id);
  return shifts.length ? `<section class="set"><h3>${L('Open shifts in other jobs')}</h3>${shifts.map(s => `<a class="row" href="${esc(s.url)}"><span class="row-main"><span class="row-title">${esc(s.label || L('Original Schwab (legacy)'))}</span><span class="row-sub">${esc(s.date)} · ${L('Return to clock out')}</span></span></a>`).join('')}</section>` : '';
}
export function jobsAct(action) {
  if (action === 'restore-reload') { location.reload(); return true; }
  const redraw = () => { const app = document.getElementById('app'); if (app) app.innerHTML = jobsView(); };
  if (action === 'restore-signin') { recoverySignIn(redraw); return true; }
  if (action === 'restore-lock') { if (!signOut()) toast(L('Office screens are locked here, but this phone could not remember the lock. Close other app tabs and keep this phone private until it can save again.'), 'bad'); redraw(); return true; }
  if (['restore-export', 'restore-original'].includes(action) && !recoveryUnlocked()) { toast(L('Sign in with the existing office passcode to review recovery copies.'), 'bad'); return true; }
  if (action === 'restore-export') {
    try { const data = restoreRecoveryData(); download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `field-hub-recovery-${jobScope.id || 'original'}-${today()}.json`); }
    catch { toast(L('Recovery copies could not be exported. The copies on this phone are retained.'), 'bad'); }
    return true;
  }
  if (action === 'restore-original') {
    void (async () => {
      if (!await ask(L('Reopen the data from before this restore? The restored copy will still be retained.'), L('Reopen original data'))) return;
      if (!recoveryUnlocked()) { toast(L('Sign in with the existing office passcode to review recovery copies.'), 'bad'); redraw(); return; }
      if (jobScope.storage.returnToParent()) location.reload();
      else toast(L('The original copy could not be selected. All copies are retained for review.'), 'bad');
    })();
    return true;
  }
  if (!['job-add', 'job-migrate'].includes(action)) return false;
  const id = document.getElementById('job-id').value.trim(), label = document.getElementById('job-label').value.trim();
  try {
    if (action === 'job-migrate') jobScope.migrate(id, label, document.getElementById('job-original').checked);
    else jobScope.register(id, label);
    jobScope.switchTo(id);
  } catch (e) {
    const occupied = ['destination_not_empty', 'both_changed', 'original_already_bound'].includes(e.code);
    toast(occupied
      ? L('Copy stopped: the destination already has data or another original-job binding. Nothing was overwritten. Keep both copies for review.')
      : L('Copy or setup could not finish. Check the job ID, confirmation and free storage. Original data is retained.'), 'bad');
  }
  return true;
}

function recoverySignIn(redraw) {
  if (!recoveryPinAvailable()) { redraw(); return; }
  const d = sheet(`<h3>${L('Office sign-in')}</h3><p>${L('Enter the office passcode for this phone’s original private copy. A passcode imported by a later restore will not open it. Editing and syncing stay paused.')}</p><label>${L('Office passcode')}<input type="password" inputmode="numeric" maxlength="4" autocomplete="off" data-recovery-pin></label><p role="status" data-recovery-error></p><button class="btn primary" data-recovery-submit>${L('Office sign-in')}</button>`);
  const input = d.querySelector('[data-recovery-pin]'), error = d.querySelector('[data-recovery-error]'), button = d.querySelector('[data-recovery-submit]');
  const submit = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await tryRecoveryPin(input.value);
      input.value = '';
      if (result === 'ok') { d.close(); redraw(); return; }
      error.textContent = result === 'wait' ? L('Too many wrong codes. Try again in a minute.') : result === 'wrong' ? L('Wrong passcode. Try again.') : L('Recovery sign-in could not be verified. All copies remain on this phone.');
    } catch { error.textContent = L('Recovery sign-in could not be verified. All copies remain on this phone.'); }
    finally { button.disabled = false; }
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
  input.focus();
}

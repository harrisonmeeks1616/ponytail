import { jobScope, L, esc, toast } from './shared.mjs';

export function jobsView() {
  const jobs = jobScope.list(), blocked = jobScope.status();
  return `<div class="settings"><h3>${L('Jobs on this phone')}</h3>
    <p class="hint">${L('Each job keeps its own tasks, hours, reports and connection. Switching opens a fresh page.')}</p>
    ${blocked ? `<p role="alert">${L('Migration is paused. An old tab changed the Schwab data, or the copy did not finish. Close old tabs and reconcile before using this job.')}</p>` : ''}
    <div class="list"><a class="row" href="${esc(jobScope.url(''))}">${L('Original Schwab (legacy)')}</a>${jobs.map(j => `<a class="row" href="${esc(jobScope.url(j.id))}"${j.id === jobScope.id ? ' aria-current="page"' : ''}>${esc(j.label)}<small>${esc(j.id)}</small></a>`).join('')}</div>
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
  return shifts.length ? `<section class="set"><h3>${L('Open shifts in other jobs')}</h3>${shifts.map(s => `<a class="row" href="${esc(s.url)}">${esc(s.label || L('Original Schwab (legacy)'))} · ${esc(s.date)} · ${L('Return to clock out')}</a>`).join('')}</section>` : '';
}
export function jobsAct(action) {
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

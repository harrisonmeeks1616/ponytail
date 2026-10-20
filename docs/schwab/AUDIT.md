# Schwab field app code audit

Reviewed against Forge's polished checkpoint `1077d684eb3c69552f15496363b083dd8b4f67b4` on October 20, 2026. Changes are isolated on `codex/schwab-audit`. This is a review and repair checkpoint, not a release or Google deployment.

## Scope and method

The review covered every line of the 14 application, stylesheet, dictionary, service-worker, receiver, Hub and manifest files under `docs/schwab`, plus both setup guides. The reviewers traced callers and data ownership across the task, report, time-clock, identity, sync, upload and archive flows. Relevant Node tests, the Google stand-in, and browser suites were also inspected. The unrelated Ponytail plugin source was not part of the line-by-line app audit; its repository tests were run.

Forge supplied the current commit and confirmed that his remaining gates were read-only. His latest polish was preserved. All tests use isolated fictional records and local servers. No workforce records were transmitted, and no Google project, persistent credentials, permission grants, public access, merge or deployment was created.

The practical improvements support interrupted work on a phone: keep offline edits, make a backup useful after a lost phone, preserve retryable PDFs, prevent accidental time entries, keep people distinct, and retain the place reached with the keyboard. They add no dependency, schema migration, new service or speculative dashboard.

## Confirmed defects repaired

| Trigger and impact | Repair | Regression evidence |
| --- | --- | --- |
| Tap task Stop before Start, then Start one minute later: nearly 24 hours can be counted. | Disable and guard the out-of-order Stop; normal and manually entered overnight periods remain valid. | `schwab-task-timer.test.js` |
| Back up a phone with offline PDFs and restore elsewhere: the pending upload queue was omitted. | Include the queue in backup and restore. Existing hub-key redaction remains. | `schwab-backup-queue.test.js` |
| Queue storage fails while filing a task or report: the record was marked filed and automatic retry could be skipped. | Mark only the captured record version after queue acceptance; preserve newer edits and monotonic markers. | Both cases in `schwab-pdf-marker.test.js` |
| An old PDF POST is refused after a newer edit replaces it: the obsolete copy was requeued. | Requeue only a copy still present in the queue. | `schwab-backup-queue.test.js` |
| The final allowed daily upload succeeds but its reply is lost: retry was rejected at the daily cap. | Acknowledge existing receipts before checking capacity; new uploads and new date folders remain capped. | `schwab-review-folder.test.js` |
| A PM corrects or removes their own shift, including before first sync: the timesheet edit was treated as an unchanged clock copy. | Distinguish explicit corrections from own-device punches. | Three own-hours cases in `schwab-sync.test.js` |
| A PM undoes removal of their own otherwise unedited shift: the server classified the restoration as a worker punch. | Honor the explicit PM timestamp; stale worker streams and other roles cannot restore the shift. | `schwab-hub.test.js` and `schwab-sync.test.js` |
| A required pull follows a role change while based offline task/report/settings edits are waiting: a newer remote part replaced unrelated local work. | Retain dirty parts with a known base until the server merges their changed fields. | Task and report/settings cases in `schwab-sync.test.js` |
| Settings says Project manager while the actual connected key is superintendent/crew: local PM answers and manually entered hours appeared editable but could not sync. | Enforce the connected role for PM answers, timesheet input/actions/imports and delayed dialog saves. Show translated read-only warnings even when nothing is queued. PM-key and no-Hub workflows stay editable. | Actual-key report and hours cases in `schwab-sync.test.js`; role-warning case in `schwab-live.test.js` |
| A PM tablet opens a superintendent invite: refusal talks about a pasted PM key rather than explaining the wrong invite. | Identify the superintendent invite and direct the PM to the correct connection step; preserve the existing connection. | Invite-specific refusal in `schwab-sync.test.js` |
| Hours land but the derived weekly totals refresh fails: an identical retry left totals empty. | Persist a dirty marker and repair totals before another write. | `schwab-hub.test.js` |
| Archive copying completes but deletion/final metadata fails: stale phones could revive archived records. | Retain a completion receipt; finish deletion and archive horizons under the lock before accepting later writes. | Interrupted archive case in `schwab-hub.test.js` |
| Load older tasks/reports beyond 200: fetched records disappeared while the screen claimed everything was shown. | Render all explicitly loaded pages. | 201-task and 201-report cases in `schwab-live.test.js` |
| Two people with the same name have PM-added shifts: activity folding assigned both to one person/crew. | Fold only a known stable person identity; unknown identities remain separate. | Same-name and same-person cases in `schwab-live.test.js` |
| Edit translated text while an older response is pending: the old translation replaced the new preview and prevented its translation. | Ignore responses whose source text no longer matches. | Both completion orders in `schwab-live.test.js` |
| A partial app update refreshes only some cached files: old screens and a new dictionary can mix. | Cache complete release generations, wait for old tabs to close, and keep the eight retired Spanish phrases for v8 migration. | Real service-worker upgrade and offline browser tests |
| A Live summary focuses a task, then background sync redraws it: keyboard focus was lost before Enter. | Preserve the surviving task link's focus through a background redraw, without restoring it across a lock or route change. | Forced real-sync focus and Enter case in the board browser test |

## Validation

The new Node regressions were copied onto an isolated archive of `1077d68`: **248 tests ran, 230 existing tests passed and 18 new regression cases failed**. The original receiver script separately passed its 13 checks. The PM permission test was then strengthened to assert the unwanted data change before rendering; it fails for that semantic reason on the original checkpoint. Some multi-scenario tests stop at their first failing assertion on the baseline; the passing repaired run covers their later scenarios.

Forge's subsequent GATE3-01/SEC-01 and GATE3-03 findings exposed the remaining timesheet/warning paths and invite wording. Three additional Node cases fail semantically on `1077d68` and pass with the expanded guard. This makes **21 new Node regression cases demonstrated failing on the original checkpoint**; the original 18-case evidence and the three-case supplement are saved separately.

The full repository `npm test` passes **410 main tests, 23 extension tests and 3 MCP tests**. The initial Windows run selected a different `python3` without pandas; rerunning with the bundled Python/pandas runtime passes. No production change was made for that environment issue. Rule-copy and version-consistency checks also pass.

Browser results on the combined checkpoint:

| Suite | Result |
| --- | --- |
| Main field workflow | 110 checks pass |
| First open and input | 20 checks pass |
| Stale clock and overnight boundary | 15 checks pass |
| Spanish without Hub | 207 screen states, 9,169 strings, zero untranslated strings or failed steps |
| Spanish with local Hub | 279 screen states, 12,872 strings, zero untranslated strings or failed steps |
| Real service-worker offline use | Pass: cached entry points, task text, time, checklist and language survive offline reloads |
| Real service-worker release upgrades | Pass: partial legacy refresh, failed future install, complete cache contents, cache isolation, query/hash routes and all-tabs-close activation |
| Board and Quick Find | 58 and 47 checks pass, including focus and Enter through a real sync refresh |
| Drag-to-add | 37 checks pass after separating CDP drag and native tap scenarios with a real reload; see the touch-sequence limitation below |
| Six-phone Hub workflow | 247 checks pass, no page errors; final records agree across the Hub and phones |
| Expanded role guard and invite message | 41 English/Spanish browser checks pass, no page errors: role change, warnings, read-only controls, import refusal, worker clock, PM/no-Hub editing and wrong-invite wording |

The browser harness now requests UTF-8 explicitly from `pdftotext`, and waits for the new screen before checking first-open and Upcoming labels. These changes preserve the assertions while removing platform decoding and asynchronous navigation races.

One final Node run exposed a pre-existing probabilistic assertion: it rejected a valid salted hash whenever its hex string happened to contain the four PIN digits. The fixture now deliberately uses such a salt and checks the structured hash, inequality to the plaintext credential, verification, expiry and lockout. The production hashing code is unchanged.

The original drag-to-add suite also times out on the unmodified `1077d68` assets in this Chromium environment: after custom CDP drags and hash-only navigation, a native touch produces pointer events but no browser click. A fresh page accepts the native tap. The harness now reloads between the independent drag and tap groups, retains every original assertion, and passes all 37 checks. No forced click or product workaround was added. The uninterrupted drag-then-tap sequence remains unverified on an actual phone.

To repeat the new checks:

```sh
npm test
BASE=http://127.0.0.1:8765/ node tests/browser/schwab-offline.e2e.js
node tests/browser/schwab-upgrade.e2e.js
```

Serve `docs/schwab` on the local address for the offline test. Both browser tests require Playwright/Chromium; the upgrade test starts its own ephemeral local server and needs Git history containing `ef0c873`. Existing browser scripts document their local Hub and PDF prerequisites. Keep the service-worker cache version aligned with every release.

## Remaining boundaries and known behavior

- Google authorization, `drive.file` access, Sheets/Language/Lock/Cache behavior under real quotas, and real phone `/exec` redirects remain unverified. The stand-in proves protocol behavior, not Google deployment readiness.
- Real Safari/iPhone installation, native share dialogs, large text and browser pull-to-refresh still need device testing. Chromium emulation is useful evidence, not equivalent hardware coverage.
- The existing v8 worker can still refresh assets independently until migration completes. Retaining the retired dictionary keys covers the reproduced Spanish failure; v9 keeps subsequent core releases together. Users must close all app tabs/windows after a complete online download for a waiting release to activate.
- A first-sync part without a base still follows the documented timestamp/merge policy. The new pull-first protection applies when a base exists. Deliberate no-base report union and changed-back-to-base ambiguity were not silently redefined.
- Device ownership proves the phone, not the worker's identity. Invite rate-limit policy, a stale refusal toast during a replacement invite, and the old deleted-report-link message remain separate known review concerns from Forge's handoff.
- Forge's combined-build adversarial gate and the owner's merge/deployment decision remain outstanding. Passing checks reduce risk; they do not prove the absence of every bug.

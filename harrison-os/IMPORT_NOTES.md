# Source import notes

Imported October 31, 2026 as a clean current-file snapshot of the existing local Harrison OS application, not its git history. No private handoffs, personal profile, real user content, runtime secrets or live logs are included. Public configuration uses blank values/placeholders.

The imported source had documentary reports of 207 unit and 11 browser scenarios passing. These checks were not rerun during transfer and are not proof for this checkout. Inspect and run relevant checks. Seed changes: remove one private Windows Playwright path in favor of environment/project-local resolution; replace an existing private resource UUID in a deployment guard with a sentinel while retaining forbidden-name guards; remove stale deployment-only comments. Install/document portable browser-test dependencies. Node 22 or later with supported node:sqlite is required by tests.

BUILD_HANDOFF.md is the current full-application assignment. Do not reintroduce old private-repository-only, signature-only, pilot-first or no-deploy gates. Preserve all existing Ponytail toolkit files. New application changes belong under harrison-os/ unless a minimal clearly justified integration change is required.

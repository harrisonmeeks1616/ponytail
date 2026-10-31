# Harrison OS: try it, and what it is for

Checkpoint, Saturday October 31, 2026, about noon Eastern. Source revision `13abde8`; preview published in `ccd9b6e` on `main`.

## 1. Open the preview

**On your phone or computer:** https://harrisonmeeks1616.github.io/ponytail/harrison-os-demo/

- It is published by the repository's existing GitHub Pages site (the same one that serves the Schwab Field app), into its own new folder. No Field or PM file was changed.
- It is the real Harrison OS screens and the real server code running inside your browser tab, with made-up data (Maple Street clinic, Jordan Example). Nothing you type leaves the browser. It is not the deployed app, there is no sign-in, and nothing syncs between devices.
- I could not open github.io from the build environment (its network blocks it). The GitHub Pages deployment of this commit is the evidence that it is live; if the page does not load, use the local steps below.
- First load downloads about 2.5 MB (mostly the SQLite engine). Works in current Safari and Chrome.

**Local alternative (a computer with Node 22):**

```bash
cd harrison-os && npm ci && npm run demo:build
```

```bash
cd .. && python3 -m http.server 8930
```

Then open http://127.0.0.1:8930/docs/harrison-os-demo/ on that computer.

## 2. Five-minute walkthrough (fictional data)

The green bar at the top is the preview's own: **What's real?** explains what is simulated, **Skip ahead a week** pretends you were away eight days, **Start over** resets the sample data.

1. **Look at Today (30 s).** **Next** says what to do first and why ("It is due today."). Below: today's list, Waiting, all open tasks, a *Sample* calendar, *Sample* company projects, and **Pick up where you left off: Maple Street clinic fit-out**.
2. **Capture (45 s).** Tap the round **+** at the bottom. Type: `Call Rivera Supply about the 3/4 inch EMT delivery tomorrow`. Choose **Work**, tap **Save**: it says it is saved, then synced. Tap **Close**.
3. **Review what it understood (45 s).** On Today tap **1 capture to review**, open it. It proposes one task and shows "tomorrow" as a *date mentioned (not a due date)*: nothing becomes a commitment unless you say so. Tap **Looks right**, then **File these**.
4. **Finish and defer (45 s).** Back on **Today**, tick the circle on **Send revised panel schedule to the GC**: "Marked done." with Undo. Tap **All open tasks**, tap **Edit** on **Order 14 sheets of fire-rated drywall**, tap **Tomorrow**: "Not before Sun, Nov 1. Due date unchanged." The hard date stays.
5. **Waiting on someone, tied to the job (60 s).** Tap **+**, type `Waiting on Jordan Example for the corrected fixture count, he said by Tuesday`, **Work**, **Save**, **Close**. Open the review. It files as *Waiting on*, who = Jordan Example, and shows Tuesday as a date *mentioned*, not a confirmed promise. Tap **Edit**, choose **Project: Maple Street clinic fit-out**, set **Promised by** if you want, **Use these**, **File these**.
6. **Save your place (30 s).** **Projects**, **Maple Street clinic fit-out**: Waiting shows Jordan with "No reply recorded" (it never claims nobody replied). Under **Where you left off** tap **Save my place**: one tap, prefilled from what you just did.
7. **Come back after a week (45 s).** Tap **Skip ahead a week** in the green bar. Today says **You've been away 8 days**, "Nothing was moved, completed or deleted while you were away", lists hard dates coming up, and gives **one thing to start with**: the project, where you stopped, the open question about occupancy sensors, and the next step. Tap it to land on the project.
8. **Optional: Ask (30 s).** Tap **Ask**, type `What is open on Maple Street?`. The answer is labelled **Not AI. Matched from your saved records.** No AI key is configured, so it never pretends.

Reload at any point: your items stay (they are stored in this browser).

## 3. What it adds beyond the two apps you have

The Field app runs the crew's day on one job: task sheets, time clock, daily report. The PM app is the office's project record. Neither is where **your** loose ends live: the thing you remembered in the truck, the person who owes you an answer, the personal errand, and where you were when you got pulled away. Harrison OS is only that: capture in seconds, see what matters now, track who owes you what, and pick up after an interruption, across every job and your personal life, with Work and Personal kept apart.

## 4. Harrison OS, PM app and Field app

| | Harrison OS | PM app | Field app / Hub |
|---|---|---|---|
| For | Harrison personally: capture, Today, waiting-on, resume | The office: projects and PM records | Crews and superintendent on a job: task sheets, time clock, daily report |
| Who uses it | Only you | You and the office | Crew, superintendent, PM |
| Owns | Your captures, your own tasks and waiting-ons, saved places, decisions, drafts | Official project records | Crew, task and timekeeping records (Hub: Google Sheet) |
| Where it runs | Its own Cloudflare Worker and database (not deployed yet); preview in the browser | Separate Cloudflare Worker (source not in this repository; not inspected) | GitHub Pages app plus optional Google Apps Script hub |
| Connected now | Nothing live. Sample calendar and sample company-projects digest only | None to Harrison OS | Links out to the PM app's project records |
| Proposed | Read-only calendar feed; read-only PM digest from an export or an authorized link; links back to PM/Field for anything official | No change | No change |

Combining them now would mean one codebase serving three audiences with different access rules (crew phones without accounts, office records, one person's private notes), a data migration, and new risk to timekeeping that crews rely on. That cost buys little until Harrison OS proves daily use. Harrison OS deliberately never stores crew hours or job records; it links to them.

## 5. Status, honestly

**Works (verified in headless Chrome at 390 x 844, not on an iPhone):** capture with review before filing; Today with an explained Next; finish, undo, defer without moving hard dates; recurring tasks; Waiting with who, promised date and "No reply recorded"; projects, Save my place and the welcome-back view; Memory search; decisions with replacements; drafts with a claim check (it flags "requested" turning into "confirmed"); weekly review; Work/Personal separation; export, restore and deletion that removes derived copies.

**Simulated or not connected:** no AI model (Ask and Catch me up run in labelled Not-AI mode); calendar and company projects are labelled sample data; no reminder alerts in the preview; no sign-in or sync in the preview; MCP access for AI clients is built and tested but not connected to any client.

**Checks at `13abde8`:** 365/365 unit and API tests; 11/11 local browser workflows (wrangler dev + headless Chrome); 16/16 preview walkthrough steps with 0 console errors (`npm run demo:check`, also in CI). Separate, pre-existing: the repository's toolkit test job was already failing before this work (114 failures, identical at the seed commit) and is untouched.

**Not verified at all:** a real iPhone (install, offline, locked-screen alerts, the Nov 1 time change), a real deployment, Cloudflare Access sign-in, a real calendar feed, the real PM app, any AI provider. None of these is implied by the checks above.

**Before real use:** deploy with `docs/DEPLOY.md` (needs your Cloudflare login); decide on an AI key and whether work text may be sent to it; give a calendar link if you want it; run the phone checks in `docs/PHONE_TEST.md`; then two weeks of real use.

## 6. Recommendation

**Continue Harrison OS, narrowly, as your personal command center: capture, Today, waiting-on, resume. Do not merge it with the PM or Field apps, and pause new connectors until it earns daily use.**

Why: [Likely] the preview shows something neither existing app does: one place for your own loose ends across jobs and personal life, with an honest "where was I" after an interruption. [Certain] It is built to link to the PM and Field apps, never to duplicate their records. [Guessing] Whether you will actually open a third app every day is unknown, and that is the whole question.

What would change this recommendation:

- If in two weeks of real use you capture less than about once a day, or keep tracking waiting-ons in texts or the PM app anyway, stop Harrison OS and put a small "my follow-ups" view into the PM app instead.
- If the PM app already tracks personal follow-ups well (I have not seen its code), reuse that and keep only Capture and Resume here.
- If the phone checks fail (alerts, offline capture), fix those before anything else; a command center that drops a capture is worse than none.

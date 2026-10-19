# H.A. Sack-Electrical field app (Schwab Building)

One phone app for the Charles Schwab Building electrical job, built from the paper forms. It carries the
company names (**H.A. Sack-Electrical**, **Sack Company-Electrical**) in its header and on every PDF.

| Screen | Paper form | Who uses it |
| --- | --- | --- |
| Tasks | Electrical Task Sheet (2 pages) | Superintendent or PM assigns; crews check off steps and send results back |
| Time clock | (new) | Every hourly worker clocks in and out on their own phone; the PM keeps the weekly timesheet |
| Daily report | Superintendent Daily Report (8 pages) | Superintendent fills it in; PM answers decisions and sends it back |

`tasks.html` is the app; `report.mjs` holds the daily report and time clock; `index.html` and the old `report.html` just open the app.
No build step and no accounts. Optional Drive filing needs a separately authorized and deployed Apps Script
receiver; the static app does not connect it automatically.

## First open

A new phone asks three things, one per screen, before anything else: the language; who is using the phone
(**Crew member**, **Superintendent** or **Project manager**); and the name (picked from the names it already knows,
such as the people on the sheet it was opened from, or typed). A crew member's name goes on the time clock. A
superintendent or PM then creates the office passcode, or enters it when the link that opened the phone carried
one. Nothing is saved until the last answer, and there is no way past it except answering. A phone that already has
settings, sheets, reports or hours never sees it. A crew phone shows no office words (no "Sign in to the office
screens") until someone signs in and changes the role in **Settings → This phone**.

## Office passcode

- The superintendent's parts open with a **4-digit office passcode**: the daily report, settings, and making
  or changing task assignments, plus the PM's crew hours. Crew task sheets and the time clock stay open to everyone. Sign in with the
  padlock at the top, or **Superintendent or PM? Sign in**. Signed out, the tabs at the bottom are **Today** and
  **Time clock**, and Today shows only the sheets sent to that phone. Signed in, they are **Tasks**, **Time clock** (the PM's says **Hours**: the crew timesheet) and
  **Report**, the **+** button makes a task sheet, and the gear opens Settings.
- The first office phone to sign in creates the code. Use the same code on the PM's and the superintendent's
  phones. A phone that has no code yet learns it from the first task sheet or report link it opens, so a crew
  phone asks for the office code instead of offering to make one. A link never replaces a code a phone has.
- Signed in lasts 12 hours, or until the padlock is tapped. Five wrong codes in a row mean a one-minute wait.
- **Settings → Office passcode → Change the passcode** asks for the current code first, and changes it on that phone only. Phones that already
  learned the old code keep it; type the new one on them if that matters.
- It is a door lock, not a vault. The code is stored as a salted hash, but there are only 10,000 codes, and
  anyone with a link or the phone's storage can try them all offline. It keeps crews on the crew screens
  and a picked-up phone out of the office records. If everyone forgets the code, the data is still on the
  phone: someone technical can delete the browser's stored `schwab.pin` entry and clear the `pin` field in
  `schwab.settings` (both), then the next sign-in creates a new code.

## Time clock

- **Workers (laborers and superintendents), on their own phone, no code:** open the app, tap **Time clock**,
  type your name once, then tap **Clock in** when you start and **Clock out** when you leave. Times come from
  the tap; nobody types or changes a time on a worker's phone. Each tap opens a text to the PM: send it
  every time. The link inside carries that phone's last two weeks, so a text that never went out is caught up
  by the next one. The screen shows this week's shifts and the Monday to Sunday total.
- **Forgot to clock out:** a shift open longer than 16 hours counts as a missed clock-out. The next tap starts
  a new shift, and the PM fills in the missing out time.
- **The PM's phone** (**Settings → Your role → Project manager**, signed in): tapping a worker's link logs it
  into **Crew hours**, a Monday to Sunday timesheet with each person's shifts and week total. Only this
  screen changes hours: fix an in or out time, **+ Add a shift**, remove one, or **Rename** a person (a name
  typo). What the PM changes is marked *edited* and stays as set when that worker's next text comes in; a
  removed shift stays removed. A day the PM added by hand stays as entered: a late text for the same person
  and day is filed as removed, with a warning. Each shift keeps the name it was clocked in with, so a borrowed
  phone never moves its owner's hours. Hours links opened on any other phone change nothing.
- **One list of people:** **Settings → People and crews** holds the app's list of people. Each crew is one group with its people as
  rows: tap a name to rename the person, move them to another crew or take them off the list, and type in
  **Add people** (several names at once with commas). Every person and every crew has a permanent id, so a
  rename never splits anyone's sheets or hours; old sheets keep the name they were made with. Two people may
  share a name: adding a name someone already has asks first (the same person, moved to this crew, or someone
  else), and the screens show the crew next to the name. Names are matched only when someone types or picks one,
  whatever the capitals, accents, spacing or punctuation ("José  L." is "jose l", "O’Neil" is "O'Neil"). A name
  typed on a task sheet that matches nobody joins the sheet's crew as a new person; nobody is ever taken off a
  crew automatically. Settings saved by the older version (comma lists of members) become people the first time
  this version opens: one person per name, on the first crew that lists it.
- **On the time clock** the name box offers the names the phone knows (its people and its task sheets) and takes
  their spelling; a name no list knows gets a hint to check the spelling, and a name two people share shows both,
  with their crews, to tap the right one. A **Today** card lists that day's sheets on the phone that name the
  worker, each opening its sheet, and the crew view marks the worker "(you)". Each clock-in and clock-out records
  the person, their crew and the sheets they were on that day (each by its permanent id, with its Task ID as the
  label), and they ride to the PM with the hours. On **Crew hours** each person shows under their current name with
  their crew, and each shift its tasks; a name on none of the PM phone's crews is marked **Not on a crew list**,
  and **Add to a crew** puts it on one (one tap when the worker's sheets named a crew this phone has). A
  **Rename** renames the person in Settings too (same person, same id); renaming to a name someone else has asks
  whether it is the same person (the hours move to them) or two people.
- **Send to accountant** shares the week as a spreadsheet (CSV: name, crew, date, in, out, hours, tasks, week totals) and
  a PDF timesheet, through the phone's share sheet (Mail, Files) or as downloads on a computer. It warns
  first if a shift has no clock-out. Hours are to two decimals (7h 45m is 7.75), rounded per shift so the rows
  add up to the totals; an overnight shift counts on the day it started, in real hours across a clock change;
  lunch is not taken out (hours are clock-in to clock-out), so adjust a time if your payroll needs that.

## Put it online (one time, about 2 minutes)

1. GitHub repo **Settings → Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main` (or this PR's branch to try it first), folder **`/docs`**. Save.
3. After a minute the app is at `https://harrisonmeeks1616.github.io/ponytail/schwab/`.

Any static host works too (Netlify Drop: drag this folder onto the page). It must be HTTPS for offline mode.

## Optional review folder (owner setup required)

`review-folder.gs` and `appsscript.json` are receiver source and a private initial manifest. They do not create a deployment or grant Google access merely by being hosted here. The receiver uses Advanced Drive v3 and explicitly requests only `https://www.googleapis.com/auth/drive.file`. This scope permits managing files created by or specifically opened with this app, rather than all Drive files. The receiver code pins one app-created folder and never deletes or replaces files. [Google scope documentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Owner setup, after reviewing the source and scope:

1. Create a private Apps Script project, copy `review-folder.gs`, and replace its `appsscript.json` with the supplied manifest. It declares Advanced Drive v3 and starts with `MYSELF` access, executing as `USER_DEPLOYING`. On a default Cloud project, enabling the advanced service also enables the API. [Google advanced service documentation](https://developers.google.com/apps-script/guides/services/advanced).
2. Review Google's actual authorization screen before approving. The requested scope must match the single scope above. Run `initializeOwnerUploadFolder` only after that approval. It creates **Schwab Field Uploads** in My Drive and saves its ID in Script Properties; repeated runs reuse that folder.
3. Move that app-created folder inside the existing records folder using Drive. An arbitrary existing folder ID is insufficient for `drive.file`; direct access to an existing folder requires a Picker grant from the same app. Retained access after the manual move must be verified on Google before relying on this route.
4. Generate a fresh secret of at least 32 characters outside the public source. Store its SHA-256 hex digest as Script Property `UPLOAD_CODE_SHA256`. Keep the actual code private. The old short code must not be reused.
5. Verify the pinned folder and a fictional PDF using the private editor. Review anonymous access separately before changing the deployment to `ANYONE_ANONYMOUS` for browser/crew uploads. An owner-only deployment requires Google sign-in and is not a working anonymous crew receiver. [Google web app access documentation](https://developers.google.com/apps-script/manifest/web-app-api-executable).
6. After deployment is approved and tested, enter the `/exec` URL and code manually in **Settings → Review folder** on each phone that should upload, then test the connection. Share the records folder only with specifically approved people and access levels.

Resulting folder layout:

```
Schwab Field Records/
  Schwab Field Uploads/
    2026-10-03/
      Daily Report 2026-10-03__<receipt>.pdf
      T1003-01 Crew A Level 3__<receipt>.pdf
```

- **When configured:** a crew taps **Send results**; the superintendent receives results or taps **Accepted** / **Follow-up needed**; a daily report is sent either way between superintendent and PM. A finished record edited later is queued again when you leave it. Uploaded edits are separate PDFs; identical retries are deduplicated. Earlier files are preserved. The receiver caps PDFs at 5 MB and new upload attempts at 300 per UTC day.
- **Who:** every uploading phone needs manual receiver setup. Task links carry neither the upload URL nor code and never configure a recipient's receiver. The superintendent can file received crew results without configuring crew phones.
- **No signal:** the PDF waits on the phone and uploads when the app is next opened or the phone reconnects. Settings shows how many are waiting.
- **Any time:** every screen's **⋯** menu has **Save as PDF** (phones get the share sheet: Save to Files, Mail, AirDrop, Drive; computers download it).

## Spanish mode (crew screens and the time clock)

- Tap **ES** in the header, or Settings → Language. A new phone asks "English / Español" first thing (see First open); an older crew phone that never chose asks the first time it opens a new sheet.
- Every crew label, button and message, the sign-in pad and the time clock switch to Spanish (wording in `es.mjs`; a bilingual foreman can fix any phrase there). The daily report and the PM's crew hours are fully bilingual on screen too. What stays English is the office record: PDFs, the accountant's CSV, and the text messages sent to the office.
- What people type is never translated. Notes show and print exactly as written, so a note typed in Spanish stays in Spanish for whoever reads it.
- PDFs and review-folder copies are always the English form, with the notes as typed. The text message a Spanish-mode crew sends carries a Spanish line and an English line.

## How the data moves

- Each phone keeps its own records in the browser, saved as you type.
- Deleting a task sheet, removing a step, or taking a person or a crew off the list in Settings happens at once, with no "are you sure?": the message at the bottom offers **Undo** for 6 seconds.
- Handoffs are links. **Send to crew**, **Send results**, **Send day plan** and **Send to PM** pack the details into the part of the link after `#`, which browsers never send to the web server. Compression/base64 is readable encoding, not encryption or authentication. Anyone with the link can read or alter its contents, so send it only to the intended people.
- Opening a link merges it in: crew results join the superintendent's sheet without touching the assignment; a re-sent sheet keeps the crew's check-offs; PM answers join the report without touching what the superintendent wrote since.
- **Task IDs are labels.** Every sheet also has a permanent id that hours and links use, so two office phones that both numbered a sheet T1019-02 with no signal never mix up whose hours are whose. When a sheet arrives with the date and number of one of this phone's sheets that was never sent, this phone's sheet takes the next free number and says so. If both were already sent, both show **Same number as another sheet** until someone changes one's Task ID.
- **Fill from task sheets** on the Daily report tab rolls the day's task sheets (on the same phone) into the floor and crew sections. It fills only empty text fields; the work hours and labor-hours follow the sheets on every fill.
- **⋯ → Settings → Download backup** saves everything on that phone to a file.
- Backups contain work records and settings, including the upload code if configured, and this phone's device secret (so a phone restored from it keeps its own hours). They never contain the hub key: after a restore, open a new hub invite. Keep backups private.

## Things to know

- **iPhone home screen:** if "Add to Home Screen" shows an **Open as Web App** switch, turn it off. Otherwise the icon keeps separate data from Safari, and links tapped in Messages land in Safari. Inside the app, **⋯ → Open a link someone sent you** imports a pasted link.
- Same goes for browsers: links open in the phone's default browser, so use the app in that browser.
- `report.html` only forwards to the app now, so old report links and an old Daily Report home-screen icon still land in the right place.
- The PM selects **Project manager** in Settings before opening a daily report. Report links do not select the phone's role.
- After an app update, reopen online and reload once more after the new offline cache installs. Saved records remain on the phone.
- There is no live sync. The PM sees crew detail when the superintendent sends the report or it reaches the review folder, not before.
- PDFs use the standard Helvetica font, which covers English and Western European letters. Other characters print as "?".
- Long reports make long links. iMessage, WhatsApp and email handle them; some plain SMS apps cut them off.
- Storage is about 5 MB per phone, roughly a year of daily use. Settings shows how much is used.

## Check

`node --test tests/schwab-field-apps.test.js tests/schwab-review-folder.test.js tests/app-display-regressions.test.js tests/schwab-es-lint.test.js` covers the link codec, merges, report roll-up, office passcode, time clock and timesheet, people and crew ids (moving older settings over, two people with one name, renames, sheets with the same number from two phones), every new field through reload and backup and restore, the device secret, PDF writer, upload queue, mocked receiver boundaries, and that every on-screen phrase has its Spanish. Receiver checks do not exercise Google authorization, folder access or a live deployment.

The browser checks in `tests/browser/` drive the real app in Chromium (Playwright; pdftotext for the PDFs). Serve `docs/schwab` (`python3 -m http.server 8765 --bind 127.0.0.1`), then run each with `BASE=http://127.0.0.1:8765/ node tests/browser/<file>`: `schwab-field-app.e2e.js` (a whole job on five phones: first run, task sheets, results, time clock, daily report, crew hours, Undo, the tab bar, 320 px, Spanish), `schwab-first-run.e2e.js`, `schwab-clock-stale.e2e.js` (the 16-hour cutoff) and `schwab-spanish-audit.e2e.js` (every screen and state in Spanish; 0 untranslated to pass). Each exits 0 when everything passes.

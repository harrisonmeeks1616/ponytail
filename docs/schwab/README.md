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
  removed shift stays removed. A whole day the PM added by hand (with a clock-out) stays as entered: a late text
  for the same person and day is filed as removed, with a warning. With a hub, the worker's own taps for that day are
  kept as a second row under that person (they are the real punches), for the PM to settle. A day added with
  no clock-out yet takes the worker's own Clock in and Clock out as a second row under that person, for the PM to
  settle. Each shift keeps the name it was clocked in with, so a borrowed phone never moves its owner's hours. Hours links opened on any other phone change nothing.
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

## Hub (optional)

Without it the app works as described above: phones pass work by texted links. The hub adds one shared, lasting record
and live updates. It is one Google Apps Script web app plus one Google Sheet, both in the owner's Google account
(`hub/Code.gs`, `hub/appsscript.json`; the contract between the pieces is `HUB.md`).

**What it does**

- Task sheets reach the crew's phones by themselves once you tap **Send to crew** (a draft stays on the office phones),
  and ticks, start, stop and results reach the office as they happen. **Send results** still opens a text, and texted
  links still work.
- **Clock in** and **Clock out** reach the PM's **Crew hours** without a text. When that does not get through (no signal,
  the hub busy, a replaced key) the text opens as before.
- Office phones get two more tabs. **Live**: who is on site, today's sheets by crew with their progress, and the activity
  of the day; **Message** and **Review** there reach the crew's sheet. **Records**: **People** (hours by person and week,
  PM only), **Sheets** and **Reports**, each with a search box, older records loaded from the hub, and for the PM **Download all (JSON)**, a week as CSV, the Sheet's
  storage meter and **Archive older records**.
- What people type shows in the reader's language (Google Translate), marked **Auto-translated**, with one tap to the
  original. Drawing and task numbers, quantities and trade abbreviations are kept as typed.
- The owner can open the Sheet on any phone: tabs for Tasks, Hours, Weekly totals, Reports and Activity.

**One-time setup (the owner, about 15 minutes, on a computer signed in to the owner's Google account)**

1. Go to script.google.com and make a **New project** on its own (not from a Sheet's **Extensions** menu: `setupHub`
   makes the Sheet). Rename it **Schwab field hub**; Google's permission screen shows that name. Paste `hub/Code.gs`
   over everything in `Code.gs` and save.
2. **Project Settings** (gear, left): turn on **Show "appsscript.json" manifest file in editor**. Back in the editor, paste
   `hub/appsscript.json` over that file and save. **Services** now lists **Sheets** (the Sheets API, v4); no other
   service, trigger or library is needed. The manifest keeps the time zone America/New_York (the hours math needs it)
   and asks for only two permissions: files this script creates (`drive.file`) and outside requests
   (`script.external_request`).
3. Pick `setupHub` in the function list next to **Debug** and **Run** it once. Google asks to authorize: **Review
   permissions**, pick the owner's account; if it says Google hasn't verified the app (it is your own script), **Advanced**,
   then **Go to Schwab field hub (unsafe)**. It should ask for two things only: "See, edit, create, and delete only the
   specific Google Drive files you use with this app" and "Connect to an external service". Tick both if there are
   boxes, then **Allow**. The **Execution log** shows the PM key, the crew and superintendent keys, and the link to the
   new Sheet (**Schwab field hub** in My Drive: open it to read, change things through the app). Copy the PM key now:
   the hub keeps only a fingerprint of it (`resetPmKey` makes a new one). The other two keys need no copying: invites
   carry them. Running `setupHub` again prints only the Sheet link.
4. **Deploy > New deployment**, type (gear) **Web app**, **Execute as: Me**, **Who has access: Only myself**, **Deploy**
   (authorize again if asked). Copy the **Web app** link, the one ending in `/exec`. Open it in this browser: it answers
   `{"ok":true,"service":"schwab-field-hub","version":"1.0.0"}`. If Google says it cannot open the file, more than one
   Google account is signed in: use a window with only the owner's. Phones cannot reach it yet.
5. When that works, **Deploy > Manage deployments**, the pencil (**Edit**), **Who has access: Anyone** (not "Anyone with
   Google account": phones do not sign in), **Deploy**. The link stays the same, and a private window now gets the same
   answer. Only phones holding a key can do anything with it. No **Anyone** choice means the account's administrator
   does not allow it.
6. Connect the PM's phone first, once its **Settings** hold the job's project, floors, people and crews: a phone that
   joins later takes those from the hub in place of its own. On the PM's phone (role Project manager, signed in, gear):
   **Settings → Hub**, paste the `/exec` link in **Hub link** and the PM key in **Hub key**, **Connect**, then **Test the
   hub**. All five lines should show a check mark and **Everything works**.
7. **Invite people → Invite crew** (pick the crew, or **Not sure: they pick**) and **Invite superintendent** each make a
   link to text. On their phone the person opens it, picks the language on a new phone, taps or types their name and
   taps **Join**. The invite answers the "Who is using this phone?" question for them. A phone already on a hub asks first.
8. After any change to `Code.gs`: paste it, save, then **Deploy > Manage deployments**, the pencil, **Version: New
   version**, **Deploy**. Saving alone does not change what phones reach; the link stays the same. Run **Test the hub**
   again.

**What stays where**

- Every phone keeps working from its own copy: crew phones keep 14 days, office phones 60. Edits made with no signal
  wait on the phone and go when it is back. The status dot in the header (on an office phone signed in, on the Live tab,
  so both company names keep their size) shows Live, Syncing, Offline or Problem. A phone whose key was replaced also
  says to ask the PM for a new invite.
- The Sheet keeps everything. **Records → Load older records** shows what the phone no longer keeps, without storing it.
- The hub key stays on the phone it was typed on. A backup leaves it out: after a restore, open a new invite (or paste
  the key again). A backup made on a hub also notes what the hub had then, so restoring it does not roll back work that
  reached the hub later. Invite links carry a crew or superintendent key, so send each only to its person.
- Each role changes only its own part: crews their results, ticks and hours; the office the assignment, the review and
  messages; only the PM edits hours, deletes records (from every phone at once: the delete can be undone for 6 seconds,
  then it leaves the hub, even if the app was closed meanwhile; on another phone, Delete on a sheet or report the hub
  has says to ask the PM), exports and manages the keys.

**Keys and archive**

- A lost phone, or someone who left: **Settings → Hub → Replace the crew key** (or the superintendent key). Every phone on
  the old key stops syncing until it opens a new invite. A lost PM key: run `resetPmKey` in the script editor.
- A worker moved to another crew in Settings, or put on another crew's sheet, gets those sheets on their phone by
  themselves (the phone follows its person on the crew list).
- A Sheet holds 10 million cells. Records shows how full it is and warns at 70%. **Archive older records** moves
  everything before a date (at least 30 days back) into a new archive Sheet; it stays readable there.

**Honest limits**

- It is not instant. A round trip through Apps Script takes a few seconds, and an open app checks every 20 seconds.
- Google's free quotas apply. Translation stops at 1,500 requests a day (the original text shows after that).
- Machine translation gets trade words wrong sometimes. The original is always one tap away.
- A phone's clock decides which of two edits to the same part is newer; clocks a few minutes apart can order edits made
  within those minutes the wrong way (the hub corrects bigger differences).
- Two office phones that numbered sheets offline keep both numbers once both sheets are on the hub, and both show
  **Same number as another sheet** until one is renamed.
- A shift texted to the PM before that worker's phone joined the hub stays under its old phone id on the PM's copy.
- One hub per phone. **Disconnect** keeps the phone's work on the phone. A phone moved to another hub (another job) does not
  copy what it already synced to the new one; what it changes after the move goes up.

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
- Without the hub there is no live sync. The PM sees crew detail when the superintendent sends the report or it reaches the review folder, not before.
- PDFs use the standard Helvetica font, which covers English and Western European letters. Other characters print as "?".
- Long reports make long links. iMessage, WhatsApp and email handle them; some plain SMS apps cut them off.
- Storage is about 5 MB per phone, roughly a year of daily use. Settings shows how much is used.

## Check

`node --test tests/schwab-field-apps.test.js tests/schwab-review-folder.test.js tests/app-display-regressions.test.js tests/schwab-es-lint.test.js tests/schwab-sync.test.js tests/schwab-live.test.js tests/schwab-hub.test.js` covers the link codec, merges, report roll-up, office passcode, time clock and timesheet, people and crew ids (moving older settings over, two people with one name, renames, sheets with the same number from two phones), every new field through reload and backup and restore, the device secret, PDF writer, upload queue, mocked receiver boundaries, and that every on-screen phrase has its Spanish; the last three cover the hub sync, the hub screens and the hub itself on a stand-in for Google. Receiver and hub checks do not exercise Google authorization, folder access or a live deployment.

The browser checks in `tests/browser/` drive the real app in Chromium (Playwright; pdftotext for the PDFs). Serve `docs/schwab` (`python3 -m http.server 8765 --bind 127.0.0.1`), then run each with `BASE=http://127.0.0.1:8765/ node tests/browser/<file>`: `schwab-field-app.e2e.js` (a whole job on five phones: first run, task sheets, results, time clock, daily report, crew hours, Undo, the tab bar, 320 px, Spanish), `schwab-first-run.e2e.js`, `schwab-clock-stale.e2e.js` (the 16-hour cutoff) and `schwab-spanish-audit.e2e.js` (every screen and state in Spanish; 0 untranslated to pass). Each exits 0 when everything passes.

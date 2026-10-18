# H.A. Sack-Electrical field app (Schwab Building)

One phone app for the Charles Schwab Building electrical job, built from the paper forms. It carries the
company names (**H.A. Sack-Electrical**, **Sack Company-Electrical**) in its header and on every PDF.

| Screen | Paper form | Who uses it |
| --- | --- | --- |
| Tasks | Electrical Task Sheet (2 pages) | Superintendent or PM assigns; crews check off steps and send results back |
| Time clock | (new) | Everyone on site clocks in and out; the superintendent or PM sets how many people |
| Daily report | Superintendent Daily Report (8 pages) | Superintendent fills it in; PM answers decisions and sends it back |

`tasks.html` is the app; `report.mjs` holds the daily report and time clock; `index.html` and the old `report.html` just open the app.
No build step and no accounts. Optional Drive filing needs a separately authorized and deployed Apps Script
receiver; the static app does not connect it automatically.

## Office passcode

- The superintendent's parts open with a **4-digit office passcode**: the daily report, settings, and making
  or changing task assignments. Crew task sheets and the time clock stay open to everyone. Sign in with the
  padlock in the header, the locked **Daily report** tab, or **Superintendent or PM? Sign in**. Signed out, the
  Tasks tab shows only the sheets sent to that phone.
- The first office phone to sign in creates the code. Use the same code on the PM's and the superintendent's
  phones. A phone that has no code yet learns it from the first task sheet or report link it opens, so a crew
  phone asks for the office code instead of offering to make one. A link never replaces a code a phone has.
- Signed in lasts 12 hours, or until the padlock is tapped. Five wrong codes in a row mean a one-minute wait.
- **Settings → Office passcode → Change the passcode** asks for the current code first, and changes it on that phone only. Phones that already
  learned the old code keep it; type the new one on them if that matters.
- It is a door lock, not a vault. The code is stored as a salted hash, but there are only 10,000 codes, and
  anyone with a link or the phone's storage can try them all offline. It keeps crews on the crew screens
  and a picked-up phone out of the office records. If everyone forgets the code, the data is still on the
  phone: someone technical can clear the `pin` field in the browser's stored `schwab.settings`.

## Time clock

- Open to everyone, no code needed. Times stay on the phone they are tapped on, so workers clock in on the
  superintendent's phone or a site tablet, not their own. Tap the padlock first: a signed-in phone also opens
  the daily report and settings (the clock screen reminds you while signed in).
- **People on site:** type the number (2 or more: the superintendent and at least one worker). Each person
  gets a box with a name, **Clock in** and **Clock out**. **+ Add a person** adds one; **Remove** takes one off.
  Lowering the number asks first if a removed box has a name or times.
- **Everyone in** stamps every named person who isn't in yet; **Everyone out** clocks out everyone on site.
  **Same people as (date)** fills in the names from the last day with a clock.
- The clock is saved with that day's daily report: it goes to the PM with **Send to PM**, prints in the report
  PDF, and files with it. **⋯ → Save the time clock as PDF** makes a separate sheet.

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

- Tap **ES** in the header, or Settings → Language. A crew phone asks "English / Español" the first time it opens a sheet.
- Every crew label, button and message, the sign-in pad and the time clock switch to Spanish (wording in `es.mjs`; a bilingual foreman can fix any phrase there). The daily report form itself stays in English, the PM's record; only the app around it (tabs, dates, menus) follows the phone's language.
- What people type is never translated. Notes show and print exactly as written, so a note typed in Spanish stays in Spanish for whoever reads it.
- PDFs and review-folder copies are always the English form, with the notes as typed. The text message a Spanish-mode crew sends carries a Spanish line and an English line.

## How the data moves

- Each phone keeps its own records in the browser, saved as you type.
- Handoffs are links. **Send to crew**, **Send results**, **Send day plan** and **Send to PM** pack the details into the part of the link after `#`, which browsers never send to the web server. Compression/base64 is readable encoding, not encryption or authentication. Anyone with the link can read or alter its contents, so send it only to the intended people.
- Opening a link merges it in: crew results join the superintendent's sheet without touching the assignment; a re-sent sheet keeps the crew's check-offs; PM answers join the report without touching what the superintendent wrote since.
- **Fill from task sheets** on the Daily report tab rolls the day's task sheets (on the same phone) into the floor and crew sections. It fills only empty text fields; the work hours and labor-hours follow the sheets on every fill.
- **⋯ → Settings → Download backup** saves everything on that phone to a file.
- Backups contain work records and settings, including the upload code if configured. Keep backups private.

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

`node --test tests/schwab-field-apps.test.js tests/schwab-review-folder.test.js tests/app-display-regressions.test.js` covers the link codec, merges, report roll-up, office passcode, time clock, PDF writer, upload queue and mocked receiver boundaries. Receiver checks do not exercise Google authorization, folder access or a live deployment.

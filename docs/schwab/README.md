# Schwab Building field apps

Two phone apps built from the paper forms for the Charles Schwab Building electrical job:

| App | Paper form | Who uses it |
| --- | --- | --- |
| `tasks.html` | Electrical Task Sheet (2 pages) | Superintendent or PM assigns; crews check off steps and send results back |
| `report.html` | Superintendent Daily Report (8 pages) | Superintendent fills it in; PM answers decisions and sends it back |

`index.html` is the launcher. No build step and no accounts. The only server piece is optional: `review-folder.gs`, a free Google Apps Script that files finished records in your Google Drive.

## Put it online (one time, about 2 minutes)

1. GitHub repo **Settings → Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main` (or this PR's branch to try it first), folder **`/docs`**. Save.
3. After a minute the apps are at `https://harrisonmeeks1616.github.io/ponytail/schwab/`.

Any static host works too (Netlify Drop: drag this folder onto the page). It must be HTTPS for offline mode.

## Review folder: finished work files itself as PDFs

Set it up once with the steps at the top of `review-folder.gs` (about 5 minutes). Then every finished record lands in Google Drive, one folder per day:

```
Schwab Field Records/
  2026-10-03/
    Daily Report 2026-10-03.pdf
    T1003-01 Crew A Level 3.pdf
    T1003-02 Crew B Level 4.pdf
```

- **When:** a crew taps **Send results**; the superintendent receives results or taps **Accepted** / **Follow-up needed**; a daily report is sent either way between superintendent and PM. A finished sheet or sent report edited later is filed again when you leave it, so the folder always has the latest. The same name replaces the earlier copy (old copies stay in Drive's Trash for 30 days).
- **Who:** put the link and site code in **Settings → Review folder** on your phone and the superintendent's. Crew phones learn it from the first task sheet they open; nobody types it on a crew phone.
- **No signal:** the PDF waits on the phone and uploads when the app is next opened or the phone reconnects. Settings shows how many are waiting.
- **Any time:** every screen's **⋯** menu has **Save as PDF** (phones get the share sheet: Save to Files, Mail, AirDrop, Drive; computers download it).

## Spanish mode (Task Sheets)

- Tap **ES** in the header, or Settings → Language. A crew phone asks "English / Español" the first time it opens a sheet.
- Every label, button and message switches to Spanish (wording in `es.mjs`; a bilingual foreman can fix any phrase there). What people type is machine-translated by the review-folder script through Google Translate, and the original stays visible underneath.
- When a Spanish-mode crew taps **Enviar resultados**, the review folder gets two PDFs: `T1003-01 Crew A Level 3.pdf` (English labels, crew notes translated to English) and `T1003-01 Crew A Level 3 (Español).pdf` (Spanish labels, the crew's own words). The text message to the superintendent carries both languages, and the superintendent's review screen shows English with the Spanish original under it. The Daily Report's **Fill from task sheets** uses the English translations.
- No review folder or no signal: screens still switch to Spanish, and typed text shows as written until a translation arrives. An English copy filed before its translation marks those notes "(not translated yet)"; the superintendent's phone files the translated copy over it when the results reach it.
- Machine translation handles plain field notes well and trade slang less well. The Spanish copy always keeps the crew's exact words.
- Already deployed `review-folder.gs`? Paste the new version and publish a new deployment version (Deploy → Manage deployments → edit → New version) so translation works.

## How the data moves

- Each phone keeps its own records in the browser, saved as you type.
- Handoffs are links. **Send to crew**, **Send results**, **Send day plan** and **Send to PM** pack the details into the part of the link after `#`, which browsers never send to the web server. Text, email or share it like any link.
- Opening a link merges it in: crew results join the superintendent's sheet without touching the assignment; a re-sent sheet keeps the crew's check-offs; PM answers join the report without touching what the superintendent wrote since.
- **Fill from task sheets** in the Daily Report rolls the day's task sheets (on the same phone) into the floor and crew sections. It only fills empty fields.
- **Settings → Download backup** saves everything on that phone to a file.

## Things to know

- **iPhone home screen:** if "Add to Home Screen" shows an **Open as Web App** switch, turn it off. Otherwise the icon keeps separate data from Safari, and links tapped in Messages land in Safari. Inside any app, **⋯ → Open a link someone sent you** imports a pasted link.
- Same goes for browsers: links open in the phone's default browser, so use the apps in that browser.
- There is no live sync. The PM sees crew detail when the superintendent sends the report or it reaches the review folder, not before.
- PDFs use the standard Helvetica font, which covers English and Western European letters. Other characters print as "?".
- Long reports make long links. iMessage, WhatsApp and email handle them; some plain SMS apps cut them off.
- Storage is about 5 MB per phone, roughly a year of daily use. Settings shows how much is used.

## Check

`node --test tests/schwab-field-apps.test.js` covers the link codec, the merges, the report roll-up, the PDF writer and the upload queue.

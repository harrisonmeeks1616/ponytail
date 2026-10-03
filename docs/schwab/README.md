# Schwab Building field apps

Two phone apps built from the paper forms for the Charles Schwab Building electrical job:

| App | Paper form | Who uses it |
| --- | --- | --- |
| `tasks.html` | Electrical Task Sheet (2 pages) | Superintendent or PM assigns; crews check off steps and send results back |
| `report.html` | Superintendent Daily Report (8 pages) | Superintendent fills it in; PM answers decisions and sends it back |

`index.html` is the launcher. No build step, no server, no accounts.

## Put it online (one time, about 2 minutes)

1. GitHub repo **Settings → Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main` (or this PR's branch to try it first), folder **`/docs`**. Save.
3. After a minute the apps are at `https://harrisonmeeks1616.github.io/ponytail/schwab/`.

Any static host works too (Netlify Drop: drag this folder onto the page). It must be HTTPS for offline mode.

## How the data moves

- Each phone keeps its own records in the browser. Nothing is uploaded anywhere.
- Handoffs are links. **Send to crew**, **Send results**, **Send day plan** and **Send to PM** pack the details into the part of the link after `#`, which browsers never send to the web server. Text, email or share it like any link.
- Opening a link merges it in: crew results join the superintendent's sheet without touching the assignment; a re-sent sheet keeps the crew's check-offs; PM answers join the report without touching what the superintendent wrote since.
- **Fill from task sheets** in the Daily Report rolls the day's task sheets (on the same phone) into the floor and crew sections. It only fills empty fields.
- **Settings → Download backup** saves everything on that phone to a file. Do it weekly.

## Things to know

- **iPhone home screen:** if "Add to Home Screen" shows an **Open as Web App** switch, turn it off. Otherwise the icon keeps separate data from Safari, and links tapped in Messages land in Safari. Inside any app, **⋯ → Open a link someone sent you** imports a pasted link.
- Same goes for browsers: links open in the phone's default browser, so use the apps in that browser.
- There is no live sync. The PM sees crew detail when the superintendent sends the report, not before.
- Long reports make long links. iMessage, WhatsApp and email handle them; some plain SMS apps cut them off.
- Storage is about 5 MB per phone, roughly a year of daily use. Settings shows how much is used.

## Check

`node --test tests/schwab-field-apps.test.js` covers the link codec, the merges and the report roll-up.

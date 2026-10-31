# iOS Shortcut: capture to Harrison OS

An extra way to capture from the iPhone (Share Sheet, Back Tap, Siri, Action button) without opening the app. The app's own capture sheet is still the dependable path: it keeps a draft and an offline outbox. The Shortcut does not.

## What it needs

| Needed | Where it comes from | Status in this repository |
|---|---|---|
| The app's hostname | Your deployed Worker (see docs/DEPLOY.md) | Blank. Not deployed from here. |
| A Cloudflare Access application for the path `/api/shortcut/capture` with a **Service Auth** policy | Cloudflare Zero Trust dashboard (owner does this) | Not set up from here |
| A service token (Client ID and Client Secret) allowed by that policy | Zero Trust, Access, Service Auth | Not created. Never commit it. |
| That application's AUD tag in `vars.ACCESS_AUD_SHORTCUT` | wrangler.jsonc / dashboard | Blank example |

The service token can only reach `POST /api/shortcut/capture`. It cannot read anything, and a person's sign-in does not work on that application (src/auth.js `authorizeRoute`).

## It needs a connection

There is **no offline queue** in a Shortcut. If the phone has no connection, or Access refuses the token, the request fails and the words are **not saved**. The Shortcut below shows the failure so you can copy the text into the app instead. Use the app's capture sheet when the signal is poor: it saves on the phone first and sends later.

## Build the Shortcut

1. New Shortcut, name it "Capture to Harrison OS". In its settings turn on "Show in Share Sheet" (input types: Text, URLs).
2. **If** Shortcut Input has any value: **Set Variable** `Words` to Shortcut Input. **Otherwise**: **Ask for Input** (Text, prompt "What do you want to remember?"), then Set Variable `Words` to Provided Input.
3. **Format Date** Current Date with custom format `yyyyMMddHHmmss`, Set Variable `Stamp`.
   **Random Number** between 1000 and 9999, Set Variable `Rand`.
   **Text**: `sc-[Stamp]-[Rand]`, Set Variable `Ref`. This is the `client_ref`: a retry of the same run with the same Ref is recognised as a duplicate, so pressing Run again after a timeout cannot save it twice (6-60 characters of letters, digits, `_` and `-`).
4. **Get Contents of URL**
   - URL: `https://<your app host>/api/shortcut/capture`
   - Method: POST
   - Headers:
     - `CF-Access-Client-Id`: the service token's Client ID
     - `CF-Access-Client-Secret`: the service token's Client Secret
     - `Content-Type`: `application/json`
   - Request Body: JSON
     - `text` (Text): `Words`
     - `scope` (Text): `personal` or `work` (optional; the server defaults to `personal`)
     - `client_ref` (Text): `Ref`
     - `time_zone` (Text): `America/New_York` (optional; used for dates like "Friday")
5. **Get Dictionary Value** `message` from Contents of URL. **If** it has any value: **Show Notification** with it. **Otherwise**: **Show Alert** "Not saved. Open Harrison OS and capture it there." and **Copy to Clipboard** `Words` so nothing is lost.

Keep the Client Secret only inside the Shortcut on your own phone. If the phone is lost, revoke the service token in Zero Trust; that does not sign you out of anything else.

## What the server answers

| Answer | Meaning |
|---|---|
| 201 `{ ok: true, id, duplicate: false, message: "Saved to Harrison OS", proposals: n }` | Saved. It appears in Review in the app. |
| 200 `{ ok: true, duplicate: true }` | The same `client_ref` (or, without one, the same text in the same UTC minute) was already saved. Nothing new. |
| 200 or 410 with `deleted: true` / `capture_deleted` | That capture was deleted on purpose earlier. Nothing is saved. |
| 400 | The text is empty or longer than 10,000 characters, or a field is malformed. |
| 401 / 403, or an HTML login page | Access did not accept the token (missing, wrong, expired, or the Access application is not set up). Not saved. |
| No answer / timeout | No connection. Not saved. |

Without a `client_ref` the server dedupes by text and minute, which is lossy: the same words twice in one minute count once, and a retry a minute later is saved again. Always send a `client_ref`.

## Not covered

- Photos and files: the Shortcut endpoint takes text only. Add photos from the app's capture sheet.
- Reading anything back (Today, search): the service token is capture-only by design.
- Evidence: this Shortcut has not been run against a deployed app from this repository. Record a real run in ACCEPTANCE.md before calling it working.

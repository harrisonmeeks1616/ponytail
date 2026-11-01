# Phone commissioning (real iPhone) and the server evidence for each step

The live app is the deployed Worker (address in the private release record). Do these on Harrison's iPhone; the computer side (Codex or root) reads the evidence column from `GET /api/evidence` (owner session) or the `events` and `deliveries` tables in D1. Record each step in ACCEPTANCE.md as **observed** (seen on the phone and in the server evidence), **server only** (evidence present, phone not seen), **not tested**, or **fail**, with the time and iOS version. Desktop results never count for these.

Event names below are the `kind` column of `events`; `ref` holds the id named. No event carries record text.

## Daylight-saving check (A10): only around a clock change

DST ended at 2:00 AM EDT on November 1, 2026; the next change is March 14, 2027 (clocks forward). To observe one: before 10:55 PM on the evening before the change, open Reminders, add "DST check" at 11:00 PM, Repeat Every day. Pass: it fires at 11:00 PM by the wall clock on both evenings (not 10:00 or midnight). Created after 11:00 PM: its first firing is after the change, so label the result "post-transition first fire only".

| Evidence | Where |
|---|---|
| Two deliveries, one per evening, `scheduled_for` = 11:00 PM local each night (03:00Z before the November change, 04:00Z after) | `deliveries` for the reminder id |
| `reminder_advanced` after each firing with the next instant | `events` |
| Lock-screen alert at 11:00 PM both nights (only with alerts on) | the phone |

## Batch (about 25 minutes)

| # | Do on the phone | Pass looks like | Server evidence |
|---|---|---|---|
| 1 | **Install (A21).** Safari, open the app, sign in through Access, Share > Add to Home Screen (Open as Web App on), open from the icon. | Opens full screen, no sideways scrolling, nothing under the notch or home bar, readable with Larger Text. | `/api/session` from the installed app: kind owner, build = the deployed SHA. |
| 2 | **Alerts on (A9).** Memory > Turn on alerts > Allow. | "This phone is registered for alerts." | `subscription_upserted` (push host `web.push.apple.com`); `pushSubscriptions` ≥ 1 in `/api/evidence` counts. |
| 3 | **Test alert (A9, A11).** Memory > Send a test alert (needs the release with this button). Lock the phone. When it shows, tap it. | The card reads "push service accepted", then "your phone reported it arrived", then after the tap "You opened the test alert". | `push_attempt` (status 201 from Apple), `delivery_received` (phone beacon), `delivery_acknowledged` via `notification`, all with the same delivery id; `reminder_id` starts with `test-`. |
| 4 | **Reminder alert (A9).** Reminders > add one 3 minutes ahead. Lock the phone, face down. | Lock-screen alert at the time, words as typed. Note the delay. | `delivery_scheduled` then `push_attempt` (201) then `delivery_received`; `fire_lag_ms` in `delivery_scheduled`. |
| 5 | **Capture online (A1).** Capture "Test 1 order 3 filters" in Work. | "Saved on this phone", then Synced; in Review one task. | `capture_received` (source app, scope work, duplicate false). |
| 6 | **Offline capture (A2).** Airplane Mode on. Capture "Test 2 offline". Swipe the app away. Reopen: listed under "On this phone". Airplane Mode off. | Syncs once; Memory search "Test 2" finds exactly one. | Exactly one `capture_received` for that id (no second with duplicate false). |
| 7 | **Save to the computer (A20).** Memory > Export > All, save to Files, AirDrop or email it to the computer. | A `harrison-os-all-<date>.json` file opens on the computer. | `export` event with the counts. |
| 8 | **Session expiry (A3).** Zero Trust > Access > Applications > **only** Harrison OS > Configure > Revoke existing tokens (never per-user revocation or `/cdn-cgi/access/logout`: those end every Access app, including PM and Field Hub). Capture "Test 3 after expiry". | (a) "Sign in again", capture kept, syncs once after sign-in: **pass**; (b) works without a login page: record "interactive reauthentication not exercised" (not a pass). Another Access app is still signed in. | One `capture_received` for "Test 3" after the sign-in; outbox showed `auth_required` before it. |
| 9 | **Tap after expiry (A11).** Send a test alert (or a 3-minute reminder), revoke Harrison OS tokens as in 8 before it shows, tap it when it arrives, sign in. | The app opens, keeps the acknowledgement, sends it once after sign-in. | `delivery_acknowledged` exactly once, after the sign-in time. |
| 10 | **Alerts denied (A9).** Settings > Notifications > Harrison OS > off. Open the app. | Memory says alerts are blocked; reminders stay scheduled (Reminders list unchanged). | Reminder rows still `active`; later deliveries `sent` or `failed` with the push service's status (not proof of display). |
| 11 | **Accessibility (A21).** VoiceOver through Today, Capture, Memory, Reminders; Reduce Motion on, complete a task. | Every control announced with a name; no completion animation. | Phone only. |
| 12 | **Shortcut (optional).** After root's `scripts/service-check.mjs shortcut` passes, build it from `docs/SHORTCUT.md`; run once online, once offline. | Online: "Saved to Harrison OS" notification. Offline: the failure alert and the words on the clipboard. | One `capture_received` with source `shortcut`; nothing for the offline run. |

## Computer-side checks before the phone (root)

```bash
HOS_URL=https://<app host> SHORTCUT_CLIENT_ID=<id> SHORTCUT_CLIENT_SECRET=<secret> node scripts/service-check.mjs shortcut
```

```bash
HOS_URL=https://<app host> MCP_CLIENT_ID=<id> MCP_CLIENT_SECRET=<secret> node scripts/service-check.mjs mcp
```

The Shortcut check writes nothing unless `--write` is added (then one capture labelled "Service check ... safe to delete" in Work, plus a retry that must come back as a duplicate), and it checks the server refuses every scope outside `--expect-scopes` (default `work`) with 403. If the server wrongly accepts one, that probe saves one labelled capture and the check fails. The MCP check prints tool names and sizes only. Neither prints a secret. Run them from a shell whose history you control.

## Not covered here

- The two-week pilot (adoption, correction burden, missed follow-ups) is later validation.
- AI, calendar and PM live checks need their credentials or, for PM, a digest endpoint built in the PM app (see ACCEPTANCE.md).

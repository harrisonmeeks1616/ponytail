# Read-only calendar (ICS)

Harrison OS shows fixed events and busy time from your calendar on Today. It only **reads** calendars. It never creates, changes or deletes calendar events, and it is **not** an alert route: an ICS feed is fetched every 30 minutes at best and cannot wake a phone. Reminders stay in Harrison OS's own reminder route.

Code: `src/ics.js` (pure parser and recurrence expansion), `src/calendar.js` (routes, storage, fetching, cron unit), `migrations/0005_calendar.sql`, `public/views/calendar.{js,css}`. Tests: `tests/ics.test.mjs`, `tests/calendar.test.mjs`, fixture `tests/fixtures/calendar/work-feed.ics` (synthetic).

## Connecting a calendar

Memory → **Calendar (read-only)**:

- **Add a calendar link.** Paste the calendar's private iCal (ICS) address. `webcal://` links are accepted and fetched over `https://`. Where to find it:
  - Google Calendar: Settings → your calendar → *Integrate calendar* → *Secret address in iCal format*.
  - Apple iCloud: Calendar → share the calendar → *Public Calendar* → copy link.
  - Outlook / Microsoft 365: Settings → Calendar → *Shared calendars* → *Publish a calendar* → ICS link.
- **Import a .ics file.** A snapshot of the next six months. It never updates; import a newer file to replace it.
- **Try with sample events.** A synthetic calendar built for today, labelled *Sample* everywhere. Loading it again replaces it.

Each calendar belongs to one scope (Work or Personal), chosen when it is added.

## Privacy and secrets

- The feed URL is a secret: anyone who has it can read that calendar. It is stored only in the server database (`calendar_connections.url`), never returned by the API (the UI shows only its host), never logged. Removing the calendar in Harrison OS deletes the stored link; to revoke it everywhere, reset the secret address in the calendar app.
- Only title, location and times are kept. Descriptions, attendees, attachments and `X-` properties are never read or stored.
- `CLASS:PRIVATE` or `CLASS:CONFIDENTIAL` events keep no title or location at all; they show as **Busy** in every view.
- Scope: in the Work view, Personal events appear only as **Busy** blocks. Their title and location are removed in the SQL query, so they never leave the database for a work read. Personal events marked free (`TRANSP:TRANSPARENT`) are left out of Work entirely. The same rule applies the other way round. The All view (private all-life view) shows everything.
- Calendar text is untrusted. It only becomes inert titles and times; it cannot change a calendar's scope or sample flag or touch any other record (tested in `calendar.test.mjs`).

## Freshness and health

| State | What Today and Memory say |
|---|---|
| Never checked | "Not checked yet." |
| Updated in the last 2 hours | "Updated 12 min ago." |
| Older than 2 hours | "Last updated 3 hours ago. It may be out of date." |
| Last refresh failed | A plain reason (link no longer works, refused, not a calendar, too large, did not answer in 8 seconds, ...) plus "Showing events from 3 hours ago." The previous events are kept, never silently emptied. |
| Imported file | "From a file imported Oct 31, 11:21 AM. It does not update." |

The cron entry point `onScheduled(env, nowMs)` refreshes at most one link per call: the one whose last attempt is oldest and more than 30 minutes ago (never-checked links first, older links first among them). It stamps the attempt before fetching, so a run cut off mid-refresh (CPU or wall-clock limit) does not keep picking the same link and starving the others, and two overlapping runs never fetch the same link. Wire it after reminder delivery in `runScheduled`, so a slow feed can never delay a reminder. Manual **Refresh** is in the Memory card.

Fetch limits: https only (every redirect re-checked), at most 3 redirects, 8 seconds for the whole refresh including the body, 2 MB, no credentials in the URL, no loopback or IP-literal hosts. Each refresh has its own `AbortController`.

## What the parser supports

RFC 5545 line unfolding; `VEVENT` (nested `VALARM` ignored); `DTSTART`/`DTEND`/`RECURRENCE-ID`/`EXDATE` in UTC, with an IANA `TZID` (common Windows zone names such as "Eastern Standard Time" are mapped), floating (read in the calendar's `X-WR-TIMEZONE`, else America/New_York), or `VALUE=DATE` (all-day events stay date-only); `DURATION`; `RRULE` with `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`, `WKST`, `BYDAY` (weekly; and monthly with an ordinal such as `2TU` or `-1FR`) and `BYMONTHDAY` (monthly); `EXDATE`; `RECURRENCE-ID` overrides (moved or cancelled instances); `STATUS:CANCELLED` skipped.

Repeating events stay at their wall-clock time across daylight-saving changes (src/time.js policy: a time in the spring-forward gap moves forward; a repeated fall-back time takes the earlier instant). Tested across the Nov 1, 2026 change.

Known limits (shown to the user, not hidden):
- A rule using other parts (`BYSETPOS`, `BYHOUR`, `BYMONTH`, monthly `BYDAY` without an ordinal, ...) shows only its first occurrence; the calendar's health line says how many.
- At most 2,000 occurrences are stored per calendar (the earliest in the window of 14 days back to 180 days ahead); the health line says when that cap was hit.
- A `TZID` that is neither IANA nor a mapped Windows name is read in the calendar's own zone. So are zones past the 40th distinct one in a file (counted the same way).
- Work is bounded per parse, not just output: a `COUNT` rule that began years ago skips straight to the window (its count stays exact), and one shared budget covers every event read, `EXDATE` value, rule period and occurrence. A hostile file stops there, marked as cut short, in well under a second (1000 decades-old daily `COUNT` series: ~0.2 s; any 2 MB file tried: under 0.5 s in Node).
- CPU: parsing a 2 MB feed took roughly 60 to 110 ms in Node in a synthetic benchmark. Small feeds fit the Workers Free plan's 10 ms CPU budget; large feeds may need the Paid plan.

## API

All routes need the normal owner session and, for writes, `X-Requested-With: XMLHttpRequest`. Writes name one scope; `all` is read-only.

- `GET /api/calendar/connections?scope=work|personal|all` → `{ connections }` (never the URL).
- `POST /api/calendar/connections { scope, label, url }` → 201 `{ connection }` (state `never`; call refresh next).
- `POST /api/calendar/connections/:id/refresh { scope }` → `{ connection }` with the new state. 409 `not_refreshable` for imported files.
- `POST /api/calendar/import { scope, label, ics_text }` → 201. 413 `too_large`, 422 `not_ics`.
- `POST /api/calendar/sample { scope }` → 201.
- `DELETE /api/calendar/connections/:id?scope=` → `{ deleted: true }`.
- `GET /api/calendar/events?scope=&from=&to=&tz=` → `{ events, connections, from, to }`. `from`/`to` are ISO instants or `YYYY-MM-DD` (midnight in `tz`, default America/New_York); default the next 7 days; at most 92 days.

Module contract for other tracks: `listEvents(db, viewScope, { fromMs, toMs })` returns `{ id, connection_id, scope, title, location, start_at, end_at, start_on, end_on, all_day, time_zone, busy_only, shows_as, sample, source_ref: 'event:<id>', fetched_at }`. Event ids are stable across refreshes of the same feed. `purgeRef()` returns `[]` (calendar rows never cite captures or items).

## Not verified here

Fetching a real provider feed (Google, iCloud, Outlook) from a deployed Worker has not been observed; only synthetic feeds through a fake fetch, plus the local browser flow with the sample calendar and an imported file.

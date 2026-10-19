# Field app hub (optional)

The app works with no server: phones pass work to each other by texted links. The **hub** adds one central, durable log,
a live view, remote assigning / reviewing / editing, and Google Translate for typed text. It is one Google Apps Script
web app plus one Google Sheet in the owner's Google account. With no hub configured the app behaves exactly as before.

This file is the contract between the server (`hub/Code.gs`), the client sync engine (`sync.mjs`) and the screens
(`live.mjs`). Change it first, then the code.

## Principles

1. **Offline first.** Every phone keeps working from its own localStorage. The hub only syncs those stores. No tap ever waits on the network.
2. **One writer per field.** Each field belongs to one role, and only that role's phones change it. That removes almost every merge conflict. Between phones of the same role the newest stamp wins.
3. **The hub is the durable log; phones keep a recent window** (crews 14 days, PM and superintendent 60 days). Older records are browsed from the hub on demand (`records`), not stored on the phone.
4. **The server enforces roles.** The client UI is not a security boundary.
5. **Deleting is PM-only and asks first.** Hours edits are PM-only.
6. Local-only fields (never synced): task `origin`, `from`, `gotAt`, `filedAt`, `updatedAt`.

## Roles and keys

A phone holds one key; `whoami` tells it the role. Keys are random, 32 characters of `[A-Za-z0-9]`, created by `setupHub()`.
The PM key is stored only as a SHA-256 hash and shown once. The crew and super keys are kept in Script Properties so the PM phone can
build invite links; the PM can `rotate` either one.

| Action | crew | super | pm |
| --- | :-: | :-: | :-: |
| whoami, translate | yes | yes | yes |
| pull tasks, config | yes (window) | yes | yes |
| pull shifts | own device only | own, plus today's on-site list | all |
| pull reports, events | no | yes | yes |
| push crew part of a task | yes | yes | yes |
| push assign part, review, reply, create task | no | yes | yes |
| push config | no | yes | yes |
| push own shifts (worker rules) | yes | yes | yes |
| push shifts with PM rules (edit, add, rename, remove) | no | no | yes |
| push report super part | no | yes | yes |
| push report PM part (decision answers, pmReview) | no | no | yes |
| records (archive browse) | no | tasks, reports | all |
| purge (hard delete), stats, keys, rotate, archive, selftest | no | no | yes |

Wrong keys: no detail in the error, and after 30 bad keys in a minute every request answers `busy` for a minute (CacheService counter).

## Entities

### Task (key `uid`)
- **Office part** (super, pm): `ASSIGN` fields (`id date by floor area crew members size scope refs allot allotNote est estNote pStart pStop checkIn`), the structure of `items` and `checks` (their `id` and `text`), `review reviewer followUp`, the new `reply replyAt replyBy`, `aLang` (language the assignment text is written in), `sentAt`, stamp `assignAt`.
- **Crew part** (any role): `CREW` fields (`lead aStart aStop delay status doneText remain comments cLang resultAt`), `done` and `at` of every item and check, stamp `crewAt`.
- A push replaces a part only if the incoming stamp is >= the stored stamp (ties: incoming wins). The server clamps a stamp more than 5 minutes ahead of server time to server time.
- A crew key sending office fields has them ignored (`forbidden` is reported for the entity only if nothing else applied).
- Checklist merge: office structure wins for which items exist; done and at come from the stored crew part by item `id`. A new item starts not done.
- Delete: PM `purge` (also reachable as `deleted` in a push by pm). The server keeps a tombstone 90 days so phones remove it on their next pull.
- Crew phones show the task as `origin: 'link'`; office phones as `origin: 'mine'`.

### Shift (key `id`; fields as `SHIFT_TPL` in shared.mjs: `id device who date in out crew tasks edited{who,in,out} gone at`)
- `crew` (the crew the person is on, from the roster) and `tasks` (task IDs they were assigned that day, e.g. `["T1019-02"]`) are set by the worker's phone at clock-in and clock-out and follow the same worker rules as `in`; the PM can change them. Names are matched to the roster (Settings crew members) case- and accent-insensitively.
- **Worker rules** (any key, shifts the key's own device made): new id is added unless a non-gone PM-added shift (empty `device`) for the same person and date exists, in which case it is stored `gone: true`. Existing id: only if the stored `device` matches; updates `who` only if `at` is newer and `edited.who` is false; `in` and `out` follow the phone unless `edited.in` / `edited.out`; an older text never undoes a clock-out; `gone` shifts are never revived. The client never sets `edited` or `gone` for itself: the server sets `edited` flags false for worker pushes.
- **PM rules** (pm key): the shift is stored as sent (fields validated), including `edited`, `gone`, and PM-added shifts (empty `device`).
- Hours math is identical on client and server: clock-in to clock-out in real minutes (DST-correct, overnight = next morning), payroll hundredths `round(minutes * 5 / 3)` per shift, summed (`cents` in report.mjs). The server's timezone is America/New_York (the job's).

### Report (key `date`)
- **Super part**: everything except the PM part; stamp `updatedAt`.
- **PM part**: `decisions[].pm` and `pmNote` (matched by `q`), `pmReview`; stamp new `pmAt`.
- Same replace-if-newer rule per part. `lang` records the language the report was written in.

### Config (single document)
Synced by super or pm: `project site super pm floors crews checks pin` (`pin` is the office passcode hash, so a new crew phone can show a lock). Never `folderUrl`, `siteCode`, `hubKey`. Crew phones read it for the crew list and floors.

### Event (server-written, append only)
`rev, ts, who, role, kind, text, ref`. Written by the server from what changed: task created, started (`aStart` first set), status set (Complete, Partial, Blocked), reviewed, replied; clock in, clock out, PM edit; report sent. `text` is a short English line. The PM Live feed shows them newest first.

## Transport and API

`POST` to the web app URL, body = JSON as `text/plain` (a "simple" request, no CORS preflight). Reply is JSON: `{ok:true, ...}` or `{ok:false, error, message}`, `error` one of `bad_request unauthorized forbidden busy too_large quota not_ready server`. Request: `{v:1, key, action, dev, ...}`. Size caps: body 1,000,000 characters, 200 entities per push, one entity's JSON 45,000 characters (a sheet cell holds 50,000), lists 500 as everywhere else. All times `Date.now()` ms; dates `YYYY-MM-DD`; times `HH:MM`.

| action | request extras | reply extras |
| --- | --- | --- |
| `whoami` | | `role, name?, rev, now, tz, version, sheetUrl?` (pm) |
| `pull` | `since` (rev, 0 = full), `days` (default 14, max 90), `crews?` | `rev, now, same?:true` when nothing changed; else `tasks[], shifts[], reports[], config?, events[], deleted[{kind,key,rev}], onsite?[{who,in,date}]` (super). Every entity carries its `rev`. |
| `push` | `tasks[], shifts[], reports[], config?, deleted[{kind,key}]` (pm) | `rev, tasks[{key,status:'ok'\|'rejected',reason?,task?}], shifts[...], reports[...], config?` with each entity's canonical merged copy |
| `translate` | `items[]` (max 25, each text <= 2000 chars), `from`, `to` ('en'\|'es') | `items[]` same order, `cached?:n`. Error `quota` when Google's daily limit is hit. |
| `records` | `kind, from, to, who?, q?, cursor?` | `items[]` (<= 200), `cursor?` |
| `purge` (pm) | `kind, key` | `rev` |
| `stats` (pm) | | `rows{tasks,shifts,reports,events}, cells, cellLimit, sheetUrl` |
| `keys` (pm) | | `crew, super` |
| `rotate` (pm) | `role:'crew'\|'super'` | `key` |
| `archive` (pm) | `before:'YYYY-MM-DD'` | `sheetUrl, moved{...}` (creates an archive Sheet and moves older rows into it) |
| `selftest` (pm) | | `checks[{name,ok,detail}]`: write, read, merge rules, translate a sentence containing a drawing number, delete |

`rev` is one global counter in Script Properties, bumped by every write; a no-change `pull` costs one property read.

## Google Sheet (created by `setupHub()`, drive.file scope, written with the Sheets advanced service, `valueInputOption: RAW` so typed text can never run as a formula)

Readable tabs, each with a bold frozen header; the machine copy is the last column `data` (JSON), before it `key` and `rev`:
- **Tasks**: Date, Task ID, Crew, Floor, Area, Status, Steps done, Minutes worked, Scope, Completed, Remaining, Crew comments, Review, Follow-up, Reply, Updated.
- **Hours**: Name, Week of (Monday), Date, Day, Clock in, Clock out, Hours, Edited by PM, Note (No clock-out).
- **Weekly totals**: one row per person per week: Name, Week of, Hours, Shifts, Open shifts (rewritten by the server on every shift write).
- **Reports**: Date, Superintendent, Status, Results, Wins, Issues, Decisions waiting, PM review.
- **Activity**: When, Who, What, Ref.
- **Deleted**: key, kind, rev, when. **Config**: one JSON row.
The owner can open the Sheet on any phone and read everything labeled by person, week and task. Sheets hold 10 million cells; `stats` reports use and the app warns at 70%.

## Client contract (`sync.mjs`)

Settings gain `hubUrl`, `hubKey`, `hubRole` (set after `whoami`), `hubCrew` (crew phones: the crew they joined), `device` (exists). Stores gain nothing new except the fields named above.
- **Detection by diff, not by hooks.** The engine reads the local stores straight from localStorage (`KEYS.tasks`, `KEYS.hours`, `KEYS.crewHours`, `KEYS.reports`, `KEYS.settings`), hashes each entity, and pushes the ones whose hash differs from `schwab.hubSync.hashes[key]`. `poke()` (debounced 1.5 s) is called after the app saves, but correctness never depends on it: a 20 s timer and visibility, online and focus events also run a cycle.
- **Cycle** = push dirty entities, then `pull`. Pulled entities are merged into the local stores by the ownership rules above and saved; then `onChange(kinds)` is called synchronously so the app reloads its in-memory copies (`T`, `R`, `MY`, `CREW`) before any further tap. The app must not re-render under a focused text field: if one is focused it waits for blur.
- Offline or error: nothing is lost (dirty set persists); status goes to `offline`; retries back off 5, 10, 20, 40, 60 s. A rejected entity is reported once and then left alone until it changes.
- **Roles on a phone**: `crew` role phones write only the crew part of tasks and their own shifts; the engine does not even attempt office fields. `super` and `pm` phones write what their role allows. The PM phone is the only one whose local `crewHours` store (the timesheet) is pushed with PM rules.
- **Window**: after a pull, local entities older than the window and not dirty are dropped from the phone (they remain in the hub).
- **Status** for the header dot: `off` (no hub), `live` (last cycle ok, < 60 s ago), `syncing`, `offline`, `error` (bad key or server problem; message).
- Exports: `initHub({ S, onChange, toast })`, `hubStatus()`, `poke()`, `cycle()`, `joinFrom(data)`, `connect(url, key)` (runs `whoami`, saves role), `disconnect()`, `invite(role, crew?)` (returns an app link `#p=` of kind `join`), `translate(items, from, to)`, `records(query)`, `stats()`, `purge(kind, key)`, `rotate(role)`, `archive(before)`, `selftest()`.
- **Join link** (kind `join`): `{v:1, kind:'join', hub:{url, key}, role, crew?}`. Opening it on a phone saves the hub settings, runs `whoami`, and on a crew phone asks (once) for the person's name and crew. The invite is deliberate and PM-initiated; the crew key can only do crew-level things, and `rotate` kills a lost phone's access.

## Translation

- Typed text keeps the language it was written in (`aLang` for assignment text, `cLang` for crew results, report `lang`; missing means `'en'`). On screen it is shown in the viewer's language: translated text first, with a caption "Auto-translated" and a tap to see the original. If the viewer's phone language equals the text's language nothing happens.
- Read-only places show the translation; fields the viewer edits keep their own text and show a translated preview line under them.
- Cache: localStorage `schwab.tr`, key `from|to|hash(text)`, bounded at 800 entries (oldest out), permanent otherwise; requests batched (<= 25) and only for text on screen. No hub, or offline, or `quota`: show the original with a one-line hint (once per session).
- The server translates in HTML mode so identifiers survive: drawing and task numbers (`E-301`, `T1019-02`), quantities with units and trade abbreviations (EMT, AWG, MC, GFCI) are wrapped `<span translate="no">`, newlines become `<br>`, and the result is unescaped. `selftest` proves a drawing number survives on the real service.
- Google Translate is machine translation: expect occasional wrong trade terms. The original is always one tap away.

## Screens (`live.mjs`)

- **Live** (super, pm; tab shown when the hub is connected): header with status dot, last update, Refresh; **On site now** (name, since); **Today's sheets** grouped by crew with step progress, status pill, last activity ("2 min ago"), Message and Review buttons; **Activity** feed (50, newest first). Tapping a card opens the task. Messages set `reply` on the task and show on the crew's sheet as soon as their phone pulls.
- **Records** (office phones, also useful with no hub, built from the local stores): By person (people, then weeks with totals, then shifts; the PM can jump to edit), Task sheets archive (by date, crew, status, search), Reports. With the hub, older records load on demand through `records`. PM: delete with confirm, **Download all** (JSON), per-week CSV, **Open the Google Sheet**, storage meter and **Archive older than...**.
- **Settings > Hub**: connect (URL, key), status, **Test the hub** (`selftest`), invite crew / invite superintendent (text links), rotate keys, disconnect. Crew phones show only status and disconnect.
- **Crew phone with a hub**: sheets for their crew appear on the Tasks tab by themselves; ticks, start and stop sync as they happen; **Send results** still marks the sheet finished and still opens a text as the fallback. Time clock taps push at once; the text to the PM stays as the offline fallback.
- Everything new goes through `L()` with Spanish from the start (the audit in the test suite checks it).

## Security checklist (the review will check each)

- Keys never in URLs, logs, errors or the Sheet; PM key hash only; constant-time compare; bad-key throttle.
- Role checks on every action server side; entity fields filtered by owner; crews cannot read other people's hours or any reports.
- Every inbound entity validated (types, caps, uid / date / time formats, strings clipped) before it is stored; Sheet writes RAW.
- Responses never include other roles' secrets; errors never echo submitted data; no stack traces.
- Daily guards: translate calls per UTC day capped (default 1,500), pushes capped per minute per key; `quota` and `busy` degrade the app to its offline behavior.
- Client: all hub data goes through the existing `normTask` / `normShift` / `normReport` / `shape` before it touches the screen; everything shown is escaped.

## Deploy (summary; the README has the steps)

1. New Apps Script project, paste `hub/Code.gs` and `hub/appsscript.json`.
2. Run `setupHub()` once (approve the scopes). It creates the Sheet and prints the three keys and the Sheet link to the execution log.
3. Deploy as web app (execute as you, access anyone); first verify privately, then approve anonymous access.
4. In the app: Settings > Hub: paste the web app URL and the PM key; **Test the hub**; **Invite crew**.

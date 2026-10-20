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
6. Local-only fields (never synced): task `origin`, `from`, `gotAt`, `filedAt`, `updatedAt`, `news` (an office message or follow-up reached this crew phone: marked on the board until the sheet is opened).

## Roles and keys

A phone holds one key; `whoami` tells it the role. Keys are random, 32 characters of `[A-Za-z0-9]`, created by `setupHub()`.
The PM key is stored only as a SHA-256 hash and shown once. The crew and super keys are kept in Script Properties so the PM phone can
build invite links; the PM can `rotate` either one.

| Action | crew | super | pm |
| --- | :-: | :-: | :-: |
| whoami, translate | yes | yes | yes |
| pull tasks, config | yes (window; sent sheets only, never a draft) | yes | yes |
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

Wrong keys: no detail in the error, and no lockout: the hub cannot tell callers apart, so a lockout would stop every phone, and a 32-character key cannot be guessed online. A right key is never refused `busy` because of wrong ones.

## Identity (devices, people, crews, tasks)

- **Devices are authenticated, never self-described.** Every phone has a private device secret: 32 random characters in its own localStorage key `schwab.device` (its own key, so an old tab rewriting settings cannot wipe it). The device id is the first 32 hex characters of SHA-256(secret). Every hub request carries `devSecret`; the server derives `ctx.dev` from it and ignores any `dev` the caller sends. Worker-rule shift writes get `device = ctx.dev` forced; pulls filter by the derived id. Knowing another phone's device id (it appears in texts and the Sheet) gives no access to it. A phone that has an older random device id and no secret creates a secret when it connects and re-labels its own local shifts; a shift already texted to the PM under the old id stays on the PM's copy for the PM to edit (documented tradeoff). Texted links without a hub stay unauthenticated by nature: the PM opens links from people they know.
- **People and crews have stable ids.** Settings hold `crews: [{id, name, lead, members}]` and `people: [{id, name, crewId}]`; `people` is the roster and the source of truth, and `crews[].members` is kept as a derived list for older versions. Names are matched (case, spacing and accent insensitive) only when someone picks or types a name; from then on the id is the identity. Two people may share a name: screens show the crew next to it, and adding a duplicate name asks first. Renaming a person or crew keeps the id, so assignments and hours history stay attached; screens show the current name, and old records keep the label they were made with.
- **Tasks link by uid.** Anything that points at a task stores its permanent `uid` and, for display, the short id at that time: shifts hold `tasks: [{uid, id}]`. Short ids are labels and may collide between office phones that worked offline: an office phone renumbers its own not-yet-sent sheet when a synced sheet has the same date and short id. So that it can, an office phone pushes a sheet the hub has never had, and that was never texted, only after that cycle's pull. If both were already sent, or both phones pushed in the same moment, both show "Same number as another sheet" until someone renames one.
- Tasks carry `crewId` and `memberIds` next to `crew` and `members`; shifts carry `pid` and `crewId` next to `who` and `crew`.
- **Round trip.** Every synced field exists in the templates (`SETTINGS_TPL`, `TASK_TPL`, `REPORT_TPL`, `SHIFT_TPL`), so normalization never strips it; tests push every field through sync, reload and backup/restore. Backups leave out `hubKey` (a secret) and keep the device secret. A backup also carries `schwab.hubSync` (what the hub had of each record), which a restore writes last: only what was unsynced at backup time goes up, and what reached the hub since comes back. A backup without it (or a restore cut short) leaves none, so the next round merges pull-first and newer hub copies win.

## Entities

### Task (key `uid`)
- **Office part** (super, pm): `ASSIGN` fields (`id date by floor area crew members size scope refs allot allotNote est estNote pStart pStop checkIn`), the structure of `items` and `checks` (their `id` and `text`), `review reviewer followUp`, the new `reply replyAt replyBy`, `aLang` (the language the office part was first typed in), `aLangs` (the language of each office text by its field or step id, `{scope:'es', reply:'en', <step id>:'es'}`), `sentAt`, stamp `assignAt`.
- **Crew part** (any role): `CREW` fields (`lead aStart aStop delay status doneText remain comments cLang cLangs resultAt`), `done` and `at` of every item and check, stamp `crewAt`. `cLangs` is `aLangs` for the crew's texts (`doneText remain comments`).
- `aLangs` and `cLangs` hold only `'en'` or `'es'` under a field name or a step id (at most 300). With a base they merge key by key like the fields, so a push that did not touch a text never relabels it.
- A push replaces a part only if the incoming stamp is >= the stored stamp (ties: incoming wins). The server clamps a stamp more than 5 minutes ahead of server time to server time.
- A crew key sending office fields has them ignored (`forbidden` is reported for the entity only if nothing else applied).
- Checklist merge: office structure wins for which items exist; done and at come from the stored crew part by item `id`. A new item starts not done.
- Two phones on one crew: a crew part push may carry `crewBase`, the crew part (crew fields, `items` and `checks` as `{id, done, at}`, ticked ones only) as that phone last had it from the hub. With it, only the fields and steps the phone changed since then are applied, each where the stored value is still the base's or the push's stamp passes the rule above; so a phone that has not pulled yet never wipes another phone's taps, and a value both changed goes to the newer stamp. Without it the whole part follows the stamp rule.
- Two office phones: an office part push may carry `assignBase` the same way (the office fields, `items` and `checks` as `{id, text}`). With it, only the fields the phone changed since are applied as above, and the steps merge by id: steps it added or reworded go in, steps it took out leave, and another phone's added, reworded or removed steps stay so. So the superintendent fixing a floor never wipes the PM's message, and an offline edit comes back without undoing the newer one. Without it the whole part follows the stamp rule. A push too big with its bases goes without them.
- Delete: PM `purge` (also reachable as `deleted` in a push by pm). The server keeps a tombstone 90 days so phones remove it on their next pull.
- Crew phones show the task as `origin: 'link'`; office phones as `origin: 'mine'`.

### Shift (key `id`; fields as `SHIFT_TPL` in shared.mjs: `id device who date in out crew tasks edited{who,in,out} gone at`)
- `crew` (the crew the person is on, from the roster) and `tasks` (task IDs they were assigned that day, e.g. `["T1019-02"]`) are set by the worker's phone at clock-in and clock-out and follow the same worker rules as `in`; the PM can change them. Names are matched to the roster (Settings crew members) case- and accent-insensitively.
- **Worker rules** (any key, shifts made by the device authenticated by `devSecret`; see Identity): new id is always added, even when the PM has already entered that person's day by hand: those are the real punches, so both shifts show on the PM's timesheet (and in Activity) for the PM to see and settle, and the worker's clock keeps its own. An hours text opened on a hub PM phone adds them the same way (it never files them removed), and Crew hours and Send to accountant flag such a day, so it is not counted twice unseen. Existing id: only if the stored `device` matches; updates `who` only if `at` is newer and `edited.who` is false; `in` and `out` follow the phone unless `edited.in` / `edited.out`; an older text never undoes a clock-out; `gone` shifts are never revived. The client never sets `edited` or `gone` for itself: the server sets `edited` flags false for worker pushes.
- **PM rules** (pm key): the shift is stored as sent (fields validated), including `edited`, `gone`, and PM-added shifts (empty `device`). A PM push carries `pmAt`, the PM phone's edit stamp (the hub keeps the newest; phones do not store it), and `base`, the shift as that PM phone last had it from the hub. With a base, only what that phone changed since is applied, field by field (`who`, `in`, `out` each with its `edited` flag; `pid crew crewId tasks date gone`), and a value both changed goes to the newer `pmAt`: a fix on a PM laptop and one on the PM phone both stand, and a PM phone that has not pulled a clock-out or a newer name yet changes neither. Without one, an older `pmAt` changes nothing, and a newer one is stored as sent, except that it never erases a clock-out the phone has not pulled yet nor undoes a newer name from the worker's phone.
- Hours math is identical on client and server: clock-in to clock-out in real minutes (DST-correct, overnight = next morning), payroll hundredths `round(minutes * 5 / 3)` per shift, summed (`cents` in report.mjs). The server's timezone is America/New_York (the job's).

### Report (key `date`)
- **Super part**: everything except the PM part; stamp `updatedAt`.
- **PM part**: `decisions[].pm` and `pmNote` (matched by `q`), `pmReview`, `pmLang`; stamp new `pmAt`. A PM part push carries `pmBase`, the PM part (`pmReview`, `pmLang`, `decisions` as `{q, pm, pmNote}`) as that PM device last had it from the hub, or `null` (a blank base). With it, only the answers (each `[pm, pmNote]` by `q`), `pmReview` and `pmLang` it changed since are applied, as with `supBase`: a PM phone and a PM laptop answering different decisions both stand, and one both changed goes to the newer `pmAt`. Without it the newer `pmAt` takes the whole part. The stored `pmAt` is the PM part's version: a push that changes it moves it past the stored one even when its own stamp is older (the larger of stored + 1 and the push's), so a phone that has not pulled that answer never holds it as seen.
- Same replace-if-newer rule per part. `lang` records the language the superintendent's part was written in, `pmLang` the PM's.
- A super part push carries `supBase`, the super part (`decisions` as `{q, rec, by}`) as that phone last had it from the hub, or `null` when it never had one (a blank base: everything it has, it added). With it, only what the phone changed since is applied, as with a sheet's `assignBase`: each field, and in `needs`, `decisions`, `floors` (and each floor's `crews`), `next` and `risks` each entry, matched by its first field (`item`, `q`, `floor`, `name`, `step`, `risk`; the nth of a repeated one to the nth). Another phone's added entries stay, and an entry one phone took out and the other changed stays. So the PM typing one line never wipes the superintendent's report, offline or not. Without `supBase` (a push too big with it) the whole part follows the stamp rule.
- A decision is matched by its super fields only (`q rec by`); its PM answer is not part of the super part. `supBase.pmAt` is the PM part stamp that phone last had: when it is the stored `pmAt` or newer, a decision the phone took out or reworded goes, answer and all, so the superintendent can remove or reword a question the PM answered. Otherwise (the PM answered since, or no `supBase`) an answered decision the push left out is kept as its own entry: an answer is never dropped unseen.
- A cleared report (purge) leaves its day open: a push with `supBase: null` and a super part stamp is that day's new report, so it is stored and the day's tombstone is removed (a phone that missed the clear then gets the new report, not a delete). A push from a phone holding the cleared copy is still refused `deleted`; the phone drops that record at once, as the tombstone would.

### Config (single document)
Synced by super or pm: `project site super pm floors crews people checks pin` (`pin` is the office passcode hash, so a new crew phone can show a lock). Never `folderUrl`, `siteCode`, `hubKey`. Crew phones read it for the crew list and floors.
A push may carry `base`, the settings as that phone last had them from the hub. With it, only what the phone changed since is applied, as with a sheet's `assignBase`: each field it changed, and in `people`, `crews` (by id), `floors` and `checks` (by text) the entries it added, changed or removed; another office phone's changes stay. Without it the newer `at` takes the whole document.

### Event (server-written, append only)
`rev, ts, who, role, kind, text, ref`. Written by the server from what changed: task created, started (`aStart` first set), status set (Complete, Partial, Blocked), reviewed, replied; clock in, clock out, PM edit; report sent. `text` is a short English line. The PM Live feed shows them newest first.

## Transport and API

`POST` to the web app URL, body = JSON as `text/plain` (a "simple" request, no CORS preflight). Reply is JSON: `{ok:true, ...}` or `{ok:false, error, message}`, `error` one of `bad_request unauthorized forbidden busy too_large quota not_ready server`. Request: `{v:1, key, action, dev, ...}`. Size caps: body 1,000,000 characters, 200 entities per push, one entity's JSON 45,000 characters (a sheet cell holds 50,000), lists 500 as everywhere else. All times `Date.now()` ms; dates `YYYY-MM-DD`; times `HH:MM`.

| action | request extras | reply extras |
| --- | --- | --- |
| `whoami` | | `role, name?, rev, now, tz, version, sheetUrl?` (pm) |
| `pull` | `since` (rev, 0 = full), `days` (default 14, max 90), `crews?`, `pid?` | `rev, now, same?:true` when nothing changed; else `tasks[], shifts[], reports[], config?, events[], deleted[{kind,key,rev}], onsite?[{who,in,date}]` (super). Every entity carries its `rev`. A crew phone sends its person's crew on the roster (else the crew it joined) as `crews`, and their roster id as `pid`: a sheet whose `memberIds` lists that person comes too, whatever its crew. With `crews`, a sent sheet that changed and is now another roster crew's (and does not list `pid`) is listed in `deleted` with `moved: true`, so it leaves the old crew's phones; a phone keeps one it got only by text, or one with work it has not pushed yet (that work goes up first, and the sheet leaves on a later pull). |
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

## Protocol details, as built (wave 1)

- `purge` names the record as `target` (the request's `key` is always the credential). Kinds are plural on output (`tasks shifts reports`, `events` in records), singular accepted on input.
- Push results carry `i` (index in the request list); `key` is '' when the sent key had an unsafe shape. Refusal reasons are a fixed list: `forbidden invalid too_large device deleted archived`. Caps apply per kind (200 each) plus the 1,000,000 character body cap.
- A part stamp of 0 means "not sent" and never replaces a stored part. A key writing the other role's part (an office key editing the crew part, the PM editing the super part of a report) needs a strictly newer stamp; ties go to the incoming copy only for the part's own role.
- Every task push carries `uid` and `date`. A crew phone's push carries only those plus crew fields and ticks.
- Shift `crew`, `tasks` (and `pid`, `crewId`) follow the phone only until the PM has touched the shift (any `edited` flag).
- Config carries an `at` stamp; first contact adopts the hub's config instead of pushing a phone's defaults.
- Pulls cap lists at 500 and then return `more: true` with the `rev` actually covered. First cycle after connect (or a role, crew or window change) is pull, push, pull. On an office phone, a new unsent sheet the hub has never had goes up after the cycle's pull (push, pull, push, pull), so a synced sheet with its day and number renumbers it first (Identity).
- Deletion is only ever an explicit `purge` (never inferred from a missing local copy); a tombstone reaches other phones on their next pull. A sheet moved to another crew reaches the old crew's phones the same way (see `pull`).
- Archive moves hours in whole Monday to Sunday weeks; a later push of an archived record is refused with `archived`.
- Rate caps: 40 pushes a minute per phone, 300 per key (`busy`). A wrong key is retried every 10 minutes, not on the short backoff. A join link must carry the role `whoami` reports; PM links are refused (the PM key never travels).

## Client identity API (shared.mjs) used by sync.mjs, live.mjs and report.mjs

- Device: `ensureDevice()` (async; creates `schwab.device` = `{secret, id}` once: secret 32 characters `[A-Za-z0-9]` from `crypto.getRandomValues`, id = first 32 hex characters of SHA-256(secret)); `deviceId()` and `deviceSecret()` read it synchronously ('' until ensured). A phone with an older random `settings.device` keeps working without a hub (texted links); when it first connects, its own local shifts are relabeled from the old id to the new one.
- Requests to the hub carry `devSecret`; the hub derives the device. Shifts store the derived id in `device`.
- People and crews: `SETTINGS_TPL.crews = [{id, name, lead, members}]`, `SETTINGS_TPL.people = [{id, name, crewId}]`. On load, settings without `people` take them from this phone's `schwab.roster` (a copy written with every settings save, so a tab still on an older version cannot re-key or shorten the roster; crews match by name), else they are migrated from the crews' `members` strings, and every crew gets an id; `members` stays derived (comma list of that crew's people) for older versions. Helpers: `people(S)` -> `[{id, name, crewId, crew}]`, `personById(S, id)`, `crewById(S, id)`, `findPerson(S, name)` (nameKey match; among duplicates it prefers the given crewId), `addPerson(S, name, crewId)`, and renames that keep ids.
- Tasks: `crewId`, `memberIds` next to `crew`, `members`. Shifts: `pid`, `crewId`, `tasks: [{uid, id}]` (a legacy string id becomes `{uid: '', id}`).
- `byPerson(shifts, l, S)` groups by `pid` when present, else by nameKey of `who`; the label is the roster's current name for that pid, else the first spelling seen.
- Hub config carries `people` and `crews` with their ids.

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
- Offline or error: nothing is lost (dirty set persists); status goes to `offline`; retries back off 5, 10, 20, 40, 60 s. A rejected entity is reported once and then left alone until it changes; one refused `deleted` leaves the phone quietly, as its tombstone would, since a phone already past that tombstone would never get it again. No phone pushes a sheet the hub never had without its office part (a crew phone: one texted by an office phone that is not on the hub), so a crew part alone never makes a blank sheet there; it counts as not sent. Connect, invite and the PM's one-off actions (purge, rotate, records, stats, archive, selftest) are not retried, so their failure reads "That did not work. Try again." (Settings > Hub's Connect adds that a hub it cannot reach may still be set to Who has access: Only myself); "Check the hub link" is said only when connecting, or for a page not found.
- **Another hub, or none**: disconnecting keeps everything the phone knew of that hub, and joining the same hub again picks up where it left off, so work not sent yet goes up first and merges with its bases (a crew tick never loses to another phone's tick on another step). Connecting to a different hub address keeps what the old hub had of each record (hashes, stamps and bases, not the refusals, the sync position or the settings), so what this phone already synced (another job's sheets and reports) is not uploaded to the new hub; the first round there is pull-first. Either way, edits made while disconnected go up ranked by when they were made (not by when the phone came back). A sheet saved by a tab of a version before the hub (no `assignAt`) never has its office part pushed: the next pull is a full one and brings the hub's copy back.
- **Roles on a phone**: `crew` role phones write only the crew part of tasks and their own shifts; the engine does not even attempt office fields. `super` and `pm` phones write what their role allows. A part the phone's role does not write is left as the hub last had it, never counted as sent, so a phone that joins the same hub again in another role (the superintendent who opened a crew invite, then his own) sends every part the new role writes that the hub does not have. Settings > Hub's Connect refuses the crew key (crew phones join by invite), a phone set to Project manager connects with the PM key only (Connect or an invite: its review and timesheet would never go up, and the first pull would blank them), refused before anything on the phone changes, and a signed-in phone the hub knows as a crew phone says so on Live and Tasks. The PM phone is the only one whose local `crewHours` store (the timesheet) is pushed with PM rules.
- **Window**: after a pull, local entities older than the window and not dirty are dropped from the phone (they remain in the hub).
- **Texts on a hub phone**: Send to crew, Send results, the day plan and the daily report still open a text. A text is a copy of what the hub delivers, so where it would change a sheet or report this phone has, `fromText(kind, key, part, at, skew)` decides: a part this phone already holds from the hub (or has an unsynced edit of) as new as the text's own time (`sentAt`, `resultAt`, the sheet's or report's `updatedAt`) is kept and the person is told so (a day plan judges each sheet by its office part's own stamp, which the sending phone puts in `assignAt`: `officeAt(t)`, never a pulled crew tick); otherwise the text is merged, and its change goes up stamped with the text's time, never the time it was opened, so newer work on the hub wins over it. A text made on a hub phone carries `skew` (that phone's hub time minus its clock, `hubStatus().skew`), so its time is read in hub time; a report text from a phone with no hub carries none. A results text for a sheet this phone does not hold yet sends its office part stamped as old as the copy it carries (its `assignAt`, else `sentAt`). A report text from a hub phone opened on a phone with no copy of that day is that phone's copy of the hub's report (its sender sends its own work up), so it is both parts' base (`supBase`, `pmBase`): an old text brings back nothing the hub took out since, nor a report the PM cleared. One from a phone with no hub has no base: everything in it is new to the hub. A sheet new to this phone from a hub phone's day plan text is the same: the text is both parts' base, so only what is changed here after goes up, never the whole office part stamped as the edit here; a results text's is its office part's base, and its crew part (the crew's own results) goes up from here by its stamp. A sheet or day plan text from a phone with no hub carries no `skew` either.
- **Status** for the header dot: `off` (no hub), `live` (last cycle ok, < 60 s ago), `syncing`, `offline`, `error` (bad key or server problem; message).
- Exports: `initHub({ S, onChange, toast })`, `hubStatus()`, `poke()`, `cycle()`, `joinFrom(data)`, `connect(url, key)` (runs `whoami`, saves role), `disconnect()`, `invite(role, crew?, crews?, people?)` (returns an app link `#p=` of kind `join`), `translate(items, from, to)`, `records(query)`, `stats()`, `purge(kind, key)`, `purgeLater(kind, key, due)` (a PM delete waiting out its Undo, stored so it is sent once due even after the app was closed; due 0 takes it back), `onHub(key, kind?)` (the hub has this sheet, or with `'report'` this report), `replyOnHub(t)` (the hub took this sheet's message as it is here: Live says sent only then), `rotate(role)`, `archive(before)`, `selftest()`, `fromText(kind, key, part, at, skew?, copy?)`, `officeAt(t)`.
- **Join link** (kind `join`): `{v:1, kind:'join', hub:{url, key}, role, crew?, crews?, people?}` (`crews`: the job's crew names, for an invite where the person picks; a new phone knows only its defaults. `people`: `[{name, crew}]`, the crew's people from the PM's roster, or everyone's for a "they pick" invite, so the person taps their name as the roster spells it; a typed name is matched to it, and one the roster does not have is questioned once). Opening it on a phone saves the hub settings, runs `whoami`, and asks (once) for the person's name: on a crew phone also the crew; on the superintendent's it is the name on the sheets they assign and their own time clock. The PM phone never trades its key for an invite to its own hub (its key was shown only once). The invite is deliberate and PM-initiated; the crew key can only do crew-level things, and `rotate` kills a lost phone's access.

## Translation

- Typed text keeps the language it was written in (a sheet's `aLangs`/`cLangs` per text, else its part's `aLang`/`cLang`; a report's `lang` and `pmLang`; missing means `'en'`). On screen it is shown in the viewer's language: translated text first, with a caption "Auto-translated" and a tap to see the original. If the viewer's phone language equals the text's language nothing happens.
- Read-only places show the translation; fields the viewer edits keep their own text and show a translated preview line under them.
- Cache: localStorage `schwab.tr`, key `from|to|hash(text)`, bounded at 800 entries (oldest out), permanent otherwise; requests batched (<= 25) and only for text on screen. No hub, or offline, or `quota`: show the original with a one-line hint (once per session).
- The server translates in HTML mode so identifiers survive: drawing and task numbers (`E-301`, `T1019-02`), quantities with units and trade abbreviations (EMT, AWG, MC, GFCI) are wrapped `<span translate="no">`, newlines become `<br>`, and the result is unescaped. `selftest` proves a drawing number survives on the real service.
- Google Translate is machine translation: expect occasional wrong trade terms. The original is always one tap away.

## Screens (`live.mjs`)

- **Live** (super, pm; tab shown when the hub is connected): header with status dot, last update, Refresh; **On site now** (name, since); **Today's sheets** grouped by crew with step progress, status pill, last activity ("2 min ago"), Message and Review buttons; **Activity** feed (50, newest first). Tapping a card opens the task (its Back returns to Live). Messages set `reply` on the task and show on the crew's sheet as soon as their phone pulls; Message says sent only once the hub has it, and on a draft that the message goes with the sheet.
- **Records** (office phones, also useful with no hub, built from the local stores), three segments with a search box: People (people, then weeks with totals, then shifts; the PM can jump to edit), Sheets (by date, crew, status, search), Reports. With the hub, older records load on demand through `records`. PM: delete (gone at once with Undo for 6 seconds; the hub purge goes once the Undo is over, and a refused purge puts the record back; the waiting purge is stored, so closing the app during the Undo does not keep the record on the hub). Any other phone on a hub deletes a sheet (or clears a report) only if the hub has never had it; otherwise it says only the PM can delete it, **Download all** (JSON), per-week CSV, **Open the Google Sheet**, storage meter and **Archive older than...**.
- **Settings > Hub**: connect (URL, key), status, **Test the hub** (`selftest`), invite crew / invite superintendent (text links), rotate keys, disconnect. Crew phones show only status and disconnect.
- **Crew phone with a hub**: sheets for their crew (the person's crew on the roster, and any sheet that lists the person) appear on the Tasks tab by themselves once **Send to crew** is tapped (a draft stays on the office phones); an office message or follow-up that arrives says so in the phone's language and marks the sheet's row until it is opened; a key the hub refuses says to ask the PM for a new invite; ticks, start and stop sync as they happen; **Send results** still marks the sheet finished and still opens a text as the fallback. Time clock taps push at once; the text to the PM opens when that round does not get through (no signal, hub busy, key replaced).
- Everything new goes through `L()` with Spanish from the start (the audit in the test suite checks it).

## Security checklist (the review will check each)

- Keys never in URLs, logs, errors or the Sheet; PM key hash only; constant-time compare; a wrong key only ever gets 'unauthorized' (no global breaker, so one bad caller cannot lock out every phone); pushes are capped per role and per device.
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

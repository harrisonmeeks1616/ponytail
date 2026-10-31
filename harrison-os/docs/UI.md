# Core UI (Slice 1 completion): what the screens do

Plain ES modules, no framework: `public/app.js` (screens), `public/outbox-core.js` (sync engine, attachment queue, small pure helpers that node tests import), `public/idb.js` (IndexedDB stores), `public/styles.css`. Client build `ui-3`. The API contract is T1a's (docs/build/TRACKS.md, T1a items 1-12; docs/API-core.md once merged).

## Capture

- **Text, paste, dictation**: the capture box. Saved on the phone first (outbox), then sent.
- **Add photo or file**: one button (a labelled file input, keyboard reachable). Images, PDF and plain text; up to 5 per capture. Pasting a picture into the box adds it as a photo (pasted text still pastes as text).
- **Size**: an image over 1 MB is redrawn as a JPEG on the phone (longest side 2048 px, quality stepped down until it fits). Anything else over 1 MB is refused with a plain message. HEIC that the browser cannot decode and is over 1 MB is refused the same way.
- **Draft**: added photos are kept with the text draft on the phone, so closing the app before Save does not lose them.
- **A photo on its own** still needs words for the server; the capture text becomes `Attached: <file names>`.
- **Upload**: on Save each file goes into the `attachments` IndexedDB store keyed by its own id, and is sent to `POST /api/attachments` only after its capture has synced. Retries resend the same id and bytes, so the server answers a repeat with "duplicate" instead of storing it twice.
- **Honest states** under the capture in "On this phone": "Photo waiting for a connection", "Photo waiting for its capture to sync", "Photo waiting: sign in again", "Photo uploaded", "Photo not sent: its capture was deleted", "Photo not sent: refused (code)", "Photo not sent: its capture was not saved". Bytes are deleted from the phone once uploaded or once the capture is known deleted; after a refusal they are kept.
- **Deleted capture**: if the server answers 404 or 410 for a photo (its capture is gone), the photo is dropped from the phone and a notice says so. A capture POST answered with 410 is marked "Deleted, not resent", never retried, and its words are removed from the phone.
- **Viewing**: Review and search results show image thumbnails and file chips from `GET /api/attachments/:id?scope=` (same origin; the server sends them sandboxed). HEIC shows as a file chip because most browsers cannot draw it.

## Share target

`manifest.webmanifest` declares a GET `share_target` (`title`, `text`, `url`) with action `/`. Sharing a page or text to the installed app opens the capture sheet with the shared words in the box; nothing is saved until Save. The query string is removed from the address after it is read. Shared text is only text: it is shown in the box and never runs or changes anything.

- **File sharing is not supported** (that needs a POST share target handled by the service worker). Share a photo by opening the app and using "Add photo or file".
- **iPhone**: Safari does not support Web Share Target for Home Screen apps, so Harrison OS does not appear in the iOS share sheet. Use the iOS Shortcut (docs/SHORTCUT.md) for share-sheet capture there. Android Chrome with the app installed does show it.
- Captures from the share target are sent with the normal app capture path, so their source is recorded as `app`.

## Tasks

- **Open tasks** (`#/tasks`): every open task in the scope, grouped Due / Picked for today / Anytime. A **Filter tasks** box narrows the list by words in the title, notes, who asked, or the original date phrase. **Archived tasks** link goes to `#/tasks/archived`, where each can be brought back (reopened) or deleted.
- **Edit** (on every open task row on Tasks and Today) opens the edit sheet: Title, Notes, Due date, Not before, Repeat (does not repeat / every day / every weekday / every week / every month), Project. Only changed fields are sent (PATCH), so the due date is never rewritten by an unrelated edit. A repeating task without a due date is refused in the form. The original date phrase, when the server has one, is shown as "Your words".
- **Defer**: Tomorrow, Next week (the coming Monday) or a picked date. Sets "Not before" through `POST /api/items/:id/defer`; the toast says "Due date unchanged" when there is one. Undo is offered.
- **Archive**: from the sheet, with Undo.
- **Delete**: from the sheet, the archived list and search results. The confirm says what goes: the item, its attachments and its undo history; it will not show in search again; exports already downloaded are not changed. No Undo (the undo history is deleted with it).
- **Completing** sends the phone's date (`today_on`) so a repeating task's next one starts from the right day. The toast says "Marked done. Next one due <date>." when the server made the next one.

## Decisions

- **Record a decision** from Memory (scope chosen when the switch shows All) and from each project. Fields: Decision, Options considered (one per line, up to 10), Recommendation, Assumptions, Reason, Outcome, Reconsider when. Empty fields are not sent.
- **Replace with a new decision** on a current decision (project page and search results) opens the same form prefilled and sends `supersedes_id`. The old one stays visible, struck through and marked "Replaced by a later decision".

## Memory

- **Preferences**: list, add, edit, delete (each change has Undo). The card says plainly that only what is added there is a preference; correcting one item never becomes a preference by itself. Names become keys like `email-sign-off`.
- **Restore from an export**: choose an export JSON, pick Work / Personal / Both (defaults to the file's own scope), Restore. The result is shown in words: what was restored, what was already there, what was deleted earlier and not brought back, what could not be restored. Restoring again is safe because it only adds what is missing. The phone refuses files over 8 MB.
- **Search results**: each item row has Delete; current decisions have Replace with a new decision; attachments show as thumbnails or chips.

## Accessibility and layout

- Every new control has a visible label; buttons that repeat on a list carry the item title in their accessible name ("Edit: Order straps").
- 44 px targets throughout, visible focus (including the file button through its hidden input).
- No horizontal scroll at 360-430 px and at 200% zoom (checked at 180, 195 and 215 CSS px: the scope switch takes its own line and the tab bar shows icons only, names kept for screen readers).
- Dark mode uses the same custom properties as everything else. Safe-area insets come from the existing sheet, top bar and tab bar rules.
- Optional completion feedback: a short pop on the check when a task is marked done; `prefers-reduced-motion: reduce` turns all animation and transitions off, including on `::before`/`::after` pseudo-elements (the pop runs on `.check::before`).
- The edit sheet is a modal `<dialog>`; Escape or Close returns focus to the button that opened it.

## Before T1a's API is merged

On a server without T1a's routes, preferences say "Preferences are not available on this server yet.", restore says it is not available, and an uploaded photo's 404 reads as "its capture was deleted" (the queue cannot tell a missing route from a missing capture). These go away once T1a lands; they are listed in the build record, not hidden.

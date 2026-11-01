# Foreground sync

Visible clients check an owner-only opaque version every 15 seconds, and on focus, reconnect,
or return to the app. Unchanged versions do not reload content. Offline captures still use
the existing durable outbox; this change adds the missing server-to-client refresh.

Content writes advance the version in the same D1 batch. The tracking adapter appends its
write last and returns the original results unchanged. SQL triggers are deliberately avoided:
real D1 includes trigger writes in `meta.changes`, breaking optimistic-write checks.
An attempted multi-statement no-op may advance the version and cause one harmless reload.
Operational event logs are not the source of sync correctness.

Incoming changes wait while a dialog, unsaved form, open inline form, checkpoint edit, or
review selection is active. A second guard immediately before rendering prevents edits
started during the fetch from being replaced. The client does not acknowledge that version
until the view renders safely. A waiting notice makes this visible. Weekly review and an
individual draft stay protected until the user leaves those editing flows.

This is bounded foreground polling, not a background iPhone process or a WebSocket promise.
The approved private PM reader refreshes once a minute, preserves unchanged record rows,
and shows its freshness. External digest links retain their hourly cadence; calendars keep
their existing provider refresh schedule.

Checks: `node --test tests/sync-state.test.mjs tests/live-sync.test.mjs`;
`node tests/sync-state.workerd.mjs` proves D1 counts, RETURNING, atomic rollback and no-ops.
Local browser check also verified an externally-created task appears automatically, and
an unsaved task note survives an external change until its editor closes.

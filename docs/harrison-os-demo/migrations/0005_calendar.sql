-- Read-only calendar (Slice 2.6). Owned by src/calendar.js.
-- A connection is one ICS link (kind 'ics_url', refreshed by the server) or one imported .ics file
-- (kind 'ics_import', never refreshed). The feed URL is a secret: it is stored here only, is never
-- returned by the API, never logged, and the UI shows only its host.
-- Events are the expanded occurrences inside the stored window, replaced as a whole on each refresh.
-- Times are ISO-8601 UTC strings (*_at); date-only events use *_on and stay date-only.

CREATE TABLE calendar_connections (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ics_url', 'ics_import')),
  url TEXT,                                  -- server-only secret; NULL for imports
  host TEXT,                                 -- shown instead of the URL
  state TEXT NOT NULL DEFAULT 'never' CHECK (state IN ('never', 'ok', 'error')),
  last_fetch_at TEXT,                        -- last attempt
  last_ok_at TEXT,                           -- last successful fetch or import
  last_error_code TEXT,
  last_status INTEGER,                       -- HTTP status of the last attempt, if one came back
  event_count INTEGER NOT NULL DEFAULT 0,
  unsupported_count INTEGER NOT NULL DEFAULT 0, -- repeating events shown only once (rule outside the subset)
  truncated INTEGER NOT NULL DEFAULT 0,      -- more than 2000 occurrences in the window
  sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX calendar_connections_scope ON calendar_connections (scope, created_at);
CREATE INDEX calendar_connections_due ON calendar_connections (kind, last_fetch_at);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,                       -- stable per connection + UID + occurrence
  connection_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  title TEXT,                                -- NULL for private (busy-only) events: never stored
  location TEXT,
  start_at TEXT,
  end_at TEXT,
  start_on TEXT,
  end_on TEXT,                               -- exclusive, like DTEND
  all_day INTEGER NOT NULL DEFAULT 0,
  time_zone TEXT,
  busy_only INTEGER NOT NULL DEFAULT 0,
  shows_as TEXT NOT NULL DEFAULT 'busy' CHECK (shows_as IN ('busy', 'free')),
  start_ms INTEGER NOT NULL,                 -- window keys; date-only events use midnight New York
  end_ms INTEGER NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL
);

CREATE INDEX calendar_events_window ON calendar_events (start_ms, end_ms);
CREATE INDEX calendar_events_connection ON calendar_events (connection_id);

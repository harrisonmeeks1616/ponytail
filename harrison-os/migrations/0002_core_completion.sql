-- Harrison OS Slice 1 completion (track T1a). Never edit 0001.
-- src/db.js is still the only module that reads or writes these tables.

-- 1. captures.source gains 'mcp' and 'share'. SQLite cannot change a CHECK in place, so the table is
--    rebuilt with the same columns, rows copied in their original order. FTS rows are keyed by id and stay.
CREATE TABLE captures_new (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  source TEXT NOT NULL CHECK (source IN ('app', 'shortcut', 'mcp', 'share')),
  client_created_at TEXT,
  received_at TEXT NOT NULL,
  receive_count INTEGER NOT NULL DEFAULT 1,
  review_state TEXT NOT NULL CHECK (review_state IN ('pending', 'reviewed', 'note')),
  time_zone TEXT,
  sample INTEGER NOT NULL DEFAULT 0
);
INSERT INTO captures_new (id, text, scope, source, client_created_at, received_at, receive_count, review_state, time_zone, sample)
  SELECT id, text, scope, source, client_created_at, received_at, receive_count, review_state, time_zone, sample FROM captures ORDER BY rowid;
DROP TABLE captures;
ALTER TABLE captures_new RENAME TO captures;
CREATE INDEX captures_scope_review ON captures (scope, review_state, received_at);

-- 2-5. Item columns: recurrence and series, "not before" date, the original date phrase, decision details.
ALTER TABLE items ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly', 'monthly'));
ALTER TABLE items ADD COLUMN series_id TEXT;
ALTER TABLE items ADD COLUMN start_on TEXT;            -- date-only "not before"; never changes due_on
ALTER TABLE items ADD COLUMN when_text TEXT;           -- original date phrase from the capture, kept verbatim
ALTER TABLE items ADD COLUMN options_json TEXT;        -- decision: JSON array of up to 10 strings
ALTER TABLE items ADD COLUMN recommendation TEXT;
ALTER TABLE items ADD COLUMN assumptions TEXT;
ALTER TABLE items ADD COLUMN outcome TEXT;
ALTER TABLE items ADD COLUMN reconsider_when TEXT;
ALTER TABLE items ADD COLUMN decided_on TEXT;
CREATE INDEX items_series ON items (series_id, state);

-- 8. Attachments: bytes stored in D1 (at most 1,000,000 bytes each). Exactly one parent.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  capture_id TEXT,
  item_id TEXT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0,
  CHECK ((capture_id IS NULL) <> (item_id IS NULL))
);
CREATE INDEX attachments_capture ON attachments (capture_id);
CREATE INDEX attachments_item ON attachments (item_id);

-- 9. Preferences (editable memory). Only explicit writes create them.
CREATE TABLE preferences (
  key TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  value TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, scope)
);

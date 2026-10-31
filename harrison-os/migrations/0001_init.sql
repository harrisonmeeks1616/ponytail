-- Harrison OS Slice 1: initial schema.
-- Every user-content table carries scope ('work' | 'personal') and sample (1 = labelled sample data).
-- Times are ISO-8601 UTC strings (*_at). Calendar dates are YYYY-MM-DD (*_on), never converted to instants.
-- src/db.js is the only module that reads or writes these tables. FTS rows are kept in step by explicit
-- code in db.js (no triggers).

CREATE TABLE captures (
  id TEXT PRIMARY KEY,                       -- client id
  text TEXT NOT NULL,                        -- original words, never edited
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  source TEXT NOT NULL CHECK (source IN ('app', 'shortcut')),
  client_created_at TEXT,
  received_at TEXT NOT NULL,
  receive_count INTEGER NOT NULL DEFAULT 1,
  review_state TEXT NOT NULL CHECK (review_state IN ('pending', 'reviewed', 'note')),
  time_zone TEXT,
  sample INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX captures_scope_review ON captures (scope, review_state, received_at);

-- scope and sample are copied from the capture (derived content keeps the capture's scope).
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,                     -- JSON from interpret
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'dropped')),
  item_id TEXT,                              -- created item id, or created reminder id for a reminder proposal
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  sample INTEGER NOT NULL DEFAULT 0,
  UNIQUE (capture_id, ordinal)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  state TEXT NOT NULL CHECK (state IN ('active', 'done', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_touched_at TEXT,
  sample INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX projects_scope_state ON projects (scope, state, last_touched_at);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'waiting', 'reference', 'idea', 'decision')),
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  project_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'done', 'archived')),
  due_on TEXT,                               -- hard date
  today_pick INTEGER NOT NULL DEFAULT 0,
  -- waiting
  who TEXT,
  claim_status TEXT CHECK (claim_status IN ('requested', 'proposed', 'confirmed', 'reported_complete', 'verified', 'unspecified')),
  claim_by TEXT,
  asked_on TEXT,
  promised_on TEXT,
  follow_up_on TEXT,
  reply_recorded_at TEXT,
  -- decision
  supersedes_id TEXT,
  superseded_by_id TEXT,
  reason TEXT,
  -- provenance
  origin TEXT NOT NULL CHECK (origin IN ('user', 'capture')),
  source_capture_id TEXT,
  source_quote TEXT,
  source_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT,
  sample INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX items_scope_kind_state ON items (scope, kind, state);
CREATE INDEX items_project ON items (project_id);
CREATE INDEX items_source_capture ON items (source_capture_id);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  stopped_at_text TEXT,
  open_question TEXT,
  next_step TEXT,
  source_ref TEXT,                           -- 'capture:<id>' | 'item:<id>' | URL
  created_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX checkpoints_project ON checkpoints (project_id, created_at);

-- Powers Undo. scope is the entity's scope (used by export and by the optional scope check on undo).
CREATE TABLE changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  undone_at TEXT,
  scope TEXT CHECK (scope IN ('work', 'personal'))
);

CREATE INDEX changes_entity ON changes (entity, entity_id);

-- Ported from the spike's 0001_init.sql, plus item_id. sample defaults to 0 here (the spike defaulted to 1).
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  time_zone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily')),
  next_fire_at INTEGER,
  state TEXT NOT NULL CHECK (state IN ('active', 'done', 'cancelled')),
  created_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0,
  item_id TEXT
);

CREATE INDEX reminders_due ON reminders (state, next_fire_at);
CREATE INDEX reminders_created_at ON reminders (created_at);

-- One row per occurrence. UNIQUE(reminder_id, scheduled_for) is the guard that stops
-- overlapping cron runs from sending the same occurrence twice.
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  local_label TEXT NOT NULL,
  state TEXT NOT NULL,
  push_status INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  received_at TEXT,
  acknowledged_at TEXT,
  ack_via TEXT,
  held_until INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (reminder_id, scheduled_for)
);

CREATE INDEX deliveries_held ON deliveries (state, held_until);

-- id is the sha256 hex of the endpoint.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT,
  created_at TEXT NOT NULL,
  last_status INTEGER,
  last_ok_at TEXT
);

-- detail is JSON with IDs, states, timestamps, counts and status codes only:
-- never capture, item or project text, tokens, JWTs, push keys or emails.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  detail TEXT
);

-- VAPID JWT cache and test settings.
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Full-text search: one FTS5 table per scope so a forgotten filter cannot leak across scopes.
-- ref is 'capture:<id>', 'item:<id>' or 'project:<id>'.
CREATE VIRTUAL TABLE fts_work USING fts5(ref UNINDEXED, kind UNINDEXED, title, body);
CREATE VIRTUAL TABLE fts_personal USING fts5(ref UNINDEXED, kind UNINDEXED, title, body);

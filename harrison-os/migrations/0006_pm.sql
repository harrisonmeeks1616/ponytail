-- PM digest (Slice 3.1): read-only copies of company project status from user-supplied exports or one
-- authorized digest link. The company system stays the official record; nothing here is written back.
-- pm_records rows are replaced per source in one batch on every successful import (ids kept per provider id).

CREATE TABLE pm_sources (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('import', 'http')),
  system TEXT,                -- the PM system's name as the export states it, for "Open in <system>"
  base_url TEXT,              -- https only
  state TEXT NOT NULL CHECK (state IN ('never', 'ok', 'error')),
  last_import_at TEXT,        -- last successful import or fetch (ISO)
  last_attempt_at TEXT,       -- last fetch attempt, success or not (http only; cron throttle)
  exported_at TEXT,           -- when the PM system produced the data (null when the export does not say)
  last_error_code TEXT,
  last_changes TEXT,          -- JSON: what changed at the last import (new, closed, due date moved)
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX pm_sources_scope ON pm_sources (scope);

CREATE TABLE pm_records (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  provider_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('project', 'item')),
  parent_provider_id TEXT,    -- items: the project's provider id
  title TEXT NOT NULL,
  status TEXT,
  due_on TEXT,                -- YYYY-MM-DD, date only
  owner_label TEXT,
  url TEXT,                   -- https only; others are dropped at import
  updated_at TEXT,
  milestone_title TEXT,       -- projects: next milestone
  milestone_due_on TEXT,
  imported_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  UNIQUE (source_id, kind, provider_id)
);

CREATE INDEX pm_records_scope ON pm_records (scope, source_id);

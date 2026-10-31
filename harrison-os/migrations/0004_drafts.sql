-- Harrison OS Slice 2.4/2.5: professional drafts with claim checking. Owned by src/drafts.js.
-- scope is the scope of every source the draft was built from (refs must all be in it).
-- source_refs: JSON list of every record whose words are in source_text ('item:<id>', 'capture:<id>',
--   'project:<id>'); a cited project expands to the items and captures it pulled in, so deleting any of
--   them deletes the draft (drafts.purgeRef).
-- source_text: the facts and resolved source lines the draft was built from; the claim check compares the
--   body against it (at most 12000 characters; longer material is refused, never cut). project_name and
--   recipient_label are the labels the template's greeting and headings carry. flags: JSON list from claims.compareClaims for the current body.
-- No sending: drafts are copied out by the user.

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  kind TEXT NOT NULL CHECK (kind IN ('email', 'materials', 'update', 'handoff', 'call_brief')),
  title TEXT NOT NULL,
  recipient_label TEXT,
  project_name TEXT,
  facts TEXT,
  source_refs TEXT NOT NULL DEFAULT '[]',
  source_text TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('template', 'ai')),
  flags TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'reviewed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX drafts_scope_updated ON drafts (scope, updated_at);

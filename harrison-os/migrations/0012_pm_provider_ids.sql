-- ID-only provider mapping survives absence from a snapshot. Backfill preserves all existing citations.
CREATE TABLE pm_provider_ids (
  source_id TEXT NOT NULL REFERENCES pm_sources(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  kind TEXT NOT NULL CHECK (kind IN ('project', 'item')),
  provider_id TEXT NOT NULL,
  record_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (source_id, kind, provider_id)
);

INSERT INTO pm_provider_ids (source_id, scope, kind, provider_id, record_id)
SELECT source_id, scope, kind, provider_id, id FROM pm_records;

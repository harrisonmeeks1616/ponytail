-- Shared manual/cron lease with an opaque fencing token. Existing source/copy rows stay unchanged.
ALTER TABLE pm_sources ADD COLUMN refresh_token TEXT;
ALTER TABLE pm_sources ADD COLUMN refresh_until_ms INTEGER;

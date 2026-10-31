-- Assist (Ask, AI adapter, resume briefs): no schema change.
-- Ask stores no questions or answers and briefs are computed on request. The owner's per-scope AI consent
-- lives in the existing kv table (key 'ai_consent:work' | 'ai_consent:personal', value JSON
-- { allowed, updated_at }; no row = not allowed), written through src/db.js kvPut so db.js stays the only
-- module that runs SQL. Kept as a statement so wrangler applies the numbered file cleanly.
SELECT 1;

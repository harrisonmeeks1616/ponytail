-- Weekly review (Slice 3.3). One row per scope and local week (week_of = that week's Monday, YYYY-MM-DD).
-- id is '<scope>:<week_of>' so opening the review twice never makes two rows.
-- selections: JSON array of refs ('item:<id>' | 'project:<id>') the owner deliberately picked this week.
-- deferrals: JSON array of { ref, until, field, at } "Not this week" choices; field is 'follow_up_on',
-- 'start_on' or null (review-only). Hard dates (due_on) are never written by the review.
-- src/review.js owns this table; purgeRef() removes a deleted source's ref from both arrays.
CREATE TABLE weekly_reviews (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('work', 'personal')),
  week_of TEXT NOT NULL,
  opened_at TEXT,
  completed_at TEXT,
  selections TEXT NOT NULL DEFAULT '[]',
  deferrals TEXT NOT NULL DEFAULT '[]',
  sample INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scope, week_of)
);

CREATE INDEX weekly_reviews_scope_completed ON weekly_reviews (scope, completed_at);

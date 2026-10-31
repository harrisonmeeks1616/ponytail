// Route tables of the Slice 2/3 feature modules. Each module owns its file, its migration and its tests,
// and exports ROUTES in the same [method, RegExp, handler(ctx, ...captures)] shape as src/api.js.
// handleApi() authenticates, authorises, applies the CSRF rule and maps errors before any handler runs.
import * as db from './db.js';
import * as ask from './ask.js';
import * as drafts from './drafts.js';
import * as calendar from './calendar.js';
import * as pm from './pm.js';
import * as review from './review.js';
import * as mcp from './mcp.js';

const MODULES = [ask, drafts, calendar, pm, review, mcp];

export const FEATURE_ROUTES = MODULES.flatMap((m) => m.ROUTES);

// Derived-data deletion: deleting a capture or item also runs every module's purgeRef(db, ref) in the same
// batch (db.js applies DERIVED_PURGERS), so drafts, weekly selections and similar copies go with it.
export const PURGERS = MODULES.filter((m) => typeof m.purgeRef === 'function').map((m) => m.purgeRef);
if (Array.isArray(db.DERIVED_PURGERS)) for (const p of PURGERS) if (!db.DERIVED_PURGERS.includes(p)) db.DERIVED_PURGERS.push(p);

// Cron work beyond reminders: each does at most one bounded unit per run (calendar and PM refresh).
export const SCHEDULED = MODULES.filter((m) => typeof m.onScheduled === 'function').map((m) => m.onScheduled);

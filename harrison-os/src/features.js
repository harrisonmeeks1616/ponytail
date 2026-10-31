// Route tables of the Slice 2/3 feature modules. Each module owns its file, its migration and its tests,
// and exports ROUTES in the same [method, RegExp, handler(ctx, ...captures)] shape as src/api.js.
// handleApi() authenticates, authorises, applies the CSRF rule and maps errors before any handler runs.
import { ROUTES as ASK } from './ask.js';
import { ROUTES as DRAFTS } from './drafts.js';
import { ROUTES as CALENDAR } from './calendar.js';
import { ROUTES as PM } from './pm.js';
import { ROUTES as REVIEW } from './review.js';
import { ROUTES as MCP } from './mcp.js';

export const FEATURE_ROUTES = [...ASK, ...DRAFTS, ...CALENDAR, ...PM, ...REVIEW, ...MCP];

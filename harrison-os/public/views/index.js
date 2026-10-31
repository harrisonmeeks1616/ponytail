// Every view module the app registers at start-up, in order.
import * as ask from './ask.js';
import * as drafts from './drafts.js';
import * as calendar from './calendar.js';
import * as pm from './pm.js';
import * as weekly from './weekly.js';
import * as connections from './connections.js';

export const VIEW_MODULES = [ask, drafts, calendar, pm, weekly, connections];

// Harrison OS Slice 1: the Worker entry.
//
// fetch():     /api/* goes to src/api.js (JSON, auth required, Cache-Control: no-store). Everything else is
//              passed to the static assets binding (run_worker_first) with security headers added.
// scheduled(): reminder delivery for the cron "* * * * *", at most 3 sends per run.
//
// This module exports only the default handler: the Workers runtime treats every named export of the main
// module as an entrypoint. The handler is built by createWorker() in src/api.js, which tests also use.

import { createWorker } from './api.js';

export default createWorker();

'use strict';
// Preload (NODE_OPTIONS --require) that proves which System One client path ran.
// HARNESS_TEST_WORKER_MODE=deny makes every worker thread fail to start; =count records
// how many were started into HARNESS_TEST_WORKER_COUNT_FILE when the process exits.
const fs = require('node:fs');
const threads = require('node:worker_threads');
const mode = process.env.HARNESS_TEST_WORKER_MODE;
const Original = threads.Worker;
let count = 0;
if (mode === 'deny') {
  threads.Worker = class { constructor() { throw new Error('worker-disabled-by-test'); } };
} else if (mode === 'count') {
  threads.Worker = class extends Original { constructor(...args) { count += 1; super(...args); } };
  process.on('exit', () => fs.writeFileSync(process.env.HARNESS_TEST_WORKER_COUNT_FILE, String(count)));
}

'use strict';

// #325 F4-T2 test-only file-access spy. Loaded with `node --require` before the CI preloader. It appends each access to
// the qualification export to the file named by F4_SPY_LOG, and it changes no result. Production never loads it, and
// no environment or argv switch in the runtime reads it.

const fs = require('fs');

const EXPORT_PATH = /doc-reconciliation-qualification\.json$/;
const logFile = process.env.F4_SPY_LOG;
const appendLog = fs.appendFileSync;

function note(operation, target) {
  if (logFile && EXPORT_PATH.test(String(target))) appendLog(logFile, `${operation} ${target}\n`);
}

for (const operation of ['readFileSync', 'openSync', 'existsSync', 'statSync', 'lstatSync']) {
  const real = fs[operation];
  fs[operation] = function spied(target, ...rest) {
    note(operation, target);
    return real.call(this, target, ...rest);
  };
}

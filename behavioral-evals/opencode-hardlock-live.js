#!/usr/bin/env node
'use strict';

// Compatibility shim for callers that used the pre-#190 probe name.
// The current live contract is the Rule-of-3 reflection gate plus re-trip.
const probe = require('./opencode-reflection-gate-live');

if (require.main === module) {
  console.warn('Deprecated: use behavioral-evals/opencode-reflection-gate-live.js.');
  try { process.exitCode = probe.main(process.argv.slice(2)); }
  catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = probe;

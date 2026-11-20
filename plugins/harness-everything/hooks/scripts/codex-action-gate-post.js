#!/usr/bin/env node
'use strict';

const { finalizeExecution } = require('./action-gate');

const { readCodexToolOutcome } = require('./lib/codex-tool-outcome');

function inferOutcome(payload) {
  return readCodexToolOutcome(payload).outcome;
}

function processPayload(payload) {
  return finalizeExecution(payload, inferOutcome(payload));
}

function run() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    try {
      processPayload(JSON.parse(raw || '{}'));
    } catch (err) {
      // PostToolUse runs after the side effect. Audit failures must never be
      // misrepresented as a successful enforcement decision or block the host.
      console.error(`[Harness actionGate] Codex post-tool audit failed: ${err.message}`);
    }
    process.exitCode = 0;
  });
}

if (require.main === module) run();

module.exports = {
  inferOutcome,
  processPayload,
};

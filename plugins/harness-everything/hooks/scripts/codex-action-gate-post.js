#!/usr/bin/env node
'use strict';

const { finalizeExecution } = require('./action-gate');

function inferOutcome(payload) {
  const response = (payload && (payload.tool_response || payload.toolResponse)) || {};
  const rawExitCode = response.exitCode ?? response.exit_code ?? payload?.exitCode ?? payload?.exit_code;
  if (typeof rawExitCode === 'number') return rawExitCode === 0 ? 'success' : 'failure';
  if (response.success === false || response.ok === false) return 'failure';

  const stderr = response.stderr ?? payload?.stderr ?? '';
  if (typeof stderr === 'string' && stderr.trim()) {
    if (/\b(error|fail|failed|failure|exception|fatal|panic|traceback|denied|refused|cannot|unable)\b/i.test(stderr)) {
      return 'failure';
    }
  }
  return 'success';
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

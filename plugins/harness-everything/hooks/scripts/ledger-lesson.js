#!/usr/bin/env node
'use strict';

const path = require('node:path');

const MAX_INPUT_BYTES = 64 * 1024;
let state;
let matcher;
try {
  state = require('./lib/harness-state');
  matcher = require('./lib/ledger-match');
} catch (_) {
  // Missing runtime pieces leave the host hook fail-open and silent.
}

let pending = null;
function releasePending() {
  if (!pending) return;
  try { matcher?.releaseLedgerMatch(pending); } catch (_) { /* fail open */ }
  pending = null;
}

process.stdout.on('error', releasePending);

function handle(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !state || !matcher) return;
    const hookEventName = payload.hook_event_name;
    const phase = hookEventName === 'PreToolUse' ? 'action'
      : hookEventName === 'PostToolUseFailure' ? 'failure' : null;
    if (!phase || payload.tool_name !== 'Bash') return;
    if (typeof payload.cwd !== 'string' || !path.isAbsolute(payload.cwd)) return;

    const sessionIdentity = state.getSessionId(payload);
    const command = typeof payload.tool_input_command === 'string' ? payload.tool_input_command
      : typeof payload.tool_input?.command === 'string' ? payload.tool_input.command : null;
    if (!sessionIdentity || !command) return;

    const workspace = state.resolveWorkspaceIdentity(payload);
    if (!workspace.workspaceRoot || !workspace.workspaceKey) return;
    const sessionDir = state.getSessionDir(workspace.workspaceRoot, sessionIdentity, payload);
    const result = matcher.matchLedgerLessons({
      workspaceRoot: workspace.workspaceRoot,
      workspaceIdentity: workspace.workspaceKey,
      sessionIdentity,
      stateDir: path.join(sessionDir, 'ledger-lessons'),
      event: {
        phase,
        tool: 'shell',
        command,
        outcome: phase === 'failure'
          ? { failed: true, ...(typeof payload.error === 'string' ? { output: payload.error } : {}) }
          : { failed: 'unknown' }
      }
    });
    if (!result) return;

    pending = result;
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: result.text }
    })}\n`, error => {
      if (error) releasePending();
      else pending = null;
    });
  } catch (_) {
    releasePending();
  }
}

let input = '';
let inputBytes = 0;
let oversized = false;
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  if (oversized) return;
  try { handle(JSON.parse(input)); } catch (_) { /* malformed payloads are silent */ }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (oversized) return;
  inputBytes += Buffer.byteLength(chunk, 'utf8');
  if (inputBytes > MAX_INPUT_BYTES) {
    oversized = true;
    input = '';
    return;
  }
  input += chunk;
});
process.stdin.on('end', finish);
process.stdin.on('error', finish);

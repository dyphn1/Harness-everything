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
let localErrorSource;
try {
  localErrorSource = require('./lib/local-error-source');
} catch (_) {
  // Missing provisional source leaves the host hook fail-open.
}
let localErrors;
try {
  localErrors = require('./lib/local-errors');
} catch (_) {
  // Missing local error store leaves capture fail-open and silent.
}

let pending = null;
function releasePending() {
  if (!pending) return;
  try { matcher?.releaseLedgerMatch(pending); } catch (_) { /* fail open */ }
  pending = null;
}

process.stdout.on('error', releasePending);

function structuredExitCode(payload) {
  const response = payload.tool_response && typeof payload.tool_response === 'object' && !Array.isArray(payload.tool_response)
    ? payload.tool_response : null;
  for (const candidate of [payload.exit_code, payload.exitCode, response?.exit_code, response?.exitCode]) {
    if (Number.isInteger(candidate)) return candidate;
  }
  return null;
}

function captureFailure(payload, workspace, sessionIdentity, command, event) {
  if (!localErrors || typeof localErrors.appendOccurrence !== 'function') return;
  try {
    const matchedLedgerIds = typeof matcher?.peekRepoMatches === 'function'
      ? matcher.peekRepoMatches({ workspaceRoot: workspace.workspaceRoot, event })
      : [];
    localErrors.appendOccurrence({
      workspaceRoot: workspace.workspaceRoot,
      host: 'claude',
      sessionKey: sessionIdentity,
      ...(typeof payload.tool_use_id === 'string' && payload.tool_use_id.trim()
        ? { toolUseId: payload.tool_use_id }
        : {}),
      command,
      exitCode: structuredExitCode(payload),
      output: typeof payload.error === 'string' ? payload.error : '',
      matchedLedgerIds,
      destination: 'unknown'
    }, { env: process.env });
  } catch (_) {
    // Capture is write-only, silent, and fail-open.
  }
}

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

    const event = {
      phase,
      tool: 'shell',
      command,
      outcome: phase === 'failure'
        ? { failed: true, ...(typeof payload.error === 'string' ? { output: payload.error } : {}) }
        : { failed: 'unknown' }
    };

    let provisionalSource;
    if (localErrorSource && typeof localErrorSource.createProvisionalSource === 'function') {
      try {
        provisionalSource = localErrorSource.createProvisionalSource({
          env: process.env,
          workspaceRoot: workspace.workspaceRoot
        });
      } catch (_) {
        provisionalSource = undefined;
      }
    }

    let result = null;
    try {
      const sessionDir = state.getSessionDir(workspace.workspaceRoot, sessionIdentity, payload);
      result = matcher.matchLedgerLessons({
        workspaceRoot: workspace.workspaceRoot,
        workspaceIdentity: workspace.workspaceKey,
        sessionIdentity,
        stateDir: path.join(sessionDir, 'ledger-lessons'),
        event,
        ...(provisionalSource ? { provisionalSource } : {})
      });
    } catch (_) {
      result = null;
    }

    if (result) {
      pending = result;
      process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: { hookEventName, additionalContext: result.text }
      })}\n`, error => {
        if (error) releasePending();
        else pending = null;
      });
    }

    if (phase === 'failure') {
      captureFailure(payload, workspace, sessionIdentity, command, event);
    }
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

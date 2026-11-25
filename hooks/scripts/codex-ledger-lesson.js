#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { getWorkspaceRoot, getSessionDir, getSessionId, resolveWorkspaceIdentity } = require('./lib/harness-state');
const { readCodexToolOutcome } = require('./lib/codex-tool-outcome');
const { matchLedgerLessons, peekRepoMatches, releaseLedgerMatch } = require('./lib/ledger-match');

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

const MAX_INPUT_BYTES = 128 * 1024;

function buildInvocation(payload) {
  if (payload?.tool_name !== 'Bash' || typeof payload?.tool_input?.command !== 'string') return null;
  const command = payload.tool_input.command;
  if (payload.hook_event_name === 'PreToolUse') {
    return {
      event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } },
      toolOutcome: null,
    };
  }
  if (payload.hook_event_name !== 'PostToolUse') return null;

  const toolOutcome = readCodexToolOutcome(payload);
  const failed = toolOutcome.outcome === 'failure' ? true : toolOutcome.outcome === 'success' ? false : 'unknown';
  const outcome = { failed };
  // Exact ledger diagnostics can identify a masked failure only when the host
  // provides a structured exit outcome. Opaque text-only responses stay unknown.
  if (toolOutcome.outcome !== 'unknown') {
    outcome.output = [toolOutcome.stderr, toolOutcome.stdout].filter(Boolean).join('\n');
  }
  return {
    event: { phase: 'failure', tool: 'shell', command, outcome },
    toolOutcome,
  };
}

function extractToolUseId(payload) {
  for (const candidate of [payload?.tool_use_id, payload?.toolUseId, payload?.call_id, payload?.callId]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function captureFailure(payload, workspaceRoot, sessionIdentity, event, toolOutcome) {
  if (!localErrors || typeof localErrors.appendOccurrence !== 'function') return;
  try {
    const matchedLedgerIds = typeof peekRepoMatches === 'function'
      ? peekRepoMatches({ workspaceRoot, event })
      : [];
    const toolUseId = extractToolUseId(payload);
    localErrors.appendOccurrence({
      workspaceRoot,
      host: 'codex',
      sessionKey: sessionIdentity,
      ...(toolUseId ? { toolUseId } : {}),
      command: event.command,
      exitCode: Number.isInteger(toolOutcome.exitCode) ? toolOutcome.exitCode : null,
      output: typeof event.outcome?.output === 'string' ? event.outcome.output : '',
      matchedLedgerIds,
      destination: 'unknown',
    }, { env: process.env });
  } catch (_) {
    // Capture is write-only, silent, and fail-open.
  }
}

function deliver(payload) {
  if (typeof payload?.cwd !== 'string' || !payload.cwd.trim()) return;
  const invocation = buildInvocation(payload);
  const sessionIdentity = getSessionId(payload);
  if (!invocation || !sessionIdentity) return;

  const { event, toolOutcome } = invocation;
  const workspaceRoot = getWorkspaceRoot(payload);
  const identity = resolveWorkspaceIdentity(payload);
  if (!workspaceRoot || !identity?.workspaceKey) return;

  let provisionalSource;
  if (localErrorSource && typeof localErrorSource.createProvisionalSource === 'function') {
    try {
      provisionalSource = localErrorSource.createProvisionalSource({
        env: process.env,
        workspaceRoot,
      });
    } catch (_) {
      provisionalSource = undefined;
    }
  }

  let result = null;
  try {
    const stateDir = path.join(getSessionDir(workspaceRoot, sessionIdentity, payload), 'ledger-lessons');
    result = matchLedgerLessons({
      workspaceRoot,
      workspaceIdentity: identity.workspaceKey,
      sessionIdentity,
      stateDir,
      event,
      ...(provisionalSource ? { provisionalSource } : {}),
    });
  } catch (_) {
    result = null;
  }

  if (result) {
    try {
      const output = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: payload.hook_event_name,
          additionalContext: result.text,
        },
      });
      process.stdout.write(output, error => {
        if (error) releaseLedgerMatch(result);
      });
    } catch (_) {
      releaseLedgerMatch(result);
    }
  }

  if (payload.hook_event_name === 'PostToolUse' && toolOutcome?.outcome === 'failure') {
    captureFailure(payload, workspaceRoot, sessionIdentity, event, toolOutcome);
  }
}

function run() {
  let input = '';
  let bytes = 0;
  let oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (oversized) return;
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes > MAX_INPUT_BYTES) {
      input = '';
      oversized = true;
      return;
    }
    input += chunk;
  });
  process.stdin.on('end', () => {
    if (oversized) return;
    try { deliver(JSON.parse(input || '{}')); } catch (_) { /* Fail open without changing tool flow. */ }
  });
  process.stdin.on('error', () => {});
}

if (require.main === module) run();

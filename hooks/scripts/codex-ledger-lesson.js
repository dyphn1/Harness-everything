#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { getWorkspaceRoot, getSessionDir, getSessionId, resolveWorkspaceIdentity } = require('./lib/harness-state');
const { readCodexToolOutcome } = require('./lib/codex-tool-outcome');
const { matchLedgerLessons, releaseLedgerMatch } = require('./lib/ledger-match');

const MAX_INPUT_BYTES = 128 * 1024;

function eventFor(payload) {
  if (payload?.tool_name !== 'Bash' || typeof payload?.tool_input?.command !== 'string') return null;
  const command = payload.tool_input.command;
  if (payload.hook_event_name === 'PreToolUse') {
    return { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } };
  }
  if (payload.hook_event_name !== 'PostToolUse') return null;

  const result = readCodexToolOutcome(payload);
  const failed = result.outcome === 'failure' ? true : result.outcome === 'success' ? false : 'unknown';
  const outcome = { failed };
  if (failed === true) outcome.output = [result.stderr, result.stdout].filter(Boolean).join('\n');
  return { phase: 'failure', tool: 'shell', command, outcome };
}

function deliver(payload) {
  if (typeof payload?.cwd !== 'string' || !payload.cwd.trim()) return;
  const event = eventFor(payload);
  const sessionIdentity = getSessionId(payload);
  if (!event || !sessionIdentity) return;

  const workspaceRoot = getWorkspaceRoot(payload);
  const identity = resolveWorkspaceIdentity(payload);
  if (!workspaceRoot || !identity?.workspaceKey) return;
  const stateDir = path.join(getSessionDir(workspaceRoot, sessionIdentity, payload), 'ledger-lessons');
  const result = matchLedgerLessons({
    workspaceRoot,
    workspaceIdentity: identity.workspaceKey,
    sessionIdentity,
    stateDir,
    event,
  });
  if (!result) return;

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

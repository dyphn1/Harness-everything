#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) Stop Hook Adapter
 *
 * Implements the Verify-Before-Claim gate:
 * - Inspects real session verification state (handoff-state.json in sessionDir).
 * - If unverified edits exist or an unresolved tool failure exists, returns
 *   {"decision": "continue", "reason": "..."} to keep the agent in the loop.
 * - If verified (or no unverified edits), returns {"decision": "allow"}.
 * - Tracks the last continued state fingerprint in agy-stop-state.json so each
 *   unverified edit or failure triggers at most one forced continuation (preventing
 *   infinite loops on hosts that omit exitCode or continuationActive).
 * - Respects compatibility recursion guards (continuationActive / stop_hook_active)
 *   to prevent infinite continuation loops, and allows stop on explicit abnormal
 *   terminationReason values (USER_CANCELED, ERROR, limits, etc.) while evaluating
 *   NO_TOOL_CALL, model_stop, and empty/normal reasons.
 */

const fs = require('fs');
const path = require('path');
const {
  readJsonStdin,
  getAgySessionId,
  normalizeAgyStatePayload
} = require('./lib/agy-adapter-core');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

const STOP_STATE_FILE = 'agy-stop-state.json';

function readStopState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeStopState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, filePath);
  } catch (_) {
    // Best-effort marker write; never fail stop evaluation on state IO.
  }
}

const ABNORMAL_TERMINATION_REASONS = new Set([
  'USER_CANCELED',
  'CANCELED',
  'CANCELLED',
  'ERROR',
  'MAX_INVOCATIONS',
  'MAX_STEPS_EXCEEDED',
  'MAX_TOKEN_BUDGET_EXCEEDED',
  'TERMINAL_CUSTOM_HOOK',
  'INTERRUPTED',
  'ABORTED'
]);

function evaluateStop(payload) {
  if (!payload || typeof payload !== 'object') return { decision: 'allow' };

  // 1. Compatibility recursion guards (not official documented Stop input fields):
  // if a previous Stop hook already continued work during this turn, allow stop to prevent loops.
  if (payload.continuationActive || payload.stop_hook_active) {
    return { decision: 'allow' };
  }

  // 2. Allow stop only on explicit abnormal termination reasons; normal reasons
  // (NO_TOOL_CALL, model_stop, empty/unknown) must still evaluate handoff-state.json.
  const terminationReason = typeof payload.terminationReason === 'string'
    ? payload.terminationReason.trim().toUpperCase()
    : '';
  if (terminationReason && ABNORMAL_TERMINATION_REASONS.has(terminationReason)) {
    return { decision: 'allow' };
  }

  // 3. Locate session state using normalized AGY workspace/session context
  const normalized = normalizeAgyStatePayload(payload);
  const sessionId = getAgySessionId(payload);
  const root = getWorkspaceRoot(normalized) || normalized.cwd;
  const sessionDir = getSessionDir(root, sessionId);
  const handoffFile = path.join(sessionDir, 'handoff-state.json');

  let handoff = null;
  if (fs.existsSync(handoffFile)) {
    try {
      handoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    } catch (_) {}
  }

  const lastEditAt = (handoff && handoff.lastEditAt) || 0;
  const lastVerifyAt = (handoff && handoff.lastVerifyAt) || 0;
  const isFailed = handoff && handoff.status === 'failed';

  // 4. Check for unverified edits or unresolved failure (bounded to 1 continuation per pending state)
  let pending = null;
  if (isFailed) {
    pending = {
      fingerprint: `failed:${handoff.timestamp || ''}:${handoff.tool || ''}:${handoff.exitCode ?? ''}`,
      reason: 'Harness Verify-Before-Claim: pending tool failure must be resolved before claiming completion.'
    };
  } else if (lastEditAt > 0 && lastVerifyAt < lastEditAt) {
    pending = {
      fingerprint: `edit:${lastEditAt}`,
      reason: 'Harness Verify-Before-Claim: unverified edits exist in session. Run relevant test/build/lint verification before claiming completion.'
    };
  } else if (process.env.HARNESS_REQUIRE_VERIFICATION === '1' && (!lastVerifyAt || lastVerifyAt < lastEditAt)) {
    pending = {
      fingerprint: `strict:${lastVerifyAt}`,
      reason: 'Harness Verify-Before-Claim: objective test verification is required before claiming completion.'
    };
  }

  if (pending) {
    const stopStateFile = path.join(sessionDir, STOP_STATE_FILE);
    const saved = readStopState(stopStateFile);
    if (saved && saved.lastContinuedFingerprint === pending.fingerprint) {
      return { decision: 'allow' };
    }
    writeStopState(stopStateFile, {
      lastContinuedFingerprint: pending.fingerprint,
      updatedAt: new Date().toISOString()
    });
    return {
      decision: 'continue',
      reason: pending.reason
    };
  }

  return { decision: 'allow' };
}

async function main() {
  const payload = await readJsonStdin();
  const result = evaluateStop(payload);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write('{"decision":"allow"}\n');
  });
}

module.exports = { main, evaluateStop };

#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) Stop Hook Adapter
 *
 * Implements the Verify-Before-Claim gate:
 * - Inspects real session verification state (handoff-state.json in sessionDir).
 * - If unverified edits exist or unverified completion is claimed, returns
 *   {"decision": "continue", "reason": "..."} to keep the agent in the loop.
 * - If verified (or no unverified edits), returns {}.
 * - Respects continuationActive to prevent infinite continuation loops.
 */

const fs = require('fs');
const path = require('path');
const { readJsonStdin } = require('./lib/agy-adapter-core');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

function evaluateStop(payload) {
  if (!payload) return {};

  // 1. If a previous Stop hook already continued work during this turn, allow stop to prevent loops
  if (payload.continuationActive) {
    return {};
  }

  // 2. Locate session state
  const sessionId = payload.conversationId || payload.session_id || payload.sessionId;
  const root = getWorkspaceRoot(payload) || payload.cwd || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || process.cwd();
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

  // 3. Check for unverified edits or unresolved failure
  if (isFailed) {
    return {
      decision: 'continue',
      reason: 'Harness Verify-Before-Claim: pending tool failure must be resolved before claiming completion.'
    };
  }

  if (lastEditAt > 0 && lastVerifyAt < lastEditAt) {
    return {
      decision: 'continue',
      reason: 'Harness Verify-Before-Claim: unverified edits exist in session. Run relevant test/build/lint verification before claiming completion.'
    };
  }

  if (process.env.HARNESS_REQUIRE_VERIFICATION === '1' && (!lastVerifyAt || lastVerifyAt < lastEditAt)) {
    return {
      decision: 'continue',
      reason: 'Harness Verify-Before-Claim: objective test verification is required before claiming completion.'
    };
  }

  return {};
}

async function main() {
  const payload = await readJsonStdin();
  const result = evaluateStop(payload);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write('{}\n');
  });
}

module.exports = { main, evaluateStop };

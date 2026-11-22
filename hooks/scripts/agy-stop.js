#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) Stop Hook Adapter
 *
 * Implements the Verify-Before-Claim gate:
 * - If the agent attempts to terminate without satisfying verification invariants,
 *   returns {"decision": "continue", "reason": "..."} to keep the agent in the loop.
 * - Respects continuationActive to prevent infinite continuation loops.
 */

const { readJsonStdin } = require('./lib/agy-adapter-core');

function evaluateStop(payload) {
  // If a previous Stop hook already continued work during this turn, allow stop
  if (payload.continuationActive) {
    return {};
  }

  // If explicit unverified claim flag or strict verification environment is active
  if (process.env.HARNESS_REQUIRE_VERIFICATION === '1') {
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

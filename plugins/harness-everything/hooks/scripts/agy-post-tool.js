#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PostToolUse Hook Adapter
 *
 * Captures tool outcomes, tracks execution errors for state persistence.
 * Returns empty JSON object `{}` on stdout as required by AGY protocol.
 */

const { readJsonStdin } = require('./lib/agy-adapter-core');

async function main() {
  const payload = await readJsonStdin();

  if (process.env.HARNESS_DEBUG && payload.error) {
    console.error(`[AGY-PostToolUse] Observed tool error in step ${payload.stepIdx}: ${payload.error}`);
  }

  process.stdout.write('{}\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write('{}\n');
  });
}

module.exports = { main };

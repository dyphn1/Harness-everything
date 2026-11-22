#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) SessionStart Hook Adapter
 *
 * Runs once when a new conversation session begins.
 * Injects Harness bootstrap message into the conversation trajectory.
 */

const { readJsonStdin } = require('./lib/agy-adapter-core');

async function main() {
  await readJsonStdin();

  const response = {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: 'Harness Skills OS active. Operating under AGENTS.md invariant-first routing.'
        }
      }
    ]
  };

  process.stdout.write(JSON.stringify(response) + '\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write('{}\n');
  });
}

module.exports = { main };

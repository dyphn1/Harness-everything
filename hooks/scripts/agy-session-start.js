#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) SessionStart Hook Adapter
 *
 * Runs once when a new conversation session begins.
 * Binds session workspace identity (when provided) and injects Harness bootstrap message.
 */

const {
  readJsonStdin,
  getAgySessionId,
  normalizeAgyStatePayload
} = require('./lib/agy-adapter-core');
const { getWorkspaceRoot } = require('./lib/harness-state');

async function main() {
  const payload = await readJsonStdin();

  try {
    const sessionId = getAgySessionId(payload);
    const hasWorkspaceHint = Boolean(
      (typeof payload.cwd === 'string' && payload.cwd.trim()) ||
      (Array.isArray(payload.workspacePaths) && payload.workspacePaths.some(entry => typeof entry === 'string' && entry.trim()))
    );
    if (sessionId && hasWorkspaceHint) {
      const normalized = normalizeAgyStatePayload(payload);
      getWorkspaceRoot(normalized);
    }
  } catch (_) {
    // Session workspace binding is best-effort and must never fail startup.
  }

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

#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PreInvocation Hook Adapter
 *
 * Runs before model invocation. Invokes the Harness kernel router and ledger lessons,
 * then returns systemMessage injectSteps in AGY's required protojson format.
 * Bridges AGY conversationId to session_id for workflow persistence.
 */

const { spawnSync } = require('child_process');
const { readJsonStdin, resolveKernelRouter } = require('./lib/agy-adapter-core');

async function main() {
  const payload = await readJsonStdin();
  const userInput = payload.lastUserInput || payload.prompt || '';
  const routerScript = resolveKernelRouter();

  if (!routerScript || !userInput.trim()) {
    process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
    return;
  }

  const sessionId = payload.conversationId || payload.session_id || payload.sessionId || '';
  const cwd = payload.cwd || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || process.cwd();

  try {
    const routerInput = {
      hook_event_name: 'UserPromptSubmit',
      prompt: userInput,
      lastUserInput: userInput,
      cwd,
      conversationId: sessionId,
      session_id: sessionId,
      sessionId: sessionId,
      ...(payload.workspacePaths ? { workspacePaths: payload.workspacePaths } : {})
    };

    const run = spawnSync(process.execPath, [routerScript], {
      input: JSON.stringify(routerInput),
      encoding: 'utf8',
      env: process.env,
      timeout: 20000
    });

    const context = String(run.stdout || '').trim();
    if (context) {
      const response = {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: context
            }
          }
        ]
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }
  } catch (err) {
    if (process.env.HARNESS_DEBUG) {
      console.error('[AGY-PreInvocation] Routing error:', err);
    }
  }

  process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
  });
}

module.exports = { main };

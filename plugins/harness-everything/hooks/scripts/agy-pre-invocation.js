#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PreInvocation Hook Adapter
 *
 * Runs before model invocation. Invokes the Harness kernel router and ledger lessons
 * ONCE per user turn (deduplicated across tool-call roundtrips within a turn), then
 * returns systemMessage injectSteps in AGY's required protojson format.
 * Bridges AGY conversationId to session_id for workflow persistence.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  readJsonStdin,
  resolveKernelRouter,
  getAgySessionId,
  getAgyEffectiveCwd,
  normalizeAgyStatePayload
} = require('./lib/agy-adapter-core');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

const DEDUP_STATE_FILE = 'agy-pre-invocation-state.json';

function hashUserInput(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16);
}

function readDedupState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeDedupState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, filePath);
  } catch (_) {
    // Best-effort marker write; never fail invocation on state IO.
  }
}

function shouldSkipInjection(payload, userInput, dedupFile) {
  const hasInvNum = payload && payload.invocationNum !== undefined && payload.invocationNum !== null && payload.invocationNum !== '';
  const invNum = hasInvNum ? Number(payload.invocationNum) : 0;
  const hasInitialSteps = payload && payload.initialNumSteps !== undefined && payload.initialNumSteps !== null && payload.initialNumSteps !== '';
  const inputHash = hashUserInput(userInput);
  const turnKey = hasInitialSteps
    ? `step:${payload.initialNumSteps}:${inputHash}`
    : `input:${inputHash}`;

  if (!dedupFile) {
    return {
      skip: Number.isFinite(invNum) && invNum > 0,
      turnKey,
      invNum: Number.isFinite(invNum) ? invNum : 0,
      base: 0
    };
  }

  const saved = readDedupState(dedupFile);
  const sameTurn = Boolean(saved && saved.turnKey === turnKey);

  if (sameTurn) {
    // When initialNumSteps is absent and a host explicitly sends invocationNum: 0
    // (or restarts at 0 after a previous positive invocation), treat it as a new turn.
    if (!hasInitialSteps && (saved.sawPositiveInvocation || hasInvNum) && Number.isFinite(invNum) && invNum === 0) {
      return { skip: false, turnKey, invNum: 0, base: 0 };
    }
    if (Number.isFinite(invNum) && invNum > 0 && !saved.sawPositiveInvocation) {
      writeDedupState(dedupFile, { ...saved, sawPositiveInvocation: true, updatedAt: new Date().toISOString() });
    }
    return { skip: true, turnKey, invNum: Number.isFinite(invNum) ? invNum : 0, base: saved.base || 0 };
  }

  // Not the same turnKey: guard against mid-turn calls (both 0-based and 1-based).
  if (Number.isFinite(invNum) && invNum > 1) {
    return { skip: true, turnKey, invNum, base: (saved && saved.base) || 0 };
  }
  if (Number.isFinite(invNum) && invNum === 1 && (!hasInitialSteps || (saved && saved.base === 0))) {
    return { skip: true, turnKey, invNum, base: 0 };
  }

  const base = Number.isFinite(invNum) && invNum === 1 ? 1 : 0;
  return { skip: false, turnKey, invNum: Number.isFinite(invNum) ? invNum : 0, base };
}

async function main() {
  const payload = await readJsonStdin();
  const userInput = payload.lastUserInput || payload.prompt || '';
  const routerScript = resolveKernelRouter();

  if (!routerScript || !String(userInput).trim()) {
    process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
    return;
  }

  const sessionId = getAgySessionId(payload);
  const effectiveCwd = getAgyEffectiveCwd(payload);
  const normalizedPayload = normalizeAgyStatePayload(payload, effectiveCwd);

  let dedupFile = null;
  if (sessionId) {
    try {
      const root = getWorkspaceRoot(normalizedPayload) || effectiveCwd;
      const sessionDir = getSessionDir(root, sessionId);
      dedupFile = path.join(sessionDir, DEDUP_STATE_FILE);
    } catch (_) {
      dedupFile = null;
    }
  }

  const dedup = shouldSkipInjection(payload, userInput, dedupFile);
  if (dedup.skip) {
    process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
    return;
  }

  try {
    const routerInput = {
      hook_event_name: 'UserPromptSubmit',
      prompt: userInput,
      lastUserInput: userInput,
      cwd: effectiveCwd,
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
      if (dedupFile) {
        writeDedupState(dedupFile, {
          turnKey: dedup.turnKey,
          base: dedup.base,
          sawPositiveInvocation: dedup.invNum > 0,
          updatedAt: new Date().toISOString()
        });
      }
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

module.exports = { main, shouldSkipInjection };

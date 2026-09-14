#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getWorkspaceRoot,
  getSessionId,
  getSessionDir,
  writeCurrentSession,
  pruneStaleSessions
} = require('./lib/harness-state');

const POLICY = [
  'Harness Cognitive OS policy is active.',
  'Use Discover -> Think -> Try -> Summarize -> Record as a lightweight reasoning loop.',
  'Cross-cutting invariants:',
  '- Route before execution: establish task scope before mutating work.',
  '- Verify before claim: require objective evidence appropriate to the change.',
  '- Re-plan on repetition: after 3 same-signature failures, zoom out instead of repeating the same attempt.',
  'Domain skills are advisory. Do not enforce a universal workflow order; choose the smallest useful skill/tool set.'
].join('\n');

function readPayload() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function removeIfPresent(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    // Session reset is best effort; a stale breaker must never block startup.
  }
}

function handoffContext(sessionDir) {
  try {
    const handoff = JSON.parse(fs.readFileSync(path.join(sessionDir, 'handoff-state.json'), 'utf8'));
    if (handoff.status !== 'failed') return '';
    const detail = String(handoff.errorSummary || 'No error snippet available').trim().slice(-300);
    return `\nPrevious session checkpoint: ${handoff.tool || 'unknown'} failed${handoff.exitCode ? ` (exit ${handoff.exitCode})` : ''}.\nReview the failure evidence before continuing.\n${detail}`;
  } catch (err) {
    return '';
  }
}

function main() {
  const payload = readPayload();
  const root = getWorkspaceRoot(payload);
  const sessionId = getSessionId(payload);
  let additionalContext = POLICY;

  if (root) {
    try {
      pruneStaleSessions(root);
      writeCurrentSession(root, sessionId);
      const sessionDir = getSessionDir(root, sessionId);
      removeIfPresent(path.join(sessionDir, 'rule-of-3-state.json'));
      removeIfPresent(path.join(sessionDir, 'zoom-out-report.md'));
      removeIfPresent(path.join(sessionDir, 'subagent-scope-state.json'));
      additionalContext += handoffContext(sessionDir);
    } catch (err) {
      // Policy injection remains useful even if runtime state is unavailable.
    }
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext
    }
  }));
}

main();

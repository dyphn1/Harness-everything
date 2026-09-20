#!/usr/bin/env node
/**
 * Verification reminder for Stop hooks.
 *
 * If uncommitted edits exist and no later successful verification was observed,
 * emit one concise reminder for this Stop event. No gate state is persisted and
 * Stop is never rejected.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

function decide(payload) {
  try {
    const root = getWorkspaceRoot(payload);
    const sessionDir = getSessionDir(root, payload && (payload.session_id || payload.sessionId));
    const handoffFile = path.join(sessionDir, 'handoff-state.json');
    if (!fs.existsSync(handoffFile)) return;

    const handoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    const lastEditAt = handoff.lastEditAt || 0;
    const lastVerifyAt = handoff.lastVerifyAt || 0;
    if (!lastEditAt || lastVerifyAt >= lastEditAt) return;

    const dirty = execSync('git status --porcelain', {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!dirty) return;

    console.error('[Verification Reminder] Uncommitted edits have no observed successful verification after the latest edit.');
    console.error("Run a relevant test/build/lint check before claiming completion, or state why verification is not applicable.");
  } catch (_) {
    // Reminder infrastructure is always fail-open.
  }
}

let inputData = '';
const timeout = setTimeout(() => decide(null), 200);
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  let payload = null;
  try { payload = JSON.parse(inputData.trim()); } catch (_) {}
  decide(payload);
});
process.stdin.on('error', () => { clearTimeout(timeout); decide(null); });

#!/usr/bin/env node
/**
 * Stop Gate (Stop hook - Claude Code only)
 * The pre-delivery gate (verification-loop) was prose-only, and prose decays
 * as context grows. This makes the one check that matters mechanical: ending
 * the turn with edits that were never followed by a successful
 * verification-ish command (test/build/lint - tracked by state-persist.js)
 * while uncommitted changes sit in the tree gets bounced back ONCE per edit
 * batch. Objective facts only; fails open on any error.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

function decide(payload) {
  try {
    // Loop guard: if this stop already resulted from a Stop-hook block,
    // always let it through - one bounce is the contract, never a cage.
    if (payload && payload.stop_hook_active) {
      process.exit(0);
    }

    const root = getWorkspaceRoot();
    const sessionDir = getSessionDir(root, payload && payload.session_id);
    const handoffFile = path.join(sessionDir, 'handoff-state.json');
    const gateFile = path.join(sessionDir, 'stop-gate-state.json');

    if (!fs.existsSync(handoffFile)) process.exit(0);
    const handoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    const lastEditAt = handoff.lastEditAt || 0;
    const lastVerifyAt = handoff.lastVerifyAt || 0;

    // No edits this session, or verification already ran after the last edit.
    if (!lastEditAt || lastVerifyAt >= lastEditAt) process.exit(0);

    // One bounce per edit batch: if we already blocked for this exact edit
    // timestamp, the model either verified (which moves lastVerifyAt) or
    // explicitly chose not to - don't nag twice for the same batch.
    let gate = {};
    if (fs.existsSync(gateFile)) {
      try { gate = JSON.parse(fs.readFileSync(gateFile, 'utf8')); } catch (e) { /* ignore */ }
    }
    if (gate.blockedForEditAt === lastEditAt) process.exit(0);

    // Only relevant when unverified work is actually sitting in the tree.
    const dirty = execSync('git status --porcelain', {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!dirty) process.exit(0);

    fs.writeFileSync(gateFile, JSON.stringify({ blockedForEditAt: lastEditAt }, null, 2), 'utf8');

    console.error(`[Stop Gate] Turn is ending with uncommitted edits and no successful verification command (test/build/lint) since the last edit.`);
    console.error(`Before delivering: run the relevant check from 'verification-loop' - even a single targeted test beats none.`);
    console.error(`If verification is genuinely not applicable (docs-only change, analysis-only turn, the Human Partner told you to stop), state that explicitly in your reply and stop again.`);
    console.error(`This gate bounces at most once per edit batch.`);
    process.exit(2);
  } catch (err) {
    // Fail open - a broken gate must never trap the session.
    process.exit(0);
  }
}

let inputData = '';
const timeout = setTimeout(() => {
  decide(null);
}, 200);

process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  let payload = null;
  try { payload = JSON.parse(inputData.trim()); } catch (err) { /* no payload */ }
  decide(payload);
});
process.stdin.on('error', () => {
  clearTimeout(timeout);
  decide(null);
});

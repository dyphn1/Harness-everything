#!/usr/bin/env node
/**
 * Atomic Commit Check (PostToolUse: Edit|Write)
 * PostToolUse can't block - the edit/write already happened. So this counts
 * Edit/Write calls since the last commit and, once the count crosses a
 * threshold, feeds a strong reminder back to Claude (exit 2) to commit the
 * completed chunk before piling on more changes. Resets whenever HEAD moves.
 * Fails open on any error - this is a nudge, never a hard stop.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const THRESHOLD = 6;
const RENUDGE_EVERY = 3;

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

try {
  const root = getWorkspaceRoot();
  if (!root) process.exit(0);

  const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  const stateDir = path.join(root, '.harness');
  const stateFile = path.join(stateDir, 'atomic-commit-state.json');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  let state = { lastHead: head, editCount: 0 };
  if (fs.existsSync(stateFile)) {
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* use default */ }
  }

  if (state.lastHead !== head) {
    // A commit happened since we last checked - fresh start.
    state.lastHead = head;
    state.editCount = 0;
  }

  state.editCount += 1;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

  const overThreshold = state.editCount >= THRESHOLD;
  const onNudgeBeat = overThreshold && (state.editCount - THRESHOLD) % RENUDGE_EVERY === 0;

  if (onNudgeBeat) {
    const statusRaw = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const changedFiles = statusRaw ? statusRaw.split('\n').length : 0;
    console.error(`[Atomic Commit Check] ${state.editCount} Edit/Write calls since the last commit (${changedFiles} files currently changed).`);
    console.error(`If a logically complete chunk of work is done, commit it now before continuing - large uncommitted diffs are harder to review and harder to recover from.`);
    process.exit(2);
  }

  process.exit(0);
} catch (err) {
  process.exit(0);
}

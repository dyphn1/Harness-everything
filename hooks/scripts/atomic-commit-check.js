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
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

const THRESHOLD = 6;
const RENUDGE_EVERY = 3;

function main(payload) {
  try {
    const root = getWorkspaceRoot();
    const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    const stateFile = path.join(getSessionDir(root, payload && payload.session_id), 'atomic-commit-state.json');

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
}

let inputData = '';
const timeout = setTimeout(() => { main(null); }, 200);
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  let payload = null;
  try { payload = JSON.parse(inputData.trim()); } catch (err) { /* no payload */ }
  main(payload);
});
process.stdin.on('error', () => {
  clearTimeout(timeout);
  main(null);
});

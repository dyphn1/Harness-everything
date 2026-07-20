#!/usr/bin/env node
// Manual escape hatch for the Rule of 3 circuit breaker. Run this directly
// in your own terminal (not through the agent — Bash is blocked while the
// breaker is tripped) to clear it without waiting for a new session.
const fs = require('fs');
const path = require('path');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const harnessDir = path.join(getWorkspaceRoot(), '.harness');
const stateFile = path.join(harnessDir, 'rule-of-3-state.json');
const reportFile = path.join(harnessDir, 'zoom-out-report.md');

if (fs.existsSync(stateFile)) {
  fs.unlinkSync(stateFile);
  console.log('Rule of 3 circuit breaker cleared.');
} else {
  console.log('Rule of 3 circuit breaker is not currently tripped.');
}

// A human reset is a full clear: the stale reflection report belongs to the
// loop that was just abandoned.
if (fs.existsSync(reportFile)) {
  fs.unlinkSync(reportFile);
  console.log('Stale zoom-out report removed.');
}

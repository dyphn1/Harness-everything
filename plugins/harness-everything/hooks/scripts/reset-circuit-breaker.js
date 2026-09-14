#!/usr/bin/env node
// Manual escape hatch for the Rule of 3 circuit breaker. Run this directly
// in your own terminal (not through the agent — Bash is blocked while the
// breaker is tripped) to clear it without waiting for a new session.
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, readCurrentSession } = require('./lib/harness-state');

// This is run directly by the human, not through the agent, so there's no
// hook payload to read a session_id from - resolve "the session that's
// currently blocked" via the pointer bootstrap.js wrote at its last
// SessionStart.
const root = getWorkspaceRoot();
const harnessDir = getSessionDir(root, readCurrentSession(root));
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

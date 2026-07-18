#!/usr/bin/env node
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

const stateFile = path.join(getWorkspaceRoot(), '.harness', 'handoff-state.json');
try {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  // Stub for state persisting logic
  const state = { timestamp: new Date().toISOString() };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
} catch (err) {}
process.exit(0);

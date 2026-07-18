#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log("Bootstrapping Harness Skills OS...");
// Here we could initialize basic state if needed.
function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const harnessDir = path.join(getWorkspaceRoot(), '.harness');
if (!fs.existsSync(harnessDir)) {
  fs.mkdirSync(harnessDir, { recursive: true });
}

console.log("Harness OS initialized. Ready for user prompt.");

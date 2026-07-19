#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log("Bootstrapping Harness Skills OS...");

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

// Check for handoff/state checkpoint from previous session
const handoffFile = path.join(harnessDir, 'handoff-state.json');
if (fs.existsSync(handoffFile)) {
  try {
    const handoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    if (handoff.status === 'failed') {
      const exitStr = handoff.exitCode ? ` (exit code ${handoff.exitCode})` : '';
      const border = "─".repeat(60);
      console.log(`\n┌${border}┐`);
      console.log(`│             Harness OS - Handoff Checkpoint              │`);
      console.log(`├${border}┤`);
      console.log(`│ - Last active action failed${exitStr.padEnd(30)} │`);
      console.log(`│ - Action: ${String(handoff.tool || 'unknown').padEnd(46)} │`);
      console.log(`│ - Last error output snippet:                             │`);
      
      const snippet = handoff.errorSummary || 'No snippet available';
      const lines = snippet.split('\n').map(l => l.trim()).filter(Boolean).slice(-3);
      if (lines.length > 0) {
        lines.forEach(line => {
          const paddedLine = line.slice(0, 54).padEnd(54);
          console.log(`│     > ${paddedLine} │`);
        });
      } else {
        console.log(`│     > None                                               │`);
      }
      console.log(`├${border}┤`);
      console.log(`│ Hint: Use this context to continue resolving the issue   │`);
      console.log(`│       efficiently or start on a new path.                │`);
      console.log(`└${border}┘\n`);
    }
  } catch (err) {
    // Ignore malformed files
  }
}

console.log("Harness OS initialized. Ready for user prompt.");


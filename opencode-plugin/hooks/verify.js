#!/usr/bin/env node
/**
 * Verification Runner Hook
 * 
 * Runs verification commands and updates state.
 * This hook runs verification commands (npm test, lint, build) and:
 * 1. Executes the verification command
 * 2. Updates state to reflect verification status
 * 3. Logs verification results
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.harness-state');
const STATE_FILE = path.join(STATE_DIR, 'edit-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore parse errors
  }
  return {
    lastEditTime: null,
    verificationPending: false,
    editsSinceVerification: 0,
    sessionStart: Date.now()
  };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function runVerification(command) {
  try {
    execSync(command, { 
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
    return { success: true, command };
  } catch (e) {
    return { 
      success: false, 
      command,
      error: e.message.slice(0, 200)
    };
  }
}

function main() {
  const state = loadState();
  
  // Verification commands to try
  const commands = [
    'npm test',
    'npm run lint',
    'npm run build'
  ];
  
  const results = [];
  let allPassed = true;
  
  for (const cmd of commands) {
    const result = runVerification(cmd);
    results.push(result);
    if (!result.success) {
      allPassed = false;
    }
  }
  
  // Update state
  state.verificationPending = !allPassed;
  state.editsSinceVerification = allPassed ? 0 : state.editsSinceVerification;
  state.lastVerificationTime = Date.now();
  state.verificationResults = results;
  
  saveState(state);
  
  // Output results
  console.log(JSON.stringify({
    hook: 'verification-runner',
    action: 'verify',
    allPassed,
    results: results.map(r => ({
      command: r.command,
      success: r.success
    })),
    message: allPassed 
      ? 'All verification passed. You can now complete.'
      : 'Verification failed. Fix issues before completing.'
  }));
}

main();

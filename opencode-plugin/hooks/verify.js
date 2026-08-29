#!/usr/bin/env node
/**
 * Verification Runner Hook
 * 
 * Runs verification commands and updates state.
 * This hook runs available verification commands (npm test, lint, build) and:
 * 1. Detects available scripts from package.json
 * 2. Executes only available verification commands
 * 3. Updates state to reflect verification status
 * 4. Logs verification results
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.harness-state');
const STATE_FILE = path.join(STATE_DIR, 'edit-state.json');

// Ensure state directory exists
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

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

function getAvailableScripts() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.scripts || {};
  } catch {
    return [];
  }
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
  
  // Get available scripts from package.json
  const scripts = getAvailableScripts();
  
  // Verification commands to try (only if script exists)
  const possibleCommands = [
    { cmd: 'npm test', script: 'test' },
    { cmd: 'npm run lint', script: 'lint' },
    { cmd: 'npm run build', script: 'build' }
  ];
  
  const commands = possibleCommands
    .filter(c => scripts[c.script])
    .map(c => c.cmd);
  
  // If no verification scripts available, check if we should skip
  if (commands.length === 0) {
    // No npm verification available - check if this is a non-code task
    // Allow completion without npm verification for doc-only tasks
    console.log(JSON.stringify({
      hook: 'verification-runner',
      action: 'verify',
      allPassed: true,
      results: [],
      message: 'No npm verification scripts available. Skipping npm verification (non-code task assumed).',
      skipped: true
    }));
    return;
  }
  
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
      ? 'All available verification passed. You can now complete.'
      : 'Some verification failed. Fix issues before completing.'
  }));
}

main();

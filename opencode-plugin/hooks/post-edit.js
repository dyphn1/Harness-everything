#!/usr/bin/env node
/**
 * Post-Edit Verification Hook
 * 
 * Enforces verification after file edits in opencode.
 * This hook runs after every Edit or Write tool use and:
 * 1. Records that an edit occurred
 * 2. Blocks completion until verification runs
 * 3. Logs compliance status
 */

const fs = require('fs');
const path = require('path');

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

function main() {
  const state = loadState();
  
  // Record edit
  state.lastEditTime = Date.now();
  state.verificationPending = true;
  state.editsSinceVerification++;
  
  saveState(state);
  
  // Output enforcement message
  console.log(JSON.stringify({
    hook: 'post-edit-verification',
    action: 'record',
    editsSinceVerification: state.editsSinceVerification,
    message: `Edit recorded. ${state.editsSinceVerification} edit(s) since last verification. Run verification before completing.`
  }));
}

main();

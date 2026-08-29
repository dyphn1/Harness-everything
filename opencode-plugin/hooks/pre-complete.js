#!/usr/bin/env node
/**
 * Pre-Complete Verification Gate
 * 
 * Blocks completion until verification runs after edits.
 * This hook runs before the agent claims work is done and:
 * 1. Checks if verification is pending
 * 2. Blocks completion if verification hasn't run
 * 3. Allows completion if verification passed or no edits occurred
 */

const fs = require('fs');
const path = require('path');

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

function main() {
  const state = loadState();
  
  // Check if verification is pending
  if (state.verificationPending && state.editsSinceVerification > 0) {
    // Block completion
    console.log(JSON.stringify({
      hook: 'pre-complete-verification',
      action: 'block',
      reason: 'verification_pending',
      editsSinceVerification: state.editsSinceVerification,
      message: `Cannot complete: ${state.editsSinceVerification} edit(s) since last verification. Run verification first.`,
      instructions: 'Run verification: node .harness-src/opencode-plugin/hooks/verify.js'
    }));
    
    // Exit with non-zero to block
    process.exit(1);
  }
  
  // Allow completion
  console.log(JSON.stringify({
    hook: 'pre-complete-verification',
    action: 'allow',
    message: 'Verification complete or no edits pending.'
  }));
}

main();

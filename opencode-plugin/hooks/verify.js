#!/usr/bin/env node
/**
 * Manual verification runner CLI.
 *
 * opencode itself never invokes this file - the real plugin (../index.mjs)
 * runs its own inlined copy of this logic from the session.idle event, since
 * opencode plugins must be a single loadable module (see issue #37). This
 * script stays as a standalone command a human (or the message a hook prints)
 * can run directly: `node opencode-plugin/hooks/verify.js`.
 *
 * Run it from the workspace under test, never from the Harness repo root -
 * from there it would re-enter `npm test` from inside `npm test`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Same convention as ../index.mjs's inlined copy (and the Node-side
// scripts/lib/workspace.js#getStateHome) - a global root keyed per real
// workspace, not the flat `~/.harness-state` every project used to share
// (issue #42 item #4). Keyed off process.cwd() here since this CLI is meant
// to be run "from the workspace under test" (see header comment above).
function getStateDir() {
  const home = process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
  let real = path.resolve(process.cwd());
  try { real = fs.realpathSync(real); } catch (e) { /* cwd always exists in practice */ }
  const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = crypto.createHash('sha1').update(real).digest('hex').slice(0, 12);
  return path.join(home, 'workspaces', `${slug}-${hash}`);
}

const STATE_DIR = getStateDir();
const STATE_FILE = path.join(STATE_DIR, 'edit-state.json');

// Ensure state directory exists, migrating the pre-fix flat ~/.harness-state
// files in once if this is the first workspace to run since upgrading.
if (!fs.existsSync(STATE_DIR)) {
  const legacyDir = path.join(os.homedir(), '.harness-state');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (fs.existsSync(legacyDir)) {
    try {
      for (const name of ['edit-state.json', 'circuit-breaker.json', 'compliance.json']) {
        const src = path.join(legacyDir, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(STATE_DIR, name));
      }
      fs.rmSync(legacyDir, { recursive: true, force: true });
    } catch (e) {
      // Best-effort - worst case the legacy dir lingers.
    }
  }
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

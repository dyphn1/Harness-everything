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
let getWorkspaceRoot;
try {
  ({ getWorkspaceRoot } = require('../../scripts/lib/workspace'));
} catch (err) {
  getWorkspaceRoot = () => null;
}

// Same convention as ../index.mjs's inlined copy (and the Node-side
// scripts/lib/workspace.js#getStateHome) - a global root keyed per real
// workspace, not the flat `~/.harness-state` every project used to share
// (issue #42 item #4). Keyed off process.cwd() here since this CLI is meant
// to be run "from the workspace under test" (see header comment above).
function getStateDir() {
  const home = process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
  const root = getWorkspaceRoot();
  if (!root) return path.join(home, 'workspaces', 'unbound-workspace');
  let real = path.resolve(root);
  try { real = fs.realpathSync(real); } catch (e) { /* cwd always exists in practice */ }
  const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? real.toLowerCase() : real;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  return path.join(home, 'workspaces', `${slug}-${hash}`);
}

const STATE_DIR = getStateDir();
const STATE_FILE = path.join(STATE_DIR, 'edit-state.json');

// Ensure state directory exists, migrating the pre-fix flat ~/.harness-state
// files even when a new workspace directory was already created by another
// hook in this process.
function migrateLegacyFlatState(stateDir) {
  const legacyDir = path.join(os.homedir(), '.harness-state');
  if (!fs.existsSync(legacyDir)) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    let conflict = false;
    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        conflict = true;
        continue;
      }
      const src = path.join(legacyDir, entry.name);
      const destination = path.join(stateDir, entry.name);
      if (!fs.existsSync(destination)) fs.copyFileSync(src, destination);
      else if (!fs.readFileSync(src).equals(fs.readFileSync(destination))) conflict = true;
    }
    if (!conflict) fs.rmSync(legacyDir, { recursive: true, force: true });
  } catch (e) {
    // Best-effort - a failed or conflicting source remains available.
  }
}

fs.mkdirSync(STATE_DIR, { recursive: true });
migrateLegacyFlatState(STATE_DIR);

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

// Mirrors ../index.mjs's verification budget and outcome classification so
// the manual CLI cannot drift from the plugin. A 60s cap killed healthy
// ~2 minute self-regression runs. Only `test_failure` (a real non-zero exit)
// is a confirmed failing check; `timeout` and `execution_error` mean the run
// produced no verdict. A signal alone is not a budget timeout - only expiry
// (ETIMEDOUT, or a kill with no exit status once the budget elapsed) is.
const VERIFY_TIMEOUT_ENV = 'HARNESS_VERIFY_TIMEOUT_MS';
const DEFAULT_VERIFY_TIMEOUT_MS = 600000;
const VERIFY_MAX_BUFFER = 16 * 1024 * 1024;
const VERIFY_OUTPUT_LIMIT = 2000;

function verifyTimeoutMs() {
  const raw = Number(process.env[VERIFY_TIMEOUT_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFY_TIMEOUT_MS;
}

// Full failure evidence for signature analysis (stdout and stderr both, in
// full) - kept identical to ../index.mjs's inlined copy.
function verificationEvidence(stdout, stderr) {
  const out = String(stdout || '');
  const err = String(stderr || '');
  if (out && err) return `${out}\nstderr:\n${err}`;
  return out || err;
}

// Bounded excerpt that keeps both ends (npm banner plus failure tail).
function boundedDiagnostic(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  const half = Math.floor(limit / 2);
  return `${value.slice(0, half)}\n... [${value.length - half * 2} chars omitted] ...\n${value.slice(-half)}`;
}

// User-visible diagnostic: both streams get their own budget; a single
// non-empty stream stays label-free.
function verificationDiagnostic(stdout, stderr) {
  const out = String(stdout || '');
  const err = String(stderr || '');
  if (out && err) {
    const share = Math.floor(VERIFY_OUTPUT_LIMIT / 2);
    return `stdout:\n${boundedDiagnostic(out, share)}\nstderr:\n${boundedDiagnostic(err, share)}`;
  }
  return boundedDiagnostic(out || err, VERIFY_OUTPUT_LIMIT);
}

function classifyVerificationError(error, startedAt, timeout) {
  const code = String((error && error.code) || '');
  const signal = String((error && error.signal) || '');
  const exitCode = error && Number.isInteger(error.status) ? error.status : null;
  const budgetExpired =
    code === 'ETIMEDOUT' || (exitCode === null && Date.now() - startedAt >= timeout);
  if (budgetExpired) return { outcome: 'timeout', exitCode, signal, timedOut: true };
  if (exitCode === null || ['ENOBUFS', 'ENOENT', 'EACCES', 'EAGAIN', 'ENOMEM'].includes(code)) {
    return { outcome: 'execution_error', exitCode, signal, timedOut: false };
  }
  return { outcome: 'test_failure', exitCode, signal, timedOut: false };
}

function runVerification(command) {
  const timeout = verifyTimeoutMs();
  const startedAt = Date.now();
  try {
    execSync(command, {
      stdio: 'pipe',
      timeout,
      maxBuffer: VERIFY_MAX_BUFFER
    });
    return { success: true, command, outcome: 'pass', exitCode: 0, signal: null, timedOut: false };
  } catch (e) {
    const stdout = (e.stdout || '').toString();
    const stderr = (e.stderr || '').toString();
    const output = verificationEvidence(stdout, stderr) || String((e && e.message) || '');
    const { outcome, exitCode, signal, timedOut } = classifyVerificationError(e, startedAt, timeout);
    let error;
    if (outcome === 'timeout') {
      error = `timed out after ${Math.round(timeout / 1000)}s (set ${VERIFY_TIMEOUT_ENV} to raise it)`;
    } else if (outcome === 'execution_error') {
      const reason = String((e && e.code) || (signal ? `signal ${signal}` : 'no exit status'));
      error = `could not run to completion (execution error: ${reason}); output: ${output.slice(0, 200).replace(/\s+/g, ' ').trim() || '(none)'}`;
    } else {
      error = verificationDiagnostic(stdout, stderr) || String((e && e.message) || '');
    }
    const result = { success: false, command, outcome, exitCode, signal, timedOut, error };
    if (outcome === 'test_failure' && output) result.evidence = output;
    return result;
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
  
  // Update state. The full `evidence` strings are analysis-only (they can
  // approach VERIFY_MAX_BUFFER); persist just the bounded diagnostic so
  // edit-state.json stays small.
  state.verificationPending = !allPassed;
  state.editsSinceVerification = allPassed ? 0 : state.editsSinceVerification;
  state.lastVerificationTime = Date.now();
  state.verificationResults = results.map(({ evidence, ...rest }) => rest);
  
  saveState(state);
  
  // Output results
  console.log(JSON.stringify({
    hook: 'verification-runner',
    action: 'verify',
    allPassed,
    results: results.map(r => ({
      command: r.command,
      success: r.success,
      outcome: r.outcome,
      timedOut: r.timedOut === true
    })),
    message: allPassed 
      ? 'All available verification passed. You can now complete.'
      : 'Some verification failed. Fix issues before completing.'
  }));
}

main();

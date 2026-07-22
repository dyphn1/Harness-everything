#!/usr/bin/env node
// Shared path resolution for Harness runtime state (hook JSON, circuit-breaker
// counters, handoff/verification timestamps, etc). Separate from `.harness/`,
// which is the installer's local-scope skill copy target
// (scripts/installer.js `getInstalledSkills`) - unrelated content that must
// not move here.
//
// State lives at `<repo root>/.claude/harness-state/`, keyed by Claude Code
// session_id under `sessions/<id>/` so two sessions open on the same repo
// never share (and stomp) each other's edit/verify timestamps or breaker
// counts. Invocations with no session_id (manual terminal runs,
// VERIFICATION.md recipes) fall into a fixed `sessions/default/` bucket
// rather than a random one, so manual testing stays predictable.
const fs = require('fs');
const path = require('path');

const CURRENT_SESSION_FILE = 'current-session';
const DEFAULT_SESSION = 'default';

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function getStateRoot(root) {
  return path.join(root || getWorkspaceRoot(), '.claude', 'harness-state');
}

function getSessionDir(root, sessionId) {
  const dir = path.join(getStateRoot(root), 'sessions', sessionId || DEFAULT_SESSION);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listSessionDirs(root) {
  const sessionsRoot = path.join(getStateRoot(root), 'sessions');
  try {
    return fs.readdirSync(sessionsRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(sessionsRoot, e.name));
  } catch (err) {
    return [];
  }
}

function writeCurrentSession(root, sessionId) {
  if (!sessionId) return;
  try {
    const stateRoot = getStateRoot(root);
    fs.mkdirSync(stateRoot, { recursive: true });
    fs.writeFileSync(path.join(stateRoot, CURRENT_SESSION_FILE), sessionId, 'utf8');
  } catch (err) {
    // Best-effort - only the manual reset-circuit-breaker.js escape hatch
    // depends on this, and it fails open too.
  }
}

function readCurrentSession(root) {
  try {
    const id = fs.readFileSync(path.join(getStateRoot(root), CURRENT_SESSION_FILE), 'utf8').trim();
    return id || null;
  } catch (err) {
    return null;
  }
}

// Bootstrap-time housekeeping: nothing purges stale session directories the
// way an OS temp dir would, so SessionStart drops ones untouched for a while.
function pruneStaleSessions(root, maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const dir of listSessionDirs(root)) {
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore - worst case a stale dir lingers until the next prune.
    }
  }
}

module.exports = {
  DEFAULT_SESSION,
  getWorkspaceRoot,
  getStateRoot,
  getSessionDir,
  listSessionDirs,
  writeCurrentSession,
  readCurrentSession,
  pruneStaleSessions,
};

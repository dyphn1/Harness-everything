#!/usr/bin/env node
// Shared path resolution for Harness runtime state (hook JSON, circuit-breaker
// counters, handoff/verification timestamps, etc).
//
// Lives under a single user-global root - `getWorkspaceStateDir()` from
// scripts/lib/workspace.js, i.e. `~/.agents/harness-everything/workspaces/
// <slug-hash>/state/` - keyed by the workspace's real (symlink-resolved)
// path, NEVER by process.cwd() at invocation time. Earlier versions rooted
// state under `<workspace>/.claude/harness-everything/state/` (or the
// per-platform equivalent from hooks/scripts/lib/platforms/), which silently
// re-materialized in whatever directory a script happened to be invoked
// from - a test fixture, a worktree, a submodule - because the underlying
// workspace-root walk falls back to bare process.cwd() when no `.git`
// ancestor exists. Rooting at a fixed global location instead of a
// cwd-derived one closes that hole entirely (issue #42); migrateLegacyState()
// below moves any state a pre-fix install already scattered into a
// workspace, once, the first time that workspace is seen again.
//
// Session state keys under `sessions/<id>/` so two sessions open on the same
// workspace never share (and stomp) each other's edit/verify timestamps or
// breaker counts. Invocations with no session_id (manual terminal runs,
// VERIFICATION.md recipes) fall into a fixed `sessions/default/` bucket
// rather than a random one, so manual testing stays predictable.
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getWorkspaceStateDir } = require('../../../scripts/lib/workspace');

const CURRENT_SESSION_FILE = 'current-session';
const DEFAULT_SESSION = 'default';
const MIGRATION_MARKER = '.migrated-from';

function detectActivePlatform(wsRoot) {
  const root = wsRoot || getWorkspaceRoot();

  // 1. Explicit environment variables - strongest signal. Claude Code sets
  //    CLAUDECODE=1 / CLAUDE_CODE_ENTRYPOINT inside its own shell; a bare
  //    TERM_PROGRAM=vscode does NOT mean Copilot, because Claude Code's
  //    integrated terminal reports vscode too.
  const env = process.env;
  if (env.CLAUDE === '1' || env.CLAUDE || env.CLAUDECODE === '1' ||
      env.CLAUDE_CODE === 'true' || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (env.CURSOR === '1' || env.CURSOR || env.CURSOR_AGENT) return 'cursor';
  if (env.COPILOT === '1' || env.COPILOT || env.GITHUB_COPILOT_CHAT === 'true') return 'copilot';
  if (env.CONTINUE === '1' || env.CONTINUE) return 'continue';

  // 2. Workspace configuration presence - which platform's config actually
  //    lives here beats inferring from the terminal program.
  if (fs.existsSync(path.join(root, '.claude', 'settings.json'))) return 'claude';
  if (fs.existsSync(path.join(root, '.cursorrules'))) return 'cursor';
  if (fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) return 'copilot';
  if (fs.existsSync(path.join(root, '.continue'))) return 'continue';
  if (fs.existsSync(path.join(root, 'AGENTS.md'))) return 'codex';
  if (fs.existsSync(path.join(root, '.hermes.md'))) return 'hermes';

  // 3. Weak terminal inference, last resort only.
  if (env.TERM_PROGRAM === 'vscode') return 'copilot';

  return 'claude'; // Default global fallback
}

// Runtime hooks must NEVER touch .gitignore - that file is install/uninstall
// territory (scripts/installer.js -> lib/gitignore.js). Rewriting it on every
// hook invocation caused repeated diffs and surprised users mid-session.

// One-time move of state a pre-#42 install left inside the workspace (under
// any platform's old `<workspaceRoot>/.<platform>/harness-everything/state/`
// - see hooks/scripts/lib/platforms/*.getStateDir()) into the new global
// location. Tries every platform's legacy dir, not just the currently
// detected one, since a workspace may have been used under a different
// platform (or misdetected) before this fix landed. Best-effort and
// idempotent: only runs while `newStateDir` doesn't exist yet, so it can
// never clobber state a later run already wrote or migrated.
function migrateLegacyState(wsRoot, newStateDir) {
  if (fs.existsSync(newStateDir)) return;
  let allPlatforms;
  try { allPlatforms = require('./platforms'); } catch (err) { return; }
  for (const platform of allPlatforms) {
    if (typeof platform.getStateDir !== 'function') continue;
    let legacyDir;
    try { legacyDir = platform.getStateDir(wsRoot); } catch (err) { continue; }
    if (!legacyDir || path.resolve(legacyDir) === path.resolve(newStateDir)) continue;
    if (!fs.existsSync(legacyDir)) continue;
    try {
      fs.mkdirSync(path.dirname(newStateDir), { recursive: true });
      fs.cpSync(legacyDir, newStateDir, { recursive: true });
      fs.rmSync(legacyDir, { recursive: true, force: true });
      fs.writeFileSync(
        path.join(newStateDir, MIGRATION_MARKER),
        `${legacyDir}\n${new Date().toISOString()}\n`,
        'utf8'
      );
      return; // first legacy dir found wins - state doesn't merge across platforms
    } catch (err) {
      // Fail open - worst case the legacy dir lingers and enforcement starts
      // a fresh state stream at the new location instead.
    }
  }
}

function getStateRoot(root) {
  const wsRoot = root || getWorkspaceRoot();
  const stateDir = path.join(getWorkspaceStateDir(wsRoot), 'state');
  migrateLegacyState(wsRoot, stateDir);
  return stateDir;
}

function getSessionDir(root, sessionId) {
  const resolvedRoot = root || getWorkspaceRoot();
  const dir = path.join(getStateRoot(resolvedRoot), 'sessions', sessionId || DEFAULT_SESSION);
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
    const wsRoot = root || getWorkspaceRoot();
    const stateRoot = getStateRoot(wsRoot);
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
  detectActivePlatform,
  getStateRoot,
  getSessionDir,
  listSessionDirs,
  writeCurrentSession,
  readCurrentSession,
  pruneStaleSessions,
};

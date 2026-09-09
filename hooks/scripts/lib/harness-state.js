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
const { getWorkspaceRoot, getWorkspaceStateDir, resolveWorkspaceIdentity, getSessionId } = require('../../../scripts/lib/workspace');

const CURRENT_SESSION_FILE = 'current-session';
const DEFAULT_SESSION = 'default';
const MIGRATION_MARKER = '.migrated-from';

function sessionDirectoryName(sessionId) {
  const value = String(sessionId || DEFAULT_SESSION)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 128);
  return value || DEFAULT_SESSION;
}

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

// Move state a pre-#42 install left inside the workspace (under
// any platform's old `<workspaceRoot>/.<platform>/harness-everything/state/`
// - see hooks/scripts/lib/platforms/*.getStateDir()) into the new global
// location. Tries every platform's legacy dir, not just the currently
// detected one, since a workspace may have been used under a different
// platform (or misdetected) before this fix landed. The destination may
// already exist: migration merges every source into it without overwriting
// newer state. A source is removed only after its complete merge succeeds;
// failed/conflicting sources remain in place so a later invocation can retry.
function migrateLegacyState(wsRoot, newStateDir) {
  const results = [];
  let allPlatforms;
  try { allPlatforms = require('./platforms'); } catch (err) { return results; }
  const seen = new Set();
  for (const platform of allPlatforms) {
    if (typeof platform.getStateDir !== 'function') continue;
    let legacyDir;
    try { legacyDir = platform.getStateDir(wsRoot); } catch (err) { continue; }
    if (!legacyDir || path.resolve(legacyDir) === path.resolve(newStateDir)) continue;
    const legacyKey = path.resolve(legacyDir).toLowerCase();
    if (seen.has(legacyKey)) continue;
    seen.add(legacyKey);
    if (!fs.existsSync(legacyDir)) continue;
    try {
      mergeLegacyTree(legacyDir, newStateDir);
      fs.rmSync(legacyDir, { recursive: true, force: true });
      try { appendMigrationMarker(newStateDir, legacyDir); } catch (markerError) {
        // The source has already been removed; a missing breadcrumb must not
        // be reported as a preserved source or make the migration retry.
      }
      results.push({ source: legacyDir, status: 'migrated' });
    } catch (err) {
      // Preserve the legacy source. A partial merge is safe to retry because
      // identical destination files are skipped and conflicting files cause
      // the source to remain available for manual recovery.
      results.push({ source: legacyDir, status: 'preserved', error: err.message });
    }
  }
  if (results.some(result => result.status === 'preserved')) {
    writeMigrationReport(newStateDir, results);
  }
  return results;
}

function mergeLegacyTree(source, target) {
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isDirectory()) throw new Error(`legacy state is not a directory: ${source}`);
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (pathExists(to) && !fs.lstatSync(to).isDirectory()) {
        throw new Error(`legacy state conflicts with a file: ${to}`);
      }
      mergeLegacyTree(from, to);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`unsupported legacy state entry (preserved): ${from}`);
    }
    if (pathExists(to)) {
      if (!fs.lstatSync(to).isFile() || !filesEqual(from, to)) {
        throw new Error(`legacy state conflicts with existing state: ${to}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      // A concurrent migration may have won the exclusive create. Accept it
      // only when the resulting file is byte-for-byte identical; never let a
      // race overwrite newer state.
      if (err.code !== 'EEXIST' || !filesEqual(from, to)) throw err;
    }
  }
}

function pathExists(target) {
  try { fs.lstatSync(target); return true; } catch (err) { return false; }
}

function filesEqual(left, right) {
  try { return fs.readFileSync(left).equals(fs.readFileSync(right)); } catch (err) { return false; }
}

function appendMigrationMarker(newStateDir, legacyDir) {
  fs.mkdirSync(newStateDir, { recursive: true });
  const marker = path.join(newStateDir, MIGRATION_MARKER);
  const prior = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
  const line = `${legacyDir}\t${new Date().toISOString()}\n`;
  if (!prior.split('\n').some(existing => existing.startsWith(`${legacyDir}\t`))) {
    fs.writeFileSync(marker, prior + line, 'utf8');
  }
}

function writeMigrationReport(newStateDir, results) {
  try {
    const reportPath = path.join(path.dirname(newStateDir), 'migration-report.json');
    let report = { version: 1, sources: [] };
    if (fs.existsSync(reportPath)) {
      try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (err) { /* replace malformed report */ }
    }
    const bySource = new Map((report.sources || []).map(entry => [entry.source, entry]));
    for (const result of results) bySource.set(result.source, { ...result, updatedAt: new Date().toISOString() });
    report.sources = [...bySource.values()];
    report.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    // The source directory remains the recovery record when the report itself
    // cannot be written (for example, a read-only state home).
  }
}

function getStateRoot(root, context) {
  const wsRoot = root || getWorkspaceRoot(context);
  const stateDir = path.join(getWorkspaceStateDir(wsRoot), 'state');
  migrateLegacyState(wsRoot, stateDir);
  return stateDir;
}

function getSessionDir(root, sessionId, context) {
  const resolvedRoot = root || getWorkspaceRoot(context || (typeof sessionId === 'object' ? sessionId : undefined));
  if (sessionId && typeof sessionId === 'object') sessionId = getSessionId(sessionId);
  const dir = path.join(getStateRoot(resolvedRoot), 'sessions', sessionDirectoryName(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listSessionDirs(root, context) {
  const sessionsRoot = path.join(getStateRoot(root, context), 'sessions');
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
  sessionDirectoryName,
  getWorkspaceRoot,
  getSessionId,
  resolveWorkspaceIdentity,
  detectActivePlatform,
  getStateRoot,
  getSessionDir,
  listSessionDirs,
  migrateLegacyState,
  writeCurrentSession,
  readCurrentSession,
  pruneStaleSessions,
};

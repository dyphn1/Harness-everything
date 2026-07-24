#!/usr/bin/env node
// Shared path resolution for Harness runtime state (hook JSON, circuit-breaker
// counters, handoff/verification timestamps, etc). Lives under the active
// platform's own harness-everything/ subfolder (see each module's
// getStateDir() in hooks/scripts/lib/platforms/) - a sibling of that same
// platform's install manifest, and (for Claude only) its skill copies.
//
// For Claude Code that's `<repo root>/.claude/harness-everything/state/`,
// keyed by session_id under `sessions/<id>/` so two sessions open on the same
// repo never share (and stomp) each other's edit/verify timestamps or
// breaker counts. Invocations with no session_id (manual terminal runs,
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

function detectActivePlatform(wsRoot) {
  const root = wsRoot || getWorkspaceRoot();
  
  // 1. Check explicit environment variables
  if (process.env.CLAUDE === '1' || process.env.CLAUDE) return 'claude';
  if (process.env.CURSOR === '1' || process.env.CURSOR) return 'cursor';
  if (process.env.COPILOT === '1' || process.env.COPILOT) return 'copilot';
  if (process.env.CONTINUE === '1' || process.env.CONTINUE) return 'continue';
  
  // 2. Check parent/environment standard indicators
  if (process.env.TERM_PROGRAM === 'vscode') {
    if (fs.existsSync(path.join(root, '.cursorrules'))) {
      return 'cursor';
    }
    if (fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) {
      return 'copilot';
    }
    return 'copilot'; // Default fallback for standard VS Code terminal
  }
  
  // 3. Fallback to detecting workspace configuration presence
  if (fs.existsSync(path.join(root, '.claude', 'settings.json'))) return 'claude';
  if (fs.existsSync(path.join(root, '.cursorrules'))) return 'cursor';
  if (fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) return 'copilot';
  if (fs.existsSync(path.join(root, '.continue'))) return 'continue';
  if (fs.existsSync(path.join(root, 'AGENTS.md'))) return 'codex';
  if (fs.existsSync(path.join(root, '.hermes.md'))) return 'hermes';
  
  return 'claude'; // Default global fallback
}

function ensureHarnessStateIgnored(rootPath) {
  const wsRoot = rootPath || getWorkspaceRoot();
  const gitignorePath = path.join(wsRoot, '.gitignore');
  
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }
    
    const lines = content.split(/\r?\n/);
    const patternsToAdd = [];
    
    // Load and collect patterns & matching rules dynamically from all platforms
    const allPlatforms = require('./platforms');
    const dynamicPatterns = [];
    const patternToPlatformMap = new Map();
    
    // Forcefully ensure active platform's state directory pattern is included
    const activePlatformName = detectActivePlatform(wsRoot);
    const activePlatform = allPlatforms.find(p => p.name === activePlatformName) || allPlatforms.find(p => p.name === 'claude');
    
    if (activePlatform && typeof activePlatform.getStateDir === 'function') {
      const activeStateDir = activePlatform.getStateDir(wsRoot);
      const relativeStateDir = path.relative(wsRoot, activeStateDir).replace(/\\/g, '/') + '/';
      dynamicPatterns.push(relativeStateDir);
      patternToPlatformMap.set(relativeStateDir, activePlatform);
    }
    
    for (const platform of allPlatforms) {
      const patterns = platform.getIgnorePatterns(wsRoot);
      for (const pattern of patterns) {
        if (!dynamicPatterns.includes(pattern)) {
          dynamicPatterns.push(pattern);
        }
        patternToPlatformMap.set(pattern, platform);
      }
    }
    
    for (const pattern of dynamicPatterns) {
      const platform = patternToPlatformMap.get(pattern);
      const isIgnored = lines.some(line => {
        const trimmed = line.trim();
        // Delegate matching logic to the specific platform module if available
        if (platform && typeof platform.isMatch === 'function') {
          return platform.isMatch(pattern, trimmed);
        }
        return trimmed === pattern || trimmed === pattern.slice(0, -1);
      });
      
      if (!isIgnored) {
        patternsToAdd.push(pattern);
      }
    }
    
    // This runs once per hook invocation - i.e. once per Claude Code
    // subprocess - with no cross-process lock around the read-then-append
    // below. Two hook invocations firing close together (e.g. two tool
    // calls in the same turn) can each read the file before either has
    // written, so both decide the same pattern is missing and both append
    // it, leaving an exact duplicate line behind. Rather than add real
    // cross-process locking for a housekeeping file that already fails
    // silently by design, every call also collapses any exact-duplicate
    // non-comment/non-blank line it finds - so a duplicate from a lost
    // race self-heals on the very next invocation instead of accumulating.
    const seen = new Set();
    let sawDuplicate = false;
    const dedupedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) return true;
      if (seen.has(trimmed)) {
        sawDuplicate = true;
        return false;
      }
      seen.add(trimmed);
      return true;
    });

    if (patternsToAdd.length > 0 || sawDuplicate) {
      while (dedupedLines.length > 0 && dedupedLines[dedupedLines.length - 1] === '') {
        dedupedLines.pop();
      }
      const finalLines = dedupedLines.concat(patternsToAdd);
      fs.writeFileSync(gitignorePath, finalLines.join('\n') + '\n', 'utf8');
    }
  } catch (err) {
    // Fail silently to avoid breaking execution if .gitignore is write-locked
  }
}

function getStateRoot(root) {
  const wsRoot = root || getWorkspaceRoot();
  const activePlatformName = detectActivePlatform(wsRoot);
  const allPlatforms = require('./platforms');
  const activePlatform = allPlatforms.find(p => p.name === activePlatformName) || allPlatforms.find(p => p.name === 'claude');
  
  if (activePlatform && typeof activePlatform.getStateDir === 'function') {
    return activePlatform.getStateDir(wsRoot);
  }
  return path.join(wsRoot, '.claude', 'harness-state');
}

function getSessionDir(root, sessionId) {
  const resolvedRoot = root || getWorkspaceRoot();
  ensureHarnessStateIgnored(resolvedRoot);
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
    ensureHarnessStateIgnored(wsRoot);
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
  getStateRoot,
  getSessionDir,
  listSessionDirs,
  writeCurrentSession,
  readCurrentSession,
  pruneStaleSessions,
};

#!/usr/bin/env node
/**
 * Atomic Commit Check (PostToolUse: Edit/Write/apply_patch)
 * PostToolUse can't block - the edit/write already happened. Count only edits
 * whose targets resolve inside the current workspace. Once the count crosses
 * the threshold, emit a strong reminder only when the Git worktree actually
 * has uncommitted changes. Resets whenever HEAD moves.
 * Fails open on any error - this is a nudge, never a hard stop.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

const THRESHOLD = 6;
const RENUDGE_EVERY = 3;

function toolNameOf(payload) {
  return String((payload && (payload.tool_name || payload.toolName)) || '');
}

function toolInputOf(payload) {
  return (payload && (payload.tool_input || payload.toolInput || payload.input)) || {};
}

function pathApiFor(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || '')) ? path.win32 : path;
}

function canonicalPath(value) {
  const text = String(value || '');
  if (!text) return null;
  const api = pathApiFor(text);
  const resolved = api.resolve(text);

  // realpath() is necessary on macOS where /var is a symlink to /private/var.
  // New Write targets may not exist yet, so canonicalize the nearest existing
  // ancestor and append the missing path segments without requiring creation.
  const missing = [];
  let cursor = resolved;
  while (cursor && !fs.existsSync(cursor)) {
    const parent = api.dirname(cursor);
    if (!parent || parent === cursor) break;
    missing.unshift(api.basename(cursor));
    cursor = parent;
  }
  if (!cursor || !fs.existsSync(cursor)) return resolved;

  let real = fs.realpathSync.native ? fs.realpathSync.native(cursor) : fs.realpathSync(cursor);
  for (const segment of missing) real = api.join(real, segment);
  return api.normalize(real);
}

function isWithin(target, root) {
  if (!target || !root) return false;
  const api = pathApiFor(target) === path.win32 || pathApiFor(root) === path.win32 ? path.win32 : path;
  const resolvedTarget = canonicalPath(target);
  const resolvedRoot = canonicalPath(root);
  const relative = api.relative(resolvedRoot, resolvedTarget);
  if (!relative) return true;
  return relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative);
}

function absoluteTarget(target, root) {
  const text = String(target || '').trim();
  if (!text) return null;
  const api = pathApiFor(text) === path.win32 || pathApiFor(root) === path.win32 ? path.win32 : path;
  return api.isAbsolute(text) ? api.normalize(text) : api.resolve(root, text);
}

function patchTargets(patchText) {
  const targets = [];
  const regex = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm;
  let match;
  while ((match = regex.exec(String(patchText || ''))) !== null) targets.push(match[1]);
  return targets;
}

function editTargets(payload) {
  const tool = toolNameOf(payload);
  const input = toolInputOf(payload);
  if (tool === 'Edit' || tool === 'Write') {
    const target = input.file_path || input.filePath || input.path;
    return target ? [String(target)] : [];
  }
  if (tool === 'apply_patch') {
    return patchTargets(input.patch || input.command || input.content || '');
  }
  return [];
}

function touchesWorkspace(payload, root) {
  const targets = editTargets(payload);
  if (targets.length === 0) return false;
  return targets.some(target => isWithin(absoluteTarget(target, root), root));
}

function writeState(stateFile, state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function main(payload) {
  try {
    const root = getWorkspaceRoot(payload);
    const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    const stateFile = path.join(getSessionDir(root, payload && (payload.session_id || payload.sessionId)), 'atomic-commit-state.json');

    let state = { lastHead: head, editCount: 0 };
    if (fs.existsSync(stateFile)) {
      try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* use default */ }
    }

    if (state.lastHead !== head) {
      // A commit happened since we last checked - fresh start.
      state.lastHead = head;
      state.editCount = 0;
    }

    // Host scratchpads, memory stores, temp files, and any other target outside
    // the repository must not contribute to a repository commit reminder.
    if (!touchesWorkspace(payload, root)) {
      writeState(stateFile, state);
      process.exit(0);
    }

    state.editCount += 1;
    writeState(stateFile, state);

    const overThreshold = state.editCount >= THRESHOLD;
    const onNudgeBeat = overThreshold && (state.editCount - THRESHOLD) % RENUDGE_EVERY === 0;

    if (onNudgeBeat) {
      const statusRaw = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (!statusRaw) {
        // Calls that produced no Git-visible change (or work already reverted)
        // must not leave a stale counter that immediately re-nudges later.
        state.editCount = 0;
        writeState(stateFile, state);
        process.exit(0);
      }

      const changedFiles = statusRaw.split('\n').length;
      console.error(`[Atomic Commit Check] ${state.editCount} edits since the last commit (${changedFiles} files currently changed).`);
      console.error('If a logically complete chunk of work is done, commit it now before continuing - large uncommitted diffs are harder to review and harder to recover from.');
      process.exit(2);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

let inputData = '';
const timeout = setTimeout(() => { main(null); }, 200);
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  let payload = null;
  try { payload = JSON.parse(inputData.trim()); } catch (err) { /* no payload */ }
  main(payload);
});
process.stdin.on('error', () => {
  clearTimeout(timeout);
  main(null);
});

module.exports = {
  absoluteTarget,
  canonicalPath,
  editTargets,
  isWithin,
  patchTargets,
  touchesWorkspace,
};

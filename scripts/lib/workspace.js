const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// Single global root for ALL Harness runtime state (session counters,
// circuit-breaker trips, audit logs, handoff timestamps, ...). Never
// cwd-derived, so a script invoked from a fixture dir, worktree, submodule,
// or any other nested non-git directory can never scatter files there
// (issue #42). `$HARNESS_STATE_HOME` matches the env var the opencode
// plugin already used for its own (differently-rooted) global state.
function getStateHome() {
  return process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
}

// Keys runtime state per real workspace instead of per invocation cwd, so
// two different repos (or a repo and a stray subdirectory someone `cd`ed
// into) never collide or fork the same state stream. Uses the resolved real
// path (symlinks collapsed) hashed short, prefixed with a readable slug
// purely so `~/.agents/harness-everything/workspaces/` stays eyeballable.
function getWorkspaceKey(root) {
  const resolved = path.resolve(root || getWorkspaceRoot());
  let real = resolved;
  try { real = fs.realpathSync(resolved); } catch (err) { /* path may not exist yet (tests) */ }
  const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = crypto.createHash('sha1').update(real).digest('hex').slice(0, 12);
  return `${slug}-${hash}`;
}

function getWorkspaceStateDir(root) {
  return path.join(getStateHome(), 'workspaces', getWorkspaceKey(root));
}

function getUserPromptsDir() {
  if (process.env.VSCODE_USER_PROMPTS_FOLDER) {
    return process.env.VSCODE_USER_PROMPTS_FOLDER;
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'prompts');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'prompts');
  } else {
    return path.join(home, '.config', 'Code', 'User', 'prompts');
  }
}

// The harness repo must never be "repaired" into carrying its own generated
// advisory files. Identify it by repo identity, not by comparing the caller's
// __dirname: when harness runs from an npx/global install against its own
// source checkout, the installed path and the workspace path differ and a
// path-based guard silently fails open (issue #40).
const HARNESS_PACKAGE_NAME = 'harness-everything';

function isHarnessRepo(workspaceRoot) {
  try {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.name === HARNESS_PACKAGE_NAME;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getWorkspaceRoot,
  getStateHome,
  getWorkspaceKey,
  getWorkspaceStateDir,
  getUserPromptsDir,
  isHarnessRepo,
  HARNESS_PACKAGE_NAME,
};

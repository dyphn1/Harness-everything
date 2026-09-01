const fs = require('fs');
const path = require('path');
const os = require('os');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
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

module.exports = { getWorkspaceRoot, getUserPromptsDir, isHarnessRepo, HARNESS_PACKAGE_NAME };

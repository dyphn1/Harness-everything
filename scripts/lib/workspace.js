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

module.exports = { getWorkspaceRoot, getUserPromptsDir };

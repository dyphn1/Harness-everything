const path = require('path');
const fs = require('fs');

// Cursor's own skills location (.cursor/skills/) is unchanged - it already
// has an established home. Only bookkeeping that never had a home (runtime
// state, install manifest) converges into .cursor/harness-everything/.
module.exports = {
  name: 'cursor',
  label: 'Cursor',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.cursor', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(workspaceRoot, '.cursor', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.cursor/harness-everything/'];
    if (fs.existsSync(path.join(workspaceRoot, '.cursor', 'skills'))) {
      patterns.push('.cursor/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.cursor/harness-everything/') {
      return trimmedLine === '.cursor/' ||
             trimmedLine === '.cursor' ||
             trimmedLine === '.cursor/harness-everything' ||
             trimmedLine === '.cursor/harness-everything/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return fs.existsSync(path.join(userHome, '.cursorrules'));
    }
    return fs.existsSync(path.join(workspaceRoot, '.cursorrules'));
  }
};

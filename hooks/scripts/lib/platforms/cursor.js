const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'cursor',
  label: 'Cursor',
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.cursor', 'harness-state');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.cursor/harness-state/'];
    if (fs.existsSync(path.join(workspaceRoot, '.cursor', 'skills'))) {
      patterns.push('.cursor/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.cursor/harness-state/') {
      return trimmedLine === '.cursor/' || 
             trimmedLine === '.cursor' || 
             trimmedLine === '.cursor/harness-state' ||
             trimmedLine === '.cursor/harness-state/';
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

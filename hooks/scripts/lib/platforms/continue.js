const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'continue',
  label: 'Continue.dev',
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.continue', 'harness-state');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.continue/harness-state/'];
    if (fs.existsSync(path.join(workspaceRoot, '.continue', 'skills'))) {
      patterns.push('.continue/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.continue/harness-state/') {
      return trimmedLine === '.continue/' || 
             trimmedLine === '.continue' || 
             trimmedLine === '.continue/harness-state' ||
             trimmedLine === '.continue/harness-state/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return fs.existsSync(path.join(userHome, '.continue', 'rules', 'harness.md'));
    }
    return fs.existsSync(path.join(workspaceRoot, '.continue', 'rules', 'harness.md'));
  }
};

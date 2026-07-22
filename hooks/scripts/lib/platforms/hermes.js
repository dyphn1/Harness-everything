const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'hermes',
  label: 'Hermes Agent',
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.hermes', 'harness-state');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = [];
    if (fs.existsSync(path.join(workspaceRoot, '.hermes', 'harness-state'))) {
      patterns.push('.hermes/harness-state/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.hermes/harness-state/') {
      return trimmedLine === '.hermes/' || 
             trimmedLine === '.hermes' || 
             trimmedLine === '.hermes/harness-state' ||
             trimmedLine === '.hermes/harness-state/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return false;
    }
    return fs.existsSync(path.join(workspaceRoot, '.hermes.md'));
  }
};

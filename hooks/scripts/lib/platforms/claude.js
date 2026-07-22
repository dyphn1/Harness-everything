const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'claude',
  label: 'Claude Code',
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.claude', 'harness-state');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.claude/harness-state/'];
    // If Claude is being used, we also have .harness/ for local skills
    if (fs.existsSync(path.join(workspaceRoot, '.harness'))) {
      patterns.push('.harness/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    // Custom ignore matching logic for Claude platform
    if (pattern === '.claude/harness-state/') {
      return trimmedLine === '.claude/' || 
             trimmedLine === '.claude' || 
             trimmedLine === '.claude/harness-state' ||
             trimmedLine === '.claude/harness-state/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return fs.existsSync(path.join(userHome, '.claude', 'settings.json'));
    }
    return fs.existsSync(path.join(workspaceRoot, '.claude', 'settings.json'));
  }
};

const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'copilot',
  label: 'GitHub Copilot',
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.github', 'harness-state');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.github/harness-state/'];
    if (fs.existsSync(path.join(workspaceRoot, '.github', 'skills'))) {
      patterns.push('.github/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.github/harness-state/') {
      return trimmedLine === '.github/' || 
             trimmedLine === '.github' || 
             trimmedLine === '.github/harness-state' ||
             trimmedLine === '.github/harness-state/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return false; // Handled via global userPromptsDir check
    }
    return fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md'));
  }
};

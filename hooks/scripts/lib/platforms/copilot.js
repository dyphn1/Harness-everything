const path = require('path');
const fs = require('fs');

// Copilot's own skills location (.github/skills/) is unchanged - it already
// has an established home. Only bookkeeping that never had a home (runtime
// state, install manifest) converges into .github/harness-everything/.
module.exports = {
  name: 'copilot',
  label: 'GitHub Copilot',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.github', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(workspaceRoot, '.github', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.github/harness-everything/'];
    if (fs.existsSync(path.join(workspaceRoot, '.github', 'skills'))) {
      patterns.push('.github/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.github/harness-everything/') {
      return trimmedLine === '.github/' ||
             trimmedLine === '.github' ||
             trimmedLine === '.github/harness-everything' ||
             trimmedLine === '.github/harness-everything/';
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

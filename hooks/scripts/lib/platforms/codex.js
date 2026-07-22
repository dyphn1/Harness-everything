const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'codex',
  label: 'Codex / Gemini',
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.agents', 'harness-state');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.agents/harness-state/'];
    if (fs.existsSync(path.join(workspaceRoot, '.agents', 'skills'))) {
      patterns.push('.agents/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.agents/harness-state/') {
      return trimmedLine === '.agents/' || 
             trimmedLine === '.agents' || 
             trimmedLine === '.agents/harness-state' ||
             trimmedLine === '.agents/harness-state/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return false;
    }
    return fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
  }
};

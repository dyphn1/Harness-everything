const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'worktrees',
  label: 'Git Worktrees',
  getIgnorePatterns(workspaceRoot) {
    const patterns = [];
    if (fs.existsSync(path.join(workspaceRoot, '.worktrees'))) {
      patterns.push('.worktrees/');
    }
    if (fs.existsSync(path.join(workspaceRoot, 'worktrees'))) {
      patterns.push('worktrees/');
    }
    return patterns;
  },
  isInstalled() {
    return false; // Not a standalone platform hook/settings installer
  }
};

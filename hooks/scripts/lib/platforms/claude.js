const path = require('path');
const fs = require('fs');

// Claude Code has no native project-skill directory this package can piggy
// back on, so everything Harness adds locally - runtime state AND the
// installed skill copies - lives under one self-contained subfolder of the
// platform's own directory: .claude/harness-everything/. That keeps it out
// of a self-invented top-level folder (the old .harness/) while still being
// exclusively ours - nothing else creates a directory literally named
// "harness-everything" inside .claude/, so it's trivial to add/remove
// without touching anything else Claude Code or the user put in .claude/.
module.exports = {
  name: 'claude',
  label: 'Claude Code',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.claude', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    return ['.claude/harness-everything/'];
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.claude/harness-everything/') {
      return trimmedLine === '.claude/' ||
             trimmedLine === '.claude' ||
             trimmedLine === '.claude/harness-everything' ||
             trimmedLine === '.claude/harness-everything/';
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

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
  },
  getSkillsTarget({ workspaceRoot, userHome, isGlobal, manifest }) {
    if (isGlobal) {
      const globalAgentsDir = path.join(userHome, '.agents');
      return {
        path: path.join(globalAgentsDir, 'skills'),
        label: '~/.agents/skills/',
        manifestPath: manifest.getManifestPath(globalAgentsDir),
      };
    } else {
      const cursorDir = path.join(workspaceRoot, '.cursor');
      return {
        path: path.join(cursorDir, 'skills'),
        label: '.cursor/skills/',
        manifestPath: manifest.getManifestPath(cursorDir),
      };
    }
  },
  install({ isGlobal, targetWorkspaceRoot, userHome, advisory }) {
    const targetFile = isGlobal ? path.join(userHome, '.cursorrules') : path.join(targetWorkspaceRoot, '.cursorrules');
    advisory.injectAdvisoryText(targetFile, '# Cursor Project Rules', isGlobal ? '~/.cursorrules' : '.cursorrules');
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome }) {
    const advisory = require('../../../../scripts/lib/advisory-text');
    if (removeLocal) {
      advisory.removeAdvisoryText(path.join(workspaceRoot, '.cursorrules'));
    }
    if (removeGlobal) {
      advisory.removeAdvisoryText(path.join(userHome, '.cursorrules'));
    }
  }
};

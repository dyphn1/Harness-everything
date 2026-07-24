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
  },
  getSkillsTarget({ workspaceRoot, userHome, isGlobal, manifest }) {
    if (isGlobal) {
      const globalAgentsDir = path.join(userHome, '.agents');
      return {
        path: path.join(globalAgentsDir, 'skills'),
        label: '~/.agents/skills/',
        manifestPath: manifest.getManifestPath(globalAgentsDir),
      };
    }
    return null;
  },
  install({ isGlobal, targetWorkspaceRoot, advisory }) {
    if (!isGlobal) {
      const targetFile = path.join(targetWorkspaceRoot, '.hermes.md');
      advisory.injectAdvisoryText(targetFile, '# .hermes.md', '.hermes.md');
    } else {
      console.log(`  ℹ️  Hermes Agent has no documented global instructions file (it reads .hermes.md from the current project directory only) - skipping global install for --hermes.`);
    }
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome }) {
    const advisory = require('../../../../scripts/lib/advisory-text');
    if (removeLocal) {
      advisory.removeAdvisoryText(path.join(workspaceRoot, '.hermes.md'));
    }
  }
};

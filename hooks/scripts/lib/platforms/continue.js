const path = require('path');
const fs = require('fs');

// Continue's own skills location (.continue/skills/) is unchanged - it
// already has an established home. Only bookkeeping that never had a home
// (runtime state, install manifest) converges into .continue/harness-everything/.
module.exports = {
  name: 'continue',
  label: 'Continue.dev',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.continue', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(workspaceRoot, '.continue', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.continue/harness-everything/'];
    const skillsDir = path.join(workspaceRoot, '.continue', 'skills');
    if (fs.existsSync(skillsDir)) {
      try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              const content = fs.readFileSync(skillMdPath, 'utf8');
              const authorLine = content.split('\n').find(line => line.trim().startsWith('author:'));
              if (authorLine && (authorLine.includes('Miya Daniel'))) {
                patterns.push(`.continue/skills/${entry.name}/`);
              }
            }
          }
        }
      } catch (e) {
        // Fallback or ignore to prevent breaking execution
      }
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (trimmedLine === '.continue/' || trimmedLine === '.continue') {
      return true;
    }
    if (pattern === '.continue/harness-everything/') {
      return trimmedLine === '.continue/harness-everything' ||
             trimmedLine === '.continue/harness-everything/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return fs.existsSync(path.join(userHome, '.continue', 'rules', 'harness.md'));
    }
    return fs.existsSync(path.join(workspaceRoot, '.continue', 'rules', 'harness.md'));
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
      const continueDir = path.join(workspaceRoot, '.continue');
      return {
        path: path.join(continueDir, 'skills'),
        label: '.continue/skills/',
        manifestPath: manifest.getManifestPath(continueDir),
      };
    }
  },
  install({ isGlobal, targetWorkspaceRoot, userHome, advisory, workspaceRoot }) {
    const targetFile = isGlobal ? path.join(userHome, '.continue', 'rules', 'harness.md') : path.join(targetWorkspaceRoot, '.continue', 'rules', 'harness.md');
    advisory.installContinueRule(targetFile, isGlobal ? '~/.continue/rules/harness.md' : '.continue/rules/harness.md');
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome, cleanEmptyDirs }) {
    const advisory = require('../../../../scripts/lib/advisory-text');
    if (removeLocal) {
      advisory.removeContinueRule(path.join(workspaceRoot, '.continue', 'rules', 'harness.md'));
      cleanEmptyDirs(path.join(workspaceRoot, '.continue', 'rules'), [workspaceRoot, userHome]);
    }
    if (removeGlobal) {
      advisory.removeContinueRule(path.join(userHome, '.continue', 'rules', 'harness.md'));
      cleanEmptyDirs(path.join(userHome, '.continue', 'rules'), [userHome]);
    }
  }
};

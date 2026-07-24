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
      const githubDir = path.join(workspaceRoot, '.github');
      return {
        path: path.join(githubDir, 'skills'),
        label: '.github/skills/',
        manifestPath: manifest.getManifestPath(githubDir),
      };
    }
  },
  install({ isGlobal, targetWorkspaceRoot, getUserPromptsDir, advisory }) {
    if (!isGlobal) {
      const targetFile = path.join(targetWorkspaceRoot, '.github', 'copilot-instructions.md');
      advisory.injectAdvisoryText(targetFile, '# Copilot Instructions', '.github/copilot-instructions.md');
    } else {
      try {
        const promptsDir = getUserPromptsDir();
        if (!fs.existsSync(promptsDir)) {
          fs.mkdirSync(promptsDir, { recursive: true });
        }
        const vscodeInstFile = path.join(promptsDir, 'harness.instructions.md');
        fs.writeFileSync(vscodeInstFile, advisory.buildCopilotGlobalContent(), 'utf8');
        console.log(`  ✅ Installed global Copilot instructions to VS Code: ${vscodeInstFile}`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to write VS Code user prompts folder: ${err.message}`);
      }
    }
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome, getUserPromptsDir, cleanEmptyDirs }) {
    const advisory = require('../../../../scripts/lib/advisory-text');
    if (removeLocal) {
      advisory.removeAdvisoryText(path.join(workspaceRoot, '.github', 'copilot-instructions.md'));
    }
    if (removeGlobal) {
      const promptsDir = getUserPromptsDir();
      const vscodeInstFile = path.join(promptsDir, 'harness.instructions.md');
      if (fs.existsSync(vscodeInstFile)) {
        fs.unlinkSync(vscodeInstFile);
        console.log(`  ✅ Removed global Copilot instructions: ${vscodeInstFile}`);
      }
      cleanEmptyDirs(promptsDir, [userHome]);
    }
  }
};

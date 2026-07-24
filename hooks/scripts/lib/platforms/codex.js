const path = require('path');
const fs = require('fs');

// Codex CLI's real project-scoped home is `.codex/` (it reads `.codex/skills/`
// for project skills and `.codex/config.toml` for CLI/sandbox config, walking
// up to the `.git` root exactly like AGENTS.md - see
// https://developers.openai.com/codex/config-advanced and
// https://www.agensi.io/learn/codex-cli-agents-md-complete-guide). Skills
// stay at that native `.codex/skills/` location; only bookkeeping that never
// had a home (runtime state, install manifest) converges into
// `.codex/harness-everything/`.
module.exports = {
  name: 'codex',
  label: 'Codex / Gemini',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.codex', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(workspaceRoot, '.codex', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.codex/harness-everything/'];
    if (fs.existsSync(path.join(workspaceRoot, '.codex', 'skills'))) {
      patterns.push('.codex/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.codex/harness-everything/') {
      return trimmedLine === '.codex/' ||
             trimmedLine === '.codex' ||
             trimmedLine === '.codex/harness-everything' ||
             trimmedLine === '.codex/harness-everything/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return false;
    }
    return fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
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
      const codexDir = path.join(workspaceRoot, '.codex');
      return {
        path: path.join(codexDir, 'skills'),
        label: '.codex/skills/',
        manifestPath: manifest.getManifestPath(codexDir),
      };
    }
  },
  install({ isGlobal, targetWorkspaceRoot, getUserPromptsDir, advisory }) {
    if (!isGlobal) {
      const targetFile = path.join(targetWorkspaceRoot, 'AGENTS.md');
      advisory.injectAdvisoryText(targetFile, '# AGENTS.md', 'AGENTS.md');
    } else {
      try {
        const promptsDir = getUserPromptsDir();
        if (!fs.existsSync(promptsDir)) {
          fs.mkdirSync(promptsDir, { recursive: true });
        }
        const vscodeAgentFile = path.join(promptsDir, 'harness.agent.md');
        fs.writeFileSync(vscodeAgentFile, advisory.buildCodexGlobalContent(), 'utf8');
        console.log(`  ✅ Installed global Codex agent to VS Code: ${vscodeAgentFile}`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to write VS Code user prompts folder: ${err.message}`);
      }
    }
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome, getUserPromptsDir, cleanEmptyDirs }) {
    const advisory = require('../../../../scripts/lib/advisory-text');
    if (removeLocal) {
      advisory.removeAdvisoryText(path.join(workspaceRoot, 'AGENTS.md'));
    }
    if (removeGlobal) {
      const promptsDir = getUserPromptsDir();
      const vscodeAgentFile = path.join(promptsDir, 'harness.agent.md');
      if (fs.existsSync(vscodeAgentFile)) {
        fs.unlinkSync(vscodeAgentFile);
        console.log(`  ✅ Removed global Codex agent: ${vscodeAgentFile}`);
      }
      cleanEmptyDirs(promptsDir, [userHome]);
    }
  }
};

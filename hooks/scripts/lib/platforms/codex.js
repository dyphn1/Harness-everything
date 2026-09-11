const path = require('path');
const fs = require('fs');

// Codex discovers project Agent Skills from repo-scoped `.agents/skills/`
// (walking from cwd toward the repository root). Keep project skills at that
// native shared location so every installer mode, including `--copy`, remains
// discoverable. Codex-specific runtime/install bookkeeping still lives under
// `.codex/harness-everything/`.
module.exports = {
  name: 'codex',
  label: 'Codex',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.codex', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(workspaceRoot, '.agents', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.codex/harness-everything/'];
    const skillsDir = path.join(workspaceRoot, '.agents', 'skills');
    if (fs.existsSync(skillsDir)) {
      try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              const content = fs.readFileSync(skillMdPath, 'utf8');
              const authorLine = content.split('\n').find(line => line.trim().startsWith('author:'));
              if (authorLine && authorLine.includes('Miya Daniel')) {
                patterns.push(`.agents/skills/${entry.name}/`);
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
    if (trimmedLine === '.codex/' || trimmedLine === '.codex') {
      return pattern === '.codex/harness-everything/';
    }
    if (trimmedLine === '.agents/' || trimmedLine === '.agents') {
      return pattern.startsWith('.agents/skills/');
    }
    if (pattern === '.codex/harness-everything/') {
      return trimmedLine === '.codex/harness-everything' ||
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
        path: path.join(workspaceRoot, '.agents', 'skills'),
        label: '.agents/skills/',
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
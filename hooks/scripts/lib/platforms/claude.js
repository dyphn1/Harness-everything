const path = require('path');
const fs = require('fs');

// Removes legacy static-skill subfolders left behind by the pre-0.2.2 bug
// that installed skills to .claude/harness-everything/skills/ instead of the
// native .claude/skills/, WITHOUT touching skills/generated/ - self-evolve
// stores the user's own dynamically-generated skills there (see
// skill-creator/SKILL.md §4), and a blind recursive rmSync on the whole
// skills/ folder would silently delete that accumulated learning.
function cleanupLegacySkillsDir(oldSkillsDir) {
  if (!fs.existsSync(oldSkillsDir)) return;
  try {
    const entries = fs.readdirSync(oldSkillsDir, { withFileTypes: true });
    let removedAny = false;
    for (const entry of entries) {
      if (entry.name === 'generated') continue;
      fs.rmSync(path.join(oldSkillsDir, entry.name), { recursive: true, force: true });
      removedAny = true;
    }
    if (fs.readdirSync(oldSkillsDir).length === 0) {
      fs.rmdirSync(oldSkillsDir);
    }
    if (removedAny) {
      console.log(`  🧹 Cleaned up legacy incorrect local skills folder at: .claude/harness-everything/skills/ (preserved skills/generated/ - self-evolve's own dynamic skills)`);
    }
  } catch (e) {
    console.warn(`  ⚠️ Failed to clean up legacy skills folder: ${e.message}`);
  }
}

// Claude Code has native project-skill directory: .claude/skills/.
// Runtime state converges into .claude/harness-everything/.
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
    return path.join(workspaceRoot, '.claude', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.claude/harness-everything/'];
    const skillsDir = path.join(workspaceRoot, '.claude', 'skills');
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
                patterns.push(`.claude/skills/${entry.name}/`);
              }
            }
          }
        }
      } catch (e) {
        // Fallback or ignore to prevent breaking execution
      }
    }
    const agentsDir = path.join(workspaceRoot, '.claude', 'agents');
    if (fs.existsSync(agentsDir)) {
      try {
        for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
          if (!entry.isFile() || !/^fable-(?:orchestrator|verifier|worker-haiku|worker-sonnet)\.md$/i.test(entry.name)) continue;
          const content = fs.readFileSync(path.join(agentsDir, entry.name), 'utf8');
          if (/^name:\s*fable-/mi.test(content)) patterns.push(`.claude/agents/${entry.name}`);
        }
      } catch (e) {
        // Fallback or ignore to prevent breaking installation.
      }
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (trimmedLine === '.claude/' || trimmedLine === '.claude') {
      return true;
    }
    if (pattern === '.claude/harness-everything/') {
      return trimmedLine === '.claude/harness-everything' ||
             trimmedLine === '.claude/harness-everything/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return fs.existsSync(path.join(userHome, '.claude', 'settings.json'));
    }
    return fs.existsSync(path.join(workspaceRoot, '.claude', 'settings.json'));
  },
  getSkillsTarget({ workspaceRoot, userHome, isGlobal, manifest }) {
    if (isGlobal) {
      const claudeDir = path.join(userHome, '.claude');
      return {
        path: path.join(claudeDir, 'skills'),
        label: '~/.claude/skills/',
        manifestPath: manifest.getManifestPath(claudeDir)
      };
    } else {
      const claudeDir = path.join(workspaceRoot, '.claude');
      return {
        path: path.join(claudeDir, 'skills'),
        label: '.claude/skills/',
        manifestPath: manifest.getManifestPath(claudeDir)
      };
    }
  },
  getAgentsTarget({ workspaceRoot, userHome, isGlobal, manifest }) {
    const claudeDir = isGlobal ? path.join(userHome, '.claude') : path.join(workspaceRoot, '.claude');
    return {
      path: path.join(claudeDir, 'agents'),
      label: isGlobal ? '~/.claude/agents/' : '.claude/agents/',
      manifestPath: manifest.getManifestPath(claudeDir)
    };
  },
  install({ isGlobal, targetWorkspaceRoot, harnessSourceDir, packageVersion, getUserPromptsDir, advisory, claudeHooks, manifest }) {
    const userHome = require('os').homedir();
    const claudeDir = isGlobal ? path.join(userHome, '.claude') : path.join(targetWorkspaceRoot, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
      console.log(`  Created ${isGlobal ? '~/.claude' : '.claude'} directory`);
    }
    const claudeSettingsFile = path.join(claudeDir, 'settings.json');
    let claudeConfig = {};
    if (fs.existsSync(claudeSettingsFile)) {
      try {
        claudeConfig = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
      } catch (e) {
        console.warn(`  ⚠️ Existing ${isGlobal ? '~' : ''}/.claude/settings.json is malformed, creating fresh one.`);
      }
    }

    const sourceHooksFile = path.join(harnessSourceDir, 'hooks', 'hooks.json');
    if (fs.existsSync(sourceHooksFile)) {
      const sourceHooksObj = JSON.parse(fs.readFileSync(sourceHooksFile, 'utf8'));
      const resolvedHooks = {};
      for (const [hookType, hookList] of Object.entries(sourceHooksObj.hooks || {})) {
        resolvedHooks[hookType] = hookList.map(hookItem => {
          const cloned = JSON.parse(JSON.stringify(hookItem));
          if (cloned.hooks) {
            cloned.hooks = cloned.hooks.map(h => {
              if (h.type === 'command' && h.command) {
                h.command = h.command.replace(/^node\s+"?([^"\s]+)"?/, (m, scriptPath) => {
                  const abs = path.isAbsolute(scriptPath) ? scriptPath : path.join(harnessSourceDir, scriptPath);
                  return `node "${abs}"`;
                });
              }
              return h;
            });
          }
          cloned.harness = { package: manifest.PACKAGE_NAME, version: packageVersion, author: manifest.HARNESS_AUTHOR };
          return cloned;
        });
      }
      claudeHooks.mergeHarnessHooks(claudeConfig, resolvedHooks);
    }

    fs.writeFileSync(claudeSettingsFile, JSON.stringify(claudeConfig, null, 2), 'utf8');
    console.log(`  ✅ Configured Claude Code hooks safely in ${isGlobal ? '~' : ''}/.claude/settings.json`);

    // DOWNWARD COMPATIBLE CLEANUP: Remove old wrong skill folder .claude/harness-everything/skills if it exists
    cleanupLegacySkillsDir(path.join(claudeDir, 'harness-everything', 'skills'));
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome, getUserPromptsDir, advisory, claudeHooks, manifest, cleanEmptyDirs }) {
    if (removeLocal) {
      const localSettingsFile = path.join(workspaceRoot, '.claude', 'settings.json');
      claudeHooks.removeHarnessHooks(localSettingsFile);
      
      // Clear old wrong skill folder .claude/harness-everything/skills if any remain
      cleanupLegacySkillsDir(path.join(workspaceRoot, '.claude', 'harness-everything', 'skills'));
    }
    if (removeGlobal) {
      const globalSettingsFile = path.join(userHome, '.claude', 'settings.json');
      claudeHooks.removeHarnessHooks(globalSettingsFile);
      const globalClaudeDir = path.join(userHome, '.claude');
      cleanEmptyDirs(globalClaudeDir, [userHome]);
    }
  }
};

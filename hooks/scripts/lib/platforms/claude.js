const path = require('path');
const fs = require('fs');

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
    if (fs.existsSync(path.join(workspaceRoot, '.claude', 'skills'))) {
      patterns.push('.claude/skills/');
    }
    return patterns;
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
    const oldSkillsDir = path.join(claudeDir, 'harness-everything', 'skills');
    if (fs.existsSync(oldSkillsDir)) {
      try {
        fs.rmSync(oldSkillsDir, { recursive: true, force: true });
        console.log(`  🧹 Cleaned up legacy incorrect local skills folder at: .claude/harness-everything/skills/`);
      } catch (e) {
        console.warn(`  ⚠️ Failed to remove legacy skills folder: ${e.message}`);
      }
    }
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome, getUserPromptsDir, advisory, claudeHooks, manifest, cleanEmptyDirs }) {
    if (removeLocal) {
      const localSettingsFile = path.join(workspaceRoot, '.claude', 'settings.json');
      claudeHooks.removeHarnessHooks(localSettingsFile);
      
      // Clear old wrong skill folder .claude/harness-everything/skills if any remain
      const oldSkillsDir = path.join(workspaceRoot, '.claude', 'harness-everything', 'skills');
      if (fs.existsSync(oldSkillsDir)) {
        fs.rmSync(oldSkillsDir, { recursive: true, force: true });
        console.log(`  🧹 Cleaned up legacy incorrect local skills folder at: .claude/harness-everything/skills/`);
      }
    }
    if (removeGlobal) {
      const globalSettingsFile = path.join(userHome, '.claude', 'settings.json');
      claudeHooks.removeHarnessHooks(globalSettingsFile);
      const globalClaudeDir = path.join(userHome, '.claude');
      cleanEmptyDirs(globalClaudeDir, [userHome]);
    }
  }
};

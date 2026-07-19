#!/usr/bin/env node
/**
 * Lightweight, non-intrusive installer for Harness OS.
 * Detects the local project layout (Claude Code, Cursor, etc.)
 * and merges the Harness hook definitions safely without destroying user configs.
 */

const fs = require('fs');
const path = require('path');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const workspaceRoot = getWorkspaceRoot();
const harnessSourceDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log("          Harness OS - Local Installer           ");
console.log("=================================================");
console.log(`Workspace root detected: ${workspaceRoot}`);

try {
  // 1. Create .harness directory structure
  const dotHarnessDir = path.join(workspaceRoot, '.harness');
  if (!fs.existsSync(dotHarnessDir)) {
    fs.mkdirSync(dotHarnessDir, { recursive: true });
    console.log("  Created .harness directory");
  }

  // 2. Load Harness source hooks definition
  const sourceHooksFile = path.join(harnessSourceDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(sourceHooksFile)) {
    throw new Error(`Harness source hooks definition not found at: ${sourceHooksFile}`);
  }
  
  const sourceHooksObj = JSON.parse(fs.readFileSync(sourceHooksFile, 'utf8'));

  // 3. Resolve target file paths and update hooks with absolute script paths (so they work from anywhere)
  const resolvedHooks = {};
  for (const [hookType, hookList] of Object.entries(sourceHooksObj.hooks || {})) {
    resolvedHooks[hookType] = hookList.map(hookItem => {
      const cloned = JSON.parse(JSON.stringify(hookItem));
      if (cloned.hooks) {
        cloned.hooks = cloned.hooks.map(h => {
          if (h.type === 'command' && h.command) {
            // Rewrite the relative paths of scripts to the current absolute installation location of harness-skills
            h.command = h.command.replace(/node\s+d:\/GitHub\/harness-skills\//g, `node "${harnessSourceDir}/"`);
            h.command = h.command.replace(/node\s+path\/to\/harness-skills\//g, `node "${harnessSourceDir}/"`);
          }
          return h;
        });
      }
      return cloned;
    });
  }

  // 4. Merge into .claude.json or settings.json (for Claude Code target)
  const claudeSettingsFile = path.join(workspaceRoot, '.claude.json');
  let claudeConfig = {};
  if (fs.existsSync(claudeSettingsFile)) {
    try {
      claudeConfig = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
    } catch (e) {
      console.warn("  ⚠️ Existing .claude.json is malformed, creating fresh one.");
    }
  }

  // Safely merge hooks
  claudeConfig.hooks = claudeConfig.hooks || {};
  for (const [hookType, hookList] of Object.entries(resolvedHooks)) {
    const existingList = claudeConfig.hooks[hookType] || [];
    // Prevent duplicate entries by checking hook ID
    const mergedList = [...existingList];
    hookList.forEach(newHook => {
      const existsIdx = mergedList.findIndex(h => h.id === newHook.id);
      if (existsIdx !== -1) {
        // Upgrade/Overwrite existing harness hook
        mergedList[existsIdx] = newHook;
      } else {
        // Add new hook
        mergedList.push(newHook);
      }
    });
    claudeConfig.hooks[hookType] = mergedList;
  }

  // Write merged config back to workspace
  fs.writeFileSync(claudeSettingsFile, JSON.stringify(claudeConfig, null, 2), 'utf8');
  console.log("  ✅ Configured Claude Code hooks safely in .claude.json");

  // 5. Cursor support (.cursorrules)
  const cursorRulesFile = path.join(workspaceRoot, '.cursorrules');
  const cursorInstructions = `\n# Harness OS Instructions\n- Proactively obey the cognitive loop: Discover > Think > Try > Summarize > Record\n- If consecutive errors happen, STOP and check the state persisted under .harness/handoff-state.json\n`;
  
  if (fs.existsSync(cursorRulesFile)) {
    let content = fs.readFileSync(cursorRulesFile, 'utf8');
    if (!content.includes("Harness OS")) {
      fs.appendFileSync(cursorRulesFile, cursorInstructions, 'utf8');
      console.log("  ✅ Augmented existing .cursorrules with Harness guidelines");
    }
  } else {
    fs.writeFileSync(cursorRulesFile, `# Cursor Project Rules\n${cursorInstructions}`, 'utf8');
    console.log("  ✅ Created new .cursorrules with Harness guidelines");
  }

  console.log("\n🎉 INSTALL SUCCESS! Harness OS is now protecting this project.");
  console.log("Try your first AI interaction! The bootstrapped OS will auto-route your tier.");
  console.log("=================================================");

} catch (err) {
  console.error(`\n❌ Install failed: ${err.message}`);
  process.exit(1);
}

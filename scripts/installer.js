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

  // 4. Merge into .claude/settings.json (project-level hooks location for Claude Code)
  const claudeDir = path.join(workspaceRoot, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    console.log("  Created .claude directory");
  }
  const claudeSettingsFile = path.join(claudeDir, 'settings.json');
  let claudeConfig = {};
  if (fs.existsSync(claudeSettingsFile)) {
    try {
      claudeConfig = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
    } catch (e) {
      console.warn("  ⚠️ Existing .claude/settings.json is malformed, creating fresh one.");
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
  console.log("  ✅ Configured Claude Code hooks safely in .claude/settings.json");

  // 5. Prompt-injection-only platforms (Cursor, Copilot, Codex)
  //
  // These platforms have no hook/exit-code execution mechanism - there is no
  // way to actually run rule-of-3.js, boundary-guard.js, etc, or to block a
  // tool call the way Claude Code's PreToolUse exit(2) does. What follows is
  // advisory text only: strong defaults the model is asked to follow, with
  // no mechanical enforcement behind them. Do not oversell this as a
  // "circuit breaker" - by the README's own Prompt vs Skill vs Harness
  // comparison, this tier has the same protection level as Prompt-Only.
  const MARKER = "Harness OS Guidance (Advisory)";
  const advisoryInstructions = [
    `\n# ${MARKER}`,
    `This file is advisory only - this platform has no hook/execution mechanism to`,
    `enforce it mechanically (unlike Claude Code's hook-based circuit breaker). Treat`,
    `these as strong defaults, not guarantees.`,
    ``,
    `- Discover the environment (OS, shell, package manager) before running commands - don't assume.`,
    `- Triage tasks: trivial fixes need no plan; standard features need tests; large refactors need`,
    `  an explicit plan reviewed with the human before implementation.`,
    `- If the same error repeats 3 times in a row, STOP retrying. Explain what's failing and ask the`,
    `  human for direction instead of continuing to guess.`,
    `- Prefer editing over rewriting; commit logically complete chunks rather than one giant diff.`,
    ``
  ].join('\n');

  function injectAdvisoryText(targetFile, header, label) {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(targetFile)) {
      const content = fs.readFileSync(targetFile, 'utf8');
      if (!content.includes(MARKER)) {
        fs.appendFileSync(targetFile, advisoryInstructions, 'utf8');
        console.log(`  ✅ Augmented existing ${label} with Harness guidance (advisory-only)`);
      }
    } else {
      fs.writeFileSync(targetFile, `${header}\n${advisoryInstructions}`, 'utf8');
      console.log(`  ✅ Created ${label} with Harness guidance (advisory-only)`);
    }
  }

  // Cursor
  injectAdvisoryText(path.join(workspaceRoot, '.cursorrules'), '# Cursor Project Rules', '.cursorrules');
  // Copilot Chat
  injectAdvisoryText(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), '# Copilot Instructions', '.github/copilot-instructions.md');
  // Codex - the real custom-instructions mechanism is AGENTS.md, not .codex/config.toml
  // (config.toml controls CLI/sandbox behavior, not prompt content).
  injectAdvisoryText(path.join(workspaceRoot, 'AGENTS.md'), '# AGENTS.md', 'AGENTS.md');

  console.log("\n🎉 INSTALL SUCCESS! Harness OS is now protecting this project.");
  console.log("Try your first AI interaction! The bootstrapped OS will auto-route your tier.");
  console.log("=================================================");

} catch (err) {
  console.error(`\n❌ Install failed: ${err.message}`);
  process.exit(1);
}

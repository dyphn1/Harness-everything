#!/usr/bin/env node
/**
 * Lightweight, non-intrusive installer for Harness OS.
 * Detects the local project layout (Claude Code, Cursor, etc.)
 * and merges the Harness hook definitions safely without destroying user configs.
 *
 * Placement rule: a platform's own native file/folder (`.claude/settings.json`,
 * `.cursorrules`, `.cursor/skills/`, etc.) is never moved - it lives exactly
 * where that platform expects it. Anything Harness itself needs that has no
 * native home (install manifest, runtime hook state, and - only for Claude,
 * which has no native project-skill directory - the installed skill copies)
 * converges into one exclusively-owned subfolder per platform:
 * `<platform-dir>/harness-everything/`. Nothing else ever creates a directory
 * literally named "harness-everything", so it can be added or removed as a
 * unit without touching anything else in that platform's directory.
 *
 * This file only orchestrates the install/uninstall flow (CLI parsing,
 * interactive prompts, sequencing). Each concern it delegates to lives in
 * scripts/lib/: skill discovery & manifest-tracked install/removal
 * (lib/skills.js, lib/manifest.js), Claude Code hook merge/removal
 * (lib/claude-hooks.js), advisory-file injection for hookless platforms
 * (lib/advisory-text.js), .gitignore/empty-dir housekeeping (lib/gitignore.js),
 * and the terminal picker widgets (lib/prompts.js).
 */

const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot, getUserPromptsDir } = require('./lib/workspace');
const { interactiveSelect, interactiveSingleSelect, askQuestion } = require('./lib/prompts');
const advisory = require('./lib/advisory-text');
const claudeHooks = require('./lib/claude-hooks');
const manifest = require('./lib/manifest');
const skills = require('./lib/skills');
const { ensureWorkspaceGitignorePatterns, cleanEmptyDirs } = require('./lib/gitignore');

const userHome = require('os').homedir();
const workspaceRoot = getWorkspaceRoot();
const harnessSourceDir = path.resolve(__dirname, '..');
const packageVersion = require(path.join(harnessSourceDir, 'package.json')).version;

let platformModules = [];
try {
  platformModules = require(path.join(__dirname, '../hooks/scripts/lib/platforms'));
} catch (e) {
  platformModules = []; // Best-effort - gitignore hints and state cleanup degrade gracefully without it.
}

async function main() {
  const args = process.argv;
  const command = args[2] || 'install'; // 'install', 'add', 'skills', etc.

  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  const hasClaudeFlag = args.includes('--claude');
  const hasCursorFlag = args.includes('--cursor');
  const hasCopilotFlag = args.includes('--copilot');
  const hasCodexFlag = args.includes('--codex');
  const hasContinueFlag = args.includes('--continue');
  const hasHermesFlag = args.includes('--hermes');
  const hasAllFlag = args.includes('--all');
  const hasGlobalFlag = args.includes('--global') || args.includes('-g');
  const hasYesFlag = args.includes('-y') || args.includes('--yes');
  const hasAnyPlatformFlag = hasClaudeFlag || hasCursorFlag || hasCopilotFlag || hasCodexFlag || hasContinueFlag || hasHermesFlag || hasAllFlag;
  const requestedSkills = ['add', 'skill', 'skills'].includes(command)
    ? args.slice(3).filter(arg => !arg.startsWith('-'))
    : [];

  const claudeExists = fs.existsSync(path.join(workspaceRoot, '.claude'));
  const cursorExists = fs.existsSync(path.join(workspaceRoot, '.cursorrules'));
  const copilotExists = fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md')) || fs.existsSync(path.join(workspaceRoot, '.github'));
  const codexExists = fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
  const continueExists = fs.existsSync(path.join(workspaceRoot, '.continue'));
  const hermesExists = fs.existsSync(path.join(workspaceRoot, '.hermes.md'));
  const detectedAny = claudeExists || cursorExists || copilotExists || codexExists || continueExists || hermesExists;

  if (command === 'uninstall') {
    await runUninstall({ hasYesFlag, args, isInteractive });
    return;
  }

  let targets = {
    claude: false,
    cursor: false,
    copilot: false,
    codex: false,
    continue: false,
    hermes: false
  };
  let chosenSkills = [];
  let isGlobal = hasGlobalFlag;

  const runInteractively = isInteractive && !hasYesFlag && !hasAnyPlatformFlag && (['install', 'add', 'skill', 'skills'].includes(command) && requestedSkills.length === 0);

  if (runInteractively) {
    console.log("=================================================");
    console.log(`          Harness OS - Interactive Setup         `);
    console.log("=================================================");

    // Step 1: Choose platforms
    console.log("\n[Step 1/3] Select target platforms to configure:");
    const platformItems = [
      { id: 'claude', name: `Claude Code (hook-enforced)  ${claudeExists ? '(Detected)' : ''}`, checked: claudeExists || !detectedAny },
      { id: 'cursor', name: `Cursor (.cursorrules)          ${cursorExists ? '(Detected)' : ''}`, checked: cursorExists },
      { id: 'copilot', name: `Copilot (.github/copilot-...)  ${copilotExists ? '(Detected)' : ''}`, checked: copilotExists },
      { id: 'codex', name: `Codex (AGENTS.md)              ${codexExists ? '(Detected)' : ''}`, checked: codexExists },
      { id: 'continue', name: `Continue.dev (.continue/rules) ${continueExists ? '(Detected)' : ''}`, checked: continueExists },
      { id: 'hermes', name: `Hermes Agent (.hermes.md)      ${hermesExists ? '(Detected)' : ''}`, checked: hermesExists }
    ];
    const selectedPlatforms = await interactiveSelect(platformItems);
    selectedPlatforms.forEach(p => {
      targets[p.id] = p.checked;
    });

    // Step 2: Choose skills
    const availableSkills = skills.getAvailableSkills(harnessSourceDir);
    console.log("\n[Step 2/3] Select skills to install:");
    const skillItems = availableSkills.map(s => {
      const info = skills.getSkillInfo(harnessSourceDir, s);
      // Pre-check essential skills
      const isEssential = ['tdd', 'git-commit', 'todo-driven-workflow', 'verification-loop'].includes(s);
      const isHarnessEverything = s === 'harness-everything';
      return {
        id: s,
        name: isHarnessEverything ? `${s} (Required)` : s,
        description: info ? info.description : '',
        checked: isEssential || isHarnessEverything
      };
    });
    const selectedSkills = await interactiveSelect(skillItems, 8);
    chosenSkills = selectedSkills.filter(s => s.checked).map(s => s.id);

    // Step 3: Choose global vs local location
    console.log("\n[Step 3/3] Select installation scope / location:");
    const locationItems = [
      { id: 'local', name: "Local Workspace (Install to current project directories)", checked: true },
      { id: 'global', name: "Global (~/.agents - applies across all projects)", checked: false }
    ];
    const chosenLocationId = await interactiveSingleSelect(locationItems);
    isGlobal = chosenLocationId === 'global';
  } else {
    // Non-interactive/bypass mode
    isGlobal = hasGlobalFlag;

    if (['add', 'skill', 'skills'].includes(command)) {
      if (requestedSkills.length > 0) {
        const availableSkills = skills.getAvailableSkills(harnessSourceDir);
        for (const skillName of requestedSkills) {
          if (availableSkills.includes(skillName)) {
            chosenSkills.push(skillName);
          } else {
            console.error(`⚠️ Skill "${skillName}" not found. Skipping.`);
          }
        }
      } else {
        chosenSkills = ['tdd', 'git-commit', 'todo-driven-workflow', 'verification-loop', 'zoom-out', 'install-cognitive-os'];
      }

      if (!isGlobal) {
        targets.claude = claudeExists;
        targets.cursor = cursorExists;
        targets.copilot = copilotExists;
        targets.codex = codexExists;
        targets.continue = continueExists;
        targets.hermes = hermesExists;
        if (!detectedAny) {
          targets.claude = true;
        }
      }
    } else {
      if (hasAnyPlatformFlag) {
        if (hasAllFlag) {
          targets.claude = true;
          targets.cursor = true;
          targets.copilot = true;
          targets.codex = true;
          targets.continue = true;
          targets.hermes = true;
        } else {
          targets.claude = hasClaudeFlag;
          targets.cursor = hasCursorFlag;
          targets.copilot = hasCopilotFlag;
          targets.codex = hasCodexFlag;
          targets.continue = hasContinueFlag;
          targets.hermes = hasHermesFlag;
        }
      } else {
        if (detectedAny) {
          targets.claude = claudeExists;
          targets.cursor = cursorExists;
          targets.copilot = copilotExists;
          targets.codex = codexExists;
          targets.continue = continueExists;
          targets.hermes = hermesExists;
        } else {
          targets.claude = true;
        }
      }
      chosenSkills = ['tdd', 'git-commit', 'todo-driven-workflow', 'verification-loop', 'zoom-out', 'install-cognitive-os'];
    }
  }

  // Ensure harness-everything is ALWAYS included in chosenSkills
  if (!chosenSkills.includes('harness-everything')) {
    chosenSkills.push('harness-everything');
  }

  // If no targets selected at all, exit
  if (!targets.claude && !targets.cursor && !targets.copilot && !targets.codex && !targets.continue && !targets.hermes && !isGlobal) {
    console.log("\n❌ No platforms selected. Exiting.");
    process.exit(0);
  }

  const targetWorkspaceRoot = isGlobal ? path.join(userHome, '.agents') : workspaceRoot;

  console.log("\n-------------------------------------------------");
  console.log(`Installing Harness OS to ${isGlobal ? 'Global Home' : 'Local Workspace'}`);
  console.log("-------------------------------------------------");

  for (const platform of platformModules) {
    if (targets[platform.name] && typeof platform.install === 'function') {
      platform.install({
        isGlobal,
        targetWorkspaceRoot,
        harnessSourceDir,
        packageVersion,
        getUserPromptsDir,
        advisory,
        claudeHooks,
        manifest,
        userHome,
        workspaceRoot
      });
    }
  }

  // Install chosen skills. Every platform's skills stay at that platform's
  // own native location (unchanged) EXCEPT Claude, which has its copy under
  // .claude/skills/. Each platform's manifest.json tracks its own.
  if (chosenSkills.length > 0) {
    const targetDirs = [];
    const addedPaths = new Set();
    for (const platform of platformModules) {
      // If it's a global install, gather all configured/selected platforms or defaults
      if (targets[platform.name] || (isGlobal && (targets.claude || targets.cursor || targets.copilot || targets.codex || targets.continue || targets.hermes))) {
        if (typeof platform.getSkillsTarget === 'function') {
          const tgt = platform.getSkillsTarget({ workspaceRoot, userHome, isGlobal, manifest });
          if (tgt && tgt.path && !addedPaths.has(tgt.path)) {
            targetDirs.push(tgt);
            addedPaths.add(tgt.path);
          }
        }
      }
    }

    console.log(`\nInstalling Harness skills:`);
    skills.installSkillsToTargets({ chosenSkills, targetDirs, harnessSourceDir, packageVersion });
  }

  if (!isGlobal) {
    const patternsToIgnore = [];
    for (const platform of platformModules) {
      if (targets[platform.name] && typeof platform.getIgnorePatterns === 'function') {
        for (const pattern of platform.getIgnorePatterns(workspaceRoot)) {
          if (!patternsToIgnore.includes(pattern)) {
            patternsToIgnore.push(pattern);
          }
        }
      }
    }
    if (patternsToIgnore.length === 0) {
      // Fallback if platform modules failed to load entirely.
      if (targets.claude) patternsToIgnore.push('.claude/harness-everything/');
      if (targets.cursor) patternsToIgnore.push('.cursor/harness-everything/', '.cursor/skills/');
      if (targets.copilot) patternsToIgnore.push('.github/harness-everything/', '.github/skills/');
      if (targets.codex) patternsToIgnore.push('.codex/harness-everything/', '.codex/skills/');
      if (targets.continue) patternsToIgnore.push('.continue/harness-everything/', '.continue/skills/');
    }

    ensureWorkspaceGitignorePatterns(workspaceRoot, patternsToIgnore);
  }

  console.log("\n🎉 INSTALL SUCCESS! Harness OS is now protecting this project.");
  console.log("Try your first AI interaction! The bootstrapped OS will auto-route your tier.");
  console.log("=================================================");
}

async function runUninstall({ hasYesFlag, args, isInteractive }) {
  const localHarnessDirs = platformModules
    .filter(p => typeof p.getHarnessDir === 'function')
    .map(p => p.getHarnessDir(workspaceRoot));

  const localInstalled = fs.existsSync(path.join(workspaceRoot, '.harness')) || // legacy pre-reorg root
                         localHarnessDirs.some(d => fs.existsSync(d)) ||
                         fs.existsSync(path.join(workspaceRoot, '.claude', 'settings.json')) ||
                         fs.existsSync(path.join(workspaceRoot, '.cursorrules')) ||
                         fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md')) ||
                         fs.existsSync(path.join(workspaceRoot, 'AGENTS.md')) ||
                         fs.existsSync(path.join(workspaceRoot, '.continue', 'rules', 'harness.md')) ||
                         fs.existsSync(path.join(workspaceRoot, '.hermes.md'));

  const globalAgentsDir = path.join(userHome, '.agents');
  const globalHarnessDir = manifest.getHarnessDir(globalAgentsDir);
  const globalInstalled = fs.existsSync(globalHarnessDir) ||
                          fs.existsSync(path.join(userHome, '.claude', 'settings.json')) ||
                          fs.existsSync(path.join(userHome, '.cursorrules')) ||
                          fs.existsSync(path.join(userHome, '.continue', 'rules', 'harness.md')) ||
                          fs.existsSync(path.join(getUserPromptsDir(), 'harness.instructions.md')) ||
                          fs.existsSync(path.join(getUserPromptsDir(), 'harness.agent.md'));

  const installedSkills = skills.getInstalledSkills(workspaceRoot, userHome);

  console.log("=================================================");
  console.log(`          Harness OS - Uninstall Utility         `);
  console.log("=================================================");

  let removeLocal = false;
  let removeGlobal = false;
  let removeSkills = false;

  const runInteractively = isInteractive && !hasYesFlag;

  if (runInteractively) {
    const choices = [];
    if (localInstalled) {
      choices.push({ id: 'local', name: 'Uninstall Harness OS from Local Workspace (Hooks & Advisory files)', checked: true });
    }
    if (globalInstalled) {
      choices.push({ id: 'global', name: 'Uninstall Harness OS from Global Home (~/.agents, VS Code Prompts, etc.)', checked: false });
    }

    if (choices.length > 0) {
      console.log("\nSelect installation scopes to uninstall:");
      const selectedScopes = await interactiveSelect(choices);
      removeLocal = selectedScopes.some(s => s.id === 'local' && s.checked);
      removeGlobal = selectedScopes.some(s => s.id === 'global' && s.checked);
    } else {
      console.log("\nNo Harness OS installation detected in local workspace or global home.");
    }

    if (installedSkills.length > 0) {
      console.log(`\nDetected ${installedSkills.length} installed skill(s):`);
      installedSkills.forEach(s => {
        console.log(`  - ${s.id} (${s.scope})`);
      });

      console.log("\nWould you like to uninstall these skills?");
      const skillChoiceItems = [
        { id: 'all', name: 'Remove ALL detected skills', checked: true },
        { id: 'select', name: 'Select specific skills to remove', checked: false },
        { id: 'none', name: 'Keep all skills', checked: false }
      ];
      const skillAction = await interactiveSingleSelect(skillChoiceItems);

      if (skillAction === 'all') {
        removeSkills = true;
      } else if (skillAction === 'select') {
        const selectSkillItems = installedSkills.map(s => ({
          id: s.dirPath,
          name: `${s.id} (${s.scope})`,
          checked: true,
          _entry: s
        }));
        const chosenSkillsToRemove = await interactiveSelect(selectSkillItems);
        for (const item of chosenSkillsToRemove) {
          if (item.checked) {
            skills.removeSkill(item._entry);
            console.log(`  ✅ Removed skill: ${item.name}`);
            cleanEmptyDirs(item._entry.parentPath, [workspaceRoot, userHome]);
          }
        }
      }
    }
  } else {
    const hasLocalFlag = args.includes('--local');
    const hasGlobalUninstallFlag = args.includes('--global') || args.includes('-g');
    const hasSkillsUninstallFlag = args.includes('--skills');

    if (hasYesFlag) {
      // -y auto-confirms local (cwd-scoped, obviously "this project") but
      // must NEVER auto-confirm global (~/.agents, ~/.claude, etc.) just
      // because something global happens to exist - home-directory state
      // isn't implied by "yes" to the workspace you're standing in, and a
      // bare `-y` run from any random project must not be able to wipe it.
      removeLocal = localInstalled;
      removeGlobal = globalInstalled && hasGlobalUninstallFlag;
      removeSkills = installedSkills.length > 0;
    } else {
      removeLocal = hasLocalFlag;
      removeGlobal = hasGlobalUninstallFlag;
      removeSkills = hasSkillsUninstallFlag;
    }
  }

  if (removeLocal) {
    console.log("\n-------------------------------------------------");
    console.log("Uninstalling Harness OS from Local Workspace...");
    console.log("-------------------------------------------------");

    for (const platform of platformModules) {
      if (typeof platform.uninstall === 'function') {
        platform.uninstall({
          removeLocal: true,
          removeGlobal: false,
          workspaceRoot,
          userHome,
          getUserPromptsDir,
          cleanEmptyDirs,
          claudeHooks
        });
      }

      if (typeof platform.getStateDir === 'function') {
        const stateDir = platform.getStateDir(workspaceRoot);
        if (fs.existsSync(stateDir)) {
          fs.rmSync(stateDir, { recursive: true, force: true });
          console.log(`  ✅ Removed local ${path.relative(workspaceRoot, stateDir).replace(/\\/g, '/')}/ directory`);
        }
      }
    }

    // One-time migration cleanup: earlier versions used a self-invented
    // top-level .harness/ directory for Claude's manifest + skill copies.
    const legacyHarnessDir = path.join(workspaceRoot, '.harness');
    if (fs.existsSync(legacyHarnessDir)) {
      fs.rmSync(legacyHarnessDir, { recursive: true, force: true });
      console.log(`  ✅ Removed legacy .harness/ directory (superseded by .claude/harness-everything/)`);
    }
  }

  if (removeGlobal) {
    console.log("\n-------------------------------------------------");
    console.log("Uninstalling Harness OS from Global Home...");
    console.log("-------------------------------------------------");

    for (const platform of platformModules) {
      if (typeof platform.uninstall === 'function') {
        platform.uninstall({
          removeLocal: false,
          removeGlobal: true,
          workspaceRoot,
          userHome,
          getUserPromptsDir,
          cleanEmptyDirs,
          claudeHooks
        });
      }
    }

    // ~/.agents is a shared directory - other tools or the user's own files
    // may live there. Never touch it directly; only clean up the
    // harness-everything/ subfolder (manifest bookkeeping) and the skills/
    // subfolder this package exclusively owns, and only once each is
    // actually empty (manifest.json is removed automatically by the
    // skills-removal step below once no skills remain in it).
    cleanEmptyDirs(path.join(globalAgentsDir, 'skills'), [userHome]);
    cleanEmptyDirs(globalHarnessDir, [userHome]);
  }

  if (removeSkills && installedSkills.length > 0) {
    // This block is only reached via a bulk "remove everything detected"
    // path (interactive "all", or the non-interactive -y/--skills bypass) -
    // never via the interactive per-item picker, which already removes
    // exactly what the user checked. A bulk sweep must not reach into the
    // real global home directory unless the user separately opted into
    // global scope (same rule as the config removal above). Every entry in
    // `installedSkills` is already manifest-tracked (or, for legacy
    // installs, author-marker-verified) - see lib/skills.js - so this never
    // touches a skill Harness didn't install.
    const skillsToRemove = installedSkills.filter(s => s.scope !== 'global' || removeGlobal);
    const skippedGlobalCount = installedSkills.length - skillsToRemove.length;

    console.log("\n-------------------------------------------------");
    console.log("Uninstalling all detected skills...");
    console.log("-------------------------------------------------");
    for (const skill of skillsToRemove) {
      if (fs.existsSync(skill.dirPath)) {
        skills.removeSkill(skill);
        console.log(`  ✅ Removed skill: ${skill.id} (${skill.scope})`);
        cleanEmptyDirs(skill.parentPath, [workspaceRoot, userHome]);
      }
    }
    if (skippedGlobalCount > 0) {
      console.log(`  ℹ️  Skipped ${skippedGlobalCount} global-scoped skill(s) - pass --global (or select "Uninstall ... Global Home") to remove those too.`);
    }
  }

  // Final sweep: a platform's harness-everything/ dir (manifest + Claude's
  // skill copies) may have only just become empty above - either through the
  // bulk removeSkills block or the interactive per-item picker, both of
  // which clean up the skill's own parent dir but not necessarily this one.
  // Always safe to run unconditionally: cleanEmptyDirs only ever removes a
  // directory that's genuinely empty.
  for (const platform of platformModules) {
    if (typeof platform.getHarnessDir !== 'function') continue;
    cleanEmptyDirs(platform.getHarnessDir(workspaceRoot), [workspaceRoot, userHome]);
  }
  cleanEmptyDirs(path.join(workspaceRoot, '.claude'), [workspaceRoot, userHome]);

  console.log("\n🎉 UNINSTALL COMPLETE! Harness OS has been removed.");
  console.log("=================================================");
}

main().catch(err => {
  console.error(`\n❌ Install failed: ${err.message}`);
  process.exit(1);
});

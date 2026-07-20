#!/usr/bin/env node
/**
 * Lightweight, non-intrusive installer for Harness OS.
 * Detects the local project layout (Claude Code, Cursor, etc.)
 * and merges the Harness hook definitions safely without destroying user configs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function getUserPromptsDir() {
  if (process.env.VSCODE_USER_PROMPTS_FOLDER) {
    return process.env.VSCODE_USER_PROMPTS_FOLDER;
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'prompts');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'prompts');
  } else {
    return path.join(home, '.config', 'Code', 'User', 'prompts');
  }
}

const userHome = os.homedir();
const workspaceRoot = getWorkspaceRoot();
const harnessSourceDir = path.resolve(__dirname, '..');

const readline = require('readline');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getAvailableSkills() {
  const dirs = fs.readdirSync(harnessSourceDir, { withFileTypes: true });
  const skills = [];
  for (const dir of dirs) {
    if (dir.isDirectory() && !dir.name.startsWith('.') && !['bin', 'docs', 'hooks', 'scripts', 'node_modules'].includes(dir.name)) {
      const skillPath = path.join(harnessSourceDir, dir.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        skills.push(dir.name);
      }
    }
  }
  return skills.sort();
}

function getSkillInfo(skillDirName) {
  const skillPath = path.join(harnessSourceDir, skillDirName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;
  try {
    const content = fs.readFileSync(skillPath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let name = skillDirName;
    let description = '';
    if (match) {
      const yaml = match[1];
      const nameMatch = yaml.match(/^name:\s*(.*)$/m);
      const descMatch = yaml.match(/^description:\s*(.*)$/m);
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
    }
    return { id: skillDirName, name, description };
  } catch (e) {
    return { id: skillDirName, name: skillDirName, description: '' };
  }
}

function interactiveSelect(items, pageSize = items.length) {
  return new Promise((resolve) => {
    let cursor = 0;
    let scrollIndex = 0;
    let visibleItems = [];
    const isScrollable = items.length > pageSize;

    function render() {
      readline.cursorTo(process.stdout, 0);

      if (isScrollable) {
        if (cursor >= scrollIndex + pageSize) {
          scrollIndex = cursor - pageSize + 1;
        } else if (cursor < scrollIndex) {
          scrollIndex = cursor;
        }
      }

      visibleItems = items.slice(scrollIndex, scrollIndex + pageSize);
      const writeLines = [];

      if (isScrollable) {
        if (scrollIndex > 0) {
          writeLines.push(`  ▲ (more above)`);
        } else {
          writeLines.push(``); // Spacer
        }
      }

      for (let i = 0; i < visibleItems.length; i++) {
        const itemIndex = scrollIndex + i;
        const item = visibleItems[i];
        const isSelected = item.checked ? '[x]' : '[ ]';
        const isCurrent = itemIndex === cursor ? '> ' : '  ';
        const desc = item.description ? ` - ${item.description}` : '';
        const lineText = `${isCurrent}${isSelected} ${item.name || item.id}${desc}`;
        const maxCols = process.stdout.columns || 80;
        const truncated = lineText.length > maxCols - 5
          ? lineText.slice(0, maxCols - 8) + '...'
          : lineText;
        writeLines.push(truncated);
      }

      if (isScrollable) {
        if (scrollIndex + pageSize < items.length) {
          writeLines.push(`  ▼ (more below)`);
        } else {
          writeLines.push(``); // Spacer
        }
      }

      writeLines.push(``);
      writeLines.push(`(Use Up/Down Arrow keys to navigate, Space to toggle, Enter to confirm)`);

      for (const line of writeLines) {
        readline.clearLine(process.stdout, 0);
        process.stdout.write(`${line}\n`);
      }
    }

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Hide cursor
    process.stdout.write('\u001B[?25l');

    render();

    function cleanup() {
      // Show cursor again
      process.stdout.write('\u001B[?25h');
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    function handleKeypress(str, key) {
      if (key) {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }

        const linesToMove = pageSize + (isScrollable ? 4 : 2);

        if (key.name === 'up') {
          cursor = (cursor - 1 + items.length) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'down') {
          cursor = (cursor + 1) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'space' || str === ' ') {
          const itemIndex = cursor;
          items[itemIndex].checked = !items[itemIndex].checked;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          readline.moveCursor(process.stdout, 0, -linesToMove);
          for (let i = 0; i < linesToMove; i++) {
            readline.clearLine(process.stdout, 0);
            process.stdout.write('\n');
          }
          readline.moveCursor(process.stdout, 0, -linesToMove);

          for (let i = 0; i < visibleItems.length; i++) {
            readline.clearLine(process.stdout, 0);
            const item = visibleItems[i];
            const isSelected = item.checked ? '✔' : ' ';
            process.stdout.write(`  ${isSelected} ${item.name || item.id}\n`);
          }
          if (isScrollable) {
            readline.clearLine(process.stdout, 0);
            process.stdout.write('\n');
          }
          readline.clearLine(process.stdout, 0);
          process.stdout.write('\n');
          resolve(items);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function interactiveSingleSelect(items) {
  return new Promise((resolve) => {
    let cursor = 0;
    if (!items.some(i => i.checked)) {
      items[0].checked = true;
    }

    function render() {
      readline.cursorTo(process.stdout, 0);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isSelected = item.checked ? '(o)' : '( )';
        const isCurrent = i === cursor ? '> ' : '  ';
        readline.clearLine(process.stdout, 0);
        process.stdout.write(`${isCurrent}${isSelected} ${item.name}\n`);
      }
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`\n`);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`(Use Up/Down Arrow keys to navigate, Space to select, Enter to confirm)\n`);
    }

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdout.write('\u001B[?25l');
    render();

    function cleanup() {
      process.stdout.write('\u001B[?25h');
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    function handleKeypress(str, key) {
      if (key) {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }

        const linesToMove = items.length + 2;

        if (key.name === 'up') {
          cursor = (cursor - 1 + items.length) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'down') {
          cursor = (cursor + 1) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'space' || str === ' ') {
          items.forEach((item, idx) => {
            item.checked = (idx === cursor);
          });
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'return' || key.name === 'enter') {
          items.forEach((item, idx) => {
            item.checked = (idx === cursor);
          });
          cleanup();
          readline.moveCursor(process.stdout, 0, -linesToMove);
          for (let i = 0; i < linesToMove; i++) {
            readline.clearLine(process.stdout, 0);
            process.stdout.write('\n');
          }
          readline.moveCursor(process.stdout, 0, -linesToMove);

          for (let i = 0; i < items.length; i++) {
            readline.clearLine(process.stdout, 0);
            const item = items[i];
            const isSelected = item.checked ? '✔' : ' ';
            process.stdout.write(`  ${isSelected} ${item.name}\n`);
          }
          readline.clearLine(process.stdout, 0);
          process.stdout.write('\n');
          resolve(items.find(item => item.checked).id);
        }
      }
    }
    process.stdin.on('keypress', handleKeypress);
  });
}

async function main() {
  const args = process.argv;
  const command = args[2] || 'install'; // 'install', 'add', 'skills', etc.

  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  const hasClaudeFlag = args.includes('--claude');
  const hasCursorFlag = args.includes('--cursor');
  const hasCopilotFlag = args.includes('--copilot');
  const hasCodexFlag = args.includes('--codex');
  const hasAllFlag = args.includes('--all');
  const hasGlobalFlag = args.includes('--global') || args.includes('-g');
  const hasYesFlag = args.includes('-y') || args.includes('--yes');
  const hasAnyPlatformFlag = hasClaudeFlag || hasCursorFlag || hasCopilotFlag || hasCodexFlag || hasAllFlag;
  const requestedSkills = ['add', 'skill', 'skills'].includes(command)
    ? args.slice(3).filter(arg => !arg.startsWith('-'))
    : [];

  const claudeExists = fs.existsSync(path.join(workspaceRoot, '.claude'));
  const cursorExists = fs.existsSync(path.join(workspaceRoot, '.cursorrules'));
  const copilotExists = fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md')) || fs.existsSync(path.join(workspaceRoot, '.github'));
  const codexExists = fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
  const detectedAny = claudeExists || cursorExists || copilotExists || codexExists;

  let targets = {
    claude: false,
    cursor: false,
    copilot: false,
    codex: false
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
      { id: 'codex', name: `Codex (AGENTS.md)              ${codexExists ? '(Detected)' : ''}`, checked: codexExists }
    ];
    const selectedPlatforms = await interactiveSelect(platformItems);
    selectedPlatforms.forEach(p => {
      targets[p.id] = p.checked;
    });

    // Step 2: Choose skills
    const availableSkills = getAvailableSkills();
    console.log("\n[Step 2/3] Select skills to install:");
    const skillItems = availableSkills.map(s => {
      const info = getSkillInfo(s);
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
        const availableSkills = getAvailableSkills();
        for (const skillName of requestedSkills) {
          if (availableSkills.includes(skillName)) {
            chosenSkills.push(skillName);
          } else {
            console.error(`⚠️ Skill "${skillName}" not found. Skipping.`);
          }
        }
      } else {
        chosenSkills = ['tdd', 'git-commit', 'todo-driven-workflow', 'verification-loop'];
      }
      
      if (!isGlobal) {
        targets.claude = claudeExists;
        targets.cursor = cursorExists;
        targets.copilot = copilotExists;
        targets.codex = codexExists;
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
        } else {
          targets.claude = hasClaudeFlag;
          targets.cursor = hasCursorFlag;
          targets.copilot = hasCopilotFlag;
          targets.codex = hasCodexFlag;
        }
      } else {
        if (detectedAny) {
          targets.claude = claudeExists;
          targets.cursor = cursorExists;
          targets.copilot = copilotExists;
          targets.codex = codexExists;
        } else {
          targets.claude = true;
        }
      }
      chosenSkills = ['tdd', 'git-commit', 'todo-driven-workflow', 'verification-loop'];
    }
  }

  // Ensure harness-everything is ALWAYS included in chosenSkills
  if (!chosenSkills.includes('harness-everything')) {
    chosenSkills.push('harness-everything');
  }

  // If no targets selected at all, exit
  if (!targets.claude && !targets.cursor && !targets.copilot && !targets.codex && !isGlobal) {
    console.log("\n❌ No platforms selected. Exiting.");
    process.exit(0);
  }

  const targetWorkspaceRoot = isGlobal ? path.join(userHome, '.agents') : workspaceRoot;
  const targetLabel = isGlobal ? '~/.agents' : '.harness';

  console.log("\n-------------------------------------------------");
  console.log(`Installing Harness OS to ${isGlobal ? 'Global Home' : 'Local Workspace'}`);
  console.log("-------------------------------------------------");

  // Create workspace/global directories
  const dotHarnessDir = isGlobal ? targetWorkspaceRoot : path.join(targetWorkspaceRoot, '.harness');
  if (!fs.existsSync(dotHarnessDir)) {
    fs.mkdirSync(dotHarnessDir, { recursive: true });
    console.log(`  Created ${targetLabel} directory`);
  }

  // Load Harness source hooks definition
  const sourceHooksFile = path.join(harnessSourceDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(sourceHooksFile)) {
    throw new Error(`Harness source hooks definition not found at: ${sourceHooksFile}`);
  }
  
  const sourceHooksObj = JSON.parse(fs.readFileSync(sourceHooksFile, 'utf8'));

  // Resolve target file paths and update hooks with absolute script paths
  const resolvedHooks = {};
  for (const [hookType, hookList] of Object.entries(sourceHooksObj.hooks || {})) {
    resolvedHooks[hookType] = hookList.map(hookItem => {
      const cloned = JSON.parse(JSON.stringify(hookItem));
      if (cloned.hooks) {
        cloned.hooks = cloned.hooks.map(h => {
          if (h.type === 'command' && h.command) {
            let cmd = h.command
              .replace(/d:\/GitHub\/harness-skills\//g, '')
              .replace(/path\/to\/harness-skills\//g, '');
            cmd = cmd.replace(/^node\s+"?([^"\s]+)"?/, (m, scriptPath) => {
              const abs = path.isAbsolute(scriptPath) ? scriptPath : path.join(harnessSourceDir, scriptPath);
              return `node "${abs}"`;
            });
            h.command = cmd;
          }
          return h;
        });
      }
      return cloned;
    });
  }

  // Merge into .claude/settings.json (only if Claude Code selected)
  if (targets.claude) {
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

    // Safely merge hooks
    claudeConfig.hooks = claudeConfig.hooks || {};
    for (const [hookType, hookList] of Object.entries(resolvedHooks)) {
      const existingList = claudeConfig.hooks[hookType] || [];
      const mergedList = [...existingList];
      hookList.forEach(newHook => {
        const existsIdx = mergedList.findIndex(h => h.id === newHook.id);
        if (existsIdx !== -1) {
          mergedList[existsIdx] = newHook;
        } else {
          mergedList.push(newHook);
        }
      });
      claudeConfig.hooks[hookType] = mergedList;
    }

    fs.writeFileSync(claudeSettingsFile, JSON.stringify(claudeConfig, null, 2), 'utf8');
    console.log(`  ✅ Configured Claude Code hooks safely in ${isGlobal ? '~' : ''}/.claude/settings.json`);
  }

  // Prompt-injection-only platforms (Cursor, Copilot, Codex)
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
  if (targets.cursor) {
    const targetFile = isGlobal ? path.join(userHome, '.cursorrules') : path.join(targetWorkspaceRoot, '.cursorrules');
    injectAdvisoryText(targetFile, '# Cursor Project Rules', isGlobal ? '~/.cursorrules' : '.cursorrules');
  }
  // Copilot Chat
  if (targets.copilot) {
    if (!isGlobal) {
      const targetFile = path.join(targetWorkspaceRoot, '.github', 'copilot-instructions.md');
      injectAdvisoryText(targetFile, '# Copilot Instructions', '.github/copilot-instructions.md');
    }

    if (isGlobal) {
      try {
        const promptsDir = getUserPromptsDir();
        if (!fs.existsSync(promptsDir)) {
          fs.mkdirSync(promptsDir, { recursive: true });
        }
        const vscodeInstFile = path.join(promptsDir, 'harness.instructions.md');
        const vscodeInstContent = [
          `---`,
          `description: "Harness OS Guidance (Advisory)"`,
          `applyTo: "**"`,
          `---`,
          `# Copilot Instructions`,
          ``,
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
        fs.writeFileSync(vscodeInstFile, vscodeInstContent, 'utf8');
        console.log(`  ✅ Installed global Copilot instructions to VS Code: ${vscodeInstFile}`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to write VS Code user prompts folder: ${err.message}`);
      }
    }
  }
  // Codex
  if (targets.codex) {
    if (!isGlobal) {
      const targetFile = path.join(targetWorkspaceRoot, 'AGENTS.md');
      injectAdvisoryText(targetFile, '# AGENTS.md', 'AGENTS.md');
    }

    if (isGlobal) {
      try {
        const promptsDir = getUserPromptsDir();
        if (!fs.existsSync(promptsDir)) {
          fs.mkdirSync(promptsDir, { recursive: true });
        }
        const vscodeAgentFile = path.join(promptsDir, 'harness.agent.md');
        const vscodeAgentContent = [
          `---`,
          `description: "Harness OS Guidance - Global custom agent for orchestrating multi-agent workflows"`,
          `name: "Harness"`,
          `user-invocable: true`,
          `---`,
          `# AGENTS.md`,
          ``,
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
        fs.writeFileSync(vscodeAgentFile, vscodeAgentContent, 'utf8');
        console.log(`  ✅ Installed global Codex agent to VS Code: ${vscodeAgentFile}`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to write VS Code user prompts folder: ${err.message}`);
      }
    }
  }

  // Install chosen skills
  if (chosenSkills.length > 0) {
    const targetDirs = [];
    if (isGlobal) {
      targetDirs.push({ path: path.join(userHome, '.agents', 'skills'), label: '~/.agents/skills/' });
    } else {
      if (targets.claude) {
        targetDirs.push({ path: path.join(workspaceRoot, '.harness', 'skills'), label: '.harness/skills/' });
      }
      if (targets.cursor) {
        targetDirs.push({ path: path.join(workspaceRoot, '.cursor', 'skills'), label: '.cursor/skills/' });
      }
      if (targets.copilot) {
        targetDirs.push({ path: path.join(workspaceRoot, '.github', 'skills'), label: '.github/skills/' });
      }
      if (targets.codex) {
        targetDirs.push({ path: path.join(workspaceRoot, '.agents', 'skills'), label: '.agents/skills/' });
      }
    }

    console.log(`\nInstalling Harness skills:`);
    for (const target of targetDirs) {
      fs.mkdirSync(target.path, { recursive: true });
      for (const skillName of chosenSkills) {
        const src = path.join(harnessSourceDir, skillName);
        const dest = path.join(target.path, skillName);
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        copyDir(src, dest);
        console.log(`  ✅ Installed skill: ${target.label}${skillName}/`);
      }
    }
  }

  console.log("\n🎉 INSTALL SUCCESS! Harness OS is now protecting this project.");
  console.log("Try your first AI interaction! The bootstrapped OS will auto-route your tier.");
  console.log("=================================================");
}

main().catch(err => {
  console.error(`\n❌ Install failed: ${err.message}`);
  process.exit(1);
});

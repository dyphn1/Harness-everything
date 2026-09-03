#!/usr/bin/env node
/**
 * Harness OS CLI
 * Dispatches installation and self-regression testing
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  showHelp();
  process.exit(0);
}

switch (command) {
  case 'install':
  case 'add':
  case 'skill':
  case 'skills':
  case 'uninstall':
    runInstaller(args.slice(1));
    break;
  case 'test':
  case 'self-regression':
    runSelfRegression();
    break;
  case 'next':
    runNext(args.slice(1));
    break;
  case 'verify':
    runVerify();
    break;
  case 'verify-install':
    runInstallVerification(args.slice(1));
    break;
  default:
    console.error(`[Error] Unknown command: "${command}"`);
    showHelp();
    process.exit(1);
}

function showHelp() {
  console.log(`
Harness OS - AI Agent Operating System CLI

Usage:
  npx github:dyphn1/Harness-everything <command> [options]
  
Commands:
  install            Install Harness OS hooks & skills into the local repository
                     Options:
                       --claude      Install Claude Code hooks (.claude/settings.json)
                       --cursor      Install Cursor project rules (.cursorrules)
                       --copilot     Install Copilot Chat instructions (.github/copilot-instructions.md)
                       --codex       Install Codex agents layout (AGENTS.md)
                       --continue    Install Continue.dev rules (.continue/rules/harness.md)
                       --hermes      Install Hermes Agent instructions (.hermes.md, local scope only)
                       --all         Install all of the above platforms
                       -g, --global  Install to home directory (~/.agents) instead of local repository
                       -y, --yes     Bypass interactive menu and use auto-detection
                       --symlink     Force linking every platform's skill dir to one canonical
                                     copy (junction on Windows, symlink elsewhere) - errors
                                     instead of falling back if a link can't be created
                       --copy        Force an independent physical copy per platform (skip the
                                     canonical store entirely) - use when links aren't supported
                                     (default: try a link automatically, fall back to --copy
                                     behavior silently on failure)
  add/skills/skill   Add/install modular skills into the local workspace
                     Usage:
                       npx github:dyphn1/Harness-everything add [skill-names...]
                       Options:
                         -g, --global      Install skills to home directory (~/.agents/skills)
                         --symlink/--copy  See 'install' above
                       (Runs interactively if no skill names are specified)
  uninstall          Remove Harness OS hooks, advisory files & skills
                     Options:
                       --local       Remove from local workspace
                       -g, --global  Also remove from home directory (~/.agents, etc.)
                       --skills      Remove installed skills
                       -y, --yes     Bypass interactive menu (local + skills only,
                                     unless --global is also passed)
                     Passing ANY of the above flags (even with -y omitted) always runs
                     non-interactively against exactly what you passed - e.g.
                     'uninstall --local --global --skills' removes both scopes and all
                     skills in one run, with no menu. Only a bare 'uninstall' with no
                     flags goes interactive, and only when run in a real terminal; with
                     no flags and no interactive terminal available, it exits with an
                     error instead of silently doing nothing.
  self-regression    Run syntax and routing checks before committing changes (alias: test)
  next "<prompt>"    Print the tier-router.js routing recommendation for a prompt.
                     This is the mechanism hook/hookless platforms (Codex, Cursor,
                     Copilot, Continue, Hermes) call explicitly at the start of a
                     turn, since they have no hook to run it automatically.
  verify-install     Compare installed Harness manifests and skill trees with
                     this package source; stale versions or missing files fail.
  verify             Run the pre-delivery verification gate (lint/test from the
                     nearest package.json). Exits non-zero if checks fail. This is
                     the explicit stand-in for Claude Code's stop-gate hook on
                     platforms with no hook mechanism - call it before declaring a
                     task complete.

Options:
  --help, -h         Show this help text
`);
}

function runInstaller(installArgs) {
  const installerPath = path.resolve(__dirname, '..', 'scripts', 'installer.js');
  // Dynamic require or spawn
  if (fs.existsSync(installerPath)) {
    require(installerPath);
  } else {
    console.error("[Error] Installer script not found at scripts/installer.js");
    process.exit(1);
  }
}

function runSelfRegression() {
  const regressionPath = path.resolve(__dirname, '..', 'self-evolve', 'scripts', 'self-regression.js');
  if (fs.existsSync(regressionPath)) {
    const result = spawnSync('node', [regressionPath], { stdio: 'inherit' });
    process.exit(result.status);
  } else {
    console.error("[Error] Self-regression script not found.");
    process.exit(1);
  }
}

// Both wrappers resolve scripts relative to this CLI's own package install
// (not the caller's cwd), so they work identically regardless of which
// platform-specific directory (.codex/skills/, .cursor/skills/, ...) a copy
// of the harness-everything skill also happens to be sitting in.
function runNext(nextArgs) {
  const routerPath = path.resolve(__dirname, '..', 'harness-everything', 'scripts', 'tier-router.js');
  if (!fs.existsSync(routerPath)) {
    console.error("[Error] Tier router script not found at harness-everything/scripts/tier-router.js");
    process.exit(1);
  }
  const prompt = nextArgs.join(' ');
  const result = spawnSync('node', [routerPath, prompt], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

function runVerify() {
  const gatePath = path.resolve(__dirname, '..', 'harness-everything', 'scripts', 'verify-gate.js');
  if (!fs.existsSync(gatePath)) {
    console.error("[Error] Verify gate script not found at harness-everything/scripts/verify-gate.js");
    process.exit(1);
  }
  const result = spawnSync('node', [gatePath], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

function runInstallVerification(verifyArgs) {
  const script = path.resolve(__dirname, '..', 'scripts', 'verify-install.js');
  if (!fs.existsSync(script)) {
    console.error('[Error] Install verification script not found.');
    process.exit(1);
  }
  const result = spawnSync('node', [script, ...verifyArgs], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

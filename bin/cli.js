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
    runInstaller(args.slice(1));
    break;
  case 'test':
  case 'self-regression':
    runSelfRegression();
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
  npx harness-skills <command> [options]
  
Commands:
  install            Install Harness OS hooks & skills into the local repository
  self-regression    Run syntax and routing checks before committing changes (alias: test)

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

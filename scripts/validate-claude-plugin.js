#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stageClaudePlugin } = require('./stage-claude-plugin');

const projectRoot = path.resolve(__dirname, '..');
const staticTest = path.join(projectRoot, 'ci', 'mechanism-2z-claude-plugin-manifest.test.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === 'claude',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function requireSuccess(result, label) {
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status}`);
  }
}

function main() {
  requireSuccess(run(process.execPath, [staticTest]), 'repository Claude plugin validation');

  const version = run('claude', ['--version']);
  if (version.error || version.status !== 0) {
    console.error('INCONCLUSIVE: Claude Code CLI is unavailable or failed to start. Static repository validation passed, but host validation did not run.');
    process.exit(2);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-claude-cert-'));
  const stagedPlugin = path.join(tempRoot, 'plugin');

  try {
    stageClaudePlugin(stagedPlugin, { quiet: true });

    console.log('\n[1/2] Strict marketplace validation');
    requireSuccess(
      run('claude', ['plugin', 'validate', projectRoot, '--strict', '--json']),
      'Claude marketplace validation'
    );

    console.log('\n[2/2] Strict plugin-only validation');
    requireSuccess(
      run('claude', ['plugin', 'validate', stagedPlugin, '--strict', '--json']),
      'Claude plugin-only validation'
    );

    console.log('\nPASS: repository, marketplace, and plugin-only Claude validation completed successfully.');
    console.log('This is mechanism/schema evidence only; it does not prove plugin hooks fired in a live Claude Code session.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message || error}`);
  process.exit(1);
}

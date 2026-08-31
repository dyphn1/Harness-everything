#!/usr/bin/env node
/**
 * Harness Self-Regression Test Suite.
 *
 * This is the free, deterministic gate. Model sessions remain on-demand;
 * their results must not be confused with a local tracker simulation.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..', '..');
let hasErrors = false;

console.log('=================================================');
console.log('     Harness OS - Self-Regression Test Suite     ');
console.log('=================================================');

function runNode(label, script, args = [], options = {}) {
  const result = spawnSync('node', [script, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    console.error(`  FAIL ${label}`);
    hasErrors = true;
  } else {
    console.log(`  PASS ${label}`);
  }
  return result;
}

// 1. Syntax-check every shipped JavaScript file.
console.log('\n[Phase 1] Static Syntax Check...');
const foldersToScan = ['harness-everything', 'hooks', 'environment-detection', 'self-evolve', 'ci', 'eval-harness', 'scripts', 'bin', 'to-spec', 'to-tickets', 'find-skills'];
const jsFiles = [];
function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) walkDir(filePath);
    else if (filePath.endsWith('.js')) jsFiles.push(filePath);
  }
}
for (const folder of foldersToScan) walkDir(path.join(projectRoot, folder));
for (const file of jsFiles) {
  const check = spawnSync('node', ['--check', file]);
  if (check.status !== 0) {
    console.error(`  FAIL syntax: ${path.relative(projectRoot, file)}`);
    console.error(check.stderr.toString().trim());
    hasErrors = true;
  }
}
console.log(`  PASS syntax: ${jsFiles.length} JavaScript file(s)`);

// 1b. Smoke-test the public CLI wrappers.
console.log('\n[Phase 1b] CLI Command Smoke Test...');
const cliPath = path.join(projectRoot, 'bin', 'cli.js');
const nextCheck = spawnSync('node', [cliPath, 'next', 'add a new login endpoint with tests'], { cwd: projectRoot });
if (nextCheck.status !== 0 || !nextCheck.stdout.toString().includes('RECOMMENDED TIER')) {
  console.error('  FAIL `harness next` did not produce a routing recommendation.');
  hasErrors = true;
} else console.log('  PASS `harness next` produced a routing recommendation.');
const verifyCheck = spawnSync('node', [cliPath, 'verify'], {
  cwd: projectRoot,
  env: { ...process.env, HARNESS_SKIP_PROJECT_CHECKS: '1' },
});
if (verifyCheck.status !== 0) {
  console.error('  FAIL `harness verify` exited non-zero on a skipped check.');
  hasErrors = true;
} else console.log('  PASS `harness verify` exited 0 on a skipped check.');

// 2. Deterministic routing matrix.
console.log('\n[Phase 2] Routing Verification Check...');
runNode('routing matrix', path.join(projectRoot, 'ci', 'runner.js'));

// 3. Static integrity gates; behavioral evals are validated, not executed.
console.log('\n[Phase 3] Skill Reference and Behavioral Case Checks...');
runNode('skill reference check', path.join(projectRoot, 'ci', 'reference-check.js'));
runNode('behavioral case validation', path.join(projectRoot, 'behavioral-evals', 'run.js'), ['validate']);

// 4. Hook/mechanism checks.
console.log('\n[Phase 4] Mechanism Test Suite (Claude Code hooks)...');
runNode('mechanism suite', path.join(projectRoot, 'ci', 'mechanism-test.js'));

console.log('\n=================================================');
if (hasErrors) {
  console.error(' FAIL: self-regression found one or more problems.');
  console.log('=================================================');
  process.exit(1);
}
console.log(' PASS: all deterministic self-regression checks passed.');
console.log('=================================================');

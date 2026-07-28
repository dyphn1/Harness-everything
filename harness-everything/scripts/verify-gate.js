#!/usr/bin/env node
/**
 * Verification Gatekeeper
 * Runs the target project's own mechanical checks (lint/test scripts from the
 * nearest package.json) and refuses completion (Exit 1) when any of them fail.
 *
 * Escape hatches, both deliberate:
 * - `.verify-fail.tmp` in cwd forces a failure - the hermetic self-regression
 *   suite uses it to prove the blocking mechanism without needing a real
 *   broken project.
 * - HARNESS_SKIP_PROJECT_CHECKS=1 skips the project-script phase (the tmp-file
 *   check above still applies). The gate sets it for its own children so a
 *   project whose test suite itself drives todo-cli (like this repo) cannot
 *   recurse back into the gate.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log("=== 🛡️ Harness Verification Gate ===");

// Phase 1: explicit failure injection (test/demo hook).
if (fs.existsSync('.verify-fail.tmp')) {
  console.error("❌ Verification FAILED: .verify-fail.tmp present (injected failure).");
  console.error("Please fix the code and run this gate again.");
  process.exit(1);
}

if (process.env.HARNESS_SKIP_PROJECT_CHECKS === '1') {
  console.log("ℹ️ HARNESS_SKIP_PROJECT_CHECKS=1 - project scripts skipped (recursion guard / hermetic test mode).");
  console.log("✅ Verification SUCCESS (injection check only).");
  process.exit(0);
}

// Phase 2: locate the nearest package.json, walking up from cwd but never
// above the enclosing git repository (same scoping rule as tier-router.js).
function findPackageDir() {
  let dir = path.resolve(process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return null; // repo root reached, none found
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function detectRunner(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

const pkgDir = findPackageDir();
let scripts = {};
if (pkgDir) {
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).scripts || {};
  } catch (err) {
    console.error(`❌ Verification FAILED: package.json at ${pkgDir} is unreadable/invalid JSON (${err.message}).`);
    process.exit(1);
  }
}

// npm-init's placeholder ("no test specified" + exit 1) is absence of a test
// suite, not a failing one - running it would block every fresh project.
const runnable = ['lint', 'test'].filter(name =>
  typeof scripts[name] === 'string' &&
  scripts[name].trim() !== '' &&
  !/no test specified/i.test(scripts[name])
);

if (!pkgDir || runnable.length === 0) {
  console.log("⚠️ Verification UNCHECKED: No automated lint/test scripts detected in package.json.");
  console.log("   Exit code is 0 (non-blocking), but NO AUTOMATED EVIDENCE was produced.");
  console.log("   PROHIBITED: Do NOT cite this run as proof that tests pass. Perform manual or alternative verification first.");
  process.exit(0);
}

const runner = detectRunner(pkgDir);
for (const name of runnable) {
  console.log(`\n▶ Running "${runner} run ${name}" in ${pkgDir} ...`);
  try {
    execSync(`${runner} run ${name}`, {
      cwd: pkgDir,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000,
      env: { ...process.env, HARNESS_SKIP_PROJECT_CHECKS: '1' }
    });
    console.log(`✅ ${name} passed.`);
  } catch (err) {
    console.error(`\n❌ Verification FAILED: "${runner} run ${name}" exited non-zero${err.signal ? ` (signal ${err.signal})` : ''}.`);
    console.error("Fix the failures above and run this gate again.");
    process.exit(1);
  }
}

console.log("\n✅ Verification SUCCESS. You may now complete the task.");
process.exit(0);

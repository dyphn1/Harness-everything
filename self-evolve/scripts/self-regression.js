#!/usr/bin/env node
/**
 * Harness Self-Regression Test Suite
 * Compiles and validates all Javascript files and runs routing verification framework
 * before dynamic evolution / dynamic skills are officially persisted.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..', '..');

console.log("=================================================");
console.log("     Harness OS - Self-Regression Test Suite     ");
console.log("=================================================");

let hasErrors = false;

// 1. Walk and syntax check all Javascript files
console.log("\n[Phase 1] Static Syntax Check...");
const foldersToScan = ['harness-everything', 'hooks', 'environment-detection', 'self-evolve', 'eval-framework', 'eval-harness', 'scripts', 'bin'];
const jsFiles = [];

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      walkDir(filePath);
    } else if (filePath.endsWith('.js')) {
      jsFiles.push(filePath);
    }
  });
}

foldersToScan.forEach(folder => {
  walkDir(path.join(projectRoot, folder));
});

jsFiles.forEach(file => {
  const relativePath = path.relative(projectRoot, file);
  // node --check checks syntax without execution
  const check = spawnSync('node', ['--check', file]);
  if (check.status !== 0) {
    console.error(`  ❌ Syntax Error in ${relativePath}`);
    console.error(check.stderr.toString().trim());
    hasErrors = true;
  } else {
    console.log(`  ✅ ${relativePath.padEnd(50)} [Valid Syntax]`);
  }
});

// 2. Run Tier Verification Framework
console.log("\n[Phase 2] Routing Verification Check...");
const runnerPath = path.join(projectRoot, 'eval-framework', 'runner.js');
if (fs.existsSync(runnerPath)) {
  const runnerCheck = spawnSync('node', [runnerPath], { stdio: 'inherit' });
  if (runnerCheck.status !== 0) {
    console.error("\n  ❌ Routing verification framework failed!");
    hasErrors = true;
  } else {
    console.log("\n  ✅ Routing verification framework 100% Passed!");
  }
} else {
  console.warn("  ⚠️  eval-framework/runner.js not found. Skipping Phase 2.");
}

// 3. Run Behavioral Test Suite (E2E state-machine transitions, not just syntax)
console.log("\n[Phase 3] Behavioral Test Suite...");
const behavioralTestPath = path.join(projectRoot, 'eval-framework', 'behavioral-test.js');
if (fs.existsSync(behavioralTestPath)) {
  const behavioralCheck = spawnSync('node', [behavioralTestPath], { stdio: 'inherit', cwd: projectRoot });
  if (behavioralCheck.status !== 0) {
    console.error("\n  ❌ Behavioral test suite failed!");
    hasErrors = true;
  } else {
    console.log("\n  ✅ Behavioral test suite 100% Passed!");
  }
} else {
  console.warn("  ⚠️  eval-framework/behavioral-test.js not found. Skipping Phase 3.");
}

// 4. Run Mechanism Test Suite (VERIFICATION.md §2 hook contract, automated)
console.log("\n[Phase 4] Mechanism Test Suite (Claude Code hooks)...");
const mechanismTestPath = path.join(projectRoot, 'eval-framework', 'mechanism-test.js');
if (fs.existsSync(mechanismTestPath)) {
  const mechanismCheck = spawnSync('node', [mechanismTestPath], { stdio: 'inherit', cwd: projectRoot });
  if (mechanismCheck.status !== 0) {
    console.error("\n  ❌ Mechanism test suite failed!");
    hasErrors = true;
  } else {
    console.log("\n  ✅ Mechanism test suite 100% Passed!");
  }
} else {
  console.warn("  ⚠️  eval-framework/mechanism-test.js not found. Skipping Phase 4.");
}

// 5. Final verdict
console.log("\n=================================================");
if (hasErrors) {
  console.error(" ❌ REGRESSION DETECTED! Self-evolution rejected.");
  console.error(" Please fix the errors listed above before persisting changes.");
  console.log("=================================================");
  process.exit(1);
} else {
  console.log(" 🎉 SUCCESS! All self-regression checks passed 100%.");
  console.log(" Dynamic skills and memories are safe to be committed.");
  console.log("=================================================");
  process.exit(0);
}

#!/usr/bin/env node
/**
 * Harness Mechanism Test Suite Runner (Claude Code hook contract)
 *
 * Dynamically discovers and executes all isolated mechanism test files (matching `mechanism-*.test.js`
 * under `eval-framework/`). This allows clean tracking of which mechanism tests are implemented,
 * keeps the test code highly decoupled, and simplifies debugging and adding new test suites.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const evalDir = path.join(projectRoot, 'eval-framework');

console.log('=================================================');
console.log('=== 🔧 Harness Mechanism Test Suite (VERIFICATION.md §2) ===');
console.log('=================================================');

// 1. Discover all test files matching mechanism-*.test.js
const files = fs.readdirSync(evalDir)
  .filter(file => file.startsWith('mechanism-') && file.endsWith('.test.js'))
  .sort(); // Run them in sorting order (2a, 2b, 2c, etc.)

console.log(`\nDiscovered ${files.length} mechanism test suite(s):`);
files.forEach(f => console.log(`  - ${f}`));
console.log('\n-------------------------------------------------');

let failuresCount = 0;
const results = [];

// 2. Execute each test file sequentially
files.forEach(file => {
  const filePath = path.join(evalDir, file);
  console.log(`\n▶️  Running test suite: ${file}`);
  
  const testRun = spawnSync('node', [filePath], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env, CLAUDE: '1' }
  });

  if (testRun.status !== 0) {
    console.error(`❌ Test suite failed: ${file}`);
    failuresCount++;
    results.push({ name: file, status: 'FAILED' });
  } else {
    results.push({ name: file, status: 'PASSED' });
  }
});

// 3. Summarize results
console.log('\n=================================================');
console.log('              Mechanism Test Summary             ');
console.log('=================================================');
results.forEach(res => {
  const icon = res.status === 'PASSED' ? '✅' : '❌';
  console.log(`  ${icon}  ${res.name.padEnd(45)} [${res.status}]`);
});
console.log('-------------------------------------------------');

if (failuresCount > 0) {
  console.error(` ❌ ${failuresCount} mechanism test suite(s) FAILED.`);
  console.log('=================================================');
  process.exit(1);
} else {
  console.log(' 🎉 All VERIFICATION.md §2 mechanism checks passed.');
  console.log('=================================================');
  process.exit(0);
}

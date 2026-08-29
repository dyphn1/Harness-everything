#!/usr/bin/env node
/**
 * Negative Control Tests
 * 
 * Tests that quality gates correctly FAIL on known-bad fixtures.
 * Each gate must have a corresponding negative control that asserts detection works.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, 'eval-framework', 'fixtures');

function runCheck(script, args = []) {
  const result = spawnSync('node', [path.join(ROOT, 'ci', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return result;
}

function copyFixture(fixtureName, targetDir) {
  const src = path.join(FIXTURES_DIR, fixtureName);
  const dest = path.join(ROOT, targetDir);
  
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
}

function removeFixture(targetDir) {
  const dest = path.join(ROOT, targetDir);
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

async function testNegativeControls() {
  console.log('=== Negative Control Tests ===\n');
  
  let passed = 0;
  let total = 0;

  // Test 1: consistency-check fails on bad-frontmatter-colon
  console.log('Test 1: consistency-check fails on unquoted YAML colon...');
  total++;
  copyFixture('bad-frontmatter-colon', 'bad-frontmatter-colon');
  const result1 = runCheck('consistency-check.js');
  removeFixture('bad-frontmatter-colon');
  
  if (result1.status !== 0 && result1.stderr.includes('unquoted colon')) {
    console.log('  ✅ PASS - consistency-check catches unquoted colon');
    passed++;
  } else {
    console.log('  ❌ FAIL - consistency-check did not catch unquoted colon');
    console.log(`     Exit code: ${result1.status}`);
    console.log(`     Stderr: ${result1.stderr}`);
  }

  // Test 2: consistency-check fails on missing delimiter
  console.log('\nTest 2: consistency-check fails on missing delimiter...');
  total++;
  copyFixture('missing-delimiter', 'missing-delimiter');
  const result2 = runCheck('consistency-check.js');
  removeFixture('missing-delimiter');
  
  if (result2.status !== 0 && (result2.stderr.includes('delimiter') || result2.stderr.includes('YAML'))) {
    console.log('  ✅ PASS - consistency-check catches missing delimiter');
    passed++;
  } else {
    console.log('  ❌ FAIL - consistency-check did not catch missing delimiter');
    console.log(`     Exit code: ${result2.status}`);
    console.log(`     Stderr: ${result2.stderr}`);
  }

  // Test 3: description-collision fails on duplicate descriptions
  console.log('\nTest 3: description-collision fails on duplicate descriptions...');
  total++;
  copyFixture('duplicate-desc-skill-a', 'duplicate-desc-skill-a');
  copyFixture('duplicate-desc-skill-b', 'duplicate-desc-skill-b');
  const result3 = runCheck('description-collision.js');
  removeFixture('duplicate-desc-skill-a');
  removeFixture('duplicate-desc-skill-b');
  
  if (result3.status !== 0 && (result3.stdout.includes('COLLISION') || result3.stderr.includes('COLLISION'))) {
    console.log('  ✅ PASS - description-collision catches duplicate descriptions');
    passed++;
  } else {
    console.log('  ❌ FAIL - description-collision did not catch duplicates');
    console.log(`     Exit code: ${result3.status}`);
    console.log(`     Stderr: ${result3.stderr}`);
    console.log(`     Stdout: ${result3.stdout}`);
  }

  // Test 4: consistency-check fails on over-budget skill (token budget gate)
  console.log('\nTest 4: consistency-check fails on over-budget skill...');
  total++;
  copyFixture('over-budget-skill', 'over-budget-skill');
  const result4 = runCheck('consistency-check.js');
  removeFixture('over-budget-skill');
  
  if (result4.status !== 0 && result4.stderr.includes('exceeds hard limit')) {
    console.log('  ✅ PASS - consistency-check catches over-budget skill');
    passed++;
  } else {
    console.log('  ❌ FAIL - consistency-check did not catch over-budget skill');
    console.log(`     Exit code: ${result4.status}`);
    console.log(`     Stderr: ${result4.stderr}`);
    console.log(`     Stdout: ${result4.stdout}`);
  }

  // Test 5: Verify normal repo still passes
  console.log('\nTest 5: Normal repo passes all checks...');
  total++;
  const result5a = runCheck('consistency-check.js');
  const result5b = runCheck('description-collision.js');
  
  if (result5a.status === 0 && result5b.status === 0) {
    console.log('  ✅ PASS - Normal repo passes all checks');
    passed++;
  } else {
    console.log('  ❌ FAIL - Normal repo fails checks');
    console.log(`     consistency-check: ${result5a.status}`);
    console.log(`     description-collision: ${result5b.status}`);
  }

  // Summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`Tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${total - passed}`);
  
  if (passed === total) {
    console.log('\n🎉 ALL NEGATIVE CONTROLS PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ SOME NEGATIVE CONTROLS FAILED');
    process.exit(1);
  }
}

testNegativeControls().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
#!/usr/bin/env node
/**
 * Hook Firing Verification Test
 * 
 * Tests that each opencode plugin hook fires correctly by:
 * 1. Directly invoking each hook with test inputs
 * 2. Verifying expected outputs and state changes
 * 3. Reporting hook fire rate
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOOKS_DIR = path.join(__dirname, 'hooks');
const STATE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.harness-state');

const HOOKS = [
  { name: 'post-edit', file: 'post-edit.js', input: null },
  { name: 'pre-complete', file: 'pre-complete.js', input: null },
  { name: 'circuit-breaker', file: 'circuit-breaker.js', input: 'Error: test failure signature' },
  { name: 'compliance', file: 'compliance.js', input: JSON.stringify({ hook: 'post-edit-verification' }) },
  { name: 'verify', file: 'verify.js', input: null }
];

function cleanState() {
  const files = ['edit-state.json', 'circuit-breaker.json', 'compliance.json'];
  for (const f of files) {
    const p = path.join(STATE_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function runHook(hook, testInput) {
  return new Promise((resolve) => {
    const hookPath = path.join(HOOKS_DIR, hook.file);
    const child = spawn('node', [hookPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let stdout = '';
    let stderr = '';

    if (testInput) {
      child.stdin.write(testInput);
      child.stdin.end();
    }

    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}

function parseOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return { raw: output };
  }
}

async function testHookFiring() {
  console.log('=== Hook Firing Verification Test ===\n');
  
  // Clean state before each test
  cleanState();
  
  let passed = 0;
  let total = 0;

  for (const hook of HOOKS) {
    total++;
    console.log(`Testing ${hook.name}...`);
    
    const result = await runHook(hook, hook.input);
    const parsed = parseOutput(result.stdout);
    
    const success = result.code === 0 || result.code === 1 || result.code === 2;
    const hasHookField = parsed.hook !== undefined;
    
    if (success && hasHookField) {
      console.log(`  ✅ PASS - Hook fired (exit=${result.code}, hook=${parsed.hook})`);
      passed++;
    } else {
      console.log(`  ❌ FAIL - Hook did not fire properly`);
      console.log(`     Exit code: ${result.code}`);
      console.log(`     Stdout: ${result.stdout}`);
      console.log(`     Stderr: ${result.stderr}`);
    }
  }

  // Test circuit breaker trip sequence
  console.log('\n--- Circuit Breaker Sequence Test ---');
  cleanState();
  
  let cbTrips = 0;
  for (let i = 1; i <= 4; i++) {
    const result = await runHook(HOOKS[2], 'Error: repeated failure signature');
    const parsed = parseOutput(result.stdout);
    
    if (result.code === 2) {
      cbTrips++;
      console.log(`  Trip ${i}: ${parsed.action} (${parsed.reason || 'N/A'}) count=${parsed.count}`);
    }
  }
  
  // Now simulate reflection and test hard lock
  const breakerFile = path.join(STATE_DIR, 'circuit-breaker.json');
  if (fs.existsSync(breakerFile)) {
    const breakerState = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
    // Set lastReflection to simulate zoom-out reflection
    breakerState.lastReflection = Date.now();
    fs.writeFileSync(breakerFile, JSON.stringify(breakerState, null, 2));
  }
  
  // 5th trip should hard lock
  const hardLockResult = await runHook(HOOKS[2], 'Error: repeated failure signature');
  const hardLockParsed = parseOutput(hardLockResult.stdout);
  console.log(`  Trip 5 (after reflection): ${hardLockParsed.action} (${hardLockParsed.reason || 'N/A'})`);
  
  if (hardLockResult.code === 2 && hardLockParsed.action === 'hard_lock') {
    console.log('  ✅ Circuit breaker hard-locks after reflection');
    passed++;
  } else {
    console.log('  ❌ Circuit breaker did not hard-lock after reflection');
  }
  total++;

  // Test compliance aggregation
  console.log('\n--- Compliance Aggregation Test ---');
  cleanState();
  
  // Simulate a few events
  await runHook(HOOKS[3], JSON.stringify({ hook: 'post-edit-verification' }));
  await runHook(HOOKS[3], JSON.stringify({ hook: 'pre-complete-verification', action: 'block' }));
  await runHook(HOOKS[3], JSON.stringify({ hook: 'verification-runner', allPassed: true }));
  
  const compResult = await runHook(HOOKS[3], JSON.stringify({ hook: 'circuit-breaker', action: 'force_reflection' }));
  const compParsed = parseOutput(compResult.stdout);
  
  if (compParsed.metrics && compParsed.metrics.totalEdits > 0) {
    console.log('  ✅ Compliance tracking works');
    console.log(`     ${compParsed.message}`);
    passed++;
  } else {
    console.log('  ❌ Compliance tracking failed');
    console.log(`     Output: ${compResult.stdout}`);
  }
  total++;

  // Test verification runner
  console.log('\n--- Verification Runner Test ---');
  cleanState();
  // First do an edit to set pending state
  await runHook(HOOKS[0]);
  // Then run verification
  const verifyResult = await runHook(HOOKS[4]);
  const verifyParsed = parseOutput(verifyResult.stdout);
  
  if (verifyParsed.hook === 'verification-runner') {
    console.log('  ✅ Verification runner fires');
    console.log(`     Result: ${verifyParsed.message}`);
    passed++;
  } else {
    console.log('  ❌ Verification runner failed');
    console.log(`     Output: ${verifyResult.stdout}`);
  }
  total++;

  // Summary
  const rate = (passed / total * 100).toFixed(1);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Hooks tested: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Fire rate: ${rate}%`);
  
  if (rate >= 95) {
    console.log('\n🎉 HOOK FIRING VERIFICATION PASSED (≥95%)');
    process.exit(0);
  } else {
    console.log('\n❌ HOOK FIRING VERIFICATION FAILED (<95%)');
    process.exit(1);
  }
}

testHookFiring().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
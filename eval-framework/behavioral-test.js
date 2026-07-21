#!/usr/bin/env node
/**
 * Harness Behavioral Test Suite (E2E)
 * Simulates an AI agent attempting both valid and invalid state transitions
 * to mathematically prove the guardrails (Exit Code 1) are enforced.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log("=== 🧪 Harness Behavioral Test Suite ===");

const todoCli = 'node harness-everything/scripts/todo-cli.js';
const stateFile = path.join(process.cwd(), '.harness', 'todo-state.json');

function run(cmd, expectFail = false) {
  try {
    const out = execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
    if (expectFail) {
      console.error(`❌ FAILED: Expected command to fail, but it succeeded: ${cmd}`);
      process.exit(1);
    }
    return out;
  } catch (err) {
    if (!expectFail) {
      console.error(`❌ FAILED: Unexpected failure: ${cmd}\n${err.stderr || err.message}`);
      process.exit(1);
    }
    return err.stderr || err.stdout || err.message;
  }
}

// 0. Setup: Clean slate
if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
if (fs.existsSync('.verify-fail.tmp')) fs.unlinkSync('.verify-fail.tmp');
console.log("🧹 State cleaned.");

// 1. Initialize
console.log("\n[Test 1] Agent initializes checklist...");
run(`${todoCli} init "Setup DB" "Create API"`);
console.log("✅ Passed: List initialized.");

// 2. Premature Completion (Skipping 'start')
console.log("\n[Test 2] Agent hallucinates completion without starting...");
const res2 = run(`${todoCli} complete 1`, true);
if (!res2.includes("NOT currently in-progress")) {
  console.error("❌ FAILED: Did not catch premature completion.");
  process.exit(1);
}
console.log("✅ Passed: Blocked premature completion (Exit Code 1).");

// 3. Start Task
console.log("\n[Test 3] Agent starts task 1...");
run(`${todoCli} start 1`);
console.log("✅ Passed: Task 1 started.");

// 4. Multitasking (Attention Loss)
console.log("\n[Test 4] Agent loses attention and tries to start Task 2 concurrently...");
const res4 = run(`${todoCli} start 2`, true);
if (!res4.includes("already IN-PROGRESS")) {
  console.error("❌ FAILED: Did not block multitasking.");
  process.exit(1);
}
console.log("✅ Passed: Blocked multitasking (Exit Code 1).");

// 5. Verification Failure (Compliance Theater)
console.log("\n[Test 5] Agent writes broken code and tries to force complete...");
fs.writeFileSync('.verify-fail.tmp', 'broken');
const res5 = run(`${todoCli} complete 1`, true);
if (!res5.includes("Verification Gate Failed")) {
  console.error("❌ FAILED: Verification gate failed to block completion.");
  process.exit(1);
}
console.log("✅ Passed: Gate blocked completion and slapped agent (Exit Code 1).");

// 6. Successful Verification and Completion
console.log("\n[Test 6] Agent fixes code, verification passes, completes task...");
fs.unlinkSync('.verify-fail.tmp'); // Fix the "bug"
run(`${todoCli} complete 1`);
console.log("✅ Passed: Task 1 completed successfully.");

console.log("\n🎉 ALL BEHAVIORAL TESTS PASSED. Guardrails are mathematically enforced.");

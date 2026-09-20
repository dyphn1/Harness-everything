#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

echo "================================================="
echo "   Harness OS - Comprehensive Docker Verification   "
echo "================================================="

# 1. Prepare Git Environment (Subagent Scope Guard depends on Git)
echo -e "\n[Step 1] Initializing local Git repository for tests..."
if [ ! -d ".git" ]; then
  git init
  git config --global user.email "test@test.com"
  git config --global user.name "Test Bot"
  git add -A
  git commit -m "initial commit for test"
  echo "Git repository initialized and committed."
else
  echo "Git repository already exists."
fi

# 2. Run Self-Regression Test Suite
echo -e "\n[Step 2] Running Harness Self-Regression tests..."
npm test

# 3. Mechanism Checks (from VERIFICATION.md Section 2)
echo -e "\n[Step 3] Running Mechanism Checks..."

# 3a. Rule of 3 Circuit Breaker actually blocks
# Runtime state is resolved once through the same workspace-keyed helper used by
# the hooks. Invocations with no session_id use the fixed default session.
STATE_DIR=$(node -e "process.stdout.write(require('./hooks/scripts/lib/harness-state').getSessionDir(null, 'default'))")
echo -e "\n---> Running 3a: Rule of 3 Circuit Breaker"
rm -f "$STATE_DIR/zoom-out-report.md"
echo '{"count":3,"lastHash":"verify-test","zoomOutResolved":false}' > "$STATE_DIR/rule-of-3-state.json"

# We expect this to exit with 2 and print CRITICAL trigger message
set +e
node hooks/scripts/rule-of-3.js 2>rule-of-3-err.log
EXIT_CODE=$?
set -e

echo "Exit code: $EXIT_CODE"
if [ "$EXIT_CODE" -ne 2 ]; then
  echo "❌ FAIL: Rule of 3 did not exit with code 2 (got $EXIT_CODE)"
  exit 1
fi

if ! grep -q "RULE OF 3 CIRCUIT BREAKER TRIGGERED" rule-of-3-err.log; then
  echo "❌ FAIL: Rule of 3 error output did not contain trigger message"
  cat rule-of-3-err.log
  exit 1
fi
echo "✅ PASS: Rule of 3 blocked successfully with exit code 2 and correct message."

# Reset Rule of 3
echo "Resetting circuit breaker..."
npm run harness:reset
set +e
node hooks/scripts/rule-of-3.js
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ FAIL: Rule of 3 reset check failed (expected 0, got $EXIT_CODE)"
  exit 1
fi
echo "✅ PASS: Rule of 3 reset check passed."

# 3a-bis. Zoom-out reflection report releases the breaker (self-recovery path)
echo -e "\n---> Running 3a-bis: Zoom-out report releases the breaker"
echo '{"count":3,"lastHash":"verify-test","zoomOutResolved":false,"lastFailureAt":0,"zoomOutCycles":0}' > "$STATE_DIR/rule-of-3-state.json"
printf '## Goal\nx\n## Failed Attempts\nx\n## Verified Facts\nx\n## Diagnosis\nx\n## Decision\nRESUME: new approach\n' > "$STATE_DIR/zoom-out-report.md"

set +e
node hooks/scripts/rule-of-3.js
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ FAIL: Valid reflection report did not release the breaker (expected 0, got $EXIT_CODE)"
  exit 1
fi
if ! node -e "const s=require(process.argv[1]); process.exit(s.count===0 && s.zoomOutResolved===true && s.zoomOutCycles===1 ? 0 : 1)" "$STATE_DIR/rule-of-3-state.json"; then
  echo "❌ FAIL: Breaker state not updated after report release"
  cat "$STATE_DIR/rule-of-3-state.json"
  exit 1
fi
echo "✅ PASS: Valid reflection report released the breaker (self-recovery)."

# 3a-ter. Re-trip: three more failures on the same signature after a released
# cycle ask for ANOTHER zoom-out. #190 retired the second-stage escalation, so
# the contract is exit 2 plus the reflection-required message the hook actually
# prints - never a permanent lock (ci/mechanism-2a-rule-of-3.test.js:58-64).
echo -e "\n---> Running 3a-ter: Re-trip requests another zoom-out"
# Seed through the hooks' own resolver in the already resolved workspace-keyed
# state root.
RETRIP_AT=$(node -e "process.stdout.write(String(Date.now()))")
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({count:3,lastHash:'verify-test',zoomOutResolved:false,lastFailureAt:Number(process.argv[2]),zoomOutCycles:1}))" "$STATE_DIR/rule-of-3-state.json" "$RETRIP_AT"
set +e
node hooks/scripts/rule-of-3.js 2>rule-of-3-err.log
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 2 ]; then
  echo "❌ FAIL: Re-trip did not request another zoom-out (expected 2, got $EXIT_CODE)"
  cat rule-of-3-err.log
  exit 1
fi
if ! grep -q "RULE OF 3 CIRCUIT BREAKER TRIGGERED" rule-of-3-err.log; then
  echo "❌ FAIL: Re-trip output did not contain the circuit-breaker trigger message"
  cat rule-of-3-err.log
  exit 1
fi
if ! grep -q "ACTION REQUIRED (reflect first)" rule-of-3-err.log; then
  echo "❌ FAIL: Re-trip output did not demand reflection"
  cat rule-of-3-err.log
  exit 1
fi
# Negative guard: the retired escalation wording must never come back (#190).
if grep -qi "hard lock" rule-of-3-err.log; then # this must never match
  echo "❌ FAIL: Re-trip printed the retired hard-lock escalation, which no longer exists"
  cat rule-of-3-err.log
  exit 1
fi
echo "✅ PASS: Re-trip asked for another zoom-out, with no retired escalation wording."

# A fresh report, written after the re-trip failure, releases the breaker again.
printf '## Goal\nx\n## Failed Attempts\nx\n## Verified Facts\nx\n## Diagnosis\nx\n## Decision\nRESUME: second untried approach\n' > "$STATE_DIR/zoom-out-report.md"
set +e
node hooks/scripts/rule-of-3.js
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ FAIL: Fresh reflection report did not release the re-tripped breaker (expected 0, got $EXIT_CODE)"
  exit 1
fi
if ! node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(s.count===0 && s.zoomOutResolved===true && s.zoomOutCycles===2 ? 0 : 1)" "$STATE_DIR/rule-of-3-state.json"; then
  echo "❌ FAIL: Breaker state not updated after the second report release"
  cat "$STATE_DIR/rule-of-3-state.json"
  exit 1
fi
echo "✅ PASS: A fresh report released the re-tripped breaker (advisory re-trip, not an escalation)."

# harness:reset stays an optional manual clear, not a required escalation step.
npm run harness:reset


# 3b. Boundary Guard blocks oversized read
echo -e "\n---> Running 3b: Boundary Guard Oversized Read"
node -e "require('fs').writeFileSync('.verify-big.tmp','x'.repeat(600*1024))"

set +e
echo '{"tool_name":"Read","tool_input":{"file_path":".verify-big.tmp"}}' | node hooks/scripts/boundary-guard.js 2>boundary-guard-err.log
EXIT_CODE=$?
set -e

rm -f .verify-big.tmp

echo "Exit code: $EXIT_CODE"
if [ "$EXIT_CODE" -ne 2 ]; then
  echo "❌ FAIL: Boundary Guard did not exit with code 2 (got $EXIT_CODE)"
  exit 1
fi

if ! grep -q "BLOCKED" boundary-guard-err.log; then
  echo "❌ FAIL: Boundary Guard error output did not contain BLOCKED"
  cat boundary-guard-err.log
  exit 1
fi
echo "✅ PASS: Boundary Guard blocked large read successfully."


# 3c. State persistence (WAL) records failure and handles clear
echo -e "\n---> Running 3c: State persistence (WAL)"
rm -f "$STATE_DIR/handoff-state.json"

# Record failure
echo '{"tool_name":"Bash","tool_response":{"stdout":"","stderr":"npm ERR! verify-test failure"}}' | node hooks/scripts/state-persist.js

if [ ! -f "$STATE_DIR/handoff-state.json" ]; then
  echo "❌ FAIL: handoff-state.json was not created"
  exit 1
fi

STATUS=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).status)" "$STATE_DIR/handoff-state.json")
if [ "$STATUS" != "failed" ]; then
  echo "❌ FAIL: Expected status to be 'failed', got '$STATUS'"
  exit 1
fi

# Bootstrap output verification (pipe {} explicitly - bootstrap.js reads a
# session_id off stdin same as every other hook, and a bare invocation's
# stdin isn't guaranteed to close on its own in a non-interactive shell)
BOOTSTRAP_OUT=$(echo '{}' | node harness-everything/scripts/bootstrap.js)
if ! echo "$BOOTSTRAP_OUT" | grep -q "Harness OS - Handoff Checkpoint"; then
  echo "❌ FAIL: Bootstrap output did not show handoff checkpoint box"
  echo "$BOOTSTRAP_OUT"
  exit 1
fi
echo "✅ PASS: State persistence correctly saved failure status."

# Clean run to clear WAL
echo '{"tool_name":"Bash","tool_response":{"stdout":"ok","exitCode":0}}' | node hooks/scripts/state-persist.js
BOOTSTRAP_OUT_CLEAN=$(echo '{}' | node harness-everything/scripts/bootstrap.js)
if echo "$BOOTSTRAP_OUT_CLEAN" | grep -q "Harness OS - Handoff Checkpoint"; then
  echo "❌ FAIL: Bootstrap output still showed checkpoint box after clean run"
  exit 1
fi
echo "✅ PASS: State persistence correctly cleared status on successful execution."


# 3d. Fact-audit reminder reaches agent via stdin JSON
echo -e "\n---> Running 3d: Fact-audit reminder"
ROUTER_OUT=$(echo '{"prompt":"what exit code does this hook use by default and is it documented"}' | node harness-everything/scripts/tier-router.js)

if ! echo "$ROUTER_OUT" | grep -q "FACT-AUDIT REMINDER"; then
  echo "❌ FAIL: tier-router did not output FACT-AUDIT REMINDER on stdin JSON"
  echo "$ROUTER_OUT"
  exit 1
fi
echo "✅ PASS: Fact-audit reminder successfully outputted."


# 3e. Subagent scope guard catches out-of-scope change
echo -e "\n---> Running 3e: Subagent scope guard"
# PreToolUse
echo '{"tool_name":"Task","hook_event_name":"PreToolUse","tool_input":{}}' | node hooks/scripts/subagent-scope-guard.js

# Make unexpected modification
echo "unexpected change" >> .verify-scope-test.tmp

# PostToolUse expect exit 2
set +e
echo '{"tool_name":"Task","hook_event_name":"PostToolUse","tool_input":{}}' | node hooks/scripts/subagent-scope-guard.js 2>scope-guard-err.log
EXIT_CODE=$?
set -e

rm -f .verify-scope-test.tmp

echo "Exit code: $EXIT_CODE"
if [ "$EXIT_CODE" -ne 2 ]; then
  echo "❌ FAIL: Subagent scope guard did not block out-of-scope changes (expected exit code 2, got $EXIT_CODE)"
  exit 1
fi

if ! grep -q "Subagent Scope Guard" scope-guard-err.log || ! grep -q ".verify-scope-test.tmp" scope-guard-err.log; then
  echo "❌ FAIL: Scope guard did not report the unexpected changed file"
  cat scope-guard-err.log
  exit 1
fi
echo "✅ PASS: Subagent scope guard successfully blocked out-of-scope modifications."


# 3f. Stop gate bounces an unverified-edit stop exactly once
echo -e "\n---> Running 3f: Stop Gate"
rm -f "$STATE_DIR/stop-gate-state.json"
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({status:'idle',lastEditAt:Date.now(),lastVerifyAt:0}))" "$STATE_DIR/handoff-state.json"
echo "dirty" > .verify-dirty.tmp

set +e
echo '{}' | node hooks/scripts/stop-gate.js 2>stop-gate-err.log
EXIT_CODE=$?
set -e
echo "Exit code: $EXIT_CODE"
if [ "$EXIT_CODE" -ne 2 ]; then
  echo "❌ FAIL: Stop gate did not bounce an unverified-edit stop (expected 2, got $EXIT_CODE)"
  cat stop-gate-err.log
  exit 1
fi
if ! grep -q "Stop Gate" stop-gate-err.log; then
  echo "❌ FAIL: Stop gate output did not contain its message"
  cat stop-gate-err.log
  exit 1
fi

# Same edit batch must not bounce twice
set +e
echo '{}' | node hooks/scripts/stop-gate.js
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ FAIL: Stop gate bounced the same edit batch twice (expected 0, got $EXIT_CODE)"
  exit 1
fi

# Loop guard: stop_hook_active always passes
rm -f "$STATE_DIR/stop-gate-state.json"
set +e
echo '{"stop_hook_active":true}' | node hooks/scripts/stop-gate.js
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ FAIL: Stop gate blocked despite stop_hook_active (expected 0, got $EXIT_CODE)"
  exit 1
fi
rm -f .verify-dirty.tmp "$STATE_DIR/handoff-state.json" "$STATE_DIR/stop-gate-state.json"
echo "✅ PASS: Stop gate bounced once, then respected the batch and loop guards."

# Clean up temporary test output logs
rm -f rule-of-3-err.log boundary-guard-err.log scope-guard-err.log stop-gate-err.log

echo -e "\n================================================="
echo " 🎉 ALL HARNESS MECHANISM CHECKS PASSED SUCCESSFULLY!"
echo "================================================="

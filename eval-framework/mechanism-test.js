#!/usr/bin/env node
/**
 * Harness Mechanism Test Suite (Claude Code hook contract)
 * Automates VERIFICATION.md Section 2 (mechanism check) so it runs on every
 * `npm test` instead of only when a human copy-pastes the recipes by hand.
 * That manual gap is exactly what let three independent 2026-07-23 audit
 * reports (see docs/reports/) misdiagnose working hooks as broken: they
 * piped JSON via `echo '...' | node script.js` in a Windows Git Bash shell,
 * which mangles stdin/TTY state and produced false negatives. This suite
 * uses execSync's `input` option instead (the same technique already proven
 * reliable in runner.js and behavioral-test.js) so it is a faithful,
 * cross-platform re-run of the exact payloads VERIFICATION.md documents.
 *
 * Each hook resolves its state directory via detectActivePlatform(), which
 * defaults to 'copilot' under a VS Code integrated terminal (TERM_PROGRAM=
 * vscode) unless CLAUDE is set - so every child process below is spawned
 * with CLAUDE=1 to force the Claude Code state path regardless of the host
 * running this test.
 *
 * All state is written under a dedicated, never-real session id so this
 * suite can never collide with or clobber an actual Claude Code session's
 * breaker/handoff state. The session directory (and any repo-root temp
 * files created along the way) is removed on exit, success or failure alike.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.env.CLAUDE = '1'; // so our own getSessionDir() calls resolve like the children's will

const { getWorkspaceRoot, getSessionDir } = require('../hooks/scripts/lib/harness-state');

const root = getWorkspaceRoot();
const hooksDir = path.join(root, 'hooks', 'scripts');
const SESSION_ID = '__mechanism_test__';
const sessionDir = getSessionDir(root, SESSION_ID);

console.log('=== 🔧 Harness Mechanism Test Suite (VERIFICATION.md §2) ===');

const tempFiles = [];
let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`✅ ${name}`);
  } else {
    console.error(`❌ ${name}`);
    if (detail) console.error(`   ${detail}`);
    failures++;
  }
}

function runHook(scriptName, payload, extraEnv) {
  const scriptPath = path.join(hooksDir, scriptName);
  try {
    const stdout = execSync(`node "${scriptPath}"`, {
      encoding: 'utf8',
      input: payload === null ? '' : JSON.stringify(payload),
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function writeState(file, obj) {
  fs.writeFileSync(path.join(sessionDir, file), JSON.stringify(obj, null, 2), 'utf8');
}
function readState(file) {
  return JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'));
}
function stateExists(file) {
  return fs.existsSync(path.join(sessionDir, file));
}

// Registers a repo-root temp file for guaranteed cleanup even if an
// assertion throws or the process is killed mid-suite.
function tempFile(name) {
  const p = path.join(root, name);
  tempFiles.push(p);
  return p;
}

process.on('exit', () => {
  for (const f of tempFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* best-effort */ }
  }
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
});

// ---------------------------------------------------------------------------
// 2a. Rule of 3 circuit breaker trips, releases via zoom-out report, and
//     hard-locks on a repeat trip of the same signature.
// ---------------------------------------------------------------------------
console.log('\n[2a] Rule of 3 circuit breaker...');

writeState('rule-of-3-state.json', { count: 3, lastHash: 'mech-test', zoomOutResolved: false });
const tripResult = runHook('rule-of-3.js', { session_id: SESSION_ID });
check(
  '2a. Trips at count=3 (exit=2, CRITICAL banner)',
  tripResult.code === 2 && tripResult.stderr.includes('RULE OF 3 CIRCUIT BREAKER TRIGGERED'),
  `Got exit=${tripResult.code}, stderr="${tripResult.stderr.slice(0, 200)}"`
);

writeState('rule-of-3-state.json', {
  count: 3, lastHash: 'mech-test', zoomOutResolved: false, lastFailureAt: 0, zoomOutCycles: 0,
});
fs.writeFileSync(
  path.join(sessionDir, 'zoom-out-report.md'),
  '## Goal\nx\n## Failed Attempts\nx\n## Verified Facts\nx\n## Diagnosis\nx\n## Decision\nRESUME: new approach\n',
  'utf8'
);
const releaseResult = runHook('rule-of-3.js', { session_id: SESSION_ID });
const releasedState = readState('rule-of-3-state.json');
check(
  '2a-bis. Valid zoom-out report releases the breaker (exit=0, count reset)',
  releaseResult.code === 0 &&
    releaseResult.stdout.includes('breaker released') &&
    releasedState.count === 0 &&
    releasedState.zoomOutResolved === true &&
    releasedState.zoomOutCycles === 1,
  `Got exit=${releaseResult.code}, state=${JSON.stringify(releasedState)}`
);

writeState('rule-of-3-state.json', {
  count: 3, lastHash: 'mech-test', zoomOutResolved: false,
  lastFailureAt: Date.now() + 60000, zoomOutCycles: 1,
});
const hardLockResult = runHook('rule-of-3.js', { session_id: SESSION_ID });
check(
  '2a-ter. Second trip on same signature hard-locks (exit=2, repeat trip)',
  hardLockResult.code === 2 && hardLockResult.stderr.includes('repeat trip - hard lock'),
  `Got exit=${hardLockResult.code}, stderr="${hardLockResult.stderr.slice(0, 200)}"`
);

// ---------------------------------------------------------------------------
// 2b. Boundary guard blocks an oversized Read
// ---------------------------------------------------------------------------
console.log('\n[2b] Boundary guard...');

const bigFile = tempFile('.mechanism-test-big.tmp');
fs.writeFileSync(bigFile, 'x'.repeat(600 * 1024));
const boundaryResult = runHook('boundary-guard.js', { tool_name: 'Read', tool_input: { file_path: bigFile } });
check(
  '2b. Blocks a 600KB Read without limit/offset (exit=2, BLOCKED)',
  boundaryResult.code === 2 && boundaryResult.stderr.includes('[Boundary Guard] BLOCKED'),
  `Got exit=${boundaryResult.code}, stderr="${boundaryResult.stderr.slice(0, 200)}"`
);
fs.unlinkSync(bigFile);

// ---------------------------------------------------------------------------
// 2c. State persistence (WAL) records a failure, then clears it on success
// ---------------------------------------------------------------------------
console.log('\n[2c] State persistence (WAL)...');

runHook('state-persist.js', {
  session_id: SESSION_ID,
  tool_name: 'Bash',
  tool_response: { stdout: '', stderr: 'npm ERR! mech-test failure' },
});
const failedHandoff = readState('handoff-state.json');
check(
  '2c. Failing Bash call is recorded as status=failed',
  failedHandoff.status === 'failed' && failedHandoff.errorSummary.includes('mech-test failure'),
  `Got ${JSON.stringify(failedHandoff)}`
);

runHook('state-persist.js', {
  session_id: SESSION_ID,
  tool_name: 'Bash',
  tool_response: { stdout: 'ok', exitCode: 0 },
});
const resolvedHandoff = readState('handoff-state.json');
check(
  '2c. A subsequent successful command clears status back to idle',
  resolvedHandoff.status === 'idle' && !!resolvedHandoff.lastResolved,
  `Got ${JSON.stringify(resolvedHandoff)}`
);

// ---------------------------------------------------------------------------
// 2d. Fact-audit reminder reaches the agent via tier-router.js stdin
// ---------------------------------------------------------------------------
console.log('\n[2d] Fact-audit reminder...');

const tierRouterPath = path.join(root, 'harness-everything', 'scripts', 'tier-router.js');
const factAuditOut = execSync(`node "${tierRouterPath}"`, {
  encoding: 'utf8',
  input: JSON.stringify({ prompt: 'what exit code does this hook use by default and is it documented' }),
});
check(
  '2d. tier-router.js reads {"prompt":...} from stdin and emits FACT-AUDIT REMINDER',
  factAuditOut.includes('FACT-AUDIT REMINDER'),
  `Output was:\n${factAuditOut.slice(0, 300)}`
);

// ---------------------------------------------------------------------------
// 2e. Subagent scope guard catches an out-of-scope file change
// ---------------------------------------------------------------------------
console.log('\n[2e] Subagent scope guard...');

runHook('subagent-scope-guard.js', {
  session_id: SESSION_ID, tool_name: 'Task', hook_event_name: 'PreToolUse', tool_input: {},
});
const scopeFile = tempFile('.mechanism-test-scope.tmp');
fs.writeFileSync(scopeFile, 'unexpected change');
const scopeResult = runHook('subagent-scope-guard.js', {
  session_id: SESSION_ID, tool_name: 'Task', hook_event_name: 'PostToolUse', tool_input: {},
});
check(
  '2e. Flags the newly-created file after a Task burst (exit=2, lists filename)',
  scopeResult.code === 2 &&
    scopeResult.stderr.includes('Subagent Scope Guard') &&
    scopeResult.stderr.includes(path.basename(scopeFile)),
  `Got exit=${scopeResult.code}, stderr="${scopeResult.stderr.slice(0, 300)}"`
);
fs.unlinkSync(scopeFile);

// ---------------------------------------------------------------------------
// 2f. Stop gate bounces an unverified-edit stop exactly once
// ---------------------------------------------------------------------------
console.log('\n[2f] Stop gate...');

writeState('handoff-state.json', { status: 'idle', lastEditAt: Date.now(), lastVerifyAt: 0 });
const dirtyFile = tempFile('.mechanism-test-dirty.tmp');
fs.writeFileSync(dirtyFile, 'dirty');
const firstStop = runHook('stop-gate.js', { session_id: SESSION_ID });
check(
  '2f. First stop after an unverified edit bounces (exit=2)',
  firstStop.code === 2 && firstStop.stderr.includes('[Stop Gate]'),
  `Got exit=${firstStop.code}, stderr="${firstStop.stderr.slice(0, 200)}"`
);
const secondStop = runHook('stop-gate.js', { session_id: SESSION_ID });
check(
  '2f. Same edit batch does not bounce twice (exit=0)',
  secondStop.code === 0,
  `Got exit=${secondStop.code}`
);
fs.unlinkSync(dirtyFile);

// ---------------------------------------------------------------------------
console.log('\n=================================================');
if (failures > 0) {
  console.error(` ❌ ${failures} mechanism check(s) FAILED.`);
  console.log('=================================================');
  process.exit(1);
} else {
  console.log(' 🎉 All VERIFICATION.md §2 mechanism checks passed.');
  console.log('=================================================');
  process.exit(0);
}

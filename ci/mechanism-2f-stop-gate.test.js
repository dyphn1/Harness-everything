const fs = require('fs');
const helper = require('./test-helper');

console.log('\n[2f] Stop gate...');

helper.writeState('handoff-state.json', { status: 'idle', lastEditAt: Date.now(), lastVerifyAt: 0 });
const dirtyFile = helper.tempFile('.mechanism-test-dirty.tmp');
fs.writeFileSync(dirtyFile, 'dirty');
const firstStop = helper.runHook('stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. First stop after an unverified edit bounces (exit=2)',
  firstStop.code === 2 && firstStop.stderr.includes('[Stop Gate]'),
  `Got exit=${firstStop.code}, stderr="${firstStop.stderr.slice(0, 200)}"`
);
const secondStop = helper.runHook('stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. Same edit batch does not bounce twice (exit=0)',
  secondStop.code === 0,
  `Got exit=${secondStop.code}`
);
fs.unlinkSync(dirtyFile);

console.log('\n[2f] workflow-stop-gate (iterative-single) verification signal...');

const now = Date.now();

// Bug reproduction (issue #153): a verify-classified command that genuinely
// succeeded but whose host never reported a numeric exit code (observed on
// at least one live host - state-persist.js writes lastVerifyExitCode: null
// for any non-failing command when the PostToolUse payload has no numeric
// exitCode) must not be treated as unverified.
helper.writeState('workflow-run.json', {
  schemaVersion: 1, sessionId: helper.SESSION_ID, strategy: 'iterative-single',
  state: 'running', lastMutationAt: now - 5000,
});
helper.writeState('handoff-state.json', {
  status: 'idle', lastEditAt: now - 5000, lastVerifyAt: now, lastVerifyExitCode: null,
});
const hostExitCodeUnavailable = helper.runHook('workflow-stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. workflow-stop-gate resolves when verify ran after edit even without a numeric exit code',
  hostExitCodeUnavailable.code === 0 && helper.readState('workflow-run.json').state === 'satisfied',
  `Got exit=${hostExitCodeUnavailable.code}, stderr="${hostExitCodeUnavailable.stderr.slice(0, 300)}"`
);

// Regression guard: explicit exit 0 (host does report it) must still resolve.
helper.writeState('workflow-run.json', {
  schemaVersion: 1, sessionId: helper.SESSION_ID, strategy: 'iterative-single',
  state: 'running', lastMutationAt: now - 5000,
});
helper.writeState('handoff-state.json', {
  status: 'idle', lastEditAt: now - 5000, lastVerifyAt: now, lastVerifyExitCode: 0,
});
const hostExitCodeReported = helper.runHook('workflow-stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. workflow-stop-gate still resolves when the host does report exit code 0',
  hostExitCodeReported.code === 0 && helper.readState('workflow-run.json').state === 'satisfied',
  `Got exit=${hostExitCodeReported.code}`
);

// Negative control: no verification ran after the edit at all -> stays blocked.
helper.writeState('workflow-run.json', {
  schemaVersion: 1, sessionId: helper.SESSION_ID, strategy: 'iterative-single',
  state: 'running', lastMutationAt: now,
});
helper.writeState('handoff-state.json', {
  status: 'idle', lastEditAt: now, lastVerifyAt: now - 5000, lastVerifyExitCode: null,
});
const staleVerify = helper.runHook('workflow-stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. workflow-stop-gate still blocks when no verification ran after the edit',
  staleVerify.code === 2 && staleVerify.stderr.includes('verification-after-edit-missing'),
  `Got exit=${staleVerify.code}, stderr="${staleVerify.stderr.slice(0, 300)}"`
);

helper.finish();

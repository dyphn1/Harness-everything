const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2a] Rule of 3 circuit breaker...');

const hooksConfig = JSON.parse(
  fs.readFileSync(path.join(helper.root, 'hooks', 'hooks.json'), 'utf8')
);
const failureTrackerHook = (hooksConfig.hooks.PostToolUseFailure || [])
  .find(entry => entry.id === 'harness:post-failure:rule-of-3-tracker');
helper.check(
  '2a-claude-wiring. PostToolUseFailure invokes the Rule-of-3 tracker',
  failureTrackerHook &&
    failureTrackerHook.matcher === 'Bash|PowerShell' &&
    failureTrackerHook.hooks?.some(hook => hook.command.includes('rule-of-3-tracker.js')),
  `Hook=${JSON.stringify(failureTrackerHook)}`
);

const claudeFailurePayload = {
  hook_event_name: 'PostToolUseFailure',
  tool_name: 'Bash',
  tool_input: { command: 'node -e "process.exit(1)"' },
  error: 'Exit code 1\ncommand failed',
  session_id: helper.SESSION_ID,
};
const failureRuns = [1, 2, 3].map(() =>
  helper.runHook('rule-of-3-tracker.js', claudeFailurePayload)
);
const trackedFailureState = helper.readState('rule-of-3-state.json');
helper.check(
  '2a-claude-failure. PostToolUseFailure error payload increments the same signature to threshold',
  failureRuns.every(result => result.code === 0) &&
    trackedFailureState.count === 3 &&
    trackedFailureState.threshold === 3 &&
    trackedFailureState.lastHash &&
    trackedFailureState.zoomOutResolved === false,
  `Runs=${JSON.stringify(failureRuns)}, state=${JSON.stringify(trackedFailureState)}`
);

const claudeTripResult = helper.runHook('rule-of-3.js', {
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo retry' },
  session_id: helper.SESSION_ID,
});
helper.check(
  '2a-claude-trip. Tracked Claude failures block the next mutation',
  claudeTripResult.code === 2 &&
    claudeTripResult.stderr.includes('RULE OF 3 CIRCUIT BREAKER TRIGGERED'),
  `Got exit=${claudeTripResult.code}, stderr="${claudeTripResult.stderr.slice(0, 200)}"`
);

const successResult = helper.runHook('rule-of-3-tracker.js', {
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo success' },
  tool_response: { stdout: 'success', stderr: '', exitCode: 0 },
  session_id: helper.SESSION_ID,
});
const resetState = helper.readState('rule-of-3-state.json');
helper.check(
  '2a-claude-success. Confirmed PostToolUse success keeps the existing reset behavior',
  successResult.code === 0 &&
    resetState.count === 0 &&
    resetState.zoomOutResolved === true &&
    resetState.zoomOutCycles === 0,
  `Got exit=${successResult.code}, state=${JSON.stringify(resetState)}`
);

helper.writeState('rule-of-3-state.json', { count: 3, lastHash: 'mech-test', zoomOutResolved: false });
const tripResult = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
helper.check(
  '2a. Trips at count=3 (exit=2, CRITICAL banner)',
  tripResult.code === 2 && tripResult.stderr.includes('RULE OF 3 CIRCUIT BREAKER TRIGGERED'),
  `Got exit=${tripResult.code}, stderr="${tripResult.stderr.slice(0, 200)}"`
);

helper.writeState('rule-of-3-state.json', {
  count: 3, lastHash: 'mech-test', zoomOutResolved: false, lastFailureAt: 0, zoomOutCycles: 0,
});
fs.writeFileSync(
  path.join(helper.sessionDir, 'zoom-out-report.md'),
  '## Goal\nx\n## Failed Attempts\nx\n## Verified Facts\nx\n## Diagnosis\nx\n## Decision\nRESUME: new approach\n',
  'utf8'
);
const releaseResult = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
const releasedState = helper.readState('rule-of-3-state.json');
helper.check(
  '2a-bis. Valid zoom-out report releases the breaker (exit=0, count reset)',
  releaseResult.code === 0 &&
    releaseResult.stdout.includes('breaker released') &&
    releasedState.count === 0 &&
    releasedState.zoomOutResolved === true &&
    releasedState.zoomOutCycles === 1,
  `Got exit=${releaseResult.code}, state=${JSON.stringify(releasedState)}`
);

helper.writeState('rule-of-3-state.json', {
  count: 3, lastHash: 'mech-test', zoomOutResolved: false,
  lastFailureAt: Date.now() + 60000, zoomOutCycles: 1,
});
const hardLockResult = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
helper.check(
  '2a-ter. Second trip on same signature hard-locks (exit=2, repeat trip)',
  hardLockResult.code === 2 && hardLockResult.stderr.includes('repeat trip - hard lock'),
  `Got exit=${hardLockResult.code}, stderr="${hardLockResult.stderr.slice(0, 200)}"`
);

helper.finish();

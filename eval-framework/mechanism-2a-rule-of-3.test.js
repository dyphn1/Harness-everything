const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2a] Rule of 3 circuit breaker...');

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

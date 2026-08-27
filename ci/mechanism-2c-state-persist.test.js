const helper = require('./test-helper');

console.log('\n[2c] State persistence (WAL)...');

helper.runHook('state-persist.js', {
  session_id: helper.SESSION_ID,
  tool_name: 'Bash',
  tool_response: { stdout: '', stderr: 'npm ERR! mech-test failure' },
});
const failedHandoff = helper.readState('handoff-state.json');
helper.check(
  '2c. Failing Bash call is recorded as status=failed',
  failedHandoff.status === 'failed' && failedHandoff.errorSummary.includes('mech-test failure'),
  `Got ${JSON.stringify(failedHandoff)}`
);

helper.runHook('state-persist.js', {
  session_id: helper.SESSION_ID,
  tool_name: 'Bash',
  tool_response: { stdout: 'ok', exitCode: 0 },
});
const resolvedHandoff = helper.readState('handoff-state.json');
helper.check(
  '2c. A subsequent successful command clears status back to idle',
  resolvedHandoff.status === 'idle' && !!resolvedHandoff.lastResolved,
  `Got ${JSON.stringify(resolvedHandoff)}`
);

helper.finish();

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
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_response: {
    stdout: 'ok',
    stderr: 'warning: successful command emitted diagnostic text',
  },
});
const resolvedHandoff = helper.readState('handoff-state.json');
helper.check(
  '2c. Claude-shaped PostToolUse without exitCode clears failed state even with stderr diagnostics',
  resolvedHandoff.status === 'idle' && !!resolvedHandoff.lastResolved,
  `Got ${JSON.stringify(resolvedHandoff)}`
);

helper.runHook('state-persist.js', {
  session_id: helper.SESSION_ID,
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_response: { stdout: '', stderr: 'numeric failure', exitCode: 2 },
});
const numericFailure = helper.readState('handoff-state.json');
helper.check(
  '2c. Numeric non-zero exit still records failure on hosts that report exit codes',
  numericFailure.status === 'failed' && numericFailure.exitCode === 2,
  `Got ${JSON.stringify(numericFailure)}`
);

helper.runHook('state-persist.js', {
  session_id: helper.SESSION_ID,
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_response: { stdout: 'ok', exitCode: 0 },
});
const numericResolved = helper.readState('handoff-state.json');
helper.check(
  '2c. Numeric zero exit still clears failure state',
  numericResolved.status === 'idle' && !!numericResolved.lastResolved,
  `Got ${JSON.stringify(numericResolved)}`
);

helper.runHook('state-persist.js', {
  session_id: helper.SESSION_ID,
  hook_event_name: 'PostToolUseFailure',
  tool_name: 'Bash',
  error: 'host-declared failure without numeric exit code',
});
const eventFailure = helper.readState('handoff-state.json');
helper.check(
  '2c. PostToolUseFailure remains authoritative without numeric exitCode',
  eventFailure.status === 'failed',
  `Got ${JSON.stringify(eventFailure)}`
);

helper.finish();

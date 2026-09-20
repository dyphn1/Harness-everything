const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2a] Rule of 3 circuit breaker...');

const hooksConfig = JSON.parse(fs.readFileSync(path.join(helper.root, 'hooks', 'hooks.json'), 'utf8'));
const preRuleHook = (hooksConfig.hooks.PreToolUse || []).find(entry => entry.id === 'harness:pre:rule-of-3');
const successTrackerHook = (hooksConfig.hooks.PostToolUse || []).find(entry => entry.id === 'harness:post:rule-of-3-tracker');
const failureTrackerHook = (hooksConfig.hooks.PostToolUseFailure || []).find(entry => entry.id === 'harness:post-failure:rule-of-3-tracker');
const matcherHas = (entry, tool) => Boolean(entry && String(entry.matcher || '').split('|').includes(tool));
helper.check(
  '2a-wiring. PostToolUseFailure invokes the Rule-of-3 tracker',
  matcherHas(failureTrackerHook, 'Bash') && matcherHas(failureTrackerHook, 'PowerShell') &&
    matcherHas(failureTrackerHook, 'apply_patch') &&
    failureTrackerHook.hooks?.some(hook => hook.command.includes('rule-of-3-tracker.js')),
  JSON.stringify(failureTrackerHook)
);
helper.check(
  '2a-wiring. apply_patch is covered before and after execution',
  matcherHas(preRuleHook, 'apply_patch') && matcherHas(successTrackerHook, 'apply_patch') && matcherHas(failureTrackerHook, 'apply_patch'),
  JSON.stringify({ preRuleHook, successTrackerHook, failureTrackerHook })
);

const failure = {
  hook_event_name: 'PostToolUseFailure',
  tool_name: 'Bash',
  tool_input: { command: 'node -e "process.exit(1)"' },
  error: 'Exit code 1\ncommand failed',
  session_id: helper.SESSION_ID,
};
for (let i = 0; i < 3; i++) helper.runHook('rule-of-3-tracker.js', failure);
let state = helper.readState('rule-of-3-state.json');
helper.check(
  '2a-three. exactly three matching failures arm zoom-out',
  state.count === 3 && state.lastHash && state.zoomOutResolved === false && state.threshold === undefined,
  JSON.stringify(state)
);

const trip = helper.runHook('rule-of-3.js', { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: helper.SESSION_ID });
helper.check(
  '2a-trip. third matching failure blocks mutation for reflection',
  trip.code === 2 && trip.stderr.includes('RULE OF 3 CIRCUIT BREAKER TRIGGERED'),
  trip.stderr
);

helper.writeState('rule-of-3-state.json', { count: 3, lastHash: 'mech-test', zoomOutResolved: false, lastFailureAt: 0, zoomOutCycles: 0 });
fs.writeFileSync(path.join(helper.sessionDir, 'zoom-out-report.md'),
  '## Goal\nx\n## Failed Attempts\nx\n## Verified Facts\nx\n## Diagnosis\nx\n## Decision\nRESUME: new approach\n', 'utf8');
const release = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
state = helper.readState('rule-of-3-state.json');
helper.check(
  '2a-release. valid reflection releases breaker and resets count',
  release.code === 0 && state.count === 0 && state.zoomOutResolved === true && state.zoomOutCycles === 1,
  JSON.stringify(state)
);

helper.writeState('rule-of-3-state.json', { count: 3, lastHash: 'mech-test', zoomOutResolved: false, lastFailureAt: Date.now() + 60000, zoomOutCycles: 1 });
const retrip = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
helper.check(
  '2a-repeat. later three-failure cycle requests another zoom-out, not permanent hard lock',
  retrip.code === 2 && retrip.stderr.includes('RULE OF 3 CIRCUIT BREAKER TRIGGERED') && !/hard lock|repeat trip/i.test(retrip.stderr),
  retrip.stderr
);

helper.writeState('rule-of-3-state.json', { count: 0, lastHash: null, zoomOutResolved: false, zoomOutCycles: 0, lastFailureAt: 0 });
for (let i = 0; i < 2; i++) helper.runHook('rule-of-3-tracker.js', {
  hook_event_name: 'PostToolUseFailure', tool_name: 'Bash',
  tool_input: { command: 'cat protected.txt' }, error: 'EACCES: permission denied, open protected.txt',
  session_id: helper.SESSION_ID,
});
state = helper.readState('rule-of-3-state.json');
helper.check('2a-category. permission failures still use the same threshold of three', state.count === 2 && state.category === 'permission' && state.threshold === undefined, JSON.stringify(state));
const beforeThird = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
helper.check('2a-category-two. two permission failures do not trip early', beforeThird.code === 0, beforeThird.stderr);
helper.runHook('rule-of-3-tracker.js', {
  hook_event_name: 'PostToolUseFailure', tool_name: 'Bash',
  tool_input: { command: 'cat protected.txt' }, error: 'EACCES: permission denied, open protected.txt',
  session_id: helper.SESSION_ID,
});
const third = helper.runHook('rule-of-3.js', { session_id: helper.SESSION_ID });
helper.check('2a-category-three. third permission failure trips normally', third.code === 2, third.stderr);

helper.writeState('rule-of-3-state.json', { count: 0, lastHash: null, lastOperationHash: null, zoomOutResolved: false, zoomOutCycles: 0, lastFailureAt: 0 });
const repeatedFailure = {
  hook_event_name: 'PostToolUseFailure',
  tool_name: 'Bash',
  tool_input: { command: 'node flaky.js' },
  error: 'Error: flaky failure',
  session_id: helper.SESSION_ID,
};
helper.runHook('rule-of-3-tracker.js', repeatedFailure);
helper.runHook('rule-of-3-tracker.js', repeatedFailure);
helper.runHook('rule-of-3-tracker.js', {
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git status --short' },
  tool_response: { exitCode: 0, stdout: '' },
  session_id: helper.SESSION_ID,
});
state = helper.readState('rule-of-3-state.json');
helper.check('2a-interleaved. unrelated success preserves the matching failure count', state.count === 2 && state.lastHash, JSON.stringify(state));
helper.runHook('rule-of-3-tracker.js', repeatedFailure);
state = helper.readState('rule-of-3-state.json');
helper.check('2a-interleaved-three. third matching failure still arms zoom-out after unrelated success', state.count === 3 && state.zoomOutResolved === false, JSON.stringify(state));
helper.runHook('rule-of-3-tracker.js', {
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'node flaky.js' },
  tool_response: { exitCode: 0, stdout: 'recovered' },
  session_id: helper.SESSION_ID,
});
state = helper.readState('rule-of-3-state.json');
helper.check('2a-resolved. same-operation success clears the resolved signature', state.count === 0 && state.lastHash === null && state.lastOperationHash === null, JSON.stringify(state));

helper.finish();

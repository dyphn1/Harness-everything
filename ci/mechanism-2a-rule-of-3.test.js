'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helper = require('./test-helper');

const manifest = JSON.parse(fs.readFileSync(path.join(helper.root, 'hooks/hooks.json'), 'utf8'));
const retiredIds = new Set([
  'harness:pre:rule-of-3',
  'harness:post:rule-of-3-tracker',
  'harness:post-failure:rule-of-3-tracker',
]);
const entries = Object.entries(manifest.hooks).flatMap(([event, groups]) =>
  groups.map(group => ({ event, ...group })));
const retiredFiles = [
  'hooks/scripts/rule-of-3.js',
  'hooks/scripts/rule-of-3-tracker.js',
  'hooks/scripts/reset-circuit-breaker.js',
];
const registeredRetired = entries.filter(entry => retiredIds.has(entry.id) ||
  (entry.hooks || []).some(hook => /(?:rule-of-3(?:-tracker)?|reset-circuit-breaker)\.js/.test(hook.command)));

helper.check(
  '2a-retirement.wiring. Claude registers no retired blocker, tracker, or reset entry',
  registeredRetired.length === 0,
  JSON.stringify(registeredRetired)
);
for (const relative of retiredFiles) {
  helper.check(`2a-retirement.file. ${relative} is retired`, !fs.existsSync(path.join(helper.root, relative)));
}

function runRegisteredRuleHook(event, payload) {
  const entry = entries.find(candidate => candidate.event === event && retiredIds.has(candidate.id));
  if (!entry) return [];
  return (entry.hooks || []).map(hook => {
    const relative = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^" ]+)/)?.[1];
    if (!relative) return { status: 1, stderr: `unrecognized hook command: ${hook.command}` };
    return spawnSync(process.execPath, [path.join(helper.root, relative)], {
      cwd: helper.root,
      input: JSON.stringify({ cwd: helper.root, session_id: helper.SESSION_ID, ...payload }),
      encoding: 'utf8',
      env: process.env,
    });
  });
}

function permittedToolCall() {
  return spawnSync(process.execPath, ['-e', 'process.stdout.write("permitted")'], {
    cwd: helper.root,
    encoding: 'utf8',
  });
}

const stateFile = path.join(helper.sessionDir, 'rule-of-3-state.json');
const reportFile = path.join(helper.sessionDir, 'zoom-out-report.md');
const oldState = { count: 3, lastHash: 'legacy-trip', zoomOutResolved: false, lastFailureAt: 123, zoomOutCycles: 0 };
const note = 'agent-authored recovery note\n';

helper.writeState('rule-of-3-state.json', oldState);
fs.writeFileSync(reportFile, note, 'utf8');
helper.writeState('subagent-scope-state.json', { old: true });
const bootstrap = spawnSync(process.execPath, [path.join(helper.root, 'harness-everything/scripts/bootstrap.js')], {
  cwd: helper.root,
  input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: helper.root, session_id: helper.SESSION_ID }),
  encoding: 'utf8',
  env: process.env,
});
helper.check('2a-retirement.bootstrap. startup completes', bootstrap.status === 0, bootstrap.stderr);
helper.check(
  '2a-retirement.bootstrap. legacy breaker state and optional agent note remain intact',
  fs.existsSync(stateFile) && fs.readFileSync(stateFile, 'utf8') === JSON.stringify(oldState, null, 2) &&
    fs.existsSync(reportFile) && fs.readFileSync(reportFile, 'utf8') === note
);
helper.check(
  '2a-retirement.bootstrap. unrelated subagent scope baseline still resets',
  !fs.existsSync(path.join(helper.sessionDir, 'subagent-scope-state.json'))
);
helper.writeState('subagent-scope-state.json', { old: true });
const startup = helper.runHook('openai-session-start.js', {
  hook_event_name: 'SessionStart', cwd: helper.root, session_id: helper.SESSION_ID,
});
helper.check('2a-retirement.startup. Codex startup completes', startup.code === 0, startup.stderr);
helper.check(
  '2a-retirement.startup. legacy breaker state and optional agent note remain intact',
  fs.existsSync(stateFile) && fs.readFileSync(stateFile, 'utf8') === JSON.stringify(oldState, null, 2) &&
    fs.existsSync(reportFile) && fs.readFileSync(reportFile, 'utf8') === note
);
helper.check(
  '2a-retirement.startup. unrelated subagent scope baseline still resets',
  !fs.existsSync(path.join(helper.sessionDir, 'subagent-scope-state.json'))
);

for (const legacyState of [false, true]) {
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  if (legacyState) helper.writeState('rule-of-3-state.json', oldState);

  const pre = runRegisteredRuleHook('PreToolUse', {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'node -e process.exit(0)' },
  });
  const call = pre.every(result => result.status === 0) ? permittedToolCall() : null;
  const post = call && call.status === 0 ? runRegisteredRuleHook('PostToolUse', {
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node -e process.exit(0)' },
    tool_response: { exitCode: 0, stdout: 'permitted' },
  }) : [];

  helper.check(
    `2a-retirement.tool.${legacyState ? 'legacy' : 'fresh'}. otherwise-permitted tool call runs`,
    pre.every(result => result.status === 0) && call?.status === 0 && post.every(result => result.status === 0),
    JSON.stringify({ pre: pre.map(result => result.status), call: call?.status, post: post.map(result => result.status) })
  );
  helper.check(
    `2a-retirement.tool.${legacyState ? 'legacy' : 'fresh'}. no breaker state is created`,
    legacyState ? fs.readFileSync(stateFile, 'utf8') === JSON.stringify(oldState, null, 2) : !fs.existsSync(stateFile)
  );
}

if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
const failure = runRegisteredRuleHook('PostToolUseFailure', {
  hook_event_name: 'PostToolUseFailure', tool_name: 'Bash',
  tool_input: { command: 'node -e process.exit(1)' }, error: 'fixture failure',
});
helper.check(
  '2a-retirement.failure. failed tool result creates no breaker state',
  failure.every(result => result.status === 0) && !fs.existsSync(stateFile),
  JSON.stringify(failure.map(result => ({ status: result.status, stderr: result.stderr })))
);

helper.finish();

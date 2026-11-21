#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8')).hooks;
const ADAPTER = path.join(ROOT, 'hooks/scripts/ledger-lesson.js');
const ERRORS_SYNC = path.join(ROOT, 'scripts/errors-sync.js');
const FIXTURES = path.join(__dirname, 'fixtures/394-claude-ledger-lesson');
const LEDGER = path.join(ROOT, '.agents/harness-everything/errors');
const E3_FILE = fs.readdirSync(LEDGER).find(file => /^E-0003-[a-z0-9-]+\.md$/.test(file));
const COMMITLINT_OUTPUT = fs.readFileSync(
  path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'), 'utf8');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), '394 claude ledger lesson ')));
const STATE_HOME = path.join(TMP, 'state-home');
let serial = 0;

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function register(event, id) {
  const entries = HOOKS[event].filter(entry => entry.id === id);
  assert.equal(entries.length, 1, `${event} registers exactly one ${id} hook`);
  assert.equal(entries[0].matcher, 'Bash', `${id} matches Bash only`);
  assert.deepEqual(entries[0].hooks, [{
    type: 'command',
    command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/ledger-lesson.js"'
  }]);
}

function newWorkspace(name) {
  const root = path.join(TMP, `${name}-${++serial}`);
  const ledger = path.join(root, '.agents/harness-everything/errors');
  fs.mkdirSync(ledger, { recursive: true });
  fs.copyFileSync(path.join(LEDGER, E3_FILE), path.join(ledger, E3_FILE));
  const generated = spawnSync(process.execPath, [ERRORS_SYNC, '--root', root], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  return root;
}

function payload(name, overrides = {}) {
  return {
    ...JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')),
    ...overrides
  };
}

function run(input) {
  let payloadValue = typeof input === 'string' ? null : input;
  if (!payloadValue && typeof input === 'string') {
    try { payloadValue = JSON.parse(input); } catch (_) { /* malformed input uses the action hook */ }
  }
  const event = payloadValue?.hook_event_name === 'PostToolUseFailure'
    ? 'PostToolUseFailure' : 'PreToolUse';
  const id = event === 'PreToolUse'
    ? 'harness:pre:ledger-lesson' : 'harness:post-failure:ledger-lesson';
  const registration = HOOKS[event].find(entry => entry.id === id);
  assert.ok(registration, `${event} registration exists before invocation`);
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, HARNESS_STATE_HOME: STATE_HOME };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CODEX_PROJECT_DIR;
  delete env.HARNESS_WORKSPACE_ROOT;
  delete env.FABLE_WORKSPACE_ROOT;
  const command = registration.hooks[0].command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, env.CLAUDE_PLUGIN_ROOT);
  const target = command.match(/^node\s+"([^"]+)"$/);
  assert.ok(target, `${event} resolves to a direct Node hook command: ${registration.hooks[0].command}`);
  assert.equal(path.resolve(target[1]), path.resolve(ADAPTER), `${event} resolves its registered adapter path`);
  return spawnSync('node', [target[1]], {
    cwd: ROOT,
    env,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8'
  });
}

function assertContext(result, eventName) {
  assert.equal(result.status, 0, result.stderr || 'adapter exits successfully');
  assert.equal(result.stderr, '', 'adapter stays silent on stderr');
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(output.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  assert.equal(output.hookSpecificOutput.hookEventName, eventName);
  assert.match(output.hookSpecificOutput.additionalContext, /Check the subject line against both rules/);
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined,
    'the carrier does not change Claude permission handling');
  return output.hookSpecificOutput.additionalContext;
}

function assertSilent(result) {
  assert.equal(result.status, 0, result.stderr || 'fail-open adapter exits successfully');
  assert.equal(result.stdout, '', 'no-match and malformed events emit no context');
  assert.equal(result.stderr, '', 'fail-open handling stays silent');
}

test('registers the Claude Bash action and failure context carrier', () => {
  register('PreToolUse', 'harness:pre:ledger-lesson');
  register('PostToolUseFailure', 'harness:post-failure:ledger-lesson');
});

test('emits action then failure context once per phase and session without changing tool flow', () => {
  assert.ok(fs.existsSync(ADAPTER), 'Claude ledger lesson adapter exists');
  const root = newWorkspace('with-ledger');
  const sessionId = `hc-session-${process.pid}`;
  const action = payload('pre-tool-use.json', { cwd: root, session_id: sessionId });
  const failure = payload('post-tool-use-failure.json', {
    cwd: root,
    session_id: sessionId,
    tool_input: { command: 'git commit -m "Bad Subject"' },
    error: COMMITLINT_OUTPUT
  });

  const actionContext = assertContext(run(JSON.stringify(action)), 'PreToolUse');
  const failureContext = assertContext(run(JSON.stringify(failure)), 'PostToolUseFailure');
  assert.equal(actionContext, failureContext, 'both phases carry the same canonical Cue and Lesson');
  assert.ok(!failureContext.includes(COMMITLINT_OUTPUT),
    'failure diagnostics are matching input, not copied into context');

  const prefixedSession = sessionId + '-prefixed';
  const prefixedAction = {
    ...action,
    session_id: prefixedSession,
    tool_input_command: 'git -C x commit -m "Bad Subject"'
  };
  const prefixedFailure = {
    ...failure,
    session_id: prefixedSession,
    tool_input: { command: 'git -C x commit -m "Bad Subject"' }
  };
  assertContext(run(JSON.stringify(prefixedAction)), 'PreToolUse');
  assertContext(run(JSON.stringify(prefixedFailure)), 'PostToolUseFailure');

  assertSilent(run(JSON.stringify(action)));
  assertSilent(run(JSON.stringify(failure)));
  assertContext(run(JSON.stringify({ ...action, session_id: `${sessionId}-other` })), 'PreToolUse');
});

test('keeps dedupe state separate when a session changes workspace identity', () => {
  const firstRoot = newWorkspace('first-workspace');
  const secondRoot = newWorkspace('second-workspace');
  const sessionId = `hc-workspace-${process.pid}`;
  const action = payload('pre-tool-use.json', { cwd: firstRoot, session_id: sessionId });

  assertContext(run(JSON.stringify(action)), 'PreToolUse');
  const secondWorkspaceAction = {
    ...action,
    cwd: secondRoot,
    workspace_identity_reset: true
  };
  assertContext(run(JSON.stringify(secondWorkspaceAction)), 'PreToolUse');
  assertSilent(run(JSON.stringify(secondWorkspaceAction)));
});

test('unrelated events, missing ledgers and malformed input remain silent and exit zero', t => {
  if (!fs.existsSync(ADAPTER)) return t.skip('adapter is absent at the pinned RED state');
  const root = newWorkspace('with-ledger-controls');
  const base = payload('pre-tool-use.json', { cwd: root, session_id: `hc-control-${process.pid}` });
  assertSilent(run(JSON.stringify({ ...base, tool_input_command: 'git status' })));
  assertSilent(run(JSON.stringify({ ...base, hook_event_name: 'PostToolUse' })));
  assertSilent(run(JSON.stringify({ ...base, tool_name: 'Write' })));
  assertSilent(run(JSON.stringify({ ...base, session_id: undefined })));
  assertSilent(run(JSON.stringify({ ...base, cwd: undefined, session_id: `hc-missing-cwd-${process.pid}` })));
  assertSilent(run(JSON.stringify({ ...base, cwd: '.', session_id: `hc-relative-cwd-${process.pid}` })));

  const noLedger = path.join(TMP, `without-ledger-${++serial}`);
  fs.mkdirSync(noLedger, { recursive: true });
  assertSilent(run(JSON.stringify({ ...base, cwd: noLedger, session_id: `hc-no-ledger-${process.pid}` })));
  assertSilent(run(JSON.stringify({ ...base, tool_input_command: undefined })));
  assertSilent(run('{"hook_event_name":'));
  assertSilent(run(JSON.stringify({ ...base, padding: 'x'.repeat(65_536) })));
});

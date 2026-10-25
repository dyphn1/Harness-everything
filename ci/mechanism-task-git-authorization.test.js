#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const actionGate = require(path.join(ROOT, 'hooks', 'scripts', 'action-gate.js'));
const PRE_HOOK = path.join(ROOT, 'hooks', 'scripts', 'codex-action-gate-pre.js');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-task-git-auth-'));
const stateHome = path.join(tempRoot, 'state');
fs.mkdirSync(stateHome, { recursive: true });

const env = {
  ...process.env,
  HARNESS_ACTION_GATE_HOST: 'codex',
  HARNESS_STATE_HOME: stateHome,
  HARNESS_ACTION_GATE_STDIN_TIMEOUT_MS: '2000',
};

function run(payload) {
  const result = spawnSync(process.execPath, [PRE_HOOK], {
    cwd: tempRoot,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  return result;
}

function payload(toolName, toolInput, extra = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'task-git-auth-codex-session',
    turn_id: 'turn-task-git-auth',
    tool_use_id: `call-${Math.random().toString(16).slice(2)}`,
    tool_name: toolName,
    tool_input: toolInput,
    permission_mode: 'default',
    cwd: tempRoot,
    ...extra,
  };
}

const actualPrPayload = payload('mcp__codex_apps__github__create_pull_request', {
  repository_full_name: 'openai/codex',
  base: 'main',
  head: 'feature/task-authorization',
  title: 'Phase complete PR',
  body: '## Summary\n\nPhase complete PR created after task authorization.',
  draft: true,
});

try {
  assert.ok(fs.existsSync(PRE_HOOK), 'Codex PreToolUse entrypoint must exist');

  // Read control on the real Codex path.
  const readResult = run(payload('mcp__demo__get_pull_request', { pull_request: 1 }));
  assert.strictEqual(readResult.status, 0, 'read-only structured action must pass on Codex');
  assert.strictEqual(String(readResult.stdout || '').trim(), '', 'read control must not emit a Harness permission decision');

  // Dangerous controls remain hard Codex blocks.
  for (const [toolName, toolInput] of [
    ['mcp__demo__merge_pull_request', { id: 'target' }],
    ['mcp__demo__delete_pull_request', { id: 'target' }],
    ['mcp__demo__deploy_release', { id: 'target' }],
    ['mcp__demo__publish_package', { id: 'target' }],
    ['mcp__demo__send_message', { id: 'target' }],
  ]) {
    const result = run(payload(toolName, toolInput));
    assert.strictEqual(result.status, 2, `${toolName} must remain a Codex block`);
  }
  const forcePush = run(payload('Bash', { command: 'git push --force origin main' }));
  assert.strictEqual(forcePush.status, 2, 'git push --force must remain a Codex block');

  // Normal non-destructive commit keeps its existing ungated behavior.
  const normalCommit = run(payload('Bash', { command: 'git commit -m "phase complete"' }));
  assert.strictEqual(normalCommit.status, 0, 'normal git commit must remain ungated on Codex');

  // Misleading names containing create_pull_request must not inherit the exemption.
  for (const toolName of [
    'mcp__demo__create_pull_request_and_delete',
    'mcp__demo__delete_create_pull_request',
    'mcp__demo__create_pull_requests',
    'mcp__demo__foo_create_pull_request',
  ]) {
    const result = run(payload(toolName, { id: 'target' }));
    assert.strictEqual(result.status, 2, `${toolName} must remain a Codex block`);
  }

  // Explicit required gate is carried in the supported payload hint shape
  // (payload.workflowPlan.actionGate — the shape routerActionGateHint reads),
  // not a made-up options API.
  const requiredDecision = actionGate.evaluatePreToolUse({
    ...actualPrPayload,
    tool_use_id: 'call-required-gate-witness',
    workflowPlan: { actionGate: { required: true, reasonCodes: ['external-side-effect'], disposition: 'pending-approval' } },
  }, {
    host: 'codex',
    ruleTable: actionGate.loadRuleTable(path.join(ROOT, 'hooks', 'scripts', 'action-gate-rules.json')),
  });
  assert.strictEqual(requiredDecision.kind, 'block', 'required-gate PR must remain gated');
  assert.strictEqual(requiredDecision.exitCode, 2, 'required-gate PR must remain a Codex block');
  assert.ok(requiredDecision.rule, 'required-gate PR must match a gated rule');
  assert.strictEqual(requiredDecision.rule.id, 'structured-mutate', 'required-gate PR must keep structured-mutate');

  // Recognized PR creation is a routine host-deferred operation. Its descriptor
  // stays a mutation; it is not read or safe, and it must not use Harness consent.
  const descriptor = actionGate.normalizeActionDescriptor(actualPrPayload);
  assert.strictEqual(descriptor.action, 'mutate', 'recognized PR creation must remain classified as a mutation');
  assert.notStrictEqual(descriptor.classification, 'safe', 'recognized PR creation must not be safe/read');
  const prResult = run(actualPrPayload);
  assert.strictEqual(prResult.status, 0, 'recognized PR creation must be host-deferred on Codex (currently exits 2: RED)');
  assert.strictEqual(String(prResult.stdout || '').trim(), '', 'recognized PR creation must not emit permissionDecision allow/ask');
  assert.ok(!/HARNESS APPROVE/i.test(`${prResult.stdout || ''}\n${prResult.stderr || ''}`), 'recognized PR creation must not require a Harness approval phrase');

  // Provider-neutral exact create_pull_request operation, if used, has the same contract.
  const neutralResult = run(payload('mcp__demo__create_pull_request', {
    repository: 'acme/harness',
    head: 'feature/task-authorization',
    base: 'main',
    title: 'Phase complete PR',
    body: 'Provider-neutral PR body.',
  }));
  assert.strictEqual(neutralResult.status, 0, 'exact create_pull_request operation must be host-deferred on Codex (currently exits 2: RED)');

  // Genuine mutations remain blocked, but the fixed-format approval protocol is retired.
  const legacyMutation = run(payload('mcp__demo__update_issue', { issue_id: 1, title: 'changed' }));
  assert.strictEqual(legacyMutation.status, 2, 'genuine mutation must remain blocked on Codex');
  assert.ok(!/HARNESS APPROVE/i.test(`${legacyMutation.stdout || ''}\n${legacyMutation.stderr || ''}`), 'genuine mutation must not expose the retired Harness approval phrase');

  console.log('PASS: task git authorization Codex controls and host-deferred PR creation');
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
}

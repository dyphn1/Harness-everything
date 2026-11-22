'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'hooks', 'scripts');
const HOOKS_JSON = path.join(ROOT, 'plugins', 'harness-everything', 'hooks.json');
const { getSessionDir } = require(path.join(SCRIPTS_DIR, 'lib', 'harness-state'));

// 1. Verify plugins/harness-everything/hooks.json structure
assert.ok(fs.existsSync(HOOKS_JSON), 'plugins/harness-everything/hooks.json must exist at plugin root');
const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
assert.ok(hooksConfig['harness-everything'], 'Top-level hook name must be harness-everything');

const agyHooks = hooksConfig['harness-everything'];
assert.ok(Array.isArray(agyHooks.SessionStart), 'SessionStart hook must be defined');
assert.ok(Array.isArray(agyHooks.PreInvocation), 'PreInvocation hook must be defined');
assert.ok(Array.isArray(agyHooks.PreToolUse), 'PreToolUse hook must be defined');
assert.ok(Array.isArray(agyHooks.PostToolUse), 'PostToolUse hook must be defined');
assert.ok(Array.isArray(agyHooks.Stop), 'Stop hook must be defined');

const expectedMatcher = 'run_command|write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content';
assert.strictEqual(
  agyHooks.PreToolUse[0].matcher,
  expectedMatcher,
  'PreToolUse matcher must cover all documented AGY command and file-modification tools'
);

function runHook(scriptName, inputPayload, env = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  assert.ok(fs.existsSync(scriptPath), `Hook script ${scriptName} must exist`);

  const run = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(inputPayload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10000
  });

  assert.strictEqual(run.status, 0, `Script ${scriptName} exited non-zero: ${run.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(run.stdout.trim());
  } catch (err) {
    assert.fail(`Script ${scriptName} stdout is not valid JSON: "${run.stdout}"`);
  }
  return parsed;
}

// 2. PreInvocation Hook: router context and session workflow persistence
{
  const testConvId = 'test-conv-persist-' + Date.now();
  const payload = {
    hookEventName: 'PreInvocation',
    conversationId: testConvId,
    lastUserInput: 'Please implement new auth feature and write tests',
    cwd: ROOT
  };
  const result = runHook('agy-pre-invocation.js', payload);
  assert.ok(Array.isArray(result.injectSteps), 'PreInvocation must emit injectSteps array');

  // Verify that workflow was persisted in session directory using conversationId
  const sessionDir = getSessionDir(ROOT, testConvId);
  const workflowFile = path.join(sessionDir, 'workflow-run.json');
  assert.ok(fs.existsSync(workflowFile), 'Workflow must be persisted in session dir for conversationId');
  const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
  assert.strictEqual(workflow.sessionId, testConvId, 'Persisted workflow must match conversationId');
}

// 3. PreToolUse Hook (Canonical Action Gate & Filesystem Boundary)
{
  // Happy path command
  const allowCmd = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    cwd: ROOT
  });
  assert.strictEqual(allowCmd.decision, 'allow', 'npm test should be allowed');

  // Canonical Action Gate: Destructive rm -rf outside scratch
  const denyRm = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
    cwd: ROOT
  });
  assert.strictEqual(denyRm.decision, 'deny', 'rm -rf / must be denied');
  assert.ok(denyRm.reason.includes('destructive') || denyRm.reason.includes('actionGate:recursive-delete'), 'Must provide actionable reason');

  // Canonical Action Gate: Force-push variants
  for (const pushCmd of [
    'git push --force origin main',
    'git push -f origin main',
    'git -C . push -f origin main'
  ]) {
    const denyPush = runHook('agy-pre-tool.js', {
      toolCall: { name: 'run_command', args: { CommandLine: pushCmd } },
      cwd: ROOT
    });
    assert.strictEqual(denyPush.decision, 'deny', `${pushCmd} must be denied by canonical action gate`);
    assert.ok(denyPush.reason.includes('Force-pushing') || denyPush.reason.includes('actionGate:git-force-push'), 'Action gate reason required');
  }

  // Canonical Action Gate: git reset --hard
  const denyReset = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'git reset --hard HEAD~1' } },
    cwd: ROOT
  });
  assert.strictEqual(denyReset.decision, 'deny', 'git reset --hard must be denied');
  assert.ok(denyReset.reason.includes('reset') || denyReset.reason.includes('actionGate:git-reset-hard'), 'Action gate reason required');

  // Canonical Action Gate: npm publish
  const denyPublish = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'npm publish' } },
    cwd: ROOT
  });
  assert.strictEqual(denyPublish.decision, 'deny', 'npm publish must be denied');

  // Filesystem boundary checks across all documented AGY file mutation tools
  const fileTools = [
    { name: 'write_file', argKey: 'Path' },
    { name: 'edit_file', argKey: 'path' },
    { name: 'write_to_file', argKey: 'TargetFile' },
    { name: 'replace_file_content', argKey: 'TargetFile' },
    { name: 'multi_replace_file_content', argKey: 'TargetFile' }
  ];

  for (const { name, argKey } of fileTools) {
    // Outside workspace root -> must deny
    const denyOob = runHook('agy-pre-tool.js', {
      toolCall: { name, args: { [argKey]: '/etc/shadow', Content: 'bad' } },
      cwd: ROOT
    });
    assert.strictEqual(denyOob.decision, 'deny', `${name} with out-of-bounds ${argKey} must be denied`);
    assert.ok(denyOob.reason.includes('outside workspace root'), 'Boundary violation reason required');

    // Inside workspace root -> must allow
    const allowInBounds = runHook('agy-pre-tool.js', {
      toolCall: { name, args: { [argKey]: path.join(ROOT, 'package.json'), Content: '{}' } },
      cwd: ROOT
    });
    assert.strictEqual(allowInBounds.decision, 'allow', `${name} inside workspace must be allowed`);
  }
}

// 4. PostToolUse Hook (Failure observation & state persistence)
{
  const testConvFail = 'test-conv-post-fail-' + Date.now();
  const sessionDir = getSessionDir(ROOT, testConvFail);
  const handoffFile = path.join(sessionDir, 'handoff-state.json');

  // Observe tool failure
  const failResult = runHook('agy-post-tool.js', {
    conversationId: testConvFail,
    cwd: ROOT,
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    error: 'npm ERR! test failure observed',
    exitCode: 1,
    stepIdx: 2
  });
  assert.deepStrictEqual(failResult, {}, 'PostToolUse must output empty object');

  assert.ok(fs.existsSync(handoffFile), 'handoff-state.json must be written on failure');
  const failHandoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
  assert.strictEqual(failHandoff.status, 'failed', 'Status must be marked failed');
  assert.ok(failHandoff.errorSummary.includes('test failure observed'), 'Error summary must capture error');

  // Observe subsequent successful tool run
  const successResult = runHook('agy-post-tool.js', {
    conversationId: testConvFail,
    cwd: ROOT,
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    exitCode: 0,
    stepIdx: 3
  });
  assert.deepStrictEqual(successResult, {}, 'PostToolUse must output empty object');

  const resolvedHandoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
  assert.strictEqual(resolvedHandoff.status, 'idle', 'Status must recover to idle after successful run');
  assert.ok(resolvedHandoff.lastResolved, 'lastResolved record must be retained');

  // Verify independent session does not share state
  const otherConv = 'test-conv-other-' + Date.now();
  const otherSessionDir = getSessionDir(ROOT, otherConv);
  const otherHandoffFile = path.join(otherSessionDir, 'handoff-state.json');
  assert.ok(!fs.existsSync(otherHandoffFile), 'Unrelated session must not share state');
}

// 5. Stop Hook (Verify-Before-Claim)
{
  // When continuationActive is true, must allow stop to prevent loops
  const allowStop = runHook('agy-stop.js', {
    conversationId: 'test-stop-conv',
    continuationActive: true,
    cwd: ROOT
  });
  assert.deepStrictEqual(allowStop, {}, 'Must allow stop when continuation is active');

  // Unverified edits in session state -> must return decision: "continue"
  const unverifiedConv = 'test-stop-unverified-' + Date.now();
  const unverifiedDir = getSessionDir(ROOT, unverifiedConv);
  fs.writeFileSync(path.join(unverifiedDir, 'handoff-state.json'), JSON.stringify({
    status: 'idle',
    lastEditAt: Date.now(),
    lastVerifyAt: 0
  }), 'utf8');

  const blockStop = runHook('agy-stop.js', {
    conversationId: unverifiedConv,
    continuationActive: false,
    cwd: ROOT
  });
  assert.strictEqual(blockStop.decision, 'continue', 'Must continue when unverified edits exist');
  assert.ok(blockStop.reason.includes('Verify-Before-Claim'), 'Reason must mention Verify-Before-Claim');

  // Verified edits in session state -> must allow stop ({})
  const verifiedConv = 'test-stop-verified-' + Date.now();
  const verifiedDir = getSessionDir(ROOT, verifiedConv);
  const now = Date.now();
  fs.writeFileSync(path.join(verifiedDir, 'handoff-state.json'), JSON.stringify({
    status: 'idle',
    lastEditAt: now - 5000,
    lastVerifyAt: now
  }), 'utf8');

  const allowVerifiedStop = runHook('agy-stop.js', {
    conversationId: verifiedConv,
    continuationActive: false,
    cwd: ROOT
  });
  assert.deepStrictEqual(allowVerifiedStop, {}, 'Must allow stop when verification succeeded after edit');

  // HARNESS_REQUIRE_VERIFICATION=1 should allow verified completion
  const allowStrictVerified = runHook('agy-stop.js', {
    conversationId: verifiedConv,
    continuationActive: false,
    cwd: ROOT
  }, { HARNESS_REQUIRE_VERIFICATION: '1' });
  assert.deepStrictEqual(allowStrictVerified, {}, 'Strict verification must allow verified work');
}

// 6. SessionStart Hook
{
  const start = runHook('agy-session-start.js', {
    conversationId: 'test-session-001',
    workspacePaths: [ROOT]
  });
  assert.ok(Array.isArray(start.injectSteps), 'SessionStart must emit injectSteps');
  assert.ok(start.injectSteps.some(s => s.systemMessage && s.systemMessage.systemMessage.includes('Harness Skills OS')), 'Must include Harness bootstrap message');
}

console.log('Antigravity (AGY) lifecycle hook adapters verified: PreInvocation, PreToolUse, PostToolUse, Stop, and SessionStart all conform to protocol.');

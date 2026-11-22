'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'hooks', 'scripts');
const HOOKS_JSON = path.join(ROOT, 'plugins', 'harness-everything', 'hooks.json');

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

// 2. PreInvocation Hook
{
  const payload = {
    hookEventName: 'PreInvocation',
    conversationId: 'test-conv-001',
    lastUserInput: 'Please implement new auth feature and write tests',
    cwd: ROOT
  };
  const result = runHook('agy-pre-invocation.js', payload);
  assert.ok(Array.isArray(result.injectSteps), 'PreInvocation must emit injectSteps array');
}

// 3. PreToolUse Hook (Action Gate & Boundary Guard)
{
  // Happy path command
  const allowCmd = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    cwd: ROOT
  });
  assert.strictEqual(allowCmd.decision, 'allow', 'npm test should be allowed');

  // Forbidden destructive command
  const denyRm = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
    cwd: ROOT
  });
  assert.strictEqual(denyRm.decision, 'deny', 'rm -rf / must be denied');
  assert.ok(denyRm.reason.includes('destructive filesystem command'), 'Must provide actionable reason');

  // Forbidden force push
  const denyPush = runHook('agy-pre-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'git push --force origin main' } },
    cwd: ROOT
  });
  assert.strictEqual(denyPush.decision, 'deny', 'force-push to main must be denied');

  // Out of bounds file write
  const denyOob = runHook('agy-pre-tool.js', {
    toolCall: { name: 'write_file', args: { Path: '/etc/shadow', Content: 'root:...' } },
    cwd: ROOT
  });
  assert.strictEqual(denyOob.decision, 'deny', 'Writing outside workspace must be denied');
  assert.ok(denyOob.reason.includes('outside workspace root'), 'Boundary violation reason');

  // In-bounds file write
  const allowWrite = runHook('agy-pre-tool.js', {
    toolCall: { name: 'write_file', args: { Path: path.join(ROOT, 'package.json'), Content: '{}' } },
    cwd: ROOT
  });
  assert.strictEqual(allowWrite.decision, 'allow', 'Writing inside workspace must be allowed');
}

// 4. PostToolUse Hook
{
  const result = runHook('agy-post-tool.js', {
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    stepIdx: 3,
    error: ''
  });
  assert.deepStrictEqual(result, {}, 'PostToolUse must output empty object');
}

// 5. Stop Hook (Verify-Before-Claim)
{
  // When continuationActive is true, must allow stop to prevent loops
  const allowStop = runHook('agy-stop.js', {
    terminationReason: 'NO_TOOL_CALL',
    continuationActive: true
  });
  assert.deepStrictEqual(allowStop, {}, 'Must allow stop when continuation is active');

  // When verification is required, must block stop with decision: "continue"
  const blockStop = runHook('agy-stop.js', {
    terminationReason: 'NO_TOOL_CALL',
    continuationActive: false
  }, { HARNESS_REQUIRE_VERIFICATION: '1' });
  assert.strictEqual(blockStop.decision, 'continue', 'Must block stop when verification required');
  assert.ok(blockStop.reason.includes('Verify-Before-Claim'), 'Reason must mention Verify-Before-Claim');
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

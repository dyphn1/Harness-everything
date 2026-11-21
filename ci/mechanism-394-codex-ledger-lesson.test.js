#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const compat = require('../scripts/codex-hooks-compat');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'harness-everything');
const TEMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), '394 codex ledger ')));
const STATE_HOME = path.join(TEMP, 'state');
const INDEX_FILE = path.join(ROOT, '.agents', 'harness-everything', 'errors', 'index.jsonl');
const ROW_E3 = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8').split(/\r?\n/)
  .find(line => line && JSON.parse(line).id === 'E-0003'));
const COMMITLINT_OUTPUT = fs.readFileSync(
  path.join(ROOT, 'ci', 'fixtures', '394-ledger-match', 'commitlint-subject-case.txt'), 'utf8');
const FIXTURES = path.join(__dirname, 'fixtures', '394-codex-ledger-lesson');
const previousStateHome = process.env.HARNESS_STATE_HOME;
process.env.HARNESS_STATE_HOME = STATE_HOME;

test.after(() => {
  if (previousStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = previousStateHome;
  fs.rmSync(TEMP, { recursive: true, force: true });
});

function payload(name, workspaceRoot, sessionId) {
  const value = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  value.cwd = workspaceRoot;
  value.session_id = sessionId;
  return value;
}

function workspace(name, { ledger = true } = {}) {
  const root = path.join(TEMP, name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  if (ledger) {
    const recordDir = path.join(root, path.dirname(ROW_E3.file));
    fs.mkdirSync(recordDir, { recursive: true });
    fs.copyFileSync(INDEX_FILE, path.join(recordDir, 'index.jsonl'));
    fs.copyFileSync(path.join(ROOT, ROW_E3.file), path.join(root, ROW_E3.file));
  }
  return fs.realpathSync.native(root);
}

function stagePlugin() {
  const staged = path.join(TEMP, 'native-plugin');
  fs.cpSync(PLUGIN_ROOT, staged, { recursive: true });
  for (const [source, target] of [
    ['hooks/scripts/codex-ledger-lesson.js', 'hooks/scripts/codex-ledger-lesson.js'],
    ['hooks/scripts/lib/ledger-match.js', 'hooks/scripts/lib/ledger-match.js'],
    ['hooks/scripts/lib/codex-tool-outcome.js', 'hooks/scripts/lib/codex-tool-outcome.js'],
    ['hooks/scripts/lib/harness-state.js', 'hooks/scripts/lib/harness-state.js'],
    ['scripts/lib/workspace.js', 'scripts/lib/workspace.js'],
  ]) {
    const destination = path.join(staged, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, source), destination);
  }
  return staged;
}

function registeredHook(pluginRoot, event) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  const group = manifest.hooks[event].find(entry => entry.matcher === 'Bash' &&
    entry.hooks.some(hook => hook.command.includes('codex-ledger-lesson.js')));
  assert.ok(group, `packaged ${event} Bash hook registers codex-ledger-lesson.js`);
  assert.equal(group.hooks.length, 1, `${event} lesson carrier is an isolated hook`);
  const hook = group.hooks[0];
  assert.equal(hook.command, 'node "${PLUGIN_ROOT}/hooks/scripts/codex-ledger-lesson.js"');
  assert.equal(hook.commandWindows, 'node "${PLUGIN_ROOT}\\hooks\\scripts\\codex-ledger-lesson.js"');
  return hook;
}

function runScript(script, pluginRoot, input) {
  const result = spawnSync(process.execPath, [script], {
    cwd: input.cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT: pluginRoot, HARNESS_STATE_HOME: STATE_HOME },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '', 'no-match and matched delivery are silent on stderr');
  return result.stdout;
}

function runNative(pluginRoot, event, input) {
  registeredHook(pluginRoot, event);
  return runScript(path.join(pluginRoot, 'hooks', 'scripts', 'codex-ledger-lesson.js'), pluginRoot, input);
}

function runCompatibility(config, event, input) {
  const group = config.hooks[event].find(entry => entry.matcher === 'Bash' &&
    entry.hooks.some(hook => hook.command.includes('codex-ledger-lesson.js')));
  assert.ok(group, `codex-hooks compatibility install registers ${event} Bash lesson hook`);
  assert.equal(group.hooks.length, 1, `${event} compatibility lesson carrier is isolated`);
  const hook = group.hooks[0];
  const command = /^node "(.+)"$/.exec(hook.command);
  assert.ok(command, hook.command);
  assert.equal(hook.commandWindows, hook.command.replaceAll('/', '\\'));
  return runScript(command[1], path.dirname(path.dirname(path.dirname(command[1]))), input);
}

function context(stdout, event) {
  assert.ok(stdout, `${event} should carry a matching ledger lesson`);
  const result = JSON.parse(stdout);
  assert.deepEqual(Object.keys(result), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(result.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  assert.equal(result.hookSpecificOutput.hookEventName, event);
  assert.match(result.hookSpecificOutput.additionalContext, /A commit is rejected locally by commitlint/);
  assert.match(result.hookSpecificOutput.additionalContext, /Consider a fresh look/);
  assert.doesNotMatch(JSON.stringify(result), /permissionDecision|updatedInput|"decision"|"continue"/,
    'lesson context does not alter tool permission or result flow');
  return result.hookSpecificOutput.additionalContext;
}

function carrierRoundTrip(run, name) {
  const root = workspace(`${name}-workspace`);
  const firstAction = payload('pre-tool-use.json', root, `${name}-session-a`);
  const originalPayload = JSON.stringify(firstAction);
  const actionContext = context(run('PreToolUse', firstAction), 'PreToolUse');
  assert.ok(actionContext.includes('Lesson:'), 'action context carries the canonical E-0003 lesson');
  assert.equal(fs.readFileSync(path.join(FIXTURES, 'pre-tool-use.json'), 'utf8').includes(root), false,
    'test workspace state is isolated from the checked-in payload template');
  assert.equal(run('PreToolUse', firstAction), '', 'repeated action context is deduplicated');
  assert.equal(JSON.stringify(firstAction), originalPayload, 'the input action and permission fields remain unchanged');

  const failure = payload('post-tool-use-failure.json', root, `${name}-session-a`);
  failure.tool_input.command = firstAction.tool_input.command;
  failure.tool_response.stderr = COMMITLINT_OUTPUT;
  context(run('PostToolUse', failure), 'PostToolUse');
  assert.equal(run('PostToolUse', failure), '', 'repeated failure context is deduplicated');

  const anotherSession = payload('pre-tool-use.json', root, `${name}-session-b`);
  context(run('PreToolUse', anotherSession), 'PreToolUse');

  const anotherWorkspace = workspace(`${name}-other-workspace`);
  const otherWorkspaceAction = payload('pre-tool-use.json', anotherWorkspace, `${name}-other-session`);
  context(run('PreToolUse', otherWorkspaceAction), 'PreToolUse');

  const noLedger = workspace(`${name}-no-ledger`, { ledger: false });
  const unrelatedWorkspace = payload('pre-tool-use.json', noLedger, `${name}-no-ledger-session`);
  assert.equal(run('PreToolUse', unrelatedWorkspace), '', 'missing workspace ledger produces no context');
  const missingSession = payload('pre-tool-use.json', root, `${name}-missing-session`);
  delete missingSession.session_id;
  assert.equal(run('PreToolUse', missingSession), '', 'missing session identity never falls back to shared state');
  const missingWorkspace = payload('pre-tool-use.json', root, `${name}-missing-workspace`);
  delete missingWorkspace.cwd;
  assert.equal(run('PreToolUse', missingWorkspace), '', 'missing workspace never falls back to the adapter checkout');

  const oversized = payload('pre-tool-use.json', root, `${name}-oversized-session`);
  oversized.unused_large_field = 'x'.repeat(129 * 1024);
  assert.equal(run('PreToolUse', oversized), '', 'oversized hook payload is bounded and fails open');

  const success = payload('post-tool-use-success.json', root, `${name}-success-session`);
  success.tool_response.stderr = COMMITLINT_OUTPUT;
  assert.equal(run('PostToolUse', success), '', 'successful exit stays silent even with diagnostic-looking output');

  const unknown = payload('post-tool-use-unknown.json', root, `${name}-unknown-session`);
  unknown.tool_response.stderr = COMMITLINT_OUTPUT;
  assert.equal(run('PostToolUse', unknown), '', 'unknown exit stays silent despite commitlint-looking output');

  const unrelatedFailure = payload('post-tool-use-failure.json', root, `${name}-unrelated-session`);
  unrelatedFailure.tool_response.stderr = 'fatal: not a git repository';
  assert.equal(run('PostToolUse', unrelatedFailure), '', 'unrelated failed command output stays silent');
}

test('Codex packaged and user-hook carriers deliver E-0003 without changing tool flow', () => {
  registeredHook(PLUGIN_ROOT, 'PreToolUse');
  const stagedPlugin = stagePlugin();
  const preToolUse = registeredHook(stagedPlugin, 'PreToolUse');
  const postToolUse = registeredHook(stagedPlugin, 'PostToolUse');
  assert.ok(preToolUse && postToolUse);
  carrierRoundTrip((event, input) => runNative(stagedPlugin, event, input), 'native');

  const codexHome = path.join(TEMP, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  const configFile = path.join(codexHome, 'config.toml');
  fs.writeFileSync(configFile, 'model = "fixture"\n', 'utf8');
  const configBefore = fs.readFileSync(configFile, 'utf8');
  const installed = compat.install({ allowUnreleasedSource: true, codexHome, sourcePluginRoot: stagedPlugin });
  assert.equal(installed.status, 'installed');
  assert.equal(installed.trustChanged, false, 'compatibility install does not change Codex hook trust');
  const hooksFile = path.join(codexHome, 'hooks.json');
  const config = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBefore, 'config.toml stays byte-identical');
  carrierRoundTrip((event, input) => runCompatibility(config, event, input), 'compat');
});

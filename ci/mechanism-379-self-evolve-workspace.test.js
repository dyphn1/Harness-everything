#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-workspace-379-'));
const workspace = path.join(temp, 'workspace');
const stateHome = path.join(temp, 'state');
fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
const env = { ...process.env, HARNESS_STATE_HOME: stateHome };
for (const key of ['HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR']) delete env[key];
const canonical = require('../scripts/lib/workspace');
const oldState = process.env.HARNESS_STATE_HOME;
process.env.HARNESS_STATE_HOME = stateHome;
const state = canonical.getWorkspaceStateDir(workspace);
if (oldState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = oldState;
const candidateId = 'lesson-0123456789abcdef01234567';
const candidate = { schemaVersion: 1, candidateId, state: 'proposed' };
const candidateDir = path.join(state, 'state', 'sessions', 'test', 'learning-candidates');
fs.mkdirSync(candidateDir, { recursive: true });
fs.writeFileSync(path.join(candidateDir, `${candidateId}.json`), JSON.stringify(candidate));
function layout(name, packaged = false, helper = true) {
  const root = path.join(temp, name);
  const scripts = path.join(root, packaged ? 'skills/self-evolve/scripts' : 'self-evolve/scripts');
  fs.mkdirSync(path.dirname(scripts), { recursive: true });
  fs.cpSync(path.join(ROOT, 'self-evolve/scripts'), scripts, { recursive: true });
  if (helper) {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'scripts/lib'), path.join(root, 'scripts/lib'), { recursive: true });
  }
  return { root, scripts };
}
function run(l, file, args = [], extra = {}) {
  return spawnSync(process.execPath, [path.join(l.scripts, file), ...args], { cwd: workspace, env, encoding: 'utf8', ...extra });
}
function error(result, code) {
  assert.notStrictEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, new RegExp(code));
  assert.doesNotMatch(result.stderr, /TypeError|path.join/);
}
let count = 0;
function test(name, fn) { fn(); console.log(`PASS ${name}`); count++; }
try {
  for (const packaged of [false, true]) {
    const l = layout(packaged ? 'plugin' : 'source', packaged);
    test(`${packaged ? 'plugin' : 'source'} reads canonical candidates twice deterministically`, () => {
      for (let i = 0; i < 2; i++) {
        const result = run(l, 'lesson-candidate.js', ['list', '--workspace', workspace, '--session-id', 'test']);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.deepStrictEqual(JSON.parse(result.stdout), [candidate]);
      }
    });
    test(`${packaged ? 'plugin' : 'source'} empty session is []`, () => {
      const result = run(l, 'lesson-candidate.js', ['list', '--workspace', workspace, '--session-id', 'empty']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout), []);
    });
    test(`${packaged ? 'plugin' : 'source'} writers retain authorization boundary`, () => {
      const result = run(l, 'persist-memory.js', ['Always verify Error.js before test changes.']);
      assert.strictEqual(result.status, 3, result.stderr);
      assert.match(result.stderr, /authorization/);
      assert.strictEqual(fs.existsSync(path.join(workspace, 'memories')), false);
    });
    test(`${packaged ? 'plugin' : 'source'} register resolves helper before usage`, () => {
      const result = run(l, 'register-dynamic-skill.js');
      assert.doesNotMatch(result.stderr, /WORKSPACE_HELPER_UNAVAILABLE|Cannot register.*resolved git/);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /No self-evolved dynamic skills/);
    });
  }
  const missing = layout('missing', true, false);
  for (const command of ['list', 'show', 'evaluate', 'promote']) test(`missing helper ${command}`, () => {
    const result = run(missing, 'lesson-candidate.js', [command, '--workspace', workspace, '--candidate-id', candidateId]);
    error(result, 'WORKSPACE_HELPER_UNAVAILABLE');
    assert.match(result.stderr, /workspace\.js/);
  });
  for (const file of ['persist-memory.js', 'register-dynamic-skill.js']) test(`missing helper ${file}`, () => {
    error(run(missing, file, file === 'persist-memory.js' ? ['Always verify Error.js before test changes.'] : []), 'WORKSPACE_HELPER_UNAVAILABLE');
  });
  test('adversarial cwd helper is never imported', () => {
    const hostile = path.join(temp, 'hostile-workspace');
    const sentinel = path.join(temp, 'untrusted-helper-loaded');
    fs.mkdirSync(path.join(hostile, '.git'), { recursive: true });
    fs.mkdirSync(path.join(hostile, 'scripts/lib'), { recursive: true });
    fs.writeFileSync(path.join(hostile, 'scripts/lib/workspace.js'), `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'loaded');`);
    error(run(missing, 'lesson-candidate.js', ['list', '--workspace', hostile], { cwd: hostile }), 'WORKSPACE_HELPER_UNAVAILABLE');
    assert.strictEqual(fs.existsSync(sentinel), false);
  });
  const broken = layout('broken');
  fs.writeFileSync(path.join(broken.root, 'scripts/lib/workspace.js'), "throw new Error('resolver dependency failed');");
  test('existing broken helper cause is visible', () => {
    const result = run(broken, 'lesson-candidate.js', ['list', '--workspace', workspace]);
    error(result, 'WORKSPACE_HELPER_UNAVAILABLE'); assert.match(result.stderr, /resolver dependency failed/);
  });
  const source = layout('unresolved');
  for (const command of ['list', 'show', 'evaluate', 'promote']) test(`unresolved workspace ${command} cannot fall back to cwd`, () => {
    error(run(source, 'lesson-candidate.js', [command, '--candidate-id', candidateId], { cwd: temp }), 'WORKSPACE_ROOT_UNRESOLVED');
  });
  for (const file of ['persist-memory.js', 'register-dynamic-skill.js']) test(`unresolved workspace ${file}`, () => {
    error(run(source, file, file === 'persist-memory.js' ? ['Always verify Error.js before test changes.'] : [], { cwd: temp }), 'WORKSPACE_ROOT_UNRESOLVED');
  });
  const invalidState = layout('invalid-state');
  fs.writeFileSync(path.join(invalidState.root, 'scripts/lib/workspace.js'), `module.exports = {getWorkspaceRoot: () => ${JSON.stringify(workspace)}, getWorkspaceStateDir: () => null, getWorkspaceKey: () => 'key'};`);
  test('null canonical state is a state diagnostic', () => {
    error(run(invalidState, 'lesson-candidate.js', ['list']), 'WORKSPACE_STATE_UNAVAILABLE');
  });
  test('candidate directory read errors are not an empty list', () => {
    const session = path.join(state, 'state', 'sessions', 'blocked');
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(path.join(session, 'learning-candidates'), 'not a directory');
    error(run(source, 'lesson-candidate.js', ['list', '--workspace', workspace, '--session-id', 'blocked']), 'WORKSPACE_STATE_UNAVAILABLE');
  });
  const blocked = path.join(temp, 'blocked-state'); fs.writeFileSync(blocked, 'not a directory');
  for (const command of ['list', 'show', 'evaluate', 'promote']) test(`unusable state ${command}`, () => {
    error(run(source, 'lesson-candidate.js', [command, '--workspace', workspace, '--candidate-id', candidateId], { env: { ...env, HARNESS_STATE_HOME: blocked } }), 'WORKSPACE_STATE_UNAVAILABLE');
  });
  test('no unintended workspace writes', () => {
    assert.deepStrictEqual(fs.readdirSync(workspace), ['.git']);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(candidateDir, `${candidateId}.json`))), candidate);
  });
  console.log(`${count} workspace resolver checks passed`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

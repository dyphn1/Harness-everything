'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseSimpleYaml, prepareWorkspace } = require('../behavioral-evals/run');
const paired = require('../behavioral-evals/paired-benchmark');
const ROOT = path.resolve(__dirname, '..');
const topology = parseSimpleYaml(fs.readFileSync(path.join(ROOT, 'behavioral-evals/cases/baseline-worktree-submodule-reachability.yaml'), 'utf8'));
const failure = { ...topology, fixture: { ...topology.fixture, setup: 'behavioral-evals/fixtures/setup/fail.js' } };
const paths = [];
const topologyFingerprints = [];
const setupHashes = [];
function track(ws) { if (ws) paths.push(ws); return ws; }
function gitText(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
function topologyFingerprint(ws) {
  return {
    child_head: gitText(path.join(ws, 'child-origin'), ['rev-parse', 'HEAD']),
    super_head: gitText(path.join(ws, 'super'), ['rev-parse', 'HEAD']),
    linked_head: gitText(path.join(ws, 'super-wt'), ['rev-parse', 'HEAD']),
    gitlink: gitText(path.join(ws, 'super-wt'), ['rev-parse', 'HEAD:libs/sub']),
  };
}
function assertTopology(ws) {
  assert.ok(fs.existsSync(path.join(ws, 'super-wt', '.git')), 'setup must construct the linked worktree');
  assert.ok(fs.existsSync(path.join(ws, '.fixture-tools', 'verify-worktree-submodule.js')), 'setup must install the grader');
}
try {
  for (const arm of ['baseline', 'treatment']) {
    for (const effect of ['skill-text', 'plugin-enforcement']) {
      const prepared = paired.prepareArmWorkspace(topology, effect, arm, 'opencode');
      track(prepared.ws);
      assertTopology(prepared.ws);
      assert.strictEqual(prepared.fixture_setup.status, 'pass');
      assert.match(prepared.fixture_setup.script_sha256, /^[0-9a-f]{64}$/);
      topologyFingerprints.push(topologyFingerprint(prepared.ws));
      setupHashes.push(prepared.fixture_setup.script_sha256);
      const failed = paired.prepareArmWorkspace(failure, effect, arm, 'opencode');
      track(failed.ws);
      assert.strictEqual(failed.ok, false);
      assert.strictEqual(failed.outcome, 'fixture-error');
      assert.strictEqual(failed.fixture_setup.exit_code, 17);
      assert.ok(!fs.existsSync(path.join(failed.ws, '.claude')), 'setup failure must precede skill installation');
      assert.ok(!fs.existsSync(path.join(failed.ws, '.opencode')), 'setup failure must precede plugin installation');
    }
  }
  assert.ok(topologyFingerprints.length >= 4);
  for (const fingerprint of topologyFingerprints.slice(1)) {
    assert.deepStrictEqual(fingerprint, topologyFingerprints[0], 'fixture setup must produce identical Git object identities across independent arms/runs');
  }
  assert.strictEqual(new Set(setupHashes).size, 1, 'all arms must retain the same checked-in setup script hash');

  const pairDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-entrypoints-')));
  let launches = 0;
  const context = { effect_type: 'skill-text', engine: 'claude', model: 'test' };
  const arms = {};
  for (const arm of ['baseline', 'treatment']) {
    arms[arm] = paired.runArm(failure, context, arm, pairDir, () => { launches++; throw new Error('model must not start'); });
    assert.strictEqual(arms[arm].outcome, 'fixture-error');
    assert.strictEqual(arms[arm].fixture_setup.exit_code, 17);
    assert.strictEqual(arms[arm].tool_call_count, null);
  }
  assert.strictEqual(launches, 0);
  const summary = paired.summarizePairs([{ id: topology.id, arms }], 10);
  assert.strictEqual(summary.fixture_failures, 1);
  assert.strictEqual(summary.included_pairs, 0);
  assert.deepStrictEqual(summary.arm_outcomes, { baseline: { pass: 0, fail: 0 }, treatment: { pass: 0, fail: 0 } });

  const plugin = require('../behavioral-evals/run-with-plugin');
  const failed = plugin.runCase(failure, () => { launches++; throw new Error('model must not start'); });
  track(failed.workspace);
  assert.strictEqual(failed.outcome, 'fixture-error');
  assert.strictEqual(failed.fixture_setup.exit_code, 17);
  assert.strictEqual(launches, 0);
  assert.ok(!fs.existsSync(path.join(failed.workspace, '.harness-src')), 'failed setup must precede Harness installation');

  // Exercise the same public case path as the plugin CLI, without calling a model.
  const result = plugin.runCase(topology, (_prompt, ws) => {
    launches++;
    assertTopology(ws);
    const transcript = path.join(pairDir, 'plugin-transcript.jsonl');
    fs.writeFileSync(transcript, '');
    return transcript;
  });
  track(result.workspace);
  assert.strictEqual(launches, 1);
  assert.strictEqual(result.fixture_setup.status, 'pass');
  assert.strictEqual(result.outcome, 'fail', 'an untouched topology must fail the actual final-state graders');

  for (const fixture of [
    { files: [{ path: '../escape', content: 'bad' }] },
    { files: [{ path: 'seed', content: 'ok' }], setup: '../escape.js' },
  ]) {
    const result = prepareWorkspace({ id: 'invalid-fixture', fixture });
    track(result.workspace);
    assert.strictEqual(result.outcome, 'fixture-error');
  }
  // The public CLIs must retain fixture-error evidence and exit nonzero.
  const caseId = `fixture-entrypoints-failure-${process.pid}`;
  const casePath = path.join(ROOT, 'behavioral-evals/cases', `${caseId}.yaml`);
  fs.writeFileSync(casePath, `id: ${caseId}
name: Fixture failure CLI control
loaded_skills:
  - git-commit
fixture:
  files:
    - path: seed.txt
      content: seed
  setup: behavioral-evals/fixtures/setup/fail.js
prompt: This model session must never start.
max_turns: 1
expectations:
  - type: file_contains
    path: seed.txt
    value: seed
`);
  paths.push(casePath);
  const pairedCli = spawnSync(process.execPath, [
    path.join(ROOT, 'behavioral-evals/paired-benchmark.js'), 'run',
    '--effect', 'skill-text', '--engine', 'claude', '--model', 'fixture-test',
    '--min-effect-pp', '10', '--case', caseId,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  const summaryMatch = pairedCli.stdout.match(/Summary: (.+)/);
  assert.ok(summaryMatch, pairedCli.stderr || pairedCli.stdout);
  const summaryPath = summaryMatch[1].trim();
  track(path.dirname(summaryPath));
  assert.strictEqual(pairedCli.status, 1, pairedCli.stderr);
  const cliSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.strictEqual(cliSummary.fixture_failures, 1);
  assert.strictEqual(cliSummary.included_pairs, 0);
  const pluginCli = spawnSync(process.execPath, [
    path.join(ROOT, 'behavioral-evals/run-with-plugin.js'), 'run', '--case', caseId,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(pluginCli.status, 1, pluginCli.stderr);
  const resultMatch = pluginCli.stdout.match(/fixture-error -> (.+)/);
  assert.ok(resultMatch, pluginCli.stdout);
  const resultPath = resultMatch[1].trim();
  paths.push(resultPath);
  const pluginFailure = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  track(pluginFailure.workspace);
  assert.strictEqual(pluginFailure.fixture_setup.exit_code, 17);
  assert.ok(!fs.existsSync(path.join(pluginFailure.workspace, '.harness-src')));

  console.log('Fixture entrypoints: paired baseline/treatment and plugin execute setup; failures skip installation/model and are excluded from scores.');
} finally {
  for (const dir of paths) fs.rmSync(dir, { recursive: true, force: true });
}

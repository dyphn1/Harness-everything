'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { selectTier, TIER_OPTIONS } = require('../harness-everything/scripts/system-one/router');
const root = path.resolve(__dirname, '..');
function scorer(id = 'tier2', domain = 'harness-routing-v1') {
  return req => ({ status: 'scored', response: { schemaVersion: 1, requestHash: req.requestHash, catalogHash: req.catalogHash,
    model: { id: 'fixture', revision: 'v1', domain }, scores: req.options.map(o => ({ id: o.id, probability: o.id === id ? 1 : 0 })) } });
}
test('S1-R01 off/shadow/prefer and rollback', () => {
  const input = { prompt: '實作功能', tier: 'Unclassified' };
  const forbidden = () => { throw new Error('must not invoke'); };
  assert.deepEqual(selectTier(input, {}, forbidden), { tier: input.tier, diagnostic: null });
  assert.equal(selectTier(input, { HARNESS_SYSTEM_ONE_MODE: 'off' }, forbidden).tier, input.tier);
  for (const mode of ['shadow', 'prefer']) {
    let captured;
    const result = selectTier(input, { HARNESS_SYSTEM_ONE_MODE: mode }, req => { captured = req; return scorer()(req); });
    assert.deepEqual(captured.options, TIER_OPTIONS);
    assert.equal(result.tier, mode === 'prefer' ? 'Tier 2 (Standard Task)' : input.tier);
    assert.equal(result.diagnostic.status, 'accepted');
    assert.ok(!JSON.stringify(result.diagnostic).includes(input.prompt));
  }
  assert.equal(selectTier(input, { HARNESS_SYSTEM_ONE_MODE: 'unknown' }, forbidden).diagnostic.reason, 'invalid-mode');
});
test('S1-R02 explicit precedence, abstention and every failure leave fallback intact', () => {
  const env = { HARNESS_SYSTEM_ONE_MODE: 'prefer' };
  const input = { prompt: 'use fable architecture', tier: 'Tier 3 (Macro Task)' };
  assert.equal(selectTier({ ...input, explicit: true }, env, scorer('tier1')).tier, input.tier);
  for (const provider of [scorer('unclassified'), scorer('tier1', 'forms-v1'), () => ({ status: 'unavailable', reason: 'provider-timeout' }), () => ({ status: 'scored', response: null }), () => { throw new Error('secret'); }]) {
    const result = selectTier(input, env, provider);
    assert.equal(result.tier, input.tier);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(selectTier({ ...input, prompt: '' }, env, scorer()).diagnostic.reason, 'invalid-request');
});
test('S1-R03 real CLI/kernel off parity and shadow failure repeated', () => {
  const script = path.join(root, 'harness-everything/scripts/kernel-router-core.js');
  const run = mode => spawnSync(process.execPath, [script, 'deploy to production'], { cwd: root, encoding: 'utf8', env: { ...process.env, HARNESS_SYSTEM_ONE_MODE: mode, HARNESS_SYSTEM_ONE_CONFIG: '' } });
  const off = run('off'); assert.equal(off.status, 0);
  const baseline = run(''); assert.equal(off.stdout, baseline.stdout);
  const one = run('shadow'); const two = run('shadow');
  assert.equal(one.status, 0); assert.equal(one.stdout, two.stdout); assert.equal(one.stderr, two.stderr);
  assert.match(one.stdout, /SYSTEM ONE.*provider-config/);
  const parse = text => JSON.parse(text.match(/ROUTER WORKFLOW PLAN \(JSON\): (.*)/)[1]);
  assert.deepEqual(parse(one.stdout), parse(off.stdout));
  assert.equal(parse(one.stdout).actionGate.required, true);
});
test('S1-R04 integrated accepted route preserves policy and explicit model choice', () => {
  const provider = require('../harness-everything/scripts/system-one/provider');
  const original = provider.score; const log = console.log; const env = process.env.HARNESS_SYSTEM_ONE_MODE;
  try {
    process.env.HARNESS_SYSTEM_ONE_MODE = 'prefer'; console.log = () => {};
    provider.score = scorer('tier1');
    const { run } = require('../harness-everything/scripts/tier-router');
    const risky = run('deploy to production; save lesson to memory');
    assert.equal(risky.workflowPlan.actionGate.required, true);
    assert.notEqual(risky.workflowPlan.memory.write, 'none');
    const explicit = run('use fable-staged without subagents');
    assert.notEqual(explicit.workflowPlan.strategy, 'direct-single');
    assert.ok(explicit.workflowPlan.requiredInvariants.includes('replan-after-repeated-failure'));
    const normal = run('unusual bounded wording');
    assert.equal(normal.workflowPlan.tier, 'tier1');
  } finally { provider.score = original; console.log = log; if (env === undefined) delete process.env.HARNESS_SYSTEM_ONE_MODE; else process.env.HARNESS_SYSTEM_ONE_MODE = env; }
});

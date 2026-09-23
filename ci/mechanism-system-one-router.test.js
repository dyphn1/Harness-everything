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
test('S1-R05 structural floor: a scorer can raise but never lower a deterministic macro/multi-task tier', () => {
  const env = { HARNESS_SYSTEM_ONE_MODE: 'prefer' };
  const macro = { prompt: 'audit every skill in the repository', tier: 'Tier 3 (Macro Task)', floor: 'tier3' };
  for (const id of ['tier1', 'tier2']) {
    const result = selectTier(macro, env, scorer(id));
    assert.equal(result.tier, macro.tier);
    assert.equal(result.diagnostic.applied, false);
    assert.equal(result.diagnostic.reason, 'structural-floor');
    assert.equal(result.diagnostic.selectedId, id);
  }
  const multi = { prompt: 'x', tier: 'Tier 2 (Standard Task)', floor: 'tier2' };
  assert.equal(selectTier(multi, env, scorer('tier1')).tier, multi.tier);
  assert.equal(selectTier(multi, env, scorer('tier3')).tier, 'Tier 3 (Macro Task)');
  assert.equal(selectTier({ ...multi, floor: null }, env, scorer('tier1')).tier, 'Tier 1 (Trivial)');
  assert.equal(selectTier({ ...multi, floor: 'tier9' }, env, () => { throw new Error('must not invoke'); }).diagnostic.reason, 'invalid-request');

  const provider = require('../harness-everything/scripts/system-one/provider');
  const original = provider.score; const log = console.log; const mode = process.env.HARNESS_SYSTEM_ONE_MODE;
  try {
    console.log = () => {};
    const { run } = require('../harness-everything/scripts/tier-router');
    for (const prompt of ['audit every skill in the repository', 'Refactor the parser. Then update the tests and also the docs. Finally rerun CI.']) {
      process.env.HARNESS_SYSTEM_ONE_MODE = 'off';
      const lexical = run(prompt).workflowPlan;
      process.env.HARNESS_SYSTEM_ONE_MODE = 'prefer'; provider.score = scorer('tier1');
      assert.deepEqual(run(prompt).workflowPlan, lexical);
      provider.score = original;
    }
    process.env.HARNESS_SYSTEM_ONE_MODE = 'prefer'; provider.score = scorer('tier1');
    const plan = run('audit every skill in the repository').workflowPlan;
    assert.equal(plan.tier, 'tier3');
    assert.notEqual(plan.strategy, 'direct-single');
    assert.equal(plan.verification.independent, true);
  } finally { provider.score = original; console.log = log; if (mode === undefined) delete process.env.HARNESS_SYSTEM_ONE_MODE; else process.env.HARNESS_SYSTEM_ONE_MODE = mode; }
});
test('S1-R07 a scored result with calibrated acceptance thresholds decides with them', () => {
  const env = { HARNESS_SYSTEM_ONE_MODE: 'prefer' };
  const input = { prompt: 'rename tmp to buffer', tier: 'Unclassified' };
  const soft = (acceptance) => req => ({ status: 'scored', ...(acceptance ? { acceptance } : {}), response: { schemaVersion: 1, requestHash: req.requestHash, catalogHash: req.catalogHash,
    model: { id: 'fixture', revision: 'v1', domain: 'harness-routing-v1' }, scores: req.options.map(o => ({ id: o.id, probability: o.id === 'tier2' ? 0.7 : 0.1 })) } });
  const without = selectTier(input, env, soft(null));
  assert.equal(without.diagnostic.reason, 'low-confidence');
  assert.equal(without.tier, input.tier);
  const withThresholds = selectTier(input, env, soft({ minConfidence: 0.6, minMargin: 0.3 }));
  assert.equal(withThresholds.diagnostic.status, 'accepted');
  assert.equal(withThresholds.tier, 'Tier 2 (Standard Task)');
  assert.equal(selectTier(input, env, soft({ minConfidence: 0.6, minMargin: 0.7 })).diagnostic.reason, 'low-margin');
});
test('S1-R06 prescoreTier: off loads nothing; a matching request reuses the async result; mismatch and failure keep sync semantics', async () => {
  const { prescoreTier } = require('../harness-everything/scripts/system-one/router');
  const provider = require('../harness-everything/scripts/system-one/provider');
  const forbidden = () => { throw new Error('must not invoke'); };
  for (const env of [{}, { HARNESS_SYSTEM_ONE_MODE: 'off' }, { HARNESS_SYSTEM_ONE_MODE: 'bogus' }]) assert.equal(await prescoreTier('實作功能', env, forbidden), null);
  assert.equal(await prescoreTier('', { HARNESS_SYSTEM_ONE_MODE: 'shadow' }, forbidden), null);
  const env = { HARNESS_SYSTEM_ONE_MODE: 'prefer', HARNESS_SYSTEM_ONE_CONFIG: '/abs/manifest.json' };
  const input = { prompt: '實作功能', tier: 'Unclassified' };
  const configs = [];
  const pre = await prescoreTier(input.prompt, env, async (req, config) => { configs.push(config); return scorer('tier2')(req); });
  assert.deepEqual(configs, ['/abs/manifest.json']);
  assert.deepEqual(selectTier(input, env, pre), selectTier(input, env, scorer('tier2')));
  const original = provider.score;
  try {
    let used = 0;
    provider.score = req => { used += 1; return scorer('tier3')(req); };
    assert.equal(selectTier({ ...input, prompt: 'different prompt' }, env, pre).tier, 'Tier 3 (Macro Task)');
    assert.equal(used, 1);
  } finally { provider.score = original; }
  const failing = await prescoreTier(input.prompt, env, async () => { throw new Error('secret'); });
  const failed = selectTier(input, env, failing);
  assert.deepEqual(failed, selectTier(input, env, () => { throw new Error('secret'); }));
  assert.equal(failed.diagnostic.reason, 'provider-unavailable');
  assert.ok(!JSON.stringify(failed).includes('secret'));
});

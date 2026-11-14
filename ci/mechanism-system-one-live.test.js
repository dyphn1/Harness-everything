'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const provider = require('../harness-everything/scripts/system-one/provider');
const { createRequest } = require('../harness-everything/scripts/system-one/contract');
const router = require('../harness-everything/scripts/system-one/router');
const { INTENT_OPTIONS } = require('../harness-everything/scripts/system-one/catalogs');

const idHash = value => crypto.createHash('sha256').update(value).digest('hex');
const stages = {
  validity: {
    options: ['invalid'],
    thresholds: { invalid: 0.55 },
  },
  intent: {
    options: INTENT_OPTIONS.map(option => option.id),
    thresholds: Object.fromEntries(INTENT_OPTIONS.map(option => [option.id, option.id === 'unclassified' ? 1 : 0.55])),
    referenceOnly: ['unclassified'],
  },
  tier: {
    options: ['tier1', 'tier2', 'tier3'],
    thresholds: { tier1: 0.6, tier2: 0.65, tier3: 0.7 },
  },
};
const intentScores = () => Object.fromEntries(stages.intent.options
  .map(id => [id, id === 'unclassified' ? 0.99 : ({ feature: 0.91, fix: 0.8, docs: 0.72 })[id] || 0.1]));

function activeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-live-'));
  const dir = path.join(root, 'v1');
  fs.mkdirSync(dir);
  const manifestStages = {};
  for (const [stage, data] of Object.entries(stages)) {
    const weights = `${stage}.safetensors`;
    const config = `${stage}.json`;
    const weightsBytes = Buffer.from(`${stage}-weights`);
    const configBytes = Buffer.from(JSON.stringify({ stage }));
    fs.writeFileSync(path.join(dir, weights), weightsBytes);
    fs.writeFileSync(path.join(dir, config), configBytes);
    manifestStages[stage] = {
      weights,
      config,
      sha256: idHash(weightsBytes),
      options: data.options,
      thresholds: data.thresholds,
      ...(data.referenceOnly ? { referenceOnly: data.referenceOnly } : {}),
    };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    version: 'v1',
    createdAt: '2026-11-14T00:00:00.000Z',
    stages: manifestStages,
    evaluation: null,
  }));
  fs.writeFileSync(path.join(root, 'active.json'), JSON.stringify({
    schemaVersion: 1,
    version: 'v1',
    dir,
    previous: null,
    activatedAt: '2026-11-14T00:00:00.000Z',
  }));
  return { root, dir, env: { HARNESS_SYSTEM_ONE_HOME: root } };
}

function response(request, probabilities) {
  return {
    schemaVersion: 1,
    requestHash: request.requestHash,
    catalogHash: request.catalogHash,
    model: { id: 'v1', revision: 'v1', domain: 'harness-routing-v1' },
    scores: request.options.map((option, i) => ({ id: option.id, probability: probabilities[i] })),
  };
}

test('S1-L01 reads the active pointer and rejects a stage that escapes its version directory', () => {
  const fixture = activeFixture();
  try {
    const active = provider.readActive(fixture.env);
    assert.equal(active.version, 'v1');
    assert.equal(active.dir, fixture.dir);
    assert.deepEqual(Object.keys(active.stages), ['validity', 'intent', 'tier']);
    const resident = require('../harness-everything/scripts/system-one/resident');
    const [python, args] = resident.defaultActiveCommand(active);
    assert.equal(python, active.python);
    assert.deepEqual(args.slice(1), ['--serve-active']);
    const manifestPath = path.join(fixture.dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.stages.intent.weights = '../outside.safetensors';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.equal(provider.readActive(fixture.env), null);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('S1-L02 scores validity, intent, tier in order with independent probabilities and stops on invalid', async () => {
  const fixture = activeFixture();
  try {
    const calls = [];
    const liveEnv = { ...fixture.env, HARNESS_SYSTEM_ONE_MODE: 'live' };
    const runWithFake = async (stage, request) => {
      calls.push(stage);
      const values = stage === 'validity' ? [0.18]
        : stage === 'intent' ? request.options.map(option => ({ feature: 0.91, fix: 0.8, docs: 0.72 })[option.id] || 0.1)
          : [0.2, 0.76, 0.9, 0.1];
      return { status: 'scored', response: response(request, values) };
    };
    const result = await router.prescoreLive('fixture context', liveEnv,
      (prompt, env, options) => provider.scoreLive(prompt, env, options, runWithFake));
    assert.deepEqual(calls, ['validity', 'intent', 'tier']);
    assert.deepEqual(result.stageScores.validity, { invalid: 0.18 });
    assert.equal(result.stageScores.intent.feature, 0.91);
    assert.equal(result.stageScores.tier.tier3, 0.9);
    assert.equal(result.sha256, activeFixtureHash(fixture));

    calls.length = 0;
    const repeated = await router.prescoreLive('fixture context', liveEnv,
      (prompt, env, options) => provider.scoreLive(prompt, env, options, runWithFake));
    assert.deepEqual(repeated, result);
    assert.deepEqual(calls, ['validity', 'intent', 'tier']);
    calls.length = 0;
    const invalid = await router.prescoreLive('fixture context', liveEnv, (prompt, env, options) => provider.scoreLive(prompt, env, options, async (stage, request) => {
      calls.push(stage);
      return { status: 'scored', response: response(request, [0.9]) };
    }));
    assert.deepEqual(calls, ['validity']);
    assert.deepEqual(invalid.stageScores, { validity: { invalid: 0.9 }, intent: null, tier: null });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('reference-only validity reports its score and abstains without scoring later stages', async () => {
  const fixture = activeFixture();
  try {
    const manifestFile = path.join(fixture.dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.stages.validity.thresholds.invalid = 1;
    manifest.stages.validity.referenceOnly = ['invalid'];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const calls = [];
    const result = await provider.scoreLive('fixture context', fixture.env, {
      validity: router.VALIDITY_OPTIONS,
      intent: require('../harness-everything/scripts/system-one/catalogs').INTENT_OPTIONS,
      tier: router.TIER_OPTIONS,
    }, async (stage, request) => {
      calls.push(stage);
      return { status: 'scored', response: response(request, [1]) };
    });
    assert.deepEqual(calls, ['validity']);
    assert.equal(result.stageScores.validity.invalid, 1);
    const routed = router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, result);
    assert.equal(routed.systemOne.decision.validity, 'abstain');
    assert.deepEqual(routed.reference.referenceOnlyOptions, [{ stage: 'validity', id: 'invalid', probability: 1 }]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function activeFixtureHash(fixture) {
  return JSON.parse(fs.readFileSync(path.join(fixture.dir, 'manifest.json'), 'utf8')).stages.tier.sha256.slice(0, 16);
}

test('F1 provider keeps adapter vectors and projects live sigmoid stages to option keys', async () => {
  const { validateResponse } = require('../harness-everything/scripts/system-one/contract');
  const fixture = activeFixture();
  try {
    const catalogs = {
      validity: router.VALIDITY_OPTIONS,
      intent: require('../harness-everything/scripts/system-one/catalogs').INTENT_OPTIONS,
      tier: router.TIER_OPTIONS,
    };
    const adapterResponses = [];
    const result = await provider.scoreLive('fixture context', fixture.env, catalogs, async (stage, request) => {
      const values = stage === 'validity' ? [0.1]
        : stage === 'intent' ? request.options.map(option => ({ fix: 0.9, test: 0.8 })[option.id] || 0.1)
          : [0.2, 0.76, 0.9, 0.1];
      const scored = response(request, values);
      adapterResponses.push({ request, scored });
      return { status: 'scored', response: scored };
    });

    assert.ok(adapterResponses.every(({ request, scored }) => Array.isArray(scored.scores) && validateResponse(request, scored)));
    assert.deepEqual(result.stageScores.validity, { invalid: 0.1 });
    assert.equal(result.stageScores.intent.fix, 0.9);
    assert.equal(result.stageScores.intent.test, 0.8);
    assert.equal(result.stageScores.intent.unclassified, 0.1);
    assert.deepEqual(result.stageScores.tier, { tier1: 0.2, tier2: 0.76, tier3: 0.9 });
    assert.ok(Object.values(result.stageScores.tier).reduce((sum, score) => sum + score, 0) > 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('F1 router keeps legacy simplex selection separate from live keyed sigmoid routing', () => {
  const legacy = router.selectTier({ tier: 'Tier 3 (Macro Task)', prompt: 'fixture context', floor: null, explicit: false },
    { HARNESS_SYSTEM_ONE_MODE: 'prefer' }, request => ({ status: 'scored', response: response(request, [0.95, 0.03, 0.01, 0.01]) }));
  assert.equal(legacy.tier, 'Tier 1 (Trivial)');

  const live = router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, {
    version: 'v1', sha256: '0123456789abcdef',
    stageScores: { validity: { invalid: 0.1 }, intent: intentScores(), tier: { tier1: 0.2, tier2: 0.76, tier3: 0.9 } },
    thresholds: { validity: { invalid: 0.55 }, intent: stages.intent.thresholds, tier: stages.tier.thresholds },
  });
  assert.equal(live.tier, 'Tier 3 (Macro Task)');
  assert.equal(live.systemOne.decision.tier, 'tier3');
});

test('S1-L03 precedence keeps explicit choices and the structural floor, otherwise applies a scored tier', () => {
    const result = {
    version: 'v1', sha256: '0123456789abcdef',
    stageScores: {
      validity: { invalid: 0.1 },
      intent: intentScores(),
      tier: { tier1: 0.2, tier2: 0.76, tier3: 0.9 },
    },
    thresholds: { validity: { invalid: 0.55 }, intent: stages.intent.thresholds, tier: stages.tier.thresholds },
  };
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, result).tier, 'Tier 3 (Macro Task)');
  const lowerThanLexical = { ...result, stageScores: { ...result.stageScores, tier: { tier1: 0.2, tier2: 0.9, tier3: 0.4 } } };
  assert.equal(router.routeLive({ tier: 'Tier 3 (Macro Task)', floor: null, explicit: false }, lowerThanLexical).tier, 'Tier 2 (Standard Task)');
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: 'tier3', explicit: false }, result).tier, 'Tier 3 (Macro Task)');
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: 'tier2', explicit: false }, result).tier, 'Tier 3 (Macro Task)');
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: true }, result).tier, 'Tier 2 (Standard Task)');
  const belowThreshold = { ...result, stageScores: { ...result.stageScores, tier: { tier1: 0.2, tier2: 0.3, tier3: 0.4 } } };
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, belowThreshold).tier, 'Tier 2 (Standard Task)');
  const bestBelowThreshold = { ...result,
    stageScores: { ...result.stageScores, tier: { tier1: 0.2, tier2: 0.76, tier3: 0.8 } },
    thresholds: { ...result.thresholds, tier: { tier1: 0.6, tier2: 0.65, tier3: 0.9 } },
  };
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, bestBelowThreshold).tier, 'Tier 2 (Standard Task)');
  const tiedBest = { ...result, stageScores: { ...result.stageScores, tier: { tier1: 0.2, tier2: 0.9, tier3: 0.9 } } };
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, tiedBest).systemOne.decision.tier, null);
  const invalid = { ...result, stageScores: { validity: { invalid: 0.9 }, intent: null, tier: null } };
  const invalidRoute = router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, invalid);
  assert.equal(invalidRoute.tier, 'Tier 2 (Standard Task)');
  assert.deepEqual(invalidRoute.systemOne.decision, { validity: 'invalid', intents: [], tier: null });
  assert.equal(router.routeLive({ tier: 'Tier 2 (Standard Task)', floor: null, explicit: false }, null).systemOne, undefined);
});

test('S1-L04 workflow plan carries the fixed object and user output labels scores as reference confidence', () => {
  const { run } = require('../harness-everything/scripts/tier-router');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-live-router-'));
  const env = process.env;
  const prior = { mode: env.HARNESS_SYSTEM_ONE_MODE, contract: env.HARNESS_ROUTER_CONTRACT_PATH };
  const lines = [];
  const log = console.log;
  try {
    env.HARNESS_SYSTEM_ONE_MODE = 'live';
    env.HARNESS_ROUTER_CONTRACT_PATH = path.join(temp, 'router-contract.json');
    console.log = value => lines.push(String(value));
    const result = {
      version: 'v1', sha256: '0123456789abcdef',
      stageScores: { validity: { invalid: 0.1 }, intent: intentScores(), tier: { tier1: 0.2, tier2: 0.76, tier3: 0.9 } },
      thresholds: { validity: { invalid: 0.55 }, intent: stages.intent.thresholds, tier: stages.tier.thresholds },
    };
    const contract = run('fixture request with clear scope', null, { systemOneResult: result });
    assert.deepEqual(Object.keys(contract.workflowPlan.systemOne), ['version', 'sha256', 'mode', 'inputEnrichment', 'referenceOnly', 'validity', 'intents', 'tier', 'decision']);
    assert.deepEqual(contract.workflowPlan.systemOne.inputEnrichment, { handoffFiles: 0 });
    assert.deepEqual(contract.workflowPlan.systemOne.decision, { validity: 'actionable', intents: ['feature', 'fix', 'docs'], tier: 'tier3' });
    assert.deepEqual(JSON.parse(fs.readFileSync(env.HARNESS_ROUTER_CONTRACT_PATH, 'utf8')).workflowPlan.systemOne, contract.workflowPlan.systemOne);
    const output = lines.join('\n');
    assert.match(output, /SYSTEM ONE REFERENCE CONFIDENCE/);
    assert.match(output, /0\.91/);
    assert.match(output, /not a verdict/);
    assert.doesNotMatch(output, /selected a tier/i);
  } finally {
    console.log = log;
    if (prior.mode === undefined) delete env.HARNESS_SYSTEM_ONE_MODE; else env.HARNESS_SYSTEM_ONE_MODE = prior.mode;
    if (prior.contract === undefined) delete env.HARNESS_ROUTER_CONTRACT_PATH; else env.HARNESS_ROUTER_CONTRACT_PATH = prior.contract;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('S1-L05 explicit off is byte-identical to the historical default and omits System One', () => {
  const { run } = require('../harness-everything/scripts/tier-router');
  const env = process.env;
  const prior = env.HARNESS_SYSTEM_ONE_MODE;
  const capture = mode => {
    if (mode === undefined) delete env.HARNESS_SYSTEM_ONE_MODE;
    else env.HARNESS_SYSTEM_ONE_MODE = mode;
    const lines = [];
    const log = console.log;
    try {
      console.log = value => lines.push(String(value));
      return { contract: run('fixture request with clear scope'), output: lines.join('\n') };
    } finally { console.log = log; }
  };
  try {
    const historicalDefault = capture(undefined);
    const explicitOff = capture('off');
    assert.equal(explicitOff.output, historicalDefault.output);
    assert.deepEqual(explicitOff.contract, historicalDefault.contract);
    assert.equal(Object.hasOwn(explicitOff.contract.workflowPlan, 'systemOne'), false);
  } finally {
    if (prior === undefined) delete env.HARNESS_SYSTEM_ONE_MODE; else env.HARNESS_SYSTEM_ONE_MODE = prior;
  }
});

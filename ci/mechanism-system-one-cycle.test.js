'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { buildDataset } = require('../scripts/system-one-cycle/build');
const { judgeRows } = require('../scripts/system-one-cycle/judge');
const { runGuarded, processTreeRssMb } = require('../scripts/system-one-cycle/train');
const { buildVersion, trainerCatalogs } = require('../scripts/system-one-cycle/package');
const install = require('../harness-everything/scripts/system-one/install');
const provider = require('../harness-everything/scripts/system-one/provider');
const router = require('../harness-everything/scripts/system-one/router');
const { CATALOGS } = require('../harness-everything/scripts/system-one/catalogs');

const root = path.resolve(__dirname, '..');

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

function syntheticCycle(dir) {
  const training = path.join(dir, 'training');
  const prompts = [
    { id: 'agent-dispatch', family: 'family-agent', source: 'agent-dispatch', split: 'train', text: 'synthetic-agent-dispatch-case', previous: 'synthetic-previous-field' },
    { id: 'agrees', family: 'family-agrees', source: 'observation', split: 'train', text: 'synthetic-agreement-case', previous: 'synthetic-previous-field' },
    { id: 'writes', family: 'family-writes', source: 'observation', split: 'train', text: 'synthetic-write-evidence-case' },
    { id: 'vote', family: 'family-vote', source: 'observation', split: 'train', text: 'synthetic-majority-vote-case' },
    { id: 'null-vote', family: 'family-null-vote', source: 'observation', split: 'train', text: 'synthetic-null-consensus-case' },
    { id: 'validity-conflict', family: 'family-validity-conflict', source: 'observation', split: 'train', text: 'synthetic-validity-conflict-case' },
    { id: 'split-train', family: 'family-split-train', source: 'observation', split: 'train', text: 'same normalized synthetic phrase' },
    { id: 'split-validation', family: 'family-split-validation', source: 'observation', split: 'validation', text: 'Same, normalized synthetic phrase!' },
    { id: 'no-majority', family: 'family-no-majority', source: 'observation', split: 'train', text: 'synthetic-no-majority-case' },
    { id: 'no-vote', family: 'family-no-vote', source: 'observation', split: 'train', text: 'synthetic-missing-vote-case' },
    { id: 'holdout-copy', family: 'family-holdout', source: 'observation', split: 'train', text: 'holdout only synthetic sentinel' },
    { id: 'invalid', family: 'family-invalid', source: 'observation', split: 'train', text: 'synthetic-context-dependent-case' },
  ];
  writeJsonl(path.join(training, 'observed/prompts-observed.jsonl'), prompts);
  writeJsonl(path.join(training, 'observed/labels-observed.jsonl'), [
    { id: 'agrees', tier: 'tier2', contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'writes', tier: 'tier1', contextDependent: true, contradictions: ['tier1-with-writes'], behaviorEvidence: 'observed' },
    { id: 'vote', tier: 'tier1', contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'null-vote', tier: 'tier2', contextDependent: false, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'validity-conflict', tier: 'tier2', contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'split-train', tier: 'tier2', contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'split-validation', tier: 'tier2', contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'no-majority', tier: 'tier1', contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'no-vote', tier: 'tier1', contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'invalid', tier: null, contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
  ]);
  writeJsonl(path.join(training, 'relabel-luna/labels.jsonl'), [
    ...['agent-dispatch', 'agrees', 'writes', 'split-train', 'split-validation'].map(id => ({ id, gold: id === 'writes' ? 'tier1' : id === 'agrees' || id.startsWith('split') ? 'tier2' : 'tier3' })),
    { id: 'vote', gold: 'tier2' }, { id: 'null-vote', gold: 'tier1' }, { id: 'validity-conflict', gold: null },
    { id: 'no-majority', gold: 'tier2' }, { id: 'no-vote', gold: 'tier2' },
    { id: 'holdout-copy', gold: 'tier2' }, { id: 'invalid', gold: null },
  ]);
  writeJsonl(path.join(training, 'relabel-luna/labels-intent.jsonl'), prompts.map(row => ({
    id: row.id, gold: row.id === 'invalid' || row.id === 'holdout-copy' || row.id === 'validity-conflict' ? null : 'feature', secondary: [],
  })));
  writeJsonl(path.join(training, 'adjudication/consensus.jsonl'), [
    { id: 'vote', status: 'majority', consensus: 'tier3', votes: [{ judge: 'luna', tier: 'tier3' }, { judge: 'opencode', tier: 'tier3' }] },
    { id: 'null-vote', status: 'unanimous', consensus: null, votes: [{ judge: 'luna', tier: null }, { judge: 'opencode', tier: null }] },
    { id: 'validity-conflict', status: 'majority', consensus: 'tier2', votes: [{ judge: 'luna', tier: 'tier2' }, { judge: 'opencode', tier: 'tier2' }] },
    { id: 'no-majority', status: 'no-majority', consensus: null, votes: [{ judge: 'luna', tier: 'tier2' }, { judge: 'opencode', tier: 'tier3' }] },
  ]);
  const holdout = path.join(dir, 'holdout.json');
  fs.writeFileSync(holdout, JSON.stringify({ schemaVersion: 1, cases: [{ request: { context: 'holdout-only synthetic sentinel' } }] }));
  return { training, holdout };
}

test('cycle dataset uses text-only labels, consensus, behavior evidence, holdout fields, and private prompt elision', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-build-'));
  try {
    const fixture = syntheticCycle(dir);
    const report = buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout] });
    const output = path.join(fixture.training, 'v1');
    const prompts = fs.readFileSync(path.join(output, 'prompts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const labels = new Map(fs.readFileSync(path.join(output, 'labels.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.id, row.gold]));
    const validityLabels = new Map(fs.readFileSync(path.join(fixture.training, 'v1-validity/labels.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.id, row.gold]));
    const intents = new Map(fs.readFileSync(path.join(output, 'labels-intent.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.id, row]));
    const ids = new Set(prompts.map(row => row.id));

    assert.equal(ids.has('agent-dispatch'), true);
    assert.equal(labels.get('agrees'), 'tier2');
    assert.equal(labels.get('vote'), 'tier3');
    assert.equal(labels.get('null-vote'), null);
    assert.equal(labels.get('validity-conflict'), 'tier2');
    assert.equal(validityLabels.get('validity-conflict'), null);
    assert.equal(labels.get('writes'), 'tier2');
    assert.equal(labels.has('no-majority'), false);
    assert.equal(labels.has('no-vote'), false);
    assert.equal(labels.has('holdout-copy'), false);
    assert.equal(labels.has('split-train'), false);
    assert.equal(labels.has('split-validation'), true);
    assert.equal(labels.get('invalid'), null);
    assert.deepEqual(intents.get('invalid'), { id: 'invalid', gold: null, secondary: [] });
    assert.ok(prompts.every(row => Object.keys(row).sort().join(',') === 'family,id,source,split,text'));
    assert.equal(fs.readFileSync(path.join(output, 'report.json'), 'utf8').includes('synthetic-'), false);
    assert.equal(report.droppedByReason['no-majority'], 1);
    assert.equal(report.droppedByReason['no-vote'], 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cycle dataset requires the real holdout request.context field', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-holdout-'));
  try {
    const fixture = syntheticCycle(dir);
    fs.writeFileSync(fixture.holdout, JSON.stringify({ schemaVersion: 1, cases: [{ request: { task: 'tier' } }] }));
    assert.throws(() => buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout] }), /request\.context/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cycle dataset rejects duplicate observed prompt ids', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-duplicate-'));
  try {
    const fixture = syntheticCycle(dir);
    const promptsFile = path.join(fixture.training, 'observed/prompts-observed.jsonl');
    const prompts = fs.readFileSync(promptsFile, 'utf8').trim().split('\n').map(JSON.parse);
    writeJsonl(promptsFile, [...prompts, { ...prompts[0], text: 'synthetic-duplicate-id-case' }]);
    assert.throws(() => buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout] }), /duplicate prompt id/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('judge resumes completed rows and records no-majority without prompt text', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-judge-'));
  try {
    const training = path.join(dir, 'training');
    writeJsonl(path.join(training, 'observed/prompts-observed.jsonl'), [
      { id: 'done', family: 'f1', source: 'observation', split: 'train', text: 'synthetic-completed-case', previous: 'synthetic-private-context' },
      { id: 'todo', family: 'f2', source: 'observation', split: 'train', text: 'synthetic-pending-case', previous: 'synthetic-private-context' },
    ]);
    writeJsonl(path.join(training, 'observed/labels-observed.jsonl'), [
      { id: 'done', tier: 'tier1' }, { id: 'todo', tier: 'tier1' },
    ]);
    writeJsonl(path.join(training, 'relabel-luna/labels.jsonl'), [
      { id: 'done', gold: 'tier2' }, { id: 'todo', gold: 'tier2' },
    ]);
    writeJsonl(path.join(training, 'adjudication/consensus.jsonl'), [
      { id: 'done', status: 'majority', consensus: 'tier2', votes: [{ judge: 'luna', tier: 'tier2' }, { judge: 'opencode', tier: 'tier2' }] },
    ]);
    const calls = [];
    const report = await judgeRows({ dataDir: dir, runJudge: async (engine, batch) => {
      calls.push(engine);
      assert.deepEqual(batch.map(row => row.id), ['todo']);
      return [{ i: 0, tier: engine === 'luna' ? 'tier2' : 'tier3' }];
    } });
    const saved = fs.readFileSync(path.join(training, 'adjudication/consensus.jsonl'), 'utf8');
    const rows = saved.trim().split('\n').map(JSON.parse);
    const input = fs.readFileSync(path.join(training, 'adjudication/input.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

    assert.deepEqual(calls, ['luna', 'opencode']);
    assert.equal(report.voted, 1);
    assert.equal(rows.find(row => row.id === 'todo').status, 'no-majority');
    assert.equal(saved.includes('synthetic-'), false);
    assert.deepEqual(Object.keys(input[0]).sort(), ['id', 'lunaTier', 'selfTier', 'text']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource guard kills an over-limit child and records peak RSS', async () => {
  let samples = 0;
  let rssReader;
  try { processTreeRssMb(process.pid); rssReader = processTreeRssMb; }
  catch { rssReader = () => (++samples === 1 ? 48 : 128); }
  const result = await runGuarded(process.execPath, ['-e', 'const b=Buffer.allocUnsafe(160*1024*1024); for(let i=0;i<b.length;i+=4096)b[i]=1; const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); setInterval(()=>{},1000);'], {
    maxRssMb: 96, threads: 4, pollMs: 100, rssReader,
  });
  assert.equal(result.killedForLimit, true);
  assert.ok(result.peakRssMb > 96);
  assert.equal(result.monitorFailed, false);
});

test('package writes the contract B manifest and carries evaluation into the private version directory', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-'));
  try {
    const version = 'synthetic-v1';
    const runs = path.join(dir, 'training', 'runs', version);
    const catalogs = trainerCatalogs();
    const thresholds = Object.fromEntries(Object.entries(catalogs).map(([task, options]) => [task,
      Object.fromEntries(options.map(id => [id, 0.5]))]));
    for (const [task, values] of Object.entries(thresholds)) {
      const stage = path.join(runs, task);
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, 'harness-routing-v1.safetensors'), `${task}-weights`);
      fs.writeFileSync(path.join(stage, 'harness-routing-v1.json'), JSON.stringify({ context_tokens: 1024 }));
      fs.writeFileSync(path.join(stage, 'calibration.json'), JSON.stringify({ thresholds: values }));
    }
    const candidate = path.join(dir, 'training', 'candidates', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir: candidate });
    fs.mkdirSync(path.join(candidate, 'evaluation'), { recursive: true });
    fs.writeFileSync(path.join(candidate, 'evaluation', 'curves.json'), '{}\n');
    fs.writeFileSync(path.join(candidate, 'evaluation', 'trend.json'), '{}\n');

    const output = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: candidate, versionDir: output });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));

    assert.deepEqual(Object.keys(manifest).sort(), ['createdAt', 'evaluation', 'schemaVersion', 'stages', 'version']);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.version, version);
    assert.equal(manifest.evaluation, 'evaluation/curves.json');
    assert.deepEqual(manifest.stages.validity.options, catalogs.validity);
    assert.deepEqual(manifest.stages.intent.options, catalogs.intent);
    assert.equal(manifest.stages.intent.options.includes('unclassified'), false);
    assert.deepEqual(manifest.stages.tier.thresholds, thresholds.tier);
    assert.match(manifest.stages.intent.sha256, /^[0-9a-f]{64}$/);
    assert.equal(fs.existsSync(path.join(output, 'evaluation', 'trend.json')), true);
    assert.equal('referenceOnly' in manifest.stages.validity, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writePackageRuns(dir, version, calibrationByTask) {
  const runs = path.join(dir, 'training', 'runs', version);
  for (const [task, values] of Object.entries(calibrationByTask)) {
    const stage = path.join(runs, task);
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'harness-routing-v1.safetensors'), `${task}-weights`);
    fs.writeFileSync(path.join(stage, 'harness-routing-v1.json'), JSON.stringify({ context_tokens: 1024 }));
    fs.writeFileSync(path.join(stage, 'calibration.json'), JSON.stringify({ thresholds: values }));
  }
  return runs;
}

function trainerThresholds(value = 0.5) {
  return Object.fromEntries(Object.entries(trainerCatalogs()).map(([task, options]) => [task,
    Object.fromEntries(options.map(id => [id, value]))]));
}

test('package turns a null calibration threshold into 1 and carries referenceOnly through repackaging', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-null-'));
  try {
    const version = 'synthetic-null-v1';
    const thresholds = trainerThresholds();
    thresholds.tier.tier2 = null;
    const runs = writePackageRuns(dir, version, thresholds);
    const candidate = path.join(dir, 'training', 'candidates', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir: candidate });
    const candidateManifest = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json'), 'utf8'));
    assert.equal(candidateManifest.stages.tier.thresholds.tier2, 1);
    assert.deepEqual(candidateManifest.stages.tier.referenceOnly, ['tier2']);

    const output = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: candidate, versionDir: output });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.stages.tier.thresholds.tier2, 1);
    assert.deepEqual(manifest.stages.tier.referenceOnly, ['tier2']);
    assert.equal('referenceOnly' in manifest.stages.validity, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package still rejects a non-null non-finite threshold', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-nan-'));
  try {
    const version = 'synthetic-nan-v1';
    const thresholds = trainerThresholds();
    const runs = writePackageRuns(dir, version, thresholds);
    // 1e999 overflows to Infinity, the non-null non-finite value JSON can carry.
    const calibration = path.join(runs, 'tier', 'calibration.json');
    const serialized = JSON.stringify({ thresholds: thresholds.tier });
    const keyValue = `${JSON.stringify('tier2')}:${thresholds.tier.tier2}`;
    fs.writeFileSync(calibration, serialized.replace(keyValue, `${JSON.stringify('tier2')}:1e999`));
    assert.throws(() => buildVersion({ dataDir: dir, version, sourceDir: runs,
      versionDir: path.join(dir, 'training', 'versions', version) }), /finite per-option thresholds/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package publishes a trainer-catalog version that installs, activates, and reports reference-only scores', async t => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-roundtrip-')));
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-home-')));
  try {
    const version = 'synthetic-roundtrip-v1';
    const catalogs = trainerCatalogs();
    const thresholds = Object.fromEntries(Object.entries(catalogs).map(([task, options]) => [task,
      Object.fromEntries(options.map(id => [id, 0.5]))]));
    thresholds.intent.fix = null;
    thresholds.tier.tier3 = null;
    const runs = writePackageRuns(dir, version, thresholds);
    const versionDir = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir });
    const packaged = JSON.parse(fs.readFileSync(path.join(versionDir, 'manifest.json'), 'utf8'));
    for (const [stage, ids] of Object.entries(catalogs)) {
      assert.deepEqual(packaged.stages[stage].options, ids);
      assert.equal(packaged.stages[stage].options.includes('unclassified'), false);
    }
    const scoreScript = path.join(root, 'scripts/system-one-cycle/score.py');
    const pythonCode = "import importlib.util,json,sys; spec=importlib.util.spec_from_file_location('score',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps([o['id'] for o in module.trained_catalog(sys.argv[2],'intent',sys.argv[3])]))";
    const scoredCatalog = spawnSync(process.env.PYTHON || 'python3', ['-c', pythonCode, scoreScript,
      path.join(versionDir, 'intent.safetensors'), path.join(root, 'benchmarks/fixtures/system-one-intent-holdout.json')],
    { cwd: root, encoding: 'utf8' });
    assert.equal(scoredCatalog.status, 0, scoredCatalog.stderr);
    assert.deepEqual(JSON.parse(scoredCatalog.stdout), catalogs.intent);

    const publishCommand = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-cycle.js'), 'publish',
      '--data-dir', dir, '--version', version], { cwd: root, encoding: 'utf8' });
    assert.equal(publishCommand.status, 0, publishCommand.stderr);
    const published = JSON.parse(publishCommand.stdout).steps[0];
    assert.equal(published.publishedPath, path.join(dir, 'models', 'cua-s1', version));

    install.installVersion(dir, version, home);
    install.activate(version, home);
    const env = { HARNESS_SYSTEM_ONE_HOME: home };
    const active = provider.readActive(env);
    assert.equal(active.version, version);
    const liveCatalogs = {
      validity: router.VALIDITY_OPTIONS,
      intent: CATALOGS.intent,
      tier: router.TIER_OPTIONS,
    };
    const result = await provider.scoreLive('synthetic request', env, liveCatalogs, async (_stage, request) => ({
      status: 'scored',
      response: {
        schemaVersion: 1, requestHash: request.requestHash, catalogHash: request.catalogHash,
        model: { id: version, revision: version, domain: 'harness-routing-v1' },
        scores: request.options.map(option => ({ id: option.id,
          probability: option.id === 'fix' || option.id === 'tier3' ? 0.99 : option.id === 'tier2' ? 0.8 : 0.1 })),
      },
    }));
    assert.deepEqual(result.referenceOnly, { validity: [], intent: ['fix'], tier: ['tier3'] });
    assert.equal(result.stageScores.intent.fix, 0.99);
    assert.equal(result.stageScores.tier.tier3, 0.99);
    const routed = router.routeLive({ tier: 'Tier 1 (Trivial)', floor: null, explicit: false }, result);
    assert.equal(routed.systemOne.intents.fix, 0.99);
    assert.equal(routed.systemOne.decision.intents.includes('fix'), false);
    assert.equal(routed.systemOne.decision.tier, 'tier2');
    assert.deepEqual(routed.reference.referenceOnlyOptions, [
      { stage: 'intent', id: 'fix', probability: 0.99 }, { stage: 'tier', id: 'tier3', probability: 0.99 },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('all --until build uses prepared synthetic stages and stops before training', t => {
  const base = path.join(root, '.s1-work');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'cycle-until-build-'));
  try {
    const fixture = syntheticCycle(dir);
    fs.writeFileSync(path.join(dir, 'cycle-state.json'), JSON.stringify({ schemaVersion: 1, steps: {
      collect: { completedAt: '2026-11-14T00:00:00.000Z' },
      label: { completedAt: '2026-11-14T00:00:00.000Z' },
      judge: { completedAt: '2026-11-14T00:00:00.000Z' },
    } }));
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-cycle.js'), 'all', '--until', 'build', '--data-dir', dir, '--holdout', fixture.holdout], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('synthetic-'), false);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'cycle-state.json'), 'utf8'));
    assert.ok(state.steps.build.completedAt);
    assert.equal(state.steps.train, undefined);
    assert.equal(fs.existsSync(path.join(dir, 'training/runs')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

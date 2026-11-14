'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { calibrate } = require('../scripts/system-one-calibrate');
const { CATALOGS } = require('../harness-everything/scripts/system-one/catalogs');
const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

test('S1-T01 trainer data handling is exercised without torch', () => {
  const r = spawnSync(python, [path.join(__dirname, 'system-one-train-test.py')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /trainer data tests passed/);
});

const TIER_IDS = ['tier1', 'tier2', 'tier3'];
const scoreRow = (gold, scores) => ({ gold, scores });
const tierRows = (count = 20) => TIER_IDS.flatMap(gold => Array.from({ length: count }, () => scoreRow(gold,
  Object.fromEntries(TIER_IDS.map(id => [id, id === gold ? 0.95 : 0.8])))));

test('S1-T02 per-option sigmoid thresholds maximize coverage at the precision target', () => {
  const rows = tierRows();
  const c = calibrate(rows, { minPrecision: 0.98, task: 'tier' });
  assert.equal(c.feasible, true);
  assert.equal(c.rows, 60);
  assert.deepEqual(Object.keys(c.thresholds), TIER_IDS);
  for (const id of TIER_IDS) {
    assert.equal(c.thresholds[id], 0.95);
    assert.equal(c.options[id].accepted, 20);
    assert.equal(c.options[id].precision, 1);
  }
  assert.deepEqual(calibrate(rows, { minPrecision: 0.98, task: 'tier' }), c, 'deterministic');
});

test('S1-T03 calibrator accepts legacy probability vectors and marks unsupported options infeasible', () => {
  const rows = tierRows(10).map(({ gold, scores }) => ({ gold,
    probs: [...TIER_IDS.map(id => scores[id]), 0.01] }));
  const legacy = calibrate(rows, { minPrecision: 0.98, task: 'tier' });
  assert.equal(legacy.feasible, true);
  assert.deepEqual(legacy.thresholds, { tier1: 0.95, tier2: 0.95, tier3: 0.95 });
  const none = calibrate([scoreRow('tier1', { tier1: 0.3, tier2: 0.7, tier3: 0.1 })], { minPrecision: 0.98, task: 'tier' });
  assert.equal(none.feasible, false);
  assert.equal(none.thresholds.tier2, null);
  assert.throws(() => calibrate([{ gold: 'tier1', probs: [0.9, 0.1, 0.1, 1.1] }], { task: 'tier' }));
  assert.throws(() => calibrate([{ gold: 'tier1', split: 'holdout', scores: { tier1: 0.9, tier2: 0.1, tier3: 0.1 } }], { task: 'tier' }));
});

test('S1-T07 validity and intent use the task-specific option catalogs', () => {
  const validity = calibrate([
    { gold: 'invalid', scores: { invalid: 0.9 } },
    { gold: 'actionable', scores: { invalid: 0.1 } },
  ], { task: 'validity' });
  assert.deepEqual(validity.thresholds, { invalid: 0.9 });
  const intentIds = CATALOGS.intent.map(o => o.id);
  const rows = intentIds.filter(id => id !== 'unclassified').map(gold => ({ gold,
    scores: Object.fromEntries(intentIds.map(id => [id, id === gold ? 0.95 : 0.1])) }));
  const intent = calibrate(rows, { task: 'intent' });
  assert.equal(intent.feasible, true);
  assert.deepEqual(Object.keys(intent.thresholds), intentIds.filter(id => id !== 'unclassified'));
  assert.ok(Object.values(intent.thresholds).every(threshold => threshold === 0.95));
});

test('F1 calibration keeps legacy simplex rows separate from sigmoid option scores', () => {
  const intentIds = CATALOGS.intent.map(option => option.id);
  const legacyProbs = masses => {
    const rest = (1 - Object.values(masses).reduce((sum, value) => sum + value, 0))
      / (intentIds.length - Object.keys(masses).length);
    return intentIds.map(id => Object.hasOwn(masses, id) ? masses[id] : rest);
  };
  const legacy = calibrate([
    { gold: 'fix', secondary: ['test'], probs: legacyProbs({ fix: 0.6, test: 0.3 }) },
    { gold: 'test', secondary: ['fix'], probs: legacyProbs({ fix: 0.55, test: 0.35 }) },
    { gold: 'docs', secondary: [], probs: legacyProbs({ git: 0.4, docs: 0.35 }) },
  ], { task: 'intent' });
  assert.deepEqual([legacy.secondaryThreshold, legacy.minConfidence, legacy.minMargin], [0.05, 0.5, 0.25]);

  const sigmoid = calibrate([
    { gold: 'fix', scores: Object.fromEntries(intentIds.map(id => [id, id === 'fix' ? 0.95 : 0.1])) },
    { gold: 'docs', scores: Object.fromEntries(intentIds.map(id => [id, id === 'docs' ? 0.95 : 0.1])) },
  ], { task: 'intent' });
  assert.equal(sigmoid.thresholds.fix, 0.95);
  assert.equal(sigmoid.thresholds.docs, 0.95);
  assert.equal(sigmoid.secondaryThreshold, undefined);
});

test('S1-T06 the default calibration target is the owner advisory 85%', () => {
  const c = calibrate(tierRows(10), { task: 'tier' });
  assert.equal(c.minPrecision, 0.85);
  assert.equal(c.feasible, true);
});

test('S1-T04 calibration CLI reads validation sigmoid scores and writes per-option thresholds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-cal-'));
  try {
    const input = path.join(dir, 'val-scores.jsonl');
    fs.writeFileSync(input, tierRows(10).map((r, i) => JSON.stringify({ id: `v${i}`, ...r })).join('\n') + '\n');
    const out = path.join(dir, 'calibration.json');
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-calibrate.js'), input, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(c.feasible, true); assert.equal(c.rows, 30);
    assert.deepEqual(c.thresholds, { tier1: 0.95, tier2: 0.95, tier3: 0.95 });
    assert.equal(spawnSync(process.execPath, [path.join(root, 'scripts/system-one-calibrate.js')], { encoding: 'utf8' }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-T05 real tiny training runs write option-keyed sigmoid scores and load checkpoints (skipped without torch)', t => {
  const probe = spawnSync(python, ['-c', 'import torch'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('skipped without torch'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-train-'));
  try {
  const texts = ['commit all changes', 'push and open a pr', 'add a flag with tests', 'migrate every service', 'go', 'yes'];
    const tierGolds = ['tier1', 'tier1', 'tier3', 'tier3', null, null];
    const intentIds = CATALOGS.intent.map(o => o.id).filter(id => id !== 'unclassified');
    const intentGolds = [intentIds[0], intentIds[0], intentIds[1], intentIds[1], null, null];
    const tasks = [
      { name: 'validity', golds: tierGolds, counts: { train: 36, validation: 12 }, options: ['invalid'] },
      { name: 'intent', golds: intentGolds, counts: { train: 24, validation: 8 }, options: CATALOGS.intent.map(o => o.id) },
      { name: 'tier', golds: tierGolds, counts: { train: 24, validation: 8 }, options: ['tier1', 'tier2', 'tier3'] },
    ];
    for (const task of tasks) {
      const data = path.join(dir, task.name); fs.mkdirSync(data);
      const prompts = []; const labels = []; const intentLabels = [];
      for (let k = 0; k < 8; k++) texts.forEach((text, i) => {
        const id = `${task.name}-${k}-${i}`;
        prompts.push({ id, family: `${task.name}-f${k}`, source: 'synthetic', split: k < 6 ? 'train' : 'validation', text });
        labels.push({ id, gold: tierGolds[i] });
        intentLabels.push({ id, gold: intentGolds[i], secondary: [] });
      });
      fs.writeFileSync(path.join(data, 'prompts.jsonl'), prompts.map(p => JSON.stringify(p)).join('\n') + '\n');
      fs.writeFileSync(path.join(data, 'labels.jsonl'), labels.map(p => JSON.stringify(p)).join('\n') + '\n');
      fs.writeFileSync(path.join(data, 'labels-intent.jsonl'), intentLabels.map(p => JSON.stringify(p)).join('\n') + '\n');
      const out = path.join(dir, `${task.name}-out`);
      const r = spawnSync(python, [path.join(root, 'scripts/system-one-train.py'), '--data-dir', data, '--out', out, '--epochs', '2', '--threads', '1', '--context-tokens', '64', '--task', task.name], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const report = JSON.parse(fs.readFileSync(path.join(out, 'train-report.json'), 'utf8'));
      assert.deepEqual(report.counts, task.counts);
      const scores = fs.readFileSync(path.join(out, 'val-scores.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      assert.equal(scores.length, task.counts.validation);
      for (const row of scores) {
        assert.deepEqual(Object.keys(row.scores).sort(), [...task.options].sort());
        assert.ok(Object.values(row.scores).every(p => Number.isFinite(p) && p >= 0 && p <= 1));
        assert.equal(Object.hasOwn(row, 'probs'), false);
      }
      const load = spawnSync(python, ['-c', `from cua_s1.model import load_checkpoint; m,c,cfg=load_checkpoint(r'${path.join(out, 'harness-routing-v1.safetensors')}','cpu'); print(cfg['context_tokens'])`], { encoding: 'utf8' });
      assert.equal(load.status, 0, load.stderr);
      assert.equal(load.stdout.trim(), '64');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

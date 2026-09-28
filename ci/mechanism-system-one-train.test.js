'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { calibrate, decideRow } = require('../scripts/system-one-calibrate');
const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

test('S1-T01 trainer data handling is exercised without torch', () => {
  const r = spawnSync(python, [path.join(__dirname, 'system-one-train-test.py')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /trainer data tests passed/);
});

const row = (gold, probs) => ({ gold, probs });
test('S1-T02 a validation row is accepted only above both thresholds and never as unclassified', () => {
  assert.deepEqual(decideRow([0.95, 0.03, 0.01, 0.01], { minConfidence: 0.9, minMargin: 0.2 }), 'tier1');
  assert.equal(decideRow([0.85, 0.1, 0.03, 0.02], { minConfidence: 0.9, minMargin: 0.2 }), null);
  assert.equal(decideRow([0.55, 0.45, 0, 0], { minConfidence: 0.5, minMargin: 0.2 }), null);
  assert.equal(decideRow([0.01, 0.01, 0.01, 0.97], { minConfidence: 0.5, minMargin: 0 }), null);
});

test('S1-T03 calibration maximizes coverage subject to accepted precision on validation only', () => {
  const rows = [
    ...Array.from({ length: 90 }, () => row('tier1', [0.97, 0.01, 0.01, 0.01])),
    ...Array.from({ length: 5 }, () => row('tier2', [0.8, 0.15, 0.03, 0.02])),
    ...Array.from({ length: 5 }, () => row('tier2', [0.1, 0.85, 0.03, 0.02])),
  ];
  const c = calibrate(rows, { minPrecision: 0.98 });
  assert.ok(c.precision >= 0.98, JSON.stringify(c));
  assert.equal(c.coverage, 0.95, JSON.stringify(c));
  // Either threshold may separate the rows; the chosen pair must reject the wrong ones and keep the right ones.
  assert.equal(decideRow([0.8, 0.15, 0.03, 0.02], c), null, JSON.stringify(c));
  assert.equal(decideRow([0.1, 0.85, 0.03, 0.02], c), 'tier2', JSON.stringify(c));
  const none = calibrate([row('tier1', [0.3, 0.7, 0, 0])], { minPrecision: 0.98 });
  assert.equal(none.feasible, false);
  assert.equal(none.coverage, 0);
  assert.deepEqual(calibrate(rows, { minPrecision: 0.98 }), c, 'deterministic');
});

test('S1-T06 the default calibration target is the owner advisory 85%', () => {
  const rows = [
    ...Array.from({ length: 86 }, () => row('tier1', [0.9, 0.05, 0.03, 0.02])),
    ...Array.from({ length: 14 }, () => row('tier2', [0.9, 0.05, 0.03, 0.02])),
  ];
  const c = calibrate(rows);
  assert.equal(c.minPrecision, 0.85);
  assert.equal(c.feasible, true);
  assert.equal(c.coverage, 1);
  assert.equal(calibrate(rows, { minPrecision: 0.9 }).feasible, false);
});

test('S1-T04 calibration CLI reads validation scores and writes thresholds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-cal-'));
  try {
    const input = path.join(dir, 'val-scores.jsonl');
    fs.writeFileSync(input, Array.from({ length: 50 }, (_, i) => JSON.stringify({ id: `v${i}`, gold: 'tier2', probs: [0.02, 0.95, 0.02, 0.01] })).join('\n') + '\n');
    const out = path.join(dir, 'calibration.json');
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-calibrate.js'), input, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(c.feasible, true); assert.equal(c.coverage, 1); assert.equal(c.rows, 50);
    assert.equal(spawnSync(process.execPath, [path.join(root, 'scripts/system-one-calibrate.js')], { encoding: 'utf8' }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-T05 a real tiny training run produces a checkpoint the adapter loads (skipped without torch)', t => {
  const probe = spawnSync(python, ['-c', 'import torch, cua_s1'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('torch/cua_s1 not installed; mechanism tests above still run'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-train-'));
  try {
    const data = path.join(dir, 'data'); fs.mkdirSync(data);
    const texts = ['commit all changes', 'push and open a pr', 'add a flag with tests', 'migrate every service', 'go', 'yes'];
    const golds = ['tier1', 'tier1', 'tier3', 'tier3', null, null];
    const prompts = []; const labels = [];
    for (let k = 0; k < 8; k++) texts.forEach((t, i) => { const id = `p${k}-${i}`; prompts.push({ id, family: `f${k}`, source: 'claude', split: k < 6 ? 'train' : 'validation', text: `${t} ${k}` }); labels.push({ id, gold: golds[i] }); });
    fs.writeFileSync(path.join(data, 'prompts.jsonl'), prompts.map(p => JSON.stringify(p)).join('\n') + '\n');
    fs.writeFileSync(path.join(data, 'labels.jsonl'), labels.map(p => JSON.stringify(p)).join('\n') + '\n');
    const out = path.join(dir, 'model');
    const r = spawnSync(python, [path.join(root, 'scripts/system-one-train.py'), '--data-dir', data, '--out', out, '--epochs', '2', '--context-tokens', '64'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(out, 'train-report.json'), 'utf8'));
    assert.equal(report.counts.train, 36); assert.equal(report.counts.validation, 12);
    const scores = fs.readFileSync(path.join(out, 'val-scores.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(scores.length, 12);
    assert.ok(scores.every(s => s.probs.length === 4 && Math.abs(s.probs.reduce((a, b) => a + b, 0) - 1) < 1e-5));
    const load = spawnSync(python, ['-c', `from cua_s1.model import load_checkpoint; m,c,cfg=load_checkpoint(r'${path.join(out, 'harness-routing-v1.safetensors')}','cpu'); print(cfg['context_tokens'])`], { encoding: 'utf8' });
    assert.equal(load.status, 0, load.stderr);
    assert.equal(load.stdout.trim(), '64');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

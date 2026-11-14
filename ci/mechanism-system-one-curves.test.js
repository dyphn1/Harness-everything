'use strict';
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'scripts/system-one-curves.js');
function fixture(t, { stage = 'validity', options = ['invalid'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-curves-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const versionDir = path.join(dir, 'version');
  fs.mkdirSync(versionDir);
  const history = path.join(dir, 'history.jsonl');
  const out = path.join(dir, 'out');
  const writeVersion = version => {
    fs.writeFileSync(path.join(versionDir, 'weights.bin'), 'fixture');
    fs.writeFileSync(path.join(versionDir, 'config.json'), '{}\n');
    fs.writeFileSync(path.join(versionDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      version,
      createdAt: '2026-11-14T00:00:00.000Z',
      stages: { [stage]: { weights: 'weights.bin', config: 'config.json', sha256: '0'.repeat(64), options, thresholds: {} } },
      evaluation: null,
    }));
  };
  function run({ version = 'v1', val, holdout } = {}) {
    writeVersion(version);
    const valFile = path.join(dir, `${version}-val.jsonl`);
    fs.writeFileSync(valFile, val.map(row => JSON.stringify(row)).join('\n') + '\n');
    const args = [cli, '--version', version, '--version-dir', versionDir, '--val-scores', `${stage}=${valFile}`, '--history', history, '--out', out];
    if (holdout) {
      const holdoutFile = path.join(dir, `${version}-holdout.jsonl`);
      fs.writeFileSync(holdoutFile, holdout.map(row => JSON.stringify(row)).join('\n') + '\n');
      args.splice(args.indexOf('--history'), 0, '--holdout-scores', `${stage}=${holdoutFile}`);
    }
    const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, HARNESS_SYSTEM_ONE_HOME: dir } });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return {
      stdout: child.stdout.trim(),
      curves: JSON.parse(fs.readFileSync(path.join(out, 'curves.json'), 'utf8')),
      trend: JSON.parse(fs.readFileSync(path.join(out, 'trend.json'), 'utf8')),
    };
  }
  return { dir, history, run };
}
const validityRows = probabilities => probabilities.map(([gold, p], i) => ({ id: `v${i}`, gold, scores: { invalid: p } }));
const tierRows = (scores, prefix = 't') => scores.map(([gold, a, b], i) => ({ id: `${prefix}${i}`, gold, scores: { a, b } }));

test('hand-computed proper scores average independent options without a sum-to-one rule', t => {
  const f = fixture(t, { stage: 'tier', options: ['a', 'b'] });
  const { curves } = f.run({ val: tierRows([['a', 0.8, 0.3], ['b', 0.2, 0.7]]) });
  assert.ok(Math.abs(curves.stages.tier.logLoss - (-Math.log(0.8) - Math.log(0.7)) / 2) < 1e-12);
  assert.ok(Math.abs(curves.stages.tier.brier - 0.065) < 1e-12);
  assert.equal(curves.stages.tier.coverageCurve.length, 101);
});

test('perfectly calibrated synthetic probabilities have zero ECE', t => {
  const f = fixture(t);
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => [i < 2 ? 'invalid' : 'actionable', 0.2]),
    ...Array.from({ length: 10 }, (_, i) => [i < 8 ? 'invalid' : 'actionable', 0.8]),
  ];
  const { curves } = f.run({ val: validityRows(rows) });
  assert.ok(curves.stages.validity.ece < 1e-12);
  assert.equal(curves.stages.validity.reliability.length, 10);
});

test('better ranking with worse calibration does not auto-promote', t => {
  const f = fixture(t, { stage: 'tier', options: ['a', 'b'] });
  f.run({ version: 'v0', val: tierRows([['a', 0.5, 0.5], ['b', 0.5, 0.5], ['a', 0.5, 0.5], ['b', 0.5, 0.5]]) });
  const { curves, trend } = f.run({ version: 'v1', val: tierRows([
    ['a', 0.95, 0.1], ['b', 0.1, 0.95], ['a', 0.95, 0.1], ['b', 0.95, 0.9],
  ]) });
  assert.equal(trend.verdict, 'hold');
  assert.ok(curves.stages.tier.ece > 0);
  assert.ok(trend.reasons.some(reason => reason.includes('coverage-accuracy AUC delta +')));
  assert.ok(trend.reasons.some(reason => reason.includes('ECE delta +')));
});

test('an old-holdout regression blocks promotion', t => {
  const f = fixture(t, { stage: 'tier', options: ['a', 'b'] });
  const goldRows = [['a', 0.8, 0.2], ['b', 0.2, 0.8], ['a', 0.8, 0.2], ['b', 0.2, 0.8]];
  f.run({ version: 'v0', val: tierRows([['a', 0.5, 0.5], ['b', 0.5, 0.5], ['a', 0.5, 0.5], ['b', 0.5, 0.5]], 'v'), holdout: tierRows(goldRows, 'h') });
  const { curves, trend } = f.run({ version: 'v1', val: tierRows(goldRows, 'v'), holdout: tierRows([
    ['a', 0.1, 0.9], ['b', 0.9, 0.1], ['a', 0.1, 0.9], ['b', 0.9, 0.1],
  ], 'h') });
  assert.equal(curves.floor.oldHoldoutRegression, true);
  assert.equal(trend.verdict, 'hold');
  assert.ok(trend.reasons.some(reason => reason.includes('old-holdout') && reason.includes('regression')));
});

test('one successful run appends exactly one history line', t => {
  const f = fixture(t);
  const first = f.run({ val: validityRows([['invalid', 0.8], ['actionable', 0.2]]) });
  let lines = fs.readFileSync(f.history, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), first.curves);
  const second = f.run({ version: 'v2', val: validityRows([['invalid', 0.7], ['actionable', 0.3]]) });
  lines = fs.readFileSync(f.history, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), second.curves);
});

test('active trend rolls back after two consecutive worsening cycles', t => {
  const f = fixture(t);
  const cycles = [
    validityRows([['invalid', 0.8], ['invalid', 0.8], ['actionable', 0.2], ['actionable', 0.2]]),
    validityRows([['invalid', 0.9], ['invalid', 0.9], ['actionable', 0.9], ['actionable', 0.9]]),
    validityRows([['invalid', 0.6], ['invalid', 0.6], ['actionable', 0.9], ['actionable', 0.9]]),
  ];
  cycles.forEach((val, i) => f.run({ version: `v${i}`, val }));
  const { trend } = f.run({ version: 'v3', val: cycles[2] });
  assert.equal(trend.verdict, 'rollback');
  assert.ok(trend.reasons.some(reason => reason.includes('two consecutive')));
});

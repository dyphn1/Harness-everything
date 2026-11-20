'use strict';
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'scripts/system-one-curves.js');
function fixture(t, { stage = 'validity', options = ['invalid'], referenceOnly = [] } = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-curves-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const versionDir = path.join(dir, 'version');
  fs.mkdirSync(versionDir);
  const history = path.join(dir, 'history.jsonl');
  const writeVersion = version => {
    const catalogs = { validity: ['invalid'], intent: ['fix'], tier: ['tier1'] };
    catalogs[stage] = options;
    const stages = Object.fromEntries(Object.entries(catalogs).map(([name, ids]) => {
      const weights = `${name}.bin`; const config = `${name}.json`;
      fs.writeFileSync(path.join(versionDir, weights), 'fixture');
      fs.writeFileSync(path.join(versionDir, config), '{}\n');
      const thresholds = Object.fromEntries(ids.map(id => [id, name === stage && referenceOnly.includes(id) ? 1 : 0.5]));
      return [name, { weights, config, sha256: '0'.repeat(64), options: ids, thresholds,
        ...(name === stage && referenceOnly.length ? { referenceOnly } : {}) }];
    }));
    const manifest = {
      schemaVersion: 1,
      version,
      createdAt: '2026-11-14T00:00:00.000Z',
      stages,
      evaluation: null,
    };
    fs.writeFileSync(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest));
    return manifest;
  };
  function run({ version = 'v1', val, otherVal = {}, holdout, mutateManifest,
    expectFailure = false, out = path.join(dir, 'out') } = {}) {
    const manifest = writeVersion(version);
    if (mutateManifest) {
      mutateManifest(manifest);
      fs.writeFileSync(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest));
    }
    const args = [cli, '--version', version, '--version-dir', versionDir, '--history', history, '--out', out];
    for (const [name, rows] of Object.entries({ [stage]: val, ...otherVal })) {
      const file = path.join(dir, `${version}-${name}-val.jsonl`);
      fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      args.push('--val-scores', `${name}=${file}`);
    }
    if (holdout) {
      const holdoutFile = path.join(dir, `${version}-holdout.jsonl`);
      fs.writeFileSync(holdoutFile, holdout.map(row => JSON.stringify(row)).join('\n') + '\n');
      args.splice(args.indexOf('--history'), 0, '--holdout-scores', `${stage}=${holdoutFile}`);
    }
    const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, HARNESS_SYSTEM_ONE_HOME: dir } });
    if (expectFailure) {
      assert.notEqual(child.status, 0, JSON.stringify({ stdout: child.stdout,
        compared: fs.existsSync(path.join(out, 'trend.json'))
          ? JSON.parse(fs.readFileSync(path.join(out, 'trend.json'), 'utf8')).compared : null }));
      return child;
    }
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

test('458 rejects a recorded version in a fresh cycle before writing artifacts', t => {
  const f = fixture(t);
  const original = path.join(f.dir, 'original-cycle');
  const fresh = path.join(f.dir, 'fresh-cycle');
  fs.mkdirSync(fresh);
  const scores = {
    val: validityRows([['invalid', 0.8], ['actionable', 0.2]]),
    otherVal: {
      intent: [{ id: 'i0', gold: ['fix'], scores: { fix: 0.8 } }],
      tier: [{ id: 't0', gold: 'tier1', scores: { tier1: 0.8 } }],
    },
  };
  f.run({ version: 'v0', ...scores, out: original });
  assert.deepEqual(f.run({ version: 'v1', ...scores, out: original }).trend.compared, ['v0', 'v1']);
  const saved = ['curves.json', 'trend.json'].map(name => fs.readFileSync(path.join(original, name)));
  const history = fs.readFileSync(f.history);

  const refusal = f.run({ version: 'v1', ...scores, out: fresh, expectFailure: true });
  assert.equal(refusal.status, 1, refusal.stderr);
  assert.match(refusal.stderr, /version already recorded/);
  assert.deepEqual(fs.readdirSync(fresh), []);

  const resumed = spawnSync(process.execPath, [cli, '--version', 'v1', '--version-dir', path.join(f.dir, 'version'),
    '--history', f.history, '--out', original, '--resume-curves', path.join(original, 'curves.json')],
    { cwd: root, encoding: 'utf8', env: { ...process.env, HARNESS_SYSTEM_ONE_HOME: f.dir } });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.deepEqual(JSON.parse(resumed.stdout), { resumed: true, version: 'v1' });
  assert.deepEqual(fs.readFileSync(f.history), history);
  assert.deepEqual(['curves.json', 'trend.json'].map(name => fs.readFileSync(path.join(original, name))), saved);

  assert.deepEqual(f.run({ version: 'v2', ...scores, out: fresh }).trend.compared, ['v0', 'v1', 'v2']);
  const after = fs.readFileSync(f.history);
  assert.deepEqual(after.subarray(0, history.length), history);
  assert.deepEqual(after.toString().trimEnd().split('\n').map(line => JSON.parse(line).version), ['v0', 'v1', 'v2']);
});

test('446 H2: empty, LF, and CRLF histories append readable rows without rewriting prior bytes', t => {
  const f = fixture(t);
  const first = f.run({ version: 'v0', val: validityRows([['invalid', 0.8], ['actionable', 0.2]]) });
  const initial = fs.readFileSync(f.history, 'utf8');
  assert.ok(initial.endsWith('\n'));
  assert.equal(initial.split(/\r?\n/).filter(Boolean).length, 1, 'an empty history gets no leading record');

  const crlfPrefix = `${JSON.stringify(first.curves)}\r\n`;
  fs.writeFileSync(f.history, crlfPrefix);
  const second = f.run({ version: 'v1', val: validityRows([['invalid', 0.7], ['actionable', 0.3]]) });
  const combined = fs.readFileSync(f.history, 'utf8');
  assert.ok(combined.startsWith(crlfPrefix), 'CRLF history bytes remain unchanged');
  assert.deepEqual(combined.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).version), ['v0', 'v1']);
  assert.ok(combined.endsWith('\n'));
  assert.deepEqual(JSON.parse(combined.split(/\r?\n/).filter(Boolean)[1]), second.curves);
});

test('intent curves keep reference-only unclassified scores but never use them as the selected option', t => {
  const f = fixture(t, { stage: 'intent', options: ['fix', 'unclassified'], referenceOnly: ['unclassified'] });
  const { curves, trend } = f.run({ val: [
    { id: 'i1', gold: ['fix'], scores: { fix: 0.7, unclassified: 0.99 } },
  ] });
  const metrics = curves.stages.intent;
  assert.deepEqual(metrics.optionDistributions.unclassified, [0.99, 0.99, 0.99, 0.99, 0.99]);
  assert.equal(metrics.coverageCurve[80][1], 0);
  assert.equal(metrics.coverageCurve[70][1], 1);
  assert.equal(trend.verdict, 'hold');
  assert.equal(fs.existsSync(path.join(f.dir, 'out', 'curves.json')), true);
  assert.equal(fs.existsSync(path.join(f.dir, 'out', 'trend.json')), true);
  assert.equal(fs.readFileSync(f.history, 'utf8').trim().split('\n').length, 1);
});

test('curves rejects malformed reference-only metadata and score rows that omit catalog ids', t => {
  const f = fixture(t, { stage: 'intent', options: ['fix', 'unclassified'], referenceOnly: ['unclassified'] });
  const row = { id: 'i1', gold: ['fix'], scores: { fix: 0.7, unclassified: 0.8 } };
  f.run({ val: [row], mutateManifest: manifest => { manifest.stages.intent.referenceOnly = ['missing']; }, expectFailure: true });
  f.run({ val: [row], mutateManifest: manifest => { manifest.stages.intent.thresholds.unclassified = 0.9; }, expectFailure: true });
  f.run({ val: [{ id: 'i2', gold: ['fix'], scores: { fix: 0.7 } }], expectFailure: true });
});

test('curves reports zero coverage when every intent option is reference-only', t => {
  const f = fixture(t, { stage: 'intent', options: ['unclassified'], referenceOnly: ['unclassified'] });
  const { curves } = f.run({ val: [{ id: 'i1', gold: ['unclassified'], scores: { unclassified: 0.99 } }] });
  assert.deepEqual(curves.stages.intent.optionDistributions.unclassified, [0.99, 0.99, 0.99, 0.99, 0.99]);
  assert.ok(curves.stages.intent.coverageCurve.every(([, coverage]) => coverage === 0));
});

// F11 (#442 P1-1): validity correctness is predicted-vs-gold validity equivalence,
// not membership in the one-option catalog's positive set (Set([]) for gold actionable).
const validityCell = (t, rows, options) => {
  const f = fixture(t, options);
  const { stdout, curves } = f.run({ val: validityRows(rows) });
  return { point: curves.stages.validity.coverageCurve[80], auc: JSON.parse(stdout).stages.validity.coverageAccuracyAuc };
};

test('validity cell 1: gold invalid, high p(invalid) predicts invalid and is correct', t => {
  const cell = validityCell(t, [['invalid', 0.8]]);
  assert.deepEqual(cell.point, [0.8, 1, 1]);
  assert.equal(cell.auc, 1);
});

test('validity cell 2: gold invalid, low p(invalid) predicts actionable and is wrong', t => {
  const cell = validityCell(t, [['invalid', 0.2]]);
  assert.deepEqual(cell.point, [0.8, 1, 0]);
  assert.equal(cell.auc, 0);
});

test('validity cell 3: gold actionable, low p(invalid) predicts actionable and is correct', t => {
  const cell = validityCell(t, [['actionable', 0.2]]);
  assert.deepEqual(cell.point, [0.8, 1, 1]);
  assert.equal(cell.auc, 1);
});

test('validity cell 4: gold actionable, high p(invalid) predicts invalid and is wrong', t => {
  const cell = validityCell(t, [['actionable', 0.8]]);
  assert.deepEqual(cell.point, [0.8, 1, 0]);
  assert.equal(cell.auc, 0);
});

test('validity reference-only invalid keeps its established semantics (unchanged control)', t => {
  const f = fixture(t, { referenceOnly: ['invalid'] });
  const { curves } = f.run({ val: validityRows([['invalid', 0.75], ['actionable', 0.25]]) });
  const curve = curves.stages.validity.coverageCurve;
  assert.deepEqual(curve[75], [0.75, 0.5, 1]);
  assert.deepEqual(curve[25], [0.25, 1, 0.5]);
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

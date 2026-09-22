'use strict';
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { createRequest } = require('../harness-everything/scripts/system-one/contract');
const { TIER_OPTIONS } = require('../harness-everything/scripts/system-one/router');
const { validateCorpus, evaluate } = require('../harness-everything/scripts/system-one/evaluate');
const make = () => ({ schemaVersion: 1, cases: [
  { id: 'a', family: 'typo', split: 'holdout', language: 'en', source: 'human:fixture', reviewed: false, request: createRequest('tier', 'fix typo', TIER_OPTIONS), gold: 'tier1' },
  { id: 'b', family: 'unclear', split: 'holdout', language: 'zh-TW', source: 'human:fixture', reviewed: false, request: createRequest('tier', '看看這個', TIER_OPTIONS), gold: null },
] });
const decision = id => ({ status: id ? 'accepted' : 'abstain', reason: id ? 'scored' : 'unclassified', selectedId: id, confidence: 1, margin: 1, model: { id: 'fixture', revision: 'v1', domain: 'harness-routing-v1' } });
function records() { return make().cases.map(c => ({ id: c.id, baseline: 'tier2', runs: [0, 1].map(() => ({ decision: decision(c.gold), latencyMs: 20, coldStart: true })) })); }
test('S1-E01 exact paired metrics, no promotion from fixtures or cold timing', () => {
  const result = evaluate(make(), records());
  assert.equal(result.model.accuracy, 1); assert.equal(result.model.coverage, 0.5);
  assert.equal(result.model.acceptedPrecision, 1); assert.equal(result.model.acceptedErrorRate, 0);
  assert.equal(result.model.macroF1, 0.5); assert.equal(result.baseline.accuracy, 0);
  assert.equal(result.agreement, 1); assert.equal(result.latency.coldP95Ms, 20); assert.equal(result.latency.warmP95Ms, null);
  assert.equal(result.rolloutReady, false); assert.equal(result.gates.reviewedHoldout, false);
  assert.equal(result.gates.policyEvidence, false); assert.equal(result.gates.liveHostEvidence, false);
  assert.deepEqual(evaluate(make(), records()), evaluate(make(), records()));
});
test('S1-E02 corpus completeness, family leakage and no duplicated prompts', () => {
  assert.equal(validateCorpus(make()), true);
  for (const mutate of [c => { c.schemaVersion = 2; }, c => { c.extra = true; }, c => { c.cases = []; }, c => { c.cases[1].id = 'a'; }, c => { c.cases[1].family = 'typo'; c.cases[1].split = 'train'; }, c => { c.cases[1].request = c.cases[0].request; }, c => { c.cases[0].gold = 'unknown'; }, c => { c.cases[0].language = 'unknown'; }, c => { c.cases[0].reviewed = 'yes'; }, c => { c.cases[0].source = ''; }, c => { c.cases[0].request = createRequest('tier', 'x', [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }]); }, c => { delete c.cases[0].family; }, c => { c.cases[0].extra = 1; }]) { const c = make(); mutate(c); assert.throws(() => validateCorpus(c)); }
});
test('S1-E03 missing/extra/invalid predictions cannot silently improve scores', () => {
  for (const mutate of [r => r.pop(), r => r.push(r[0]), r => { r[0].id = 'unknown'; }, r => { r[0].runs.pop(); }, r => { r[0].runs[0].decision.selectedId = 'unknown'; }, r => { r[0].runs[0].latencyMs = NaN; }, r => { r[0].runs[0].latencyMs = -1; }, r => { r[0].runs[0].coldStart = 'false'; }, r => { r[0].runs[0].decision.status = 'abstain'; }, r => { r[0].baseline = 'unknown'; }, r => { r[0].runs[0].decision.model.revision = 'v2'; }]) { const r = records(); mutate(r); assert.throws(() => evaluate(make(), r)); }
  const r = records(); r[0].runs[1].decision = decision('tier3');
  assert.equal(evaluate(make(), r).agreement, 0.5);
});
test('S1-E04 zero coverage and wrong accepted predictions fail quality gates', () => {
  const r = records(); r.forEach(x => x.runs.forEach(v => { v.decision = { status: 'unavailable', reason: 'provider-config' }; }));
  const report = evaluate(make(), r);
  assert.equal(report.model.coverage, 0); assert.equal(report.model.acceptedPrecision, null); assert.equal(report.rolloutReady, false);
  const wrong = records(); wrong.forEach(x => x.runs.forEach(v => { v.decision = decision('tier3'); }));
  assert.equal(evaluate(make(), wrong).model.acceptedErrorRate, 1);
});
test('S1-E05 real evaluation CLI repeats with only documented timing volatility', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-eval-'));
  try {
    const root = path.resolve(__dirname, '..');
    const input = path.join(dir, 'corpus.json'); fs.writeFileSync(input, JSON.stringify(make()));
    const run = () => {
      const output = path.join(dir, 'report.json');
      const child = spawnSync(process.execPath, [path.join(root, 'scripts/evaluate-system-one.js'), input, path.join(dir, 'missing.json'), output], { encoding: 'utf8', cwd: root });
      assert.equal(child.status, 0, child.stderr);
      const report = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(report.model.coverage, 0); assert.equal(report.rolloutReady, false);
      assert.equal(report.records[0].runs[0].decision.reason, 'provider-config');
      report.records.forEach(r => r.runs.forEach(v => { v.latencyMs = 0; }));
      report.latency.coldP95Ms = 0;
      return { status: child.status, stdout: child.stdout, stderr: child.stderr, report, files: fs.readdirSync(dir).sort() };
    };
    assert.deepEqual(run(), run());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

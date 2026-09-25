'use strict';
// Relevance-native intent contract (#233 decision): per-intent Bernoulli
// decisions beside the untouched single-winner path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequest, decide, decideIntents } = require('../harness-everything/scripts/system-one/contract');
const { INTENT_OPTIONS } = require('../harness-everything/scripts/system-one/catalogs');
const { gradeRelevance } = require('../harness-everything/scripts/system-one/evaluate');

const IDS = INTENT_OPTIONS.map(o => o.id);
const request = createRequest('intent', 'fix the crash and add a test', INTENT_OPTIONS);
const responseFor = masses => ({ schemaVersion: 1, requestHash: request.requestHash, catalogHash: request.catalogHash,
  model: { id: 'm', revision: 'v1', domain: 'harness-routing-v1' },
  scores: IDS.map(id => ({ id, probability: masses[id] ?? 0.05 })) });
const thresholds = (tau = 0.4) => Object.fromEntries(IDS.filter(id => id !== 'unclassified').map(id => [id, tau]));

test('S1-R01 independent intents fire on their own thresholds', () => {
  const d = decideIntents(request, responseFor({ fix: 0.9, test: 0.5 }), { thresholds: thresholds() });
  assert.equal(d.status, 'accepted');
  assert.equal(d.reason, 'scored');
  assert.equal(d.selectedId, 'fix');
  assert.equal(d.confidence, 0.9);
  assert.equal(d.margin, 0.4);
  assert.deepEqual(d.model, { id: 'm', revision: 'v1', domain: 'harness-routing-v1' });
  assert.equal(d.intents.fix.fired, true);
  assert.equal(d.intents.test.fired, true);
  assert.equal(d.intents.docs.fired, false);
  assert.equal(Object.keys(d.intents).length, 12);
});

test('S1-R02 silence abstains and unclassified never fires', () => {
  const quiet = decideIntents(request, responseFor({}), { thresholds: thresholds() });
  assert.deepEqual([quiet.status, quiet.reason, quiet.selectedId], ['abstain', 'no-intent-fired', null]);
  assert.ok(Object.values(quiet.intents).every(i => i.fired === false));
  const loudNull = decideIntents(request, responseFor({ unclassified: 0.95 }), { thresholds: thresholds() });
  assert.equal(loudNull.status, 'abstain');
});

test('S1-R03 the simplex rule does not apply to relevance vectors', () => {
  const res = responseFor({ fix: 0.9, test: 0.8, docs: 0.7 });
  assert.ok(res.scores.reduce((s, o) => s + o.probability, 0) > 2, 'independent scores sum past one');
  assert.equal(decideIntents(request, res, { thresholds: thresholds() }).status, 'accepted');
  assert.equal(decide(request, res, {}).status, 'invalid-output', 'single-winner still demands the simplex');
});

test('S1-R04 malformed relevance inputs fail closed', () => {
  const good = responseFor({ fix: 0.9 });
  const tau = thresholds();
  for (const mutate of [
    r => { r.scores = r.scores.slice(0, 12); },
    r => { r.scores[0] = { ...r.scores[0], id: 'nope' }; },
    r => { r.scores[0] = { ...r.scores[0], probability: 1.5 }; },
    r => { r.scores[0] = { ...r.scores[0], probability: NaN }; },
  ]) { const bad = JSON.parse(JSON.stringify(good)); mutate(bad);
    assert.equal(decideIntents(request, bad, { thresholds: tau }).status, 'invalid-output'); }
  for (const policy of [{}, { thresholds: {} }, { thresholds: { ...tau, fix: 2 } },
    { thresholds: { ...tau, unclassified: 0.5 } }, { thresholds: tau, extra: 1 }]) {
    assert.throws(() => decideIntents(request, good, policy), JSON.stringify(policy));
  }
});

const relevanceCase = (id, gold, secondary) => ({ id, family: `f-${id}`, split: 'holdout', language: 'en',
  source: 'human:fixture', reviewed: true, request: createRequest('intent', `prompt ${id}`, INTENT_OPTIONS), gold, secondary });
const byId = entries => new Map(entries.map(([id, scores]) => [id, { scores }]));
const probs = masses => IDS.map(id => masses[id] ?? 0.0);

test('S1-R05 relevance grading reports micro, macro, cardinality and abstain', () => {
  const cases = [relevanceCase('a', 'fix', ['test']), relevanceCase('b', 'docs', []), relevanceCase('c', null, [])];
  const runs = byId([['a', probs({ fix: 0.9, test: 0.5 })], ['b', probs({ docs: 0.8, fix: 0.5 })], ['c', probs({})]]);
  const g = gradeRelevance(cases, runs, [...IDS.slice(0, 12), null], thresholds());
  assert.deepEqual([g.micro.precision, g.micro.recall], [0.75, 1]);
  assert.ok(Math.abs(g.micro.f1 - 0.857) < 0.001);
  assert.ok(Math.abs(g.macroF1 - 0.889) < 0.001, 'fix 0.667, test 1, docs 1; unsupported intents skipped');
  assert.deepEqual([g.cardinality.predicted, g.cardinality.gold], [4 / 3, 1]);
  assert.deepEqual([g.abstainRate, g.exactSetMatch, g.weakPrecision], [1 / 3, 2 / 3, 0.5]);
  assert.equal(g.perIntent.fix.support, 1);
  assert.equal(g.perIntent.git.support, 0);
});

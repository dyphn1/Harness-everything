'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequest } = require('../harness-everything/scripts/system-one/contract');
const { TIER_OPTIONS } = require('../harness-everything/scripts/system-one/router');
const { INTENT_OPTIONS, CATALOGS, goldLabels } = require('../harness-everything/scripts/system-one/catalogs');
const { validateCorpus, evaluate } = require('../harness-everything/scripts/system-one/evaluate');
const { gradedAgreement, familyConsistency } = require('../harness-everything/scripts/system-one/intent');
const { build, promptHash } = require('../scripts/system-one-corpus');
const label = require('../scripts/system-one-label');
const root = path.resolve(__dirname, '..');
const INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor', 'review', 'test', 'docs', 'plan', 'investigate'];

test('S1-I01 the intent catalog is the owner\'s fixed list, frozen, beside the tier catalog', () => {
  assert.deepEqual(INTENT_OPTIONS.map(o => o.id), [...INTENTS, 'unclassified']);
  assert.ok(Object.isFrozen(INTENT_OPTIONS) && INTENT_OPTIONS.every(o => Object.isFrozen(o) && o.text.length > 0));
  assert.equal(CATALOGS.tier, TIER_OPTIONS);
  assert.equal(CATALOGS.intent, INTENT_OPTIONS);
  assert.deepEqual(goldLabels('intent'), [...INTENTS, null]);
  assert.deepEqual(goldLabels('tier'), ['tier1', 'tier2', 'tier3', null]);
  assert.throws(() => goldLabels('skills'));
  assert.notEqual(createRequest('intent', 'fix it', INTENT_OPTIONS).catalogHash, createRequest('tier', 'fix it', TIER_OPTIONS).catalogHash);
});

const intentCase = (id, gold, language = 'en', secondary = []) => ({ id, family: `f-${id}`, split: 'holdout', language, source: 'human:fixture', reviewed: false,
  request: createRequest('intent', `prompt ${id}`, INTENT_OPTIONS), gold, secondary });
const model = { id: 'fixture', revision: 'v1', domain: 'harness-routing-v1' };
const oneHot = id => INTENT_OPTIONS.map(o => (o.id === (id || 'unclassified') ? 1 : 0));
const run = id => ({ decision: { status: id ? 'accepted' : 'abstain', reason: id ? 'scored' : 'unclassified', selectedId: id, confidence: 1, margin: 1, model },
  scores: oneHot(id), latencyMs: 1, coldStart: false });

test('S1-I02 the evaluator scores an intent corpus over the intent labels only', () => {
  const corpus = { schemaVersion: 1, cases: [intentCase('a', 'fix'), intentCase('b', null, 'zh-TW')] };
  assert.equal(validateCorpus(corpus), true);
  const records = corpus.cases.map(c => ({ id: c.id, baseline: 'fix', runs: [run(c.gold), run(c.gold)] }));
  const report = evaluate(corpus, records);
  assert.equal(report.model.accuracy, 1);
  assert.equal(report.model.coverage, 0.5);
  assert.equal(report.model.macroF1, 2 / 13, 'thirteen intent labels, two of them present and perfect');
  assert.equal(report.baseline.accuracy, 0.5);
  assert.equal(validateCorpus({ schemaVersion: 1, cases: [intentCase('s', 'edit', 'en', ['test', 'docs'])] }), true);
  const bad = [
    c => { c.cases[0].gold = 'tier1'; },
    c => { delete c.cases[0].secondary; },
    c => { c.cases[0].secondary = ['fix']; },
    c => { c.cases[0].secondary = ['test', 'test']; },
    c => { c.cases[0].secondary = ['unclassified']; },
    c => { c.cases[1].secondary = ['test']; },
    c => { const { secondary, ...tierCase } = intentCase('t', 'tier1'); c.cases.push({ ...tierCase, request: createRequest('tier', 'prompt t', TIER_OPTIONS) }); },
    c => { c.cases[0].request = createRequest('intent', 'prompt a', INTENT_OPTIONS.slice(0, 4)); },
  ];
  for (const mutate of bad) { const c = JSON.parse(JSON.stringify(corpus)); mutate(c); assert.throws(() => validateCorpus(c)); }
  const shortScores = records.map(r => ({ ...r, runs: r.runs.map(x => ({ ...x, scores: x.scores.slice(0, 4) })) }));
  assert.throws(() => evaluate(corpus, shortScores), 'score vectors follow the intent catalog length');
  const tierBaseline = records.map(r => ({ ...r, baseline: 'tier2' }));
  assert.throws(() => evaluate(corpus, tierBaseline));
});

test('S1-I03 the corpus assembler builds an intent holdout from its own draft and reviews', () => {
  const draftCase = (id, proposedGold, prompt) => ({ id, family: `family-${id}`, language: 'en', source: 'synthetic:authored', prompt, proposedGold, rationale: 'fixture' });
  const draft = { schemaVersion: 1, cases: [draftCase('a', 'git', 'commit and push'), draftCase('b', 'fix', 'the parser crashes, fix it'), draftCase('c', null, 'go')] };
  const decisions = [
    { id: 'a', promptHash: promptHash('commit and push'), decision: 'accept', gold: 'git', secondary: [], reviewer: 'human:repository-owner' },
    { id: 'b', promptHash: promptHash('the parser crashes, fix it'), decision: 'relabel', gold: 'investigate', secondary: ['fix', 'test'], reviewer: 'human:repository-owner' },
  ];
  const { corpus, summary } = build(draft, { schemaVersion: 1, decisions }, 'intent');
  assert.ok(corpus.cases.every(c => c.request.task === 'intent' && JSON.stringify(c.request.options) === JSON.stringify(INTENT_OPTIONS)));
  assert.deepEqual(corpus.cases.map(c => [c.id, c.gold, c.secondary, c.reviewed]), [['a', 'git', [], true], ['b', 'investigate', ['fix', 'test'], true], ['c', null, [], false]]);
  assert.equal(summary.byGold.git, 1); assert.equal(summary.byGold.investigate, 1); assert.equal(summary.byGold.unclassified, 1);
  assert.equal(Object.keys(summary.byGold).length, 13);
  assert.deepEqual(summary.bySecondary, { fix: 1, test: 1 });
  for (const mutate of [d => { delete d.secondary; }, d => { d.secondary = ['investigate']; }, d => { d.secondary = ['fix', 'fix']; }, d => { d.secondary = ['tier1']; }, d => { d.secondary = 'fix'; }]) {
    const bad = decisions.map(d => ({ ...d, secondary: [...d.secondary] })); mutate(bad[1]);
    assert.throws(() => build(draft, { schemaVersion: 1, decisions: bad }, 'intent'));
  }
  assert.throws(() => build(draft, { schemaVersion: 1, decisions: [{ id: 'c', promptHash: promptHash('go'), decision: 'accept', gold: null, secondary: ['git'], reviewer: 'human:repository-owner' }] }, 'intent'), 'null has no secondary');
  assert.throws(() => build({ schemaVersion: 1, cases: [draftCase('a', 'tier1', 'commit and push')] }, null, 'intent'));
  assert.throws(() => build(draft, { schemaVersion: 1, decisions: [{ ...decisions[0], decision: 'relabel', gold: 'tier1' }] }, 'intent'));
  assert.throws(() => build(draft, null, 'skills'));
  assert.equal(build({ schemaVersion: 1, cases: [draftCase('a', 'tier1', 'commit and push')] }, null).corpus.cases[0].request.task, 'tier', 'tier stays the default');
});

test('S1-I04 the labeler labels intent from the intent document with the intent labels only', async () => {
  const rules = label.rulesFromDoc(fs.readFileSync(path.join(root, 'docs/system-one-intent.md'), 'utf8'), 'intent');
  assert.match(rules, /^## Intent labels/);
  assert.match(rules, /\| `investigate` \|/);
  assert.match(rules, /One primary intent/);
  assert.doesNotMatch(rules, /## Holdout/);
  assert.throws(() => label.rulesFromDoc('# nothing here', 'intent'));
  const batch = [{ id: 'x', text: 'fix it' }, { id: 'y', text: 'go' }];
  const prompt = label.buildPrompt(rules, batch, 'intent');
  assert.match(prompt, /explain, discuss, git, fix, edit, feature, refactor, review, test, docs, plan, investigate, or null/);
  assert.doesNotMatch(prompt, /tier1/);
  assert.match(label.buildPrompt('r', batch), /tier1, tier2, tier3, or null/, 'tier stays the default');
  assert.match(prompt, /secondary/, 'intent replies carry secondary intents');
  const ok = { labels: [{ i: 0, gold: 'fix', secondary: ['test'] }, { i: 1, gold: 'null', secondary: [] }] };
  assert.deepEqual(label.validateReply(batch, ok, 'intent'), [{ gold: 'fix', secondary: ['test'] }, { gold: null, secondary: [] }]);
  for (const bad of [
    { labels: [{ i: 0, gold: 'tier1', secondary: [] }, { i: 1, gold: 'null', secondary: [] }] },
    { labels: [{ i: 0, gold: 'fix' }, { i: 1, gold: 'null', secondary: [] }] },
    { labels: [{ i: 0, gold: 'fix', secondary: ['fix'] }, { i: 1, gold: 'null', secondary: [] }] },
    { labels: [{ i: 0, gold: 'fix', secondary: [] }, { i: 1, gold: 'null', secondary: ['git'] }] },
  ]) assert.equal(label.validateReply(batch, bad, 'intent'), null);
  assert.equal(label.validateReply(batch, { labels: [{ i: 0, gold: 'fix' }, { i: 1, gold: 'null' }] }), null, 'tier replies reject intent labels');
  assert.deepEqual(label.validateReply(batch, { labels: [{ i: 0, gold: 'tier1' }, { i: 1, gold: 'null' }] }), ['tier1', null], 'tier replies keep their shape');
  const schema = JSON.parse(label.schemaFor('intent')).properties.labels.items;
  assert.deepEqual(schema.properties.gold.enum, [...INTENTS, 'null']);
  assert.deepEqual(schema.required, ['i', 'gold', 'secondary']);
  assert.deepEqual(schema.properties.secondary.items.enum, INTENTS);
  assert.deepEqual(JSON.parse(label.schemaFor('tier')).properties.labels.items.required, ['i', 'gold']);
  const report = label.agreement([{ id: 'x', gold: 'fix', secondary: ['test'] }, { id: 'y', gold: 'docs', secondary: [] }],
    { x: { gold: 'test', secondary: ['fix'] }, y: { gold: 'git', secondary: [] } }, 'intent');
  assert.deepEqual(Object.keys(report.recall), [...INTENTS, 'unclassified']);
  assert.equal(report.agreement, 0);
  assert.equal(report.graded, 0.3, '(0.6 swapped + 0 unrelated) / 2');
  assert.deepEqual(report.confusion, { 'fix->test': 1, 'docs->git': 1 });
  const seen = [];
  const out = await label.labelAll(batch, { rules, task: 'intent', run: async p => { seen.push(p); return ok; } });
  assert.deepEqual(out.labeled, [{ id: 'x', gold: 'fix', secondary: ['test'] }, { id: 'y', gold: null, secondary: [] }]);
  assert.match(seen[0], /investigate, or null/);
});

test('S1-I05 graded agreement follows the owner\'s grades and is symmetric', () => {
  const l = (gold, secondary = []) => ({ gold, secondary });
  const cases = [
    [l('fix', ['test']), l('fix', ['docs', 'review']), 1],
    [l('fix', ['test']), l('test', ['fix']), 0.6],
    [l('fix', ['test', 'docs', 'review', 'plan']), l('test', ['fix']), 0.3],
    [l('fix', ['test', 'docs', 'review']), l('test', ['fix']), 0.6],
    [l('fix', ['test']), l('test'), 0.3],
    [l('fix'), l('docs', ['review']), 0],
    [l(null), l(null), 1],
    [l(null), l('fix'), 0],
  ];
  for (const [a, b, want] of cases) {
    assert.equal(gradedAgreement(a, b), want, JSON.stringify([a, b]));
    assert.equal(gradedAgreement(b, a), want, 'symmetric');
  }
});

test('S1-I06 family consistency counts families of two or more that share one primary', () => {
  const rows = [
    { family: 'a', primary: 'fix' }, { family: 'a', primary: 'fix' },
    { family: 'b', primary: 'fix' }, { family: 'b', primary: 'feature' },
    { family: 'c', primary: 'git' },
  ];
  assert.deepEqual(familyConsistency(rows), { families: 2, consistent: 1, rate: 0.5 });
  assert.deepEqual(familyConsistency([{ family: 'c', primary: 'git' }]), { families: 0, consistent: 0, rate: null });
});

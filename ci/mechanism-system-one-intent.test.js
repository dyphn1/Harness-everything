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

const IDS = [...INTENTS, 'unclassified'];
// A probability vector with the given masses; the rest is spread evenly over the other options.
const probs = masses => { const rest = (1 - Object.values(masses).reduce((s, v) => s + v, 0)) / (IDS.length - Object.keys(masses).length);
  return IDS.map(id => (Object.hasOwn(masses, id) ? masses[id] : rest)); };

test('S1-I07 intent calibration uses graded precision and picks a secondary threshold on validation', () => {
  const { calibrate } = require('../scripts/system-one-calibrate');
  const rows = [
    { id: 'a', gold: 'fix', secondary: ['test'], probs: probs({ fix: 0.6, test: 0.3 }) },
    { id: 'b', gold: 'test', secondary: ['fix'], probs: probs({ fix: 0.55, test: 0.35 }) },
    { id: 'c', gold: 'docs', secondary: [], probs: probs({ git: 0.4, docs: 0.35 }) },
  ];
  const c = calibrate(rows, { task: 'intent' });
  assert.equal(c.secondaryThreshold, 0.05, 'lowest threshold with the best secondary micro-F1');
  assert.deepEqual([c.feasible, c.minConfidence, c.minMargin, c.accepted, c.precision], [true, 0.5, 0.25, 1, 1]);
  const loose = calibrate(rows, { task: 'intent', minPrecision: 0.8 });
  assert.deepEqual([loose.minConfidence, loose.minMargin, loose.accepted], [0.5, 0, 2]);
  assert.equal(loose.precision, 0.8, 'graded: (1 + 0.6) / 2');
  assert.equal(loose.exactPrecision, 0.5);
  assert.equal(calibrate([{ id: 'x', gold: 'tier1', probs: [0.9, 0.05, 0.05, 0] }]).secondaryThreshold, undefined, 'tier calibration is unchanged');
});

test('S1-I08 the ngram trainer trains the intent stage with soft targets (skipped without torch)', t => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  if (spawnSync(python, ['-c', 'import torch'], { encoding: 'utf8' }).status !== 0) { t.skip('torch not installed'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-intent-'));
  try {
    const data = path.join(dir, 'data'); fs.mkdirSync(data);
    const texts = [['commit and push', 'git', []], ['fix the crash and add a test', 'fix', ['test']], ['explain this flag', 'explain', []], ['go', null, []]];
    const prompts = []; const labels = [];
    for (let k = 0; k < 10; k++) texts.forEach(([x, g, s], i) => { const id = `p${k}-${i}`; prompts.push({ id, family: `f${k}`, source: 'claude', split: k < 8 ? 'train' : 'validation', text: `${x} ${k}` }); labels.push({ id, gold: g, secondary: s }); });
    fs.writeFileSync(path.join(data, 'prompts.jsonl'), prompts.map(x => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(data, 'labels-intent.jsonl'), labels.map(x => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(data, 'owner-overrides-intent.jsonl'), `${JSON.stringify({ id: 'p9-2', gold: 'docs', secondary: ['explain'] })}\n`);
    fs.writeFileSync(path.join(data, 'labels.jsonl'), `${JSON.stringify({ id: 'p0-0', gold: 'tier1' })}\n`);
    const out = path.join(dir, 'model');
    const r = spawnSync(python, [path.join(root, 'scripts/system-one-train-ngram.py'), '--task', 'intent', '--data-dir', data, '--out', out, '--dim', '4096', '--epochs', '40'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const side = JSON.parse(fs.readFileSync(path.join(out, 'harness-routing-v1.json'), 'utf8'));
    assert.deepEqual(side.catalog, IDS);
    assert.equal(side.metadata.task, 'intent');
    const scores = fs.readFileSync(path.join(out, 'val-scores.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(scores.length, 8);
    assert.ok(scores.every(s => s.probs.length === IDS.length && Array.isArray(s.secondary)));
    assert.deepEqual(scores.find(s => s.id === 'p9-2'), { ...scores.find(s => s.id === 'p9-2'), gold: 'docs', secondary: ['explain'] }, 'owner intent override applies');
    const fixRow = scores.find(s => s.id === 'p8-1');
    assert.ok(fixRow.probs[IDS.indexOf('fix')] > fixRow.probs[IDS.indexOf('test')] && fixRow.probs[IDS.indexOf('test')] > fixRow.probs[IDS.indexOf('git')], 'soft targets rank the primary, then the secondary');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

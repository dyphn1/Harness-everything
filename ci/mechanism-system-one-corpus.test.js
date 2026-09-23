'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateDraft, validateReviews, build, promptHash } = require('../scripts/system-one-corpus');
const { validateCorpus } = require('../harness-everything/scripts/system-one/evaluate');
const root = path.resolve(__dirname, '..');
const draftPath = path.join(root, 'benchmarks/fixtures/system-one-holdout-draft.json');

const draftCase = (id, language = 'en', proposedGold = 'tier1', prompt = `commit the change for case ${id}`) => ({
  id, family: `family-${id}`, language, source: 'synthetic:authored', prompt, proposedGold, rationale: 'bounded git operation' });
const draft = () => ({ schemaVersion: 1, cases: [draftCase('a'), draftCase('b', 'zh-TW', null, '繼續'), draftCase('c', 'en', 'tier2', 'fix the failing parser test and rerun it')] });
const decision = (c, kind = 'accept', gold = c.proposedGold) => ({ id: c.id, promptHash: promptHash(c.prompt), decision: kind, gold, reviewer: 'human:repository-owner' });
const reviews = decisions => ({ schemaVersion: 1, decisions });

test('S1-K01 an unreviewed draft assembles into a valid corpus that cannot pass the review gate', () => {
  const { corpus, summary } = build(draft(), null);
  assert.equal(validateCorpus(corpus), true);
  assert.ok(corpus.cases.every(c => c.reviewed === false && c.split === 'holdout'));
  assert.deepEqual(corpus.cases.map(c => c.gold), ['tier1', null, 'tier2']);
  assert.equal(corpus.cases[1].request.context, '繼續');
  assert.equal(summary.unreviewed, 3);
  assert.equal(summary.reviewedHoldoutGate, false);
  assert.equal(promptHash('繼續'), createHash('sha256').update('繼續', 'utf8').digest('hex'));
  assert.deepEqual(build(draft(), null), build(draft(), null));
});

test('S1-K02 accept, relabel and reject apply exactly; the reviewer gold wins', () => {
  const d = draft();
  const { corpus, summary } = build(d, reviews([decision(d.cases[0]), decision(d.cases[1], 'relabel', 'tier1'), decision(d.cases[2], 'reject', null)]));
  assert.deepEqual(corpus.cases.map(c => [c.id, c.gold, c.reviewed]), [['a', 'tier1', true], ['b', 'tier1', true]]);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.reviewed, 2);
});

test('S1-K03 a decision for changed prompt text is stale and never counts as review', () => {
  const d = draft();
  const r = reviews([decision(d.cases[0], 'relabel', 'tier2')]);
  d.cases[0].prompt = 'commit and push the change for case a';
  const { corpus, summary } = build(d, r);
  assert.equal(corpus.cases[0].reviewed, false);
  assert.equal(corpus.cases[0].gold, 'tier1');
  assert.equal(summary.stale, 1);
});

test('S1-K04 malformed reviews are rejected instead of silently applied', () => {
  const d = draft();
  const bad = [
    r => { r.decisions.push({ ...r.decisions[0] }); },
    r => { r.decisions[0].id = 'unknown'; },
    r => { r.decisions[0].decision = 'approve'; },
    r => { r.decisions[0].gold = 'tier3'; },
    r => { r.decisions[0] = decision(d.cases[0], 'relabel', 'tier1'); },
    r => { r.decisions[0] = decision(d.cases[0], 'reject', 'tier1'); },
    r => { r.decisions[0].reviewer = 'claude'; },
    r => { r.decisions[0].reviewer = 'human:someone@example.com'; },
    r => { r.decisions[0].extra = true; },
    r => { r.decisions[0].promptHash = 'abc'; },
    r => { r.schemaVersion = 2; },
  ];
  for (const mutate of bad) {
    const r = reviews([decision(d.cases[0])]);
    mutate(r);
    assert.throws(() => build(d, r));
  }
  assert.equal(validateReviews(reviews([decision(d.cases[0])])), true);
});

test('S1-K05 draft validation: exact fields, unique ids and prompts, known sources, no private data', () => {
  assert.equal(validateDraft(draft()), true);
  const bad = [
    d => { d.cases[1].id = 'a'; },
    d => { d.cases[1].prompt = d.cases[0].prompt; },
    d => { d.cases[0].source = 'real:history'; },
    d => { d.cases[0].language = 'ja'; },
    d => { d.cases[0].proposedGold = 'unclassified'; },
    d => { d.cases[0].rationale = ''; },
    d => { d.cases[0].extra = 1; },
    d => { d.cases = []; },
    d => { d.cases[0].prompt = 'mail the report to dev.lead@example.com'; },
    d => { d.cases[0].prompt = 'open C:\\Users\\alice\\repo\\notes.md and fix it'; },
    d => { d.cases[0].prompt = 'read /home/alice/project/config.yaml'; },
    d => { d.cases[0].prompt = 'read /Users/alice/project/config.yaml'; },
  ];
  for (const mutate of bad) { const d = draft(); mutate(d); assert.throws(() => validateDraft(d)); }
});

test('S1-K06 the gate passes only with >=200 reviewed cases and >=50 per language', () => {
  const make = (en, zh) => ({ schemaVersion: 1, cases: [
    ...Array.from({ length: en }, (_, i) => draftCase(`en-${i}`, 'en', 'tier1', `rename variable number ${i} in the parser`)),
    ...Array.from({ length: zh }, (_, i) => draftCase(`zh-${i}`, 'zh-TW', 'tier1', `把第 ${i} 個變數改名`)),
  ] });
  const all = d => reviews(d.cases.map(c => decision(c)));
  const pass = make(150, 50);
  assert.equal(build(pass, all(pass)).summary.reviewedHoldoutGate, true);
  const fewZh = make(160, 49);
  assert.equal(build(fewZh, all(fewZh)).summary.reviewedHoldoutGate, false);
  const partial = make(150, 50);
  assert.equal(build(partial, reviews(all(partial).decisions.slice(1))).summary.reviewedHoldoutGate, false);
});

test('S1-K07 CLI builds a corpus file and fails closed on invalid input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-corpus-'));
  try {
    const cli = path.join(root, 'scripts/system-one-corpus.js');
    const input = path.join(dir, 'draft.json'); const review = path.join(dir, 'reviews.json'); const out = path.join(dir, 'corpus.json');
    const d = draft();
    fs.writeFileSync(input, JSON.stringify(d));
    fs.writeFileSync(review, JSON.stringify(reviews([decision(d.cases[0])])));
    const ok = spawnSync(process.execPath, [cli, 'build', input, review, out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).reviewed, 1);
    assert.equal(validateCorpus(JSON.parse(fs.readFileSync(out, 'utf8'))), true);
    const none = spawnSync(process.execPath, [cli, 'build', input, '-', out], { encoding: 'utf8' });
    assert.equal(none.status, 0, none.stderr);
    assert.equal(JSON.parse(none.stdout).reviewed, 0);
    fs.writeFileSync(review, '{"schemaVersion":1,"decisions":[{"id":"zzz"}]}');
    assert.equal(spawnSync(process.execPath, [cli, 'build', input, review, out], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [cli, 'bogus'], { encoding: 'utf8' }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-K08 the committed holdout draft meets size, language, class and length requirements', () => {
  const d = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  assert.equal(validateDraft(d), true);
  const { corpus } = build(d, null);
  assert.equal(validateCorpus(corpus), true);
  assert.ok(d.cases.length >= 220, 'headroom above 200 for rejected cases');
  for (const lang of ['en', 'zh-TW']) assert.ok(d.cases.filter(c => c.language === lang).length >= 60, lang);
  for (const gold of ['tier1', 'tier2', 'tier3', null]) assert.ok(d.cases.filter(c => c.proposedGold === gold).length >= 40, String(gold));
  const bytes = d.cases.map(c => Buffer.byteLength(c.prompt, 'utf8'));
  assert.ok(bytes.filter(b => b > 224).length / bytes.length >= 0.15, 'long prompts are represented');
  assert.ok(bytes.filter(b => b <= 40).length / bytes.length >= 0.1, 'short prompts are represented');
  assert.ok(d.cases.some(c => c.source === 'derived:local-history') && d.cases.some(c => c.source === 'synthetic:authored'));
  assert.ok(new Set(d.cases.map(c => c.family)).size >= 40, 'enough distinct families');
});

test('S1-K09 the committed reviewed holdout is reproducible from owner decisions and meets the gate', () => {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/fixtures', name), 'utf8'));
  const d = read('system-one-holdout-draft.json');
  const r = read('system-one-holdout-reviews.json');
  assert.equal(validateReviews(r), true);
  assert.deepEqual(r.decisions.map(x => x.id).sort(), d.cases.map(c => c.id).sort(), 'every draft case has exactly one owner decision');
  const { corpus, summary } = build(d, r);
  assert.equal(summary.stale, 0);
  assert.equal(summary.unreviewed, 0);
  assert.equal(summary.reviewedHoldoutGate, true);
  assert.deepEqual(read('system-one-holdout.json'), corpus, 'committed corpus equals the rebuild');
  for (const gold of ['tier1', 'tier2', 'tier3', null]) assert.ok(corpus.cases.filter(c => c.gold === gold).length >= 15, String(gold));
});

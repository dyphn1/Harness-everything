'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const label = require('../scripts/system-one-label');
const root = path.resolve(__dirname, '..');
const items = n => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, text: `prompt number ${i}` }));
const reply = (batch, gold = () => 'tier1') => ({ labels: batch.map((_, i) => ({ i, gold: gold(i) })) });

test('S1-L01 the instructions carry the owner rules from the corpus document and every item', () => {
  const rules = label.rulesFromDoc(fs.readFileSync(path.join(root, 'docs/system-one-corpus.md'), 'utf8'));
  assert.match(rules, /\| `tier1` \|/);
  assert.match(rules, /Label the work the prompt would start/);
  assert.doesNotMatch(rules, /## Cases/);
  const prompt = label.buildPrompt(rules, items(3));
  assert.ok(prompt.includes(rules));
  for (let i = 0; i < 3; i++) assert.ok(prompt.includes(JSON.stringify({ i, text: `prompt number ${i}` })));
  assert.throws(() => label.rulesFromDoc('# no gold section'));
});

test('S1-L02 a batch reply must label every index exactly once with a known label', () => {
  const batch = items(3);
  assert.deepEqual(label.validateReply(batch, reply(batch, i => ['tier1', 'null', 'tier3'][i])), ['tier1', null, 'tier3']);
  const bad = [
    { labels: [{ i: 0, gold: 'tier1' }, { i: 1, gold: 'tier1' }] },
    { labels: [...reply(batch).labels, { i: 0, gold: 'tier2' }] },
    { labels: [{ i: 0, gold: 'tier1' }, { i: 1, gold: 'tier1' }, { i: 7, gold: 'tier1' }] },
    { labels: [{ i: 0, gold: 'tier1' }, { i: 1, gold: 'tier4' }, { i: 2, gold: 'tier1' }] },
    { labels: 'nope' }, null,
  ];
  for (const r of bad) assert.equal(label.validateReply(batch, r), null);
});

test('S1-L03 invalid replies are retried once, persistent failures are recorded, never partially accepted, and runs resume', async () => {
  const data = items(250);
  const calls = [];
  let flaky = true;
  const run = async (prompt, batch) => {
    calls.push(batch.length);
    if (batch[0].id === 'id100' && flaky) { flaky = false; return { labels: [] }; }
    if (batch[0].id === 'id200') return { labels: [] };
    return reply(batch, i => (i % 2 ? 'tier2' : 'null'));
  };
  const reasons = [];
  const first = await label.labelAll(data, { run, rules: 'R', batchSize: 100, concurrency: 2, done: new Set(), onFailure: (batch, reason) => reasons.push([batch[0].id, reason]) });
  assert.deepEqual(reasons, [['id100', 'invalid-reply'], ['id200', 'invalid-reply'], ['id200', 'invalid-reply']], 'every failed attempt is reported with its reason');
  const thrown = [];
  await label.labelAll(items(1), { run: async () => { throw new Error('rate limited'); }, rules: 'R', retryDelayMs: 0, onFailure: (b, r) => thrown.push(r) });
  assert.deepEqual(thrown, ['rate limited', 'rate limited']);
  assert.equal(first.labeled.length, 200);
  assert.deepEqual(first.failed.sort(), data.slice(200).map(d => d.id).sort());
  assert.equal(calls.filter(n => n === 100).length, 3, 'the flaky batch ran twice');
  assert.equal(first.labeled.find(r => r.id === 'id101').gold, 'tier2');
  assert.equal(first.labeled.find(r => r.id === 'id100').gold, null);
  calls.length = 0;
  const again = await label.labelAll(data, { run, rules: 'R', batchSize: 100, concurrency: 2, done: new Set(first.labeled.map(r => r.id)) });
  assert.deepEqual(calls, [50, 50], 'only the unlabeled remainder is sent, retried once');
  assert.equal(again.labeled.length, 0);
});

test('S1-L04 holdout agreement reports overall, per-class recall and confusion', () => {
  const gold = [['a', 'tier1'], ['b', 'tier1'], ['c', 'tier2'], ['d', null]];
  const pred = { a: 'tier1', b: 'tier2', c: 'tier2', d: null };
  const r = label.agreement(gold.map(([id, g]) => ({ id, gold: g })), pred);
  assert.equal(r.cases, 4); assert.equal(r.agreement, 0.75);
  assert.deepEqual(r.recall, { tier1: 0.5, tier2: 1, tier3: null, unclassified: 1 });
  assert.equal(r.confusion['tier1->tier2'], 1);
  assert.equal(r.missing, 0);
  assert.equal(label.agreement([{ id: 'x', gold: 'tier1' }], {}).missing, 1);
});

test('S1-L05 CLI labels through the configured command, resumes, checks the holdout and refuses repository output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-label-'));
  try {
    const fake = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fake, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=[...s.matchAll(/\\{"i":(\\d+),"text"/g)];
      process.stdout.write(JSON.stringify({is_error:false,structured_output:{labels:m.map(x=>({i:Number(x[1]),gold:'tier2'}))}}));});`);
    const input = path.join(dir, 'prompts.jsonl');
    fs.writeFileSync(input, items(5).map(r => JSON.stringify({ ...r, family: 'f', source: 'claude', split: 'train' })).join('\n') + '\n');
    const env = { ...process.env, HARNESS_S1_LABEL_COMMAND: JSON.stringify([process.execPath, fake]) };
    const cli = args => spawnSync(process.execPath, [path.join(root, 'scripts/system-one-label.js'), ...args], { encoding: 'utf8', cwd: root, env });
    const out = path.join(dir, 'labels.jsonl');
    const one = cli(['label', '--in', input, '--out', out]);
    assert.equal(one.status, 0, one.stderr);
    assert.deepEqual(JSON.parse(one.stdout), { labeled: 5, failed: 0, total: 5 });
    const rows = fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.ok(rows.every(r => r.gold === 'tier2' && r.labeler.model === 'sonnet' && /^[0-9a-f]{16}$/.test(r.labeler.rulesSha256)));
    assert.deepEqual(JSON.parse(cli(['label', '--in', input, '--out', out]).stdout), { labeled: 0, failed: 0, total: 5 });
    const partial = path.join(dir, 'partial.jsonl');
    assert.deepEqual(JSON.parse(cli(['label', '--in', input, '--out', partial, '--batch', '2', '--max-batches', '1']).stdout), { labeled: 2, failed: 0, total: 5 });
    assert.deepEqual(JSON.parse(cli(['label', '--in', input, '--out', partial, '--batch', '2', '--max-batches', '1']).stdout), { labeled: 2, failed: 0, total: 5 }, 'resumes with the next batch');
    assert.equal(fs.readFileSync(partial, 'utf8').trim().split('\n').length, 4);
    const report = path.join(dir, 'check.json');
    const check = cli(['check-holdout', '--out', report]);
    assert.equal(check.status, 0, check.stderr);
    const r = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(r.cases, 215);
    assert.equal(typeof r.agreement, 'number');
    assert.equal(cli(['label', '--in', input, '--out', path.join(root, 'tmp-labels.jsonl')]).status, 1);
    assert.equal(fs.existsSync(path.join(root, 'tmp-labels.jsonl')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

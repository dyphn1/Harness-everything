'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ngram = require('../harness-everything/scripts/system-one/ngram');
const provider = require('../harness-everything/scripts/system-one/provider');
const { createRequest, decide } = require('../harness-everything/scripts/system-one/contract');
const { TIER_OPTIONS } = require('../harness-everything/scripts/system-one/router');
const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const IDS = TIER_OPTIONS.map(o => o.id);

// A tiny model whose weights push any text containing the "commit" trigram toward tier1.
function artifact(dir, { dim = 1024, nmax = 3, catalog = IDS, sidecar = {}, bytes } = {}) {
  const W = new Float32Array(dim * catalog.length);
  const hot = ngram.fnv1a32('3:com') % dim;
  W[hot * catalog.length + 0] = 40;
  const bin = path.join(dir, 'tier.bin'); const json = path.join(dir, 'tier.json');
  fs.writeFileSync(bin, bytes || Buffer.from(W.buffer));
  fs.writeFileSync(json, JSON.stringify({ format: 'harness-ngram', formatVersion: 1, dim, nmax, hash: 'fnv1a32', catalog, bias: catalog.map(() => 0), metadata: { fixture: true }, ...sidecar }));
  return { bin, json };
}
function manifest(dir, files, extra = {}) {
  const m = { schemaVersion: 1, transport: 'ngram', checkpoint: files.bin, weightsSha256: sha(files.bin), configSha256: sha(files.json),
    modelId: 'fixture/ngram', revision: 'v1', domain: 'harness-routing-v1', ...extra };
  const p = path.join(dir, 'manifest.json'); fs.writeFileSync(p, JSON.stringify(m)); return { m, p };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-ngram-'));

test('S1-N01 fnv1a32 matches the published test vectors', () => {
  assert.equal(ngram.fnv1a32(''), 0x811c9dc5);
  assert.equal(ngram.fnv1a32('a'), 0xe40c292c);
  assert.equal(ngram.fnv1a32('foobar'), 0xbf9cf968);
});

test('S1-N02 featurization follows the pinned rules', () => {
  const f = ngram.featurize('  Commit   ALL\tchanges ', 3, 1 << 16);
  assert.deepEqual(f, ngram.featurize('commit all changes', 3, 1 << 16), 'lowercase and whitespace normalization');
  const norm = Math.sqrt([...f.values()].reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-12);
  assert.ok(f.has(ngram.fnv1a32('len:4') % (1 << 16)), 'length bucket for 18 UTF-8 bytes');
  const cjk = ngram.featurize('修正😀', 2, 1 << 16);
  assert.ok(cjk.has(ngram.fnv1a32('2:正😀') % (1 << 16)), 'n-grams are over code points, not UTF-16 units');
  assert.ok(!ngram.featurize('a b', 3, 1 << 16).has(ngram.fnv1a32('1: ') % (1 << 16)), 'space-only grams are skipped');
});

test('S1-N03 the Python trainer and the Node provider produce identical features', () => {
  const texts = ['commit all changes', '幫我修正 parser 的錯誤並補測試', '  MIXED Case\ttext 😀 ', 'x', '重構 plugin 介面，跨兩個 repo'];
  const hashes = ['', 'a', 'foobar', '3:修正測'];
  const r = spawnSync(python, [path.join(__dirname, 'system-one-ngram-parity.py')], { input: JSON.stringify({ texts, hashes, nmax: 3, dim: 1 << 16 }), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  const py = JSON.parse(r.stdout);
  assert.deepEqual(py.hash, hashes.map(h => ngram.fnv1a32(h)));
  texts.forEach((t, i) => {
    const node = ngram.featurize(t, 3, 1 << 16);
    assert.deepEqual(Object.keys(py.features[i]).map(Number).sort((a, b) => a - b), [...node.keys()].sort((a, b) => a - b), t);
    for (const [k, v] of Object.entries(py.features[i])) assert.ok(Math.abs(v - node.get(Number(k))) < 1e-12, t);
  });
});

test('S1-N04 the ngram transport scores in process with the Phase 0 response shape', async () => {
  const dir = tmp();
  try {
    const { m, p } = manifest(dir, artifact(dir), { acceptance: { minConfidence: 0.5, minMargin: 0 } });
    assert.equal(provider.validateManifest(m), true);
    const request = createRequest('tier', 'please commit these changes', TIER_OPTIONS);
    const result = provider.score(request, p);
    assert.equal(result.status, 'scored');
    assert.deepEqual(result.acceptance, { minConfidence: 0.5, minMargin: 0 });
    assert.deepEqual(result.response.model, { id: 'fixture/ngram', revision: 'v1', domain: 'harness-routing-v1' });
    assert.ok(Math.abs(result.response.scores.reduce((s, x) => s + x.probability, 0) - 1) < 1e-9);
    const d = decide(request, result.response, result.acceptance);
    assert.equal(d.status, 'accepted'); assert.equal(d.selectedId, 'tier1');
    assert.deepEqual(await provider.scoreAsync(request, p), result);
    const other = provider.score(createRequest('tier', 'unrelated words only', TIER_OPTIONS), p);
    assert.ok(other.response.scores.every(s => Math.abs(s.probability - 0.25) < 1e-9), 'no active weights gives a uniform vector');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-N05 any artifact mismatch is provider-config and never scores', () => {
  const request = createRequest('tier', 'commit it', TIER_OPTIONS);
  const cases = [
    dir => { const f = artifact(dir); const { m, p } = manifest(dir, f); fs.appendFileSync(f.bin, Buffer.alloc(4)); return p; },
    dir => { const f = artifact(dir, { bytes: Buffer.alloc(8) }); return manifest(dir, f).p; },
    dir => manifest(dir, artifact(dir, { catalog: ['tier1', 'tier2', 'tier3', 'other'] })).p,
    dir => manifest(dir, artifact(dir, { sidecar: { format: 'other' } })).p,
    dir => manifest(dir, artifact(dir, { sidecar: { extra: 1 } })).p,
    dir => manifest(dir, artifact(dir, { dim: 1000 })).p,
    dir => manifest(dir, artifact(dir, { nmax: 9 })).p,
    dir => manifest(dir, artifact(dir, { sidecar: { bias: [0, 0] } })).p,
  ];
  for (const make of cases) {
    const dir = tmp();
    try { assert.deepEqual(provider.score(request, make(dir)), { status: 'unavailable', reason: 'provider-config' }); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('S1-N06 manifest rules: ngram needs a .bin and no python; other transports still need python', () => {
  const dir = tmp();
  try {
    const { m } = manifest(dir, artifact(dir));
    assert.equal(provider.validateManifest(m), true);
    assert.throws(() => provider.validateManifest({ ...m, checkpoint: m.checkpoint.replace(/\.bin$/, '.safetensors') }));
    assert.throws(() => provider.validateManifest({ ...m, transport: 'resident' }), 'resident requires python and a .safetensors checkpoint');
    assert.throws(() => provider.validateManifest({ ...m, transport: 'bogus' }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-N08 the evaluator records ngram samples warm and verifies the artifact as provenance', () => {
  const dir = tmp();
  try {
    const { p } = manifest(dir, artifact(dir));
    const output = path.join(dir, 'report.json');
    const corpus = path.join(root, 'benchmarks/fixtures/system-one-routing.json');
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/evaluate-system-one.js'), corpus, p, output], { encoding: 'utf8', cwd: root });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.ok(report.records.every(x => x.runs.every(run => run.coldStart === false)));
    assert.equal(report.latency.coldSamples, 0);
    assert.equal(report.gates.warmLatency, true);
    assert.deepEqual(report.evidence.source, { status: 'recorded', transport: 'ngram', artifactVerified: true });
    assert.equal(report.gates.sourceProvenance, true);
    assert.equal(report.evidence.kind, 'offline-ngram');
    fs.appendFileSync(path.join(dir, 'tier.bin'), Buffer.alloc(4));
    const tampered = spawnSync(process.execPath, [path.join(root, 'scripts/evaluate-system-one.js'), corpus, p, output], { encoding: 'utf8', cwd: root });
    assert.equal(tampered.status, 0, tampered.stderr);
    const bad = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(bad.evidence.source.artifactVerified, false);
    assert.equal(bad.gates.sourceProvenance, false);
    assert.equal(bad.model.coverage, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-N07 a real ngram training run produces an artifact the provider scores (skipped without torch)', t => {
  if (spawnSync(python, ['-c', 'import torch'], { encoding: 'utf8' }).status !== 0) { t.skip('torch not installed'); return; }
  const dir = tmp();
  try {
    const data = path.join(dir, 'data'); fs.mkdirSync(data);
    const texts = [['commit all changes', 'tier1'], ['push and open a pr', 'tier1'], ['add a new flag with tests', 'tier3'], ['migrate every service', 'tier3'], ['fix the failing parser test', 'tier2'], ['go', null]];
    const prompts = []; const labels = [];
    for (let k = 0; k < 10; k++) texts.forEach(([x, g], i) => { const id = `p${k}-${i}`; prompts.push({ id, family: `f${k}`, source: 'claude', split: k < 8 ? 'train' : 'validation', text: `${x} ${k}` }); labels.push({ id, gold: g }); });
    fs.writeFileSync(path.join(data, 'prompts.jsonl'), prompts.map(x => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(data, 'labels.jsonl'), labels.map(x => JSON.stringify(x)).join('\n') + '\n');
    const out = path.join(dir, 'model');
    const r = spawnSync(python, [path.join(root, 'scripts/system-one-train-ngram.py'), '--data-dir', data, '--out', out, '--dim', '4096', '--epochs', '40'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const files = { bin: path.join(out, 'harness-routing-v1.bin'), json: path.join(out, 'harness-routing-v1.json') };
    assert.equal(fs.statSync(files.bin).size, 4096 * 4 * 4);
    assert.equal(fs.readFileSync(path.join(out, 'val-scores.jsonl'), 'utf8').trim().split('\n').length, 12);
    const { p } = manifest(dir, files);
    const scored = provider.score(createRequest('tier', 'commit all changes now', TIER_OPTIONS), p);
    assert.equal(scored.status, 'scored');
    assert.equal(decide(createRequest('tier', 'commit all changes now', TIER_OPTIONS), scored.response, { minConfidence: 0.5, minMargin: 0 }).selectedId, 'tier1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

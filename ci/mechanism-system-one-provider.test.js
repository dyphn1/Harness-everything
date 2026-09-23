'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createRequest, decide } = require('../harness-everything/scripts/system-one/contract');
const { score, runProvider, validateManifest, provenance, validateProvenance, PINNED_CUA_S1_REVISION } = require('../harness-everything/scripts/system-one/provider');
const fixture = path.join(__dirname, 'fixtures/system-one-provider.cjs');
const request = createRequest('tier', '修正 typo; $(never execute)', [{ id: 'tier1', text: 'Small' }, { id: 'tier3', text: 'Large' }]);
const manifest = () => ({ schemaVersion: 1, python: 'python3', checkpoint: path.resolve('model.safetensors'), weightsSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64), modelId: 'test', revision: 'v1', domain: 'harness-routing-v1' });
test('S1-P01 real IPC exact input/output repeated in clean child processes', () => {
  const one = runProvider(request, process.execPath, [fixture, 'ok']);
  const two = runProvider(request, process.execPath, [fixture, 'ok']);
  assert.deepEqual(one, two); assert.equal(one.status, 'scored');
  assert.equal(decide(request, one.response).selectedId, 'tier1');
  assert.deepEqual(Object.keys(one).sort(), ['response', 'status']);
});
test('S1-P02 unavailable, timeout, output bounds, malformed output and repeatability', () => {
  for (const [mode, reason] of [['timeout', 'provider-timeout'], ['overflow', 'provider-output-limit'], ['exit', 'provider-exit'], ['invalid', 'provider-json']]) {
    // Only the timeout case uses a short budget; child startup under parallel CI load can exceed 300ms.
    const call = () => runProvider(request, process.execPath, [fixture, mode], mode === 'timeout' ? 300 : 10000);
    assert.deepEqual(call(), { status: 'unavailable', reason }); assert.deepEqual(call(), call());
  }
  assert.deepEqual(runProvider(request, path.join(os.tmpdir(), 'absent-system-one-python'), []), { status: 'unavailable', reason: 'provider-unavailable' });
  assert.deepEqual(score(request, '/missing/system-one-manifest.json'), { status: 'unavailable', reason: 'provider-config' });
});
test('S1-P03 trusted manifest validation', () => {
  assert.equal(validateManifest(manifest()), true);
  assert.equal(validateManifest({ ...manifest(), timeoutMs: 1 }), true);
  assert.equal(validateManifest({ ...manifest(), timeoutMs: 10000 }), true);
  for (const change of [{ schemaVersion: 2 }, { python: '' }, { checkpoint: 'relative.safetensors' }, { checkpoint: path.resolve('model.pt') }, { weightsSha256: 'abc' }, { configSha256: null }, { modelId: '' }, { revision: null }, { domain: '' }, { timeoutMs: 0 }, { timeoutMs: 10001 }, { timeoutMs: '100' }, { unexpected: true }, { modelId: 'cua-ai/cua-s1-forms' }]) assert.throws(() => validateManifest({ ...manifest(), ...change }));
  for (const key of Object.keys(manifest())) { const m = manifest(); delete m[key]; assert.throws(() => validateManifest(m)); }
});
test('S1-P04 Python artifact validation and byte-limit rejection without ML dependency', () => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [path.join(__dirname, 'system-one-adapter-test.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stderr, /OK/);
});
test('S1-P05 runtime/source provenance is recorded, and a missing or mismatched revision stays visible', () => {
  const probe = rev => ({ schemaVersion: 1, python: { implementation: 'CPython', version: '3.12.4' }, cuaS1: { distribution: 'cua-s1', version: '0.1.0', sourceRevision: rev }, torch: '2.5.1' });
  assert.equal(validateProvenance(probe(PINNED_CUA_S1_REVISION)).cuaS1.sourceRevisionStatus, 'pinned');
  assert.equal(validateProvenance(probe('0'.repeat(40))).cuaS1.sourceRevisionStatus, 'mismatch');
  assert.equal(validateProvenance(probe(null)).cuaS1.sourceRevisionStatus, 'unavailable');
  assert.equal(validateProvenance(probe(null)).cuaS1.pinnedRevision, PINNED_CUA_S1_REVISION);
  for (const mutate of [p => { p.schemaVersion = 2; }, p => { p.extra = 1; }, p => { delete p.torch; }, p => { p.python.version = ''; }, p => { p.python.extra = 1; }, p => { p.cuaS1.sourceRevision = 'abc'; }, p => { p.cuaS1.sourceRevision = 'A'.repeat(40); }, p => { p.cuaS1.version = 1; }, p => { p.cuaS1.extra = 1; }, p => { p.torch = 'x'.repeat(129); }, p => { p.python.version = '3.12\n'; }]) {
    const p = probe(null); mutate(p); assert.throws(() => validateProvenance(p));
  }
  assert.deepEqual(provenance('/missing/system-one-manifest.json'), { status: 'unavailable', reason: 'provider-config' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-prov-'));
  try {
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify({ ...manifest(), python, checkpoint: path.join(dir, 'absent.safetensors') }));
    const one = provenance(file); const two = provenance(file);
    assert.deepEqual(one, two);
    assert.equal(one.status, 'recorded', JSON.stringify(one));
    assert.match(one.provenance.python.version, /^3\.\d+\.\d+/);
    if (one.provenance.cuaS1.distribution === null) assert.equal(one.provenance.cuaS1.sourceRevisionStatus, 'unavailable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

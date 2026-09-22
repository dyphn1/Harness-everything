'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createRequest, decide } = require('../harness-everything/scripts/system-one/contract');
const { score, runProvider, validateManifest } = require('../harness-everything/scripts/system-one/provider');
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
    const call = () => runProvider(request, process.execPath, [fixture, mode], 300);
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

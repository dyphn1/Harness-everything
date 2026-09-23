'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const resident = require('../harness-everything/scripts/system-one/resident');
const provider = require('../harness-everything/scripts/system-one/provider');
const { createRequest, decide } = require('../harness-everything/scripts/system-one/contract');
const { TIER_OPTIONS } = require('../harness-everything/scripts/system-one/router');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const stub = path.join(__dirname, 'fixtures/system-one-resident-stub.py');
const request = createRequest('tier', 'fix a typo in README', TIER_OPTIONS);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fixture(modelId = 'stub') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-resident-'));
  const checkpoint = path.join(dir, 'model.safetensors');
  fs.writeFileSync(checkpoint, 'synthetic-not-real-weights');
  fs.writeFileSync(path.join(dir, 'model.json'), '{}');
  const manifest = { schemaVersion: 1, python, checkpoint, weightsSha256: sha(checkpoint), configSha256: sha(path.join(dir, 'model.json')),
    modelId, revision: 'v1', domain: 'harness-routing-v1', transport: 'resident', idleTimeoutMs: 60000 };
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const spawns = [];
  const deps = { command: m => { spawns.push(m.modelId); return [python, [stub, '--serve']]; } };
  return { dir, manifest, manifestPath, spawns, deps };
}
function cleanup(f) {
  try { resident.stop(f.manifest, f.manifestPath); } catch (_) { /* best effort */ }
  fs.rmSync(f.dir, { recursive: true, force: true });
}

test('S1-RS01 manifest transport fields and digest-bound file names', () => {
  const f = fixture();
  try {
    assert.equal(provider.validateManifest(f.manifest), true);
    for (const change of [{ transport: 'oneshot' }, { idleTimeoutMs: 60000 }, { idleTimeoutMs: 14400000 }]) assert.equal(provider.validateManifest({ ...f.manifest, ...change }), true);
    for (const change of [{ transport: 'daemon' }, { transport: '' }, { idleTimeoutMs: 59999 }, { idleTimeoutMs: 14400001 }, { idleTimeoutMs: '60000' }]) {
      assert.throws(() => provider.validateManifest({ ...f.manifest, ...change }));
    }
    const files = resident.stateFiles(f.manifest, f.manifestPath);
    const digest = createHash('sha256').update(JSON.stringify(f.manifest)).digest('hex').slice(0, 16);
    assert.equal(files.state, path.join(f.dir, `system-one-resident-${digest}.json`));
    assert.equal(files.lock, path.join(f.dir, `system-one-resident-${digest}.starting`));
    assert.notEqual(resident.stateFiles({ ...f.manifest, revision: 'v2' }, f.manifestPath).state, files.state);
  } finally { cleanup(f); }
});

test('S1-RS02 cold start never blocks, spawns once, then serves warm repeatable scores', () => {
  const f = fixture();
  try {
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-starting' });
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-starting' });
    assert.deepEqual(f.spawns, ['stub']);
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    assert.equal(f.spawns.length, 1);
    const one = resident.score(request, f.manifest, f.manifestPath, f.deps);
    const two = resident.score(request, f.manifest, f.manifestPath, f.deps);
    assert.equal(one.status, 'scored'); assert.deepEqual(one, two);
    assert.equal(decide(request, one.response).selectedId, 'tier1');
    assert.equal(resident.status(f.manifest, f.manifestPath).running, true);
    assert.equal(resident.stop(f.manifest, f.manifestPath), true);
    const deadline = Date.now() + 5000;
    while (fs.existsSync(resident.stateFiles(f.manifest, f.manifestPath).state) && Date.now() < deadline) sleep(50);
    assert.equal(resident.status(f.manifest, f.manifestPath).running, false);
  } finally { cleanup(f); }
});

test('S1-RS03 stale state is removed and replaced; a wrong token is rejected without respawn', () => {
  const f = fixture();
  try {
    const { state } = resident.stateFiles(f.manifest, f.manifestPath);
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    fs.writeFileSync(state, JSON.stringify({ schemaVersion: 1, pid: dead, port: 9, token: 'a'.repeat(64), startedAt: 1 }));
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-starting' });
    assert.equal(f.spawns.length, 1);
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const good = JSON.parse(fs.readFileSync(state, 'utf8'));
    fs.writeFileSync(state, JSON.stringify({ ...good, token: 'b'.repeat(64) }));
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-unavailable' });
    assert.equal(f.spawns.length, 1);
    fs.writeFileSync(state, JSON.stringify(good));
    for (const bad of ['not-json', JSON.stringify({ ...good, extra: 1 }), JSON.stringify({ ...good, token: 'short' })]) {
      fs.writeFileSync(state, bad);
      assert.equal(resident.status(f.manifest, f.manifestPath).running, false);
    }
    fs.writeFileSync(state, JSON.stringify(good));
  } finally { cleanup(f); }
});

test('S1-RS04 a slow server times out within the deadline and is not respawned', () => {
  const f = fixture('stub-slow');
  try {
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const start = Date.now();
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-timeout' });
    assert.ok(Date.now() - start < 2500);
    assert.equal(f.spawns.length, 1);
  } finally { cleanup(f); }
});

test('S1-RS05 startup failure is visible and throttled instead of respawning every prompt', () => {
  const f = fixture('stub-fail');
  try {
    assert.equal(resident.score(request, f.manifest, f.manifestPath, f.deps).reason, 'provider-starting');
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), false);
    const lock = JSON.parse(fs.readFileSync(resident.stateFiles(f.manifest, f.manifestPath).lock, 'utf8'));
    assert.equal(lock.failed, 'load-failed');
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-unavailable' });
    assert.equal(f.spawns.length, 1);
  } finally { cleanup(f); }
});

test('S1-RS06 provider dispatch uses the real adapter and reports a missing ML runtime', () => {
  const f = fixture();
  try {
    assert.deepEqual(provider.score(request, f.manifestPath), { status: 'unavailable', reason: 'provider-starting' });
    const { lock } = resident.stateFiles(f.manifest, f.manifestPath);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !(fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock, 'utf8')).failed)) sleep(100);
    const probe = spawnSync(python, ['-c', 'import torch, cua_s1'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).failed, 'load-failed');
      assert.deepEqual(provider.score(request, f.manifestPath), { status: 'unavailable', reason: 'provider-unavailable' });
    }
    const off = { ...f.manifest, transport: 'oneshot' };
    fs.writeFileSync(f.manifestPath, JSON.stringify(off));
    assert.notEqual(provider.score(request, f.manifestPath).reason, 'provider-starting');
  } finally { cleanup(f); }
});

test('S1-RS07 operator CLI reports status and stops a running server', () => {
  const f = fixture();
  try {
    const cli = args => spawnSync(process.execPath, [path.join(__dirname, '../harness-everything/scripts/system-one/resident.js'), ...args], { encoding: 'utf8' });
    assert.equal(JSON.parse(cli(['status', f.manifestPath]).stdout).running, false);
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const running = JSON.parse(cli(['status', f.manifestPath]).stdout);
    assert.equal(running.running, true); assert.ok(!JSON.stringify(running).includes('token'));
    assert.equal(cli(['stop', f.manifestPath]).status, 0);
    const deadline = Date.now() + 5000;
    while (JSON.parse(cli(['status', f.manifestPath]).stdout).running && Date.now() < deadline) sleep(50);
    assert.equal(JSON.parse(cli(['status', f.manifestPath]).stdout).running, false);
    assert.equal(cli(['bogus', f.manifestPath]).status, 2);
    assert.equal(cli(['status', 'relative.json']).status, 2);
  } finally { cleanup(f); }
});

test('S1-RS08 an executable that cannot spawn is recorded as a visible, throttled failure', () => {
  const f = fixture();
  try {
    const missing = path.join(f.dir, 'no-such-python.exe');
    const deps = { command: () => { f.spawns.push('missing'); return [missing, []]; } };
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, deps), { status: 'unavailable', reason: 'provider-unavailable' });
    assert.equal(JSON.parse(fs.readFileSync(resident.stateFiles(f.manifest, f.manifestPath).lock, 'utf8')).failed, 'spawn-failed');
    assert.deepEqual(resident.score(request, f.manifest, f.manifestPath, deps), { status: 'unavailable', reason: 'provider-unavailable' });
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 2000, deps), false);
    assert.deepEqual(f.spawns, ['missing']);
  } finally { cleanup(f); }
});

test('S1-RS09 a corrupted state file never leaves an orphan server behind', () => {
  const f = fixture();
  try {
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const { state } = resident.stateFiles(f.manifest, f.manifestPath);
    const old = JSON.parse(fs.readFileSync(state, 'utf8'));
    fs.writeFileSync(state, 'corrupt');
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const fresh = JSON.parse(fs.readFileSync(state, 'utf8'));
    assert.notEqual(fresh.pid, old.pid);
    const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    const deadline = Date.now() + 5000;
    while (alive(old.pid) && Date.now() < deadline) sleep(100);
    assert.equal(alive(old.pid), false);
    assert.equal(resident.status(f.manifest, f.manifestPath).pid, fresh.pid);
  } finally { cleanup(f); }
});

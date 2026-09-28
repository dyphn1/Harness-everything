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

function fixture(modelId = 'stub', extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-resident-'));
  const checkpoint = path.join(dir, 'model.safetensors');
  fs.writeFileSync(checkpoint, 'synthetic-not-real-weights');
  fs.writeFileSync(path.join(dir, 'model.json'), '{}');
  const manifest = { schemaVersion: 1, python, checkpoint, weightsSha256: sha(checkpoint), configSha256: sha(path.join(dir, 'model.json')),
    modelId, revision: 'v1', domain: 'harness-routing-v1', transport: 'resident', idleTimeoutMs: 60000, ...extra };
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
// A client view whose state file names the live server with a wrong token. The server polls only its own
// state file and exits once that file stops naming it, so rewriting it would race the wrong-token request.
function wrongTokenView(f) {
  const good = JSON.parse(fs.readFileSync(resident.stateFiles(f.manifest, f.manifestPath).state, 'utf8'));
  const viewDir = fs.mkdtempSync(path.join(f.dir, 'client-view-'));
  const manifestPath = path.join(viewDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(f.manifest));
  fs.writeFileSync(resident.stateFiles(f.manifest, manifestPath).state, JSON.stringify({ ...good, token: 'b'.repeat(64) }));
  return manifestPath;
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
    assert.deepEqual(resident.score(request, f.manifest, wrongTokenView(f), f.deps), { status: 'unavailable', reason: 'provider-unavailable' });
    assert.equal(f.spawns.length, 1);
    assert.equal(resident.status(f.manifest, f.manifestPath).running, true, 'a wrong token does not stop the server');
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
    // "Stopped serving" is the contract. On POSIX an exited child stays a zombie (kill(pid, 0) succeeds)
    // until this blocked test process reaps it, so a refused/failed ping also proves the server is gone.
    const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    const serving = () => alive(old.pid) && resident.callSync(old.port, { token: old.token, op: 'ping' }).reply?.ok === true;
    const deadline = Date.now() + 5000;
    while (serving() && Date.now() < deadline) sleep(100);
    assert.equal(serving(), false);
    assert.equal(resident.status(f.manifest, f.manifestPath).pid, fresh.pid);
  } finally { cleanup(f); }
});

test('S1-RS10 scoreAsync matches the sync client and keeps every start/failure mapping', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await resident.scoreAsync(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-starting' });
    assert.deepEqual(await resident.scoreAsync(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-starting' });
    assert.deepEqual(f.spawns, ['stub']);
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const sync = resident.score(request, f.manifest, f.manifestPath, f.deps);
    assert.equal(sync.status, 'scored');
    assert.deepEqual(await resident.scoreAsync(request, f.manifest, f.manifestPath, f.deps), sync);
    assert.deepEqual(await resident.scoreAsync(request, f.manifest, f.manifestPath, f.deps), sync);
    assert.deepEqual(await resident.scoreAsync(request, f.manifest, wrongTokenView(f), f.deps), { status: 'unavailable', reason: 'provider-unavailable' });
    await assert.rejects(resident.scoreAsync({ ...request, extra: 1 }, f.manifest, f.manifestPath, f.deps));
    assert.equal(f.spawns.length, 1);
  } finally { cleanup(f); }
});

test('S1-RS10b scoreAsync removes refused state, restarts once, and times out slow servers', async () => {
  const f = fixture();
  // A live PID that is not this test process: cleanup may kill whatever the state file names.
  const sleeper = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const net = require('node:net');
    const closed = net.createServer();
    await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
    const port = closed.address().port;
    await new Promise(resolve => closed.close(resolve));
    const { state } = resident.stateFiles(f.manifest, f.manifestPath);
    fs.writeFileSync(state, JSON.stringify({ schemaVersion: 1, pid: sleeper.pid, port, token: 'a'.repeat(64), startedAt: 1 }));
    assert.deepEqual(await resident.scoreAsync(request, f.manifest, f.manifestPath, f.deps), { status: 'unavailable', reason: 'provider-starting' });
    assert.deepEqual(f.spawns, ['stub']);
  } finally { sleeper.kill(); cleanup(f); }
  const slow = fixture('stub-slow');
  try {
    assert.equal(resident.ensureReady(slow.manifest, slow.manifestPath, 20000, slow.deps), true);
    const start = Date.now();
    assert.deepEqual(await resident.scoreAsync(request, slow.manifest, slow.manifestPath, slow.deps), { status: 'unavailable', reason: 'provider-timeout' });
    assert.ok(Date.now() - start < 2500);
    assert.equal(slow.spawns.length, 1);
  } finally { cleanup(slow); }
});

test('S1-RS10c provider.scoreAsync dispatches by transport with the sync result shapes', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await provider.scoreAsync(request, path.join(f.dir, 'missing.json')), { status: 'unavailable', reason: 'provider-config' });
    assert.deepEqual(await provider.scoreAsync(request, 'relative.json'), { status: 'unavailable', reason: 'provider-config' });
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    assert.deepEqual(await provider.scoreAsync(request, f.manifestPath), provider.score(request, f.manifestPath));
    const oneshot = path.join(f.dir, 'oneshot.json');
    fs.writeFileSync(oneshot, JSON.stringify({ ...f.manifest, transport: 'oneshot' }));
    assert.deepEqual(await provider.scoreAsync(request, oneshot), provider.score(request, oneshot));
  } finally { cleanup(f); }
});

// The probe preload proves which client path ran inside a real child process.
const probeEnv = (mode, extra = {}) => ({ ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ./ci/fixtures/system-one-worker-probe.js`.trim(),
  HARNESS_TEST_WORKER_MODE: mode, ...extra });

test('S1-RS11 the hook entry pre-scores over async IPC: it still scores when worker threads cannot start', () => {
  const f = fixture();
  const root = path.resolve(__dirname, '..');
  try {
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const env = probeEnv('deny', { HARNESS_SYSTEM_ONE_MODE: 'shadow', HARNESS_SYSTEM_ONE_CONFIG: f.manifestPath });
    const kernel = path.join(root, 'harness-everything/scripts/kernel-router-core.js');
    const diagnostic = out => JSON.parse(out.match(/=> SYSTEM ONE: (.*)/)[1]);
    const argv = spawnSync(process.execPath, [kernel, 'fix a typo in README'], { cwd: root, encoding: 'utf8', env });
    assert.equal(argv.status, 0, argv.stderr);
    assert.equal(diagnostic(argv.stdout).status, 'accepted');
    const hook = spawnSync(process.execPath, [kernel], { cwd: root, encoding: 'utf8', env, input: JSON.stringify({ prompt: 'fix a typo in README' }) });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(diagnostic(hook.stdout).status, 'accepted');
    const off = spawnSync(process.execPath, [kernel, 'fix a typo in README'], { cwd: root, encoding: 'utf8', env: { ...env, HARNESS_SYSTEM_ONE_MODE: 'off' } });
    assert.equal(off.status, 0, off.stderr);
    assert.doesNotMatch(off.stdout, /SYSTEM ONE/);
    assert.equal(f.spawns.length, 1);
  } finally { cleanup(f); }
});

test('S1-RS12 the evaluator times the async path: no worker thread per warm score', () => {
  const f = fixture();
  const root = path.resolve(__dirname, '..');
  try {
    assert.equal(resident.ensureReady(f.manifest, f.manifestPath, 20000, f.deps), true);
    const countFile = path.join(f.dir, 'workers.txt');
    const output = path.join(f.dir, 'report.json');
    const corpus = path.join(root, 'benchmarks/fixtures/system-one-routing.json');
    const child = spawnSync(process.execPath, [path.join(root, 'scripts/evaluate-system-one.js'), corpus, f.manifestPath, output],
      { cwd: root, encoding: 'utf8', env: probeEnv('count', { HARNESS_TEST_WORKER_COUNT_FILE: countFile }) });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.evidence.residentReady, true);
    // Every sample reached the warm server (the seed's one over-limit context is a declined provider-exit).
    const runs = report.records.flatMap(r => r.runs);
    assert.ok(runs.every(run => run.coldStart === false && ['accepted', 'provider-exit'].includes(run.decision.status === 'accepted' ? 'accepted' : run.decision.reason)));
    assert.ok(runs.filter(run => run.decision.status === 'accepted').length >= runs.length - 2);
    assert.ok(Number(fs.readFileSync(countFile, 'utf8')) < report.records.length * 2, 'warm scores must not start a worker thread each');
  } finally { cleanup(f); }
});

test('S1-RS13 manifest acceptance thresholds are validated, carried by scored results and applied by the evaluator', async () => {
  const acceptance = { minConfidence: 0.6, minMargin: 0.3 };
  const base = fixture();
  try {
    for (const ok of [acceptance, { minConfidence: 0.5, minMargin: 0 }, { minConfidence: 0.99, minMargin: 0.9 }]) assert.equal(provider.validateManifest({ ...base.manifest, acceptance: ok }), true);
    for (const bad of [{ minConfidence: 0.49, minMargin: 0.2 }, { minConfidence: 1, minMargin: 0.2 }, { minConfidence: 0.9, minMargin: 0.91 }, { minConfidence: 0.9 }, { minConfidence: 0.9, minMargin: 0.2, extra: 1 }, { minConfidence: '0.9', minMargin: 0.2 }, null, []]) {
      assert.throws(() => provider.validateManifest({ ...base.manifest, acceptance: bad }), JSON.stringify(bad));
    }
  } finally { cleanup(base); }
  const root = path.resolve(__dirname, '..');
  const corpus = path.join(root, 'benchmarks/fixtures/system-one-routing.json');
  const evaluateWith = f => {
    const output = path.join(f.dir, 'report.json');
    const child = spawnSync(process.execPath, [path.join(root, 'scripts/evaluate-system-one.js'), corpus, f.manifestPath, output], { cwd: root, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(fs.readFileSync(output, 'utf8')).records.flatMap(r => r.runs).filter(r => r.decision.reason !== 'provider-exit');
  };
  const soft = fixture('stub-soft', { acceptance });
  try {
    assert.equal(resident.ensureReady(soft.manifest, soft.manifestPath, 20000, soft.deps), true);
    const result = provider.score(request, soft.manifestPath);
    assert.equal(result.status, 'scored');
    assert.deepEqual(result.acceptance, acceptance);
    assert.deepEqual((await provider.scoreAsync(request, soft.manifestPath)).acceptance, acceptance);
    assert.ok(evaluateWith(soft).every(r => r.decision.status === 'accepted' && r.decision.selectedId === 'tier1'));
  } finally { cleanup(soft); }
  const strict = fixture('stub-soft');
  try {
    assert.equal(resident.ensureReady(strict.manifest, strict.manifestPath, 20000, strict.deps), true);
    assert.equal(provider.score(request, strict.manifestPath).acceptance, undefined);
    assert.ok(evaluateWith(strict).every(r => r.decision.status === 'abstain' && r.decision.reason === 'low-confidence'));
  } finally { cleanup(strict); }
});

test('S1-RS14 resident transport names its adapter and stays inside the scripts dir', () => {
  const f = fixture();
  try {
    assert.equal(provider.validateManifest({ ...f.manifest, adapter: 'laya_adapter.py' }), true);
    for (const bad of ['../evil.py', '/abs/evil.py', '', 'ADAPTER.PY', 'a'.repeat(65) + '.py']) {
      assert.throws(() => provider.validateManifest({ ...f.manifest, adapter: bad }), String(bad));
    }
    const [exe, prefix] = resident.defaultCommand(f.manifest);
    assert.equal(exe, f.manifest.python);
    assert.deepEqual(prefix, [path.join(__dirname, '..', 'harness-everything', 'scripts', 'system-one', 'cua_adapter.py'), '--serve']);
    const [, layaPrefix] = resident.defaultCommand({ ...f.manifest, adapter: 'laya_adapter.py' });
    assert.ok(layaPrefix[0].endsWith(path.join('system-one', 'laya_adapter.py')));
    assert.throws(() => resident.defaultCommand({ ...f.manifest, adapter: '../evil.py' }));
  } finally { cleanup(f); }
});

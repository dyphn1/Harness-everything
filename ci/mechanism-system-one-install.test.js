'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const install = require('../harness-everything/scripts/system-one/install');
const { PINNED_CUA_S1_REVISION, readActive } = require('../harness-everything/scripts/system-one/provider');
const { validateVersionManifest } = require('../harness-everything/scripts/system-one/manifest');
const script = path.join(__dirname, '../harness-everything/scripts/system-one/install.js');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const stages = ['validity', 'intent', 'tier'];

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return fs.realpathSync.native(dir);
}

function makeRepo(root, version = 'v1', weightsExtension = '.weights') {
  const checkpoint = path.join(root, 'models', 'cua-s1', version);
  fs.mkdirSync(checkpoint, { recursive: true });
  const manifest = { schemaVersion: 1, version, createdAt: '2026-11-14T00:00:00.000Z', stages: {}, evaluation: 'evaluation.json' };
  for (const stage of stages) {
    const weights = Buffer.from(`${stage}-weights`);
    const config = Buffer.from(JSON.stringify({ stage, format: 'fixture' }));
    fs.writeFileSync(path.join(checkpoint, `${stage}${weightsExtension}`), weights);
    fs.writeFileSync(path.join(checkpoint, `${stage}.json`), config);
    manifest.stages[stage] = {
      weights: `${stage}${weightsExtension}`, config: `${stage}.json`, sha256: sha(weights),
      options: [`${stage}-a`, `${stage}-b`], thresholds: { [`${stage}-a`]: 0.5, [`${stage}-b`]: 0.6 },
    };
  }
  fs.writeFileSync(path.join(checkpoint, manifest.evaluation), JSON.stringify({ samples: 2 }));
  fs.writeFileSync(path.join(checkpoint, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return checkpoint;
}

function withHome(home, fn) {
  const previous = process.env.HARNESS_SYSTEM_ONE_HOME;
  process.env.HARNESS_SYSTEM_ONE_HOME = home;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env.HARNESS_SYSTEM_ONE_HOME;
    else process.env.HARNESS_SYSTEM_ONE_HOME = previous;
  }
}

function remove(...dirs) { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); }

test('S1-I01 local install copies the manifest-shaped checkpoint without activating it', () => {
  const root = tempDir('harness-s1-repo-'); const home = tempDir('harness-s1-home-');
  try {
    const source = makeRepo(root);
    withHome(home, () => {
      const result = install.installVersion(root, 'v1');
      const target = path.join(home, 'versions', 'v1');
      assert.equal(result.dir, target);
      assert.deepEqual(fs.readdirSync(target).sort(), [
        'evaluation.json', 'intent.json', 'intent.weights', 'manifest.json',
        'tier.json', 'tier.weights', 'validity.json', 'validity.weights',
      ]);
      assert.equal(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'), fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
      assert.equal(fs.existsSync(path.join(home, 'active.json')), false);
    });
  } finally { remove(root, home); }
});

test('S1-I02 install rejects a tampered stage hash before copying any version', () => {
  const root = tempDir('harness-s1-repo-'); const home = tempDir('harness-s1-home-');
  try {
    const source = makeRepo(root);
    fs.writeFileSync(path.join(source, 'intent.weights'), 'tampered');
    withHome(home, () => assert.throws(() => install.installVersion(root, 'v1'), /hash|verification/i));
    assert.equal(fs.existsSync(path.join(home, 'versions', 'v1')), false);
    assert.equal(fs.existsSync(path.join(home, 'active.json')), false);
  } finally { remove(root, home); }
});

test('install accepts referenceOnly only when its option threshold is one', () => {
  const root = tempDir('harness-s1-reference-only-'); const home = tempDir('harness-s1-reference-home-');
  try {
    const source = makeRepo(root);
    const manifestFile = path.join(source, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.stages.intent.thresholds['intent-a'] = 1;
    manifest.stages.intent.referenceOnly = ['intent-a'];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.equal(install.installVersion(root, 'v1', home).status, 'installed');

    const invalidRoot = tempDir('harness-s1-reference-invalid-');
    const invalidHome = tempDir('harness-s1-reference-invalid-home-');
    try {
      const invalidSource = makeRepo(invalidRoot);
      const invalidFile = path.join(invalidSource, 'manifest.json');
      const invalidManifest = JSON.parse(fs.readFileSync(invalidFile, 'utf8'));
      invalidManifest.stages.intent.thresholds['intent-a'] = 0.99;
      invalidManifest.stages.intent.referenceOnly = ['intent-a'];
      fs.writeFileSync(invalidFile, JSON.stringify(invalidManifest));
      assert.throws(() => install.installVersion(invalidRoot, 'v1', invalidHome), /invalid-manifest: malformed intent referenceOnly/);
      assert.equal(fs.existsSync(path.join(invalidHome, 'versions', 'v1')), false);
    } finally { remove(invalidRoot, invalidHome); }
  } finally { remove(root, home); }
});

test('447 rejects nested live stage paths at install while flat stages and nested evaluation still work', t => {
  const root = tempDir('harness-s1-repo-');
  const home = tempDir('harness-s1-home-');
  t.after(() => remove(root, home));
  const source = makeRepo(root, 'v1', '.safetensors');
  const manifestFile = path.join(source, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const artifacts = path.join(source, 'artifacts');
  fs.mkdirSync(artifacts);
  fs.renameSync(path.join(source, manifest.evaluation), path.join(artifacts, manifest.evaluation));
  manifest.evaluation = 'artifacts/evaluation.json';

  for (const field of ['weights', 'config']) {
    const name = manifest.stages.intent[field];
    fs.copyFileSync(path.join(source, name), path.join(artifacts, name));
    const nested = structuredClone(manifest);
    nested.stages.intent[field] = `artifacts/${name}`;
    fs.writeFileSync(manifestFile, JSON.stringify(nested));
    assert.throws(() => validateVersionManifest(nested), /intent weights and config must be flat filenames/);
    assert.throws(() => install.installVersion(root, 'v1', home), /intent weights and config must be flat filenames/);
    assert.equal(fs.existsSync(path.join(home, 'versions')), false);
    assert.equal(fs.existsSync(path.join(home, 'active.json')), false);
  }

  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.equal(validateVersionManifest(manifest), manifest);
  const installed = install.installVersion(root, 'v1', home);
  install.activate('v1', home);
  const active = readActive({ HARNESS_SYSTEM_ONE_HOME: home });
  assert.equal(active?.version, 'v1');
  assert.equal(active.stages.intent.weightsPath, path.join(installed.dir, manifest.stages.intent.weights));
  assert.equal(active.stages.intent.configPath, path.join(installed.dir, manifest.stages.intent.config));
  assert.equal(fs.readFileSync(path.join(installed.dir, manifest.evaluation), 'utf8'), '{"samples":2}');
});

test('S1-I03 activation and rollback round-trip through the previous pointer', () => {
  const root = tempDir('harness-s1-repo-'); const home = tempDir('harness-s1-home-');
  try {
    makeRepo(root, 'v1'); makeRepo(root, 'v2');
    withHome(home, () => {
      install.installVersion(root, 'v1'); install.installVersion(root, 'v2');
      const first = install.activate('v1');
      assert.equal(first.version, 'v1'); assert.equal(first.previous, null);
      assert.equal(first.dir, path.join(home, 'versions', 'v1'));
      assert.ok(Number.isFinite(Date.parse(first.activatedAt)));
      const env = { ...process.env, HARNESS_SYSTEM_ONE_HOME: home, HARNESS_SYSTEM_ONE_MODE: 'live' };
      const activated = spawnSync(process.execPath, [script, 'activate', 'v2'], { encoding: 'utf8', env });
      assert.equal(activated.status, 0, activated.stderr);
      const second = JSON.parse(activated.stdout);
      assert.equal(second.version, 'v2'); assert.equal(second.previous, 'v1');
      assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(home, 'active.json'), 'utf8'))).sort(),
        ['activatedAt', 'dir', 'previous', 'schemaVersion', 'version']);
      const rolled = spawnSync(process.execPath, [script, 'rollback'], { encoding: 'utf8', env });
      assert.equal(rolled.status, 0, rolled.stderr);
      const rolledBack = JSON.parse(rolled.stdout);
      assert.equal(rolledBack.version, 'v1'); assert.equal(rolledBack.previous, 'v2');
      const shown = spawnSync(process.execPath, [script, 'status'], { encoding: 'utf8', env });
      assert.equal(shown.status, 0, shown.stderr);
      assert.equal(JSON.parse(shown.stdout).mode, 'live');
    });
  } finally { remove(root, home); }
});

test('S1-I04 rollback explains when no previous version is recorded', () => {
  const home = tempDir('harness-s1-home-');
  try {
    withHome(home, () => assert.throws(() => install.rollback(), /rollback-unavailable: no previous version/));
  } finally { remove(home); }
});

test('S1-I05 active pointer replacement is atomic and preserves the old pointer on rename failure', () => {
  const root = tempDir('harness-s1-repo-'); const home = tempDir('harness-s1-home-');
  try {
    makeRepo(root, 'v1'); makeRepo(root, 'v2');
    withHome(home, () => {
      install.installVersion(root, 'v1'); install.installVersion(root, 'v2'); install.activate('v1');
      const rename = fs.renameSync;
      fs.renameSync = () => { throw new Error('simulated rename failure'); };
      try { assert.throws(() => install.activate('v2'), /rename|active|atomic/i); }
      finally { fs.renameSync = rename; }
      assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'active.json'), 'utf8')).version, 'v1');
      assert.deepEqual(fs.readdirSync(home).filter(name => name.includes('.tmp')), []);
    });
  } finally { remove(root, home); }
});

test('S1-I06 status reports active and previous hash health with the live-mode hint', () => {
  const root = tempDir('harness-s1-repo-'); const home = tempDir('harness-s1-home-');
  try {
    const source = makeRepo(root, 'v1'); makeRepo(root, 'v2');
    withHome(home, () => {
      install.installVersion(root, 'v1'); install.installVersion(root, 'v2');
      install.activate('v1'); install.activate('v2');
      const healthy = install.status();
      assert.equal(healthy.active.version, 'v2'); assert.equal(healthy.active.hashesOk, true);
      assert.equal(healthy.previous.version, 'v1'); assert.equal(healthy.previous.hashesOk, true);
      assert.match(healthy.modeHint, /HARNESS_SYSTEM_ONE_MODE=live/);
      fs.writeFileSync(path.join(home, 'versions', 'v2', 'tier.weights'), 'tampered');
      assert.equal(install.status().active.hashesOk, false);
      assert.equal(fs.existsSync(path.join(source, 'manifest.json')), true);
    });
  } finally { remove(root, home); }
});

test('S1-I07 argument parsing requires an explicit install source and version', () => {
  const root = path.resolve(os.tmpdir(), 's1-repo');
  assert.deepEqual(install.parseArgs(['install', '--from', root, '--version', 'v1']), {
    command: 'install', from: root, version: 'v1', dir: install.defaultDir(), python: null, dryRun: false,
  });
  assert.deepEqual(install.parseArgs(['activate', 'v1']), { command: 'activate', version: 'v1', dir: install.defaultDir() });
  for (const argv of [[], ['install'], ['install', '--from', 'repo'], ['install', '--from', 'repo', '--version', '../bad'], ['activate'], ['rollback', 'extra'], ['status', 'extra'], ['unknown']]) {
    assert.throws(() => install.parseArgs(argv), { message: 'usage' });
  }
});

test('S1-I08 interpreter selection accepts only the supported Python range', () => {
  for (const version of ['3.11.0', '3.12.4', '3.13.6']) assert.equal(install.supportedPython(version), true);
  for (const version of ['3.10.9', '3.14.0', '2.7.18', '3.13', '', 'x', null]) assert.equal(install.supportedPython(version), false);
  assert.deepEqual(install.pythonCandidates('win32')[0], ['py', '-3.13']);
  assert.deepEqual(install.pythonCandidates('linux')[0], ['python3.13']);
  assert.equal(install.venvPython('/x', 'win32'), path.join('/x', 'venv', 'Scripts', 'python.exe'));
  assert.equal(install.venvPython('/x', 'linux'), path.join('/x', 'venv', 'bin', 'python'));
  assert.ok(install.PINS.cuaS1Spec.includes(`@${PINNED_CUA_S1_REVISION}#subdirectory=libs/cua-s1/python`));
  assert.equal('modelId' in install.PINS, false);
});

test('S1-I09 dry run prints setup without changing files or pinning the public forms checkpoint', () => {
  const root = tempDir('harness-s1-repo-'); const home = path.join(tempDir('harness-s1-home-'), 'target');
  try {
    makeRepo(root);
    const run = () => spawnSync(process.execPath, [script, 'install', '--from', root, '--version', 'v1', '--dir', home, '--python', 'python-not-used', '--dry-run'], { encoding: 'utf8' });
    const one = run(); const two = run();
    assert.equal(one.status, 0, one.stderr); assert.equal(one.stdout, two.stdout);
    const plan = JSON.parse(one.stdout);
    assert.equal(plan.dryRun, true); assert.equal(plan.dir, home); assert.equal(plan.version, 'v1');
    assert.ok(plan.steps.some(step => step.includes(install.PINS.cuaS1Spec)));
    assert.ok(plan.steps.some(step => step.includes(install.PINS.torchIndex)));
    assert.doesNotMatch(one.stdout, /cua-ai\/cua-s1-forms|huggingface\.co/);
    assert.equal(fs.existsSync(home), false);
  } finally { remove(root, path.dirname(home)); }
});

test('S1-I10 child output stays off machine-readable stdout and credentials are omitted from errors', () => {
  const code = `require(${JSON.stringify(script)}).exec(process.execPath, ['-e', 'console.log("pip-noise")'])`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, ''); assert.match(child.stderr, /pip-noise/);
  assert.throws(() => install.exec('command-that-does-not-exist', ['private-repo-url'], true), error => {
    assert.doesNotMatch(error.message, /private-repo-url/);
    return true;
  });
});

test('S1-I11 remote sources reject embedded credentials and non-SSH URLs', () => {
  for (const source of ['https://example.invalid/private.git', 'ssh://git:secret@example.invalid/private.git', 'ssh://git%3Asecret@example.invalid/private.git']) {
    assert.throws(() => install.sourceKind(source), error => {
      assert.match(error.message, /invalid-source/);
      assert.doesNotMatch(error.message, /secret|private\.git/);
      return true;
    });
  }
});

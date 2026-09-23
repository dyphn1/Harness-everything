'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const install = require('../harness-everything/scripts/system-one/install');
const { validateManifest, PINNED_CUA_S1_REVISION } = require('../harness-everything/scripts/system-one/provider');
const script = path.join(__dirname, '../harness-everything/scripts/system-one/install.js');
const sha = buf => createHash('sha256').update(buf).digest('hex');

test('S1-I01 pins stay consistent with the provider contract', () => {
  const { PINS } = install;
  assert.equal(PINS.cuaS1Revision, PINNED_CUA_S1_REVISION);
  assert.ok(PINS.cuaS1Spec.includes(`@${PINNED_CUA_S1_REVISION}#subdirectory=libs/cua-s1/python`));
  assert.match(PINS.modelRevision, /^[0-9a-f]{40}$/);
  assert.equal(PINS.modelId, 'cua-ai/cua-s1-forms'); assert.equal(PINS.domain, 'forms-v1');
  for (const file of Object.values(PINS.files)) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/); assert.ok(Number.isInteger(file.size) && file.size > 0);
    assert.equal(install.fileUrl(file.name), `https://huggingface.co/cua-ai/cua-s1-forms/resolve/${PINS.modelRevision}/${file.name}`);
  }
  assert.equal(path.basename(PINS.files.config.name, '.json'), path.basename(PINS.files.weights.name, '.safetensors'));
  const dir = path.resolve(os.tmpdir(), 'system-one');
  const manifest = install.buildManifest(dir, path.join(dir, 'venv', 'python'));
  assert.equal(validateManifest(manifest), true);
  assert.equal(manifest.checkpoint, path.join(dir, 'checkpoints', PINS.modelRevision, PINS.files.weights.name));
  assert.equal(manifest.weightsSha256, PINS.files.weights.sha256); assert.equal(manifest.configSha256, PINS.files.config.sha256);
  assert.equal(manifest.revision, PINS.modelRevision); assert.equal(manifest.timeoutMs, 10000);
  assert.equal(manifest.transport, 'resident'); assert.equal(manifest.idleTimeoutMs, 1800000);
});

test('S1-I02 interpreter selection accepts only the upstream-supported Python range', () => {
  for (const v of ['3.11.0', '3.12.4', '3.13.6']) assert.equal(install.supportedPython(v), true);
  for (const v of ['3.10.9', '3.14.0', '2.7.18', '3.13', '', 'x', null]) assert.equal(install.supportedPython(v), false);
  const win = install.pythonCandidates('win32');
  assert.deepEqual(win[0], ['py', '-3.13']);
  assert.ok(win.every(c => !c.includes('-3.14')));
  assert.deepEqual(install.pythonCandidates('linux')[0], ['python3.13']);
  assert.equal(install.venvPython('/x', 'win32'), path.join('/x', 'venv', 'Scripts', 'python.exe'));
  assert.equal(install.venvPython('/x', 'linux'), path.join('/x', 'venv', 'bin', 'python'));
});

test('S1-I03 argument parsing is explicit and rejects ambiguous input', () => {
  const home = install.parseArgs([]);
  assert.equal(home.dir, path.join(os.homedir(), '.agents', 'harness-everything', 'system-one'));
  assert.equal(home.python, null); assert.equal(home.dryRun, false);
  const dir = path.resolve(os.tmpdir(), 's1');
  assert.deepEqual(install.parseArgs(['--dir', dir, '--python', 'py', '--dry-run']), { dir, python: 'py', dryRun: true });
  for (const argv of [['--dir', 'relative'], ['--dir'], ['--python'], ['--unknown'], ['extra'], ['--dry-run', '--dry-run']]) {
    assert.throws(() => install.parseArgs(argv), { message: 'usage' });
  }
});

test('S1-I04 downloads are verified before an atomic write; a valid file is reused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-install-'));
  try {
    const good = Buffer.from('pinned-bytes\r\n');
    const spec = { name: 'x.json', sha256: sha(good), size: good.length };
    const dest = path.join(dir, 'x.json');
    let calls = 0;
    const fetcher = bytes => async () => { calls++; return bytes; };
    for (const bad of [Buffer.from('tampered-bytes'), Buffer.concat([good, Buffer.from('x')]), Buffer.alloc(0)]) {
      await assert.rejects(install.ensureFile('https://example.invalid/x', dest, spec, fetcher(bad)), /download-verification/);
      assert.equal(fs.existsSync(dest), false);
      assert.deepEqual(fs.readdirSync(dir), []);
    }
    assert.equal(await install.ensureFile('https://example.invalid/x', dest, spec, fetcher(good)), 'downloaded');
    assert.ok(fs.readFileSync(dest).equals(good));
    const before = calls;
    assert.equal(await install.ensureFile('https://example.invalid/x', dest, spec, fetcher(good)), 'verified-existing');
    assert.equal(calls, before);
    fs.writeFileSync(dest, 'corrupted');
    assert.equal(await install.ensureFile('https://example.invalid/x', dest, spec, fetcher(good)), 'downloaded');
    assert.ok(fs.readFileSync(dest).equals(good));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S1-I06 child command output goes to stderr so stdout stays machine-readable JSON', () => {
  const code = `require(${JSON.stringify(script)}).exec(process.execPath, ['-e', 'console.log("pip-noise")'])`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /pip-noise/);
  const captured = spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(script)}).exec(process.execPath, ['-e', 'console.log("3.13.6")'], true))`], { encoding: 'utf8' });
  assert.equal(captured.stdout, '3.13.6');
});

test('S1-I05 dry run prints the pinned plan and changes nothing, repeatably', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-dry-')), 'target');
  try {
    const run = () => spawnSync(process.execPath, [script, '--dir', dir, '--python', 'python-not-used', '--dry-run'], { encoding: 'utf8' });
    const one = run(); const two = run();
    assert.equal(one.status, 0, one.stderr); assert.equal(one.stdout, two.stdout);
    const plan = JSON.parse(one.stdout);
    assert.equal(plan.dryRun, true); assert.equal(plan.dir, dir);
    assert.equal(plan.manifest, path.join(dir, 'manifest.json'));
    assert.ok(plan.steps.some(s => s.includes(install.PINS.cuaS1Spec)));
    assert.ok(plan.steps.some(s => s.includes(install.PINS.torchIndex)));
    assert.deepEqual(plan.env, { HARNESS_SYSTEM_ONE_MODE: 'shadow', HARNESS_SYSTEM_ONE_CONFIG: path.join(dir, 'manifest.json') });
    assert.equal(fs.existsSync(dir), false);
    const bad = spawnSync(process.execPath, [script, '--dir', 'relative'], { encoding: 'utf8' });
    assert.equal(bad.status, 2); assert.match(bad.stderr, /Usage/);
  } finally { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); }
});

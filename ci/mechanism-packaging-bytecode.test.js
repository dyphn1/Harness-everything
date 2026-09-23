'use strict';
// Python bytecode written by local/CI test runs is an untracked build artifact; no distribution may ship it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { copyDir } = require('../scripts/lib/skills');
const { filesUnder } = require('../scripts/build-openai-submission');
const root = path.resolve(__dirname, '..');
const noise = files => files.filter(f => /(^|[\\/])__pycache__([\\/]|$)|\.py[co]$/.test(f));

function plant(dir) {
  fs.mkdirSync(path.join(dir, '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(dir, '__pycache__', 'cua_adapter.cpython-313.pyc'), 'bytecode');
  fs.writeFileSync(path.join(dir, 'stray.pyc'), 'bytecode');
  fs.writeFileSync(path.join(dir, 'keep.py'), 'print(1)\n');
}

test('PK-01 skills installer copy and submission file walk skip Python bytecode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pk-'));
  try {
    const src = path.join(tmp, 'src', 'scripts');
    plant(src);
    copyDir(path.join(tmp, 'src'), path.join(tmp, 'dest'));
    const copied = filesUnder(path.join(tmp, 'dest'));
    assert.deepEqual(noise(copied), []);
    assert.ok(copied.includes('scripts/keep.py'));
    const walked = filesUnder(path.join(tmp, 'src'));
    assert.deepEqual(noise(walked), []);
    assert.deepEqual(walked, ['scripts/keep.py']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('PK-02 plugin sync does not mirror bytecode from the canonical tree', () => {
  const canonical = path.join(root, 'harness-everything', 'scripts', 'system-one');
  const planted = [path.join(canonical, '__pycache__', 'cua_adapter.cpython-313.pyc'), path.join(canonical, 'stray.pyc')];
  const hadCache = fs.existsSync(path.join(canonical, '__pycache__'));
  try {
    fs.mkdirSync(path.join(canonical, '__pycache__'), { recursive: true });
    for (const file of planted) fs.writeFileSync(file, 'bytecode');
    const sync = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-openai-plugin.js')], { cwd: root, encoding: 'utf8' });
    assert.equal(sync.status, 0, sync.stderr);
    const mirror = path.join(root, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'system-one');
    assert.deepEqual(noise(filesUnder(mirror)), []);
    assert.equal(fs.existsSync(path.join(mirror, '__pycache__')), false);
  } finally {
    for (const file of planted) fs.rmSync(file, { force: true });
    if (!hadCache) fs.rmSync(path.join(canonical, '__pycache__'), { recursive: true, force: true });
  }
});

test('PK-03 Python tests do not write bytecode into the source tree', () => {
  const canonical = path.join(root, 'harness-everything', 'scripts', 'system-one');
  fs.rmSync(path.join(canonical, '__pycache__'), { recursive: true, force: true });
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const run = spawnSync(python, [path.join(__dirname, 'system-one-adapter-test.py')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '' } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(path.join(canonical, '__pycache__')), false);
});

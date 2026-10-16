'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const compat = require('../scripts/codex-hooks-compat');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-323-'));
let failures = 0;
function test(name, run) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message); }
}
// Git for Windows rejects the NUL device as a config file; use real empty paths.
const gitConfig = path.join(root, 'empty.gitconfig');
const gitHooks = path.join(root, 'no-git-hooks');
fs.writeFileSync(gitConfig, '');
fs.mkdirSync(gitHooks);
function samePathOf(left, right) {
  const normalize = value => path.resolve(value).toLowerCase();
  return Boolean(left && right) && normalize(left) === normalize(right);
}
function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=' + gitHooks, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}
try {
  test('A survives B; C collects A; repeat C retains B; uninstall removes retained runtimes', () => {
    const source = path.join(root, 'cache', 'plugin');
    fs.cpSync(compat.SOURCE_PLUGIN_ROOT, source, { recursive: true });
    const codexHome = path.join(root, 'retention-home');
    const install = () => compat.install({ codexHome, sourcePluginRoot: source });
    const a = install();
    fs.writeFileSync(path.join(source, 'revision.txt'), 'B');
    const b = install();
    const oldScript = path.join(a.runtimeDir, 'hooks', 'scripts', 'codex-action-gate-pre.js');
    assert(fs.existsSync(oldScript), 'A hook script must still resolve after B');
    // Resolve the retained script without executing a hook against any user state.
    assert.strictEqual(require.resolve(oldScript), fs.realpathSync(oldScript));
    fs.writeFileSync(path.join(source, 'revision.txt'), 'C');
    const c = install();
    assert(!fs.existsSync(a.runtimeDir), 'third distinct install must collect A');
    assert(fs.existsSync(b.runtimeDir));
    install();
    assert(fs.existsSync(b.runtimeDir), 'same-fingerprint update must retain B');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(c.runtimeDir)).sort(),
      [path.basename(b.runtimeDir), path.basename(c.runtimeDir)].sort());
    compat.uninstall({ codexHome });
    assert(!fs.existsSync(path.dirname(c.runtimeDir)), 'uninstall removes every retained runtime');
  });

  test('status reports a lost previous runtime; same-fingerprint reinstall resets it', () => {
    const source = path.join(root, 'cache', 'plugin-health');
    fs.cpSync(compat.SOURCE_PLUGIN_ROOT, source, { recursive: true });
    const codexHome = path.join(root, 'health-home');
    const install = () => compat.install({ codexHome, sourcePluginRoot: source });
    const a = install();
    fs.writeFileSync(path.join(source, 'revision.txt'), 'B');
    const b = install();
    let report = compat.status({ codexHome });
    assert.strictEqual(report.healthy, true);
    assert.strictEqual(report.runtimes.previous.status, 'present');
    assert(report.runtimes.previous.runtimeDir === a.runtimeDir);
    fs.writeFileSync(path.join(a.runtimeDir, 'tampered.txt'), 'x');
    report = compat.status({ codexHome });
    assert.strictEqual(report.healthy, false);
    assert.strictEqual(report.runtimes.previous.status, 'modified');
    fs.rmSync(a.runtimeDir, { recursive: true, force: true });
    report = compat.status({ codexHome });
    assert.strictEqual(report.healthy, false, 'missing previous runtime must not report healthy');
    assert.strictEqual(report.runtimes.current.healthy, true);
    assert.strictEqual(report.runtimes.previous.status, 'missing');
    assert.strictEqual(report.observationCapture.status, 'configured-unverified');
    assert.strictEqual(report.observationCapture.reason, 'previous-runtime-missing');
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/codex-hooks-compat.js'),
      'status', '--codex-home', codexHome], { encoding: 'utf8' });
    assert.strictEqual(cli.status, 1, 'CLI status must fail when the previous runtime is lost');
    const again = install();
    assert.strictEqual(again.runtimeDir, b.runtimeDir);
    report = compat.status({ codexHome });
    assert.strictEqual(report.healthy, true);
    assert.strictEqual(report.runtimes.previous.status, 'none');
    compat.uninstall({ codexHome });
  });

  test('overlapping installs serialize; neither collects the other current runtime', () => {
    const codexHome = path.join(root, 'concurrent-home');
    const base = path.join(root, 'cache', 'plugin-concurrent');
    fs.cpSync(compat.SOURCE_PLUGIN_ROOT, base, { recursive: true });
    const a = compat.install({ codexHome, sourcePluginRoot: base });
    const sources = {};
    for (const id of ['B', 'C']) {
      sources[id] = path.join(root, 'cache', 'plugin-concurrent-' + id);
      fs.cpSync(base, sources[id], { recursive: true });
      fs.writeFileSync(path.join(sources[id], 'revision.txt'), id);
    }
    const barrier = path.join(root, 'barrier');
    fs.mkdirSync(barrier);
    // Each child waits after preparing its runtime until the peer has also prepared one,
    // forcing the reviewer's interleaving. A serialized peer never arrives, so the wait
    // is bounded and the first holder proceeds alone.
    const child = path.join(root, 'concurrent-child.js');
    fs.writeFileSync(child, `
      const fs = require('fs');
      const path = require('path');
      const [compatPath, codexHome, source, barrier, id, peer] = process.argv.slice(2);
      const compat = require(compatPath);
      const result = compat.install({ codexHome, sourcePluginRoot: source, onRuntimeReady() {
        fs.writeFileSync(path.join(barrier, id), '');
        const deadline = Date.now() + 1500;
        while (!fs.existsSync(path.join(barrier, peer)) && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
      } });
      process.stdout.write(JSON.stringify(result));
    `);
    const driver = path.join(root, 'concurrent-driver.js');
    fs.writeFileSync(driver, `
      const { spawn } = require('child_process');
      const [child, compatPath, codexHome, barrier, sourceB, sourceC] = process.argv.slice(2);
      const runs = [['B', 'C', sourceB], ['C', 'B', sourceC]].map(([id, peer, source]) => new Promise(resolve => {
        const proc = spawn(process.execPath, [child, compatPath, codexHome, source, barrier, id, peer]);
        let out = '', err = '';
        proc.stdout.on('data', chunk => { out += chunk; });
        proc.stderr.on('data', chunk => { err += chunk; });
        proc.on('close', code => resolve({ id, code, out, err }));
      }));
      Promise.all(runs).then(results => process.stdout.write(JSON.stringify(results)));
    `);
    const compatPath = path.resolve(__dirname, '../scripts/codex-hooks-compat.js');
    const run = spawnSync(process.execPath, [driver, child, compatPath, codexHome, barrier, sources.B, sources.C],
      { encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(run.status, 0, run.stderr);
    const results = JSON.parse(run.stdout);
    for (const result of results) assert.strictEqual(result.code, 0, result.id + ': ' + result.err);
    const installed = Object.fromEntries(results.map(result => [result.id, JSON.parse(result.out).runtimeDir]));

    const manifest = JSON.parse(fs.readFileSync(compat.pathsFor(codexHome).manifestFile, 'utf8'));
    assert(fs.existsSync(manifest.runtimeDir), 'final current runtime must exist');
    assert.strictEqual(compat.treeHash(manifest.runtimeDir), manifest.sourcePluginSha256);
    const other = samePathOf(manifest.runtimeDir, installed.B) ? installed.C : installed.B;
    assert(samePathOf(manifest.previousRuntimeDir, other), 'serialized peer becomes the previous runtime');
    assert(fs.existsSync(other), 'no installer may collect the peer runtime it just committed');
    assert(!fs.existsSync(a.runtimeDir), 'only the oldest runtime is collected');
    const hooks = fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8').replace(/\\\\/g, '/');
    const runtime = manifest.runtimeDir.replace(/\\/g, '/');
    const referenced = hooks.match(new RegExp(runtime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^"\\s]+\\.js', 'g')) || [];
    assert(referenced.length > 0, 'hooks.json must reference the current runtime');
    for (const file of referenced) assert(fs.existsSync(file), 'configured command must resolve: ' + file);
    assert.strictEqual(compat.status({ codexHome }).healthy, true);
    assert(!fs.existsSync(compat.pathsFor(codexHome).ownerRoot + '.lock'), 'lock must be released');
    compat.uninstall({ codexHome });
  });

  test('stale lock from a dead process is broken; a live lock times out before writes', () => {
    const source = path.join(root, 'cache', 'plugin-lock');
    fs.cpSync(compat.SOURCE_PLUGIN_ROOT, source, { recursive: true });
    const codexHome = path.join(root, 'lock-home');
    const lockDir = compat.pathsFor(codexHome).ownerRoot + '.lock';
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'owner.json'),
      JSON.stringify({ pid: Number(dead.stdout), hostname: os.hostname() }));
    compat.install({ codexHome, sourcePluginRoot: source, lockTimeoutMs: 5000 });
    assert(!fs.existsSync(lockDir), 'stale lock must be replaced and released');

    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: os.hostname() }));
    const before = fs.readFileSync(path.join(codexHome, 'hooks.json'));
    fs.writeFileSync(path.join(source, 'revision.txt'), 'locked');
    assert.throws(() => compat.install({ codexHome, sourcePluginRoot: source, lockTimeoutMs: 200 }), /timed out.*lock/i);
    assert.throws(() => compat.uninstall({ codexHome, lockTimeoutMs: 200 }), /timed out.*lock/i);
    assert.deepStrictEqual(fs.readFileSync(path.join(codexHome, 'hooks.json')), before);
    assert.strictEqual(fs.readdirSync(compat.pathsFor(codexHome).runtimeRoot).length, 1, 'no runtime created while locked');
    fs.rmSync(lockDir, { recursive: true });
    compat.uninstall({ codexHome });
    assert(!fs.existsSync(path.join(codexHome, 'harness-everything')), 'uninstall leaves no owner or lock directories');
  });

  const repo = path.join(root, 'repo');
  const source = path.join(repo, 'plugins', 'harness-everything');
  fs.cpSync(compat.SOURCE_PLUGIN_ROOT, source, { recursive: true });
  git(repo, ['init']);
  git(repo, ['add', '.']);
  git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  test('tracked plugin in ordinary checkout allows unrelated untracked files', () => {
    fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'unrelated');
    compat.install({ codexHome: path.join(root, 'unrelated-home'), sourcePluginRoot: source });
  });
  test('packaged source inside unrelated dirty repository is allowed', () => {
    const packaged = path.join(repo, 'node_modules', 'harness', 'plugins', 'harness-everything');
    fs.cpSync(compat.SOURCE_PLUGIN_ROOT, packaged, { recursive: true });
    compat.install({ codexHome: path.join(root, 'packaged-home'), sourcePluginRoot: packaged });
  });
  test('ignored files inside plugin subtree are excluded from the runtime, not refused', () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.ignored\n.DS_Store\n');
    git(repo, ['add', '.gitignore']);
    git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'ignore']);
    const codexHome = path.join(root, 'ignored-home');
    const baseline = compat.install({ codexHome, sourcePluginRoot: source });
    const ignored = [path.join(source, 'hooks', 'scripts', 'payload.ignored'), path.join(source, '.DS_Store')];
    for (const file of ignored) fs.writeFileSync(file, 'ignored content');
    try {
      const result = compat.install({ codexHome, sourcePluginRoot: source });
      assert.strictEqual(result.runtimeDir, baseline.runtimeDir, 'ignored files must not change the fingerprint');
      assert(!fs.existsSync(path.join(result.runtimeDir, 'hooks', 'scripts', 'payload.ignored')));
      assert(!fs.existsSync(path.join(result.runtimeDir, '.DS_Store')));
      assert.strictEqual(compat.status({ codexHome }).healthy, true);
    } finally {
      for (const file of ignored) fs.rmSync(file);
    }
  });
  test('clean ordinary checkout installs; dirty checkout refuses before writes; explicit opt-in works', () => {
    const codexHome = path.join(root, 'dirty-home');
    compat.install({ codexHome, sourcePluginRoot: source });
    fs.writeFileSync(path.join(source, 'unreleased.txt'), 'dirty');
    const before = fs.readFileSync(path.join(codexHome, 'hooks.json'));
    assert.throws(() => compat.install({ codexHome, sourcePluginRoot: source }), /unreleased|dirty/i);
    assert.deepStrictEqual(fs.readFileSync(path.join(codexHome, 'hooks.json')), before);
    compat.install({ codexHome, sourcePluginRoot: source, allowUnreleasedSource: true });
    fs.rmSync(path.join(source, 'unreleased.txt'));
  });
  test('linked worktree refuses even when clean; explicit opt-in works', () => {
    const linked = path.join(root, 'linked');
    git(repo, ['worktree', 'add', '-b', 'fixture-linked', linked]);
    const codexHome = path.join(root, 'linked-home');
    const sourcePluginRoot = path.join(linked, 'plugins', 'harness-everything');
    assert.throws(() => compat.install({ codexHome, sourcePluginRoot }), /unreleased|worktree/i);
    assert(!fs.existsSync(codexHome), 'source refusal must happen before writes');
    compat.install({ codexHome, sourcePluginRoot, allowUnreleasedSource: true });
    const packaged = path.join(linked, 'cache', 'harness');
    fs.cpSync(compat.SOURCE_PLUGIN_ROOT, packaged, { recursive: true });
    compat.install({ codexHome: path.join(root, 'linked-cache-home'), sourcePluginRoot: packaged });
  });
  test('CLI forwards explicit unreleased-source opt-in', () => {
    const codexHome = path.join(root, 'cli-home');
    const script = path.resolve(__dirname, '../scripts/codex-hooks-compat.js');
    const result = spawnSync(process.execPath, [script, 'install', '--codex-home', codexHome, '--allow-unreleased-source'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
process.exitCode = failures ? 1 : 0;

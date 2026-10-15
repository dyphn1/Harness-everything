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
function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
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

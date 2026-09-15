'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VERSION_TARGETS, isStableSemVer, syncReleaseVersion } = require('../scripts/sync-release-version');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.releaserc.json'), 'utf8'));

assert.deepStrictEqual(config.branches, ['main']);
assert.ok(config.branches.every(branch => typeof branch === 'string'), 'release branches must not declare prerelease channels');
assert.strictEqual(config.tagFormat, 'v${version}');

const analyzer = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer');
assert.ok(analyzer, 'commit analyzer configuration missing');
const rules = new Map(analyzer[1].releaseRules.filter(rule => rule.type).map(rule => [rule.type, rule.release]));
for (const [type, release] of Object.entries({ refactor: 'patch', build: 'patch', revert: 'patch' })) {
  assert.strictEqual(rules.get(type), release, `${type} release rule`);
}
for (const type of ['docs', 'test', 'ci', 'style', 'chore']) {
  assert.ok(!rules.has(type), `${type} must fall through to semantic-release's no-release default`);
}
assert.ok(analyzer[1].releaseRules.some(rule => rule.breaking === true && rule.release === 'major'));

const execPlugin = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/exec');
assert.ok(execPlugin, 'release preparation hook missing');
assert.match(execPlugin[1].verifyReleaseCmd, /--validate \$\{nextRelease\.version\}/);
assert.match(execPlugin[1].prepareCmd, /sync-release-version\.js \$\{nextRelease\.version\}/);
assert.match(execPlugin[1].prepareCmd, /--check \$\{nextRelease\.version\}/);

const gitPlugin = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/git');
assert.ok(gitPlugin, 'release commit plugin missing');
assert.match(gitPlugin[1].message, /\[skip ci\]/);
assert.ok(gitPlugin[1].assets.includes('package-lock.json'));
assert.ok(gitPlugin[1].assets.includes('opencode-plugin/plugin.json'));

assert.ok(isStableSemVer('1.2.3'));
for (const invalid of ['1.2.3-beta', '1.2.3+build', '01.2.3', '1.2', 'v1.2.3', '']) {
  assert.ok(!isStableSemVer(invalid), invalid);
}

// Normal CI gates every checked-in runtime/plugin manifest against package.json.
// package-lock is intentionally release-owned: the synchronizer fixes its root
// version when semantic-release prepares the actual release transaction.
const packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
assert.ok(isStableSemVer(packageVersion), `package.json must use stable SemVer, got ${packageVersion}`);
for (const target of VERSION_TARGETS.filter(target => target.file !== 'package-lock.json')) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, target.file), 'utf8'));
  const current = target.get(data);
  const values = Array.isArray(current) ? current : [current];
  assert.ok(values.every(value => value === packageVersion), `${target.file} must match package.json version ${packageVersion}`);
  assert.ok(values.every(isStableSemVer), `${target.file} must not carry a prerelease/build suffix`);
}

function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-release-'));
  json(path.join(root, 'package.json'), { name: 'harness-everything', version: '0.3.8-beta' });
  json(path.join(root, 'package-lock.json'), {
    name: 'harness-everything',
    version: '0.3.7-beta',
    packages: { '': { name: 'harness-everything', version: '0.3.7-beta' } }
  });
  json(path.join(root, '.claude-plugin/plugin.json'), { name: 'harness-everything', version: '0.3.8-beta' });
  json(path.join(root, '.claude-plugin/marketplace.json'), { plugins: [{ name: 'harness-everything', version: '0.3.8-beta' }] });
  json(path.join(root, 'plugins/harness-everything/plugin.json'), { name: 'harness-everything', version: '0.3.8-beta' });
  json(path.join(root, 'plugins/harness-everything/.codex-plugin/plugin.json'), { name: 'harness-everything', version: '0.3.8-beta' });
  json(path.join(root, 'opencode-plugin/plugin.json'), { name: 'harness-enforcement', version: '0.3.6' });
  return root;
}

const root = fixture();
const files = syncReleaseVersion(root, '1.2.3');
assert.strictEqual(files.length, 7);
syncReleaseVersion(root, '1.2.3', { checkOnly: true });

const first = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
syncReleaseVersion(root, '1.2.3');
for (const file of files) {
  assert.strictEqual(fs.readFileSync(path.join(root, file), 'utf8'), first.get(file), `${file} must be idempotent`);
}

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.strictEqual(lock.version, '1.2.3');
assert.strictEqual(lock.packages[''].version, '1.2.3');
const market = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf8'));
assert.strictEqual(market.plugins[0].version, '1.2.3');

const portable = path.join(root, 'plugins/harness-everything/plugin.json');
const tampered = JSON.parse(fs.readFileSync(portable, 'utf8'));
tampered.version = '1.2.2';
json(portable, tampered);
assert.throws(() => syncReleaseVersion(root, '1.2.3', { checkOnly: true }), /Release version drift/);
assert.throws(() => syncReleaseVersion(root, '1.2.3-beta'), /stable SemVer/);

const missing = fixture();
const packageBefore = fs.readFileSync(path.join(missing, 'package.json'), 'utf8');
fs.rmSync(path.join(missing, 'opencode-plugin/plugin.json'));
assert.throws(() => syncReleaseVersion(missing, '2.0.0'), /Missing release version target/);
assert.strictEqual(fs.readFileSync(path.join(missing, 'package.json'), 'utf8'), packageBefore, 'validation failure must happen before writes');

console.log('Release automation contract verified: stable SemVer rules, manifest sync, drift detection, idempotency, and fail-before-write behavior.');

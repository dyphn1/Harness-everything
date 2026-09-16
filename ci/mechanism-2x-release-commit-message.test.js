'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.releaserc.json'), 'utf8'));
const gitPlugin = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/git');

assert.ok(gitPlugin, 'release commit plugin missing');
const template = gitPlugin[1].message;
assert.match(template, /\$\{nextRelease\.version\}/, 'release commit must include the calculated version');
assert.match(template, /\[skip ci\]/, 'release commit must not recursively trigger CI');
assert.ok(!template.includes('${nextRelease.notes}'), 'release notes must not be copied into the release commit message');

const currentMessage = template.replace('${nextRelease.version}', '0.4.0');
const currentLines = currentMessage.split(/\r?\n/);
assert.strictEqual(currentLines.length, 1, 'release commit must remain a single-line control message');
assert.ok(currentLines.every(line => line.length <= 100), 'release commit must remain within commitlint line limits');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-release-commitlint-'));
const currentFile = path.join(temp, 'current-message.txt');
const legacyFile = path.join(temp, 'legacy-message.txt');
fs.writeFileSync(currentFile, `${currentMessage}\n`);

// Negative control: this reproduces the production failure from release run
// 34970424994. Generated notes contain long Markdown links, so copying them
// into the Git commit body violates body-max-line-length/footer constraints.
const longReleaseNote = `* **behavioral-evals:** ${'x'.repeat(110)} ([90e36c2](https://github.com/dyphn1/Harness-everything/commit/90e36c2071fb5a71e16cdc99b1060cd3d699c43b)), closes #52`;
const legacyMessage = `chore(release): 0.4.0 [skip ci]\n\n${longReleaseNote}\n`;
fs.writeFileSync(legacyFile, legacyMessage);

const commitlintPackageFile = require.resolve('@commitlint/cli/package.json');
const commitlintPackage = JSON.parse(fs.readFileSync(commitlintPackageFile, 'utf8'));
const commitlintBin = typeof commitlintPackage.bin === 'string'
  ? commitlintPackage.bin
  : commitlintPackage.bin && commitlintPackage.bin.commitlint;
assert.ok(commitlintBin, '@commitlint/cli must expose a commitlint executable');
const commitlintCli = path.resolve(path.dirname(commitlintPackageFile), commitlintBin);

function commitlint(file) {
  return spawnSync(process.execPath, [commitlintCli, '--edit', file], {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

const currentResult = commitlint(currentFile);
assert.strictEqual(
  currentResult.status,
  0,
  `current semantic-release commit must pass commitlint:\n${currentResult.stdout}\n${currentResult.stderr}`
);

const legacyResult = commitlint(legacyFile);
assert.notStrictEqual(legacyResult.status, 0, 'legacy release-notes-in-commit behavior must fail commitlint');
assert.match(
  `${legacyResult.stdout}\n${legacyResult.stderr}`,
  /body-max-line-length|footer-max-line-length/,
  'negative control must fail for the same long-line class seen in production'
);

console.log('Release commit contract verified: compact message passes commitlint and legacy release-note embedding is rejected.');

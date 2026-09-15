'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');

function pinnedVersion(packageName, source = workflow) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`));
  assert.ok(match, `release workflow must pin ${packageName}`);
  return match[1];
}

function major(version) {
  return Number(version.split('.')[0]);
}

function assertCompatible(generatorVersion, presetVersion) {
  if (major(generatorVersion) === 14 && major(presetVersion) >= 10) {
    throw new Error(
      `incompatible release-note tooling: @semantic-release/release-notes-generator@${generatorVersion} ` +
      `uses conventional-changelog-writer 8, but conventional-changelog-conventionalcommits@${presetVersion} requires writer 9+`
    );
  }
}

const generatorVersion = pinnedVersion('@semantic-release/release-notes-generator');
const presetVersion = pinnedVersion('conventional-changelog-conventionalcommits');

assert.strictEqual(generatorVersion, '14.1.1', 'stable release-notes-generator pin changed; re-evaluate writer compatibility');
assert.strictEqual(presetVersion, '9.3.1', 'preset must stay on the writer-8-compatible line while generator 14 is used');
assert.doesNotThrow(() => assertCompatible(generatorVersion, presetVersion));
assert.throws(
  () => assertCompatible('14.1.1', '10.4.0'),
  /incompatible release-note tooling/,
  'negative control must reject the exact #113 failure pairing'
);
assert.doesNotMatch(
  workflow,
  /(?:^|\s)conventional-changelog-writer@\d/m,
  'do not force writer 9 into release-notes-generator 14; upgrade the generator as one compatible stack instead'
);

console.log('Release tooling compatibility verified: generator 14 is paired with conventionalcommits 9.x, and the v10 regression is rejected.');

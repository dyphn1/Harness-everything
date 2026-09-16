const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');
const { isStableSemVer } = require('../scripts/sync-release-version');

console.log('\n[2u] Issue #44 release metadata regression checks...');

const skillText = name => fs.readFileSync(path.join(helper.root, name, 'SKILL.md'), 'utf8');
const versionOf = text => {
  const match = text.match(/^  version:\s*(\S+)$/m);
  return match && match[1];
};

// Skill metadata records the release in which that skill last changed; it is
// intentionally not required to equal the current package version. The
// changed-skill bump policy itself is exercised dynamically by
// mechanism-2x-release-automation.test.js.
const fableVersion = versionOf(skillText('fable-mode'));
helper.check(
  '2u. fable-mode carries stable release metadata',
  isStableSemVer(fableVersion),
  `fable-mode=${fableVersion}`
);
for (const nested of ['execution-guardrails', 'fable-haiku', 'fable-opus', 'fable-sonnet']) {
  helper.check(
    `2u. fable-mode/${nested} inherits the parent version`,
    versionOf(skillText(path.join('fable-mode', nested))) === fableVersion,
    `${nested}=${versionOf(skillText(path.join('fable-mode', nested)))}, parent=${fableVersion}`
  );
}
const todoVersion = versionOf(skillText('todo-driven-workflow'));
helper.check(
  '2u. todo-driven-workflow carries stable release metadata',
  isStableSemVer(todoVersion),
  `todo-driven-workflow=${todoVersion}`
);

const changelog = fs.readFileSync(path.join(helper.root, 'CHANGELOG.md'), 'utf8');
helper.check('2u. changelog records the Issue #44 disclosure policy', /#44/.test(changelog), 'CHANGELOG.md has no #44 entry');

helper.finish();

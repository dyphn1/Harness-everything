const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2u] Issue #44 release metadata regression checks...');

const packageJson = JSON.parse(fs.readFileSync(path.join(helper.root, 'package.json'), 'utf8'));
const skillText = name => fs.readFileSync(path.join(helper.root, name, 'SKILL.md'), 'utf8');
const versionOf = text => {
  const match = text.match(/^  version:\s*(\S+)$/m);
  return match && match[1];
};

helper.check(
  '2u. modified fable-mode skill uses the released package version',
  versionOf(skillText('fable-mode')) === packageJson.version,
  `fable-mode=${versionOf(skillText('fable-mode'))}, package=${packageJson.version}`
);
for (const nested of ['execution-guardrails', 'fable-haiku', 'fable-opus', 'fable-sonnet']) {
  helper.check(
    `2u. fable-mode/${nested} inherits the parent version`,
    versionOf(skillText(path.join('fable-mode', nested))) === versionOf(skillText('fable-mode')),
    `${nested}=${versionOf(skillText(path.join('fable-mode', nested)))}, parent=${versionOf(skillText('fable-mode'))}`
  );
}
helper.check(
  '2u. modified todo-driven-workflow skill uses the released package version',
  versionOf(skillText('todo-driven-workflow')) === packageJson.version,
  `todo-driven-workflow=${versionOf(skillText('todo-driven-workflow'))}, package=${packageJson.version}`
);

const changelog = fs.readFileSync(path.join(helper.root, 'CHANGELOG.md'), 'utf8');
helper.check('2u. changelog records the Issue #44 disclosure policy', /#44/.test(changelog), 'CHANGELOG.md has no #44 entry');

helper.finish();

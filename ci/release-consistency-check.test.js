'use strict';

const assert = require('assert');
const { compareSkillCatalogs, formatAdditions } = require('./release-consistency-check');

const addedSkill = compareSkillCatalogs(
  ['existing-skill'],
  ['code-review', 'existing-skill']
);
assert.deepStrictEqual(addedSkill.missing, [], 'a release-tag skill must remain present');
assert.deepStrictEqual(addedSkill.additions, ['code-review']);
assert.strictEqual(addedSkill.exitCode, 0, 'an extra current skill is informational');
assert.strictEqual(formatAdditions(addedSkill.additions), 'Additions since release tag: code-review');

const missingSkill = compareSkillCatalogs(
  ['existing-skill', 'removed-skill'],
  ['existing-skill']
);
assert.deepStrictEqual(missingSkill.missing, ['removed-skill']);
assert.strictEqual(missingSkill.exitCode, 1, 'a released skill missing from current source must fail');

const renamedSkill = compareSkillCatalogs(
  ['build-multi-agent-system'],
  ['multi-agent-workspace']
);
assert.deepStrictEqual(renamedSkill.missing, [], 'the established rename must satisfy the released entry');
assert.deepStrictEqual(renamedSkill.additions, [], 'a rename must not be reported as a new addition');
assert.strictEqual(renamedSkill.exitCode, 0);

console.log('Release consistency catalog additions, missing-skill failures, and rename mapping verified.');

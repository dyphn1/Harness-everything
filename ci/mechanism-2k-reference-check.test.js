const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');
const { checkSkillReferences } = require('./reference-check');

console.log('\n[2k] Skill reference checker negative control...');
const root = helper.tempDir('.mechanism-test-reference-check');
const skill = path.join(root, 'fixture-skill');
fs.mkdirSync(skill, { recursive: true });
fs.writeFileSync(path.join(skill, 'SKILL.md'), 'Run `scripts/missing.js` before editing.\n');
let result = checkSkillReferences(root, ['fixture-skill']);
helper.check('2k. dangling executable reference fails', result.failures.length === 1 && result.failures[0].reference === 'scripts/missing.js', JSON.stringify(result.failures));

fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(skill, 'scripts', 'missing.js'), '');
result = checkSkillReferences(root, ['fixture-skill']);
helper.check('2k. existing executable reference passes', result.failures.length === 0, JSON.stringify(result.failures));

// --- placeholder heads are authoritative and unknown ones fail ------------
// Regression: `<this-skill-dir>/hooks/x.js` used to jump to the repo root
// because a hardcoded ROOT_PREFIXES list outranked the explicit placeholder.
fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(root, 'hooks', 'shared.js'), '');
fs.writeFileSync(path.join(skill, 'SKILL.md'), 'Run `<this-skill-dir>/hooks/shared.js` first.\n');
result = checkSkillReferences(root, ['fixture-skill']);
helper.check(
  '2k. <this-skill-dir>/ is authoritative and never falls back to the repo root',
  result.failures.length === 1 && result.failures[0].target.split(path.sep).join('/') === 'fixture-skill/hooks/shared.js',
  JSON.stringify(result.failures)
);

fs.mkdirSync(path.join(skill, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(skill, 'hooks', 'shared.js'), '');
result = checkSkillReferences(root, ['fixture-skill']);
helper.check('2k. <this-skill-dir>/ resolves under the skill itself', result.failures.length === 0, JSON.stringify(result.failures));

// `../` reaches a sibling of the skill directory.
fs.writeFileSync(path.join(root, 'shared-note.md'), '');
fs.writeFileSync(path.join(skill, 'SKILL.md'), 'Deep dive: `<this-skill-dir>/../shared-note.md`\n');
result = checkSkillReferences(root, ['fixture-skill']);
helper.check('2k. <this-skill-dir>/../ reaches a sibling', result.failures.length === 0, JSON.stringify(result.failures));

// Regression: a typo'd placeholder used to be skipped silently, which made
// every path in the file invisible to this gate instead of failing it.
fs.writeFileSync(path.join(skill, 'SKILL.md'), 'Deep dive: `<this_folder>/../shared-note.md`\n');
result = checkSkillReferences(root, ['fixture-skill']);
helper.check(
  '2k. unknown placeholder fails instead of being skipped',
  result.failures.length === 1 && result.failures[0].target.indexOf('unknown placeholder <this_folder>') === 0,
  JSON.stringify(result.failures)
);

// `<workspace>/` names a path in the USER's project, so it is deliberately
// recorded as unchecked rather than resolved against this repo.
fs.writeFileSync(path.join(skill, 'SKILL.md'), 'Writes `<workspace>/tasks/todo.md` as it goes.\n');
result = checkSkillReferences(root, ['fixture-skill']);
helper.check('2k. <workspace>/ paths are skipped, not resolved locally', result.failures.length === 0, JSON.stringify(result.failures));

fs.rmSync(root, { recursive: true, force: true });
helper.finish();

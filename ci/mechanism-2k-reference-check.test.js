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

fs.rmSync(root, { recursive: true, force: true });
helper.finish();

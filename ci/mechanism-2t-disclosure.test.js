const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');
const { checkDisclosure, pointerResolves } = require('./disclosure-check');

console.log('\n[2t] Progressive-disclosure negative controls...');

const root = helper.tempDir('.mechanism-test-disclosure');
const skill = path.join(root, 'fixture-skill');
const workflow = path.join(root, 'docs', 'workflows', 'fixture-skill.md');
const references = path.join(skill, 'references');

function setup() {
  fs.mkdirSync(references, { recursive: true });
  fs.mkdirSync(path.dirname(workflow), { recursive: true });
  fs.writeFileSync(path.join(references, 'guide.md'), '# Guide\n', 'utf8');
  fs.writeFileSync(path.join(skill, 'SKILL.md'), [
    '---',
    'name: fixture-skill',
    'description: A fixture skill for disclosure checks.',
    '---',
    '',
    '# Fixture',
    '',
    '## USE FOR:',
    '- Testing disclosure.',
    '',
    '## DO NOT USE FOR:',
    '- Production work.',
    '',
    'Deep dive: references/guide.md',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(workflow, [
    '# Workflow: Fixture',
    '',
    '```mermaid',
    'flowchart TD',
    '  Start([Start]) --> Done([Done])',
    '```',
    '',
  ].join('\n'), 'utf8');
}

function failures() {
  return checkDisclosure(root).failures;
}

setup();
helper.check('2t. complete disclosure surface passes', failures().length === 0, JSON.stringify(failures()));

fs.rmSync(workflow);
helper.check('2t. missing workflow pairing fails', failures().some(f => f.check === 'fixture-skill: workflow document'), JSON.stringify(failures()));
fs.writeFileSync(workflow, '# Workflow: Fixture\n', 'utf8');
helper.check('2t. missing Mermaid coverage fails', failures().some(f => f.check === 'fixture-skill: Mermaid coverage'), JSON.stringify(failures()));
fs.writeFileSync(workflow, '```mermaid\nflowchart TD\n```\n', 'utf8');
helper.check('2t. empty Mermaid transition fails', failures().some(f => f.check === 'fixture-skill: meaningful Mermaid coverage'), JSON.stringify(failures()));
fs.writeFileSync(workflow, '```mermaid\nflowchart TD\n  Start([Start]) --> Done([Done])\n```\n', 'utf8');

// Regression: dashes inside a node label are not a transition.
fs.writeFileSync(workflow, '```mermaid\nflowchart TD\n  Start[Start --- End]\n```\n', 'utf8');
helper.check('2t. dashes inside a node label do not fake a transition', failures().some(f => f.check === 'fixture-skill: meaningful Mermaid coverage'), JSON.stringify(failures()));
fs.writeFileSync(workflow, '```mermaid\nflowchart TD\n  Start([Start]) --> Done([Done])\n```\n', 'utf8');

// Regression: a wildcard pointer must match a file, not merely a non-empty
// directory, and a traversal must not escape the checked-out package.
fs.rmSync(path.join(skill, 'references', 'guide.md'));
fs.writeFileSync(path.join(skill, 'references', 'guide.txt'), '# Guide\n', 'utf8');
helper.check('2t. wildcard Deep dive requires a matching file', !pointerResolves(root, 'fixture-skill', 'references/*.md', ['fixture-skill']), 'references/*.md unexpectedly resolved');
fs.writeFileSync(path.join(skill, 'references', 'guide.md'), '# Guide\n', 'utf8');
helper.check('2t. wildcard Deep dive resolves a matching file', pointerResolves(root, 'fixture-skill', 'references/*.md', ['fixture-skill']), 'references/*.md did not resolve');
const outside = path.resolve(root, '..', 'outside-deep-dive-regression.md');
fs.writeFileSync(outside, '# Outside\n', 'utf8');
helper.check('2t. Deep dive traversal stays inside the package', !pointerResolves(root, 'fixture-skill', '../../outside-deep-dive-regression.md', ['fixture-skill']), 'outside traversal resolved');
fs.rmSync(outside, { force: true });

fs.rmSync(path.join(skill, 'references', 'guide.md'));
helper.check('2t. dangling Deep dive pointer fails', failures().some(f => f.check === 'fixture-skill: Deep dive pointer resolves'), JSON.stringify(failures()));
fs.writeFileSync(path.join(skill, 'references', 'guide.md'), '# Guide\n', 'utf8');
fs.appendFileSync(path.join(skill, 'SKILL.md'), '\n```mermaid\nflowchart TD\n  A --> B\n```\n', 'utf8');
helper.check('2t. Mermaid inside SKILL.md fails', failures().some(f => f.check === 'fixture-skill: no Mermaid in SKILL.md'), JSON.stringify(failures()));

fs.rmSync(references, { recursive: true, force: true });
helper.check('2t. missing references directory fails', failures().some(f => f.check === 'fixture-skill: references directory'), JSON.stringify(failures()));
fs.mkdirSync(references, { recursive: true });
fs.writeFileSync(path.join(references, 'guide.md'), '# Guide\n', 'utf8');
fs.writeFileSync(path.join(root, 'docs', 'workflows', 'orphan.md'), '# Workflow: Orphan\n```mermaid\nflowchart TD\n  A --> B\n```\n', 'utf8');
helper.check('2t. orphan workflow document fails', failures().some(f => f.check === 'orphan: workflow pairing'), JSON.stringify(failures()));

helper.finish();

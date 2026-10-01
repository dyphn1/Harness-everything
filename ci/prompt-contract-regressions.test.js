'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// #268: model aliases evolve, so worker prompts must encode behavior rather
// than generation-specific personality/failure claims.
const workerPairs = [
  ['fable-mode/agents/fable-worker-haiku.md', 'plugins/harness-everything/skills/fable-mode/agents/fable-worker-haiku.md'],
  ['fable-mode/agents/fable-worker-sonnet.md', 'plugins/harness-everything/skills/fable-mode/agents/fable-worker-sonnet.md'],
];
for (const [canonical, packaged] of workerPairs) {
  const body = read(canonical);
  assert.ok(!/\b(?:Haiku|Sonnet)'s known failure\b/i.test(body), canonical + ' must not carry generation-specific failure traits');
  assert.strictEqual(read(packaged), body, canonical + ' packaged mirror must match');
}
assert.ok(/named check is not optional/i.test(read(workerPairs[0][0])), 'Haiku worker keeps the verification behavior');
assert.ok(/A check you did not run did not pass/i.test(read(workerPairs[1][0])), 'Sonnet worker keeps the verification behavior');

// #270: skill-style requires the elements, not one global physical order.
const skillStyle = read('skill-style/SKILL.md');
for (const marker of ['# Skill Style', '## Skill Contract', '## USE FOR:', '## DO NOT USE FOR:', '## Core Rules']) {
  assert.ok(skillStyle.includes(marker), 'skill-style keeps required element: ' + marker);
}
for (const rel of [
  'skill-style/SKILL.md',
  'plugins/harness-everything/skills/skill-style/SKILL.md',
  'docs/workflows/skill-style.md',
  'skill-style/references/style-guide.md',
  'plugins/harness-everything/skills/skill-style/references/style-guide.md',
]) {
  const body = read(rel);
  assert.ok(!/MUST include, in order:/i.test(body), rel + ' must not require the retired global section order');
  assert.ok(!/Include in order:/i.test(body), rel + ' must not describe the retired global section order');
  assert.ok(!/includes in order:/i.test(body), rel + ' must not checklist the retired global section order');
  assert.ok(!/reorder the file to title, introduction, Skill Contract, usage, and actionable rules/i.test(body), rel + ' must not prescribe the retired global section order');
}
assert.ok(/section order MAY vary/i.test(skillStyle), 'skill-style explicitly permits readability-driven section ordering');

// #272: preserve one detailed checkpoint plus the invariant; remove duplicate
// restatements from later sections of the same router injection.
const kernel = path.join(ROOT, 'harness-everything/scripts/kernel-router.js');
const routed = spawnSync(process.execPath, [kernel, 'add a login endpoint with tests and update the implementation'], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.strictEqual(routed.status, 0, routed.stderr || 'kernel router must exit successfully');
assert.ok(routed.stdout.includes('Suggestion evaluation: MANDATORY.'), 'checkpoint keeps the detailed suggestion-resolution rule');
assert.ok(routed.stdout.includes('evaluate-suggestions-before-skip:'), 'semantic invariant remains emitted');
assert.ok(!routed.stdout.includes('Read-before-skip:'), 'workflow-skill footer must not duplicate suggestion resolution');
assert.ok(!routed.stdout.includes('Every suggested skill MUST resolve applicability.'), 'semantic-contract footer must not duplicate suggestion resolution');

console.log('PASS: prompt contract regressions');

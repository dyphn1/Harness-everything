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
assert.ok(/A check\s+you did not run did not pass/i.test(read(workerPairs[1][0])), 'Sonnet worker keeps the verification behavior');

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

// #266: older callers must describe review/evaluation outcomes, not treat
// multi-agent-workspace as a generic subagent executor. Topology remains
// router-owned, and canonical skill files must stay in sync with packaged copies.
const contractPairs = [
  ['to-spec/SKILL.md', 'plugins/harness-everything/skills/to-spec/SKILL.md'],
  ['to-spec/references/process.md', 'plugins/harness-everything/skills/to-spec/references/process.md'],
  ['skill-creator/SKILL.md', 'plugins/harness-everything/skills/skill-creator/SKILL.md'],
  ['skill-creator/references/testing-workflow.md', 'plugins/harness-everything/skills/skill-creator/references/testing-workflow.md'],
  ['skill-creator/references/authoring-workflow.md', 'plugins/harness-everything/skills/skill-creator/references/authoring-workflow.md'],
];
for (const [canonical, packaged] of contractPairs) {
  assert.strictEqual(read(packaged), read(canonical), canonical + ' packaged mirror must match');
}
const contractSurfaces = [
  'to-spec/SKILL.md',
  'to-spec/references/process.md',
  'skill-creator/SKILL.md',
  'skill-creator/references/testing-workflow.md',
  'skill-creator/references/authoring-workflow.md',
  'docs/workflows/skill-creator.md',
];
const staleExecutorClaims = [
  /Design Audit \(\`multi-agent-workspace\`\)/i,
  /recommend invoking \`multi-agent-workspace\`/i,
  /A\/B-test via \`multi-agent-workspace\` subagents/i,
  /multi-agent-workspace subagents/i,
  /`multi-agent-workspace` skill for bounded sub-agent spawning/i,
  /Use `multi-agent-workspace` to spawn/i,
  /multi-agent entrypoint is `multi-agent-workspace`; it owns\s+bounded delegation/i,
];
for (const rel of contractSurfaces) {
  const body = read(rel);
  for (const pattern of staleExecutorClaims) {
    assert.ok(!pattern.test(body), rel + ' must not treat multi-agent-workspace as a generic executor: ' + pattern);
  }
}
assert.ok(/independent Design Audit findings/i.test(read('to-spec/SKILL.md')), 'to-spec requires independent Design Audit evidence');
assert.ok(/Describe the required audit outcome, not an executor/i.test(read('to-spec/references/process.md')), 'to-spec process specifies audit outcome rather than executor');
assert.ok(/A\/B-test isolated control/i.test(read('skill-creator/SKILL.md')), 'skill-creator defines isolated A/B lanes');
assert.ok(/control \(without skill\) vs treatment \(with skill\)/i.test(read('skill-creator/SKILL.md')), 'skill-creator preserves control/treatment semantics');
assert.ok(/topology owned by the active router\/host/i.test(read('skill-creator/references/testing-workflow.md')), 'testing guide keeps evaluation topology router-owned');
assert.ok(/Execution topology belongs to the router\/host/i.test(read('skill-creator/references/authoring-workflow.md')), 'authoring guide keeps execution topology router-owned');
const workspaceContract = read('multi-agent-workspace/SKILL.md');
assert.ok(/router owns that decision/i.test(workspaceContract), 'multi-agent-workspace keeps router-owned topology');
assert.ok(/does not spawn workers/i.test(workspaceContract), 'multi-agent-workspace remains a topology/workspace consumer');

// #273: Fable replan counts are advisory, never execution hard-stops.
// Only repeated same-signature failures invoke mandatory Rule-of-3 reflection.
for (const [canonical, packaged] of [
  ['fable-mode/SKILL.md', 'plugins/harness-everything/skills/fable-mode/SKILL.md'],
  ['fable-mode/fable-opus/SKILL.md', 'plugins/harness-everything/skills/fable-mode/fable-opus/SKILL.md'],
]) {
  const body = read(canonical);
  assert.strictEqual(read(packaged), body, canonical + ' packaged contract matches');
  assert.ok(/advisory replan/i.test(body), canonical + ' must describe replans as advisory');
  assert.ok(/Rule-of-3/i.test(body), canonical + ' must preserve same-signature failure reflection');
  assert.ok(!/at most two (?:full )?replans/i.test(body), canonical + ' must not imply a two-replan hard cap');
}
const orchestratorContract = read('fable-mode/agents/fable-orchestrator.md');
assert.ok(/maxReplans.*advisory/i.test(orchestratorContract), 'orchestrator keeps advisory replan guidance');
assert.ok(/do not block execution/i.test(orchestratorContract), 'orchestrator does not block on replan count');

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

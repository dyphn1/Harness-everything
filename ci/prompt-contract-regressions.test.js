'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

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
for (const rel of [
  'fable-mode/references/execution-phases.md',
  'plugins/harness-everything/skills/fable-mode/references/execution-phases.md',
  'docs/workflows/fable-mode.md',
]) {
  assert.ok(!/(?:at most|no more than) two (?:full )?replans/i.test(read(rel)), rel + ' must not imply a two-replan hard cap');
}
const orchestratorContract = read('fable-mode/agents/fable-orchestrator.md');
assert.ok(/maxReplans[\s\S]{0,60}is advisory/i.test(orchestratorContract), 'orchestrator keeps advisory replan guidance');
assert.ok(/do not block execution/i.test(orchestratorContract), 'orchestrator does not block on replan count');

// #275: build divergence is a diagnostic signal, not a second hard-stop.
// Mandatory blocking/reflection remains limited to Rule-of-3 or permission boundaries.
const fableDiscipline = read('fable-discipline/SKILL.md');
assert.strictEqual(read('plugins/harness-everything/skills/fable-discipline/SKILL.md'), fableDiscipline, 'fable-discipline packaged contract matches canonical');
assert.ok(/divergence is a warning signal/i.test(fableDiscipline), 'fable-discipline must classify divergence as warning guidance');
assert.ok(/does not hard-stop execution/i.test(fableDiscipline), 'divergence must not create an independent hard stop');
assert.ok(/Rule-of-3 owns mandatory reflection/i.test(fableDiscipline), 'Rule-of-3 remains the mandatory reflection owner');
assert.ok(!/HALTS execution immediately/i.test(fableDiscipline), 'fable-discipline must not retain the divergent-build hard halt');
assert.ok(!/If build errors diverge, HALT/i.test(fableDiscipline), 'fable-discipline must not issue an immediate divergence halt');

// #274: grill skills may recommend the explicit publication/ticket commands,
// but must not auto-invoke state-mutating explicit-only skills.
const toSpec = read('to-spec/SKILL.md');
const toTickets = read('to-tickets/SKILL.md');
assert.ok(/Explicit `?\/to-spec`?; never auto-run/i.test(toSpec), 'to-spec remains explicit-only');
assert.ok(/Explicit `?\/to-tickets`? only/i.test(toTickets), 'to-tickets remains explicit-only');
for (const [canonical, packaged] of [
  ['grill-me/SKILL.md', 'plugins/harness-everything/skills/grill-me/SKILL.md'],
  ['grill-with-docs/SKILL.md', 'plugins/harness-everything/skills/grill-with-docs/SKILL.md'],
]) {
  const body = read(canonical);
  assert.strictEqual(read(packaged), body, canonical + ' packaged contract matches');
  assert.ok(/explicit `?\/to-spec`?/i.test(body), canonical + ' must surface the explicit to-spec handoff');
  assert.ok(/Never auto-run `to-spec` or `to-tickets`/i.test(body), canonical + ' must preserve explicit-only publication/ticket gates');
}
assert.ok(!/on consensus, invoke `to-spec`/i.test(read('grill-me/SKILL.md')), 'grill-me must not auto-invoke to-spec');
for (const [canonical, packaged] of [
  ['grill-me/references/grilling-playbook.md', 'plugins/harness-everything/skills/grill-me/references/grilling-playbook.md'],
  ['grill-with-docs/references/session-playbook.md', 'plugins/harness-everything/skills/grill-with-docs/references/session-playbook.md'],
]) {
  const body = read(canonical);
  assert.strictEqual(read(packaged), body, canonical + ' packaged reference matches');
  assert.ok(/recommend explicit `?\/to-spec`?/i.test(body), canonical + ' keeps explicit specification handoff');
  assert.ok(!/MUST[^\n]*hand off to `to-spec/i.test(body), canonical + ' must not mandate automatic to-spec handoff');
}

for (const rel of [
  'docs/workflows/grill-me.md',
  'docs/workflows/grill-with-docs.md',
]) {
  const body = read(rel);
  assert.ok(/suggest|recommend/i.test(body) && /explicit `?\/to-spec`?/i.test(body), rel + ' must recommend an explicit to-spec command');
  assert.ok(/explicit `?\/to-spec`? invocation/i.test(body), rel + ' must preserve the explicit invocation gate');
  assert.ok(/not auto-run|does not invoke|not auto-invoked|does not publish automatically/i.test(body), rel + ' must reject automatic explicit-only handoff');
  assert.ok(!/On consensus, `?to-spec`? invoked/i.test(body), rel + ' must not auto-invoke to-spec on consensus');
  assert.ok(!/aligned design to `?to-spec`?; execution to `?to-tickets/i.test(body), rel + ' must not encode automatic downstream handoff');
}



// #277: completing a task phase does not authorize a Git commit.
// Commit boundaries are guidance unless the user or active host/workflow grants permission.
const gitCommit = read('git-commit/SKILL.md');
const gitCommitFlow = read('git-commit/references/commit-flow.md');
const fableDisciplineRules = read('fable-discipline/references/discipline-rules.md');
assert.strictEqual(read('plugins/harness-everything/skills/git-commit/SKILL.md'), gitCommit, 'git-commit packaged contract matches canonical');
assert.strictEqual(read('plugins/harness-everything/skills/git-commit/references/commit-flow.md'), gitCommitFlow, 'git-commit packaged flow matches canonical');
assert.strictEqual(read('plugins/harness-everything/skills/fable-discipline/references/discipline-rules.md'), fableDisciplineRules, 'fable-discipline packaged rules match canonical');
assert.ok(/task phase alone is not authorization/i.test(gitCommit), 'phase completion must not authorize a commit');
assert.ok(/commit authorization first/i.test(gitCommit), 'git-commit must gate mutation on authorization');
assert.ok(/User \/ Host-Authorized Commit/i.test(gitCommitFlow), 'commit flow must begin from explicit authorization');
assert.ok(/Do Not Commit; Surface Status/i.test(gitCommitFlow), 'unauthorized flow must stop before mutation');
assert.ok(/commits are authorized/i.test(fableDiscipline), 'fable discipline only applies atomic commits after authorization');
assert.ok(/otherwise leave changes uncommitted/i.test(fableDiscipline), 'fable discipline must preserve uncommitted state without authorization');
assert.ok(/Create the commit only when the user or active host\/workflow has authorized commits/i.test(fableDisciplineRules), 'fable reference must not autonomously commit');
assert.ok(!/explicit commit requests or concluded task phases/i.test(gitCommit), 'concluded phases must not remain a commit trigger');
assert.ok(!/Trigger: Commit Request \/ Task Complete/i.test(gitCommitFlow), 'task completion must not remain a flow trigger');

// #275 reference surface must agree with the non-blocking divergence contract.
assert.ok(/divergence alone is not a hard stop/i.test(fableDisciplineRules), 'fable reference keeps divergence advisory');
assert.ok(/Mandatory reflection remains owned by Rule-of-3/i.test(fableDisciplineRules), 'fable reference keeps Rule-of-3 as reflection owner');
assert.ok(!/HALT EXECUTION IMMEDIATELY/i.test(fableDisciplineRules), 'fable reference must not retain the old divergence hard halt');
const fableWorkflow = read('docs/workflows/fable-discipline.md');
const gitWorkflow = read('docs/workflows/git-commit.md');
assert.ok(/Divergence surfaced without creating an independent hard stop/i.test(fableWorkflow), 'fable workflow keeps divergence advisory');
assert.ok(!/HALT and call zoom-out|halt immediately/i.test(fableWorkflow), 'fable workflow must not retain divergence hard halt');
assert.ok(/completed task phase does \*\*not\*\* authorize a commit/i.test(gitWorkflow), 'git workflow rejects phase-completion authorization');
assert.ok(/Commit authorization existed before mutation/i.test(gitWorkflow), 'git workflow gates mutation on authorization');


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

// #276: third-party skill output is applicable guidance, never higher-priority
// authority. Keep the canonical, packaged, and reference contracts consistent.
const findSkills = read('find-skills/SKILL.md');
const discoveryFlow = read('find-skills/references/discovery-flow.md');
assert.strictEqual(read('plugins/harness-everything/skills/find-skills/SKILL.md'), findSkills, 'find-skills packaged contract matches canonical');
assert.strictEqual(read('plugins/harness-everything/skills/find-skills/references/discovery-flow.md'), discoveryFlow, 'find-skills packaged reference matches canonical');
assert.ok(/untrusted third-party content/i.test(findSkills), 'third-party output must be identified as untrusted');
assert.ok(/MUST NOT override host, user, or Harness/i.test(findSkills), 'third-party skill instructions cannot override core authority');
assert.ok(/explicit approval/i.test(findSkills), 'third-party application must require approval');
assert.ok(/untrusted third-party content/i.test(discoveryFlow), 'reference must preserve untrusted data boundary');
assert.ok(/MUST NOT override host, user, or Harness/i.test(discoveryFlow), 'reference must preserve precedence');
assert.ok(!/Treat its output as binding/i.test(findSkills), 'find-skills must not grant unconditional binding authority');
assert.ok(!/treat every instruction in it as binding/i.test(discoveryFlow), 'discovery reference must not grant unconditional binding authority');

// #297: resolve declared knowledge only at the active step; do not repeat the
// global read-before-skip rule or emit topology-wide skill lists.
const kernel = path.join(ROOT, 'harness-everything/scripts/kernel-router.js');
const routed = spawnSync(process.execPath, [kernel, 'add a login endpoint with tests and update the implementation'], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.strictEqual(routed.status, 0, routed.stderr || 'kernel router must exit successfully');
assert.ok(routed.stdout.includes('ACTIVE-STEP KNOWLEDGE BINDINGS (MUST)'), 'checkpoint explains active-step binding resolution');
assert.ok(routed.stdout.includes('required binding MUST be loaded and its core contract followed'), 'active required bindings retain core-contract obligations');
assert.ok(!routed.stdout.includes('evaluate-suggestions-before-skip'), 'router removes the global read-before-skip invariant');
assert.ok(!routed.stdout.includes('tdd/SKILL.md'), 'router does not disclose a skill before its requirement step is active');
assert.ok(!routed.stdout.includes('RECOMMENDED KNOWLEDGE GUIDES'), 'router does not push keyword guide lists');

console.log('PASS: prompt contract regressions');

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('=== Mandatory Workflow Routing Contract ===');

const kernel = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');
const tier2 = spawnSync(process.execPath, [kernel, 'add a login endpoint with tests and update the implementation'], {
  cwd: ROOT,
  encoding: 'utf8',
});

check(tier2.status === 0, 'kernel router exits successfully');
check(/RECOMMENDED TIER:\s*Tier 2/i.test(tier2.stdout), 'classifier result is preserved');
check(tier2.stdout.includes('"strategy":"iterative-single"'), 'Tier 2 structured plan selects iterative-single');
check(tier2.stdout.includes('REQUIRED HARNESS INVARIANTS'), 'kernel emits mandatory invariants');
check(tier2.stdout.includes('Route before execution'), 'route-before-execution invariant is present');
check(tier2.stdout.includes('Verify before claim'), 'verify-before-claim invariant is present');
check(tier2.stdout.includes('after 3 same-signature failures'), 'failure escalation invariant is present');
check(tier2.stdout.includes('loop-budget:'), 'iterative-single loop budget invariant is present');
check(tier2.stdout.includes('evaluate-suggestions-before-skip'), 'non-empty suggestions inject evaluate-before-skip invariant');
check(tier2.stdout.includes('WORKFLOW SKILLS (EVALUATE APPLICABILITY'), 'domain suggestions remain applicability inputs');
check(tier2.stdout.includes('SELECTED WORKFLOW IS MANDATORY'), 'selected workflow execution is mandatory');
check(tier2.stdout.includes('tdd:'), 'Tier 2 can still recommend TDD');
check(!tier2.stdout.includes('BASE EXECUTION LOOP'), 'legacy fixed base-execution-loop output is suppressed');
check(tier2.stdout.includes('Mandatory applicable workflow'), 'orchestration policy requires selected applicable workflow');
check(tier2.stdout.includes('model controls HOW to satisfy its stages'), 'reasoning/implementation freedom remains inside workflow');
check(tier2.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED)'), 'kernel emits workflow execution contract');
check(tier2.stdout.includes('- State: active'), 'selected Tier 2 workflow is active');
check(tier2.stdout.includes('Do not replace it with a direct path merely because the task feels clear, routine, or easy'), 'model confidence cannot bypass workflow');
check(tier2.stdout.includes('Escape is exception-only for genuinely uncovered workflow scope'), 'workflow escape is exception-only');
check(!tier2.stdout.includes('execution remains advisory after evaluation'), 'old advisory execution wording is absent');
check(!tier2.stdout.includes('isolated-worktree-before-mutation'), 'Tier 2 does not inherit the major-workflow worktree invariant');

const tier2Checkpoints = tier2.stdout.match(/HARNESS ROUTING CHECKPOINT \(REQUIRED VISIBLE STATE\)/g) || [];
check(tier2Checkpoints.length === 1, 'Tier 2 emits exactly one routing checkpoint');
check(tier2.stdout.includes('- Tier: Tier 2'), 'checkpoint exposes Tier 2');
check(tier2.stdout.includes('- Strategy: iterative-single'), 'checkpoint exposes selected strategy');
check(/- Required invariants: .*verify-before-claim/.test(tier2.stdout), 'checkpoint exposes required invariants');
check(/- Suggested skills: .*tdd/.test(tier2.stdout), 'checkpoint exposes suggestions');
check(tier2.stdout.includes('Suggestion evaluation: MANDATORY'), 'checkpoint requires suggestion evaluation');
check(tier2.stdout.includes('read its complete SKILL.md entry'), 'checkpoint requires reading skill entry');
check(tier2.stdout.includes('name, description, router summary'), 'checkpoint rejects metadata-only omission');
check(tier2.stdout.includes('routine/common task'), 'checkpoint rejects routine-task omission shortcut');
check(tier2.stdout.includes('selected workflow topology is mandatory'), 'checkpoint distinguishes skill applicability from topology obligation');

const tier3 = spawnSync(process.execPath, [kernel, 'audit the entire repository architecture and coordinate multiple modules'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(tier3.status === 0, 'Tier 3 kernel routing exits successfully');
check(/RECOMMENDED TIER:\s*Tier 3/i.test(tier3.stdout), 'macro task remains Tier 3');
check(tier3.stdout.includes('"strategy":"fable-staged"'), 'Tier 3 task selects fable-staged');
check(tier3.stdout.includes('fable-mode / fable-discipline'), 'Tier 3 plan exposes Fable capabilities');
check(tier3.stdout.includes('when the router selects a Fable topology that topology must be entered and resolved before completion'), 'selected Fable topology is mandatory');
check(tier3.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED)'), 'Tier 3 emits execution contract');
check(tier3.stdout.includes('isolated-worktree-before-mutation'), 'Tier 3 structured plan carries the worktree isolation invariant');
check(tier3.stdout.includes('using-git-worktrees'), 'Tier 3 structured plan surfaces the worktree workflow skill');
check(tier3.stdout.includes('Git worktree isolation is mandatory before source/artifact mutation'), 'Tier 3 execution contract requires worktree isolation before mutation');
check(tier3.stdout.includes('never fall back to the primary working tree'), 'Tier 3 worktree failure blocks instead of falling back in place');

const harnessSkill = read('harness-everything/SKILL.md');
check(/Work that names or matches another skill/i.test(harnessSkill), 'named domain skills still pass through Harness routing');
check(/selected topology is not advisory/i.test(harnessSkill), 'skill contract makes selected topology mandatory');
check(/"Simple", "routine".*cannot justify omission/i.test(harnessSkill), 'skill contract rejects confidence/routine omission shortcuts');
check(/explicit escape with uncovered scope \+ evidence/i.test(harnessSkill), 'skill contract defines evidence-backed escape');
check(/Complete only after applicable workflow obligations and objective verification resolve/i.test(harnessSkill), 'skill contract gates completion on workflow resolution');
check(/mandatory applicable workflow; flexible reasoning\/implementation/i.test(harnessSkill), 'skill entry states core policy');

const pluginHarnessSkill = read('plugins/harness-everything/skills/harness-everything/SKILL.md');
check(pluginHarnessSkill === harnessSkill, 'canonical/plugin Harness SKILL.md copies remain identical');
check(read('plugins/harness-everything/skills/harness-everything/scripts/kernel-router.js') === read('harness-everything/scripts/kernel-router.js'), 'canonical/plugin kernel-router copies remain identical');
check(read('plugins/harness-everything/skills/harness-everything/scripts/kernel-router-core.js') === read('harness-everything/scripts/kernel-router-core.js'), 'canonical/plugin kernel-router core copies remain identical');
check(read('plugins/harness-everything/skills/harness-everything/references/triage-and-tiers.md') === read('harness-everything/references/triage-and-tiers.md'), 'canonical/plugin triage references remain identical');

const worktreeSkill = read('using-git-worktrees/SKILL.md');
check(/Major workflow mode/i.test(worktreeSkill), 'worktree skill defines mandatory major-workflow mode');
check(/never fall back to the primary working tree/i.test(worktreeSkill), 'worktree skill blocks unsafe in-place fallback for major work');
check(/Creation\/entry failure => `BLOCKED`/i.test(worktreeSkill), 'worktree skill makes isolation failure a blocked state');
check(read('plugins/harness-everything/skills/using-git-worktrees/SKILL.md') === worktreeSkill, 'canonical/plugin worktree skill copies remain identical');

const cognitiveSkill = read('install-cognitive-os/SKILL.md');
check(/policy, not a required peer-skill selection/i.test(cognitiveSkill), 'Cognitive OS remains reasoning policy rather than peer dependency');

const hooks = JSON.parse(read('hooks/hooks.json'));
const promptHooks = hooks.hooks && hooks.hooks.UserPromptSubmit;
const command = promptHooks && promptHooks[0] && promptHooks[0].hooks && promptHooks[0].hooks[0] && promptHooks[0].hooks[0].command;
check(command === 'node "${CLAUDE_PLUGIN_ROOT}/harness-everything/scripts/kernel-router.js"', 'UserPromptSubmit anchors kernel to Claude plugin root');
const preHooks = hooks.hooks && hooks.hooks.PreToolUse || [];
const workflowHook = preHooks.find(entry => entry.id === 'harness:pre:workflow-gate');
check(Boolean(workflowHook), 'Claude PreToolUse includes workflow gate');
check(workflowHook && /Bash/.test(workflowHook.matcher) && /PowerShell/.test(workflowHook.matcher) && /Edit/.test(workflowHook.matcher) && /Write/.test(workflowHook.matcher), 'Claude workflow gate covers shell and artifact mutation');
const stopHooks = hooks.hooks && hooks.hooks.Stop || [];
check(stopHooks.some(entry => entry.id === 'harness:stop:workflow-completion-gate'), 'Claude Stop includes Fable workflow completion gate');

const openaiHooks = JSON.parse(read('plugins/harness-everything/hooks/hooks.json'));
const openaiWorkflowHook = (openaiHooks.hooks && openaiHooks.hooks.PreToolUse || []).find(entry =>
  (entry.hooks || []).some(hook => String(hook.command || '').includes('workflow-gate.js'))
);
check(openaiWorkflowHook && /Bash/.test(openaiWorkflowHook.matcher) && /apply_patch/.test(openaiWorkflowHook.matcher), 'Codex/OpenAI packaged workflow gate covers Bash and apply_patch');

const triageDoc = read('harness-everything/references/triage-and-tiers.md');
check(/Mandatory applicable workflow/i.test(triageDoc), 'triage reference documents mandatory applicable workflow');
check(/topology becomes the run's execution contract/i.test(triageDoc), 'triage reference makes topology a contract');
check(/workflow-uncovered-scope/i.test(triageDoc), 'triage reference documents narrow escape policy');
check(/A tier is \*\*not\*\* a fixed TODO\/TDD\/Fable pipeline/i.test(triageDoc), 'triage reference rejects universal tier pipeline');
check(/```mermaid/.test(triageDoc), 'triage reference retains executable flowchart documentation');
check(/cross-host live-enforcement claim/i.test(triageDoc), 'triage reference preserves host evidence boundary');

const routingDoc = read('docs/routing.md');
check(/Mandatory applicable workflow/i.test(routingDoc), 'routing docs use mandatory workflow policy');
check(/workflow-gate\.js/.test(routingDoc), 'routing docs describe PreToolUse workflow gate');
check(/workflow-stop-gate\.js/.test(routingDoc), 'routing docs describe completion gate');
check(/workflow-disposition\.js/.test(routingDoc), 'routing docs describe explicit escape mechanism');
check(!/mandatory to evaluate and advisory to execute/i.test(routingDoc), 'routing docs remove old advisory execution contract');

const architectureDoc = read('docs/architecture.md');
check(/topology becomes a lifecycle contract/i.test(architectureDoc), 'architecture makes selected topology lifecycle contract');
check(/workflow-gate\.js/.test(architectureDoc), 'architecture includes workflow bypass gate');
check(!/Mandatory evaluation, advisory execution/i.test(architectureDoc), 'architecture removes old advisory execution policy');

const philosophyDoc = read('docs/philosophy.md');
check(/Constrain Lifecycle, Not Reasoning/i.test(philosophyDoc), 'philosophy separates lifecycle constraint from reasoning freedom');
check(/Applicable workflow is mandatory/i.test(philosophyDoc), 'philosophy states applicable workflow requirement');
check(!/Mandatory Evaluation, Advisory Execution/i.test(philosophyDoc), 'philosophy removes old advisory execution policy');

const meshDoc = read('docs/mechanism-first-skill-mesh.md');
check(/mandatory applicable workflow \+ local skill autonomy/i.test(meshDoc), 'skill mesh documents mandatory outer workflow and local skill autonomy');
check(/selected topology is mandatory for the run/i.test(meshDoc), 'skill mesh distinguishes selected topology from skill suggestions');

const capabilitiesDoc = read('docs/platform-capabilities.md');
check(capabilitiesDoc.includes('repository/agent contract'), 'platform docs distinguish contract from host enforcement evidence');
check(capabilitiesDoc.includes('does not change `platform-compatibility.json` status values'), 'routing change does not inflate compatibility status');

const advisory = read('scripts/lib/advisory-text.js');
check(/For EVERY suggested skill/i.test(advisory), 'generated advisory instructions require per-suggestion applicability evaluation');
check(/selected workflow topology is mandatory once applicable/i.test(advisory), 'advisory surfaces carry mandatory workflow semantics');
check(/No universal skill pipeline/i.test(advisory), 'advisory surfaces reject universal skill pipeline');
check(/workflow genuinely cannot cover part of the task/i.test(advisory), 'advisory surfaces constrain workflow escape');
check(read('plugins/harness-everything/scripts/lib/advisory-text.js') === advisory, 'OpenAI plugin advisory mirror matches canonical source');

const agents = read('AGENTS.md');
check(/Selected workflow is mandatory; reasoning inside it stays flexible/i.test(agents), 'repository agent contract matches mandatory workflow policy');
check(!/Router suggestions are mandatory to evaluate, advisory to execute/i.test(agents), 'repository agent contract removes old advisory execution rule');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: invariant routing contract (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
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
check(tier2.stdout.includes('WORKFLOW SKILLS (EVALUATE APPLICABILITY'), 'domain suggestions remain applicability inputs to the selected workflow');
check(tier2.stdout.includes('SELECTED WORKFLOW IS MANDATORY'), 'selected workflow execution is mandatory');
check(tier2.stdout.includes('tdd:'), 'Tier 2 can still recommend TDD');
check(!tier2.stdout.includes('BASE EXECUTION LOOP'), 'legacy fixed base-execution-loop output is suppressed');
check(tier2.stdout.includes('Mandatory applicable workflow'), 'orchestration policy requires the selected applicable workflow');
check(tier2.stdout.includes('model controls HOW to satisfy its stages'), 'reasoning/implementation freedom is preserved inside the workflow');
check(tier2.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED)'), 'kernel emits a workflow execution contract');
check(tier2.stdout.includes('- State: active'), 'selected Tier 2 workflow is active');
check(tier2.stdout.includes('Do not replace it with a direct path merely because the task feels clear, routine, or easy'), 'model confidence cannot bypass the workflow');
check(tier2.stdout.includes('Escape is exception-only for genuinely uncovered workflow scope'), 'workflow escape is exception-only');
check(!tier2.stdout.includes('execution remains advisory after evaluation'), 'old advisory execution wording is removed from runtime output');

const tier2Checkpoints = tier2.stdout.match(/HARNESS ROUTING CHECKPOINT \(REQUIRED VISIBLE STATE\)/g) || [];
check(tier2Checkpoints.length === 1, 'Tier 2 emits exactly one required routing checkpoint');
check(tier2.stdout.includes('- Tier: Tier 2'), 'checkpoint exposes the human-readable Tier 2');
check(tier2.stdout.includes('- Strategy: iterative-single'), 'checkpoint exposes the selected strategy');
check(/- Required invariants: .*verify-before-claim/.test(tier2.stdout), 'checkpoint exposes required invariants');
check(/- Suggested skills: .*tdd/.test(tier2.stdout), 'checkpoint exposes deduplicated suggestions');
check(tier2.stdout.includes('Suggestion evaluation: MANDATORY'), 'checkpoint still requires suggestion evaluation');
check(tier2.stdout.includes('read its complete SKILL.md entry'), 'checkpoint requires reading the suggested skill entry before applicability decision');
check(tier2.stdout.includes('name, description, router summary'), 'checkpoint rejects metadata-only omission decisions');
check(tier2.stdout.includes('routine/common task'), 'checkpoint rejects generic routine-task omission decisions');
check(tier2.stdout.includes('selected workflow topology is mandatory'), 'checkpoint separates conditional skill applicability from mandatory topology');

const tier3 = spawnSync(process.execPath, [kernel, 'audit the entire repository architecture and coordinate multiple modules'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(tier3.status === 0, 'Tier 3 kernel routing exits successfully');
check(/RECOMMENDED TIER:\s*Tier 3/i.test(tier3.stdout), 'macro task remains Tier 3');
check(tier3.stdout.includes('"strategy":"fable-staged"'), 'Tier 3 dependent/unproven work selects fable-staged');
check(tier3.stdout.includes('fable-mode / fable-discipline'), 'Tier 3 selected plan exposes Fable capabilities');
check(tier3.stdout.includes('when the router selects a Fable topology that topology must be entered and resolved before completion'), 'Tier 3 Fable execution is mandatory once selected');
check(tier3.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED)'), 'Tier 3 emits the execution contract');
check(tier3.stdout.includes('HARNESS ROUTING CHECKPOINT (REQUIRED VISIBLE STATE)'), 'Tier 3 also emits the required routing checkpoint');

const harnessSkill = read('harness-everything/SKILL.md');
check(!/Requests that already name a skill/i.test(harnessSkill), 'harness entrypoint no longer opts out when another skill is named');
check(/Work that names or matches another skill/i.test(harnessSkill), 'named domain skills still pass through Harness routing');
check(/not a universal fixed skill pipeline/i.test(harnessSkill), 'skill contract rejects a universal fixed skill pipeline');
check(/Harness Routing Checkpoint\*\*.*user-visible/i.test(harnessSkill), 'skill contract requires checkpoint visibility');
check(/For every suggestion, read its `SKILL\.md`/i.test(harnessSkill), 'skill contract requires reading each suggested skill before applicability decision');
check(/`USE FOR`, `DO NOT USE FOR`, workflow\/basic flow, and hard rules/i.test(harnessSkill), 'skill contract defines the required evaluation scope');
check(/routine\/common task.*cannot justify omission/i.test(harnessSkill), 'skill contract rejects metadata/routine omission shortcuts');
check(/selected topology itself is not advisory/i.test(harnessSkill), 'skill contract makes selected workflow mandatory');
check(/explicit workflow escape.*uncovered scope plus evidence/i.test(harnessSkill), 'skill contract defines evidence-backed escape');
check(/Completion requires the selected workflow's applicable obligations and objective verification to resolve/i.test(harnessSkill), 'skill contract gates completion on workflow resolution');
check(/mandatory applicable workflow, flexible reasoning\/implementation/i.test(harnessSkill), 'skill entry states the core disposition succinctly');

const pluginHarnessSkill = read('plugins/harness-everything/skills/harness-everything/SKILL.md');
check(pluginHarnessSkill === harnessSkill, 'canonical/plugin Harness SKILL.md copies remain identical');
const pluginKernel = read('plugins/harness-everything/skills/harness-everything/scripts/kernel-router.js');
check(pluginKernel === read('harness-everything/scripts/kernel-router.js'), 'canonical/plugin kernel-router copies remain identical');
const pluginCore = read('plugins/harness-everything/skills/harness-everything/scripts/kernel-router-core.js');
check(pluginCore === read('harness-everything/scripts/kernel-router-core.js'), 'canonical/plugin kernel-router core copies remain identical');
const pluginTriage = read('plugins/harness-everything/skills/harness-everything/references/triage-and-tiers.md');
check(pluginTriage === read('harness-everything/references/triage-and-tiers.md'), 'canonical/plugin triage references remain identical');

const cognitiveSkill = read('install-cognitive-os/SKILL.md');
check(/policy, not a required peer-skill selection/i.test(cognitiveSkill), 'Cognitive OS is defined as policy rather than peer-skill dependency');
check(!/Tasks already governed by a more specific domain skill/i.test(cognitiveSkill), 'domain skill selection no longer disables Cognitive OS policy');

const hooks = JSON.parse(read('hooks/hooks.json'));
const promptHooks = hooks.hooks && hooks.hooks.UserPromptSubmit;
const command = promptHooks && promptHooks[0] && promptHooks[0].hooks && promptHooks[0].hooks[0] && promptHooks[0].hooks[0].command;
check(command === 'node "${CLAUDE_PLUGIN_ROOT}/harness-everything/scripts/kernel-router.js"', 'UserPromptSubmit anchors the Harness kernel to the Claude plugin root');
const preHooks = hooks.hooks && hooks.hooks.PreToolUse || [];
check(preHooks.some(entry => entry.id === 'harness:pre:workflow-gate' && entry.matcher === 'Edit|Write'), 'Claude PreToolUse mechanically blocks direct mutation before an active Fable workflow is entered');
const stopHooks = hooks.hooks && hooks.hooks.Stop || [];
check(stopHooks.some(entry => entry.id === 'harness:stop:workflow-completion-gate'), 'Claude Stop includes the Fable workflow completion gate');

const triageDoc = read('harness-everything/references/triage-and-tiers.md');
check(triageDoc.includes('Do not enforce workflow order. Enforce workflow invariants and evaluate suggestions before skipping them.'), 'legacy architecture reference remains available pending the workflow-lifecycle documentation update');
check(triageDoc.includes('A tier is **not** a fixed pipeline'), 'tier documentation rejects rigid tier-to-skill orchestration');
check(!triageDoc.includes('MUST load `todo-driven-workflow`'), 'documentation no longer mandates TODO as universal Tier 2/3 first step');
check(triageDoc.includes('```mermaid'), 'updated architecture retains executable flowchart documentation');
check(triageDoc.includes('the kernel always emits a compact checkpoint'), 'reference makes checkpoint emission mandatory');
check(triageDoc.includes('mandatory to **evaluate**'), 'reference requires evaluation of every emitted suggestion');
check(triageDoc.includes('Kernel emission alone is not proof'), 'reference preserves the #82 host-evidence boundary');

const routingDoc = read('docs/routing.md');
check(routingDoc.includes('Suggested skills are mandatory to evaluate and advisory to execute.'), 'legacy routing prose is still detectable until the documentation slice is migrated');

const architectureDoc = read('docs/architecture.md');
check(architectureDoc.includes('Mandatory evaluation, advisory execution'), 'legacy architecture prose is still detectable until the documentation slice is migrated');

const philosophyDoc = read('docs/philosophy.md');
check(philosophyDoc.includes('Mandatory Evaluation, Advisory Execution'), 'legacy philosophy prose is still detectable until the documentation slice is migrated');

const capabilitiesDoc = read('docs/platform-capabilities.md');
check(capabilitiesDoc.includes('repository/agent contract'), 'platform docs distinguish routing contract from host enforcement evidence');
check(capabilitiesDoc.includes('does not change `platform-compatibility.json` status values'), 'routing change does not inflate compatibility status');

const advisory = read('scripts/lib/advisory-text.js');
check(advisory.includes('For EVERY suggested skill'), 'generated advisory instructions still require per-suggestion evaluation');
check(advisory.includes('entry/basic flow before skipping it'), 'Codex AGENTS generator includes read-before-skip');
check(advisory.includes('There is NO universal TODO/TDD/Fable sequence'), 'advisory surfaces reject the old universal execution pipeline');
const pluginAdvisory = read('plugins/harness-everything/scripts/lib/advisory-text.js');
check(pluginAdvisory === advisory, 'OpenAI plugin advisory mirror matches canonical source');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: invariant routing contract (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

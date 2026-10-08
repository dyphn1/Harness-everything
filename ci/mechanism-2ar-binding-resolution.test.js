#!/usr/bin/env node
'use strict';

// PR #303 review: binding availability must come from a real readable file
// under the workspace or an installed skill root, and self-evolved skills stay
// discoverable as metadata-only ids until their declaring step is active.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-binding-resolution-'));
const fakeHome = path.join(stateHome, 'home');
fs.mkdirSync(fakeHome, { recursive: true });
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.PLUGIN_ROOT;
process.env.HARNESS_STATE_HOME = stateHome;
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;

const kernel = path.join(ROOT, 'harness-everything/scripts/kernel-router.js');
const tierRouter = path.join(ROOT, 'harness-everything/scripts/tier-router.js');
const controller = path.join(ROOT, 'hooks/scripts/workflow-disposition.js');

let failed = 0;
function check(condition, message) {
  if (condition) console.log('  PASS ' + message);
  else { console.error('  FAIL ' + message); failed++; }
}
function run(script, args, workspace, input = null) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    input: input === null ? undefined : JSON.stringify(input),
    env: { ...process.env, HARNESS_WORKSPACE_ROOT: workspace },
  });
}
function responseOf(result) {
  try { return JSON.parse(result.stdout || ''); } catch (_) { return null; }
}
function sessionFile(workspace, sessionId, payload, name) {
  const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
  return path.join(getSessionDir(workspace, sessionId, payload), name);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function samePath(left, right) {
  if (!left || !right) return false;
  const real = value => { try { return fs.realpathSync(value); } catch (_) { return path.resolve(value); } };
  return real(left).toLowerCase() === real(right).toLowerCase();
}

console.log('=== PR #303 binding resolution ===');

// 1. Declared paths: syntax alone is not availability.
const missingSession = 'pr303-missing-binding';
const missingPayload = { session_id: missingSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], ROOT, missingPayload).status === 0, 'Tier 2 route persists for declared-path coverage');
const missingRequirements = JSON.stringify([
  {
    id: 'req-change', stepType: 'behavior-change', summary: 'Correct the checkout behavior', acceptance: 'the behavior is corrected',
    requiredBindings: [{ id: 'domain-reference', path: 'docs/pr303-missing-reference.md' }],
    optionalBindings: [{ id: 'routing-reference', path: 'docs/routing.md' }],
  },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'verification evidence is recorded' },
]);
check(run(controller, [
  'plan', '--session-id', missingSession, '--requirements-json', missingRequirements,
  '--strategy', 'iterative-single', '--evidence', 'behavior change then verification',
], ROOT).status === 0, 'plan with a missing declared path is still recorded');
const obligationsFile = sessionFile(ROOT, missingSession, missingPayload, 'workflow-obligations.json');
let state = readJson(obligationsFile);
const missingBinding = state.requirements[0].requiredBindings.find(item => item.id === 'domain-reference');
const presentBinding = state.requirements[0].optionalBindings.find(item => item.id === 'routing-reference');
check(missingBinding.availability === 'missing' && missingBinding.resolvedPath === null,
  'a declared path with no file is recorded as missing, not available');
check(presentBinding.availability === 'available' && samePath(presentBinding.resolvedPath, path.join(ROOT, 'docs/routing.md')),
  'a declared path that exists resolves to its readable file');
check(run(controller, ['start', '--session-id', missingSession], ROOT).status === 0, 'workflow starts with a visible missing binding');
const missingLoad = run(controller, [
  'binding', '--session-id', missingSession, '--step-id', 'req-change', '--binding-id', 'domain-reference',
  '--disposition', 'loaded', '--evidence', 'claimed to read the reference',
], ROOT);
check(missingLoad.status !== 0, 'a missing required binding cannot be marked loaded');
state = readJson(obligationsFile);
const afterLoad = state.requirements[0].requiredBindings.find(item => item.id === 'domain-reference');
check(afterLoad.status === 'unavailable' && afterLoad.reasonCode === 'binding-path-missing',
  'the failed load leaves the required binding visibly unavailable');
check(run(controller, [
  'step', '--session-id', missingSession, '--step-id', 'req-change', '--disposition', 'pass', '--evidence', 'done',
], ROOT).status !== 0, 'the step cannot pass while its required binding is unresolved');
check(run(controller, [
  'binding', '--session-id', missingSession, '--step-id', 'req-change', '--binding-id', 'routing-reference',
  '--disposition', 'loaded', '--evidence', 'read the routing reference',
], ROOT).status === 0, 'an existing optional binding can be loaded');

// 2. Deployed plugin layouts resolve built-in skill bindings.
const emptyWorkspace = fs.mkdtempSync(path.join(stateHome, 'empty-workspace-'));
const canonicalResolver = require(path.join(ROOT, 'hooks/scripts/lib/binding-resolver.js'));
const canonical = canonicalResolver.resolveBinding({ id: 'tdd', path: 'tdd/SKILL.md' }, emptyWorkspace);
check(canonical.availability === 'available' && samePath(canonical.file, path.join(ROOT, 'tdd/SKILL.md')),
  'repository/Claude plugin layout resolves tdd/SKILL.md at the package root');
const codexResolverPath = path.join(ROOT, 'plugins/harness-everything/hooks/scripts/lib/binding-resolver.js');
check(fs.existsSync(codexResolverPath), 'Codex plugin package ships the binding resolver');
if (fs.existsSync(codexResolverPath)) {
  const packaged = require(codexResolverPath).resolveBinding({ id: 'tdd', path: 'tdd/SKILL.md' }, emptyWorkspace);
  check(packaged.availability === 'available' &&
    samePath(packaged.file, path.join(ROOT, 'plugins/harness-everything/skills/tdd/SKILL.md')),
    'Codex plugin layout resolves tdd/SKILL.md under its skills/ root');
}
const absent = canonicalResolver.resolveBinding({ id: 'nowhere', path: 'nowhere/SKILL.md' }, emptyWorkspace);
check(absent.availability === 'missing', 'a path absent from workspace and package roots is missing');

// 2b. A workspace reference never falls back to a same-named Harness file.
check(fs.existsSync(path.join(ROOT, 'docs/architecture.md')), 'fixture precondition: Harness ships docs/architecture.md');
const collision = canonicalResolver.resolveBinding({ id: 'architecture-reference', path: 'docs/architecture.md' }, emptyWorkspace);
check(collision.availability === 'missing' && collision.file === null,
  'a missing workspace reference does not resolve to the Harness package copy');
const packagedSkill = canonicalResolver.resolveBinding({ id: 'verification-loop', path: 'verification-loop/SKILL.md' }, emptyWorkspace);
check(packagedSkill.availability === 'available', 'a skill id naming its own SKILL.md still resolves from the package');
const disguised = canonicalResolver.resolveBinding({ id: 'tdd', path: 'docs/architecture.md' }, emptyWorkspace);
check(disguised.availability === 'missing', 'a registered id at an unregistered path is treated as a workspace reference');

const collisionSession = 'pr303-collision-binding';
const collisionPayload = { session_id: collisionSession, cwd: emptyWorkspace, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], emptyWorkspace, collisionPayload).status === 0, 'Tier 2 route persists in a client workspace');
check(run(controller, [
  'plan', '--session-id', collisionSession, '--requirements-json', JSON.stringify([
    { id: 'req-change', stepType: 'behavior-change', summary: 'Change behavior', acceptance: 'changed',
      requiredBindings: [{ id: 'architecture-reference', path: 'docs/architecture.md' }] },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify', acceptance: 'verified' },
  ]),
  '--strategy', 'iterative-single', '--evidence', 'client workspace without its own architecture doc',
], emptyWorkspace).status === 0, 'client plan declares a workspace reference that collides with a Harness file');
const collisionState = readJson(sessionFile(emptyWorkspace, collisionSession, collisionPayload, 'workflow-obligations.json'));
check(collisionState.requirements[0].requiredBindings.find(item => item.id === 'architecture-reference').availability === 'missing',
  'step flow records the colliding workspace reference as missing');
check(run(controller, ['start', '--session-id', collisionSession], emptyWorkspace).status === 0, 'client workflow starts');
check(run(controller, [
  'binding', '--session-id', collisionSession, '--step-id', 'req-change', '--binding-id', 'architecture-reference',
  '--disposition', 'loaded', '--evidence', 'claimed to read the architecture doc',
], emptyWorkspace).status !== 0, 'step flow cannot load the Harness copy as the workspace reference');

const { prepareRun } = require(path.join(ROOT, 'fable-mode/scripts/workflow-plan-consumer.js'));
const stageRun = prepareRun({
  routerContract: { workflowPlan: { strategySelection: 'selected', strategy: 'fable-staged', tier: 'tier3' } },
  workspaceRoot: emptyWorkspace, runId: 'pr303-collision-stage', sessionId: 'pr303-collision-stage',
  stages: [{
    stageId: 'design', goal: 'design', agent: 'fable-worker-sonnet', task: 'use the architecture doc',
    dependsOn: [], writeSet: [], inputs: [], expectedOutputs: ['notes'],
    requiredBindings: [{ id: 'architecture-reference', path: 'docs/architecture.md' }],
    checkCommand: 'node check.js', passCondition: 'exit 0',
  }],
});
const stageBinding = readJson(path.join(stageRun.runRoot, 'contracts', 'design.json')).requiredBindings[0];
check(stageBinding.availability === 'missing' && stageBinding.resolvedPath === null,
  'stage flow records the colliding workspace reference as missing');

// 3. Self-evolved skills: ids at routing time, file only at the active step.
const workspace = fs.mkdtempSync(path.join(stateHome, 'generated-workspace-'));
const generatedDir = path.join(workspace, '.claude', 'harness-everything', 'skills', 'generated', 'flaky-retry-lesson');
fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(path.join(generatedDir, 'SKILL.md'), '---\nname: flaky-retry-lesson\n---\n# Flaky retry lesson\n');
fs.writeFileSync(path.join(workspace, '.claude', 'harness-everything', 'manifest.json'), JSON.stringify({
  package: 'harness-everything',
  generated: [{ id: 'flaky-retry-lesson', dirPath: generatedDir, description: 'Retry lesson', triggers: ['flaky', 'retry'] }],
}));

const prompt = 'Fix the flaky retry handling in the payment client and add a regression test.';
const routed = run(tierRouter, [prompt], workspace);
check(routed.status === 0, 'router runs against a workspace with a generated-skill manifest');
check(routed.stdout.includes('SELF-EVOLVED SKILL SIGNALS (STEP INPUT ONLY): flaky-retry-lesson'),
  'matching self-evolved skill surfaces as a metadata-only id');
check(!routed.stdout.includes(generatedDir) && !routed.stdout.includes('flaky-retry-lesson/SKILL.md'),
  'router does not disclose the generated skill path or text');
const unmatched = run(tierRouter, ['Rename the payment client constant.'], workspace);
check(!unmatched.stdout.includes('SELF-EVOLVED SKILL SIGNALS'), 'unrelated prompts do not surface the generated skill');

const genSession = 'pr303-generated-binding';
const genPayload = { session_id: genSession, cwd: workspace, prompt };
check(run(kernel, [], workspace, genPayload).status === 0, 'Tier 2 route persists in the generated-skill workspace');
const genRequirements = JSON.stringify([
  { id: 'req-fix', stepType: 'behavior-change', summary: 'Fix retry handling', acceptance: 'flaky retry no longer fails' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify retry handling', acceptance: 'verification evidence recorded', optionalBindings: ['flaky-retry-lesson'] },
]);
check(run(controller, [
  'plan', '--session-id', genSession, '--requirements-json', genRequirements,
  '--strategy', 'iterative-single', '--evidence', 'fix then verify with the retry lesson',
], workspace).status === 0, 'a step can declare the generated skill id as a binding');
const genStart = responseOf(run(controller, ['start', '--session-id', genSession], workspace)) || {};
check(genStart.activeStep?.id === 'req-fix' && !JSON.stringify(genStart).includes('flaky-retry-lesson'),
  'the generated binding is not disclosed before its step is active');
check(run(controller, [
  'binding', '--session-id', genSession, '--step-id', 'req-fix', '--binding-id', 'tdd',
  '--disposition', 'loaded', '--evidence', 'read the TDD contract',
], workspace).status === 0, 'built-in TDD binding resolves from the package root outside the Harness repo');
const advanced = responseOf(run(controller, [
  'step', '--session-id', genSession, '--step-id', 'req-fix', '--disposition', 'pass', '--evidence', 'retry fix complete',
], workspace)) || {};
const generatedBinding = advanced.activeStep?.optionalBindings?.find(item => item.id === 'flaky-retry-lesson');
check(advanced.activeStep?.id === 'req-verify' && generatedBinding?.availability === 'available' &&
  samePath(generatedBinding.resolvedPath, path.join(generatedDir, 'SKILL.md')),
  'the generated binding becomes available with its SKILL.md once its step is active');
check(run(controller, [
  'binding', '--session-id', genSession, '--step-id', 'req-verify', '--binding-id', 'flaky-retry-lesson',
  '--disposition', 'loaded', '--evidence', 'read the retry lesson',
], workspace).status === 0, 'the active generated binding can be loaded');

fs.rmSync(stateHome, { recursive: true, force: true });
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ': PR #303 binding resolution (' + failed + ' failures)');
process.exit(failed === 0 ? 0 : 1);

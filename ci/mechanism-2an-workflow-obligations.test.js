#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-issue85-obligations-'));
process.env.HARNESS_STATE_HOME = stateHome;
process.env.HARNESS_WORKSPACE_ROOT = ROOT;

const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
const kernel = path.join(ROOT, 'harness-everything/scripts/kernel-router.js');
const controller = path.join(ROOT, 'hooks/scripts/workflow-disposition.js');
const stopGate = path.join(ROOT, 'hooks/scripts/workflow-stop-gate.js');
const workflowGate = path.join(ROOT, 'hooks/scripts/workflow-gate.js');
const statePersist = path.join(ROOT, 'hooks/scripts/state-persist.js');

let failed = 0;
function check(condition, message) {
  if (condition) console.log('  PASS ' + message);
  else { console.error('  FAIL ' + message); failed++; }
}
function run(script, args = [], input = null) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: input === null ? undefined : JSON.stringify(input),
    env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: ROOT },
  });
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function responseOf(result) {
  try { return JSON.parse(result.stdout || ''); } catch (_) { return null; }
}

console.log('=== Issue #85 requirements-first workflow contract ===');

const sessionId = 'issue85-tier2';
const payload = { session_id: sessionId, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
const routed = run(kernel, [], payload);
check(routed.status === 0, 'Tier 2 route persists successfully');

const sessionDir = getSessionDir(ROOT, sessionId, payload);
const workflowFile = path.join(sessionDir, 'workflow-run.json');
const obligationFile = path.join(sessionDir, 'workflow-obligations.json');
let workflow = readJson(workflowFile);
let obligations = readJson(obligationFile);
check(workflow.tier === 'tier2' && workflow.strategy === 'iterative-single', 'Tier 2 receives a preliminary iterative-single route');
check(workflow.state === 'pending', 'selected Tier 2 workflow begins pending');
check(workflow.guidance?.mode === 'semantic-contract', 'persisted workflow records semantic-contract mode rather than advisory-workflow');
check(obligations.phase === 'planning', 'Tier 2 immediately materializes a planning contract');
check(obligations.obligations.map(item => item.id).join(',') === 'decompose,compose', 'planning starts with decompose then compose');
check(obligations.requirements.length === 0, 'requirements begin empty instead of being invented by the router');
check(obligations.workflowSelection.candidateStrategy === 'iterative-single', 'router topology is recorded only as candidate strategy');

const prematureStart = run(controller, ['start', '--session-id', sessionId]);
check(prematureStart.status !== 0, 'workflow start refuses to pretend planning is complete');
workflow = readJson(workflowFile);
check(workflow.state === 'pending', 'failed start leaves workflow pending');

const mutationReminder = run(workflowGate, [], {
  session_id: sessionId, cwd: ROOT, hook_event_name: 'PreToolUse',
  tool_name: 'Write', tool_input: { file_path: path.join(ROOT, 'tmp-issue85.txt'), content: 'x' },
});
check(mutationReminder.status === 0, 'unresolved planning does not hard-block ordinary tools');

const beforePlanStop = run(stopGate, [], { session_id: sessionId, cwd: ROOT, hook_event_name: 'Stop' });
workflow = readJson(workflowFile);
check(beforePlanStop.status === 0, 'Stop remains fail-open while planning is unresolved');
check(workflow.state === 'pending', 'unresolved planning cannot silently become satisfied');
check((workflow.unresolved || []).includes('decompose:pending'), 'decomposition gap is visible');
check((workflow.unresolved || []).includes('compose:pending'), 'workflow-composition gap is visible');

const requirements = JSON.stringify([
  { id: 'req-fix', stepType: 'behavior-change', summary: 'Correct the checkout failure', acceptance: 'the failing scenario succeeds' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the checkout change', acceptance: 'objective check evidence is recorded' },
]);
const untypedRequirements = JSON.stringify([
  { id: 'req-untyped', summary: 'Correct the checkout failure', acceptance: 'the failing scenario succeeds' },
]);
check(run(controller, [
  'plan', '--session-id', sessionId, '--requirements-json', untypedRequirements,
  '--strategy', 'iterative-single', '--evidence', 'legacy untyped planning fixture',
]).status !== 0, 'new single-agent plans cannot bypass active step typing');
const planned = run(controller, [
  'plan', '--session-id', sessionId,
  '--requirements-json', requirements,
  '--strategy', 'iterative-single',
  '--evidence', 'two dependent requirements fit a bounded single-agent test/fix/verify loop',
]);
check(planned.status === 0, 'requirements and workflow selection are recorded before execution');
obligations = readJson(obligationFile);
check(obligations.requirements.map(item => item.id).join(',') === 'req-fix,req-verify', 'requirement fragments are machine-readable');
check(obligations.workflowSelection.disposition === 'confirmed', 'workflow choice is explicitly confirmed after decomposition');
check(obligations.obligations.find(item => item.id === 'decompose').status === 'pass', 'decompose obligation resolves from requirement fragments');
check(obligations.obligations.find(item => item.id === 'compose').status === 'pass', 'compose obligation resolves from workflow-selection evidence');

const started = run(controller, ['start', '--session-id', sessionId]);
check(started.status === 0, 'start activates the confirmed non-Fable workflow');
workflow = readJson(workflowFile);
obligations = readJson(obligationFile);
check(workflow.state === 'running', 'confirmed workflow becomes running');
check(obligations.phase === 'execution', 'planning contract advances to execution phase');
check(obligations.obligations.map(item => item.id).join(',') === 'decompose,compose,execute,verify', 'execution adds execute/verify without losing planning evidence');

check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'execute', '--disposition', 'escaped', '--reason-code', 'workflow-uncovered-scope', '--scope', 'optional unrelated cleanup', '--evidence', 'outside requested bug-fix requirements']).status === 0,
  'execution obligation accepts bounded evidence-backed escape');
check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'verify', '--disposition', 'escaped', '--reason-code', 'workflow-uncovered-scope', '--scope', 'tests', '--evidence', 'attempt']).status !== 0,
  'verification obligation cannot be escaped');
check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'verify', '--disposition', 'blocked', '--reason-code', 'verification-environment-unavailable', '--evidence', 'fixture intentionally blocks verification']).status === 0,
  'verification obligation can record explicit blocked evidence');

const blockedStop = run(stopGate, [], { session_id: sessionId, cwd: ROOT, hook_event_name: 'Stop' });
workflow = readJson(workflowFile);
check(blockedStop.status === 0, 'blocked obligation still reminds without trapping Stop');
check(workflow.state === 'running', 'blocked obligation keeps workflow unresolved rather than satisfied');
check((workflow.unresolved || []).includes('verify:blocked'), 'blocked verification remains visible');

check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'verify', '--disposition', 'pass', '--evidence', 'npm test and focused regression passed']).status === 0,
  'verification can later resolve to pass with evidence');
check(run(controller, ['binding', '--session-id', sessionId, '--step-id', 'req-fix', '--binding-id', 'tdd', '--disposition', 'loaded', '--evidence', 'read and followed the TDD core contract before behavior changes']).status === 0,
  'behavior-change binding resolves before its active step passes');
check(run(controller, ['step', '--session-id', sessionId, '--step-id', 'req-fix', '--disposition', 'pass', '--evidence', 'behavior fix and regression case are complete']).status === 0,
  'behavior-change step advances after TDD binding resolution');
check(run(controller, ['binding', '--session-id', sessionId, '--step-id', 'req-verify', '--binding-id', 'verification-loop', '--disposition', 'loaded', '--evidence', 'read the verification contract for this step']).status === 0,
  'verification skill resolves only when the verification step becomes active');
check(run(controller, ['step', '--session-id', sessionId, '--step-id', 'req-verify', '--disposition', 'pass', '--evidence', 'objective checks completed and recorded']).status === 0,
  'verification step passes with objective evidence');
check(run(statePersist, [], {
  session_id: sessionId, cwd: ROOT, hook_event_name: 'PostToolUse',
  tool_name: 'Bash', tool_input: { command: 'npm test' },
  tool_response: { stdout: 'pass', stderr: '', exitCode: 0 },
}).status === 0, 'objective verification milestone is observed after the earlier mutation');
const resolvedStop = run(stopGate, [], { session_id: sessionId, cwd: ROOT, hook_event_name: 'Stop' });
workflow = readJson(workflowFile);
check(resolvedStop.status === 0, 'resolved workflow Stop remains fail-open');
check(workflow.state === 'satisfied', 'planning + execution + verification allow satisfied');
check((workflow.unresolved || []).length === 0, 'satisfied workflow has no unresolved obligations');

const stepSession = 'issue297-active-step-bindings';
const stepPayload = { session_id: stepSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], stepPayload).status === 0, 'Tier 2 route persists for active-step binding coverage');
const stepDir = getSessionDir(ROOT, stepSession, stepPayload);
const stepWorkflowFile = path.join(stepDir, 'workflow-run.json');
const stepObligationFile = path.join(stepDir, 'workflow-obligations.json');
const stepRequirements = JSON.stringify([
  { id: 'req-review', stepType: 'review', summary: 'Inspect the existing checkout change', acceptance: 'the relevant diff has been reviewed', optionalBindings: ['security-review', 'review-guidance'] },
  { id: 'req-change', stepType: 'behavior-change', summary: 'Correct the checkout behavior', acceptance: 'the reported behavior is corrected' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the checkout change', acceptance: 'objective verification evidence is recorded' },
  { id: 'req-commit', stepType: 'commit', summary: 'Commit the requested change', acceptance: 'the authorized commit is recorded' },
]);
check(run(controller, [
  'plan', '--session-id', stepSession,
  '--requirements-json', stepRequirements,
  '--strategy', 'iterative-single',
  '--evidence', 'the request contains review, behavior-change, verification, and commit steps',
]).status === 0, 'normalized ordered steps are recorded in the existing requirements contract');
let stepState = readJson(stepObligationFile);
check(stepState.requirements.map(item => item.stepType || 'legacy').join(',') === 'review,behavior-change,verification,commit',
  'typed steps preserve request order');
check((stepState.requirements[1].requiredBindings || []).map(item => item.id).join(',') === 'tdd',
  'behavior-change step materializes required TDD binding');
check((stepState.requirements[2].requiredBindings || []).map(item => item.id).join(',') === 'verification-loop',
  'verification step owns its verification-loop binding');
check((stepState.requirements[3].requiredBindings || []).map(item => item.id).join(',') === 'git-commit',
  'commit step materializes required git-commit binding');
const stepsWithoutVerification = JSON.stringify([
  { id: 'req-review-only', stepType: 'review', summary: 'Review the diff', acceptance: 'the diff is reviewed' },
]);
check(run(controller, [
  'plan', '--session-id', stepSession, '--requirements-json', stepsWithoutVerification,
  '--strategy', 'iterative-single', '--evidence', 'invalid fixture omits mandatory verification',
]).status !== 0, 'typed-step plan cannot omit the mandatory verification step');

const stepStart = run(controller, ['start', '--session-id', stepSession]);
check(stepStart.status === 0, 'start accepts a confirmed typed-step workflow');
let stepResponse = responseOf(stepStart) || {};
check(stepResponse.activeStep?.id === 'req-review' && stepResponse.activeStep?.stepType === 'review',
  'start returns the first ordered step as active');
check(stepResponse.activeStepCommands?.resolveBinding.includes('--step-id "req-review"') &&
  stepResponse.activeStepCommands?.passStep.includes('--step-id "req-review"'),
  'start returns concrete commands for resolving the active binding and passing the step');
check(stepResponse.activeStep?.requiredBindings?.length === 0 &&
  stepResponse.activeStep?.optionalBindings?.map(item => item.id).join(',') === 'security-review,review-guidance',
  'review starts without TDD and surfaces only its optional binding');
check(stepResponse.activeStep?.optionalBindings?.[0]?.path === 'security-review/SKILL.md',
  'active optional binding includes its load path');
check(!JSON.stringify(stepResponse).includes('tdd') && !JSON.stringify(stepResponse).includes('git-commit'),
  'start does not disclose future-step bindings');
check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-commit', '--binding-id', 'git-commit',
  '--disposition', 'loaded', '--evidence', 'premature future-step load attempt',
]).status !== 0, 'future-step binding cannot be resolved before its step becomes active');
stepState = readJson(stepObligationFile);
check(stepState.activeStepId === 'req-review', 'active step is persisted in workflow-obligations state');
check(stepState.obligations.find(item => item.id === 'execute').suggestedSkills.length === 0 &&
  stepState.obligations.find(item => item.id === 'verify').suggestedSkills.length === 0,
  'typed-step workflows do not reintroduce global suggested-skill pushes');
check(run(controller, [
  'step', '--session-id', stepSession, '--step-id', 'req-review', '--disposition', 'pass',
  '--evidence', 'review finished without resolving optional bindings',
]).status !== 0, 'active step cannot pass before surfaced optional bindings are resolved');

check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-review', '--binding-id', 'security-review',
  '--disposition', 'loaded', '--evidence', 'loaded the security review checklist for this step',
]).status === 0, 'active optional binding can be loaded with evidence');
check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-review', '--binding-id', 'review-guidance',
  '--disposition', 'not-needed',
]).status !== 0, 'optional binding cannot be marked not-needed without evidence');
check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-review', '--binding-id', 'review-guidance',
  '--disposition', 'not-needed', '--evidence', 'the bounded diff review does not need the broader triage guide',
]).status === 0, 'active optional binding can be marked not-needed with evidence');
const reviewAdvance = run(controller, [
  'step', '--session-id', stepSession, '--step-id', 'req-review', '--disposition', 'pass',
  '--evidence', 'the relevant diff and acceptance criteria were reviewed',
]);
const reviewResponse = responseOf(reviewAdvance) || {};
check(reviewAdvance.status === 0, 'review step can pass after its surfaced optional binding is resolved');
stepResponse = reviewResponse;
check(stepResponse.activeStep?.id === 'req-change' &&
  stepResponse.activeStep?.requiredBindings?.map(item => item.id).join(',') === 'tdd',
  'review advance returns only the behavior-change step and its required TDD binding');
check(stepResponse.activeStep?.requiredBindings?.[0]?.path === 'tdd/SKILL.md' &&
  !JSON.stringify(stepResponse).includes('verification-loop') && !JSON.stringify(stepResponse).includes('git-commit'),
  'behavior-change output includes its TDD path but keeps later bindings hidden');
check(run(controller, [
  'step', '--session-id', stepSession, '--step-id', 'req-change', '--disposition', 'pass',
  '--evidence', 'behavior changed',
]).status !== 0, 'behavior-change cannot pass before required TDD binding is resolved');
check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-change', '--binding-id', 'tdd',
  '--disposition', 'loaded', '--evidence', 'read and followed the TDD core contract before changing behavior',
]).status === 0, 'required TDD binding resolves with load evidence');
const changeAdvance = run(controller, [
  'step', '--session-id', stepSession, '--step-id', 'req-change', '--disposition', 'pass',
  '--evidence', 'the checkout behavior and regression case are implemented',
]);
const changeResponse = responseOf(changeAdvance) || {};
check(changeAdvance.status === 0 && changeResponse.activeStep?.id === 'req-verify',
  'resolved behavior-change advances to the mandatory verification step');
stepResponse = changeResponse;
check(stepResponse.activeStep?.requiredBindings?.map(item => item.id).join(',') === 'verification-loop' &&
  !JSON.stringify(stepResponse).includes('git-commit'),
  'verification binding is disclosed only when verification becomes active');
check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-verify', '--binding-id', 'verification-loop',
  '--disposition', 'loaded', '--evidence', 'read the verification-loop contract for this verification step',
]).status === 0, 'verification binding resolves at its own step');
const verifyAdvance = run(controller, [
  'step', '--session-id', stepSession, '--step-id', 'req-verify', '--disposition', 'pass',
  '--evidence', 'objective checks completed and their result is recorded',
]);
const verifyResponse = responseOf(verifyAdvance) || {};
check(verifyAdvance.status === 0 && verifyResponse.activeStep?.id === 'req-commit',
  'verification step advances to commit only after its binding resolves');
stepResponse = verifyResponse;
check(stepResponse.activeStep?.requiredBindings?.map(item => item.id).join(',') === 'git-commit' &&
  !JSON.stringify(stepResponse).includes('tdd') && !JSON.stringify(stepResponse).includes('verification-loop'),
  'commit binding is disclosed only when the commit step becomes active');
check(run(controller, [
  'binding', '--session-id', stepSession, '--step-id', 'req-commit', '--binding-id', 'git-commit',
  '--disposition', 'loaded', '--evidence', 'read the commit authorization and staged-diff contract',
]).status === 0, 'required git-commit binding resolves at the commit step');
const commitAdvance = run(controller, [
  'step', '--session-id', stepSession, '--step-id', 'req-commit', '--disposition', 'pass',
  '--evidence', 'the explicitly requested commit was created and checked',
]);
const commitResponse = responseOf(commitAdvance) || {};
check(commitAdvance.status === 0 && commitResponse.activeStep === null,
  'advancing the last step leaves no active-step bindings');
stepState = readJson(stepObligationFile);
check(stepState.obligations.find(item => item.id === 'execute').status === 'pass' &&
  stepState.obligations.find(item => item.id === 'verify').status === 'pass',
  'completed typed steps resolve their aggregate execute and verify obligations with linked evidence');
const typedResolvedStop = run(stopGate, [], { session_id: stepSession, cwd: ROOT, hook_event_name: 'Stop' });
const typedWorkflow = readJson(stepWorkflowFile);
check(typedResolvedStop.status === 0 && typedWorkflow.state === 'satisfied',
  'all typed steps can satisfy the workflow without separate aggregate dispositions');
check((typedWorkflow.unresolved || []).length === 0, 'satisfied typed-step workflow has no unresolved obligations');

const verifyOnlySession = 'issue297-verification-only';
const verifyOnlyPayload = { session_id: verifyOnlySession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], verifyOnlyPayload).status === 0, 'verification-only workflow route persists');
const verifyOnlyObligationFile = path.join(getSessionDir(ROOT, verifyOnlySession, verifyOnlyPayload), 'workflow-obligations.json');
const verifyOnlyRequirements = JSON.stringify([
  { id: 'req-verify-only', stepType: 'verification', summary: 'Verify existing behavior', acceptance: 'objective checks pass' },
]);
check(run(controller, [
  'plan', '--session-id', verifyOnlySession, '--requirements-json', verifyOnlyRequirements,
  '--strategy', 'iterative-single', '--evidence', 'the request verifies existing behavior without implementation work',
]).status === 0, 'verification-only typed plan is accepted');
const verifyOnlyStart = run(controller, ['start', '--session-id', verifyOnlySession]);
check(verifyOnlyStart.status === 0 && responseOf(verifyOnlyStart)?.activeStep?.id === 'req-verify-only',
  'verification-only typed plan starts at its verification step');
let verifyOnlyState = readJson(verifyOnlyObligationFile);
check(verifyOnlyState.obligations.find(item => item.id === 'execute')?.status === 'pass' &&
  verifyOnlyState.obligations.find(item => item.id === 'execute')?.evidence.includes('verification-only workflow'),
  'empty typed execution group resolves as explicit verification-only evidence');
check(run(controller, [
  'binding', '--session-id', verifyOnlySession, '--step-id', 'req-verify-only', '--binding-id', 'verification-loop',
  '--disposition', 'loaded', '--evidence', 'loaded and followed the verification binding for the active step',
]).status === 0, 'verification-only step resolves its required binding');
check(run(controller, [
  'step', '--session-id', verifyOnlySession, '--step-id', 'req-verify-only', '--disposition', 'pass',
  '--evidence', 'the existing behavior passed its objective verification checks',
]).status === 0, 'verification-only step passes with objective evidence');
const verifyOnlyStop = run(stopGate, [], { session_id: verifyOnlySession, cwd: ROOT, hook_event_name: 'Stop' });
const verifyOnlyWorkflow = readJson(path.join(getSessionDir(ROOT, verifyOnlySession, verifyOnlyPayload), 'workflow-run.json'));
verifyOnlyState = readJson(verifyOnlyObligationFile);
check(verifyOnlyStop.status === 0 && verifyOnlyWorkflow.state === 'satisfied',
  'verification-only workflow can satisfy without an execution step');
check(verifyOnlyState.obligations.find(item => item.id === 'verify')?.status === 'pass',
  'verification-only completion also resolves the aggregate verify obligation');

const unknownSession = 'issue297-unknown-binding';
const unknownPayload = { session_id: unknownSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], unknownPayload).status === 0, 'route persists for unknown-required-binding coverage');
const unknownDir = getSessionDir(ROOT, unknownSession, unknownPayload);
const unknownRequirements = JSON.stringify([
  { id: 'req-unknown-review', stepType: 'review', summary: 'Review the unfamiliar domain change', acceptance: 'the unfamiliar behavior is assessed', requiredBindings: ['unregistered-review-skill'] },
  { id: 'req-unknown-verify', stepType: 'verification', summary: 'Verify the reviewed change', acceptance: 'verification evidence exists' },
]);
check(run(controller, [
  'plan', '--session-id', unknownSession, '--requirements-json', unknownRequirements,
  '--strategy', 'iterative-single', '--evidence', 'a review-only capability was requested explicitly',
]).status === 0, 'unknown required binding is accepted into the auditable contract');
const unknownStart = run(controller, ['start', '--session-id', unknownSession]);
check(unknownStart.status === 0, 'start surfaces rather than silently discarding an unknown required binding');
stepResponse = responseOf(unknownStart) || {};
check(stepResponse.activeStep?.requiredBindings?.[0]?.id === 'unregistered-review-skill' &&
  stepResponse.activeStep?.requiredBindings?.[0]?.path === null &&
  stepResponse.activeStep?.requiredBindings?.[0]?.status === 'pending',
  'unknown required binding remains visible as pending/unavailable');
check(run(controller, [
  'binding', '--session-id', unknownSession, '--step-id', 'req-unknown-review', '--binding-id', 'unregistered-review-skill',
  '--disposition', 'loaded', '--evidence', 'attempted to load unknown skill',
]).status !== 0, 'unknown required binding cannot be falsely marked loaded');
check(run(controller, [
  'step', '--session-id', unknownSession, '--step-id', 'req-unknown-review', '--disposition', 'pass',
  '--evidence', 'review finished',
]).status !== 0, 'step with unknown required binding cannot pass');
const unknownMutationReminder = run(workflowGate, [], {
  session_id: unknownSession, cwd: ROOT, hook_event_name: 'PreToolUse',
  tool_name: 'Write', tool_input: { file_path: path.join(ROOT, 'tmp-unknown-binding.txt'), content: 'x' },
});
check(unknownMutationReminder.status === 0, 'unknown required binding does not hard-block ordinary tools');
const unknownStop = run(stopGate, [], { session_id: unknownSession, cwd: ROOT, hook_event_name: 'Stop' });
const unknownWorkflow = readJson(path.join(unknownDir, 'workflow-run.json'));
check(unknownStop.status === 0 && unknownWorkflow.state === 'running',
  'missing binding keeps Stop fail-open while workflow remains unresolved');
check((unknownWorkflow.unresolved || []).some(item => item.includes('unregistered-review-skill')),
  'Stop reports the unresolved unknown binding');

const referenceSession = 'issue297-custom-reference-binding';
const referencePayload = { session_id: referenceSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], referencePayload).status === 0, 'custom-reference workflow route persists');
const referenceRequirements = JSON.stringify([
  { id: 'req-reference-review', stepType: 'review', summary: 'Review the domain-specific behavior', acceptance: 'the domain rule is checked', requiredBindings: [{ id: 'domain-reference', path: 'docs\\philosophy.md' }] },
  { id: 'req-reference-verify', stepType: 'verification', summary: 'Verify the domain change', acceptance: 'objective check evidence exists' },
]);
check(run(controller, [
  'plan', '--session-id', referenceSession, '--requirements-json', referenceRequirements,
  '--strategy', 'iterative-single', '--evidence', 'the review step requires one explicit domain reference',
]).status === 0, 'step contracts accept an explicit skill/reference path');
const referenceStart = run(controller, ['start', '--session-id', referenceSession]);
stepResponse = responseOf(referenceStart) || {};
check(referenceStart.status === 0 && stepResponse.activeStep?.requiredBindings?.[0]?.path === 'docs/philosophy.md',
  'custom reference path is normalized and disclosed only at its active step');
check(run(controller, [
  'binding', '--session-id', referenceSession, '--step-id', 'req-reference-review', '--binding-id', 'domain-reference',
  '--disposition', 'loaded', '--evidence', 'read docs/philosophy.md before completing the review',
]).status === 0, 'explicit reference binding can resolve with evidence');
check(run(controller, [
  'step', '--session-id', referenceSession, '--step-id', 'req-reference-review', '--disposition', 'pass',
  '--evidence', 'the relevant domain rule was applied in the review',
]).status === 0, 'active step can pass after its explicit reference binding is resolved');
const unsafeReferenceRequirements = JSON.stringify([
  { id: 'req-unsafe-reference', stepType: 'review', summary: 'Review a rule', acceptance: 'the rule is checked', requiredBindings: [{ id: 'unsafe-reference', path: '../private.md' }] },
  { id: 'req-unsafe-verify', stepType: 'verification', summary: 'Verify the review', acceptance: 'objective check evidence exists' },
]);
const unsafeReferenceSession = 'issue297-unsafe-reference-binding';
check(run(kernel, [], { session_id: unsafeReferenceSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' }).status === 0,
  'unsafe-reference workflow route persists');
check(run(controller, [
  'plan', '--session-id', unsafeReferenceSession, '--requirements-json', unsafeReferenceRequirements,
  '--strategy', 'iterative-single', '--evidence', 'unsafe traversal path should be rejected',
]).status !== 0, 'step bindings reject paths that traverse outside repository scope');
const driveReferenceSession = 'issue297-drive-reference-binding';
check(run(kernel, [], { session_id: driveReferenceSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' }).status === 0,
  'drive-reference workflow route persists');
const driveReferenceRequirements = JSON.stringify([
  { id: 'req-drive-reference', stepType: 'review', summary: 'Review a rule', acceptance: 'the rule is checked', requiredBindings: [{ id: 'drive-reference', path: 'C:outside.md' }] },
  { id: 'req-drive-verify', stepType: 'verification', summary: 'Verify the review', acceptance: 'objective check evidence exists' },
]);
check(run(controller, [
  'plan', '--session-id', driveReferenceSession, '--requirements-json', driveReferenceRequirements,
  '--strategy', 'iterative-single', '--evidence', 'drive-relative path should be rejected',
]).status !== 0, 'step bindings reject Windows drive-relative paths');

const mismatchSession = 'issue85-replan';
const mismatchPayload = { session_id: mismatchSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], mismatchPayload).status === 0, 'second Tier 2 route persists for replan discriminator');
const mismatchDir = getSessionDir(ROOT, mismatchSession, mismatchPayload);
const initialSignals = readJson(path.join(mismatchDir, 'workflow-run.json')).workflowPlan.knowledgeSignals || [];
check(initialSignals.includes('tdd-test'), 'initial route records normalized knowledge signals');
const mismatchPlan = run(controller, [
  'plan', '--session-id', mismatchSession,
  '--requirements-json', requirements,
  '--strategy', 'fable-staged',
  '--evidence', 'decomposition indicates dependent multi-stage work instead',
]);
check(mismatchPlan.status === 0, 'post-decomposition workflow can be recomposed through the router contract');
const mismatchObligations = readJson(path.join(mismatchDir, 'workflow-obligations.json'));
const mismatchWorkflow = readJson(path.join(mismatchDir, 'workflow-run.json'));
check(mismatchObligations.workflowSelection.disposition === 'confirmed', 'recomposed workflow receives an explicit confirmed disposition');
check(mismatchObligations.workflowSelection.requestedStrategy === 'fable-staged' &&
  mismatchObligations.workflowSelection.confirmedStrategy === 'fable-staged',
  'requested and router-confirmed post-decomposition strategy are preserved');
check(mismatchWorkflow.pendingPlan?.strategy === 'fable-staged', 'recomposed plan becomes the pending execution contract');
check(JSON.stringify(mismatchWorkflow.pendingPlan?.knowledgeSignals) === JSON.stringify(initialSignals),
  'strategy recomposition preserves the original knowledge signals');
const mismatchStop = run(stopGate, [], { session_id: mismatchSession, cwd: ROOT, hook_event_name: 'Stop' });
const mismatchAfterStop = readJson(path.join(mismatchDir, 'workflow-run.json'));
check(mismatchStop.status === 0 && mismatchAfterStop.state === 'pending' &&
  (mismatchAfterStop.unresolved || []).includes('execution:not-started'),
  'recomposed workflow cannot become satisfied before its selected topology starts');
const mismatchStart = run(controller, ['start', '--session-id', mismatchSession]);
check(mismatchStart.status !== 0 && /workflow-stages\.json/.test(mismatchStart.stderr || ''),
  'recomposed Fable topology proceeds to its native stage-contract requirement');
check(run(workflowGate, [], {
  session_id: mismatchSession, cwd: ROOT, hook_event_name: 'PreToolUse',
  tool_name: 'Write', tool_input: { file_path: path.join(ROOT, 'tmp-replan.txt'), content: 'x' },
}).status === 0, 'recomposed planning state still does not recreate a tool lock');

const prohibitedSession = 'issue85-prohibited-recompose';
const prohibitedPayload = { session_id: prohibitedSession, cwd: ROOT, prompt: 'Fix this checkout bug with a regression test. Do not use fable.' };
check(run(kernel, [], prohibitedPayload).status === 0, 'prohibition fixture routes successfully');
const prohibitedRequirements = JSON.stringify([
  { id: 'req-safe', summary: 'Resolve the bug under the user constraints', acceptance: 'the fix is verified without prohibited topology' },
]);
const prohibitedPlan = run(controller, [
  'plan', '--session-id', prohibitedSession,
  '--requirements-json', prohibitedRequirements,
  '--strategy', 'fable-staged',
  '--evidence', 'candidate considered after decomposition',
]);
check(prohibitedPlan.status === 0, 'prohibited post-decomposition choice is evaluated by router policy');
const prohibitedDir = getSessionDir(ROOT, prohibitedSession, prohibitedPayload);
const prohibitedObligations = readJson(path.join(prohibitedDir, 'workflow-obligations.json'));
check(prohibitedObligations.workflowSelection.disposition === 'blocked', 'original user prohibition survives recomposition');
check(prohibitedObligations.obligations.find(item => item.id === 'decompose').status === 'pass' &&
  prohibitedObligations.obligations.find(item => item.id === 'compose').status === 'blocked',
  'requirements remain valid while only the prohibited workflow choice stays unresolved');

const fableSession = 'issue85-fable';
const fablePayload = { session_id: fableSession, cwd: ROOT, prompt: 'Refactor the entire authentication architecture in dependent stages.' };
check(run(kernel, [], fablePayload).status === 0, 'Tier 3 Fable candidate persists successfully');
const fableDir = getSessionDir(ROOT, fableSession, fablePayload);
const fableWorkflow = readJson(path.join(fableDir, 'workflow-run.json'));
const fablePlanning = readJson(path.join(fableDir, 'workflow-obligations.json'));
check(fableWorkflow.strategy === 'fable-staged', 'Tier 3 keeps Fable as preliminary candidate');
check(fablePlanning.obligations.map(item => item.id).join(',') === 'decompose,compose', 'Fable also requires requirements/workflow planning before stage execution');
check(run(controller, ['start', '--session-id', fableSession]).status !== 0, 'Fable cannot enter stage execution before planning contract resolves');

const tier1Session = 'issue85-tier1';
const tier1Payload = { session_id: tier1Session, cwd: ROOT, prompt: 'Update one README typo' };
check(run(kernel, [], tier1Payload).status === 0, 'Tier 1 route persists successfully');
const tier1Dir = getSessionDir(ROOT, tier1Session, tier1Payload);
const tier1WorkflowFile = path.join(tier1Dir, 'workflow-run.json');
check(!fs.existsSync(path.join(tier1Dir, 'workflow-obligations.json')), 'clear bounded Tier 1 intent has no decomposition overhead');
check(run(stopGate, [], { session_id: tier1Session, cwd: ROOT, hook_event_name: 'Stop' }).status === 0, 'Tier 1 direct Stop remains lightweight');
const tier1Workflow = readJson(tier1WorkflowFile);
check(tier1Workflow.strategy === 'direct-single' && tier1Workflow.state === 'satisfied', 'Tier 1 remains a minimal direct path');

const runtimeSource = fs.readFileSync(path.join(ROOT, 'hooks/scripts/lib/workflow-runtime.js'), 'utf8');
check(!runtimeSource.includes('.mutation-probes.lock'), '#190 mutation-probe lock remains retired');
check(!runtimeSource.includes('budget-exhausted'), '#190 hard budget state remains retired');

fs.rmSync(stateHome, { recursive: true, force: true });
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ': issue #85 requirements-first workflow contract (' + failed + ' failures)');
process.exit(failed === 0 ? 0 : 1);

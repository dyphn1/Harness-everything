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
  { id: 'req-fix', summary: 'Correct the checkout failure', acceptance: 'the failing scenario succeeds', suggestedSkills: ['tdd'] },
  { id: 'req-regression', summary: 'Protect the behavior with a regression test', acceptance: 'the test fails before the fix and passes after it', suggestedSkills: ['tdd', 'verification-loop'] },
]);
const planned = run(controller, [
  'plan', '--session-id', sessionId,
  '--requirements-json', requirements,
  '--strategy', 'iterative-single',
  '--evidence', 'two dependent requirements fit a bounded single-agent test/fix/verify loop',
]);
check(planned.status === 0, 'requirements and workflow selection are recorded before execution');
obligations = readJson(obligationFile);
check(obligations.requirements.map(item => item.id).join(',') === 'req-fix,req-regression', 'requirement fragments are machine-readable');
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

const mismatchSession = 'issue85-replan';
const mismatchPayload = { session_id: mismatchSession, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
check(run(kernel, [], mismatchPayload).status === 0, 'second Tier 2 route persists for replan discriminator');
const mismatchDir = getSessionDir(ROOT, mismatchSession, mismatchPayload);
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

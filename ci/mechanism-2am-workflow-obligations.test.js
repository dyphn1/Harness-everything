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

console.log('=== Issue #85 non-Fable workflow obligations ===');
const sessionId = 'issue85-tier2';
const payload = { session_id: sessionId, cwd: ROOT, prompt: 'Fix this checkout bug and add a regression test.' };
const routed = run(kernel, [], payload);
check(routed.status === 0, 'Tier 2 route persists successfully');

const sessionDir = getSessionDir(ROOT, sessionId, payload);
const workflowFile = path.join(sessionDir, 'workflow-run.json');
const obligationFile = path.join(sessionDir, 'workflow-obligations.json');
let workflow = readJson(workflowFile);
check(workflow.tier === 'tier2' && workflow.strategy === 'iterative-single', 'Tier 2 selects iterative-single');
check(workflow.state === 'pending', 'selected Tier 2 workflow begins pending');
check(!fs.existsSync(obligationFile), 'obligations are not materialized before explicit start');

const beforeStartStop = run(stopGate, [], { session_id: sessionId, cwd: ROOT, hook_event_name: 'Stop' });
workflow = readJson(workflowFile);
check(beforeStartStop.status === 0, 'Stop reminder is fail-open before workflow start');
check(workflow.state === 'pending', 'missing obligation contract cannot silently satisfy Tier 2');
check((workflow.unresolved || []).some(item => item.startsWith('obligations:')), 'missing obligations are recorded as unresolved');

const started = run(controller, ['start', '--session-id', sessionId]);
check(started.status === 0, 'start activates non-Fable Tier 2 workflow');
workflow = readJson(workflowFile);
const obligations = readJson(obligationFile);
check(workflow.state === 'running', 'started Tier 2 workflow is running');
check(obligations.workflowId === workflow.workflowId && obligations.strategy === workflow.strategy, 'obligation contract is correlated to workflow');
check(obligations.obligations.map(item => item.id).join(',') === 'scope,execute,verify', 'stable scope/execute/verify obligations are materialized');
check(obligations.obligations.every(item => item.status === 'pending'), 'new obligations begin pending');

const mutationReminder = run(workflowGate, [], {
  session_id: sessionId, cwd: ROOT, hook_event_name: 'PreToolUse',
  tool_name: 'Write', tool_input: { file_path: path.join(ROOT, 'tmp-issue85.txt'), content: 'x' },
});
check(mutationReminder.status === 0, 'unresolved obligations never block mutation tools');

check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'scope', '--disposition', 'pass', '--evidence', 'repository and task scope inspected']).status === 0,
  'scope obligation records pass evidence');
check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'execute', '--disposition', 'escaped', '--reason-code', 'workflow-uncovered-scope', '--scope', 'optional unrelated cleanup', '--evidence', 'outside requested bug-fix scope']).status === 0,
  'escapable execution obligation accepts bounded evidence-backed escape');
check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'verify', '--disposition', 'escaped', '--reason-code', 'workflow-uncovered-scope', '--scope', 'tests', '--evidence', 'attempt']).status !== 0,
  'verification obligation cannot be escaped');
check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'verify', '--disposition', 'blocked', '--reason-code', 'verification-environment-unavailable', '--evidence', 'fixture intentionally blocks verification']).status === 0,
  'verification obligation can record an explicit blocked disposition');

const blockedStop = run(stopGate, [], { session_id: sessionId, cwd: ROOT, hook_event_name: 'Stop' });
workflow = readJson(workflowFile);
check(blockedStop.status === 0, 'blocked obligation still emits reminder without trapping Stop');
check(workflow.state === 'running', 'blocked obligation keeps workflow unresolved rather than satisfied');
check((workflow.unresolved || []).includes('verify:blocked'), 'blocked obligation is visible in workflow unresolved evidence');

check(run(controller, ['obligation', '--session-id', sessionId, '--obligation-id', 'verify', '--disposition', 'pass', '--evidence', 'npm test and focused regression passed']).status === 0,
  'blocked obligation can later resolve to pass with evidence');
const resolvedStop = run(stopGate, [], { session_id: sessionId, cwd: ROOT, hook_event_name: 'Stop' });
workflow = readJson(workflowFile);
check(resolvedStop.status === 0, 'resolved workflow Stop remains fail-open');
check(workflow.state === 'satisfied', 'all required obligation dispositions allow satisfied');
check((workflow.unresolved || []).length === 0, 'satisfied workflow has no unresolved obligations');

const tier1Session = 'issue85-tier1';
const tier1Payload = { session_id: tier1Session, cwd: ROOT, prompt: 'Update one README typo' };
check(run(kernel, [], tier1Payload).status === 0, 'Tier 1 route persists successfully');
const tier1Dir = getSessionDir(ROOT, tier1Session, tier1Payload);
const tier1WorkflowFile = path.join(tier1Dir, 'workflow-run.json');
check(run(stopGate, [], { session_id: tier1Session, cwd: ROOT, hook_event_name: 'Stop' }).status === 0, 'Tier 1 direct Stop remains lightweight');
const tier1Workflow = readJson(tier1WorkflowFile);
check(tier1Workflow.strategy === 'direct-single', 'Tier 1 keeps direct-single');
check(tier1Workflow.state === 'satisfied', 'Tier 1 direct path can satisfy without an obligation graph');
check(!fs.existsSync(path.join(tier1Dir, 'workflow-obligations.json')), 'Tier 1 direct path has no obligation-file overhead');

const runtimeSource = fs.readFileSync(path.join(ROOT, 'hooks/scripts/lib/workflow-runtime.js'), 'utf8');
check(!runtimeSource.includes('.mutation-probes.lock'), '#190 mutation-probe lock remains retired');
check(!runtimeSource.includes('budget-exhausted'), '#190 hard budget state remains retired');

fs.rmSync(stateHome, { recursive: true, force: true });
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ': issue #85 workflow obligation contract (' + failed + ' failures)');
process.exit(failed === 0 ? 0 : 1);

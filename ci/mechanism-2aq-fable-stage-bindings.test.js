#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fable-stage-bindings-'));
const stateHome = path.join(tempRoot, 'state-home');
const workspace = path.join(tempRoot, 'workspace');
fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
fs.mkdirSync(path.join(workspace, 'tdd'), { recursive: true });
fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'tdd', 'SKILL.md'), '# TDD\n');
fs.writeFileSync(path.join(workspace, 'docs', 'architecture.md'), '# Architecture\n');
process.env.HARNESS_STATE_HOME = stateHome;

const { prepareRun } = require(path.join(ROOT, 'fable-mode', 'scripts', 'workflow-plan-consumer.js'));
const { getSessionDir } = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'harness-state.js'));
const controller = path.join(ROOT, 'hooks', 'scripts', 'workflow-disposition.js');
const contractTest = path.join(ROOT, 'hooks', 'scripts', 'contract-test.js');
const stopGate = path.join(ROOT, 'hooks', 'scripts', 'workflow-stop-gate.js');
const workflowGate = path.join(ROOT, 'hooks', 'scripts', 'workflow-gate.js');
const kernelRouter = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');
const sessionId = 'issue297-fable-bindings';
const workflowId = 'workflow-issue297-fable';
const plan = { workflowPlan: { strategySelection: 'selected', strategy: 'fable-staged', tier: 'tier3' } };
const run = prepareRun({
  routerContract: plan,
  workspaceRoot: workspace,
  runId: 'issue297-stage-bindings',
  sessionId,
  workflowId,
  stages: [{
    stageId: 'implement', goal: 'implement a bounded change', agent: 'fable-worker-sonnet', task: 'use declared guidance and verify',
    dependsOn: [], writeSet: ['src/change.js'], inputs: [], expectedOutputs: ['src/change.js'],
    requiredBindings: [{ id: 'tdd', path: 'tdd/SKILL.md' }],
    optionalBindings: [{ id: 'architecture-reference', path: 'docs/architecture.md' }],
    checkCommand: 'node fixture-check.js', passCondition: 'exit 0',
  }, {
    stageId: 'verify', goal: 'verify the implementation', agent: 'fable-verifier', task: 'independently check the implementation',
    dependsOn: ['implement'], writeSet: [], inputs: ['src/change.js'], expectedOutputs: ['verification evidence'],
    requiredBindings: [{ id: 'verification-loop', path: 'verification-loop/SKILL.md' }],
    checkCommand: 'node verifier-check.js', passCondition: 'exit 0',
  }],
});

const sessionDir = getSessionDir(workspace, sessionId);
fs.writeFileSync(path.join(sessionDir, 'workflow-run.json'), JSON.stringify({
  schemaVersion: 2, sessionId, workflowId, state: 'running', strategy: 'fable-staged', tier: 'tier3', revision: 1,
  workflowPlan: { strategySelection: 'selected', strategy: 'fable-staged', tier: 'tier3', verification: { independent: false } },
  runId: run.runId, escapes: [],
}, null, 2));

function runNode(script, args, payload, cwd = workspace) {
  return spawnSync(process.execPath, [script, ...(args || [])], {
    cwd,
    encoding: 'utf8',
    input: payload ? JSON.stringify(payload) : undefined,
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
  });
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function check(condition, message) {
  if (!condition) throw new Error('FAIL ' + message);
  console.log('  PASS ' + message);
}
function runCheck() {
  return runNode(contractTest, [], {
    tool_name: 'Bash', session_id: sessionId, cwd: workspace, worker_id: 'worker-1',
    tool_input: { command: 'node fixture-check.js' },
    tool_response: { stdout: 'fixture check passed', exitCode: 0 },
  });
}

try {
  console.log('=== #297 Fable active-stage bindings ===');
  const firstCheck = runCheck();
  check(firstCheck.status === 0, 'post-tool check hook remains fail-open');
  const contractFile = path.join(run.runRoot, 'contracts', 'implement.json');
  let contract = readJson(contractFile);
  check(contract.status === 'binding-unresolved' && contract.unresolvedBindings.join(',') === 'tdd,architecture-reference',
    'a successful check does not pass a stage while its declared bindings remain unresolved');
  const firstEvidence = readJson(path.join(run.runRoot, 'evidence', 'implement.json'));
  check(firstEvidence.checkStatus === 'pass' && firstEvidence.status === 'binding-unresolved',
    'check success and unresolved binding status are recorded separately');
  const notification = runNode(kernelRouter, [], {
    hook_event_name: 'UserPromptSubmit', session_id: sessionId, cwd: workspace,
    prompt: '<task-notification><task-id>issue297-stage-reminder</task-id><status>completed</status></task-notification>',
  });
  check(notification.status === 0 && notification.stdout.includes('Active Fable stage: implement'), 'retained Fable notification shows the current stage');
  check(notification.stdout.includes('tdd/SKILL.md') && notification.stdout.includes('docs/architecture.md'), 'retained Fable notification shows only current-stage bindings');
  check(!notification.stdout.includes('verification-loop/SKILL.md') && !notification.stdout.includes('ROUTER WORKFLOW PLAN (JSON)'),
    'retained Fable notification hides future bindings and avoids repeating the full plan');

  const ordinaryTool = runNode(workflowGate, [], {
    tool_name: 'Write', session_id: sessionId, cwd: workspace,
    tool_input: { file_path: path.join(workspace, 'src', 'change.js'), content: 'change' },
  });
  check(ordinaryTool.status === 0, 'unresolved Fable bindings do not hard-block ordinary mutation tools');
  const stop = runNode(stopGate, [], { hook_event_name: 'Stop', session_id: sessionId, cwd: workspace });
  check(stop.status === 0, 'unresolved Fable bindings do not hard-block Stop');
  const workflow = readJson(path.join(sessionDir, 'workflow-run.json'));
  check(workflow.state === 'running' && workflow.unresolved.some(value => value.startsWith('implement:binding-unresolved:')),
    'Stop exposes the binding gap without locking the workflow');

  const loaded = runNode(controller, [
    'stage-binding', '--session-id', sessionId, '--stage-id', 'implement', '--binding-id', 'tdd',
    '--disposition', 'loaded', '--evidence', 'Read tdd/SKILL.md before implementation.',
  ]);
  check(loaded.status === 0 && JSON.parse(loaded.stdout).binding.status === 'loaded', 'active required stage binding can be explicitly resolved');
  contract = readJson(contractFile);
  check(contract.status === 'binding-unresolved', 'resolving one binding does not pass the stage while an optional binding is undecided');

  const notNeeded = runNode(controller, [
    'stage-binding', '--session-id', sessionId, '--stage-id', 'implement', '--binding-id', 'architecture-reference',
    '--disposition', 'not-needed', '--evidence', 'The implementation does not touch documented architecture.',
  ]);
  check(notNeeded.status === 0 && JSON.parse(notNeeded.stdout).binding.status === 'not-needed', 'optional binding can be explicitly declined with evidence');
  const finalCheck = runCheck();
  check(finalCheck.status === 0, 'stage check remains callable after binding resolution');
  check(finalCheck.stdout.includes('verification-loop/SKILL.md'), 'successful stage check discloses the newly dependency-ready verifier binding');
  contract = readJson(contractFile);
  check(contract.status === 'pass' && contract.unresolvedBindings.length === 0, 'stage passes only after check and binding dispositions both resolve');
  const finalEvidence = readJson(path.join(run.runRoot, 'evidence', 'implement.json'));
  check(finalEvidence.status === 'pass' && finalEvidence.exitCode === 0, 'passing stage retains correlated check evidence');
  const implementContract = readJson(contractFile);
  const sameFile = (left, right) => fs.realpathSync(left).toLowerCase() === fs.realpathSync(right).toLowerCase();
  check(implementContract.requiredBindings[0].availability === 'available' &&
    sameFile(implementContract.requiredBindings[0].resolvedPath, path.join(ROOT, 'tdd', 'SKILL.md')),
    'packaged skill binding resolves to the installed Harness skill at run preparation');
  check(implementContract.optionalBindings[0].availability === 'available' &&
    sameFile(implementContract.optionalBindings[0].resolvedPath, path.join(workspace, 'docs', 'architecture.md')),
    'workspace reference binding resolves to the workspace file, not the Harness copy');

  const ghostSession = 'pr303-fable-missing-binding';
  const ghostRun = prepareRun({
    routerContract: plan, workspaceRoot: workspace, runId: 'pr303-missing-stage-binding', sessionId: ghostSession, workflowId,
    stages: [{
      stageId: 'ghost', goal: 'use a missing reference', agent: 'fable-worker-sonnet', task: 'load a reference that does not exist',
      dependsOn: [], writeSet: ['src/ghost.js'], inputs: [], expectedOutputs: ['src/ghost.js'],
      requiredBindings: [{ id: 'ghost-reference', path: 'docs/pr303-ghost.md' }],
      checkCommand: 'node ghost-check.js', passCondition: 'exit 0',
    }],
  });
  const ghostContractFile = path.join(ghostRun.runRoot, 'contracts', 'ghost.json');
  check(readJson(ghostContractFile).requiredBindings[0].availability === 'missing',
    'a declared stage path with no file is recorded as missing, not available');
  fs.writeFileSync(path.join(getSessionDir(workspace, ghostSession), 'workflow-run.json'), JSON.stringify({
    schemaVersion: 2, sessionId: ghostSession, workflowId, state: 'running', strategy: 'fable-staged', tier: 'tier3', revision: 1,
    workflowPlan: { strategySelection: 'selected', strategy: 'fable-staged', tier: 'tier3', verification: { independent: false } },
    runId: ghostRun.runId, escapes: [],
  }, null, 2));
  const ghostLoad = runNode(controller, [
    'stage-binding', '--session-id', ghostSession, '--stage-id', 'ghost', '--binding-id', 'ghost-reference',
    '--disposition', 'loaded', '--evidence', 'claimed to read the ghost reference',
  ]);
  const ghostBinding = readJson(ghostContractFile).requiredBindings[0];
  check(ghostLoad.status === 0 && ghostBinding.status === 'unavailable' && ghostBinding.reasonCode === 'binding-path-missing',
    'a missing stage binding cannot be recorded as loaded');
  console.log('PASS: #297 Fable stage binding gate mechanics');
} finally {
  if (!tempRoot.startsWith(path.join(os.tmpdir(), 'harness-fable-stage-bindings-'))) throw new Error('unsafe fixture cleanup');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

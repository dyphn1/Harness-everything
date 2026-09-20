#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase3-'));
const stateHome = path.join(tempRoot, 'state-home');
const workspace = path.join(tempRoot, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
process.env.HARNESS_STATE_HOME = stateHome;

const { buildRouterContract } = require(path.join(ROOT, 'harness-everything', 'scripts', 'router-contract.js'));
const {
  derivePlanId,
  getWorkspaceStateRoot,
  prepareRun,
  validateStageGraph,
} = require(path.join(ROOT, 'fable-mode', 'scripts', 'workflow-plan-consumer.js'));
const { consumeWorkspacePlan } = require(path.join(ROOT, 'multi-agent-workspace', 'scripts', 'consume-workflow-plan.js'));
const { pathWithinScope } = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'fable-contracts.js'));

let failed = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function expectThrow(fn, pattern, message) {
  try {
    fn();
    check(false, message);
  } catch (err) {
    check(pattern.test(err.message), `${message} (${err.message})`);
  }
}

function contractFor(signals) {
  return buildRouterContract({
    routingStatus: 'ok',
    recommendedTier: 'Tier 3 (Macro Task)',
    rationale: 'phase 3 test fixture',
    reasonCodes: ['phase3-test'],
    signals: { macroScope: true, ...signals },
  });
}

const parallelContract = contractFor({ independentWorkstreams: true, readOnly: true });
const stagedContract = contractFor({ dependentStages: true });
const workspaceContract = contractFor({ multiSession: true, reusableSpecialists: true, crossDomain: true });

console.log('=== #85 Phase 3 Workflow Plan Consumers ===');
check(parallelContract.workflowPlan.strategy === 'fable-parallel', 'fixture selects fable-parallel');
check(stagedContract.workflowPlan.strategy === 'fable-staged', 'fixture selects fable-staged');
check(workspaceContract.workflowPlan.strategy === 'fable-multi-agent-workspace', 'fixture selects fable-multi-agent-workspace');

const planIdA = derivePlanId(parallelContract);
const planIdB = derivePlanId(JSON.parse(JSON.stringify(parallelContract)));
check(planIdA === planIdB && /^plan-[0-9a-f]{16}$/.test(planIdA), 'planId is deterministic and content-addressed');

const parallelStages = [
  {
    stageId: 'security', goal: 'read security state', agent: 'fable-worker-sonnet', task: 'audit security',
    inputs: [], expectedOutputs: ['security notes'], outputPath: null, dependsOn: [], writeSet: [],
    checkCommand: 'node --test security.test.js', passCondition: 'exit 0',
  },
  {
    stageId: 'architecture', goal: 'read architecture state', agent: 'fable-worker-sonnet', task: 'audit architecture',
    inputs: [], expectedOutputs: ['architecture notes'], outputPath: null, dependsOn: [], writeSet: [],
    checkCommand: 'node --test architecture.test.js', passCondition: 'exit 0',
  },
  {
    stageId: 'synthesis', goal: 'synthesize results', agent: 'fable-worker-sonnet', task: 'write synthesis',
    inputs: [], expectedOutputs: ['summary'], outputPath: 'reports/summary.md', dependsOn: ['security', 'architecture'],
    writeSet: ['reports/summary.md'], checkCommand: 'node --test synthesis.test.js', passCondition: 'exit 0',
  },
];

const runA = prepareRun({
  routerContract: parallelContract,
  stages: parallelStages,
  workspaceRoot: workspace,
  runId: 'phase3-run-a',
  sessionId: 'phase3-session',
});
check(JSON.stringify(runA.execution.batches) === JSON.stringify([['architecture', 'security'], ['synthesis']]), 'parallel plan emits dependency-safe ready batches');
check(runA.execution.limits.maxWorkers === 4, 'run manifest retains maxWorkers as an advisory planning hint');
check(fs.existsSync(path.join(runA.runRoot, 'contracts', 'security.json')), 'run-scoped stage contract is written');
check(fs.existsSync(path.join(runA.runRoot, 'contracts', 'synthesis.json')), 'downstream stage has its own contract');

const runB = prepareRun({
  routerContract: parallelContract,
  stages: parallelStages,
  workspaceRoot: workspace,
  runId: 'phase3-run-b',
  sessionId: 'other-session',
});
check(runA.planId === runB.planId, 'same router plan shares deterministic planId across executions');

check(runA.runRoot !== runB.runRoot, 'same stageIds in concurrent runs never share mutable contract paths');

const wideParallelStages = Array.from({ length: 6 }, (_, index) => ({
  stageId: `wide-${index + 1}`, goal: 'wide audit', agent: 'fable-worker-sonnet', task: 'audit',
  inputs: [], expectedOutputs: [], outputPath: null, dependsOn: [], writeSet: [],
  checkCommand: `node --test wide-${index + 1}.test.js`, passCondition: 'exit 0',
}));
const wideRun = prepareRun({
  routerContract: parallelContract,
  stages: wideParallelStages,
  workspaceRoot: workspace,
  runId: 'phase3-wide-parallel',
  sessionId: 'wide-session',
});
check(wideRun.execution.batches.length === 1, 'ready set is not hard-chunked by the advisory maxWorkers hint');
check(wideRun.execution.batches[0].length === 6, 'all dependency-ready stages remain dispatchable');
check(wideRun.execution.batches.flat().length === 6, 'advisory worker guidance preserves every ready stage');

const stagedRun = prepareRun({
  routerContract: stagedContract,
  stages: [
    { stageId: 'one', goal: 'one', agent: 'fable-worker-sonnet', task: 'one', dependsOn: [], writeSet: ['src/one'], inputs: [], expectedOutputs: [] },
    { stageId: 'two', goal: 'two', agent: 'fable-worker-sonnet', task: 'two', dependsOn: [], writeSet: ['src/two'], inputs: [], expectedOutputs: [] },
  ],
  workspaceRoot: workspace,
  runId: 'phase3-staged',
});
check(JSON.stringify(stagedRun.execution.batches) === JSON.stringify([['one'], ['two']]), 'fable-staged serializes otherwise independent stages');

expectThrow(() => validateStageGraph([
  { stageId: 'broken', goal: 'x', agent: 'a', task: 'x', dependsOn: ['missing'], writeSet: [], inputs: [], expectedOutputs: [] },
]), /unresolved dependency/, 'unknown dependency is rejected');

expectThrow(() => validateStageGraph([
  { stageId: 'a', goal: 'a', agent: 'a', task: 'a', dependsOn: ['b'], writeSet: [], inputs: [], expectedOutputs: [] },
  { stageId: 'b', goal: 'b', agent: 'a', task: 'b', dependsOn: ['a'], writeSet: [], inputs: [], expectedOutputs: [] },
]), /cyclic/, 'dependency cycle is rejected');

expectThrow(() => prepareRun({
  routerContract: parallelContract,
  workspaceRoot: workspace,
  runId: 'phase3-overlap',
  stages: [
    { stageId: 'a', goal: 'a', agent: 'a', task: 'a', dependsOn: [], writeSet: ['src/auth'], inputs: [], expectedOutputs: [] },
    { stageId: 'b', goal: 'b', agent: 'a', task: 'b', dependsOn: [], writeSet: ['src/auth/token.js'], inputs: [], expectedOutputs: [] },
  ],
}), /write-set overlap/, 'parallel write-set overlap rejects dispatch');

check(pathWithinScope(' M src/auth/token.js', 'src/auth'), 'scope matcher accepts descendants of a declared path');
check(!pathWithinScope(' M src/author.js', 'src/auth'), 'scope matcher uses path boundaries, not string prefixes');

// Workspace consumer: preserve existing role/memory ownership and add only correlation.
const aiDir = path.join(workspace, '.ai');
fs.mkdirSync(aiDir, { recursive: true });
const originalHandoff = {
  schemaVersion: 1,
  state: 'ready',
  workspaceKey: 'fixture',
  repoRoot: workspace,
  selectedAgents: [{ id: 'security-reviewer', provider: 'agency-agents', source: 'catalog/security.md' }],
  memoryIndex: '.ai/memory/index.json',
  generatedAt: 'fixture',
};
fs.writeFileSync(path.join(aiDir, 'handoff.json'), JSON.stringify(originalHandoff, null, 2));
const correlatedHandoff = consumeWorkspacePlan({
  routerContract: workspaceContract,
  workspaceRoot: workspace,
  runId: 'phase3-workspace',
});
check(JSON.stringify(correlatedHandoff.selectedAgents) === JSON.stringify(originalHandoff.selectedAgents), 'workspace consumer preserves selected roles/provenance');
check(correlatedHandoff.memoryIndex === originalHandoff.memoryIndex, 'workspace consumer preserves existing memory index');
check(correlatedHandoff.workflowCorrelation.planId === derivePlanId(workspaceContract), 'workspace handoff is correlated to router planId');
check(correlatedHandoff.workflowCorrelation.runId === 'phase3-workspace', 'workspace handoff records shared runId');
check(correlatedHandoff.workflowCorrelation.rolePolicy === 'existing-workspace-selection', 'router does not take ownership of role selection');

// Exact stage-check correlation and evidence.
const checkRun = prepareRun({
  routerContract: stagedContract,
  workspaceRoot: workspace,
  runId: 'phase3-check',
  sessionId: 'check-session',
  stages: [{
    stageId: 'verify', goal: 'verify', agent: 'fable-verifier', task: 'verify output', dependsOn: [], writeSet: [],
    inputs: [], expectedOutputs: ['evidence'], checkCommand: 'node --test phase3.test.js', passCondition: 'exit 0',
  }],
});
const contractHook = path.join(ROOT, 'hooks', 'scripts', 'contract-test.js');
const checkPayload = {
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  session_id: 'check-session',
  cwd: workspace,
  tool_input: { command: 'node --test phase3.test.js' },
  tool_response: { exitCode: 0, stdout: 'PASS phase3' },
};
const checkResult = spawnSync(process.execPath, [contractHook], {
  cwd: workspace,
  input: JSON.stringify(checkPayload),
  encoding: 'utf8',
  env: { ...process.env, HARNESS_STATE_HOME: stateHome },
});
check(checkResult.status === 0, `exact correlated stage check passes (${checkResult.stderr.trim() || 'no stderr'})`);
const resolvedContract = JSON.parse(fs.readFileSync(path.join(checkRun.runRoot, 'contracts', 'verify.json'), 'utf8'));
check(resolvedContract.status === 'pass', 'contract-test resolves exactly one run-scoped stage contract');
check(resolvedContract.verificationEvidence === 'evidence/verify.json', 'stage contract links run-scoped verification evidence');
const evidence = JSON.parse(fs.readFileSync(path.join(checkRun.runRoot, 'evidence', 'verify.json'), 'utf8'));
check(evidence.planId === checkRun.planId && evidence.runId === checkRun.runId && evidence.stageId === 'verify', 'verification evidence correlates plan/run/stage');

// Same command in two active contracts must not mutate either without enough correlation.
for (const runId of ['ambiguous-a', 'ambiguous-b']) {
  prepareRun({
    routerContract: stagedContract,
    workspaceRoot: workspace,
    runId,
    sessionId: 'ambiguous-session',
    stages: [{
      stageId: 'same-check', goal: 'verify', agent: 'fable-verifier', task: 'verify', dependsOn: [], writeSet: [],
      inputs: [], expectedOutputs: [], checkCommand: 'npm test', passCondition: 'exit 0',
    }],
  });
}
const ambiguousResult = spawnSync(process.execPath, [contractHook], {
  cwd: workspace,
  input: JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'ambiguous-session', cwd: workspace,
    tool_input: { command: 'npm test' }, tool_response: { exitCode: 0, stdout: 'ok' },
  }),
  encoding: 'utf8',
  env: { ...process.env, HARNESS_STATE_HOME: stateHome },
});
check(ambiguousResult.status === 2, 'ambiguous same-command correlation blocks acceptance');
for (const runId of ['ambiguous-a', 'ambiguous-b']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(getWorkspaceStateRoot(workspace), 'fable-runs', runId, 'contracts', 'same-check.json'), 'utf8'));
  check(manifest.status === 'planned', `${runId} remains unmodified after ambiguous check`);
}

// Full subagent-scope hook: declared path passes; undeclared path fails.
const gitWorkspace = path.join(tempRoot, 'git-workspace');
fs.mkdirSync(path.join(gitWorkspace, 'src', 'auth'), { recursive: true });
fs.mkdirSync(path.join(gitWorkspace, 'docs'), { recursive: true });
fs.writeFileSync(path.join(gitWorkspace, 'src', 'auth', 'token.txt'), 'base\n');
fs.writeFileSync(path.join(gitWorkspace, 'docs', 'base.txt'), 'base\n');
for (const args of [
  ['init'],
  ['config', 'user.email', 'phase3@example.invalid'],
  ['config', 'user.name', 'Phase3 Test'],
  ['add', '.'],
  ['commit', '-m', 'baseline'],
]) {
  const result = spawnSync('git', args, { cwd: gitWorkspace, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
}
prepareRun({
  routerContract: stagedContract,
  workspaceRoot: gitWorkspace,
  runId: 'scope-run',
  sessionId: 'scope-session',
  stages: [{ stageId: 'edit-auth', goal: 'edit auth', agent: 'worker', task: 'edit auth', dependsOn: [], writeSet: ['src/auth'], inputs: [], expectedOutputs: [] }],
});
const scopeHook = path.join(ROOT, 'hooks', 'scripts', 'subagent-scope-guard.js');
function runScope(event) {
  return spawnSync(process.execPath, [scopeHook], {
    cwd: gitWorkspace,
    input: JSON.stringify({ hook_event_name: event, tool_name: 'Task', session_id: 'scope-session', cwd: gitWorkspace }),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
  });
}
check(runScope('PreToolUse').status === 0, 'scope guard captures machine-readable write-set snapshot');
fs.writeFileSync(path.join(gitWorkspace, 'src', 'auth', 'token.txt'), 'changed\n');
const inScope = runScope('PostToolUse');
check(inScope.status === 0 && /in-scope/.test(inScope.stdout), 'declared in-scope worker edit is attributed and accepted');
check(runScope('PreToolUse').status === 0, 'next burst starts from rolled-forward baseline');
fs.writeFileSync(path.join(gitWorkspace, 'docs', 'oops.txt'), 'unexpected\n');
const outOfScope = runScope('PostToolUse');
check(outOfScope.status === 2 && /OUT-OF-SCOPE/.test(outOfScope.stderr), 'undeclared worker edit is rejected by scope guard');

const contractDoc = fs.readFileSync(path.join(ROOT, 'fable-mode', 'CONTRACT-FORMAT.md'), 'utf8');
const orchestratorDoc = fs.readFileSync(path.join(ROOT, 'fable-mode', 'agents', 'fable-orchestrator.md'), 'utf8');
const workspaceDoc = fs.readFileSync(path.join(ROOT, 'multi-agent-workspace', 'references', 'orchestration.md'), 'utf8');
check(contractDoc.includes('dependsOn') && contractDoc.includes('writeSet'), 'Fable contract documentation requires dependency/write-set declarations');
check(orchestratorDoc.includes('workflow-plan-consumer.js') && orchestratorDoc.includes('planId'), 'Fable orchestrator consumes structured plan and correlation ids');
check(workspaceDoc.includes('does not decide whether a task deserves multiple agents'), 'workspace no longer independently chooses topology from task size');

try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: #85 Phase 3 workflow-plan consumers (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

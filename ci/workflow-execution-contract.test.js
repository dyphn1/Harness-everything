#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { recordBudgetEvent, resetWorkflowBudget } = require(path.join(ROOT, 'hooks/scripts/lib/workflow-runtime.js'));
let failed = 0;

function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...options });
}

console.log('=== Workflow Execution Enforcement ===');

for (const rel of [
  'harness-everything/scripts/kernel-router.js',
  'harness-everything/scripts/kernel-router-core.js',
  'hooks/scripts/workflow-gate.js',
  'hooks/scripts/workflow-stop-gate.js',
  'hooks/scripts/workflow-disposition.js',
]) {
  const result = runNode(['--check', path.join(ROOT, rel)]);
  check(result.status === 0, `${rel} parses as valid JavaScript`);
}

const routed = runNode([
  path.join(ROOT, 'harness-everything/scripts/kernel-router.js'),
  'audit the entire repository architecture and coordinate multiple modules',
]);
check(routed.status === 0, 'enforced kernel route exits successfully');
check(routed.stdout.includes('"strategy":"fable-staged"'), 'macro prompt selects fable-staged');
check(routed.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED)'), 'wrapper emits mandatory execution contract');
check(routed.stdout.includes('Execute the selected workflow to resolution'), 'wrapper requires workflow resolution');
check(routed.stdout.includes('workflow-uncovered-scope'), 'wrapper exposes only explicit evidence-backed escape path');
check(!routed.stdout.includes('execution remains advisory after evaluation'), 'wrapper removes advisory-execution runtime wording');

const disposition = fs.readFileSync(path.join(ROOT, 'hooks/scripts/workflow-disposition.js'), 'utf8');
check(disposition.includes("'workflow-uncovered-scope'"), 'escape supports workflow-uncovered-scope');
check(disposition.includes("'host-capability-unavailable'"), 'escape supports host-capability-unavailable');
check(disposition.includes('generic simple/routine/already-clear reasons are intentionally rejected'), 'generic confidence-based escape reasons are rejected');
check(disposition.includes('--scope is required') && disposition.includes('--evidence is required') && disposition.includes('--stage-id must name'), 'escape requires a declared stage, scope and evidence');

const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
check((hooks.hooks.PreToolUse || []).some(entry => entry.id === 'harness:pre:workflow-gate'), 'Claude hook wiring includes pre-mutation workflow gate');
check((hooks.hooks.Stop || []).some(entry => entry.id === 'harness:stop:workflow-completion-gate'), 'Claude hook wiring includes workflow completion gate');


const budgetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-budget-'));
function budgetContext(name, strategy = 'iterative-single', limits = {}) {
  const file = path.join(budgetRoot, name, 'workflow-run.json');
  return {
    root: path.join(budgetRoot, name),
    sessionId: name,
    sessionDir: path.join(budgetRoot, name),
    file,
    workflow: {
      schemaVersion: 2,
      sessionId: name,
      workflowId: `wf-${name}`,
      state: 'running',
      strategy,
      revision: 0,
      workflowPlan: {
        strategy,
        limits: { maxIterations: 8, maxRevisionRounds: 2, maxReplans: 2, maxWorkers: 4, ...limits },
      },
    },
  };
}
function expectBudgetBlock(fn, reason, message) {
  try {
    fn();
    check(false, message);
  } catch (error) {
    check(error.code === 'HARNESS_WORKFLOW_BUDGET' && error.message.includes(reason), `${message} (${error.message})`);
  }
}

const iterationCtx = budgetContext('iteration');
for (let i = 0; i < 8; i++) recordBudgetEvent(iterationCtx, 'iteration', { evidence: `mutation-${i + 1}` });
check(iterationCtx.workflow.budget.counters.iterations === 8, 'iteration budget allows exactly maxIterations events');
expectBudgetBlock(() => recordBudgetEvent(iterationCtx, 'iteration', { evidence: 'mutation-9' }), 'iteration-budget-exhausted', 'ninth iterative event is blocked');
check(iterationCtx.workflow.state === 'blocked' && iterationCtx.workflow.budget.state === 'budget-exhausted', 'iteration exhaustion is persisted as blocked evidence');
const persistedIteration = JSON.parse(fs.readFileSync(iterationCtx.file, 'utf8'));
check(persistedIteration.blockReason === 'iteration-budget-exhausted', 'budget exhaustion survives on-disk workflow state');

const isolatedCtx = budgetContext('isolated');
recordBudgetEvent(isolatedCtx, 'iteration', { evidence: 'independent-run' });
check(isolatedCtx.workflow.budget.counters.iterations === 1, 'another run/session has independent accounting');
check(iterationCtx.workflow.budget.counters.iterations === 8, 'independent accounting does not reset exhausted run');

resetWorkflowBudget(iterationCtx, 'new explicitly authorized attempt');
check(iterationCtx.workflow.state === 'pending' && iterationCtx.workflow.budget.epoch === 1, 'budget reset is explicit, auditable, and starts a new epoch');
check(iterationCtx.workflow.budget.counters.iterations === 0 && iterationCtx.workflow.budget.resets.length === 1, 'reset clears only the target run counters and retains history');

const revisionCtx = budgetContext('revision', 'fable-staged');
recordBudgetEvent(revisionCtx, 'revision', { evidence: 'verifier-fail-1' });
recordBudgetEvent(revisionCtx, 'revision', { evidence: 'verifier-fail-2' });
expectBudgetBlock(() => recordBudgetEvent(revisionCtx, 'revision', { evidence: 'verifier-fail-3' }), 'revision-budget-exhausted', 'third revision round is blocked');

const replanCtx = budgetContext('replan', 'fable-staged');
recordBudgetEvent(replanCtx, 'replan', { evidence: 'replan-1' });
recordBudgetEvent(replanCtx, 'replan', { evidence: 'replan-2' });
expectBudgetBlock(() => recordBudgetEvent(replanCtx, 'replan', { evidence: 'replan-3' }), 'replan-budget-exhausted', 'third full replan is blocked');

const workerCtx = budgetContext('workers', 'fable-parallel');
for (const id of ['w1', 'w2', 'w3', 'w4']) recordBudgetEvent(workerCtx, 'worker-acquire', { workerId: id });
check(Object.keys(workerCtx.workflow.budget.activeWorkers).length === 4, 'worker accounting reaches but does not exceed maxWorkers');
recordBudgetEvent(workerCtx, 'worker-release', { workerId: 'w1' });
recordBudgetEvent(workerCtx, 'worker-acquire', { workerId: 'w5' });
check(Object.keys(workerCtx.workflow.budget.activeWorkers).length === 4 && workerCtx.workflow.budget.activeWorkers.w5, 'released worker capacity is reusable');

const overflowCtx = budgetContext('worker-overflow', 'fable-parallel');
for (const id of ['w1', 'w2', 'w3', 'w4']) recordBudgetEvent(overflowCtx, 'worker-acquire', { workerId: id });
expectBudgetBlock(() => recordBudgetEvent(overflowCtx, 'worker-acquire', { workerId: 'w5' }), 'worker-budget-exhausted', 'fifth concurrent worker is blocked');

try { fs.rmSync(budgetRoot, { recursive: true, force: true }); } catch (_) {}

const pluginHooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/harness-everything/hooks/hooks.json'), 'utf8'));
check((pluginHooks.hooks.PreToolUse || []).some(entry => (entry.hooks || []).some(hook => /workflow-gate\.js/.test(hook.command || ''))), 'OpenAI plugin hook package carries workflow gate adapter');
check((pluginHooks.hooks.Stop || []).some(entry => (entry.hooks || []).some(hook => /workflow-stop-gate\.js/.test(hook.command || ''))), 'OpenAI plugin hook package carries workflow completion adapter');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: workflow execution enforcement (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

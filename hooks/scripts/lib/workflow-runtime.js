'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, getSessionId, getStateRoot } = require('./harness-state');
const { atomicWriteJson, readJson } = require('./fable-contracts');

const OPEN_STATES = new Set(['pending', 'active', 'running', 'failed', 'blocked', 'escaped']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WORKFLOW_CONTROLLER_COMMANDS = new Set(['start', 'revision', 'escape', 'block']);

function activeWorkflowPlan(workflow) {
  if (!workflow) return null;
  const plan = workflow.workflowPlan;
  if (plan && typeof plan === 'object' && plan.strategy === workflow.strategy) return plan;
  return workflow;
}

function isMajorWorkflow(workflow) {
  const active = activeWorkflowPlan(workflow);
  return Boolean(active && (active.mutationIsolation?.required || active.tier === 'tier3' || String(active.strategy || '').startsWith('fable-')));
}

function loadWorkflow(payload) {
  const root = getWorkspaceRoot(payload);
  const sessionId = getSessionId(payload);
  const sessionDir = getSessionDir(root, sessionId, payload);
  const file = path.join(sessionDir, 'workflow-run.json');
  if (!fs.existsSync(file)) return { root, sessionId, sessionDir, file, workflow: null };
  const workflow = readJson(file);
  if (!workflow || !['deferred', 'satisfied', ...OPEN_STATES].includes(workflow.state)) {
    throw new Error('recorded workflow is unreadable or invalid; repair its state before mutation/completion');
  }
  const strategies = ['direct-single', 'iterative-single', 'fable-staged', 'fable-parallel', 'fable-multi-agent-workspace'];
  if (![1, 2].includes(workflow.schemaVersion) || workflow.sessionId !== sessionId ||
      (workflow.state !== 'deferred' && !strategies.includes(workflow.strategy)) ||
      (workflow.schemaVersion === 2 && (!workflow.workflowId || !workflow.workflowPlan ||
        workflow.workflowPlan.strategy !== workflow.strategy || !Number.isInteger(workflow.revision) || workflow.revision < 0))) {
    throw new Error('recorded workflow schema or session correlation is invalid');
  }
  return { root, sessionId, sessionDir, file, workflow };
}

function saveWorkflow(context) { atomicWriteJson(context.file, context.workflow); }

// Numeric workflow limits are planning hints only. Exact runtime budget/probe
// enforcement was retired in #190 because it introduced locks, shared-state
// races, parser exceptions, and recovery states disproportionate to its value.
function budgetLimits(workflow) {
  const limits = workflow?.workflowPlan?.limits || {};
  return {
    maxIterations: Number.isInteger(limits.maxIterations) ? limits.maxIterations : null,
    maxRevisionRounds: Number.isInteger(limits.maxRevisionRounds) ? limits.maxRevisionRounds : null,
    maxReplans: Number.isInteger(limits.maxReplans) ? limits.maxReplans : null,
    maxWorkers: Number.isInteger(limits.maxWorkers) ? limits.maxWorkers : null,
  };
}
function ensureWorkflowBudget(workflow) { return { schemaVersion: 2, state: 'advisory', limits: budgetLimits(workflow) }; }
// Compatibility stubs: no files, reservations, counters, locks, or blocks.
function mutationProbeReservations() { return 0; }
function assertIterationCapacity() { return { applicable: false, advisory: true, reserved: 0 }; }
function registerMutationProbe() { return null; }
function peekMutationProbe() { return null; }
function settleMutationProbe() { return null; }
function settleMutationProbeConservative() { return null; }
function discardMutationProbe() { return false; }
function clearMutationProbes() { return false; }
function recordBudgetEvent(context, type, options = {}) {
  return { advisory: true, type, limits: budgetLimits(context && context.workflow), evidence: options.evidence || null };
}
function resetWorkflowBudget(context, evidence) {
  return { retired: true, state: 'advisory', limits: budgetLimits(context && context.workflow), evidence: evidence || null };
}
function syncBudgetToRun() { return false; }

function matchingRun(context) {
  const { workflow, root, sessionId } = context;
  if (!workflow || !SAFE_ID.test(workflow.runId || '') || !workflow.workflowId || !sessionId) return null;
  const runRoot = path.join(getStateRoot(root), 'fable-runs', workflow.runId);
  const run = readJson(path.join(runRoot, 'run.json'));
  if (!run || run.runId !== workflow.runId || run.workflowId !== workflow.workflowId ||
      run.sessionId !== sessionId || run.strategy !== workflow.strategy ||
      !Number.isFinite(Date.parse(run.createdAt)) || !Array.isArray(run.stageIds) || !run.stageIds.length ||
      new Set(run.stageIds).size !== run.stageIds.length || run.stageIds.some(id => !SAFE_ID.test(id))) return null;
  return { runRoot, run };
}

function unresolvedStages(match, workflow, lastEditAt = 0) {
  const unresolved = [];
  const stages = [];
  for (const stageId of match.run.stageIds) {
    const contract = readJson(path.join(match.runRoot, 'contracts', `${stageId}.json`));
    if (!contract || contract.stageId !== stageId || contract.runId !== match.run.runId ||
        contract.planId !== match.run.planId || contract.sessionId !== match.run.sessionId) {
      unresolved.push(`${stageId}:missing-or-uncorrelated`);
      continue;
    }
    stages.push(contract);
    const escape = (workflow.escapes || []).find(item => item.stageId === stageId && item.runId === match.run.runId);
    if (escape && escape.evidence && escape.uncoveredScope &&
        ['workflow-uncovered-scope', 'host-capability-unavailable'].includes(escape.reasonCode)) continue;
    const evidence = readJson(path.join(match.runRoot, 'evidence', `${stageId}.json`));
    if (contract.status !== 'pass' || !contract.checkCommand || !evidence || evidence.status !== 'pass' ||
        evidence.exitCode !== 0 || evidence.planId !== contract.planId || evidence.runId !== contract.runId ||
        evidence.stageId !== stageId || evidence.sessionId !== contract.sessionId ||
        evidence.checkCommand !== contract.checkCommand || !Number.isFinite(Date.parse(evidence.observedAt)) ||
        evidence.workerId !== contract.workerId || !evidence.workerId || evidence.observedAt !== contract.verifiedAt) {
      unresolved.push(`${stageId}:verification-unresolved`);
    }
  }
  if (workflow.verification?.independent) {
    const verifiers = stages.filter(stage => stage.agent === 'fable-verifier' && stage.writeSet?.length === 0);
    const workers = stages.filter(stage => stage.agent !== 'fable-verifier').map(stage => stage.workerId).filter(Boolean);
    const latestCheck = Math.max(0, ...stages.filter(stage => stage.agent !== 'fable-verifier').map(stage => Date.parse(stage.verifiedAt) || 0));
    if (!verifiers.some(stage => stage.workerId && !workers.includes(stage.workerId) && stage.status === 'pass' &&
        Date.parse(stage.verifiedAt) >= Math.max(workflow.lastMutationAt || 0, lastEditAt || 0, latestCheck) &&
        match.run.stageIds.filter(id => id !== stage.stageId).every(id => stage.dependsOn?.includes(id)))) {
      unresolved.push('independent-verifier-missing');
    }
  }
  return unresolved;
}

function readHookInput(decide) {
  let input = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    try { decide(input.trim() ? JSON.parse(input) : null); }
    catch (error) { console.error(`[Workflow Reminder] Ignoring malformed workflow hook input: ${error.message}`); }
  };
  const timeout = setTimeout(finish, 500);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}

module.exports = { OPEN_STATES, SAFE_ID, WORKFLOW_CONTROLLER_COMMANDS, isMajorWorkflow, loadWorkflow, saveWorkflow, budgetLimits, ensureWorkflowBudget, mutationProbeReservations, assertIterationCapacity, registerMutationProbe, peekMutationProbe, settleMutationProbe, settleMutationProbeConservative, discardMutationProbe, clearMutationProbes, recordBudgetEvent, resetWorkflowBudget, syncBudgetToRun, matchingRun, unresolvedStages, readHookInput };

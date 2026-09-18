'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, getSessionId, getStateRoot } = require('./harness-state');
const { atomicWriteJson, readJson } = require('./fable-contracts');

const OPEN_STATES = new Set(['pending', 'active', 'running', 'failed', 'blocked', 'escaped']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WORKFLOW_CONTROLLER_COMMANDS = new Set(['start', 'revision', 'reset-budget', 'escape', 'block']);

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

function mutationProbeReservations(workflow) {
  const pending = workflow?.mutationProbes?.pending;
  if (!pending || typeof pending !== 'object') return 0;
  let count = 0;
  for (const queue of Object.values(pending)) {
    if (!Array.isArray(queue)) continue;
    count += queue.filter(item => item && item.reserveIteration === true).length;
  }
  return count;
}

function assertIterationCapacity(context, evidence) {
  const { workflow } = context;
  if (!workflow) throw budgetError('no workflow available for iteration capacity');
  const budget = ensureWorkflowBudget(workflow);
  if (budget.state !== 'active') throw budgetError(`workflow budget is ${budget.state}: ${budget.reasonCode || 'unavailable'}`);
  const limit = budget.limits.maxIterations;
  if (limit === null) return { applicable: false, value: budget.counters.iterations, reserved: 0 };
  const reserved = mutationProbeReservations(workflow);
  if (budget.counters.iterations + reserved >= limit) {
    return exhaustBudget(context, 'iteration-budget-exhausted', evidence || 'untrusted-shell-capacity');
  }
  return { applicable: true, value: budget.counters.iterations, reserved, limit };
}

function registerMutationProbe(context, key, fingerprint, reserveIteration) {
  if (!/^[a-f0-9]{64}$/.test(String(key || '')) || !/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) {
    throw new Error('invalid mutation probe identity');
  }
  if (reserveIteration) assertIterationCapacity(context, 'shell:untrusted');
  const workflow = context.workflow;
  if (!workflow.mutationProbes || workflow.mutationProbes.schemaVersion !== 1) {
    workflow.mutationProbes = { schemaVersion: 1, pending: {} };
  }
  const pending = workflow.mutationProbes.pending;
  const queue = Array.isArray(pending[key]) ? pending[key] : [];
  if (queue.length >= 8) throw new Error('too many pending mutation probes for one shell command');
  const total = Object.values(pending).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  if (total >= 64) throw new Error('too many pending mutation probes');
  queue.push({ fingerprint, reserveIteration: Boolean(reserveIteration), observedAt: Date.now() });
  pending[key] = queue;
  return queue[queue.length - 1];
}

function takeMutationProbe(context, key) {
  const pending = context.workflow?.mutationProbes?.pending;
  if (!pending || !Array.isArray(pending[key]) || !pending[key].length) return null;
  const probe = pending[key].shift();
  if (!pending[key].length) delete pending[key];
  if (!Object.keys(pending).length) delete context.workflow.mutationProbes;
  return probe;
}

function budgetLimits(workflow) {
  const limits = workflow?.workflowPlan?.limits || {};
  return {
    maxIterations: Number.isInteger(limits.maxIterations) && limits.maxIterations > 0 ? limits.maxIterations : null,
    maxRevisionRounds: Number.isInteger(limits.maxRevisionRounds) && limits.maxRevisionRounds >= 0 ? limits.maxRevisionRounds : 0,
    maxReplans: Number.isInteger(limits.maxReplans) && limits.maxReplans >= 0 ? limits.maxReplans : 0,
    maxWorkers: Number.isInteger(limits.maxWorkers) && limits.maxWorkers > 0 ? limits.maxWorkers : 1,
  };
}

function ensureWorkflowBudget(workflow) {
  if (workflow.budget && workflow.budget.schemaVersion === 1) return workflow.budget;
  const now = new Date().toISOString();
  workflow.budget = {
    schemaVersion: 1,
    epoch: 0,
    state: 'active',
    limits: budgetLimits(workflow),
    counters: { iterations: 0, revisionRounds: 0, replans: 0 },
    activeWorkers: {},
    reasonCode: null,
    exhaustedAt: null,
    resets: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  return workflow.budget;
}

function syncBudgetToRun(context) {
  const match = matchingRun(context);
  if (!match || !context.workflow?.budget) return;
  const updated = {
    ...match.run,
    budget: JSON.parse(JSON.stringify(context.workflow.budget)),
  };
  atomicWriteJson(path.join(match.runRoot, 'run.json'), updated);
}

function persistBudget(context) {
  saveWorkflow(context);
  syncBudgetToRun(context);
}

function budgetError(message) {
  const error = new Error(message);
  error.code = 'HARNESS_WORKFLOW_BUDGET';
  return error;
}

function appendBudgetEvent(budget, event) {
  budget.events = [...(budget.events || []), event].slice(-64);
  budget.updatedAt = event.observedAt;
}

function exhaustBudget(context, reasonCode, evidence) {
  const budget = ensureWorkflowBudget(context.workflow);
  const now = new Date().toISOString();
  budget.state = 'budget-exhausted';
  budget.reasonCode = reasonCode;
  budget.exhaustedAt = now;
  appendBudgetEvent(budget, { type: 'budget-exhausted', reasonCode, evidence: evidence || null, observedAt: now });
  context.workflow.state = 'blocked';
  context.workflow.blockReason = reasonCode;
  persistBudget(context);
  throw budgetError(`budget-exhausted: ${reasonCode}`);
}

function recordBudgetEvent(context, type, options = {}) {
  const { workflow } = context;
  if (!workflow) throw budgetError('no workflow available for budget accounting');
  const budget = ensureWorkflowBudget(workflow);
  if (budget.state !== 'active') throw budgetError(`workflow budget is ${budget.state}: ${budget.reasonCode || 'unavailable'}`);
  const now = new Date().toISOString();
  const evidence = options.evidence || null;

  const consume = (counter, limitName, reasonCode) => {
    const limit = budget.limits[limitName];
    if (limit === null) return { applicable: false, value: budget.counters[counter] };
    const reserved = type === 'iteration' ? mutationProbeReservations(workflow) : 0;
    if (budget.counters[counter] + reserved >= limit) return exhaustBudget(context, reasonCode, evidence);
    budget.counters[counter]++;
    appendBudgetEvent(budget, { type, counter, value: budget.counters[counter], limit, evidence, observedAt: now });
    persistBudget(context);
    return { applicable: true, value: budget.counters[counter], limit };
  };

  if (type === 'iteration') return consume('iterations', 'maxIterations', 'iteration-budget-exhausted');
  if (type === 'revision') return consume('revisionRounds', 'maxRevisionRounds', 'revision-budget-exhausted');
  if (type === 'replan') return consume('replans', 'maxReplans', 'replan-budget-exhausted');

  if (type === 'worker-acquire') {
    const workerId = String(options.workerId || '').trim();
    if (!SAFE_ID.test(workerId)) throw budgetError('worker-acquire requires a stable safe worker id');
    if (budget.activeWorkers[workerId]) return { active: Object.keys(budget.activeWorkers).length, idempotent: true };
    const active = Object.keys(budget.activeWorkers).length;
    if (active >= budget.limits.maxWorkers) return exhaustBudget(context, 'worker-budget-exhausted', evidence || workerId);
    budget.activeWorkers[workerId] = { acquiredAt: now, evidence };
    appendBudgetEvent(budget, { type, workerId, active: active + 1, limit: budget.limits.maxWorkers, evidence, observedAt: now });
    persistBudget(context);
    return { active: active + 1, limit: budget.limits.maxWorkers };
  }

  if (type === 'worker-release') {
    const workerId = String(options.workerId || '').trim();
    if (!SAFE_ID.test(workerId)) throw budgetError('worker-release requires a stable safe worker id');
    const existed = Boolean(budget.activeWorkers[workerId]);
    delete budget.activeWorkers[workerId];
    appendBudgetEvent(budget, { type, workerId, existed, active: Object.keys(budget.activeWorkers).length, evidence, observedAt: now });
    persistBudget(context);
    return { active: Object.keys(budget.activeWorkers).length, existed };
  }

  throw budgetError(`unknown workflow budget event: ${type}`);
}

function resetWorkflowBudget(context, evidence) {
  const { workflow } = context;
  if (!workflow) throw budgetError('no workflow available for budget reset');
  const previous = ensureWorkflowBudget(workflow);
  if (previous.state !== 'budget-exhausted' || workflow.state !== 'blocked') {
    throw budgetError('budget reset is allowed only after explicit budget exhaustion');
  }
  if (!String(evidence || '').trim()) throw budgetError('budget reset requires audit evidence');
  const now = new Date().toISOString();
  const resets = [...(previous.resets || []), {
    epoch: previous.epoch,
    reasonCode: previous.reasonCode,
    counters: previous.counters,
    evidence: String(evidence).trim(),
    resetAt: now,
  }].slice(-16);
  delete workflow.mutationProbes;
  workflow.budget = {
    schemaVersion: 1,
    epoch: previous.epoch + 1,
    state: 'active',
    limits: budgetLimits(workflow),
    counters: { iterations: 0, revisionRounds: 0, replans: 0 },
    activeWorkers: {},
    reasonCode: null,
    exhaustedAt: null,
    resets,
    events: [{ type: 'budget-reset', evidence: String(evidence).trim(), observedAt: now }],
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
  workflow.state = 'pending';
  delete workflow.blockReason;
  persistBudget(context);
  return workflow.budget;
}

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

function unresolvedStages(match, workflow) {
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
        Date.parse(stage.verifiedAt) >= Math.max(workflow.lastMutationAt || 0, latestCheck) &&
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
    catch (error) { console.error(`[Workflow Gate] ${error.message}`); process.exitCode = 2; }
  };
  const timeout = setTimeout(finish, 500);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}

module.exports = { OPEN_STATES, SAFE_ID, WORKFLOW_CONTROLLER_COMMANDS, isMajorWorkflow, loadWorkflow, saveWorkflow, budgetLimits, ensureWorkflowBudget, mutationProbeReservations, assertIterationCapacity, registerMutationProbe, takeMutationProbe, recordBudgetEvent, resetWorkflowBudget, syncBudgetToRun, matchingRun, unresolvedStages, readHookInput };

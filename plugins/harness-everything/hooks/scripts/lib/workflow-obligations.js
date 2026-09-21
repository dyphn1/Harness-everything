'use strict';

const path = require('path');
const { atomicWriteJson, readJson } = require('./fable-contracts');

const OBLIGATION_SCHEMA_VERSION = 1;
const OBLIGATION_FILE = 'workflow-obligations.json';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_ESCAPE_REASONS = new Set(['workflow-uncovered-scope', 'host-capability-unavailable']);

function obligationPath(sessionDir) {
  return path.join(sessionDir, OBLIGATION_FILE);
}

function needsPlanningContract(plan) {
  return Boolean(
    plan &&
    plan.strategySelection === 'selected' &&
    ['tier2', 'tier3'].includes(plan.tier) &&
    plan.strategy
  );
}

function needsGenericExecutionObligations(plan) {
  return needsPlanningContract(plan) && !String(plan.strategy).startsWith('fable-');
}

function suggestedBindings(plan, kind) {
  const skills = Array.isArray(plan?.suggestedSkills) ? plan.suggestedSkills : [];
  if (kind === 'verification') return skills.filter(skill => skill === 'verification-loop');
  if (kind === 'execution') return skills.filter(skill => skill !== 'verification-loop');
  return [];
}

function planningObligations() {
  return [
    {
      id: 'decompose',
      kind: 'planning',
      requirement: 'Decompose the user intent into explicit requirement fragments with acceptance evidence.',
      required: true,
      escapable: false,
      suggestedSkills: [],
    },
    {
      id: 'compose',
      kind: 'planning',
      requirement: 'Evaluate the requirement fragments and confirm the smallest sufficient workflow before execution.',
      required: true,
      escapable: false,
      suggestedSkills: [],
    },
  ];
}

function executionObligations(plan) {
  return [
    {
      id: 'execute',
      kind: 'execution',
      requirement: 'Resolve the planned requirement fragments using adaptive Skill/direct-action bindings.',
      required: true,
      escapable: true,
      suggestedSkills: suggestedBindings(plan, 'execution'),
    },
    {
      id: 'verify',
      kind: 'verification',
      requirement: 'Produce objective verification evidence appropriate to the completed requirements before claiming completion.',
      required: true,
      escapable: false,
      suggestedSkills: suggestedBindings(plan, 'verification'),
    },
  ];
}

function newObligation(item) {
  return {
    ...item,
    status: 'pending',
    evidence: null,
    reasonCode: null,
    scope: null,
    updatedAt: null,
  };
}

function initializePlanningContract(context, plan) {
  if (!needsPlanningContract(plan)) return null;
  const existing = readJson(obligationPath(context.sessionDir));
  if (existing && validateObligationSet(context, existing, plan) === null) return existing;
  const now = new Date().toISOString();
  const set = {
    schemaVersion: OBLIGATION_SCHEMA_VERSION,
    workflowId: context.workflow.workflowId,
    sessionId: context.sessionId,
    tier: plan.tier,
    candidateStrategy: plan.strategy,
    revision: context.workflow.revision,
    phase: 'planning',
    createdAt: now,
    requirements: [],
    workflowSelection: {
      candidateStrategy: plan.strategy,
      confirmedStrategy: null,
      evidence: null,
      confirmedAt: null,
    },
    obligations: planningObligations().map(newObligation),
  };
  atomicWriteJson(obligationPath(context.sessionDir), set);
  context.workflow.obligationContract = {
    schemaVersion: OBLIGATION_SCHEMA_VERSION,
    file: OBLIGATION_FILE,
    revision: set.revision,
  };
  return set;
}

function parseRequirements(requirementsJson) {
  let parsed;
  try { parsed = JSON.parse(String(requirementsJson || '')); }
  catch (_) { throw new Error('--requirements-json must be valid JSON'); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 32) {
    throw new Error('--requirements-json must contain 1..32 requirement fragments');
  }
  const ids = new Set();
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('requirement fragment must be an object');
    const id = String(item.id || '').trim();
    const summary = String(item.summary || '').trim();
    const acceptance = String(item.acceptance || '').trim();
    if (!SAFE_ID.test(id) || ids.has(id)) throw new Error('requirement ids must be unique stable ids');
    if (!summary || !acceptance) throw new Error('each requirement needs summary and acceptance');
    ids.add(id);
    const suggestedSkills = Array.isArray(item.suggestedSkills)
      ? [...new Set(item.suggestedSkills.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
      : [];
    return { id, order: index + 1, summary, acceptance, suggestedSkills };
  });
}

function recordPlanning(context, requirementsJson, selectedPlan, requestedStrategy, evidence) {
  if (!needsPlanningContract(selectedPlan)) throw new Error('selected workflow does not require a planning contract');
  const loaded = loadObligationSet(context, selectedPlan);
  if (!loaded.set) throw new Error('workflow planning contract unavailable or invalid: ' + loaded.error);
  const requirements = parseRequirements(requirementsJson);
  const requested = String(requestedStrategy || '').trim();
  const planningEvidence = String(evidence || '').trim();
  if (!requested) throw new Error('--strategy is required');
  if (!planningEvidence) throw new Error('--evidence is required');

  const now = new Date().toISOString();
  loaded.set.requirements = requirements;
  const decompose = loaded.set.obligations.find(item => item.id === 'decompose');
  if (decompose) {
    decompose.status = 'pass';
    decompose.reasonCode = null;
    decompose.evidence = 'requirements:' + requirements.map(item => item.id).join(',');
    decompose.updatedAt = now;
  }

  const blocked = selectedPlan.fallback?.disposition === 'blocked';
  loaded.set.workflowSelection = {
    candidateStrategy: loaded.set.candidateStrategy,
    requestedStrategy: requested,
    confirmedStrategy: blocked ? null : selectedPlan.strategy,
    evidence: planningEvidence,
    confirmedAt: blocked ? null : now,
    disposition: blocked ? 'blocked' : 'confirmed',
    fallback: selectedPlan.fallback || null,
  };
  const compose = loaded.set.obligations.find(item => item.id === 'compose');
  if (compose) {
    compose.status = blocked ? 'blocked' : 'pass';
    compose.reasonCode = blocked ? 'workflow-selection-blocked' : null;
    compose.evidence = planningEvidence;
    compose.updatedAt = now;
  }

  if (blocked) {
    context.workflow.planningWarning = 'workflow-selection-blocked';
    delete context.workflow.pendingPlan;
  } else {
    loaded.set.phase = 'planned';
    delete context.workflow.planningWarning;
    if (selectedPlan.strategy !== context.workflow.workflowPlan.strategy ||
        JSON.stringify(selectedPlan) !== JSON.stringify(context.workflow.workflowPlan)) {
      context.workflow.pendingPlan = selectedPlan;
    } else {
      delete context.workflow.pendingPlan;
    }
  }

  atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
  return { set: loaded.set, blocked, selectedPlan };
}

function materializeExecutionObligations(context, plan) {
  if (!needsGenericExecutionObligations(plan)) return null;
  const loaded = loadObligationSet(context, plan);
  if (!loaded.set) throw new Error('workflow planning contract unavailable or invalid: ' + loaded.error);
  if (planningUnresolved(context, plan).length) throw new Error('requirements/workflow planning must be resolved before start');
  const existing = new Map(loaded.set.obligations.map(item => [item.id, item]));
  for (const item of executionObligations(plan)) {
    if (!existing.has(item.id)) loaded.set.obligations.push(newObligation(item));
  }
  loaded.set.phase = 'execution';
  loaded.set.activeStrategy = plan.strategy;
  loaded.set.revision = context.workflow.revision;
  atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
  return loaded.set;
}

function validateObligationSet(context, set, plan = context.workflow?.pendingPlan || context.workflow?.workflowPlan) {
  if (!set || set.schemaVersion !== OBLIGATION_SCHEMA_VERSION) return 'schema-invalid';
  if (set.workflowId !== context.workflow?.workflowId || set.sessionId !== context.sessionId) return 'correlation-invalid';
  if (!plan || set.tier !== plan.tier) return 'plan-mismatch';
  if (!Array.isArray(set.requirements) || !Array.isArray(set.obligations) || set.obligations.length === 0) return 'obligations-invalid';
  const ids = new Set();
  for (const obligation of set.obligations) {
    if (!obligation || !SAFE_ID.test(obligation.id || '') || ids.has(obligation.id)) return 'obligation-id-invalid';
    ids.add(obligation.id);
    if (!['pending', 'pass', 'escaped', 'blocked'].includes(obligation.status)) return 'obligation-status-invalid';
  }
  return null;
}

function loadObligationSet(context, plan) {
  const set = readJson(obligationPath(context.sessionDir));
  const error = validateObligationSet(context, set, plan);
  return { set: error ? null : set, error };
}

function planningUnresolved(context, plan = context.workflow?.pendingPlan || context.workflow?.workflowPlan) {
  if (!needsPlanningContract(plan)) return [];
  const loaded = loadObligationSet(context, plan);
  if (!loaded.set) return ['planning:' + (loaded.error || 'missing')];
  const unresolved = [];
  for (const id of ['decompose', 'compose']) {
    const obligation = loaded.set.obligations.find(item => item.id === id);
    if (!obligation) unresolved.push(id + ':missing');
    else if (obligation.status !== 'pass' || !obligation.evidence) unresolved.push(id + ':' + obligation.status);
  }
  if (!loaded.set.requirements.length) unresolved.push('requirements:empty');
  if (loaded.set.workflowSelection?.confirmedStrategy !== plan.strategy ||
      loaded.set.workflowSelection?.disposition !== 'confirmed') {
    unresolved.push('workflow-selection:unconfirmed');
  }
  return [...new Set(unresolved)];
}

function updateObligation(context, obligationId, disposition, options = {}) {
  if (!SAFE_ID.test(obligationId || '')) throw new Error('--obligation-id must be a stable obligation id');
  if (!['pass', 'escaped', 'blocked'].includes(disposition)) throw new Error('--disposition must be pass, escaped, or blocked');
  if (['decompose', 'compose'].includes(obligationId)) throw new Error('planning obligations are resolved through the plan command');
  const plan = context.workflow?.pendingPlan || context.workflow?.workflowPlan;
  const loaded = loadObligationSet(context, plan);
  if (!loaded.set) throw new Error('workflow obligation contract unavailable or invalid: ' + loaded.error);
  const obligation = loaded.set.obligations.find(item => item.id === obligationId);
  if (!obligation) throw new Error('unknown workflow obligation: ' + obligationId);
  const evidence = String(options.evidence || '').trim();
  if (!evidence) throw new Error('--evidence is required for every obligation disposition');
  const reasonCode = String(options.reasonCode || '').trim() || null;
  const scope = String(options.scope || '').trim() || null;
  if (disposition === 'escaped') {
    if (!obligation.escapable) throw new Error('this obligation cannot be escaped');
    if (!ALLOWED_ESCAPE_REASONS.has(reasonCode)) throw new Error('escaped obligations require workflow-uncovered-scope or host-capability-unavailable');
    if (!scope) throw new Error('--scope is required when escaping an obligation');
  }
  if (disposition === 'blocked' && !reasonCode) throw new Error('--reason-code is required when blocking an obligation');
  obligation.status = disposition;
  obligation.evidence = evidence;
  obligation.reasonCode = reasonCode;
  obligation.scope = scope;
  obligation.updatedAt = new Date().toISOString();
  atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
  return obligation;
}

function unresolvedObligations(context) {
  const plan = context.workflow?.pendingPlan || context.workflow?.workflowPlan;
  if (!needsPlanningContract(plan)) return [];
  const unresolved = planningUnresolved(context, plan);
  const loaded = loadObligationSet(context, plan);
  if (!loaded.set) return unresolved;
  if (!['running', 'satisfied', 'blocked', 'failed'].includes(context.workflow.state)) {
    unresolved.push('execution:not-started');
  }
  if (needsGenericExecutionObligations(plan)) {
    for (const obligation of loaded.set.obligations.filter(item => ['execute', 'verify'].includes(item.id))) {
      if (obligation.status === 'pending') unresolved.push(obligation.id + ':pending');
      else if (obligation.status === 'blocked') unresolved.push(obligation.id + ':blocked');
      else if (!obligation.evidence) unresolved.push(obligation.id + ':evidence-missing');
      else if (obligation.status === 'escaped' && (!obligation.escapable || !ALLOWED_ESCAPE_REASONS.has(obligation.reasonCode) || !obligation.scope)) {
        unresolved.push(obligation.id + ':escape-invalid');
      }
    }
  }
  return [...new Set(unresolved)];
}

module.exports = {
  OBLIGATION_FILE,
  ALLOWED_ESCAPE_REASONS,
  obligationPath,
  needsPlanningContract,
  needsGenericExecutionObligations,
  initializePlanningContract,
  recordPlanning,
  materializeExecutionObligations,
  loadObligationSet,
  planningUnresolved,
  updateObligation,
  unresolvedObligations,
};

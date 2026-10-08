'use strict';

const path = require('path');
const { atomicWriteJson, readJson } = require('./fable-contracts');

const OBLIGATION_SCHEMA_VERSION = 1;
const OBLIGATION_FILE = 'workflow-obligations.json';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_ESCAPE_REASONS = new Set(['workflow-uncovered-scope', 'host-capability-unavailable']);
const STEP_TYPES = new Set(['review', 'behavior-change', 'verification', 'commit']);
const REQUIRED_BINDINGS_BY_STEP = {
  review: [],
  'behavior-change': ['tdd'],
  verification: ['verification-loop'],
  commit: ['git-commit'],
};
const BINDING_PATHS = {
  tdd: 'tdd/SKILL.md',
  'verification-loop': 'verification-loop/SKILL.md',
  'git-commit': 'git-commit/SKILL.md',
  'security-review': 'security-review/SKILL.md',
  'review-guidance': 'harness-everything/references/triage-and-tiers.md',
};

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

function executionObligations(plan, stepBindingsEnabled = false) {
  return [
    {
      id: 'execute',
      kind: 'execution',
      requirement: 'Resolve the planned requirement fragments using adaptive Skill/direct-action bindings.',
      required: true,
      escapable: true,
      suggestedSkills: stepBindingsEnabled ? [] : suggestedBindings(plan, 'execution'),
    },
    {
      id: 'verify',
      kind: 'verification',
      requirement: 'Produce objective verification evidence appropriate to the completed requirements before claiming completion.',
      required: true,
      escapable: false,
      suggestedSkills: stepBindingsEnabled ? [] : suggestedBindings(plan, 'verification'),
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
    const rawStepType = item.stepType === undefined ? '' : String(item.stepType).trim();
    if (rawStepType && !STEP_TYPES.has(rawStepType)) throw new Error(`unsupported requirement stepType: ${rawStepType}`);
    const requirement = { id, order: index + 1, summary, acceptance, suggestedSkills };
    if (!rawStepType) return requirement;

    const requiredBindings = normalizeBindingDeclarations([
      ...(REQUIRED_BINDINGS_BY_STEP[rawStepType] || []),
      ...(Array.isArray(item.requiredBindings) ? item.requiredBindings : []),
    ]);
    const requiredIds = new Set(requiredBindings.map(binding => binding.id));
    const optionalBindings = normalizeBindingDeclarations([
      ...(Array.isArray(item.optionalBindings) ? item.optionalBindings : []),
      ...suggestedSkills,
    ]).filter(binding => !requiredIds.has(binding.id));
    if (rawStepType === 'review' && [...requiredBindings, ...optionalBindings].some(binding => binding.id === 'tdd')) {
      throw new Error('review steps cannot bind tdd');
    }
    requirement.stepType = rawStepType;
    requirement.status = 'pending';
    requirement.evidence = null;
    requirement.reasonCode = null;
    requirement.updatedAt = null;
    requirement.requiredBindings = requiredBindings.map(binding => newBinding(binding.id, true, binding.path));
    requirement.optionalBindings = optionalBindings.map(binding => newBinding(binding.id, false, binding.path));
    return requirement;
  });
}

function normalizeBindingPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('binding paths must be non-empty repository-relative strings');
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) ||
      parts.some(part => !part || part === '.' || part === '..') || /[*?\[\]]/.test(normalized)) {
    throw new Error(`binding path must be a concrete repository-relative path: ${value}`);
  }
  return normalized;
}

function normalizeBindingDeclarations(values) {
  const result = [];
  const byId = new Map();
  for (const value of values || []) {
    const bindingId = typeof value === 'string' ? value.trim()
      : value && typeof value === 'object' && typeof value.id === 'string' ? value.id.trim() : '';
    if (!SAFE_ID.test(bindingId)) throw new Error('binding ids must be stable identifier strings');
    const bindingPath = value && typeof value === 'object' && value.path !== undefined && value.path !== null
      ? normalizeBindingPath(value.path)
      : null;
    if (byId.has(bindingId)) {
      const existing = byId.get(bindingId);
      if (existing.path && bindingPath && existing.path !== bindingPath) throw new Error(`binding ${bindingId} declares conflicting paths`);
      if (!existing.path && bindingPath) existing.path = bindingPath;
      continue;
    }
    const declaration = { id: bindingId, path: bindingPath };
    byId.set(bindingId, declaration);
    result.push(declaration);
  }
  return result;
}

function newBinding(id, required, declaredPath = null) {
  if (declaredPath && BINDING_PATHS[id] && declaredPath !== BINDING_PATHS[id]) {
    throw new Error(`binding ${id} must use its registered path ${BINDING_PATHS[id]}`);
  }
  const bindingPath = declaredPath || BINDING_PATHS[id] || null;
  return {
    id,
    required,
    status: 'pending',
    path: bindingPath,
    availability: bindingPath ? 'available' : 'unknown',
    evidence: null,
    reasonCode: null,
    updatedAt: null,
  };
}

function activeStepRecord(set) {
  if (!set?.stepBindingsEnabled) return null;
  return set.requirements.find(item => item.stepType && item.status !== 'pass') || null;
}

function activeStepSnapshot(set) {
  const step = activeStepRecord(set);
  if (!step) return null;
  const visibleBinding = binding => ({
    id: binding.id,
    status: binding.status,
    availability: binding.availability,
    path: binding.path,
  });
  return {
    id: step.id,
    order: step.order,
    stepType: step.stepType,
    summary: step.summary,
    completionCriteria: step.acceptance,
    status: step.status,
    requiredBindings: step.requiredBindings.map(visibleBinding),
    optionalBindings: step.optionalBindings.map(visibleBinding),
  };
}

function recordPlanning(context, requirementsJson, selectedPlan, requestedStrategy, evidence) {
  if (!needsPlanningContract(selectedPlan)) throw new Error('selected workflow does not require a planning contract');
  const loaded = loadObligationSet(context, selectedPlan);
  if (!loaded.set) throw new Error('workflow planning contract unavailable or invalid: ' + loaded.error);
  const requirements = parseRequirements(requirementsJson);
  const hasTypedSteps = requirements.some(item => item.stepType);
  if (hasTypedSteps && requirements.some(item => !item.stepType)) {
    throw new Error('all requirement fragments must declare stepType when step bindings are used');
  }
  const isFable = String(selectedPlan.strategy || '').startsWith('fable-');
  if (!isFable && !hasTypedSteps) {
    throw new Error('selected single-agent workflows require ordered stepType values: review, behavior-change, verification, or commit');
  }
  if (!isFable && !requirements.some(item => item.stepType === 'verification')) {
    throw new Error('step-bound workflows require an explicit verification step');
  }
  const requested = String(requestedStrategy || '').trim();
  const planningEvidence = String(evidence || '').trim();
  if (!requested) throw new Error('--strategy is required');
  if (!planningEvidence) throw new Error('--evidence is required');

  const now = new Date().toISOString();
  loaded.set.requirements = requirements;
  loaded.set.stepBindingsEnabled = hasTypedSteps && !isFable;
  loaded.set.activeStepId = null;
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
  for (const item of executionObligations(plan, loaded.set.stepBindingsEnabled === true)) {
    if (!existing.has(item.id)) loaded.set.obligations.push(newObligation(item));
    else if (loaded.set.stepBindingsEnabled === true) {
      const current = existing.get(item.id);
      current.suggestedSkills = [];
    }
  }
  syncTypedAggregateObligations(loaded.set);
  loaded.set.phase = 'execution';
  loaded.set.activeStrategy = plan.strategy;
  loaded.set.revision = context.workflow.revision;
  loaded.set.activeStepId = activeStepRecord(loaded.set)?.id || null;
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
  if (set.stepBindingsEnabled === true) {
    if (set.requirements.some(item => !item || !STEP_TYPES.has(item.stepType) ||
        !['pending', 'pass', 'blocked'].includes(item.status) || !Array.isArray(item.requiredBindings) ||
        !Array.isArray(item.optionalBindings))) return 'steps-invalid';
    for (const step of set.requirements) {
      for (const binding of [...step.requiredBindings, ...step.optionalBindings]) {
        if (!binding || !SAFE_ID.test(binding.id || '') || !['pending', 'loaded', 'not-needed', 'unavailable'].includes(binding.status)) {
          return 'step-binding-invalid';
        }
        if (binding.path !== null && typeof binding.path === 'string') {
          try { if (normalizeBindingPath(binding.path) !== binding.path) return 'step-binding-path-invalid'; }
          catch (_) { return 'step-binding-path-invalid'; }
        } else if (binding.path !== null) return 'step-binding-path-invalid';
        if (binding.status === 'loaded' && !binding.path) return 'step-binding-unknown-loaded';
      }
      if (step.status === 'pass' && (!step.evidence ||
          step.requiredBindings.some(binding => binding.status !== 'loaded') ||
          step.optionalBindings.some(binding => !['loaded', 'not-needed'].includes(binding.status)))) {
        return 'step-resolution-invalid';
      }
    }
    if (set.phase === 'execution' && set.activeStepId !== (activeStepRecord(set)?.id || null)) return 'active-step-invalid';
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

function updateBinding(context, stepId, bindingId, disposition, options = {}) {
  if (!SAFE_ID.test(stepId || '') || !SAFE_ID.test(bindingId || '')) throw new Error('step and binding ids must be stable identifiers');
  if (!['loaded', 'not-needed', 'unavailable'].includes(disposition)) {
    throw new Error('--disposition must be loaded, not-needed, or unavailable');
  }
  const plan = context.workflow?.pendingPlan || context.workflow?.workflowPlan;
  const loaded = loadObligationSet(context, plan);
  if (!loaded.set) throw new Error('workflow obligation contract unavailable or invalid: ' + loaded.error);
  if (!loaded.set.stepBindingsEnabled) throw new Error('workflow has no active-step binding contract');
  const step = activeStepRecord(loaded.set);
  if (!step || step.id !== stepId) throw new Error('bindings may only be resolved for the active step');
  const binding = [...step.requiredBindings, ...step.optionalBindings].find(item => item.id === bindingId);
  if (!binding) throw new Error('binding is not declared on the active step');
  const evidence = String(options.evidence || '').trim();
  if (!evidence) throw new Error('--evidence is required for every binding disposition');
  if (binding.required && disposition === 'not-needed') throw new Error('required bindings cannot be marked not-needed');
  if (!binding.required && disposition === 'unavailable') throw new Error('optional bindings require loaded or not-needed disposition');
  if (disposition === 'loaded' && !binding.path) {
    if (binding.required) {
      binding.status = 'unavailable';
      binding.availability = 'unknown';
      binding.evidence = evidence;
      binding.reasonCode = 'binding-path-unknown';
      binding.updatedAt = new Date().toISOString();
      atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
    }
    throw new Error(`${binding.required ? 'required' : 'optional'} binding ${binding.id} has no registered load path`);
  }
  binding.status = disposition;
  binding.evidence = evidence;
  binding.reasonCode = disposition === 'unavailable' ? String(options.reasonCode || 'binding-unavailable') : null;
  binding.updatedAt = new Date().toISOString();
  atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
  return { binding, activeStep: activeStepSnapshot(loaded.set) };
}

function syncTypedAggregateObligations(set) {
  if (set.stepBindingsEnabled !== true) return;
  const steps = set.requirements.filter(item => item?.stepType);
  const groups = [
    {
      id: 'execute',
      steps: steps.filter(step => step.stepType !== 'verification'),
      evidencePrefix: 'typed-execution-steps',
    },
    {
      id: 'verify',
      steps: steps.filter(step => step.stepType === 'verification'),
      evidencePrefix: 'typed-verification-steps',
    },
  ];
  const now = new Date().toISOString();
  for (const group of groups) {
    const noExecutionStep = group.id === 'execute' && group.steps.length === 0;
    if (!noExecutionStep && (!group.steps.length || !group.steps.every(step => step.status === 'pass' && step.evidence))) continue;
    const obligation = set.obligations.find(item => item.id === group.id);
    if (!obligation) continue;
    obligation.status = 'pass';
    obligation.evidence = noExecutionStep
      ? 'typed-execution-steps:none (verification-only workflow)'
      : `${group.evidencePrefix}:${group.steps.map(step => step.id).join(',')}`;
    obligation.reasonCode = null;
    obligation.scope = null;
    obligation.updatedAt = now;
  }
}

function updateStep(context, stepId, disposition, options = {}) {
  if (!SAFE_ID.test(stepId || '')) throw new Error('--step-id must be a stable requirement id');
  if (!['pass', 'blocked'].includes(disposition)) throw new Error('--disposition must be pass or blocked');
  const plan = context.workflow?.pendingPlan || context.workflow?.workflowPlan;
  const loaded = loadObligationSet(context, plan);
  if (!loaded.set) throw new Error('workflow obligation contract unavailable or invalid: ' + loaded.error);
  if (!loaded.set.stepBindingsEnabled) throw new Error('workflow has no active-step contract');
  const step = activeStepRecord(loaded.set);
  if (!step || step.id !== stepId) throw new Error('only the active step may receive a disposition');
  const evidence = String(options.evidence || '').trim();
  if (!evidence) throw new Error('--evidence is required for every step disposition');
  const reasonCode = String(options.reasonCode || '').trim() || null;
  if (disposition === 'blocked' && !reasonCode) throw new Error('--reason-code is required when blocking a step');
  if (disposition === 'pass') {
    const unresolvedRequired = step.requiredBindings.filter(binding => binding.status !== 'loaded');
    const unresolvedOptional = step.optionalBindings.filter(binding => !['loaded', 'not-needed'].includes(binding.status));
    if (unresolvedRequired.length || unresolvedOptional.length) {
      const ids = [...unresolvedRequired, ...unresolvedOptional].map(binding => binding.id);
      throw new Error('resolve active-step bindings before passing the step: ' + ids.join(', '));
    }
  }
  step.status = disposition;
  step.evidence = evidence;
  step.reasonCode = reasonCode;
  step.updatedAt = new Date().toISOString();
  syncTypedAggregateObligations(loaded.set);
  loaded.set.activeStepId = activeStepRecord(loaded.set)?.id || null;
  atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
  return { step, activeStep: activeStepSnapshot(loaded.set) };
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
  if (loaded.set.stepBindingsEnabled === true) {
    const activeStep = activeStepRecord(loaded.set);
    if (activeStep) {
      if (activeStep.status === 'blocked') unresolved.push('step:' + activeStep.id + ':blocked');
      else unresolved.push('step:' + activeStep.id + ':pending');
      for (const binding of activeStep.requiredBindings) {
        if (binding.status !== 'loaded') unresolved.push('binding:' + activeStep.id + ':' + binding.id + ':' + binding.status);
      }
      for (const binding of activeStep.optionalBindings) {
        if (!['loaded', 'not-needed'].includes(binding.status)) {
          unresolved.push('optional-binding:' + activeStep.id + ':' + binding.id + ':' + binding.status);
        }
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
  updateBinding,
  updateStep,
  activeStepSnapshot,
  unresolvedObligations,
};

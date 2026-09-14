'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const ITERATIVE_MAX_ITERATIONS = 8;
const TIERS = new Set(['tier1', 'tier2', 'tier3', 'unclassified']);
const ROUTING_STATUSES = new Set(['ok', 'degraded']);
const STRATEGIES = new Set([
  'direct-single',
  'iterative-single',
  'fable-staged',
  'fable-parallel',
  'fable-multi-agent-workspace',
]);
const STRATEGY_SELECTIONS = new Set(['shadow', 'selected', 'deferred']);
const CAPABILITY_STATES = new Set(['available', 'unavailable', 'unknown']);
const MODEL_CAPABILITY_STATES = new Set(['available', 'partial', 'unavailable', 'unknown']);
const PROHIBITIONS = new Set(['fable', 'subagents', 'parallel', 'workspace', 'memory', 'ensemble']);

function uniqueReasonCodes(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeTierLabel(label) {
  const text = String(label || '');
  if (/^Tier\s*1\b/i.test(text)) return 'tier1';
  if (/^Tier\s*2\b/i.test(text)) return 'tier2';
  if (/^Tier\s*3\b/i.test(text)) return 'tier3';
  return 'unclassified';
}

function normalizeCapability(value, model = false) {
  const allowed = model ? MODEL_CAPABILITY_STATES : CAPABILITY_STATES;
  return allowed.has(value) ? value : 'unknown';
}

function normalizeHostCapabilities(raw = {}) {
  return {
    subagents: normalizeCapability(raw.subagents),
    parallelCalls: normalizeCapability(raw.parallelCalls),
    hooks: normalizeCapability(raw.hooks),
    state: normalizeCapability(raw.state),
    modelAvailability: normalizeCapability(raw.modelAvailability, true),
  };
}

function normalizeConstraints(raw = {}) {
  const value = key => (raw[key] === undefined ? 'unspecified' : raw[key]);
  return {
    cost: value('cost'),
    latency: value('latency'),
    tokens: value('tokens'),
    concurrency: value('concurrency'),
  };
}

function normalizeExplicitRequest(raw = {}) {
  const requestedStrategy = STRATEGIES.has(raw.strategy) ? raw.strategy : null;
  const prohibitions = Array.isArray(raw.prohibitions)
    ? raw.prohibitions.filter(value => PROHIBITIONS.has(value))
    : [];
  return {
    fableModel: ['haiku', 'sonnet', 'opus'].includes(raw.fableModel) ? raw.fableModel : null,
    strategy: requestedStrategy,
    prohibitions: Array.from(new Set(prohibitions)),
  };
}

function buildTaskShape(input = {}) {
  const tier = TIERS.has(input.tier) ? input.tier : 'unclassified';
  const signals = input.signals || {};
  const hostCapabilities = normalizeHostCapabilities(input.hostCapabilities);
  const constraints = normalizeConstraints(input.constraints);
  const explicitRequest = normalizeExplicitRequest(input.explicitRequest || {
    fableModel: input.requestedFableModel,
  });

  let scopeSize = 'unknown';
  if (signals.trivialDocsEdit || signals.specificFile) scopeSize = 'single-file';
  else if (signals.macroScope) scopeSize = 'repository-wide';
  else if (signals.multipleTasks) scopeSize = 'multi-file';

  let dependencyGraph = 'unknown';
  if (signals.cyclicDependencies) dependencyGraph = 'cyclic';
  else if (signals.independentWorkstreams) dependencyGraph = 'independent';
  else if (signals.dependentStages || tier === 'tier3') dependencyGraph = 'sequential';

  let writeSetOverlap = 'unknown';
  if (signals.sharedWrite) writeSetOverlap = 'overlap';
  else if (signals.readOnly) writeSetOverlap = 'read-only';
  else if (signals.disjointWrites) writeSetOverlap = 'disjoint';

  let domainDiversity = 'unknown';
  if (signals.crossDomain || signals.reusableSpecialists) domainDiversity = 'multi-domain';
  else if (tier === 'tier1' || tier === 'tier2') domainDiversity = 'single-domain';

  let expectedDuration = 'unknown';
  if (signals.multiSession) expectedDuration = 'multi-session';
  else if (tier === 'tier3') expectedDuration = 'multi-turn';
  else if (tier === 'tier1' || tier === 'tier2') expectedDuration = 'one-turn';

  let reversibility = 'unknown';
  if (signals.externalSideEffect) reversibility = 'external-side-effect';
  else if (signals.irreversibleAction) reversibility = 'irreversible';

  let uncertainty = 'unknown';
  if (signals.highUncertainty) uncertainty = 'high';
  else if (tier === 'tier1') uncertainty = 'low';
  else if (tier === 'tier2') uncertainty = 'medium';

  let verificationRequirement = 'unknown';
  if (tier === 'tier3' || signals.highRisk) verificationRequirement = 'independent';
  else if (tier === 'tier2') verificationRequirement = 'objective';
  else if (tier === 'tier1') verificationRequirement = 'basic';

  let estimatedStages = null;
  if (Number.isInteger(signals.estimatedStages) && signals.estimatedStages > 0) estimatedStages = signals.estimatedStages;
  else if (tier === 'tier3') estimatedStages = 2;
  else if (tier === 'tier1' || tier === 'tier2') estimatedStages = 1;

  return {
    schemaVersion: SCHEMA_VERSION,
    scopeSize,
    estimatedStages,
    dependencyGraph,
    writeSetOverlap,
    domainDiversity,
    expectedDuration,
    reversibility,
    uncertainty,
    verificationRequirement,
    hostCapabilities,
    constraints,
    explicitRequest,
    observedSignals: {
      macroScope: Boolean(signals.macroScope),
      trivialDocsEdit: Boolean(signals.trivialDocsEdit),
      tier3Keyword: Boolean(signals.tier3Keyword),
      tier2Keyword: Boolean(signals.tier2Keyword),
      multipleTasks: Boolean(signals.multipleTasks),
      multipleSentences: Boolean(signals.multipleSentences),
      specificFile: Boolean(signals.specificFile),
      question: Boolean(signals.question),
      independentWorkstreams: Boolean(signals.independentWorkstreams),
      readOnly: Boolean(signals.readOnly),
      disjointWrites: Boolean(signals.disjointWrites),
      sharedWrite: Boolean(signals.sharedWrite),
      dependentStages: Boolean(signals.dependentStages),
      multiSession: Boolean(signals.multiSession),
      reusableSpecialists: Boolean(signals.reusableSpecialists),
      crossDomain: Boolean(signals.crossDomain),
      highUncertainty: Boolean(signals.highUncertainty),
      irreversibleAction: Boolean(signals.irreversibleAction),
      externalSideEffect: Boolean(signals.externalSideEffect),
    },
    reasonCodes: uniqueReasonCodes(input.reasonCodes),
  };
}

function requestedStrategyIsProhibited(strategy, prohibitions) {
  if (!strategy) return false;
  if (strategy.startsWith('fable-') && prohibitions.includes('fable')) return true;
  if (strategy === 'fable-parallel' && prohibitions.includes('parallel')) return true;
  if (strategy === 'fable-multi-agent-workspace' && prohibitions.includes('workspace')) return true;
  if ((strategy === 'fable-parallel' || strategy === 'fable-multi-agent-workspace') && prohibitions.includes('subagents')) return true;
  return false;
}

function hasValidatedParallelScope(taskShape) {
  return taskShape.dependencyGraph === 'independent' &&
    (taskShape.writeSetOverlap === 'read-only' || taskShape.writeSetOverlap === 'disjoint');
}

function selectWorkflowStrategy(input = {}) {
  const tier = TIERS.has(input.tier) ? input.tier : 'unclassified';
  const routingStatus = ROUTING_STATUSES.has(input.routingStatus) ? input.routingStatus : 'degraded';
  const taskShape = input.taskShape || buildTaskShape({ tier });
  const explicit = taskShape.explicitRequest || normalizeExplicitRequest();
  const prohibitions = explicit.prohibitions || [];
  const reasonCodes = [];
  const fallback = {
    onMissingSubagents: 'visible-inline-or-stop',
    disposition: 'none',
    mode: 'none',
    reasonCodes: [],
  };

  let strategy = null;
  let strategySelection = 'deferred';

  if (explicit.strategy) {
    strategy = explicit.strategy;
    strategySelection = 'selected';
    reasonCodes.push('explicit-strategy-request');
    if (requestedStrategyIsProhibited(strategy, prohibitions)) {
      fallback.disposition = 'blocked';
      fallback.mode = 'blocked';
      fallback.reasonCodes.push('explicit-request-conflicts-with-prohibition');
    } else if (strategy === 'fable-parallel' && !hasValidatedParallelScope(taskShape)) {
      strategy = 'fable-staged';
      fallback.disposition = 'reduced';
      fallback.mode = 'serialized';
      fallback.reasonCodes.push(
        taskShape.writeSetOverlap === 'overlap'
          ? 'parallel-write-set-overlap'
          : 'parallel-preconditions-unproven',
      );
    }
  } else if (routingStatus !== 'ok') {
    reasonCodes.push('routing-degraded-strategy-deferred');
  } else if (tier === 'unclassified') {
    reasonCodes.push('unclassified-strategy-deferred');
  } else if (tier === 'tier1') {
    strategy = 'direct-single';
    strategySelection = 'selected';
    reasonCodes.push('tier1-bounded-single-pass');
  } else if (tier === 'tier2') {
    strategy = 'iterative-single';
    strategySelection = 'selected';
    reasonCodes.push('tier2-iterative-default');
  } else if (taskShape.expectedDuration === 'multi-session' && taskShape.observedSignals.reusableSpecialists) {
    strategy = 'fable-multi-agent-workspace';
    strategySelection = 'selected';
    reasonCodes.push('durable-reusable-specialists');
  } else if (hasValidatedParallelScope(taskShape)) {
    strategy = 'fable-parallel';
    strategySelection = 'selected';
    reasonCodes.push('independent-scopes-validated');
  } else {
    strategy = 'fable-staged';
    strategySelection = 'selected';
    reasonCodes.push('tier3-dependent-or-unproven-parallelism');
  }

  if (strategy && fallback.disposition !== 'blocked') {
    if (strategy.startsWith('fable-') && prohibitions.includes('fable')) {
      strategy = 'iterative-single';
      fallback.disposition = 'reduced';
      fallback.mode = 'inline';
      fallback.reasonCodes.push('user-prohibited-fable');
    }

    if (strategy === 'fable-multi-agent-workspace' && prohibitions.includes('workspace')) {
      strategy = 'fable-staged';
      fallback.disposition = 'reduced';
      fallback.mode = 'inline';
      fallback.reasonCodes.push('user-prohibited-workspace');
    }

    if (strategy === 'fable-parallel' && prohibitions.includes('parallel')) {
      strategy = 'fable-staged';
      fallback.disposition = 'reduced';
      fallback.mode = 'serialized';
      fallback.reasonCodes.push('user-prohibited-parallelism');
    }

    const concurrency = Number(taskShape.constraints && taskShape.constraints.concurrency);
    if (strategy === 'fable-parallel' && Number.isFinite(concurrency) && concurrency <= 1) {
      strategy = 'fable-staged';
      fallback.disposition = 'reduced';
      fallback.mode = 'serialized';
      fallback.reasonCodes.push('concurrency-budget-serializes');
    }

    if (strategy === 'fable-parallel' && taskShape.hostCapabilities.parallelCalls === 'unavailable') {
      strategy = 'fable-staged';
      fallback.disposition = 'reduced';
      fallback.mode = 'serialized';
      fallback.reasonCodes.push('parallel-capability-unavailable');
    }

    if (strategy === 'fable-parallel' && (prohibitions.includes('subagents') || taskShape.hostCapabilities.subagents === 'unavailable')) {
      strategy = 'fable-staged';
      fallback.disposition = 'reduced';
      fallback.mode = 'inline';
      fallback.reasonCodes.push(prohibitions.includes('subagents') ? 'user-prohibited-subagents' : 'subagents-unavailable');
    }

    if (strategy === 'fable-multi-agent-workspace') {
      if (taskShape.hostCapabilities.state === 'unavailable') {
        fallback.disposition = 'blocked';
        fallback.mode = 'blocked';
        fallback.reasonCodes.push('workspace-state-unavailable');
      }
      if (prohibitions.includes('subagents') || taskShape.hostCapabilities.subagents === 'unavailable') {
        fallback.disposition = 'blocked';
        fallback.mode = 'blocked';
        fallback.reasonCodes.push(prohibitions.includes('subagents') ? 'user-prohibited-subagents' : 'subagents-unavailable');
      }
    } else if (strategy === 'fable-staged' && (prohibitions.includes('subagents') || taskShape.hostCapabilities.subagents === 'unavailable')) {
      fallback.disposition = 'reduced';
      fallback.mode = 'inline';
      fallback.reasonCodes.push(prohibitions.includes('subagents') ? 'user-prohibited-subagents' : 'subagents-unavailable');
    }

    if (explicit.fableModel && taskShape.hostCapabilities.modelAvailability === 'unavailable') {
      fallback.disposition = 'blocked';
      fallback.mode = 'blocked';
      fallback.reasonCodes.push('requested-model-capability-unavailable');
    }
  }

  return {
    strategy,
    strategySelection,
    reasonCodes: uniqueReasonCodes(reasonCodes),
    fallback: {
      ...fallback,
      reasonCodes: uniqueReasonCodes(fallback.reasonCodes),
    },
  };
}

function planMetadataForStrategy(strategy) {
  const base = {
    patterns: ['router'],
    requiredInvariants: ['scope-lock', 'verify-before-claim', 'replan-after-repeated-failure'],
    suggestedSkills: [],
    maxIterations: null,
    parallelAllowed: null,
    parallelReasonCodes: [],
    workspaceRequired: null,
    workspaceReasonCodes: [],
    memoryRead: 'none',
    memoryWrite: 'none',
    verificationMode: 'verify-before-claim',
    verificationIndependent: null,
  };

  if (strategy === 'direct-single') {
    return {
      ...base,
      patterns: ['router', 'augmented-llm'],
      parallelAllowed: false,
      parallelReasonCodes: ['single-pass-topology'],
      workspaceRequired: false,
      workspaceReasonCodes: ['bounded-one-turn-work'],
      verificationIndependent: false,
    };
  }

  if (strategy === 'iterative-single') {
    return {
      ...base,
      patterns: ['router', 'react'],
      requiredInvariants: [...base.requiredInvariants, 'loop-budget', 'objective-verification'],
      suggestedSkills: ['tdd', 'verification-loop'],
      maxIterations: ITERATIVE_MAX_ITERATIONS,
      parallelAllowed: false,
      parallelReasonCodes: ['single-agent-loop'],
      workspaceRequired: false,
      workspaceReasonCodes: ['single-agent-loop'],
      verificationMode: 'objective',
      verificationIndependent: false,
    };
  }

  if (strategy === 'fable-staged') {
    return {
      ...base,
      patterns: ['router', 'planner-executor', 'evaluator-optimizer'],
      requiredInvariants: [...base.requiredInvariants, 'stage-contracts', 'cold-verification'],
      suggestedSkills: ['fable-mode', 'fable-discipline', 'verification-loop'],
      parallelAllowed: false,
      parallelReasonCodes: ['dependent-or-unproven-independent-stages'],
      workspaceRequired: false,
      workspaceReasonCodes: ['no-durable-workspace-requirement'],
      verificationMode: 'cold-verifier',
      verificationIndependent: true,
    };
  }

  if (strategy === 'fable-parallel') {
    return {
      ...base,
      patterns: ['router', 'planner-executor', 'evaluator-optimizer'],
      requiredInvariants: [...base.requiredInvariants, 'stage-contracts', 'cold-verification', 'parallel-scope-contract', 'synthesis-barrier'],
      suggestedSkills: ['fable-mode', 'fable-discipline', 'verification-loop'],
      parallelAllowed: true,
      parallelReasonCodes: ['independent-read-only-or-disjoint-scopes'],
      workspaceRequired: false,
      workspaceReasonCodes: ['no-durable-workspace-requirement'],
      verificationMode: 'cold-verifier',
      verificationIndependent: true,
    };
  }

  if (strategy === 'fable-multi-agent-workspace') {
    return {
      ...base,
      patterns: ['router', 'planner-executor', 'evaluator-optimizer', 'multi-agent-memory'],
      requiredInvariants: [...base.requiredInvariants, 'stage-contracts', 'cold-verification', 'handoff-contracts', 'workspace-state'],
      suggestedSkills: ['multi-agent-workspace', 'fable-mode', 'fable-discipline', 'verification-loop'],
      parallelAllowed: false,
      parallelReasonCodes: ['workspace-orchestrator-controls-concurrency'],
      workspaceRequired: true,
      workspaceReasonCodes: ['durable-reusable-specialists'],
      memoryRead: 'workspace-index',
      memoryWrite: 'propose',
      verificationMode: 'cold-verifier',
      verificationIndependent: true,
    };
  }

  return base;
}

function buildWorkflowPlan(input = {}) {
  const tier = TIERS.has(input.tier) ? input.tier : 'unclassified';
  const routingStatus = ROUTING_STATUSES.has(input.routingStatus) ? input.routingStatus : 'degraded';
  const taskShape = input.taskShape || buildTaskShape({ tier });
  const selection = selectWorkflowStrategy({ tier, routingStatus, taskShape });
  const meta = planMetadataForStrategy(selection.strategy);
  const actionGateReasonCodes = uniqueReasonCodes(input.actionGateReasonCodes);
  const actionGateRequired = actionGateReasonCodes.length > 0;

  const requiredInvariants = [...meta.requiredInvariants];
  const patterns = [...meta.patterns];
  if (actionGateRequired) {
    requiredInvariants.push('pre-action-approval');
    patterns.push('verifier-gated');
  }

  const fallback = {
    ...selection.fallback,
    reasonCodes: uniqueReasonCodes(selection.fallback.reasonCodes),
  };
  if (actionGateRequired && taskShape.hostCapabilities.hooks === 'unavailable') {
    fallback.disposition = 'blocked';
    fallback.mode = 'blocked';
    fallback.reasonCodes = uniqueReasonCodes([...fallback.reasonCodes, 'action-gate-hook-unavailable']);
  }

  const reasonCodes = uniqueReasonCodes([
    ...(input.reasonCodes || []),
    ...selection.reasonCodes,
    ...fallback.reasonCodes,
    ...actionGateReasonCodes,
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    routingStatus,
    tier,
    strategy: selection.strategy,
    strategySelection: selection.strategySelection,
    patterns: Array.from(new Set(patterns)),
    requiredInvariants: Array.from(new Set(requiredInvariants)),
    suggestedSkills: Array.from(new Set(meta.suggestedSkills)),
    actionGate: {
      required: actionGateRequired,
      reasonCodes: actionGateReasonCodes,
      approver: actionGateRequired ? 'rule-or-human' : null,
      disposition: actionGateRequired ? 'pending-approval' : null,
    },
    limits: {
      maxIterations: meta.maxIterations,
      maxRevisionRounds: 2,
      maxWorkers: 'fable-orchestrator-cap',
    },
    parallelism: {
      allowed: meta.parallelAllowed,
      requires: ['declared-dependsOn', 'disjoint-writeSet'],
      reasonCodes: uniqueReasonCodes(meta.parallelReasonCodes),
    },
    workspace: {
      required: meta.workspaceRequired,
      reasonCodes: uniqueReasonCodes(meta.workspaceReasonCodes),
    },
    memory: {
      read: meta.memoryRead,
      scope: 'task-relevant-only',
      write: meta.memoryWrite,
    },
    verification: {
      mode: meta.verificationMode,
      independent: meta.verificationIndependent,
    },
    ensemble: null,
    modelSelection: {
      requested: taskShape.explicitRequest.fableModel,
      policy: 'defer-to-fable-selector',
    },
    fallback,
    reasonCodes,
  };
}

function buildRouterContract(input = {}) {
  const tier = normalizeTierLabel(input.recommendedTier);
  const reasonCodes = uniqueReasonCodes(input.reasonCodes);
  const explicitRequest = normalizeExplicitRequest(input.explicitRequest || {
    fableModel: input.requestedFableModel,
  });
  const taskShape = buildTaskShape({
    tier,
    signals: input.signals,
    hostCapabilities: input.hostCapabilities,
    constraints: input.constraints,
    explicitRequest,
    reasonCodes,
  });
  const workflowPlan = buildWorkflowPlan({
    routingStatus: input.routingStatus,
    tier,
    taskShape,
    actionGateReasonCodes: input.actionGateReasonCodes,
    reasonCodes,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    routingStatus: workflowPlan.routingStatus,
    classification: {
      tier,
      label: input.recommendedTier || 'Unclassified',
      rationale: input.rationale || 'No classification rationale available.',
      reasonCodes,
    },
    taskShape,
    workflowPlan,
  };
}

function createDegradedRouterContract(reasonCode, message) {
  return buildRouterContract({
    routingStatus: 'degraded',
    recommendedTier: 'Unclassified',
    rationale: message || 'Structured router contract unavailable.',
    reasonCodes: [reasonCode || 'router-contract-unavailable'],
    signals: {},
    requestedFableModel: null,
  });
}

function validateWorkflowPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, errors: ['workflow plan must be an object'] };
  }
  if (plan.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (!ROUTING_STATUSES.has(plan.routingStatus)) errors.push('invalid routingStatus');
  if (!TIERS.has(plan.tier)) errors.push('invalid tier');
  if (plan.strategy !== null && !STRATEGIES.has(plan.strategy)) errors.push('invalid strategy');
  if (!STRATEGY_SELECTIONS.has(plan.strategySelection)) errors.push('invalid strategySelection');
  if (plan.strategySelection === 'selected' && plan.strategy === null) errors.push('selected strategy must not be null');
  if (plan.strategySelection === 'deferred' && plan.strategy !== null) errors.push('deferred strategy must be null');
  if (!Array.isArray(plan.requiredInvariants)) errors.push('requiredInvariants must be an array');
  if (!Array.isArray(plan.suggestedSkills)) errors.push('suggestedSkills must be an array');
  if (!plan.actionGate || typeof plan.actionGate.required !== 'boolean') errors.push('actionGate.required must be boolean');
  if (plan.actionGate && plan.actionGate.required && plan.actionGate.disposition !== 'pending-approval') errors.push('required actionGate must be pending-approval before execution');
  if (!plan.limits || !Object.prototype.hasOwnProperty.call(plan.limits, 'maxIterations')) errors.push('limits.maxIterations is required');
  if (plan.strategy === 'iterative-single' && (!Number.isInteger(plan.limits.maxIterations) || plan.limits.maxIterations < 1)) errors.push('iterative-single requires maxIterations');
  if (plan.strategy === 'fable-parallel' && (!plan.parallelism || plan.parallelism.allowed !== true)) errors.push('fable-parallel requires parallelism.allowed=true');
  if (!plan.fallback || !['none', 'reduced', 'blocked'].includes(plan.fallback.disposition)) errors.push('fallback.disposition is invalid');
  if (!Array.isArray(plan.reasonCodes)) errors.push('reasonCodes must be an array');
  return { valid: errors.length === 0, errors };
}

function validateRouterContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { valid: false, errors: ['router contract must be an object'] };
  }
  if (contract.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported contract schemaVersion');
  if (!contract.classification || !TIERS.has(contract.classification.tier)) errors.push('classification.tier is invalid');
  if (!contract.taskShape || contract.taskShape.schemaVersion !== SCHEMA_VERSION) errors.push('taskShape schemaVersion is invalid');
  const workflowValidation = validateWorkflowPlan(contract.workflowPlan);
  errors.push(...workflowValidation.errors.map(error => `workflowPlan: ${error}`));
  if (
    contract.workflowPlan &&
    contract.workflowPlan.strategy === 'fable-parallel' &&
    contract.workflowPlan.fallback &&
    contract.workflowPlan.fallback.disposition !== 'blocked'
  ) {
    if (contract.taskShape.dependencyGraph !== 'independent') errors.push('fable-parallel requires independent dependencyGraph');
    if (!['disjoint', 'read-only'].includes(contract.taskShape.writeSetOverlap)) errors.push('fable-parallel requires disjoint/read-only writeSet');
  }
  return { valid: errors.length === 0, errors };
}

function writeRouterContract(contractPath, contract) {
  if (!contractPath) return;
  const validation = validateRouterContract(contract);
  if (!validation.valid) {
    throw new Error(`Refusing to write invalid router contract: ${validation.errors.join('; ')}`);
  }
  const dir = path.dirname(contractPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${contractPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(contract)}\n`, 'utf8');
  fs.renameSync(tempPath, contractPath);
}

module.exports = {
  SCHEMA_VERSION,
  ITERATIVE_MAX_ITERATIONS,
  buildRouterContract,
  buildTaskShape,
  buildWorkflowPlan,
  createDegradedRouterContract,
  normalizeConstraints,
  normalizeExplicitRequest,
  normalizeHostCapabilities,
  normalizeTierLabel,
  selectWorkflowStrategy,
  validateRouterContract,
  validateWorkflowPlan,
  writeRouterContract,
};

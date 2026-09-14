'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const TIERS = new Set(['tier1', 'tier2', 'tier3', 'unclassified']);
const ROUTING_STATUSES = new Set(['ok', 'degraded']);
const STRATEGIES = new Set([
  'direct-single',
  'iterative-single',
  'fable-staged',
  'fable-parallel',
  'fable-multi-agent-workspace',
]);

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

function buildTaskShape(input = {}) {
  const signals = input.signals || {};
  let scopeSize = 'unknown';
  if (signals.trivialDocsEdit || signals.specificFile) scopeSize = 'single-file';
  if (signals.macroScope) scopeSize = 'repository-wide';

  return {
    schemaVersion: SCHEMA_VERSION,
    scopeSize,
    estimatedStages: null,
    dependencyGraph: 'unknown',
    writeSetOverlap: 'unknown',
    domainDiversity: 'unknown',
    expectedDuration: 'unknown',
    reversibility: 'unknown',
    uncertainty: 'unknown',
    verificationRequirement: 'unknown',
    hostCapabilities: {
      subagents: 'unknown',
      parallelCalls: 'unknown',
      hooks: 'unknown',
      state: 'unknown',
      modelAvailability: 'unknown',
    },
    constraints: {
      cost: 'unspecified',
      latency: 'unspecified',
      tokens: 'unspecified',
      concurrency: 'unspecified',
    },
    explicitRequest: {
      fableModel: input.requestedFableModel || null,
    },
    observedSignals: {
      macroScope: Boolean(signals.macroScope),
      trivialDocsEdit: Boolean(signals.trivialDocsEdit),
      tier3Keyword: Boolean(signals.tier3Keyword),
      tier2Keyword: Boolean(signals.tier2Keyword),
      multipleTasks: Boolean(signals.multipleTasks),
      multipleSentences: Boolean(signals.multipleSentences),
      specificFile: Boolean(signals.specificFile),
      question: Boolean(signals.question),
    },
    reasonCodes: uniqueReasonCodes(input.reasonCodes),
  };
}

function buildWorkflowPlan(input = {}) {
  const tier = TIERS.has(input.tier) ? input.tier : 'unclassified';
  const routingStatus = ROUTING_STATUSES.has(input.routingStatus) ? input.routingStatus : 'degraded';
  const reasonCodes = uniqueReasonCodes([
    ...(input.reasonCodes || []),
    'strategy-selection-pending',
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    routingStatus,
    tier,
    strategy: null,
    strategySelection: 'shadow',
    patterns: ['router'],
    requiredInvariants: [
      'scope-lock',
      'verify-before-claim',
      'replan-after-repeated-failure',
    ],
    suggestedSkills: [],
    actionGate: {
      required: false,
      reasonCodes: [],
      approver: null,
      disposition: null,
    },
    limits: {
      maxIterations: null,
      maxRevisionRounds: 2,
      maxWorkers: 'fable-orchestrator-cap',
    },
    parallelism: {
      allowed: null,
      requires: ['declared-dependsOn', 'disjoint-writeSet'],
      reasonCodes: ['strategy-selection-pending'],
    },
    workspace: {
      required: null,
      reasonCodes: ['strategy-selection-pending'],
    },
    memory: {
      read: null,
      scope: 'task-relevant-only',
      write: 'none',
    },
    verification: {
      mode: 'verify-before-claim',
      independent: null,
    },
    ensemble: null,
    modelSelection: {
      requested: input.requestedFableModel || null,
      policy: 'defer-to-fable-selector',
    },
    fallback: {
      onMissingSubagents: 'visible-inline-or-stop',
    },
    reasonCodes,
  };
}

function buildRouterContract(input = {}) {
  const tier = normalizeTierLabel(input.recommendedTier);
  const reasonCodes = uniqueReasonCodes(input.reasonCodes);
  const taskShape = buildTaskShape({
    signals: input.signals,
    requestedFableModel: input.requestedFableModel,
    reasonCodes,
  });
  const workflowPlan = buildWorkflowPlan({
    routingStatus: input.routingStatus,
    tier,
    requestedFableModel: input.requestedFableModel,
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
  if (plan.strategySelection !== 'shadow' && plan.strategySelection !== 'selected') errors.push('invalid strategySelection');
  if (!Array.isArray(plan.requiredInvariants)) errors.push('requiredInvariants must be an array');
  if (!plan.actionGate || typeof plan.actionGate.required !== 'boolean') errors.push('actionGate.required must be boolean');
  if (!plan.limits || !Object.prototype.hasOwnProperty.call(plan.limits, 'maxIterations')) errors.push('limits.maxIterations is required');
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
  buildRouterContract,
  buildTaskShape,
  buildWorkflowPlan,
  createDegradedRouterContract,
  normalizeTierLabel,
  validateRouterContract,
  validateWorkflowPlan,
  writeRouterContract,
};

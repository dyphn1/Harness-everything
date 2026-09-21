'use strict';

// Runtime policy wrapper around the Phase-2 router contract. Keep the original
// topology selector stable in router-contract-core.js, then add lifecycle
// invariants that are orthogonal to strategy selection.
const core = require('./router-contract-core');

function isMajorWorkflow(plan) {
  return Boolean(plan && (plan.tier === 'tier3' || String(plan.strategy || '').startsWith('fable-')));
}

function augmentWorkflowPlan(plan) {
  if (!plan || !isMajorWorkflow(plan)) return plan;
  const requiredInvariants = Array.isArray(plan.requiredInvariants) ? [...plan.requiredInvariants] : [];
  const suggestedSkills = Array.isArray(plan.suggestedSkills) ? [...plan.suggestedSkills] : [];
  if (!requiredInvariants.includes('isolated-worktree-before-mutation')) requiredInvariants.push('isolated-worktree-before-mutation');
  if (!suggestedSkills.includes('using-git-worktrees')) suggestedSkills.push('using-git-worktrees');
  return { ...plan, requiredInvariants, suggestedSkills, mutationIsolation: {
    required: true, mechanism: 'git-worktree', transition: 'before-first-mutation', onUnavailable: 'degraded',
  } };
}

function buildWorkflowPlan(input = {}) {
  return augmentWorkflowPlan(core.buildWorkflowPlan(input));
}

function buildRouterContract(input = {}) {
  const contract = core.buildRouterContract(input);
  return {
    ...contract,
    workflowPlan: augmentWorkflowPlan(contract.workflowPlan),
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

module.exports = {
  ...core,
  augmentWorkflowPlan,
  buildRouterContract,
  buildWorkflowPlan,
  createDegradedRouterContract,
};

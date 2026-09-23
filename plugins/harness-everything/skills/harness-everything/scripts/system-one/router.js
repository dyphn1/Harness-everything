'use strict';
const { createRequest, decide } = require('./contract');
const provider = require('./provider');
const TIER_OPTIONS = Object.freeze([
  { id: 'tier1', text: 'A small bounded edit or operation with clear scope.' },
  { id: 'tier2', text: 'Implementation or bug fix needing iterative testing.' },
  { id: 'tier3', text: 'Architecture, repository-wide change or multi-stage engineering.' },
  { id: 'unclassified', text: 'Unclear intent, insufficient context or outside these categories.' },
].map(Object.freeze));
const LABELS = { tier1: 'Tier 1 (Trivial)', tier2: 'Tier 2 (Standard Task)', tier3: 'Tier 3 (Macro Task)' };
const RANK = { tier1: 1, tier2: 2, tier3: 3 };
// input.floor is the deterministic structural minimum; a scorer may raise the tier, never lower it below the floor.
function selectTier(input, env = process.env, scorer = provider.score) {
  const mode = env.HARNESS_SYSTEM_ONE_MODE || 'off';
  if (mode === 'off') return { tier: input.tier, diagnostic: null };
  const fallback = (reason, status = 'unavailable') => ({ tier: input.tier, diagnostic: { mode: ['shadow', 'prefer'].includes(mode) ? mode : 'invalid', status, reason } });
  if (!['shadow', 'prefer'].includes(mode)) return fallback('invalid-mode');
  if (input.floor != null && !Object.hasOwn(RANK, input.floor)) return fallback('invalid-request');
  let request;
  try { request = createRequest('tier', input.prompt, TIER_OPTIONS); }
  catch (_) { return fallback('invalid-request'); }
  let result;
  try { result = scorer(request, env.HARNESS_SYSTEM_ONE_CONFIG); }
  catch (_) { return fallback('provider-unavailable'); }
  if (!result || result.status !== 'scored') {
    const allowed = ['provider-timeout', 'provider-output-limit', 'provider-exit', 'provider-json', 'provider-config', 'provider-unavailable'];
    return fallback(allowed.includes(result?.reason) ? result.reason : 'provider-unavailable');
  }
  const decision = decide(request, result.response);
  if (decision.selectedId === 'unclassified') Object.assign(decision, { selectedId: null, status: 'abstain', reason: 'unclassified' });
  const accepted = decision.status === 'accepted';
  const belowFloor = accepted && input.floor != null && RANK[decision.selectedId] < RANK[input.floor];
  const applied = mode === 'prefer' && accepted && !input.explicit && !belowFloor;
  const reason = input.explicit && accepted ? 'explicit-precedence' : belowFloor ? 'structural-floor' : decision.reason;
  return { tier: applied ? LABELS[decision.selectedId] : input.tier, diagnostic: { mode, ...decision, applied, reason } };
}
module.exports = { selectTier, TIER_OPTIONS };

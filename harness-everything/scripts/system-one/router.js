'use strict';
const { createRequest, decide } = require('./contract');
const provider = require('./provider');
const { prepareHandoffInput } = require('./handoff-input');
const TIER_OPTIONS = Object.freeze([
  { id: 'tier1', text: 'A small bounded edit or operation with clear scope.' },
  { id: 'tier2', text: 'Implementation or bug fix needing iterative testing.' },
  { id: 'tier3', text: 'Architecture, repository-wide change or multi-stage engineering.' },
  { id: 'unclassified', text: 'Unclear intent, insufficient context or outside these categories.' },
].map(Object.freeze));
const LABELS = { tier1: 'Tier 1 (Trivial)', tier2: 'Tier 2 (Standard Task)', tier3: 'Tier 3 (Macro Task)' };
const RANK = { tier1: 1, tier2: 2, tier3: 3 };
const VALIDITY_OPTIONS = Object.freeze([
  { id: 'actionable', text: 'The current prompt contains an actionable request.' },
  { id: 'invalid', text: 'The request needs conversation context to understand.' },
].map(Object.freeze));
const isProbability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function liveOptions() {
  const { INTENT_OPTIONS } = require('./catalogs');
  return { validity: VALIDITY_OPTIONS, intent: INTENT_OPTIONS, tier: TIER_OPTIONS };
}
function exactScores(value, ids) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === ids.length
    && ids.every(id => Object.hasOwn(value, id) && isProbability(value[id]));
}
function routeLive(input, result) {
  if (!result || typeof result.version !== 'string' || !result.version
    || typeof result.sha256 !== 'string' || !/^[a-f0-9]{16}$/.test(result.sha256)) {
    return { tier: input.tier, reference: { available: false } };
  }
  const options = liveOptions();
  const stages = result.stageScores || {};
  const thresholds = result.thresholds || {};
  const validityScores = exactScores(stages.validity, ['invalid'])
    && isProbability(thresholds.validity?.invalid) ? { invalid: stages.validity.invalid } : null;
  const validity = validityScores === null ? 'abstain'
    : validityScores.invalid >= thresholds.validity.invalid ? 'invalid' : 'actionable';
  const intentIds = options.intent.map(option => option.id).filter(id => id !== 'unclassified');
  const intents = validity === 'actionable' && exactScores(stages.intent, intentIds)
    && intentIds.every(id => isProbability(thresholds.intent?.[id]))
    ? stages.intent : null;
  const tierIds = ['tier1', 'tier2', 'tier3'];
  const tierScores = validity === 'actionable' && exactScores(stages.tier, tierIds)
    && tierIds.every(id => isProbability(thresholds.tier?.[id])) ? stages.tier : null;
  const selectedIntents = intents ? intentIds.filter(id => intents[id] >= thresholds.intent[id])
    .sort((a, b) => (intents[b] - intents[a]) || (intentIds.indexOf(a) - intentIds.indexOf(b))).slice(0, 3) : [];
  const rankedTiers = tierScores ? [...tierIds].sort((a, b) => (tierScores[b] - tierScores[a])
    || (tierIds.indexOf(a) - tierIds.indexOf(b))) : [];
  const bestTier = rankedTiers[0];
  const selectedTier = bestTier && tierScores[bestTier] >= thresholds.tier[bestTier]
    && (rankedTiers.length === 1 || tierScores[bestTier] !== tierScores[rankedTiers[1]]) ? bestTier : null;
  const systemOne = {
    version: result.version,
    sha256: result.sha256,
    mode: 'live',
    inputEnrichment: { handoffFiles: Number.isSafeInteger(result.inputEnrichment?.handoffFiles)
      ? result.inputEnrichment.handoffFiles : 0 },
    validity: validityScores,
    intents,
    tier: tierScores,
    decision: { validity, intents: selectedIntents, tier: selectedTier },
  };
  const top = (stage, scores) => scores ? Object.entries(scores).sort((a, b) => b[1] - a[1]
    || Object.keys(scores).indexOf(a[0]) - Object.keys(scores).indexOf(b[0])).slice(0, 3)
    .map(([id, probability]) => ({ stage, id, probability })) : [];
  const reference = { version: result.version, sha256: result.sha256,
    topOptions: [...top('validity', validityScores), ...top('intent', intents), ...top('tier', tierScores)] };
  const floorValid = input.floor == null || Object.hasOwn(RANK, input.floor);
  const belowFloor = selectedTier && input.floor != null && RANK[selectedTier] < RANK[input.floor];
  const applied = floorValid && validity === 'actionable' && selectedTier !== null && !input.explicit && !belowFloor;
  return { tier: applied ? LABELS[selectedTier] : input.tier, systemOne, reference, applied };
}
async function prescoreLive(prompt, env = process.env, score = provider.scoreLive, cwd = process.cwd()) {
  if (env.HARNESS_SYSTEM_ONE_MODE !== 'live') return null;
  try {
    const prepared = prepareHandoffInput(prompt, cwd);
    const result = await score(prepared.input, env, liveOptions());
    return result ? { ...result, inputEnrichment: { handoffFiles: prepared.handoffFiles } } : result;
  }
  catch (_) { return null; }
}
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
    const allowed = ['provider-timeout', 'provider-output-limit', 'provider-exit', 'provider-json', 'provider-config', 'provider-unavailable', 'provider-starting'];
    return fallback(allowed.includes(result?.reason) ? result.reason : 'provider-unavailable');
  }
  const decision = decide(request, result.response, provider.decisionPolicy(result.acceptance));
  if (decision.selectedId === 'unclassified') Object.assign(decision, { selectedId: null, status: 'abstain', reason: 'unclassified' });
  const accepted = decision.status === 'accepted';
  const belowFloor = accepted && input.floor != null && RANK[decision.selectedId] < RANK[input.floor];
  const applied = mode === 'prefer' && accepted && !input.explicit && !belowFloor;
  const reason = input.explicit && accepted ? 'explicit-precedence' : belowFloor ? 'structural-floor' : decision.reason;
  return { tier: applied ? LABELS[decision.selectedId] : input.tier, diagnostic: { mode, ...decision, applied, reason } };
}
// Hook entry: score the same fixed-catalog request asynchronously before routing (no sync worker bridge).
// Returns a scorer for selectTier, or null when System One is off/invalid; nothing is called then.
async function prescoreTier(prompt, env = process.env, scoreAsync = provider.scoreAsync) {
  if (!['shadow', 'prefer'].includes(env.HARNESS_SYSTEM_ONE_MODE)) return null;
  let request;
  try { request = createRequest('tier', prompt, TIER_OPTIONS); }
  catch (_) { return null; }
  let result; let failed = false;
  try { result = await scoreAsync(request, env.HARNESS_SYSTEM_ONE_CONFIG); }
  catch (_) { failed = true; }
  return (req, config) => {
    if (req.requestHash !== request.requestHash) return provider.score(req, config);
    if (failed) throw new Error('provider-unavailable');
    return result;
  };
}
module.exports = { selectTier, prescoreTier, prescoreLive, routeLive, TIER_OPTIONS, VALIDITY_OPTIONS };

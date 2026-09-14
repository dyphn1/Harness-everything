'use strict';

const ENSEMBLE_MAX_CANDIDATES = 3;

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function detectEnsembleTaskSignals(prompt) {
  const text = String(prompt || '');
  const comparableOutput = /\b(?:choice|choose|decision|decide|ranking|rank|ranked|verdict|recommendation|recommend|compare alternatives?|compare approaches?|which (?:option|approach|design)|select between|trade[- ]offs?)\b/i.test(text) ||
    /(?:選擇|決策|排名|判定|建議|比較方案|比較方法|取捨)/.test(text);
  const explicitDisagreement = /\b(?:disagreement|dissent|minority (?:view|position)|competing (?:answers|positions|approaches)|preserve disagreement)\b/i.test(text) ||
    /(?:分歧|不同意見|少數意見|競爭方案)/.test(text);
  const creativeGeneration = /\b(?:creative|brainstorm|story|poem|fiction|slogan|tagline|copywriting|marketing copy|logo|illustration|artwork|lyrics?|name ideas?|generate ideas?)\b/i.test(text) ||
    /(?:創意|腦力激盪|故事|詩|標語|文案|插畫|歌詞|命名)/.test(text);
  const mechanicalWork = /\b(?:mechanical|bulk rename|mass rename|rename all|replace all|reformat|format all|lint[- ]fix|sort imports?|codemod|repetitive edits?|generated files?|migrate all identifiers?)\b/i.test(text) ||
    /(?:機械式|批次重新命名|全部取代|大量重複修改|格式化全部)/.test(text);
  const highStakes = /\b(?:high[- ]stakes|safety[- ]critical|security[- ]critical|critical decision|material risk)\b/i.test(text) ||
    /(?:高風險|高利害|關鍵決策)/.test(text);
  return {
    comparableOutput,
    explicitDisagreement,
    creativeGeneration,
    mechanicalWork,
    highStakes,
  };
}

function applyEnsemblePolicy(contract, prompt) {
  if (!contract || typeof contract !== 'object' || !contract.workflowPlan || !contract.taskShape) return contract;
  const plan = contract.workflowPlan;
  const shape = contract.taskShape;
  const explicit = shape.explicitRequest || {};
  const prohibitions = Array.isArray(explicit.prohibitions) ? explicit.prohibitions : [];
  const signals = detectEnsembleTaskSignals(prompt);
  const highUncertainty = shape.uncertainty === 'high';
  const fableTopology = typeof plan.strategy === 'string' && plan.strategy.startsWith('fable-');
  const comparable = signals.comparableOutput || signals.explicitDisagreement;

  const reasonCodes = [];
  if (highUncertainty) reasonCodes.push('high-uncertainty');
  if (signals.highStakes) reasonCodes.push('high-stakes');
  if (signals.comparableOutput) reasonCodes.push('comparable-output');
  if (signals.explicitDisagreement) reasonCodes.push('explicit-disagreement');

  let selected = (highUncertainty || signals.highStakes) && comparable && fableTopology;
  if (signals.creativeGeneration) {
    selected = false;
    reasonCodes.push('ensemble-excluded-creative-generation');
  }
  if (signals.mechanicalWork) {
    selected = false;
    reasonCodes.push('ensemble-excluded-mechanical-work');
  }
  if (prohibitions.includes('ensemble')) {
    selected = false;
    reasonCodes.push('user-prohibited-ensemble');
  }
  if (shape.hostCapabilities && shape.hostCapabilities.subagents === 'unavailable') {
    selected = false;
    reasonCodes.push('ensemble-subagents-unavailable');
  }
  if (plan.fallback && plan.fallback.disposition === 'blocked') {
    selected = false;
    reasonCodes.push('ensemble-base-plan-blocked');
  }

  plan.reasonCodes = unique([...(plan.reasonCodes || []), ...reasonCodes]);
  if (!selected) {
    plan.ensemble = null;
    return contract;
  }

  const selectionReason = signals.explicitDisagreement
    ? 'ensemble-disagreement-deliverable'
    : signals.highStakes
      ? 'ensemble-high-stakes-comparable-output'
      : 'ensemble-high-uncertainty-comparable-output';

  plan.ensemble = {
    maxCandidates: ENSEMBLE_MAX_CANDIDATES,
    diversity: ['model', 'prompt', 'evidence'],
    synthesis: 'preserve-disagreement',
    verifier: 'independent',
    reasonCodes: unique([selectionReason, ...reasonCodes]),
  };
  plan.patterns = unique([...(plan.patterns || []), 'parallel-self-consistency']);
  plan.requiredInvariants = unique([
    ...(plan.requiredInvariants || []),
    'preserve-disagreement',
    'independent-ensemble-verifier',
  ]);
  plan.reasonCodes = unique([...(plan.reasonCodes || []), 'ensemble-review-selected']);
  return contract;
}

module.exports = {
  ENSEMBLE_MAX_CANDIDATES,
  applyEnsemblePolicy,
  detectEnsembleTaskSignals,
};

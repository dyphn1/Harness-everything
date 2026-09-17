#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  createDegradedRouterContract,
  validateRouterContract,
} = require('./router-contract');
const { applyEnsemblePolicy } = require('./ensemble-policy');

/**
 * Harness Kernel Router
 *
 * tier-router remains the human-readable classifier/guide detector. The
 * kernel consumes its versioned side-channel JSON contract instead of
 * scraping human-readable stdout. Phase 2 selects an execution topology, but
 * the router still only emits a plan: executors retain responsibility for
 * spawning agents, creating workspaces, running tools, and enforcing gates.
 * Phase 4 attaches ensemble-review only as a post-selection modifier.
 */

const INVARIANT_TEXT = {
  'scope-lock': 'Route before execution: stay inside the authorized task/repository scope.',
  'verify-before-claim': 'Verify before claim: completion claims require objective evidence appropriate to the change.',
  'replan-after-repeated-failure': 'Re-plan on repetition: after 3 same-signature failures, stop micro-retrying and zoom out/re-diagnose.',
  'evaluate-suggestions-before-skip': 'Evaluate before skip: read each suggested skill\'s complete SKILL.md entry/basic flow before omitting it.',
  'loop-budget': 'Stop iterative-single when its explicit iteration budget is exhausted.',
  'objective-verification': 'Use an objective check for iterative work; self-critique alone is not verification.',
  'stage-contracts': 'Fable stages must have explicit stage contracts and pass conditions.',
  'cold-verification': 'Fable delivery requires a cold/independent verifier where specified.',
  'parallel-scope-contract': 'Parallel work requires declared independent scopes and non-overlapping/read-only writes.',
  'synthesis-barrier': 'Do not claim parallel completion until all workstreams reach the synthesis barrier.',
  'handoff-contracts': 'Multi-agent workspace work uses orchestrator-owned handoff contracts; workers do not form a peer mesh.',
  'workspace-state': 'Durable workspace state remains scoped to the workspace and existing state conventions.',
  'pre-action-approval': 'Irreversible/external side effects require approval before the exact payload executes.',
  'preserve-disagreement': 'Ensemble synthesis must retain unresolved minority positions and evidence gaps.',
  'independent-ensemble-verifier': 'Ensemble delivery requires a verifier independent from the candidate identities; agreement alone is not proof.',
};

const SKILL_TEXT = {
  'tdd': 'tdd: useful for behavioral changes where executable tests can drive the implementation.',
  'verification-loop': 'verification-loop: useful for systematic build/lint/test/diff evidence before delivery.',
  'fable-mode': 'fable-mode / fable-discipline: useful for macro planning or deliberate multi-agent decomposition.',
  'fable-discipline': null,
  'multi-agent-workspace': 'multi-agent-workspace: useful when durable bounded delegation, handoffs, or workspace memory are required.',
};

function sanitizeClassifierOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const filtered = [];
  let skipLegacyContinuation = false;

  for (const line of lines) {
    if (line.includes('=> BASE EXECUTION LOOP:')) {
      skipLegacyContinuation = true;
      continue;
    }
    if (skipLegacyContinuation && line.includes('Track exactly ONE item in-progress')) {
      skipLegacyContinuation = false;
      continue;
    }
    skipLegacyContinuation = false;
    filtered.push(line);
  }

  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function readStructuredContract(contractPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const validation = validateRouterContract(parsed);
    if (!validation.valid) {
      return createDegradedRouterContract(
        'router-contract-invalid',
        `Structured router contract failed validation: ${validation.errors.join('; ')}`,
      );
    }
    return parsed;
  } catch (err) {
    return createDegradedRouterContract(
      'router-contract-unavailable',
      `Structured router contract unavailable: ${err.message}`,
    );
  }
}

function resolvePrompt(prompt, stdinPayload) {
  if (prompt) return prompt;
  if (!stdinPayload) return '';
  try {
    const payload = JSON.parse(stdinPayload);
    return typeof payload.prompt === 'string' ? payload.prompt : '';
  } catch (_) {
    return '';
  }
}

function printWorkflowPlan(plan) {
  const visible = {
    schemaVersion: plan.schemaVersion,
    routingStatus: plan.routingStatus,
    tier: plan.tier,
    strategy: plan.strategy,
    strategySelection: plan.strategySelection,
    actionGate: plan.actionGate,
    limits: plan.limits,
    parallelism: plan.parallelism,
    workspace: plan.workspace,
    memory: plan.memory,
    verification: plan.verification,
    ensemble: plan.ensemble,
    fallback: plan.fallback,
    reasonCodes: plan.reasonCodes,
  };
  console.log(`\n=> ROUTER WORKFLOW PLAN (JSON): ${JSON.stringify(visible)}`);
}

function uniqueSuggestedSkills(plan) {
  if (!Array.isArray(plan.suggestedSkills)) return [];
  return [...new Set(plan.suggestedSkills.filter(skill => typeof skill === 'string' && skill.trim()))];
}

function enforceSuggestionEvaluation(plan) {
  if (uniqueSuggestedSkills(plan).length === 0) return;
  if (!Array.isArray(plan.requiredInvariants)) plan.requiredInvariants = [];
  if (!plan.requiredInvariants.includes('evaluate-suggestions-before-skip')) {
    plan.requiredInvariants.push('evaluate-suggestions-before-skip');
  }
}

function displayTier(tier) {
  if (tier === 'tier1') return 'Tier 1';
  if (tier === 'tier2') return 'Tier 2';
  if (tier === 'tier3') return 'Tier 3';
  return tier || 'unclassified';
}

function printRoutingCheckpoint(plan) {
  const invariants = Array.isArray(plan.requiredInvariants) ? plan.requiredInvariants : [];
  const suggestions = uniqueSuggestedSkills(plan);

  console.log('\n=> HARNESS ROUTING CHECKPOINT (REQUIRED VISIBLE STATE):');
  console.log(`   - Tier: ${displayTier(plan.tier)}`);
  console.log(`   - Strategy: ${plan.strategy || 'deferred'}`);
  console.log(`   - Required invariants: ${invariants.length ? invariants.join(', ') : 'none'}`);
  console.log(`   - Suggested skills: ${suggestions.length ? suggestions.join(', ') : 'none'}`);
  if (suggestions.length > 0) {
    console.log('   - Suggestion evaluation: MANDATORY. Before skipping any listed skill, read its complete SKILL.md entry and evaluate USE FOR, DO NOT USE FOR, workflow/basic flow, and hard rules.');
    console.log('   - Skip evidence: do not reject from only the skill name, description, router summary, or a generic "routine/common task" judgement. If the entry cannot be resolved/read, mark it unresolved/unavailable rather than skipped.');
    console.log('   - Suggestion disposition: execution is advisory after evaluation. Using one suggestion does not waive read-before-skip for other omitted suggestions. If all are skipped after evaluation, state one brief reason grounded in the evaluated flows in the first visible progress/update message.');
  }
}

function printKernelContract(plan) {
  console.log('\n=> REQUIRED HARNESS INVARIANTS:');
  for (const invariant of plan.requiredInvariants || []) {
    console.log(`   - ${invariant}: ${INVARIANT_TEXT[invariant] || 'Required by the selected workflow plan.'}`);
  }

  console.log('\n=> SUGGESTED SKILLS (MANDATORY EVALUATION — ADVISORY EXECUTION):');
  if (Array.isArray(plan.suggestedSkills) && plan.suggestedSkills.length > 0) {
    const emitted = new Set();
    for (const skill of plan.suggestedSkills) {
      if (emitted.has(skill)) continue;
      const text = Object.prototype.hasOwnProperty.call(SKILL_TEXT, skill) ? SKILL_TEXT[skill] : `${skill}: advisory for the selected topology.`;
      if (text) console.log(`   - ${text}`);
      emitted.add(skill);
      if (skill === 'fable-mode') emitted.add('fable-discipline');
    }
    console.log('   - Read-before-skip: evaluate every suggested skill entry before omission; adopting one suggestion does not waive evaluation of the others.');
    if (plan.strategy && plan.strategy.startsWith('fable-')) {
      console.log('   - Use these selectively after evaluation; Tier 3/Fable does not create a universal skill pipeline.');
    }
  } else if (plan.strategy === 'direct-single') {
    console.log('   - No domain skill was suggested. Prefer the bounded direct path and load a focused skill only when it adds value.');
  } else if (plan.strategySelection === 'deferred') {
    console.log('   - Strategy is deferred/unclassified. Do not infer triviality; choose the smallest justified approach from task evidence.');
  } else {
    console.log('   - No additional skill suggestion from the workflow plan.');
  }

  if (plan.ensemble) {
    console.log(`\n=> ENSEMBLE REVIEW: bounded to ${plan.ensemble.maxCandidates} candidates; synthesis=${plan.ensemble.synthesis}; verifier=${plan.ensemble.verifier}. Preserve minority positions and do not claim improvement without paired evidence.`);
  }

  if (plan.actionGate && plan.actionGate.required) {
    console.log(`\n=> ACTION GATE REQUIRED: ${plan.actionGate.reasonCodes.join(', ')}; disposition=${plan.actionGate.disposition}. The router only declares this requirement; execution must not bypass approval.`);
  }

  if (plan.fallback && plan.fallback.disposition !== 'none') {
    console.log(`\n=> ROUTING FALLBACK: ${plan.fallback.disposition}/${plan.fallback.mode}; ${plan.fallback.reasonCodes.join(', ')}.`);
  }

  if (plan.routingStatus === 'degraded') {
    console.log('\n=> ROUTING DEGRADATION: Structured routing is degraded. Keep the strategy deferred unless independent evidence supports a route; do not silently downgrade to Tier 1/direct execution.');
  }

  console.log('\n=> ORCHESTRATION POLICY: Do not enforce workflow order. Enforce workflow invariants from the plan. Suggested-skill evaluation is mandatory; execution remains advisory after evaluation. The router plans; execution components execute.');
}

function run(prompt, stdinPayload) {
  const classifierPath = path.join(__dirname, 'tier-router.js');
  const contractPath = path.join(os.tmpdir(), `harness-router-${process.pid}-${crypto.randomUUID()}.json`);
  const args = prompt ? [classifierPath, prompt] : [classifierPath];
  const result = spawnSync(process.execPath, args, {
    input: prompt ? undefined : stdinPayload,
    encoding: 'utf8',
    env: {
      ...process.env,
      HARNESS_ROUTER_CONTRACT_PATH: contractPath,
    },
  });

  if (result.error) {
    console.error(`[Harness Kernel] Failed to execute tier-router.js: ${result.error.message}`);
    process.exit(1);
  }

  const sanitized = sanitizeClassifierOutput(result.stdout);
  if (sanitized) console.log(sanitized);
  if (result.stderr) process.stderr.write(result.stderr);

  const contract = readStructuredContract(contractPath);
  applyEnsemblePolicy(contract, resolvePrompt(prompt, stdinPayload));
  enforceSuggestionEvaluation(contract.workflowPlan);
  try {
    fs.rmSync(contractPath, { force: true });
  } catch (err) {
    // Temporary contract cleanup is best effort only.
  }

  printWorkflowPlan(contract.workflowPlan);
  printRoutingCheckpoint(contract.workflowPlan);
  printKernelContract(contract.workflowPlan);

  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

const prompt = process.argv.slice(2).join(' ');
if (prompt) {
  run(prompt, null);
} else if (process.stdin.isTTY) {
  run('', null);
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => run('', input));
}

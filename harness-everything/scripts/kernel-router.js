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

/**
 * Harness Kernel Router
 *
 * tier-router remains the human-readable classifier/guide detector. The
 * kernel consumes its versioned side-channel JSON contract instead of
 * scraping human-readable stdout. Phase 2 selects an execution topology, but
 * the router still only emits a plan: executors retain responsibility for
 * spawning agents, creating workspaces, running tools, and enforcing gates.
 */

const INVARIANT_TEXT = {
  'scope-lock': 'Stay inside the authorized task/repository scope.',
  'verify-before-claim': 'Completion claims require objective evidence appropriate to the change.',
  'replan-after-repeated-failure': 'After 3 same-signature failures, stop micro-retrying and zoom out/re-diagnose.',
  'loop-budget': 'Stop iterative-single when its explicit iteration budget is exhausted.',
  'objective-verification': 'Use an objective check for iterative work; self-critique alone is not verification.',
  'stage-contracts': 'Fable stages must have explicit stage contracts and pass conditions.',
  'cold-verification': 'Fable delivery requires a cold/independent verifier where specified.',
  'parallel-scope-contract': 'Parallel work requires declared independent scopes and non-overlapping/read-only writes.',
  'synthesis-barrier': 'Do not claim parallel completion until all workstreams reach the synthesis barrier.',
  'handoff-contracts': 'Multi-agent workspace work uses orchestrator-owned handoff contracts; workers do not form a peer mesh.',
  'workspace-state': 'Durable workspace state remains scoped to the workspace and existing state conventions.',
  'pre-action-approval': 'Irreversible/external side effects require approval before the exact payload executes.',
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
    fallback: plan.fallback,
    reasonCodes: plan.reasonCodes,
  };
  console.log(`\n=> ROUTER WORKFLOW PLAN (JSON): ${JSON.stringify(visible)}`);
}

function printKernelContract(plan) {
  console.log('\n=> REQUIRED HARNESS INVARIANTS:');
  for (const invariant of plan.requiredInvariants || []) {
    console.log(`   - ${invariant}: ${INVARIANT_TEXT[invariant] || 'Required by the selected workflow plan.'}`);
  }

  console.log('\n=> SUGGESTED SKILLS (ADVISORY — no fixed workflow order):');
  if (Array.isArray(plan.suggestedSkills) && plan.suggestedSkills.length > 0) {
    for (const skill of plan.suggestedSkills) console.log(`   - ${skill}`);
  } else if (plan.strategy === 'direct-single') {
    console.log('   - No mandatory domain skill. Prefer the bounded direct path and load a focused skill only when it adds value.');
  } else if (plan.strategySelection === 'deferred') {
    console.log('   - Strategy is deferred/unclassified. Do not infer triviality; choose the smallest justified approach from task evidence.');
  } else {
    console.log('   - No additional skill suggestion from the workflow plan.');
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

  console.log('\n=> ORCHESTRATION POLICY: Enforce the plan invariants, but do not turn suggested skills into a universal pipeline. The router plans; execution components execute.');
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
  try {
    fs.rmSync(contractPath, { force: true });
  } catch (err) {
    // Temporary contract cleanup is best effort only.
  }

  printWorkflowPlan(contract.workflowPlan);
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

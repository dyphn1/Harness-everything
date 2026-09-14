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
 * scraping human-readable stdout. The structured workflow plan is still a
 * shadow plan in Phase 1; execution behavior stays advisory/invariant-first.
 */

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

function printShadowPlan(plan) {
  const shadow = {
    schemaVersion: plan.schemaVersion,
    routingStatus: plan.routingStatus,
    tier: plan.tier,
    strategy: plan.strategy,
    strategySelection: plan.strategySelection,
    actionGate: plan.actionGate,
    limits: plan.limits,
    reasonCodes: plan.reasonCodes,
  };
  console.log(`\n=> ROUTER WORKFLOW PLAN (SHADOW JSON): ${JSON.stringify(shadow)}`);
}

function printKernelContract(plan) {
  console.log('\n=> REQUIRED HARNESS INVARIANTS:');
  console.log('   1. Route before execution: establish task scope/tier before mutating work.');
  console.log('   2. Verify before claim: completion claims require objective evidence appropriate to the change.');
  console.log('   3. Re-plan on repetition: after 3 same-signature failures, stop micro-retrying and zoom out/re-diagnose.');

  console.log('\n=> SUGGESTED SKILLS (ADVISORY — choose only what helps):');
  if (plan.tier === 'tier1') {
    console.log('   - No mandatory domain skill. Prefer direct execution; load a focused skill only when it adds value.');
  } else if (plan.tier === 'tier2') {
    console.log('   - todo-driven-workflow: useful when the task benefits from explicit multi-step progress tracking.');
    console.log('   - tdd: useful for behavioral changes where executable tests can drive the implementation.');
    console.log('   - verification-loop: useful for selecting the right build/lint/test/diff evidence before delivery.');
  } else if (plan.tier === 'tier3') {
    console.log('   - fable-mode / fable-discipline: useful for macro planning or deliberate multi-agent decomposition.');
    console.log('   - multi-agent-workspace: useful when bounded delegation materially improves the task.');
    console.log('   - todo-driven-workflow / tdd / verification-loop: use selectively when they fit the work.');
  } else {
    console.log('   - Routing is unclassified. Do not infer triviality; choose the smallest justified approach from the task itself.');
  }

  if (plan.routingStatus === 'degraded') {
    console.log('\n=> ROUTING DEGRADATION: Structured routing is degraded. Keep the task unclassified unless independent evidence supports a stronger classification; do not silently downgrade to Tier 1.');
  }

  console.log('\n=> ORCHESTRATION POLICY: Do not enforce workflow order. Enforce the invariants above, then let the agent choose the smallest useful skill/tool set.');
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

  printShadowPlan(contract.workflowPlan);
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

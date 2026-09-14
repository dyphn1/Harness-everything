#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tierRouter = path.join(ROOT, 'harness-everything', 'scripts', 'tier-router.js');
const { validateRouterContract } = require(path.join(ROOT, 'harness-everything', 'scripts', 'router-contract.js'));
let failed = 0;

function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function route(prompt) {
  const contractPath = path.join(os.tmpdir(), `harness-router-phase2-safety-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync(process.execPath, [tierRouter, prompt], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROUTER_CONTRACT_PATH: contractPath },
  });
  let contract = null;
  if (fs.existsSync(contractPath)) {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    fs.rmSync(contractPath, { force: true });
  }
  return { result, contract };
}

console.log('=== Router Phase 2 Explicit-Parallel Safety ===');

const unproven = route('Use fable-parallel to audit the entire repository architecture.');
check(unproven.result.status === 0, 'unproven explicit parallel request does not crash routing');
check(Boolean(unproven.contract), 'unproven explicit parallel request emits a contract');
if (unproven.contract) {
  const validation = validateRouterContract(unproven.contract);
  check(validation.valid, `serialized explicit request validates (${validation.errors.join('; ') || 'no errors'})`);
  check(unproven.contract.taskShape.explicitRequest.strategy === 'fable-parallel', 'original explicit fable-parallel request remains recorded');
  check(unproven.contract.workflowPlan.strategy === 'fable-staged', 'unproven parallel request serializes to fable-staged');
  check(unproven.contract.workflowPlan.fallback.disposition === 'reduced', 'unproven parallel request exposes reduced fallback');
  check(unproven.contract.workflowPlan.fallback.mode === 'serialized', 'unproven parallel request exposes serialized fallback mode');
  check(unproven.contract.workflowPlan.fallback.reasonCodes.includes('parallel-preconditions-unproven'), 'unproven parallel request records precondition reason');
}

const overlap = route('Use fable-parallel with independent agents editing the same file across the entire repository.');
check(overlap.result.status === 0, 'overlapping explicit parallel request does not crash routing');
check(Boolean(overlap.contract), 'overlapping explicit parallel request emits a contract');
if (overlap.contract) {
  check(overlap.contract.taskShape.writeSetOverlap === 'overlap', 'overlap evidence is machine-visible');
  check(overlap.contract.workflowPlan.strategy === 'fable-staged', 'explicit parallel overlap serializes to staged');
  check(overlap.contract.workflowPlan.fallback.reasonCodes.includes('parallel-write-set-overlap'), 'overlap serialization has a deterministic reason');
}

const safe = route('Use fable-parallel for independent read-only security and architecture audits across the entire repository.');
check(safe.result.status === 0, 'validated explicit parallel request routes successfully');
check(Boolean(safe.contract), 'validated explicit parallel request emits a contract');
if (safe.contract) {
  const validation = validateRouterContract(safe.contract);
  check(validation.valid, `validated explicit parallel contract passes (${validation.errors.join('; ') || 'no errors'})`);
  check(safe.contract.workflowPlan.strategy === 'fable-parallel', 'validated explicit parallel request keeps fable-parallel');
  check(safe.contract.workflowPlan.parallelism.allowed === true, 'validated explicit parallel request enables parallelism');
  check(safe.contract.workflowPlan.fallback.disposition === 'none', 'validated explicit parallel request needs no fallback');
}

const contradiction = route('Use fable-parallel to audit the entire repository, but do not use parallel execution.');
check(contradiction.result.status === 0, 'contradictory explicit request remains representable');
check(Boolean(contradiction.contract), 'contradictory explicit request emits a contract');
if (contradiction.contract) {
  const validation = validateRouterContract(contradiction.contract);
  check(validation.valid, `blocked contradiction is still a valid audit contract (${validation.errors.join('; ') || 'no errors'})`);
  check(contradiction.contract.workflowPlan.fallback.disposition === 'blocked', 'explicit strategy/prohibition conflict is blocked');
  check(contradiction.contract.workflowPlan.fallback.reasonCodes.includes('explicit-request-conflicts-with-prohibition'), 'explicit contradiction records its reason');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: router phase 2 explicit-parallel safety (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

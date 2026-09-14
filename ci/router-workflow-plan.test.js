#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tierRouter = path.join(ROOT, 'harness-everything', 'scripts', 'tier-router.js');
const kernelRouter = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');
const { validateRouterContract } = require(path.join(ROOT, 'harness-everything', 'scripts', 'router-contract.js'));
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function runTier(prompt, extraEnv = {}) {
  const contractPath = path.join(os.tmpdir(), `harness-router-test-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync(process.execPath, [tierRouter, prompt], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      HARNESS_ROUTER_CONTRACT_PATH: contractPath,
    },
  });

  let contract = null;
  if (fs.existsSync(contractPath)) {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    fs.rmSync(contractPath, { force: true });
  }
  return { result, contract };
}

console.log('=== Router Workflow Plan Contract ===');

const standard = runTier('add a login endpoint with tests and update the implementation');
check(standard.result.status === 0, 'tier router exits successfully for a standard task');
check(Boolean(standard.contract), 'tier router writes a structured side-channel contract');
if (standard.contract) {
  const validation = validateRouterContract(standard.contract);
  check(validation.valid, `structured contract validates (${validation.errors.join('; ') || 'no errors'})`);
  check(standard.contract.workflowPlan.tier === 'tier2', 'standard task is represented as tier2 in the structured plan');
  check(standard.contract.workflowPlan.strategy === null, 'Phase 1 shadow plan does not prematurely select an execution strategy');
  check(standard.contract.workflowPlan.strategySelection === 'shadow', 'strategy selection is explicitly marked shadow');
  check(standard.contract.workflowPlan.actionGate.required === false, 'Phase 1 carries the actionGate field without enforcing Phase 2 policy');
  check(Object.prototype.hasOwnProperty.call(standard.contract.workflowPlan.limits, 'maxIterations'), 'workflow plan carries explicit loop-budget field');
  check(standard.contract.workflowPlan.limits.maxWorkers === 'fable-orchestrator-cap', 'worker cap has a single-source-of-truth marker');
}

const unknown = runTier('frobnicate the quux');
check(unknown.result.status === 0, 'unmatched prompt still routes successfully');
check(Boolean(unknown.contract), 'unmatched prompt still emits a contract');
if (unknown.contract) {
  check(unknown.contract.classification.tier === 'unclassified', 'no matched signal yields unclassified rather than Tier 1');
  check(unknown.contract.classification.reasonCodes.includes('no-classification-signal'), 'unclassified result has deterministic reason code');
}

const explicitFable = runTier('fable on opus audit the entire repository architecture');
if (explicitFable.contract) {
  check(explicitFable.contract.workflowPlan.modelSelection.requested === 'opus', 'explicit Fable model request survives into the structured plan');
  check(explicitFable.result.stdout.includes('REQUESTED FABLE MODEL MODE: opus'), 'legacy human-readable Fable route remains present');
}

const repeatA = runTier('add a login endpoint with tests and update the implementation');
const repeatB = runTier('add a login endpoint with tests and update the implementation');
if (repeatA.contract && repeatB.contract) {
  check(JSON.stringify(repeatA.contract) === JSON.stringify(repeatB.contract), 'same normalized input produces byte-equivalent structured contracts');
}

const invalidConfigPath = path.join(os.tmpdir(), `harness-invalid-routing-${process.pid}.json`);
fs.writeFileSync(invalidConfigPath, '{ invalid json', 'utf8');
const degraded = runTier('frobnicate the quux', { HARNESS_ROUTING_CONFIG_PATH: invalidConfigPath });
fs.rmSync(invalidConfigPath, { force: true });
check(degraded.result.status === 0, 'invalid routing config degrades without crashing the hook');
if (degraded.contract) {
  check(degraded.contract.routingStatus === 'degraded', 'invalid routing config emits routingStatus=degraded');
  check(degraded.contract.classification.tier === 'unclassified', 'invalid routing config never silently becomes Tier 1');
  check(degraded.contract.classification.reasonCodes.includes('routing-config-invalid'), 'degraded route records routing-config-invalid reason');
}

const kernelUnknown = spawnSync(process.execPath, [kernelRouter, 'frobnicate the quux'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(kernelUnknown.status === 0, 'kernel consumes structured contract successfully');
check(kernelUnknown.stdout.includes('ROUTER WORKFLOW PLAN (SHADOW JSON)'), 'kernel emits the shadow-plan checkpoint');
check(kernelUnknown.stdout.includes('"tier":"unclassified"'), 'kernel uses structured unclassified tier');
check(!/RECOMMENDED TIER:\s*Tier 1/i.test(kernelUnknown.stdout), 'kernel does not expose a silent Tier 1 fallback for unmatched prompts');

for (const schemaPath of [
  'harness-everything/schemas/router-task-shape.schema.json',
  'harness-everything/schemas/router-workflow-plan.schema.json',
]) {
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, schemaPath), 'utf8'));
    assert.strictEqual(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    check(true, `${schemaPath} is valid JSON Schema metadata`);
  } catch (err) {
    check(false, `${schemaPath} parses: ${err.message}`);
  }
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: router workflow plan contract (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

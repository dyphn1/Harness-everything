#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tierRouter = path.join(ROOT, 'harness-everything', 'scripts', 'tier-router.js');
const kernelRouter = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');
const {
  ITERATIVE_MAX_ITERATIONS,
  WORKFLOW_MAX_REVISION_ROUNDS,
  FABLE_MAX_REPLANS,
  FABLE_MAX_WORKERS,
  validateRouterContract,
} = require(path.join(ROOT, 'harness-everything', 'scripts', 'router-contract.js'));
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function runTier(prompt, options = {}) {
  const contractPath = path.join(os.tmpdir(), `harness-router-test-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const context = options.context || null;
  const args = context ? [tierRouter] : [tierRouter, prompt];
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    input: context ? JSON.stringify({ ...context, prompt }) : undefined,
    env: {
      ...process.env,
      ...(options.env || {}),
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

function validContract(run, label) {
  check(run.result.status === 0, `${label}: tier router exits successfully`);
  check(Boolean(run.contract), `${label}: structured contract exists`);
  if (!run.contract) return false;
  const validation = validateRouterContract(run.contract);
  check(validation.valid, `${label}: contract validates (${validation.errors.join('; ') || 'no errors'})`);
  return validation.valid;
}

console.log('=== Router Workflow Plan Contract — Phase 2 ===');

const direct = runTier('Update one README typo');
if (validContract(direct, 'direct-single')) {
  const plan = direct.contract.workflowPlan;
  check(plan.tier === 'tier1', 'one-file trivial task remains tier1');
  check(plan.strategy === 'direct-single', 'one-file trivial task selects direct-single');
  check(plan.strategySelection === 'selected', 'direct-single is a selected strategy');
  check(plan.workspace.required === false, 'direct-single does not require a workspace');
  check(plan.parallelism.allowed === false, 'direct-single does not parallelize');
}

const iterative = runTier('Fix this checkout bug and add a regression test.');
if (validContract(iterative, 'iterative-single')) {
  const plan = iterative.contract.workflowPlan;
  check(plan.tier === 'tier2', 'ordinary test-first bug fix is tier2');
  check(plan.strategy === 'iterative-single', 'ordinary bug fix selects iterative-single');
  check(plan.limits.maxIterations === ITERATIVE_MAX_ITERATIONS, 'iterative-single retains an advisory iteration guidance value');
  check(plan.limits.maxRevisionRounds === WORKFLOW_MAX_REVISION_ROUNDS, 'workflow exposes an advisory revision guidance value');
  check(plan.limits.maxReplans === FABLE_MAX_REPLANS, 'workflow exposes an advisory replan guidance value');
  check(plan.limits.maxWorkers === FABLE_MAX_WORKERS, 'workflow exposes an advisory worker guidance value');
  check(plan.requiredInvariants.includes('objective-verification'), 'iterative-single carries objective verification invariant');
  check(plan.requiredInvariants.includes('loop-awareness'), 'iterative-single carries loop-awareness guidance');
  check(plan.suggestedSkills.includes('tdd'), 'TDD stays advisory rather than an invariant');
  check(plan.memory.write === 'none', 'ordinary iterative work cannot write durable memory');
  check(!plan.requiredInvariants.includes('tdd'), 'suggested skills are separated from mandatory invariants');
}

const memoryPersist = runTier('Persist this lesson as memory after resolving the checkout regression.');
if (validContract(memoryPersist, 'self-evolve persistence')) {
  const plan = memoryPersist.contract.workflowPlan;
  check(plan.strategy === 'direct-single', 'bounded explicit persistence request receives a selected workflow');
  check(plan.memory.write === 'persist-via-self-evolve', 'explicit persistence request authorizes only self-evolve durable write');
  check(plan.requiredInvariants.includes('memory-write-authorization'), 'durable memory route carries runtime authorization invariant');
  check(plan.suggestedSkills.includes('self-evolve'), 'durable memory route suggests self-evolve explicitly');
  check(memoryPersist.contract.taskShape.observedSignals.memoryPersistenceRequested === true, 'persistence intent is recorded in task shape');
}

const memoryProhibited = runTier('Persist this lesson as memory. Do not use memory.');
if (validContract(memoryProhibited, 'memory prohibition')) {
  check(memoryProhibited.contract.workflowPlan.memory.write === 'none', 'explicit memory prohibition overrides persistence intent');
  check(memoryProhibited.contract.workflowPlan.reasonCodes.includes('memory-persistence-prohibited'), 'memory prohibition conflict is auditable');
}

const staged = runTier('Refactor the entire authentication architecture in dependent stages.');
if (validContract(staged, 'fable-staged')) {
  const plan = staged.contract.workflowPlan;
  check(plan.tier === 'tier3', 'multi-stage architecture work is tier3');
  check(plan.strategy === 'fable-staged', 'dependent multi-stage work selects fable-staged');
  check(plan.parallelism.allowed === false, 'dependent stages remain sequential');
  check(plan.verification.mode === 'cold-verifier', 'fable-staged requires cold verification');
}

const parallelPrompt = 'Audit the entire repository with independent read-only security, architecture, and documentation workstreams.';
const parallel = runTier(parallelPrompt);
if (validContract(parallel, 'fable-parallel')) {
  const shape = parallel.contract.taskShape;
  const plan = parallel.contract.workflowPlan;
  check(shape.dependencyGraph === 'independent', 'parallel task records independent dependency graph');
  check(shape.writeSetOverlap === 'read-only', 'parallel audit records read-only write set');
  check(plan.strategy === 'fable-parallel', 'independent read-only audits select fable-parallel');
  check(plan.parallelism.allowed === true, 'fable-parallel exposes allowed=true');
  check(plan.requiredInvariants.includes('synthesis-barrier'), 'parallel strategy requires synthesis barrier');
}

const sharedWrite = runTier('Audit the entire repository with independent agents in parallel editing the same file.');
if (validContract(sharedWrite, 'shared-write serialization')) {
  check(sharedWrite.contract.taskShape.writeSetOverlap === 'overlap', 'same-file writers are recorded as overlapping');
  check(sharedWrite.contract.workflowPlan.strategy === 'fable-staged', 'same-file writers are serialized instead of fable-parallel');
  check(sharedWrite.contract.workflowPlan.parallelism.allowed === false, 'overlapping writes cannot dispatch in parallel');
}

const workspace = runTier('Audit the entire repository as a durable multi-session effort with reusable specialists across security and architecture.');
if (validContract(workspace, 'multi-agent workspace')) {
  const plan = workspace.contract.workflowPlan;
  check(plan.strategy === 'fable-multi-agent-workspace', 'durable reusable specialists select workspace topology');
  check(plan.workspace.required === true, 'workspace topology marks workspace required');
  check(plan.memory.read === 'workspace-index', 'workspace topology scopes reads through workspace index');
  check(plan.memory.write === 'propose', 'workspace memory writes remain proposals');
}

const unknown = runTier('frobnicate the quux');
if (validContract(unknown, 'unclassified')) {
  check(unknown.contract.classification.tier === 'unclassified', 'no matched signal remains unclassified');
  check(unknown.contract.workflowPlan.strategy === null, 'unclassified does not silently select direct-single');
  check(unknown.contract.workflowPlan.strategySelection === 'deferred', 'unclassified strategy selection is deferred');
  check(unknown.contract.workflowPlan.reasonCodes.includes('unclassified-strategy-deferred'), 'deferred selection has deterministic reason code');
}

const destructive = runTier('Drop the prod database table and force push to main.');
if (validContract(destructive, 'actionGate')) {
  const gate = destructive.contract.workflowPlan.actionGate;
  check(gate.required === true, 'irreversible command intent requires actionGate independent of tier');
  check(gate.reasonCodes.includes('irreversible-action'), 'actionGate records irreversible-action');
  check(gate.disposition === 'pending-approval', 'actionGate closes at pending approval before execution');
  check(destructive.contract.workflowPlan.requiredInvariants.includes('pre-action-approval'), 'actionGate adds pre-action invariant');
}

const external = runTier('Deploy to production and publish the package release.');
if (validContract(external, 'external side effect')) {
  check(external.contract.workflowPlan.actionGate.required === true, 'external side effect requires actionGate');
  check(external.contract.workflowPlan.actionGate.reasonCodes.includes('external-side-effect'), 'external side effect reason is explicit');
}

const fableTypo = runTier('fix typo in the fable-mode readme');
if (validContract(fableTypo, 'fable keyword trivial edit')) {
  check(fableTypo.contract.classification.tier === 'tier1', 'fable keyword does not force Tier 3 on a trivial README typo');
  check(fableTypo.contract.workflowPlan.strategy === 'direct-single', 'fable README typo remains direct-single');
}

const explicitFable = runTier('fable on opus audit the entire repository architecture');
if (validContract(explicitFable, 'explicit Fable model')) {
  check(explicitFable.contract.workflowPlan.strategy === 'fable-staged', 'explicit Fable request selects Fable topology');
  check(explicitFable.contract.workflowPlan.modelSelection.requested === 'opus', 'explicit Fable model stays delegated to model selector');
  check(explicitFable.result.stdout.includes('REQUESTED FABLE MODEL MODE: opus'), 'legacy explicit Fable route remains visible');
}

const explicitOverride = runTier('Use iterative-single to audit the entire repository architecture.');
if (validContract(explicitOverride, 'explicit strategy override')) {
  check(explicitOverride.contract.workflowPlan.strategy === 'iterative-single', 'explicit user strategy overrides derived Tier 3 topology');
  check(explicitOverride.contract.workflowPlan.reasonCodes.includes('explicit-strategy-request'), 'explicit strategy override is recorded');
}

const prohibitedParallel = runTier(`${parallelPrompt} Do not use parallel execution.`);
if (validContract(prohibitedParallel, 'parallel prohibition')) {
  check(prohibitedParallel.contract.workflowPlan.strategy === 'fable-staged', 'explicit no-parallel prohibition serializes derived parallel work');
  check(prohibitedParallel.contract.workflowPlan.fallback.disposition === 'reduced', 'parallel prohibition is a visible reduced fallback');
  check(prohibitedParallel.contract.workflowPlan.fallback.reasonCodes.includes('user-prohibited-parallelism'), 'parallel prohibition reason is recorded');
}

const noParallelCapability = runTier(parallelPrompt, {
  context: { hostCapabilities: { parallelCalls: 'unavailable', subagents: 'available' } },
});
if (validContract(noParallelCapability, 'parallel capability fallback')) {
  check(noParallelCapability.contract.workflowPlan.strategy === 'fable-staged', 'missing parallel capability serializes to fable-staged');
  check(noParallelCapability.contract.workflowPlan.fallback.mode === 'serialized', 'parallel capability fallback is visibly serialized');
  check(noParallelCapability.contract.workflowPlan.fallback.reasonCodes.includes('parallel-capability-unavailable'), 'missing parallel capability reason is recorded');
}

const concurrencyOne = runTier(parallelPrompt, {
  context: { constraints: { concurrency: 1 }, hostCapabilities: { parallelCalls: 'available', subagents: 'available' } },
});
if (validContract(concurrencyOne, 'concurrency budget fallback')) {
  check(concurrencyOne.contract.workflowPlan.strategy === 'fable-staged', 'concurrency=1 serializes fable-parallel');
  check(concurrencyOne.contract.workflowPlan.fallback.reasonCodes.includes('concurrency-budget-serializes'), 'concurrency budget reason is recorded');
}

const noWorkspaceState = runTier('Audit the entire repository as a durable multi-session effort with reusable specialists across security and architecture.', {
  context: { hostCapabilities: { state: 'unavailable', subagents: 'available' } },
});
if (validContract(noWorkspaceState, 'workspace state block')) {
  check(noWorkspaceState.contract.workflowPlan.strategy === 'fable-multi-agent-workspace', 'workspace requirement remains explicit when state is unavailable');
  check(noWorkspaceState.contract.workflowPlan.fallback.disposition === 'blocked', 'missing durable state blocks rather than silently downgrades');
  check(noWorkspaceState.contract.workflowPlan.fallback.reasonCodes.includes('workspace-state-unavailable'), 'workspace block reason is recorded');
}

const unavailableModel = runTier('fable on opus audit the entire repository architecture', {
  context: { hostCapabilities: { modelAvailability: 'unavailable', subagents: 'available' } },
});
if (validContract(unavailableModel, 'model capability block')) {
  check(unavailableModel.contract.workflowPlan.modelSelection.requested === 'opus', 'router never remaps requested branded model');
  check(unavailableModel.contract.workflowPlan.fallback.disposition === 'blocked', 'known unavailable model is visibly blocked');
  check(unavailableModel.contract.workflowPlan.fallback.reasonCodes.includes('requested-model-capability-unavailable'), 'model capability block reason is recorded');
}

const hookUnavailable = runTier('Drop the prod database table.', {
  context: { hostCapabilities: { hooks: 'unavailable' } },
});
if (validContract(hookUnavailable, 'actionGate capability block')) {
  check(hookUnavailable.contract.workflowPlan.actionGate.required === true, 'actionGate requirement survives missing hook capability');
  check(hookUnavailable.contract.workflowPlan.fallback.disposition === 'blocked', 'known missing action-gate hook blocks side effect');
  check(hookUnavailable.contract.workflowPlan.fallback.reasonCodes.includes('action-gate-hook-unavailable'), 'missing hook capability is visible');
}

const guideDedup = runTier('security audit login authentication');
const securityGuideCount = (guideDedup.result.stdout.match(/security-review\/SKILL\.md/g) || []).length;
check(securityGuideCount === 1, 'duplicate guide matches emit security-review/SKILL.md exactly once by path');

const repeatA = runTier('Fix this checkout bug and add a regression test.');
const repeatB = runTier('Fix this checkout bug and add a regression test.');
if (repeatA.contract && repeatB.contract) {
  check(JSON.stringify(repeatA.contract) === JSON.stringify(repeatB.contract), 'same normalized input produces byte-equivalent structured contracts');
}

const invalidConfigPath = path.join(os.tmpdir(), `harness-invalid-routing-${process.pid}.json`);
fs.writeFileSync(invalidConfigPath, '{ invalid json', 'utf8');
const degraded = runTier('frobnicate the quux', { env: { HARNESS_ROUTING_CONFIG_PATH: invalidConfigPath } });
fs.rmSync(invalidConfigPath, { force: true });
if (validContract(degraded, 'degraded routing')) {
  check(degraded.contract.routingStatus === 'degraded', 'invalid routing config emits routingStatus=degraded');
  check(degraded.contract.classification.tier === 'unclassified', 'invalid routing config never silently becomes Tier 1');
  check(degraded.contract.workflowPlan.strategy === null, 'degraded routing does not select a strategy');
  check(degraded.contract.workflowPlan.reasonCodes.includes('routing-degraded-strategy-deferred'), 'degraded strategy deferral is explicit');
}

const kernelUnknown = spawnSync(process.execPath, [kernelRouter, 'frobnicate the quux'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(kernelUnknown.status === 0, 'kernel consumes selected/deferred structured contract successfully');
check(kernelUnknown.stdout.includes('ROUTER WORKFLOW PLAN (JSON)'), 'kernel emits the Phase 2 workflow-plan checkpoint');
check(kernelUnknown.stdout.includes('"strategySelection":"deferred"'), 'kernel exposes deferred unclassified selection');
check(!/RECOMMENDED TIER:\s*Tier 1/i.test(kernelUnknown.stdout), 'kernel does not expose a silent Tier 1 fallback for unmatched prompts');

const notificationStateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-router-notification-fail-open-'));
const notificationStateFile = path.join(notificationStateHome, 'not-a-directory');
fs.writeFileSync(notificationStateFile, 'x', 'utf8');
const kernelNotificationPersistFailure = spawnSync(process.execPath, [kernelRouter], {
  cwd: ROOT,
  encoding: 'utf8',
  input: JSON.stringify({
    session_id: 'router-host-notification-fail-open',
    cwd: ROOT,
    hook_event_name: 'UserPromptSubmit',
    prompt: '<task-notification><task-id>background-1</task-id><status>completed</status></task-notification>',
  }),
  env: { ...process.env, HARNESS_STATE_HOME: notificationStateFile, HARNESS_WORKSPACE_ROOT: ROOT },
});
check(kernelNotificationPersistFailure.status === 0, 'host notification persistence failure stays fail-open');
check(kernelNotificationPersistFailure.stdout.includes('Host notification — no active execution contract; ignored for routing.'), 'host notification remains a routing no-op when state persistence fails');
check(kernelNotificationPersistFailure.stderr.includes('routing state was not persisted'), 'host notification persistence failure remains visible as a reminder');
fs.rmSync(notificationStateHome, { recursive: true, force: true });

const kernelIterative = spawnSync(process.execPath, [kernelRouter, 'Fix this checkout bug and add a regression test.'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(kernelIterative.stdout.includes('"strategy":"iterative-single"'), 'kernel consumes strategy from structured plan');
check(kernelIterative.stdout.includes('loop-awareness:'), 'kernel prints dynamic plan guidance');
check(kernelIterative.stdout.includes('   - tdd'), 'kernel prints advisory skills separately');

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

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: router workflow plan phase 2 (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);

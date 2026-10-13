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
const { splitProfileLookupClauses } = require(tierRouter);
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
  check(plan.requiredInvariants.includes('visible-status-updates'), 'every selected workflow carries the user-visible status invariant');
  check(plan.requiredInvariants.includes('environment-alignment'), 'every selected workflow carries conditional environment-alignment MUST');
  check(plan.workspace.required === false, 'direct-single does not require a workspace');
  check(plan.parallelism.allowed === false, 'direct-single does not parallelize');
}

const iterative = runTier('Fix this checkout bug and add a regression test.');
if (validContract(iterative, 'iterative-single')) {
  const plan = iterative.contract.workflowPlan;
  check(plan.tier === 'tier2', 'ordinary test-first bug fix is tier2');
  check(plan.strategy === 'iterative-single', 'ordinary bug fix selects iterative-single');
  check(plan.limits.maxIterations === ITERATIVE_MAX_ITERATIONS, 'iterative-single retains a MAY iteration planning value');
  check(plan.limits.maxRevisionRounds === WORKFLOW_MAX_REVISION_ROUNDS, 'workflow exposes a MAY revision planning value');
  check(plan.limits.maxReplans === FABLE_MAX_REPLANS, 'workflow exposes a MAY replan planning value');
  check(plan.limits.maxWorkers === FABLE_MAX_WORKERS, 'workflow exposes a MAY worker planning value');
  check(plan.requiredInvariants.includes('objective-verification'), 'iterative-single carries objective verification invariant');
  check(plan.requiredInvariants.includes('loop-awareness'), 'iterative-single carries semantic loop-awareness obligation while numeric counts remain MAY');
  check(plan.knowledgeSignals.includes('tdd-test'), 'test-related keywords become normalized step input signals');
  check(plan.suggestedSkills.length === 0, 'selected topology no longer pushes a global skill list');
  check(!plan.knowledgeSignals.some(signal => signal.includes('/') || signal.endsWith('.md')), 'knowledge signals do not directly select documents');
  check(plan.memory.write === 'none', 'ordinary iterative work cannot write durable memory');
  check(!plan.requiredInvariants.includes('tdd'), 'binding ids remain step-local rather than workflow invariants');
}

const memoryPersist = runTier('Persist this lesson as memory after resolving the checkout regression.');
if (validContract(memoryPersist, 'self-evolve persistence')) {
  const plan = memoryPersist.contract.workflowPlan;
  check(plan.strategy === 'direct-single', 'bounded explicit persistence request receives a selected workflow');
  check(plan.memory.write === 'persist-via-self-evolve', 'explicit persistence request authorizes only self-evolve durable write');
  check(plan.requiredInvariants.includes('memory-write-authorization'), 'durable memory route carries runtime authorization invariant');
  check(plan.suggestedSkills.length === 0, 'memory authorization does not add a global self-evolve suggestion');
  check(memoryPersist.contract.taskShape.observedSignals.memoryPersistenceRequested === true, 'persistence intent is recorded in task shape');
}

const memoryProhibited = runTier('Persist this lesson as memory. Do not use memory.');
if (validContract(memoryProhibited, 'memory prohibition')) {
  check(memoryProhibited.contract.workflowPlan.memory.write === 'none', 'explicit memory prohibition overrides persistence intent');
  check(memoryProhibited.contract.workflowPlan.reasonCodes.includes('memory-persistence-prohibited'), 'memory prohibition conflict is auditable');
}

const boundedOperationPrompts = [
  'Audit this SKILL.md only.',
  'Compare these two functions.',
  'Benchmark this parser function.',
];
for (const prompt of boundedOperationPrompts) {
  const boundedOperation = runTier(prompt);
  if (validContract(boundedOperation, `bounded operation: ${prompt}`)) {
    check(boundedOperation.contract.classification.tier !== 'tier3', `bounded operation verb does not force Tier 3: ${prompt}`);
    check(!boundedOperation.contract.workflowPlan.reasonCodes.includes('macro-scope-signal'), `bounded operation verb does not emit macro-scope-signal: ${prompt}`);
    check(boundedOperation.contract.taskShape.observedSignals.macroScope === false, `bounded operation records macroScope=false: ${prompt}`);
  }
}

const controlledAb = runTier('Run a controlled A/B benchmark of the agent with and without the Harness skills and report confidence intervals');
if (validContract(controlledAb, 'controlled A/B benchmark')) {
  check(controlledAb.contract.classification.tier === 'tier3', 'structured A/B benchmark remains Tier 3');
  check(controlledAb.contract.taskShape.observedSignals.macroScope === true, 'structured A/B benchmark records macroScope=true');
  check(controlledAb.contract.workflowPlan.reasonCodes.includes('macro-scope-signal'), 'structured A/B benchmark keeps macro-scope-signal');
}

const tier3Keyword = runTier('Create a new feature');
if (validContract(tier3Keyword, 'Tier 3 keyword rationale')) {
  check(tier3Keyword.contract.classification.tier === 'tier3', 'new feature remains Tier 3');
  check(tier3Keyword.contract.workflowPlan.reasonCodes.includes('tier3-keyword'), 'new feature records tier3-keyword');
  check(/Tier 3 keyword/i.test(tier3Keyword.contract.classification.rationale), 'Tier 3 keyword rationale names the actual trigger class');
  check(!/repository-wide scope|structured comparative experiment/i.test(tier3Keyword.contract.classification.rationale), 'Tier 3 keyword rationale does not claim unrelated macro signals');
}

const staged = runTier('Refactor the entire authentication architecture in dependent stages.');
if (validContract(staged, 'fable-staged')) {
  const plan = staged.contract.workflowPlan;
  check(plan.tier === 'tier3', 'multi-stage architecture work is tier3');
  check(plan.strategy === 'fable-staged', 'dependent multi-stage work selects fable-staged');
  check(plan.parallelism.allowed === false, 'dependent stages remain sequential');
  check(plan.verification.mode === 'cold-verifier', 'fable-staged requires cold verification');
  check(plan.requiredInvariants.includes('isolated-worktree-before-mutation'), 'fable-staged carries mandatory isolation disposition');
  check(plan.requiredInvariants.includes('isolated-worktree-before-mutation'), 'fable-staged keeps its worktree isolation invariant');
  check(plan.suggestedSkills.length === 0, 'fable topology does not globally push worktree/fable skills');
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
if (validContract(explicitFable, 'explicit Fable profile')) {
  check(explicitFable.contract.workflowPlan.strategy === 'fable-staged', 'explicit Fable request selects Fable topology');
  check(explicitFable.contract.workflowPlan.profileSelection.requested === 'orchestrator', 'legacy opus alias normalizes to orchestrator profile');
  check(explicitFable.contract.workflowPlan.profileSelection.alias === 'opus', 'legacy alias remains auditable');
  check(explicitFable.result.stdout.includes('REQUESTED FABLE PROFILE: opus'), 'explicit Fable profile remains visible');
}

const explicitSonnect = runTier('fable on sonnect for architecture synthesis');
if (validContract(explicitSonnect, 'explicit Fable sonnect alias')) {
  check(explicitSonnect.contract.workflowPlan.profileSelection.requested === 'reasoning', 'sonnect normalizes to reasoning profile');
  check(explicitSonnect.contract.workflowPlan.profileSelection.alias === 'sonnect', 'raw sonnect alias remains auditable end-to-end');
  check(explicitSonnect.result.stdout.includes('REQUESTED FABLE PROFILE: sonnect'), 'router output preserves raw sonnect alias');
}

// #290: mentioning a profile in a bounded lookup must not launch orchestration.
for (const prompt of [
  'Could you please explain fable on sonnet? Return only JSON.',
  'Please, explain fable on sonnet; return only JSON.',
  'What is fable on opus? Return only JSON.',
  'Explain what fable on sonnet means.Return only JSON.',
  'Could you please explain fable on sonnet as a compact JSON record.',
  '說明 fable on sonnet，不必啟動任何流程，請只輸出 JSON。',
  '解釋 fable on opus，無須進入任何階段，請回傳 JSON。',
  "Explain what 'fable on sonnect' means; return only a small JSON selection record.",
  "Resolve fable on haiku into a profile JSON record; no orchestration or delegation.",
  "解釋 fable on opus 的意思，只回傳 JSON。",
  "Explain what 'run fable on sonnect' means; return only JSON.",
  'Explain fable on sonnet; return JSON with requestedProfile, effectiveProfile.',
  "Explain what 'fable on sonnect' means; return only a small JSON selection record with requestedProfile, effectiveProfile, profileAlias, assignedRole, runtimeModel, runtimeEffort. No orchestration or delegation.",
  'Explain fable on haiku; output JSON with `requestedProfile`, `runtimeModel` and `runtimeEffort`.',
  '解釋 fable on opus 的意思，只回傳 JSON，包含 requestedProfile、effectiveProfile、runtimeEffort。',
  "Explain what 'use fable on opus' means; no execution or model switching.",
  'Explain fable on sonnet; return JSON; no stages, delegation or execution.',
  '請說明 fable on sonnet 的意思，並只回傳含 requestedProfile 的 JSON。',
  'Explain fable on sonnet, please return JSON.',
  'Explain fable on sonnet and please return only JSON.',
  '請說明 fable on sonnet，請只回傳 JSON。',
  'Explain what “run fable on sonnect” means; return only JSON.',
  'Explain what ‘use fable on opus’ means.',
  'Explain fable on sonnet; no model switching.',
  "Explain fable on sonnet; don't switch model or delegate.",
  'Explain fable on sonnet; no stages and no delegation.',
  '解釋 fable on sonnet，不要委派或切換模型。',
]) {
  const lookup = runTier(prompt);
  const repeat = runTier(prompt);
  if (validContract(lookup, 'bounded Fable lookup')) {
    check(lookup.contract.classification.tier === 'tier1', `${prompt}: lookup remains a bounded Tier 1 operation`);
    check(lookup.contract.workflowPlan.strategy === 'direct-single', `${prompt}: lookup selects direct-single before loading references`);
    check(lookup.contract.workflowPlan.parallelism.allowed === false, 'lookup does not delegate');
    check(lookup.result.stdout.includes('references/profile-lookup.md'), `${prompt}: lookup selects only compact reference`);
    check(!lookup.result.stdout.includes('RECOMMENDED KNOWLEDGE GUIDES'), `${prompt}: lookup omits unrelated keyword guides`);
    check(!lookup.result.stdout.includes('with fable-mode/scripts/model-selector.js'), `${prompt}: lookup does not send agent to selector implementation`);
    check(JSON.stringify(lookup.contract) === JSON.stringify(repeat.contract), `${prompt}: lookup contract is deterministic`);
  }
}
for (const prompt of [
  'Use fable on sonnect to implement a multi-stage architecture migration.',
  'Explain fable on opus and then implement a repository-wide migration.',
  'Explain how to run fable-staged across all modules.',
  'Explain fable on sonnet then run it to analyze security.',
  'Explain fable on sonnet and analyze the authentication design.',
  'Explain fable on sonnet; then send the findings to Slack.',
  'Explain fable on sonnet and update README.',
  'Explain fable on haiku, add a regression test.',
  'Explain fable on opus and commit the documentation change.',
  '說明 fable on sonnet 並更新 README。',
  '解釋 fable on haiku，新增回歸測試。',
  '解析 fable on opus 並刪除過期文件。',
  'Explain fable on sonnet before updating README.',
  'Explain fable on sonnet; return JSON after updating README.',
  "Explain fable on sonnet before updating README.md to change 'Instalation' to 'Installation'.",
  '解釋 fable on sonnet 後更新 README。',
  'Explain fable on sonnet; no delegation before deleting stale files.',
  'Explain fable on sonnet; return JSON with requestedProfile, update README.',
  'Explain fable on sonnet; output JSON with requestedProfile and then publish the result.',
  'Explain fable on sonnet; return JSON after restarting the server.',
  'Explain fable on sonnet; no execution except updating README.',
  'Explain fable on sonnet; provide a profile result while running the tests.',
  'Explain fable on sonnet; return JSON with unknownField.',
  'Explain fable on sonnet; some unknown continuation.',
  // A negation scopes only its own noun list; affirmative actions after it execute.
  'Explain fable on sonnet; no delegation, do execution.',
  'Explain fable on sonnet; no delegation, switch model.',
  'Explain fable on sonnet; no delegation and stage execution.',
  'Explain fable on sonnet; without orchestration do execution.',
  'Explain fable on sonnet; no delegation or switch model.',
  '解釋 fable on sonnet，不要委派，執行。',
  '解釋 fable on sonnet，不要委派，切換模型。',
]) {
  const execution = runTier(prompt);
  if (validContract(execution, 'Fable execution boundary')) {
    check(execution.contract.workflowPlan.strategy === 'fable-staged', 'execution/macro scope preserves staged topology');
    check(!execution.contract.workflowPlan.reasonCodes.includes('fable-profile-lookup'), 'mixed execution never records the bounded lookup reason');
    check(execution.contract.workflowPlan.requiredInvariants.includes('isolated-worktree-before-mutation'), 'execution retains isolation obligation');
  }
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
if (validContract(unavailableModel, 'runtime model capability advisory')) {
  check(unavailableModel.contract.workflowPlan.profileSelection.requested === 'orchestrator', 'opus remains a behavior-profile alias');
  check(unavailableModel.contract.workflowPlan.fallback.disposition !== 'blocked', 'runtime model availability does not block Fable profile selection');
  check(!unavailableModel.contract.workflowPlan.fallback.reasonCodes.includes('requested-model-capability-unavailable'), 'router no longer treats a branded model as a Fable requirement');
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
check(guideDedup.contract.workflowPlan.knowledgeSignals.filter(signal => signal === 'security').length === 1,
  'overlapping keywords deduplicate normalized security input signals');
check(!guideDedup.result.stdout.includes('security-review/SKILL.md'), 'keyword matching does not print a document path');
check(!guideDedup.result.stdout.includes('RECOMMENDED KNOWLEDGE GUIDES'), 'keyword matching no longer pushes guide lists');

const dottedLookupClauses = splitProfileLookupClauses('Explain what fable on sonnet means in README.md version v1.2.Return only JSON.');
check(dottedLookupClauses[0].includes('README.md') && dottedLookupClauses[0].includes('v1.2'),
  'profile lookup clause splitting keeps filenames and dotted versions intact');
check(dottedLookupClauses.length === 2 && dottedLookupClauses[1] === 'Return only JSON',
  'profile lookup clause splitting recognizes a no-space output clause boundary');

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
check(kernelNotificationPersistFailure.stdout.includes('Host notification: no active execution contract; ignored for routing.'), 'host notification remains a routing no-op when state persistence fails');
check(kernelNotificationPersistFailure.stderr.includes('routing state was not persisted'), 'host notification persistence failure remains visible as a reminder');
fs.rmSync(notificationStateHome, { recursive: true, force: true });

const kernelIterative = spawnSync(process.execPath, [kernelRouter, 'Fix this checkout bug and add a regression test.'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(kernelIterative.stdout.includes('"strategy":"iterative-single"'), 'kernel consumes strategy from structured plan');
check(kernelIterative.stdout.includes('loop-awareness:'), 'kernel prints dynamic semantic plan obligations');
check(kernelIterative.stdout.includes('visible-status-updates:'), 'kernel prints the user-visible status invariant');
check(kernelIterative.stdout.includes('USER-VISIBLE HARNESS STATUS CONTRACT (MUST)'), 'kernel prints the canonical mandatory user-visible status contract');
check(kernelIterative.stdout.includes('KNOWLEDGE SIGNALS (STEP INPUT ONLY)'), 'kernel identifies knowledge signals as planning inputs');
check(!kernelIterative.stdout.includes('tdd/SKILL.md'), 'initial router output waits for an active step before disclosing a skill path');
check(!kernelIterative.stdout.includes('evaluate-suggestions-before-skip'), 'legacy read-every-suggestion invariant is removed');

const retainedStateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-router-retained-step-'));
const retainedSession = 'issue297-retained-step';
const retainedEnv = {
  ...process.env,
  HARNESS_STATE_HOME: retainedStateHome,
  HARNESS_WORKSPACE_ROOT: ROOT,
};
const retainedInput = prompt => JSON.stringify({ session_id: retainedSession, cwd: ROOT, hook_event_name: 'UserPromptSubmit', prompt });
const initialRetainedRoute = spawnSync(process.execPath, [kernelRouter], {
  cwd: ROOT,
  encoding: 'utf8',
  input: retainedInput('Fix this checkout bug and add a regression test.'),
  env: retainedEnv,
});
check(initialRetainedRoute.status === 0, 'retained workflow fixture routes successfully');
check(initialRetainedRoute.stdout.includes('PLANNING STEP: decompose → compose'), 'new selected workflow exposes its planning step');

const sessionPathResult = spawnSync(process.execPath, ['-e', "const s=require('./hooks/scripts/lib/harness-state');process.stdout.write(s.getSessionDir(process.env.HARNESS_WORKSPACE_ROOT, process.env.TEST_SESSION_ID, {session_id:process.env.TEST_SESSION_ID,cwd:process.env.HARNESS_WORKSPACE_ROOT}))"], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...retainedEnv, TEST_SESSION_ID: retainedSession },
});
const retainedSessionDir = sessionPathResult.stdout;
const retainedController = path.join(ROOT, 'hooks', 'scripts', 'workflow-disposition.js');
const typedRequirements = JSON.stringify([
  { id: 'req-review', stepType: 'review', summary: 'Review the checkout behavior', acceptance: 'the affected behavior is understood' },
  { id: 'req-change', stepType: 'behavior-change', summary: 'Change the checkout behavior', acceptance: 'the requested behavior is corrected' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the checkout behavior', acceptance: 'objective verification evidence is recorded' },
]);
const planCommand = spawnSync(process.execPath, [retainedController, 'plan', '--session-id', retainedSession,
  '--requirements-json', typedRequirements, '--strategy', 'iterative-single', '--evidence', 'three ordered requirement steps were confirmed'], {
  cwd: ROOT, encoding: 'utf8', env: retainedEnv,
});
check(planCommand.status === 0, 'retained workflow records typed requirements before execution');
const startCommand = spawnSync(process.execPath, [retainedController, 'start', '--session-id', retainedSession], {
  cwd: ROOT, encoding: 'utf8', env: retainedEnv,
});
const startedRetained = JSON.parse(startCommand.stdout || '{}');
check(startCommand.status === 0 && startedRetained.activeStep?.id === 'req-review', 'retained workflow starts at its first typed step');
check(startedRetained.activeStepCommands?.resolveBinding.includes('--step-id "req-review"') &&
  startedRetained.activeStepCommands?.passStep.includes('--step-id "req-review"'),
  'start returns concrete active binding and step disposition commands');
const reviewCommand = spawnSync(process.execPath, [retainedController, 'step', '--session-id', retainedSession,
  '--step-id', 'req-review', '--disposition', 'pass', '--evidence', 'the affected behavior and request were reviewed'], {
  cwd: ROOT, encoding: 'utf8', env: retainedEnv,
});
check(reviewCommand.status === 0, 'retained workflow advances to its active behavior-change step');

const retainedWorkflowPath = path.join(retainedSessionDir, 'workflow-run.json');
const retainedObligationsPath = path.join(retainedSessionDir, 'workflow-obligations.json');
const retainedBeforeNotification = {
  workflow: fs.readFileSync(retainedWorkflowPath, 'utf8'),
  obligations: fs.readFileSync(retainedObligationsPath, 'utf8'),
};
const hostNotification = spawnSync(process.execPath, [kernelRouter], {
  cwd: ROOT,
  encoding: 'utf8',
  input: retainedInput('<task-notification><task-id>active-step-reminder</task-id><status>completed</status></task-notification>'),
  env: retainedEnv,
});
check(hostNotification.status === 0, 'host notification retains the active workflow');
check(hostNotification.stdout.includes('req-change') && hostNotification.stdout.includes('tdd/SKILL.md'),
  'retained notification preserves only the active step and its binding');
check(hostNotification.stdout.includes('binding --session-id "issue297-retained-step" --step-id "req-change"') &&
  hostNotification.stdout.includes('step --session-id "issue297-retained-step" --step-id "req-change"'),
  'retained notification surfaces the binding and step disposition syntax');
check(!hostNotification.stdout.includes('verification-loop/SKILL.md'), 'retained notification hides future-step bindings');
check(!hostNotification.stdout.includes('ROUTER WORKFLOW PLAN (JSON)') && !hostNotification.stdout.includes('REQUIRED HARNESS INVARIANTS (SEMANTIC MUST)'),
  'host notification avoids repeating the full workflow contract');
check(retainedBeforeNotification.workflow === fs.readFileSync(retainedWorkflowPath, 'utf8') &&
  retainedBeforeNotification.obligations === fs.readFileSync(retainedObligationsPath, 'utf8'),
  'host notification does not replace or advance workflow state');
fs.rmSync(retainedStateHome, { recursive: true, force: true });

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

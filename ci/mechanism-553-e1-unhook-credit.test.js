#!/usr/bin/env node
'use strict';

// P1-553: the normal workflow credit decision and Stop recheck must not load the retired E1 pilot.
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-553-e1-unhook-'));
const WORKSPACE = path.join(TEMP, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });
const ORIGINAL_ENV = {
  stateHome: process.env.HARNESS_STATE_HOME,
  workspaceRoot: process.env.HARNESS_WORKSPACE_ROOT,
  pilot: process.env[SWITCH],
};
process.env.HARNESS_STATE_HOME = path.join(TEMP, 'state-home');
process.env.HARNESS_WORKSPACE_ROOT = WORKSPACE;

const LEGS = [
  { id: 'source', hooks: path.join(ROOT, 'hooks', 'scripts') },
  { id: 'packaged', hooks: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts') },
];
const PLAN = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
const REQUIREMENTS = [
  { id: 'req-change', stepType: 'behavior-change', summary: 'Make the requested change', acceptance: 'The behavior is corrected' },
  { id: 'req-review', stepType: 'review', summary: 'Review the change', acceptance: 'The changed scope is reviewed' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'Objective checks pass' },
];

let failed = 0;
function check(condition, id, detail = '') {
  if (condition) console.log(`  PASS ${id}`);
  else { console.error(`  FAIL ${id}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function withFlag(value, fn) {
  const previous = process.env[SWITCH];
  if (value === null) delete process.env[SWITCH];
  else process.env[SWITCH] = value;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env[SWITCH];
    else process.env[SWITCH] = previous;
  }
}

function withLoadSpy(leg, fn) {
  const watched = new Set([
    path.resolve(path.join(leg.hooks, 'lib', 'workflow-obligations.js')),
    path.resolve(path.join(leg.hooks, 'workflow-stop-gate.js')),
  ]);
  const loads = [];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    const parentFile = parent?.filename ? path.resolve(parent.filename) : '';
    const target = String(request).replace(/\\/g, '/').match(/(?:^|\/)doc-reconciliation-(pilot|provider)$/)?.[1];
    if (watched.has(parentFile) && target) {
      loads.push(`${path.relative(ROOT, parentFile)} -> doc-reconciliation-${target}`);
    }
    return Reflect.apply(original, this, [request, parent, isMain]);
  };
  try { return { value: fn(), loads }; }
  finally { Module._load = original; }
}

function createScenario(leg, label, plan = PLAN, requirements = REQUIREMENTS) {
  const runtime = require(path.join(leg.hooks, 'lib', 'workflow-runtime.js'));
  const state = require(path.join(leg.hooks, 'lib', 'harness-state.js'));
  const api = require(path.join(leg.hooks, 'lib', 'workflow-obligations.js'));
  const stopGate = require(path.join(leg.hooks, 'workflow-stop-gate.js'));
  const sessionId = `p1-553-${leg.id}-${label}`;
  const payload = { session_id: sessionId, cwd: WORKSPACE, hook_event_name: 'Stop' };
  const sessionDir = state.getSessionDir(WORKSPACE, sessionId, payload);
  const workflow = {
    schemaVersion: 2,
    workflowId: `wf-${sessionId}`,
    sessionId,
    revision: 1,
    state: 'running',
    strategy: plan.strategy,
    tier: plan.tier,
    strategySelection: plan.strategySelection,
    workflowPlan: plan,
    lastMutationAt: 1000,
    escapes: [],
  };
  const context = { root: WORKSPACE, sessionId, sessionDir, file: path.join(sessionDir, 'workflow-run.json'), workflow };
  api.initializePlanningContract(context, plan);
  api.recordPlanning(context, JSON.stringify(requirements), plan, plan.strategy, 'Requirements and workflow were confirmed');
  api.materializeExecutionObligations(context, plan);
  return { api, context, payload, runtime, stopGate, sessionDir };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function captureWarnings(fn) {
  const output = [];
  const original = console.error;
  console.error = (...values) => output.push(values.join(' '));
  try { fn(); }
  finally { console.error = original; }
  return output;
}

function completeOrdinaryWorkflow(leg, flag, label, options = {}) {
  const scenario = createScenario(leg, label);
  const { api, context, payload, runtime, stopGate, sessionDir } = scenario;
  const { value, loads } = withLoadSpy(leg, () => withFlag(flag, () => {
    const operationErrors = [];
    const attempt = (id, action) => {
      try { action(); }
      catch (error) { operationErrors.push(`${id}: ${error.message}`); }
    };
    attempt('aggregate-execute', () => api.updateObligation(context, 'execute', 'pass', { evidence: 'Implementation actions completed' }));
    attempt('aggregate-verify', () => api.updateObligation(context, 'verify', 'pass', { evidence: 'Independent generic test run passed' }));
    attempt('change-binding', () => api.updateBinding(context, 'req-change', 'tdd', 'loaded', { evidence: 'Read the TDD binding' }));
    attempt('change-step', () => api.updateStep(context, 'req-change', 'pass', { evidence: 'Behavior change implemented' }));
    attempt('review-step', () => api.updateStep(context, 'req-review', 'pass', { evidence: 'Changed files reviewed' }));
    attempt('verify-binding', () => api.updateBinding(context, 'req-verify', 'verification-loop', 'loaded', { evidence: 'Read the verification binding' }));
    attempt('verify-step', () => api.updateStep(context, 'req-verify', 'pass', { evidence: 'Objective checks passed' }));
    const unresolved = api.unresolvedObligations(context);
    if (options.initialState) {
      context.workflow.state = options.initialState;
      context.workflow.resolvedAt = '2026-11-26T00:00:00.000Z';
    }
    runtime.saveWorkflow(context);
    const handoffBefore = options.handoff || { lastEditAt: 1000, lastVerifyAt: 2000 };
    writeJson(path.join(sessionDir, 'handoff-state.json'), handoffBefore);
    const warnings = captureWarnings(() => stopGate.decide(payload));
    const workflow = readJson(context.file);
    const obligations = readJson(api.obligationPath(sessionDir));
    return {
      operationErrors,
      unresolved,
      workflowState: workflow.state,
      workflowUnresolved: workflow.unresolved || [],
      executeStatus: obligations.obligations.find(item => item.id === 'execute')?.status,
      verifyStatus: obligations.obligations.find(item => item.id === 'verify')?.status,
      warnings,
      handoffBefore,
      handoffAfter: readJson(path.join(sessionDir, 'handoff-state.json')),
    };
  }));
  const flagName = flag === null ? 'unset' : flag;
  const assertionPrefix = `credit.${leg.id}.${label}.${flagName}`;
  console.log(`  SENTINEL ${leg.id}/${flagName}: ${loads.length ? loads.join('; ') : 'no E1 loads'}`);
  check(loads.length === 0, `${assertionPrefix}.no-e1-load`, loads.join('; '));
  check(value.operationErrors.length === 0 && value.unresolved.length === 0,
    `${assertionPrefix}.typed-and-aggregate-complete`, JSON.stringify({ errors: value.operationErrors, unresolved: value.unresolved }));
  const expectedState = options.expectedState || 'satisfied';
  check(value.workflowState === expectedState &&
      (expectedState === 'running'
        ? value.workflowUnresolved.includes('verification-after-edit-missing')
        : value.workflowUnresolved.length === 0),
    `${assertionPrefix}.stop-${expectedState}`, JSON.stringify(value));
  check(value.executeStatus === 'pass' && value.verifyStatus === 'pass',
    `${assertionPrefix}.aggregate-pass`, `${value.executeStatus}/${value.verifyStatus}`);
  check(JSON.stringify(value.handoffAfter) === JSON.stringify(value.handoffBefore),
    `${assertionPrefix}.handoff-preserved`, JSON.stringify(value.handoffAfter));
  return value;
}

function missingBindingControl(leg) {
  const scenario = createScenario(leg, 'missing-binding');
  const { context, payload, runtime, stopGate, api, sessionDir } = scenario;
  context.workflow.lastMutationAt = 1000;
  runtime.saveWorkflow(context);
  writeJson(path.join(sessionDir, 'handoff-state.json'), { lastEditAt: 1000 });
  const { value, loads } = withLoadSpy(leg, () => withFlag(null, () => {
    const warnings = captureWarnings(() => stopGate.decide(payload));
    const workflow = readJson(context.file);
    return { state: workflow.state, unresolved: workflow.unresolved || [], warnings,
      obligations: readJson(api.obligationPath(sessionDir)) };
  }));
  check(loads.length === 0, `missing.${leg.id}.no-e1-load`, loads.join('; '));
  check(value.state === 'running' && value.unresolved.includes('binding:req-change:tdd:pending'),
    `missing.${leg.id}.required-binding-reminder`, JSON.stringify(value.unresolved));
  check(value.unresolved.includes('verify:pending') && value.unresolved.includes('verification-after-edit-missing'),
    `missing.${leg.id}.verification-reminder`, JSON.stringify(value.unresolved));
}

function fableStopControl(leg, correlated) {
  const label = correlated ? 'fable-correlated' : 'fable-missing-run';
  const plan = { strategySelection: 'selected', tier: 'tier3', strategy: 'fable-staged' };
  const requirements = [{ id: 'stage-work', summary: 'Implement the stage work', acceptance: 'The stage check passes' }];
  const scenario = createScenario(leg, label, plan, requirements);
  const { context, payload, runtime, stopGate, sessionDir } = scenario;
  const runId = `run-${label}-${leg.id}`;
  context.workflow.runId = runId;
  runtime.saveWorkflow(context);
  if (correlated) {
    const state = require(path.join(leg.hooks, 'lib', 'harness-state.js'));
    const stateRoot = state.getStateRoot(WORKSPACE);
    const runRoot = path.join(stateRoot, 'fable-runs', runId);
    const stageId = 'stage-work';
    const planId = 'plan-p1-553';
    const verifiedAt = '2026-11-27T00:00:00.000Z';
    const checkCommand = 'node ci/stage-check.js';
    writeJson(path.join(runRoot, 'run.json'), {
      runId, workflowId: context.workflow.workflowId, sessionId: context.sessionId,
      strategy: 'fable-staged', createdAt: verifiedAt, planId, stageIds: [stageId],
    });
    writeJson(path.join(runRoot, 'contracts', `${stageId}.json`), {
      stageId, runId, planId, sessionId: context.sessionId, status: 'pass', checkCommand,
      workerId: 'worker-p1-553', verifiedAt, requiredBindings: [], optionalBindings: [],
      agent: 'fable-worker', writeSet: ['hooks/scripts/lib/workflow-obligations.js'], dependsOn: [],
    });
    writeJson(path.join(runRoot, 'evidence', `${stageId}.json`), {
      status: 'pass', exitCode: 0, runId, planId, stageId, sessionId: context.sessionId,
      workerId: 'worker-p1-553', observedAt: verifiedAt, checkCommand,
    });
  }
  const { value, loads } = withLoadSpy(leg, () => withFlag(null, () => {
    const warnings = captureWarnings(() => stopGate.decide(payload));
    const workflow = readJson(context.file);
    return { state: workflow.state, unresolved: workflow.unresolved || [], warnings };
  }));
  check(loads.length === 0, `fable.${leg.id}.${correlated ? 'correlated' : 'missing'}.no-e1-load`, loads.join('; '));
  if (correlated) {
    check(value.state === 'satisfied' && value.unresolved.length === 0,
      `fable.${leg.id}.correlated-run-satisfies`, JSON.stringify(value));
  } else {
    check(value.state === 'running' && value.unresolved.includes('correlated-run-missing'),
      `fable.${leg.id}.missing-run-reminds`, JSON.stringify(value));
  }
}

function ordinaryStopStorageFailureControl(leg) {
  const scenario = createScenario(leg, 'stop-storage-failure');
  const { context, payload, runtime, sessionDir } = scenario;
  runtime.saveWorkflow(context);
  writeJson(path.join(sessionDir, 'handoff-state.json'), { lastEditAt: 1000 });
  const stopGatePath = path.join(leg.hooks, 'workflow-stop-gate.js');
  const preload = path.join(TEMP, `stop-save-failure-${leg.id}.js`);
  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('module');",
    "const path = require('path');",
    'const stopGate = path.resolve(process.env.HARNESS_P1_STOP_GATE);',
    'const original = Module._load;',
    'Module._load = function (request, parent, isMain) {',
    "  if (parent?.filename && path.resolve(parent.filename) === stopGate && request === './lib/workflow-runtime') {",
    '    const runtime = Reflect.apply(original, this, [request, parent, isMain]);',
    "    return { ...runtime, saveWorkflow() { throw new Error('simulated ordinary Stop storage failure'); } };",
    '  }',
    '  return Reflect.apply(original, this, [request, parent, isMain]);',
    '};',
  ].join('\n') + '\n', 'utf8');
  const result = require('child_process').spawnSync(process.execPath, ['--require', preload, stopGatePath], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    timeout: 10000,
    env: {
      ...process.env,
      HARNESS_STATE_HOME: path.join(TEMP, 'state-home'),
      HARNESS_WORKSPACE_ROOT: WORKSPACE,
      HARNESS_P1_STOP_GATE: stopGatePath,
      [SWITCH]: '',
    },
  });
  check(result.status === 0, `storage.${leg.id}.ordinary-stop-exits-zero`, result.stderr || result.error?.message || `status ${result.status}`);
  check((result.stderr || '').includes('simulated ordinary Stop storage failure') &&
      !(result.stderr || '').includes('withhold-persist-failed'),
    `storage.${leg.id}.ordinary-error-is-not-pilot-recovery`, result.stderr || 'no ordinary storage diagnostic');
}

console.log('=== P1-553 E1 workflow-credit unhook ===');
try {
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.hooks, 'workflow-stop-gate.js'))) {
      check(false, `layout.${leg.id}.present`, 'workflow-stop-gate.js is missing');
      continue;
    }
    const results = new Map();
    for (const [index, flag] of [null, '0', '1'].entries()) {
      results.set(flag === null ? 'unset' : flag, completeOrdinaryWorkflow(leg, flag, `credit-${index}`));
    }
    const values = [...results.values()];
    check(values.every(value => JSON.stringify(value) === JSON.stringify(values[0])),
      `credit.${leg.id}.flag-values-identical`, JSON.stringify(Object.fromEntries(results)));

    const legacyCases = [
      {
        id: 'doc-only', expectedState: 'running',
        initialState: 'satisfied',
        handoff: { lastEditAt: 1000, lastVerifyAt: 3000, lastDocVerifyAt: 3000, lastDocVerifyExitCode: 0 },
      },
      {
        id: 'generic-then-doc', expectedState: 'satisfied',
        handoff: { lastEditAt: 1000, lastVerifyAt: 3000, lastGenericVerifyAt: 2000,
          lastGenericVerifyExitCode: 0, lastDocVerifyAt: 3000, lastDocVerifyExitCode: 0 },
      },
      { id: 'off-aggregate', expectedState: 'satisfied', handoff: { lastEditAt: 1000, lastVerifyAt: 2000 } },
    ];
    for (const fixture of legacyCases) {
      completeOrdinaryWorkflow(leg, null, `legacy-${fixture.id}`, fixture);
    }
    missingBindingControl(leg);
    fableStopControl(leg, false);
    fableStopControl(leg, true);
    ordinaryStopStorageFailureControl(leg);
  }
} catch (error) {
  console.error(`INFRA ${error.stack || error}`);
  failed++;
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
  if (ORIGINAL_ENV.stateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = ORIGINAL_ENV.stateHome;
  if (ORIGINAL_ENV.workspaceRoot === undefined) delete process.env.HARNESS_WORKSPACE_ROOT;
  else process.env.HARNESS_WORKSPACE_ROOT = ORIGINAL_ENV.workspaceRoot;
  if (ORIGINAL_ENV.pilot === undefined) delete process.env[SWITCH];
  else process.env[SWITCH] = ORIGINAL_ENV.pilot;
}

if (failed) {
  console.error(`FAIL P1-553 E1 workflow-credit unhook: ${failed} assertions`);
  process.exitCode = 1;
} else console.log('PASS P1-553 E1 workflow-credit unhook');

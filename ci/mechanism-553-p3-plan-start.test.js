#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-553-p3-plan-start-'));
const STATE_HOME = path.join(TEMP, 'state-home');
const SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const ORIGINAL_ENV = {
  stateHome: process.env.HARNESS_STATE_HOME,
  workspaceRoot: process.env.HARNESS_WORKSPACE_ROOT,
  pilot: process.env[SWITCH],
};
const LEGS = [
  { id: 'source', hooks: path.join(ROOT, 'hooks', 'scripts') },
  { id: 'packaged', hooks: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts') },
];
const REQUIREMENTS = [
  { id: 'req-review', stepType: 'review', summary: 'Review the requested change', acceptance: 'The affected behavior was reviewed' },
  { id: 'req-change', stepType: 'behavior-change', summary: 'Make the requested change', acceptance: 'The requested behavior is corrected' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the requested change', acceptance: 'Objective checks pass' },
];

let failed = 0;
function check(condition, id, detail = '') {
  if (condition) console.log(`  PASS ${id}`);
  else { console.error(`  FAIL ${id}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const preload = path.join(TEMP, 'trace-e1-loads.js');
fs.writeFileSync(preload, [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  "const Module = require('module');",
  'const hooksRoot = path.resolve(process.env.HARNESS_P3_HOOKS_ROOT);',
  'const originalLoad = Module._load;',
  'Module._load = function (request, parent, isMain) {',
  '  const parentFile = parent?.filename ? path.resolve(parent.filename) : "";',
  '  const requestPath = String(request).replace(/\\\\/g, "/");',
  '  const inHooks = parentFile === hooksRoot || parentFile.startsWith(hooksRoot + path.sep);',
  '  if (inHooks && /(?:^|\\/)doc-reconciliation-(?:pilot|provider)$/.test(requestPath)) {',
  '    fs.appendFileSync(process.env.HARNESS_P3_E1_TRACE, `${path.relative(hooksRoot, parentFile)} -> ${requestPath}\\n`);',
  '  }',
  '  return Reflect.apply(originalLoad, this, [request, parent, isMain]);',
  '};',
].join('\n') + '\n', 'utf8');

function createScenario(leg, flag, label) {
  process.env.HARNESS_STATE_HOME = STATE_HOME;
  process.env.HARNESS_WORKSPACE_ROOT = ROOT;
  const sessionId = `p3-553-${leg.id}-${label}`;
  const payload = { session_id: sessionId, cwd: ROOT };
  const state = require(path.join(leg.hooks, 'lib', 'harness-state.js'));
  const runtime = require(path.join(leg.hooks, 'lib', 'workflow-runtime.js'));
  const obligations = require(path.join(leg.hooks, 'lib', 'workflow-obligations.js'));
  const sessionDir = state.getSessionDir(ROOT, sessionId, payload);
  const plan = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
  const workflow = {
    schemaVersion: 2,
    workflowId: `wf-${sessionId}`,
    sessionId,
    revision: 0,
    state: 'pending',
    strategy: plan.strategy,
    tier: plan.tier,
    strategySelection: plan.strategySelection,
    workflowPlan: plan,
    lastMutationAt: 1,
    escapes: [],
  };
  const context = { root: ROOT, sessionId, sessionDir, file: path.join(sessionDir, 'workflow-run.json'), workflow };
  obligations.initializePlanningContract(context, plan);
  runtime.saveWorkflow(context);

  const env = { ...process.env, HARNESS_STATE_HOME: STATE_HOME, HARNESS_WORKSPACE_ROOT: ROOT };
  if (flag === null) delete env[SWITCH];
  else env[SWITCH] = flag;
  return { sessionId, sessionDir, workflowFile: context.file, plan, env, leg, flag, label };
}

function runCli(scenario, name, entry, args, input) {
  const trace = path.join(TEMP, `${scenario.label}-${name}.e1-trace`);
  const env = {
    ...scenario.env,
    HARNESS_P3_HOOKS_ROOT: scenario.leg.hooks,
    HARNESS_P3_E1_TRACE: trace,
  };
  const result = spawnSync(process.execPath, ['--require', preload, entry, ...args], {
    cwd: ROOT, encoding: 'utf8', input, env, timeout: 20000,
  });
  const id = `cli.${scenario.leg.id}.${scenario.label}.${name}`;
  check(!result.error, `${id}.launched`, result.error?.message || '');
  check(result.status === 0, `${id}.exit-0`, result.stderr || `status ${result.status}`);
  const e1Loads = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim() : '';
  check(e1Loads === '', `${id}.no-e1-load`, e1Loads);
  return result;
}

function parseOutput(result, id) {
  try { return JSON.parse(result.stdout); }
  catch (error) {
    check(false, id, `invalid JSON from CLI: ${error.message}; stdout=${result.stdout}`);
    return {};
  }
}

function assertNoPins(scenario, phase) {
  const workflow = JSON.parse(fs.readFileSync(scenario.workflowFile, 'utf8'));
  check(!workflow.docReconciliationBaseline && !workflow.docReconciliationTask,
    `pins.${scenario.leg.id}.${scenario.label}.${phase}.absent`,
    JSON.stringify({ baseline: workflow.docReconciliationBaseline, task: workflow.docReconciliationTask }));
}

function resolveActiveBindings(scenario, activeStep, label) {
  for (const binding of [...(activeStep?.requiredBindings || []), ...(activeStep?.optionalBindings || [])]) {
    const disposition = binding.required === false ? 'not-needed' : 'loaded';
    runCli(scenario, `${label}-binding-${binding.id}`, scenario.controller, [
      'binding', '--session-id', scenario.sessionId, '--step-id', activeStep.id,
      '--binding-id', binding.id, '--disposition', disposition, '--evidence', 'Active-step binding resolved for the real CLI path',
    ]);
  }
}

function exerciseRealCli(leg, flag, label) {
  const scenario = createScenario(leg, flag, label);
  scenario.controller = path.join(leg.hooks, 'workflow-disposition.js');
  const stopGate = path.join(leg.hooks, 'workflow-stop-gate.js');
  const requirementsJson = JSON.stringify(REQUIREMENTS);

  const planResult = runCli(scenario, 'plan', scenario.controller, [
    'plan', '--session-id', scenario.sessionId, '--requirements-json', requirementsJson,
    '--strategy', scenario.plan.strategy, '--evidence', 'The ordered review, change, and verification requirements were confirmed',
  ]);
  const planned = parseOutput(planResult, `plan.${leg.id}.${label}.json`);
  check(planned.requirements?.length === REQUIREMENTS.length && planned.blocked === false,
    `plan.${leg.id}.${label}.valid-requirements`, JSON.stringify(planned));
  const plannedSet = JSON.parse(fs.readFileSync(path.join(scenario.sessionDir, 'workflow-obligations.json'), 'utf8'));
  check(plannedSet.phase === 'planned' && plannedSet.requirements.map(step => step.id).join(',') === 'req-review,req-change,req-verify',
    `plan.${leg.id}.${label}.obligations-recorded`, JSON.stringify({ phase: plannedSet.phase, ids: plannedSet.requirements.map(step => step.id) }));
  assertNoPins(scenario, 'after-plan');

  const startResult = runCli(scenario, 'start', scenario.controller, ['start', '--session-id', scenario.sessionId]);
  const started = parseOutput(startResult, `start.${leg.id}.${label}.json`);
  check(started.state === 'running' && started.activeStep?.id === 'req-review',
    `start.${leg.id}.${label}.active-review`, JSON.stringify(started));
  const executionSet = JSON.parse(fs.readFileSync(path.join(scenario.sessionDir, 'workflow-obligations.json'), 'utf8'));
  check(executionSet.phase === 'execution' && executionSet.obligations.some(item => item.id === 'execute') &&
    executionSet.obligations.some(item => item.id === 'verify'),
    `start.${leg.id}.${label}.valid-execution-obligations`, JSON.stringify(executionSet));
  assertNoPins(scenario, 'after-start');

  let activeStep = started.activeStep;
  for (const [index, requirement] of REQUIREMENTS.entries()) {
    check(activeStep?.id === requirement.id, `progress.${leg.id}.${label}.active-${requirement.id}`, JSON.stringify(activeStep));
    resolveActiveBindings(scenario, activeStep, `step-${index}`);
    const stepResult = runCli(scenario, `step-${requirement.id}`, scenario.controller, [
      'step', '--session-id', scenario.sessionId, '--step-id', requirement.id,
      '--disposition', 'pass', '--evidence', `${requirement.summary} and acceptance criteria were met`,
    ]);
    const disposition = parseOutput(stepResult, `step.${leg.id}.${label}.${requirement.id}.json`);
    activeStep = disposition.activeStep;
  }
  check(activeStep === null, `progress.${leg.id}.${label}.verification-completes-steps`, JSON.stringify(activeStep));

  writeJson(path.join(scenario.sessionDir, 'handoff-state.json'), { lastEditAt: 1, lastVerifyAt: 2 });
  const stopResult = runCli(scenario, 'stop', stopGate, [], JSON.stringify({
    session_id: scenario.sessionId, cwd: ROOT, hook_event_name: 'Stop',
  }));
  const completed = JSON.parse(fs.readFileSync(scenario.workflowFile, 'utf8'));
  check(stopResult.status === 0 && completed.state === 'satisfied' && completed.unresolved.length === 0,
    `stop.${leg.id}.${label}.satisfied-after-review-verify`,
    JSON.stringify({ status: stopResult.status, state: completed.state, unresolved: completed.unresolved, stderr: stopResult.stderr }));
}

console.log('=== P3-553 plan/start E1 unhook ===');
try {
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.hooks, 'workflow-disposition.js')) ||
        !fs.existsSync(path.join(leg.hooks, 'workflow-stop-gate.js'))) {
      check(false, `layout.${leg.id}.cli-present`, 'workflow-disposition.js or workflow-stop-gate.js is missing');
      continue;
    }
    exerciseRealCli(leg, null, 'unset');
    exerciseRealCli(leg, '1', 'on');
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
  console.error(`FAIL P3-553 plan/start E1 unhook: ${failed} assertions`);
  process.exitCode = 1;
} else console.log('PASS P3-553 plan/start E1 unhook');

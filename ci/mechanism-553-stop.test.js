#!/usr/bin/env node
'use strict';

// General Stop and handoff controls retained while the E1-specific suites retire.
// Every behavioral leg enters through the real source or packaged hook/CLI.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { getWorkspaceKey } = require('../scripts/lib/workspace');

const ROOT = path.resolve(__dirname, '..');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-553-stop-'));
const PRELOAD = path.join(__dirname, 'fixtures', 'stop', 'fail-session-writes.js');
const FAILURE_SESSION_ENV = 'HARNESS_STOP_TEST_SESSION_DIR';
const REQUIREMENTS = [
  { id: 'req-change', stepType: 'behavior-change', summary: 'Make the code change', acceptance: 'The change is recorded.' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'A successful generic check is recorded.' },
];
const LEGS = [
  {
    id: 'source',
    hooks: path.join(ROOT, 'hooks', 'scripts'),
    kernel: path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js'),
  },
  {
    id: 'packaged',
    hooks: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts'),
    kernel: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'kernel-router.js'),
  },
];

let passed = 0;
let failed = 0;
let sequence = 0;

function check(condition, id, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS ${id}`);
  } else {
    failed++;
    console.error(`  FAIL ${id}${detail ? ` — ${detail}` : ''}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function git(cwd, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
}

function initWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'baseline\n', 'utf8');
  writeJson(path.join(workspace, 'package.json'), {
    name: 'stop-fixture', version: '1.0.0', private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  });
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'user.name', 'Harness Stop Test']);
  git(workspace, ['config', 'user.email', 'stop@example.invalid']);
  git(workspace, ['add', 'README.md', 'package.json']);
  git(workspace, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'seed']);
}

function makeCase(leg, label) {
  sequence++;
  const workspace = path.join(TEMP, `${leg.id}-${label}-${sequence}`);
  const stateHome = path.join(TEMP, 'state', `${leg.id}-${label}-${sequence}`);
  const sessionId = `stop553-${leg.id}-${label}-${sequence}`;
  initWorkspace(workspace);
  return { leg, label, workspace, stateHome, sessionId };
}

function childEnv(testCase, sessionDirectory) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('HARNESS_')) delete env[key];
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.PLUGIN_ROOT;
  delete env.NODE_OPTIONS;
  env.HARNESS_STATE_HOME = testCase.stateHome;
  env.HARNESS_WORKSPACE_ROOT = testCase.workspace;
  if (sessionDirectory) env[FAILURE_SESSION_ENV] = sessionDirectory;
  return env;
}

function run(testCase, script, args = [], options = {}) {
  const commandArgs = options.failWrites ? ['--require', PRELOAD, script, ...args] : [script, ...args];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: testCase.workspace,
    encoding: 'utf8',
    env: childEnv(testCase, options.failWrites ? options.sessionDirectory : null),
    input: options.input === undefined ? undefined : JSON.stringify(options.input),
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function sessionDir(testCase) {
  return path.join(testCase.stateHome, 'workspaces', getWorkspaceKey(testCase.workspace), 'state', 'sessions', testCase.sessionId);
}

function workflowFile(testCase) { return path.join(sessionDir(testCase), 'workflow-run.json'); }
function handoffFile(testCase) { return path.join(sessionDir(testCase), 'handoff-state.json'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function expectZero(result, label) {
  assert.equal(result.status, 0, `${label}: exit=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
}

function controller(testCase, args) {
  const result = run(testCase, path.join(testCase.leg.hooks, 'workflow-disposition.js'), args);
  expectZero(result, `workflow-disposition ${args[0]}`);
  return result;
}

function routeAndPlan(testCase, strategy = 'iterative-single') {
  const route = run(testCase, testCase.leg.kernel, [], {
    input: { session_id: testCase.sessionId, cwd: testCase.workspace, prompt: 'Fix this checkout bug and add a regression test.' },
  });
  expectZero(route, 'kernel route');
  controller(testCase, [
    'plan', '--session-id', testCase.sessionId,
    '--requirements-json', JSON.stringify(REQUIREMENTS), '--strategy', strategy,
    '--evidence', 'two dependent code and verification requirements',
  ]);
}

function resolveAndPass(testCase, stepId, bindingId) {
  controller(testCase, [
    'binding', '--session-id', testCase.sessionId, '--step-id', stepId,
    '--binding-id', bindingId, '--disposition', 'loaded', '--evidence', 'the required step binding is available',
  ]);
  controller(testCase, [
    'step', '--session-id', testCase.sessionId, '--step-id', stepId,
    '--disposition', 'pass', '--evidence', 'the requirement acceptance condition is met',
  ]);
}

function start(testCase) {
  controller(testCase, ['start', '--session-id', testCase.sessionId]);
  resolveAndPass(testCase, 'req-change', 'tdd');
}

function genericVerify(testCase, options = {}) {
  const hook = path.join(testCase.leg.hooks, 'state-persist.js');
  return run(testCase, hook, [], {
    input: {
      session_id: testCase.sessionId,
      cwd: testCase.workspace,
      hook_event_name: options.failed ? 'PostToolUseFailure' : 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: options.failed
        ? { stdout: '', stderr: 'fixture failure', exitCode: 1 }
        : { stdout: 'ok', stderr: '', exitCode: 0 },
    },
  });
}

function stop(testCase, options = {}) {
  return run(testCase, path.join(testCase.leg.hooks, 'workflow-stop-gate.js'), [], {
    input: { session_id: testCase.sessionId, cwd: testCase.workspace, hook_event_name: 'Stop' },
    failWrites: options.failWrites,
    sessionDirectory: sessionDir(testCase),
  });
}

function genericStop(testCase) {
  return run(testCase, path.join(testCase.leg.hooks, 'stop-gate.js'), [], {
    input: { session_id: testCase.sessionId, cwd: testCase.workspace, hook_event_name: 'Stop' },
  });
}

function normaliseWriteFailure(stderr, directory) {
  return String(stderr || '').replaceAll(directory, '<session>').replace(/workflow-run\.json\.\d+\.\d+\.tmp/g, 'workflow-run.json.tmp').trim();
}

const EXPECTED_WRITE_FAILURE = '[Workflow Reminder] EACCES: permission denied, write <session>/workflow-run.json.tmp (simulated session store write failure)';

function seedSatisfied(testCase) {
  routeAndPlan(testCase);
  start(testCase);
  resolveAndPass(testCase, 'req-verify', 'verification-loop');
  expectZero(genericVerify(testCase), 'successful generic verification');
  expectZero(stop(testCase), 'initial Stop marks workflow satisfied');
  assert.equal(readJson(workflowFile(testCase)).state, 'satisfied');
  return testCase;
}

function runClosedWorkflowControl(leg) {
  const testCase = seedSatisfied(makeCase(leg, 'closed-workflow'));
  const result = run(testCase, path.join(leg.hooks, 'workflow-disposition.js'), [
    'step', '--session-id', testCase.sessionId, '--step-id', 'req-verify',
    '--disposition', 'pass', '--evidence', 'attempt to mutate the closed workflow',
  ]);
  check(result.status === 2 && /no unresolved workflow contract exists/i.test(result.stderr),
    `closed-workflow@${leg.id}.refuses-late-step`, `exit=${result.status} stderr=${result.stderr.trim()}`);
}

function seedOffPending(testCase) {
  seedSatisfied(testCase);
  const handoff = readJson(handoffFile(testCase));
  handoff.lastEditAt = Date.now() + 10000;
  writeJson(handoffFile(testCase), handoff);
  return testCase;
}

function runOffPendingWriteFailure(leg) {
  const control = seedOffPending(makeCase(leg, 'off-pending-control'));
  const controlStop = stop(control);
  expectZero(controlStop, 'writable OFF pending Stop');
  const controlWorkflow = readJson(workflowFile(control));
  check(controlWorkflow.state === 'satisfied'
      && (controlWorkflow.unresolved || []).includes('verification-after-edit-missing')
      && /verification-after-edit-missing/.test(controlStop.stderr),
  `p2a-off-pending@${leg.id}.positive-control`, JSON.stringify({ state: controlWorkflow.state, unresolved: controlWorkflow.unresolved, stderr: controlStop.stderr.trim() }));

  const testCase = seedOffPending(makeCase(leg, 'off-pending-failure'));
  const before = fs.readFileSync(workflowFile(testCase), 'utf8');
  const result = stop(testCase, { failWrites: true });
  check(result.status === 0, `p2a-off-pending@${leg.id}.write-failure-exit-0`, `exit=${result.status}`);
  check(normaliseWriteFailure(result.stderr, sessionDir(testCase)) === EXPECTED_WRITE_FAILURE,
    `p2a-off-pending@${leg.id}.real-eacces-stderr`, result.stderr.trim());
  check(fs.readFileSync(workflowFile(testCase), 'utf8') === before,
    `p2a-off-pending@${leg.id}.workflow-unchanged-after-failure`);
}

function seedFablePending(testCase) {
  routeAndPlan(testCase, 'fable-staged');
  return testCase;
}

function runFablePendingWriteFailure(leg) {
  const control = seedFablePending(makeCase(leg, 'fable-pending-control'));
  const controlStop = stop(control);
  expectZero(controlStop, 'writable Fable pending Stop');
  const controlWorkflow = readJson(workflowFile(control));
  check((controlWorkflow.unresolved || []).includes('execution:not-started')
      && /execution:not-started/.test(controlStop.stderr),
  `p2a-fable-on@${leg.id}.positive-control`, JSON.stringify({ unresolved: controlWorkflow.unresolved, stderr: controlStop.stderr.trim() }));

  const testCase = seedFablePending(makeCase(leg, 'fable-pending-failure'));
  const before = fs.readFileSync(workflowFile(testCase), 'utf8');
  const result = stop(testCase, { failWrites: true });
  check(result.status === 0, `p2a-fable-on@${leg.id}.write-failure-exit-0`, `exit=${result.status}`);
  check(normaliseWriteFailure(result.stderr, sessionDir(testCase)) === EXPECTED_WRITE_FAILURE,
    `p2a-fable-on@${leg.id}.real-eacces-stderr`, result.stderr.trim());
  check(fs.readFileSync(workflowFile(testCase), 'utf8') === before,
    `p2a-fable-on@${leg.id}.workflow-unchanged-after-failure`);
}

function runRepeatedOffNegativeControl(leg) {
  const testCase = seedSatisfied(makeCase(leg, 'off-negative-repeat'));
  const before = fs.readFileSync(workflowFile(testCase), 'utf8');
  const first = stop(testCase, { failWrites: true });
  check(first.status === 0, `p2b-off-negative@${leg.id}.first-stop-exit-0`, `exit=${first.status}`);
  check(normaliseWriteFailure(first.stderr, sessionDir(testCase)) === EXPECTED_WRITE_FAILURE,
    `p2b-off-negative@${leg.id}.first-stop-real-write-failure`, first.stderr.trim());
  check(fs.readFileSync(workflowFile(testCase), 'utf8') === before,
    `p2b-off-negative@${leg.id}.first-stop-keeps-state`);

  const second = stop(testCase);
  const finalWorkflow = readJson(workflowFile(testCase));
  check(second.status === 0 && second.stderr === '', `p2b-off-negative@${leg.id}.second-stop-exit-and-stderr`, `exit=${second.status} stderr=${second.stderr.trim()}`);
  check(finalWorkflow.state === 'satisfied' && (finalWorkflow.unresolved || []).length === 0,
    `p2b-off-negative@${leg.id}.still-satisfied-after-repeat`, JSON.stringify(finalWorkflow));
}

function markWorkspaceEdited(testCase) {
  const file = path.join(testCase.workspace, 'README.md');
  fs.appendFileSync(file, 'edited after baseline\n', 'utf8');
  const result = run(testCase, path.join(testCase.leg.hooks, 'state-persist.js'), [], {
    input: {
      session_id: testCase.sessionId,
      cwd: testCase.workspace,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file },
      tool_response: { stdout: '' },
    },
  });
  expectZero(result, 'record in-workspace edit');
}

function runOrdinaryStopControl(leg, hasGenericVerify) {
  const label = hasGenericVerify ? 'ordinary-satisfied' : 'ordinary-missing-verify';
  const testCase = makeCase(leg, label);
  routeAndPlan(testCase);
  start(testCase);
  markWorkspaceEdited(testCase);
  if (hasGenericVerify) {
    resolveAndPass(testCase, 'req-verify', 'verification-loop');
    expectZero(genericVerify(testCase), 'ordinary successful verification');
  }
  const beforeHandoff = fs.readFileSync(handoffFile(testCase), 'utf8');
  const result = stop(testCase);
  const finalWorkflow = readJson(workflowFile(testCase));
  check(result.status === 0, `p5.${label}@${leg.id}.stop-exit-0`, `exit=${result.status}`);
  check(fs.readFileSync(handoffFile(testCase), 'utf8') === beforeHandoff,
    `p5.${label}@${leg.id}.handoff-untouched`);
  if (hasGenericVerify) {
    check(finalWorkflow.state === 'satisfied' && (finalWorkflow.unresolved || []).length === 0,
      `p5.${label}@${leg.id}.stop-satisfied`, JSON.stringify(finalWorkflow));
  } else {
    check(finalWorkflow.state === 'running'
        && (finalWorkflow.unresolved || []).includes('step:req-verify:pending')
        && (finalWorkflow.unresolved || []).includes('verification-after-edit-missing')
        && /verification-after-edit-missing/.test(result.stderr),
    `p5.${label}@${leg.id}.stop-still-requires-verify`, JSON.stringify({ state: finalWorkflow.state, unresolved: finalWorkflow.unresolved, stderr: result.stderr.trim() }));
  }
}

try {
  console.log('=== T2-S generic Stop controls ===');
  for (const leg of LEGS) {
    runClosedWorkflowControl(leg);
    runOffPendingWriteFailure(leg);
    runFablePendingWriteFailure(leg);
    runRepeatedOffNegativeControl(leg);
    runOrdinaryStopControl(leg, false);
    runOrdinaryStopControl(leg, true);
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}

console.log(`\nT2-S generic Stop controls: ${passed} PASS, ${failed} FAIL`);
if (failed) process.exitCode = 1;

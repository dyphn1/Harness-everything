#!/usr/bin/env node
'use strict';

// #325 PR #351 review P2: withholding persistence must apply the credit decision in memory first (RED).
//
// Contract under test (docs/doc-workflow-reconciliation.md, "Persistence failure (PR #351 review P2)"):
// when the S1 pilot withholds credit at a boundary, the withholding decision is applied in memory first
// (aggregate verify becomes pending, a satisfied workflow becomes running, step:<verify>:pending is
// reported) and persisting that state is best-effort afterwards. A failed obligations-file write adds the
// diagnostic withhold-persist-failed and a reminder; it never escapes, never leaves persisted
// satisfied/PASS counting as credit, and never makes Stop exit non-zero.
//
// The seam is hooks/scripts/lib/workflow-obligations.js (withholdPilotVerification): it writes
// workflow-obligations.json through ./fable-contracts atomicWriteJson before flipping workflow.state. Each
// leg (source hooks/scripts and packaged plugins/harness-everything/hooks/scripts) is stubbed in require.cache
// — atomicWriteJson is replaced before that leg's workflow-obligations.js is required, so the stub throws on
// the obligations-file write only; the pilot report write still succeeds through the same stub. The context is
// an OFF-seeded satisfied workflow in a temporary git repository whose recorded scope is governed (the pilot
// baseline is captured through the runtime's own captureBaseline seam), assessed with the switch env exactly 1.
//
// This file grants no pilot credit: a FAIL is a real gap (exception escapes, state stays satisfied, the
// diagnostic is absent); PASS/FAIL/INFRA classification follows the mechanism suite convention
// (0 pass, 1 failed assertion, 2 infrastructure).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const OBLIGATION_FILE = 'workflow-obligations.json';
const PILOT_REPORT_FILE = 'doc-reconciliation-pilot.json';
const VERIFY_STEP_ID = 'req-verify';

const LEGS = [
  { id: 'source', lib: path.join(ROOT, 'hooks', 'scripts', 'lib') },
  { id: 'packaged', lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib') },
];

const GOVERNED_CONFIG = '{\n  "governed": [\n    { "path": "docs/adr/**", "role": "adr" }\n  ],\n  "domains": ["GRPH"]\n}\n';
const ADR_BASE = '# GRPH-001 Checkout retry\n\nStatus: accepted\n\nCheckout MUST retry once.\n';
const ADR_CANDIDATE = '# GRPH-001 Checkout retry\n\nStatus: accepted\n\nCheckout MUST retry twice.\n';
const REQUIREMENTS = JSON.stringify([
  { id: 'req-docs', stepType: 'behavior-change', summary: 'Update the ADR text', acceptance: 'normative ADR text is reviewed' },
  { id: VERIFY_STEP_ID, stepType: 'verification', summary: 'Verify the ADR change', acceptance: 'objective doc checks are recorded' },
]);

let passed = 0;
let failed = 0;
let infra = 0;

function record(status, id, detail) {
  if (status === 'PASS') passed += 1;
  else if (status === 'FAIL') failed += 1;
  else infra += 1;
  console.log(`  ${status} ${id}${detail ? ` — ${detail}` : ''}`);
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function git(cwd, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_AUTHOR_DATE = '2026-04-01T12:00:00Z';
  env.GIT_COMMITTER_DATE = '2026-04-01T12:00:00Z';
  return execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeFile(dir, relative, content) {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

// A temporary git repository with a governed document diff, mirroring the fixture materialisation:
// the baseline definitions are committed, then the candidate ADR becomes the working tree, so the
// recorded scope is governed while the workflow itself was seeded satisfied without the pilot.
function buildGovernedWorkspace(dir) {
  writeFile(dir, '.agents/harness-everything/project-docs.json', GOVERNED_CONFIG);
  writeFile(dir, 'docs/adr/GRPH-001.md', ADR_BASE);
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=harness-review', '-c', 'user.email=harness-review@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
  writeFile(dir, 'docs/adr/GRPH-001.md', ADR_CANDIDATE);
}

// Installs the stub in require.cache before that leg's workflow-obligations.js is required, then loads
// the leg fresh. armed=0 keeps writes succeeding (control); armed=1 throws on the obligations-file
// write only and stashes the payload the withholding decision tried to persist. Returns a restore handle.
function installLeg(leg) {
  const contractsFile = path.join(leg.lib, 'fable-contracts.js');
  const state = { armed: false, lastFailedWrite: null };
  const cached = new Map();
  for (const key of Object.keys(require.cache)) {
    if (key === leg.lib || key.startsWith(leg.lib + path.sep)) {
      cached.set(key, require.cache[key]);
      delete require.cache[key];
    }
  }
  const contracts = require(contractsFile);
  const originalWrite = contracts.atomicWriteJson;
  contracts.atomicWriteJson = (target, value) => {
    if (state.armed && path.basename(String(target)) === OBLIGATION_FILE) {
      state.lastFailedWrite = value;
      throw new Error('simulated obligations-file write failure (PR #351 review P2)');
    }
    return originalWrite(target, value);
  };
  const restore = () => {
    contracts.atomicWriteJson = originalWrite;
    for (const key of Object.keys(require.cache)) {
      if (key === leg.lib || key.startsWith(leg.lib + path.sep)) delete require.cache[key];
    }
    for (const [key, module] of cached) require.cache[key] = module;
  };
  try {
    const obligations = require(path.join(leg.lib, 'workflow-obligations.js'));
    return { state, restore, obligations, contracts };
  } catch (error) {
    restore();
    throw error;
  }
}

// Builds an ON context with an OFF-seeded satisfied workflow whose scope is governed, through the leg's own
// planning API; the pilot baseline is captured through captureBaseline. Must never fault behind the assertions.
function seedLegScenario(leg, handle, dir) {
  const plan = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
  const sessionDir = path.join(dir, 'session');
  fs.mkdirSync(sessionDir, { recursive: true });
  buildGovernedWorkspace(dir);
  const context = {
    sessionId: 's1-review-persist-' + leg.id,
    sessionDir,
    root: dir,
    workflow: {
      workflowId: 'wf-325b1-review-' + leg.id,
      revision: 1,
      state: 'satisfied',
      strategy: 'iterative-single',
      workflowPlan: plan,
    },
  };
  handle.obligations.initializePlanningContract(context, plan);
  handle.obligations.recordPlanning(context, REQUIREMENTS, plan, 'iterative-single',
    'two dependent requirements fit a bounded documentation loop');
  handle.obligations.materializeExecutionObligations(context, plan);
  const seeded = handle.obligations.loadObligationSet(context, plan).set;
  if (!seeded) throw new Error(`[${leg.id}] seeding failed: obligation set invalid after planning`);
  for (const step of seeded.requirements) {
    step.status = 'pass';
    step.evidence = 'seeded-off-pass';
    for (const binding of [...step.requiredBindings, ...step.optionalBindings]) binding.status = 'loaded';
  }
  for (const obligation of seeded.obligations) {
    obligation.status = 'pass';
    obligation.evidence = 'seeded-off-pass';
    obligation.reasonCode = null;
    obligation.scope = null;
  }
  seeded.activeStepId = handle.obligations.activeStepSnapshot(seeded)?.id || null;
  handle.contracts.atomicWriteJson(handle.obligations.obligationPath(sessionDir), seeded);
  const pilot = require(path.join(leg.lib, 'doc-reconciliation-pilot.js'));
  pilot.captureBaseline(context);
  if (!context.workflow.docReconciliationBaseline) {
    throw new Error(`[${leg.id}] seeding failed: captureBaseline recorded no baseline`);
  }
  context.workflow.state = 'satisfied';
  return { context, plan };
}

function withCapturedStderr(fn) {
  const chunks = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = function (chunk, ...rest) {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return originalWrite.call(process.stderr, chunk, ...rest);
  };
  try {
    return { value: fn(), stderr: chunks.join('') };
  } finally {
    process.stderr.write = originalWrite;
  }
}

// One scenario: seed, arm, call, and the four observation shapes. Returns { error, unresolved, stderr } —
// never throws except for infrastructure (seed failures), which the caller records as INFRA.
function runLegScenario(leg, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-review-'));
  let handle = null;
  try {
    handle = installLeg(leg);
    const seeded = seedLegScenario(leg, handle, dir);
    const { context, plan } = seeded;
    handle.state.armed = mode === 'fail-write';
    let thrown = null;
    let unresolved;
    let stderr = '';
    const call = withCapturedStderr(() => {
      try { return handle.obligations.unresolvedObligations(context); }
      catch (error) { thrown = error; return null; }
    });
    stderr = call.stderr;
    unresolved = call.value;
    handle.state.armed = false;
    // Capture the persisted state before the temporary directory is cleaned up. In the control leg the
    // write succeeded, so disk reflects the in-memory decision; in the fail-write leg the failed write is
    // observed through the stub's stash of the exact in-memory payload it was asked to persist.
    const verifyOnDisk = (readJsonOrNull(path.join(context.sessionDir, OBLIGATION_FILE))?.obligations || [])
      .find(item => item.id === 'verify') || null;
    const reportDiagnostics = readJsonOrNull(path.join(context.sessionDir, PILOT_REPORT_FILE))?.diagnostics || null;
    return {
      panicked: thrown && { message: thrown.message, stack: String(thrown.stack || '').split('\n').slice(0, 4).join(' | ') } || null,
      unresolved, context, plan, stderr, reportDiagnostics, verifyOnDisk, loaded: handle.state.lastFailedWrite,
    };
  } finally {
    if (handle) handle.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function diagnosePersistence(leg, mode, scenario) {
  const tag = `${leg.id}.${mode}`;
  if (!scenario || !scenario.context) {
    record('INFRA', `${tag}.scenario`, 'seed or load failed; scenario not observable');
    return;
  }
  const verifyOnDisk = scenario.verifyOnDisk || null;
  const verifyInMemory = scenario.loaded
    ? (scenario.loaded.obligations?.find(item => item.id === 'verify') || null)
    : verifyOnDisk;
  const diagnosticSeen = String(scenario.stderr).includes('withhold-persist-failed')
    || (Array.isArray(scenario.reportDiagnostics) && scenario.reportDiagnostics.includes('withhold-persist-failed'));
  record(scenario.panicked === null ? 'PASS' : 'FAIL', `${tag}.no-escape`,
    scenario.panicked ? `exception escaped unresolvedObligations: ${scenario.panicked.message}` : '');
  record(scenario.context.workflow.state === 'running' ? 'PASS' : 'FAIL', `${tag}.state-running`,
    `workflow.state ${JSON.stringify(scenario.context.workflow.state)} where "running" desired`);
  record(Array.isArray(scenario.unresolved) && scenario.unresolved.includes('step:' + VERIFY_STEP_ID + ':pending') ? 'PASS' : 'FAIL',
    `${tag}.step-pending-reported`,
    `unresolved ${JSON.stringify(scenario.unresolved)} lacks step:${VERIFY_STEP_ID}:pending`);
  record(verifyInMemory?.status === 'pending' ? 'PASS' : 'FAIL', `${tag}.verify-pending`,
    `verify obligation ${JSON.stringify(verifyInMemory?.status)} where "pending" desired`);
  if (mode !== 'control') {
    record(diagnosticSeen ? 'PASS' : 'FAIL', `${tag}.persist-failed-diagnostic`,
      'withhold-persist-failed diagnostic absent from stderr and pilot report');
  }
}

console.log('=== #325 PR #351 review P2: withholding persistence applied in memory first (RED) ===');

const switchSaved = process.env[SWITCH];
const harnessEnvSaved = {};
for (const key of Object.keys(process.env)) {
  if (key.startsWith('HARNESS_') && key !== SWITCH) {
    harnessEnvSaved[key] = process.env[key];
    delete process.env[key];
  }
}
process.env[SWITCH] = '1';

try {
  for (const leg of LEGS) {
    for (const mode of ['fail-write', 'control']) {
      let scenario = null;
      try {
        scenario = runLegScenario(leg, mode);
      } catch (error) {
        record('INFRA', `${leg.id}.${mode}.scenario`, error.message.split('\n')[0]);
        continue;
      }
      diagnosePersistence(leg, mode, scenario);
    }
  }
} finally {
  if (switchSaved === undefined) delete process.env[SWITCH];
  else process.env[SWITCH] = switchSaved;
  for (const [key, value] of Object.entries(harnessEnvSaved)) process.env[key] = value;
}

const persistenceCounts = { passed, failed, infra };

console.log(`\nP2 persistence review summary: ${persistenceCounts.passed} PASS, ${persistenceCounts.failed} FAIL, ${persistenceCounts.infra} INFRA across ${LEGS.length} legs (pilotCredit: false)`);

// ---- R1f section: "Unwritable session store (PR #351 follow-up)" — integration through the real Stop entry point ----
//
// Both obligations and SaveWorkflow persistence are made to fail for one Stop invocation, by preloading
// fail-session-writes.js onto the real stop-gate child through a real argv element (`node --require <path>`).
// The preload makes every
// write/rename/open-for-write/unlink inside that run's session directory throw EACCES (patching fs synchron,
// fs.promises and the callback wrappers) without chmod, and nothing else. Contract (docs table):
// Stop exits 0, the Unresolved-workflow-evidence reminder with step:<verify>:pending and a
// withhold-persist-failed diagnostic are still emitted after the failed saveWorkflow, no uncaught exception
// text appears, the stored files stay byte-identical (the write really failed), and the stored satisfied/PASS
// is never confused for credit by an ON disposition attempt. Only a completely unwritable store is under test:
// the in-memory downgrade is explicitly not counted as durable invalidation.
//
// R1g (PR #351 re-review, "Scope of the recovery") addenda in this section:
//   - P2a legacy oracle: with the switch OFF (satisfied workflow, legacy pending token) and for a
//     Fable-strategy workflow ON (unsupported ⇒ legacy path), a failing saveWorkflow() must keep the
//     pre-S1 Stop behaviour: the same exit code and stderr as the pre-PR Stop file run over the same
//     scenario, and no withhold-persist-failed diagnostic.
//   - P2b oracle gap: the exit-2 disposition probe is renamed legacy-closed-guard-exit-2 so it is no
//     longer counted as pilot evidence; a pilot-specific ON-Stop-rerun oracle plus an OFF negative
//     control carry the pilot claim instead.

const { spawnSync: r1fSpawnSync } = require('child_process');
const R1F_PRELOAD = path.join(ROOT, 'ci', 'fixtures', 'doc-obligations', 'reconciliation-s1', 'fail-session-writes.js');
const R1F_SESSION_ENV = 'HARNESS_S1_REVIEW_SESSION_DIR';
const R1F_WORKFLOW_FILE = 'workflow-run.json';

const R1F_LEGS = [
  {
    id: 'source',
    root: ROOT,
    kernel: path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js'),
    controller: path.join(ROOT, 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(ROOT, 'hooks', 'scripts', 'workflow-stop-gate.js'),
  },
  {
    id: 'packaged',
    root: path.join(ROOT, 'plugins', 'harness-everything'),
    kernel: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'kernel-router.js'),
    controller: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'workflow-stop-gate.js'),
  },
];

function r1fScrub(text, tokens) {
  let out = String(text ?? '');
  for (const token of tokens) out = out.split(token).join('<tmp>');
  return out;
}

function r1fBuildWorkspace(dir) {
  writeFile(dir, '.agents/harness-everything/project-docs.json', GOVERNED_CONFIG);
  writeFile(dir, 'docs/adr/GRPH-001.md', ADR_BASE);
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=harness-review', '-c', 'user.email=harness-review@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
  writeFile(dir, 'docs/adr/GRPH-001.md', ADR_CANDIDATE);
}

// Isolated child environment mirroring the replay helper: no inherited HARNESS switches, explicit state
// home and workspace root; the pilot switch is added only where named. NODE_OPTIONS is cleared so an
// inherited value from the parent cannot add or strip the preload.
function r1fChildEnv(dir, stateHome, options) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('HARNESS_')) delete env[key];
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.PLUGIN_ROOT;
  delete env.NODE_OPTIONS;
  env.HARNESS_STATE_HOME = stateHome;
  env.HARNESS_WORKSPACE_ROOT = dir;
  if (options.pilot !== undefined) env[SWITCH] = String(options.pilot);
  if (options.sessionDirectory) env[R1F_SESSION_ENV] = options.sessionDirectory;
  return env;
}

// The preload is passed as a real argv element (`node --require <path> <script>`), never through
// NODE_OPTIONS: option values there are tokenised at spaces, so a checkout or temp directory with a
// space in its name would demand a truncated module path. argv elements need no quoting.
function r1fSpawnPreloadArgs(options) {
  if (!options.preload) return [];
  const preloadPath = typeof options.preload === 'string' ? options.preload : R1F_PRELOAD;
  return ['--require', preloadPath];
}

function r1fSpawn(leg, script, args, dir, stateHome, options = {}) {
  return r1fSpawnSync(process.execPath, [...r1fSpawnPreloadArgs(options), script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input: options.input === undefined ? undefined : JSON.stringify(options.input),
    env: r1fChildEnv(dir, stateHome, options),
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

// Seeds a stored satisfied workflow with stored verify pass through the leg's real CLI entry points, with
// the pilot switch OFF: route → plan → start → both bindings → both step passes → an OFF Stop.
function r1fSeedSatisfied(leg, dir, stateHome, sessionId) {
  let result = r1fSpawn(leg, leg.kernel, [], dir, stateHome, {
    input: { session_id: sessionId, cwd: dir, prompt: 'Fix this checkout bug and add a regression test.' },
  });
  if (result.status !== 0) return { fault: 'route: ' + (result.stderr || '').split('\n')[0] };
  const args = (command, stepId, extra) => [
    command, '--session-id', sessionId,
    ...(stepId ? ['--step-id', stepId] : []), ...extra,
  ];
  result = r1fSpawn(leg, leg.controller, args('plan', null, [
    '--requirements-json', REQUIREMENTS, '--strategy', 'iterative-single',
    '--evidence', 'two dependent requirements fit a bounded documentation loop',
  ]), dir, stateHome);
  if (result.status !== 0) return { fault: 'plan: ' + (result.stderr || '').split('\n')[0] };
  result = r1fSpawn(leg, leg.controller, args('start', null, []), dir, stateHome);
  if (result.status !== 0) return { fault: 'start: ' + (result.stderr || '').split('\n')[0] };
  for (const [stepId, bindingId] of [['req-docs', 'tdd'], [VERIFY_STEP_ID, 'verification-loop']]) {
    result = r1fSpawn(leg, leg.controller, args('binding', stepId, ['--binding-id', bindingId, '--disposition', 'loaded', '--evidence', 'located']), dir, stateHome);
    if (result.status !== 0) return { fault: `binding ${stepId}: ` + (result.stderr || '').split('\n')[0] };
    result = r1fSpawn(leg, leg.controller, args('step', stepId, ['--disposition', 'pass', '--evidence', 'seeded-off-pass']), dir, stateHome);
    if (result.status !== 0) return { fault: `step ${stepId}: ` + (result.stderr || '').split('\n')[0] };
  }
  result = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, { input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' } });
  if (result.status !== 0) return { fault: 'seed-stop: ' + (result.stderr || '').split('\n')[0] };
  return { fault: null };
}

// The session directory inside the isolated state home: exactly one workspace key must contain it.
function r1fFindSessionDir(stateHome, sessionId) {
  const workspacesRoot = path.join(stateHome, 'workspaces');
  const found = [];
  let entries = [];
  try { entries = fs.readdirSync(workspacesRoot, { withFileTypes: true }); } catch (_) {
    return null;
  }
  for (const entry of entries.filter(item => item.isDirectory())) {
    const candidate = path.join(workspacesRoot, entry.name, 'state', 'sessions', sessionId);
    if (fs.existsSync(path.join(candidate, R1F_WORKFLOW_FILE))) found.push(candidate);
  }
  return found.length === 1 ? found[0] : null;
}

function r1fStoredWorkflow(sessionDir) {
  return readJsonOrNull(path.join(sessionDir, R1F_WORKFLOW_FILE));
}

// One integration scenario: seed OFF, run the real Stop entry point (child) with the switch ON.
function r1fRunScenario(leg, mode) {
  const tag = `${leg.id}.${mode === 'fail' ? 'unwritable' : 'writable-control'}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1f-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1f-state-'));
  const sessionId = 's1-review-r1f-' + leg.id;
  const tokens = [dir, stateHome];
  let spacedPreloadDirForCleanup = null;
  try {
    if (!fs.existsSync(R1F_PRELOAD)) {
      record('INFRA', `${tag}.preload`, 'fail-session-writes.js preload not found at ' + R1F_PRELOAD);
      return;
    }
    r1fBuildWorkspace(dir);
    const seeded = r1fSeedSatisfied(leg, dir, stateHome, sessionId);
    if (seeded.fault) {
      record('INFRA', `${tag}.scenario`, 'seed failed: ' + r1fScrub(seeded.fault, tokens));
      return;
    }
    const sessionDir = r1fFindSessionDir(stateHome, sessionId);
    if (!sessionDir) {
      record('INFRA', `${tag}.scenario`, 'the OFF-seeded session directory was not found (expected exactly one)');
      return;
    }
    const stored = r1fStoredWorkflow(sessionDir);
    const storedObligations = readJsonOrNull(path.join(sessionDir, OBLIGATION_FILE));
    if (!stored || stored.state !== 'satisfied'
      || storedObligations?.obligations?.find(item => item.id === 'verify')?.status !== 'pass') {
      record('INFRA', `${tag}.scenario`,
        `seed did not leave stored satisfied/verify-pass (workflow ${JSON.stringify(stored?.state)}, verify ${JSON.stringify(storedObligations?.obligations?.find(item => item.id === 'verify')?.status)})`);
      return;
    }
    const before = {
      run: fs.readFileSync(path.join(sessionDir, R1F_WORKFLOW_FILE), 'utf8'),
      obligations: fs.readFileSync(path.join(sessionDir, OBLIGATION_FILE), 'utf8'),
    };
    const stopResult = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, {
      pilot: 1,
      preload: mode === 'fail',
      sessionDirectory: mode === 'fail' ? sessionDir : undefined,
      input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' },
    });
    const stderr = stopResult.stderr || '';
    record(stopResult.status === 0 ? 'PASS' : 'FAIL', `${tag}.stop-exit-0`,
      stopResult.status === 0 ? '' : `exit ${stopResult.status} where 0 desired`);
    if (mode === 'fail') {
      record(stderr.includes('Unresolved workflow evidence') ? 'PASS' : 'FAIL', `${tag}.reminder-unresolved-evidence`,
        stderr.includes('Unresolved workflow evidence') ? '' : 'the Unresolved workflow evidence reminder is missing after the failed saveWorkflow');
      record(stderr.includes('step:' + VERIFY_STEP_ID + ':pending') ? 'PASS' : 'FAIL', `${tag}.reminder-step-pending`,
        stderr.includes('step:' + VERIFY_STEP_ID + ':pending') ? '' : 'step:req-verify:pending absent from the Stop reminder');
      record(stderr.includes('withhold-persist-failed') ? 'PASS' : 'FAIL', `${tag}.persist-failed-diagnostic`,
        stderr.includes('withhold-persist-failed') ? '' : 'withhold-persist-failed diagnostic absent from Stop stderr');
      const exceptionText = stderr.includes('EACCES') || stderr.includes('simulated session store');
      record(exceptionText ? 'FAIL' : 'PASS', `${tag}.no-exception-text`,
        exceptionText ? 'exception text reached stderr: ' + r1fScrub(stderr.trim().split('\n').find(line => line.includes('EACCES') || line.includes('simulated session store')) || '', tokens) : '');
      const afterBytes = {
        run: fs.readFileSync(path.join(sessionDir, R1F_WORKFLOW_FILE), 'utf8'),
        obligations: fs.readFileSync(path.join(sessionDir, OBLIGATION_FILE), 'utf8'),
      };
      record(afterBytes.run === before.run && afterBytes.obligations === before.obligations ? 'PASS' : 'FAIL',
        `${tag}.stored-bytes-identical`,
        afterBytes.run === before.run && afterBytes.obligations === before.obligations
          ? '' : 'the unwritable session store changed: the failed write is not proven');
      // P3 preload-path portability: copy the preload into a temp directory whose name contains a space
      // and run one fail-mode Stop child through the same spawn helper. The preload must still load —
      // writes fail (reminder text and the withheld decision are on stderr) and the stored files stay
      // byte-identical — instead of an infrastructure `Cannot find module` failure. The preload path is
      // passed as a real argv element (see r1fSpawnPreloadArgs), which needs no quoting.
      const spacedPreloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness preload space-'));
      spacedPreloadDirForCleanup = spacedPreloadDir;
      const spacedPreload = path.join(spacedPreloadDir, 'fail-session-writes.js');
      fs.copyFileSync(R1F_PRELOAD, spacedPreload);
      const spaceStop = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, {
        pilot: 1,
        preload: spacedPreload,
        sessionDirectory: sessionDir,
        input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' },
      });
      const spaceStderr = spaceStop.stderr || '';
      record(spaceStop.status === 0 ? 'PASS' : 'FAIL', `${tag}.preload-space.stop-exit-0`,
        spaceStop.status === 0 ? '' : `exit ${spaceStop.status} where 0 desired; stderr ${r1fScrub(spaceStderr.trim(), [spacedPreloadDir]).slice(0, 140)}`);
      const spaceLoaded = spaceStderr.includes('Unresolved workflow evidence')
        && spaceStderr.includes('step:' + VERIFY_STEP_ID + ':pending')
        && spaceStderr.includes('withhold-persist-failed');
      record(spaceLoaded ? 'PASS' : 'FAIL', `${tag}.preload-space.reminder-and-diagnostic`,
        spaceLoaded ? '' : `preloaded child did not run the withheld path: ${r1fScrub(spaceStderr.trim(), [spacedPreloadDir]).slice(0, 160)}`);
      const spaceBytes = {
        run: fs.readFileSync(path.join(sessionDir, R1F_WORKFLOW_FILE), 'utf8'),
        obligations: fs.readFileSync(path.join(sessionDir, OBLIGATION_FILE), 'utf8'),
      };
      record(spaceBytes.run === before.run && spaceBytes.obligations === before.obligations ? 'PASS' : 'FAIL',
        `${tag}.preload-space.stored-bytes-identical`,
        spaceBytes.run === before.run && spaceBytes.obligations === before.obligations ? '' : 'the spaced-preload child did not fail its session writes: the preload did not load');
    } else {
      record(stderr.includes('Unresolved workflow evidence') && stderr.includes('step:' + VERIFY_STEP_ID + ':pending') ? 'PASS' : 'FAIL',
        `${tag}.reminder-present`,
        stderr.includes('Unresolved workflow evidence') && stderr.includes('step:' + VERIFY_STEP_ID + ':pending') ? '' : 'reminder or pending token missing on the writable control');
    }
    // ON disposition attempt with the switch on, no preload. Over the fail mode, the stored files still
    // say satisfied/verify:pass (the writes failed); over the control, Stop persisted the downgrade.
    const disposition = r1fSpawn(leg, leg.controller, [
      'step', '--session-id', sessionId, '--step-id', VERIFY_STEP_ID, '--disposition', 'pass', '--evidence', 'attempt over stored state',
    ], dir, stateHome, { pilot: 1 });
    // P2b oracle-gap fix: this probe proves only the legacy closed-workflow guard (the CLI's OPEN_STATES
    // rule and updateStep's active-step rules over a closed/finished plan); it is NOT pilot evidence and
    // is not counted as such. The pilot-specific oracle below carries that claim instead.
    record(disposition.status === 2 ? 'PASS' : 'FAIL', `${tag}.legacy-closed-guard-exit-2`,
      disposition.status === 2 ? `refused: ${r1fScrub((disposition.stderr || '').trim(), tokens).slice(0, 120)}` : `exit ${disposition.status} where 2 desired`);
    if (mode === 'fail') {
      // P2b pilot-specific oracle: after the failed ON Stop, restore write access and run the real Stop
      // entry point ON again. The ON re-read must re-derive the withheld decision from scratch: reminder
      // with step:<verify>:pending, the stored workflow becomes running, and the runtime pilot report
      // carries pilotCredit false with a non-empty unsatisfied list (never trust stored PASS as credit).
      const rerun = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, {
        pilot: 1,
        input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' },
      });
      const rerunStderr = rerun.stderr || '';
      record(rerun.status === 0 && rerunStderr.includes('Unresolved workflow evidence') && rerunStderr.includes('step:' + VERIFY_STEP_ID + ':pending') ? 'PASS' : 'FAIL',
        `${leg.id}.p2b-on-rerun.reminder-pending`,
        rerun.status === 0 && rerunStderr.includes('Unresolved workflow evidence') && rerunStderr.includes('step:' + VERIFY_STEP_ID + ':pending') ? '' : `exit ${rerun.status}, stderr ${r1fScrub(rerunStderr.trim(), tokens).slice(0, 140)} where reminder step:req-verify:pending desired`);
      const rerunStored = r1fStoredWorkflow(sessionDir);
      record(rerunStored?.state === 'running' ? 'PASS' : 'FAIL', `${leg.id}.p2b-on-rerun.stored-running`,
        rerunStored?.state === 'running' ? '' : `stored workflow.state ${JSON.stringify(rerunStored?.state)} where "running" desired`);
      const rerunReport = readJsonOrNull(path.join(sessionDir, PILOT_REPORT_FILE));
      record(rerunReport && rerunReport.reportOrigin === 'runtime' && rerunReport.pilotCredit === false ? 'PASS' : 'FAIL',
        `${leg.id}.p2b-on-rerun.pilot-credit-false`,
        rerunReport && rerunReport.reportOrigin === 'runtime' && rerunReport.pilotCredit === false ? '' : `pilot report ${JSON.stringify(rerunReport ? { origin: rerunReport.reportOrigin, credit: rerunReport.pilotCredit } : null)} where {origin runtime, credit false} desired`);
      record(rerunReport && Array.isArray(rerunReport.unsatisfied) && rerunReport.unsatisfied.length > 0 ? 'PASS' : 'FAIL',
        `${leg.id}.p2b-on-rerun.unsatisfied-nonempty`,
        rerunReport && Array.isArray(rerunReport.unsatisfied) && rerunReport.unsatisfied.length > 0 ? '' : `unsatisfied ${JSON.stringify(rerunReport?.unsatisfied)} where a non-empty list desired`);
      return;
    }
    // Writable control: the durable downgrade is persisted and claimed (already passing at this head).
    const reread = r1fStoredWorkflow(sessionDir);
    record(reread?.state === 'running' ? 'PASS' : 'FAIL', `${tag}.stored-running`,
      reread?.state === 'running' ? '' : `stored workflow.state ${JSON.stringify(reread?.state)} where "running" desired`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
    if (spacedPreloadDirForCleanup) fs.rmSync(spacedPreloadDirForCleanup, { recursive: true, force: true });
  }
}

// Item 4, observable-report form: ON verification-step PASS through the real disposition CLI over a seeded
// running workflow (its stored verify step still pending), so the pilot assess runs and writes the runtime
// pilot report; assert exit 2 with pilotCredit false. On this head both item-4 probes already pass.
function r1fRunOnVerifyRefusal(leg) {
  const tag = `${leg.id}.on-verify-refusal`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1f-refusal-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1f-refusal-state-'));
  const sessionId = 's1-review-r1f-verify-' + leg.id;
  const tokens = [dir, stateHome];
  try {
    r1fBuildWorkspace(dir);
    let result = r1fSpawn(leg, leg.kernel, [], dir, stateHome, {
      input: { session_id: sessionId, cwd: dir, prompt: 'Fix this checkout bug and add a regression test.' },
    });
    if (result.status !== 0) return record('INFRA', `${tag}.scenario`, 'route: ' + r1fScrub((result.stderr || '').split('\n')[0], tokens));
    result = r1fSpawn(leg, leg.controller, [
      'plan', '--session-id', sessionId,
      '--requirements-json', REQUIREMENTS, '--strategy', 'iterative-single',
      '--evidence', 'two dependent requirements fit a bounded documentation loop',
    ], dir, stateHome);
    if (result.status !== 0) return record('INFRA', `${tag}.scenario`, 'plan: ' + r1fScrub((result.stderr || '').split('\n')[0], tokens));
    result = r1fSpawn(leg, leg.controller, ['start', '--session-id', sessionId], dir, stateHome);
    if (result.status !== 0) return record('INFRA', `${tag}.scenario`, 'start: ' + r1fScrub((result.stderr || '').split('\n')[0], tokens));
    result = r1fSpawn(leg, leg.controller, ['binding', '--session-id', sessionId, '--step-id', 'req-docs', '--binding-id', 'tdd', '--disposition', 'loaded', '--evidence', 'located'], dir, stateHome);
    if (result.status !== 0) return record('INFRA', `${tag}.scenario`, 'binding: ' + r1fScrub((result.stderr || '').split('\n')[0], tokens));
    result = r1fSpawn(leg, leg.controller, ['step', '--session-id', sessionId, '--step-id', 'req-docs', '--disposition', 'pass', '--evidence', 'added'], dir, stateHome);
    if (result.status !== 0) return record('INFRA', `${tag}.scenario`, 'step: ' + r1fScrub((result.stderr || '').split('\n')[0], tokens));
    result = r1fSpawn(leg, leg.controller, ['binding', '--session-id', sessionId, '--step-id', VERIFY_STEP_ID, '--binding-id', 'verification-loop', '--disposition', 'loaded', '--evidence', 'located'], dir, stateHome);
    if (result.status !== 0) return record('INFRA', `${tag}.scenario`, 'binding2: ' + r1fScrub((result.stderr || '').split('\n')[0], tokens));
    result = r1fSpawn(leg, leg.controller, ['step', '--session-id', sessionId, '--step-id', VERIFY_STEP_ID, '--disposition', 'pass', '--evidence', 'objective check attempted'], dir, stateHome, { pilot: 1 });
    record(result.status === 2 ? 'PASS' : 'FAIL', `${tag}.exit-2`,
      result.status === 2 ? `refused: ${r1fScrub((result.stderr || '').trim(), tokens).slice(0, 120)}` : `exit ${result.status} where 2 desired`);
    const sessionDir = r1fFindSessionDir(stateHome, sessionId);
    const report = sessionDir ? readJsonOrNull(path.join(sessionDir, PILOT_REPORT_FILE)) : null;
    record(report && report.pilotCredit === false && report.reportOrigin === 'runtime' ? 'PASS' : 'FAIL', `${tag}.pilot-credit-false`,
      report && report.pilotCredit === false && report.reportOrigin === 'runtime' ? '' : `pilot report ${JSON.stringify(report ? { origin: report.reportOrigin, credit: report.pilotCredit } : null)} where {origin runtime, credit false} desired`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
}

// ---- R1g: legacy-oracle and negative-control runners (PR #351 re-review) ----

const R1G_LEGACY_REFERENCES = {
  // git revision:tree-path strings, read-only `git show` sources — not local file paths.
  source: [ // portability-lint: allow git revision reference, not a local path
    '5f9726c:hooks/scripts/workflow-stop-gate.js', // portability-lint: allow git revision reference, not a local path
  ],
  packaged: [ // portability-lint: allow git revision reference, not a local path
    '5f9726c:plugins/harness-everything/hooks/scripts/workflow-stop-gate.js', // portability-lint: allow git revision reference, not a local path
    '5f9726c:hooks/scripts/workflow-stop-gate.js', // portability-lint: allow git revision reference, not a local path
  ],
};

// Byte copy of the pre-PR Stop entry point from git history (read-only git access).
function r1gLegacyStopSource(leg) {
  for (const reference of R1G_LEGACY_REFERENCES[leg.id]) {
    const result = r1fSpawnSync('git', ['show', reference], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    if (result.status === 0 && String(result.stdout || '').includes('workflow')) return String(result.stdout);
  }
  return null;
}

// Faithful legacy reference: the pre-PR Stop file written into a scratch copy sitting beside the leg's
// own supporting tree, so the legacy file's './lib/*' requires resolve to the same modules the current
// Stop uses. The stop-gate file is the only changed layer; for the OFF and Fable paths the current lib's
// pilot additions are inert (switch OFF / unsupported strategy), so this composite reproduces pre-S1
// behaviour. The scratch tree is temporary, outside the repo, and removed again.
function r1gBuildLegacyScratch(leg, source) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1g-legacy-'));
  fs.cpSync(path.join(leg.root, 'hooks', 'scripts'), path.join(scratch, 'hooks', 'scripts'), { recursive: true });
  fs.cpSync(path.join(leg.root, 'scripts'), path.join(scratch, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'hooks', 'scripts', 'workflow-stop-gate.js'), source);
  return { scratch, stopGate: path.join(scratch, 'hooks', 'scripts', 'workflow-stop-gate.js') };
}

function r1gNormalise(text, tokens) {
  return r1fScrub(text, tokens).replace(/\.json\.\d+\.\d+\.tmp/g, '.json.tmp');
}

// Seeds the P2a fable variant: route → plan(fable-staged), no start (stage-contracted starts are
// refused); Stop then takes the pending path through 'correlated-run-missing' with the pilot
// unsupported for the Fable strategy.
function r1gSeedFablePending(leg, dir, stateHome, sessionId) {
  let result = r1fSpawn(leg, leg.kernel, [], dir, stateHome, {
    input: { session_id: sessionId, cwd: dir, prompt: 'Fix this checkout bug and add a regression test.' },
  });
  if (result.status !== 0) return 'route: ' + (result.stderr || '').split('\n')[0];
  result = r1fSpawn(leg, leg.controller, [
    'plan', '--session-id', sessionId,
    '--requirements-json', REQUIREMENTS, '--strategy', 'fable-staged',
    '--evidence', 'fable legacy-path probe',
  ], dir, stateHome);
  if (result.status !== 0) return 'plan: ' + (result.stderr || '').split('\n')[0];
  return null;
}

// P2a: legacy-oracle comparison through real child Stop processes. variant 'off-pending' seeds a stored
// satisfied workflow whose handoff records a later edit (a legacy pending token, pilot inert), switch
// OFF; variant 'fable-on' seeds a pending fable-staged plan, switch ON. Both legs run the current Stop
// and the pre-PR legacy Stop reference over the same unwritable (preloaded) session directory; the
// current Stop must keep the legacy exit code and legacy stderr and must not emit withhold-persist-failed.
function r1gRunLegacyOracle(leg, variant) {
  const tag = `${leg.id}.${variant === 'off-pending' ? 'p2a-off-pending' : 'p2a-fable-on'}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1g-' + (variant === 'off-pending' ? 'off-' : 'fable-')));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1g-' + (variant === 'off-pending' ? 'off-state-' : 'fable-state-')));
  const sessionId = 's1-review-r1g-' + (variant === 'off-pending' ? 'off' : 'fable') + '-' + leg.id;
  let scratch = null;
  try {
    const source = r1gLegacyStopSource(leg);
    if (!source) {
      record('INFRA', `${tag}.legacy-reference`, 'git show could not produce the pre-PR Stop file source');
      return;
    }
    const legacyScratch = r1gBuildLegacyScratch(leg, source);
    scratch = legacyScratch.scratch;
    const tokens = [dir, stateHome, scratch];
    let fault;
    if (variant === 'off-pending') {
      const seeded = r1fSeedSatisfied(leg, dir, stateHome, sessionId);
      fault = seeded.fault;
      if (!fault) {
        const sessionProbe = r1fFindSessionDir(stateHome, sessionId);
        if (sessionProbe) fs.writeFileSync(path.join(sessionProbe, 'handoff-state.json'), JSON.stringify({ lastEditAt: Date.now() + 10000 }));
        else fault = 'the OFF-seeded session directory was not found';
      }
    } else {
      fault = r1gSeedFablePending(leg, dir, stateHome, sessionId);
    }
    if (fault) {
      record('INFRA', `${tag}.scenario`, 'seed failed: ' + r1fScrub(String(fault), tokens));
      return;
    }
    const sessionDir = r1fFindSessionDir(stateHome, sessionId);
    if (!sessionDir) {
      record('INFRA', `${tag}.scenario`, 'the seeded session directory was not found (expected exactly one)');
      return;
    }
    if (!fs.existsSync(path.join(sessionDir, R1F_WORKFLOW_FILE))) {
      record('INFRA', `${tag}.scenario`, 'workflow-run.json missing from the seeded session directory');
      return;
    }
    const stopOptions = {
      preload: true,
      sessionDirectory: sessionDir,
      pilot: variant === 'fable-on' ? 1 : undefined,
      input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' },
    };
    const legacyRun = r1fSpawn(leg, legacyScratch.stopGate, [], dir, stateHome, stopOptions);
    const currentRun = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, stopOptions);
    if (!legacyRun || typeof legacyRun.status !== 'number' || legacyRun.status !== 0) {
      record('INFRA', `${tag}.legacy-reference`,
        'the legacy Stop reference did not run cleanly: ' + JSON.stringify(legacyRun ? legacyRun.status : null) + ' ' + r1fScrub(String(legacyRun?.stderr || '').split('\n')[0], tokens));
      return;
    }
    record(currentRun && currentRun.status === legacyRun.status ? 'PASS' : 'FAIL', `${tag}.exit-equal-legacy`,
      currentRun && typeof currentRun.status === 'number' ? '' : `current exit ${JSON.stringify(currentRun?.status)} where legacy exit ${legacyRun.status} desired`);
    const legacyStderr = r1gNormalise(legacyRun.stderr, tokens);
    const currentStderr = r1gNormalise(currentRun?.stderr, tokens);
    record(legacyStderr === currentStderr ? 'PASS' : 'FAIL', `${tag}.stderr-equal-legacy`,
      legacyStderr === currentStderr ? '' : `stderr differs from the pre-PR legacy reference; legacy ${JSON.stringify(legacyStderr.slice(0, 140))} vs current ${JSON.stringify(currentStderr.slice(0, 140))}`);
    record(currentStderr.includes('withhold-persist-failed') ? 'FAIL' : 'PASS', `${tag}.no-withhold-persist-failed`,
      currentStderr.includes('withhold-persist-failed') ? 'withhold-persist-failed emitted on the non-pilot path (OFF or unsupported Fable)' : '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// P2b negative control: the ON oracle's exact sequence with the switch OFF throughout. OFF keeps legacy
// state: both Stop runs exit 0, the stored workflow stays satisfied, no withhold-persist-failed diagnostic
// is emitted in either run, and no pilot report ever appears — so the ON rerun result provably comes from
// the pilot, not from the recovery itself.
function r1gRunOffNegative(leg) {
  const tag = `${leg.id}.p2b-off-negative`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1g-neg-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-r1g-neg-state-'));
  const sessionId = 's1-review-r1g-neg-' + leg.id;
  const tokens = [dir, stateHome];
  try {
    const seeded = r1fSeedSatisfied(leg, dir, stateHome, sessionId);
    if (seeded.fault) return record('INFRA', `${tag}.scenario`, 'seed failed: ' + r1fScrub(seeded.fault, tokens));
    const sessionDir = r1fFindSessionDir(stateHome, sessionId);
    if (!sessionDir) return record('INFRA', `${tag}.scenario`, 'the OFF-seeded session directory was not found');
    const first = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, {
      preload: true,
      sessionDirectory: sessionDir,
      input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' },
    });
    const second = r1fSpawn(leg, leg.stopGate, [], dir, stateHome, {
      input: { session_id: sessionId, cwd: dir, hook_event_name: 'Stop' },
    });
    if (first.status !== 0 || second.status !== 0) {
      return record('INFRA', `${tag}.scenario`, `Stop exits ${JSON.stringify(first.status)}, ${JSON.stringify(second.status)} where 0/0 desired`);
    }
    const stored = r1fStoredWorkflow(sessionDir);
    record(stored?.state === 'satisfied' ? 'PASS' : 'FAIL', `${tag}.still-satisfied`,
      stored?.state === 'satisfied' ? '' : `stored workflow.state ${JSON.stringify(stored?.state)} where "satisfied" desired`);
    const combined = (first.stderr || '') + (second.stderr || '');
    record(combined.includes('withhold-persist-failed') ? 'FAIL' : 'PASS', `${tag}.no-withhold-persist-failed`,
      combined.includes('withhold-persist-failed') ? 'withhold-persist-failed emitted although no pilot decision is active' : '');
    record(fs.existsSync(path.join(sessionDir, PILOT_REPORT_FILE)) ? 'FAIL' : 'PASS', `${tag}.no-pilot-report`,
      fs.existsSync(path.join(sessionDir, PILOT_REPORT_FILE)) ? 'doc-reconciliation-pilot.json exists although no pilot decision is active' : '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
}

function runR1fSection() {
  for (const leg of R1F_LEGS) {
    for (const mode of ['fail', 'control']) {
      try {
        r1fRunScenario(leg, mode);
      } catch (error) {
        record('INFRA', `${leg.id}.${mode}.crash`, error.message.split('\n')[0]);
      }
    }
    try {
      r1fRunOnVerifyRefusal(leg);
    } catch (error) {
      record('INFRA', `${leg.id}.on-verify-refusal.crash`, error.message.split('\n')[0]);
    }
    for (const variant of ['off-pending', 'fable-on']) {
      try {
        r1gRunLegacyOracle(leg, variant);
      } catch (error) {
        record('INFRA', `${leg.id}.${variant === 'off-pending' ? 'p2a-off-pending' : 'p2a-fable-on'}.crash`, error.message.split('\n')[0]);
      }
    }
    try {
      r1gRunOffNegative(leg);
    } catch (error) {
      record('INFRA', `${leg.id}.p2b-off-negative.crash`, error.message.split('\n')[0]);
    }
  }
}

runR1fSection();

const r1fCounts = {
  passed: passed - persistenceCounts.passed,
  failed: failed - persistenceCounts.failed,
  infra: infra - persistenceCounts.infra,
};
console.log(`\nR1f/R1g unwritable-session-store summary: ${r1fCounts.passed} PASS, ${r1fCounts.failed} FAIL, ${r1fCounts.infra} INFRA across ${R1F_LEGS.length} legs (pilotCredit: false)`);
console.log(`\nReview file summary (both sections): ${passed} PASS, ${failed} FAIL, ${infra} INFRA (pilotCredit: false)`);
if (infra > 0) {
  console.error('S1 review suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (failed > 0) {
  console.error('S1 review suite: assertion FAIL present (expected on the RED base; GREEN must clear every FAIL).');
  process.exitCode = 1;
} else {
  console.log('S1 review suite: all assertions PASS.');
}

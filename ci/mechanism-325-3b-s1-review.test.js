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

console.log(`\nP2 persistence review summary: ${passed} PASS, ${failed} FAIL, ${infra} INFRA across ${LEGS.length} legs (pilotCredit: false)`);
if (infra > 0) {
  console.error('P2 suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (failed > 0) {
  console.error('P2 suite: assertion FAIL present (expected on the RED base; GREEN must clear every FAIL).');
  process.exitCode = 1;
} else {
  console.log('P2 suite: all assertions PASS.');
}

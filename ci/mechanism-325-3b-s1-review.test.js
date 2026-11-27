#!/usr/bin/env node
'use strict';

// #325 PR #351 retained controls: closed-workflow refusal plus OFF/Fable and generic Stop failure behavior.
// Pilot withholding, E1 re-evaluation, and their dedicated recovery paths were retired. These controls replay
// the real source and packaged entry points and compare preserved OFF/Fable behavior with the historical Stop.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const PILOT_REPORT_FILE = 'doc-reconciliation-pilot.json';
const VERIFY_STEP_ID = 'req-verify';

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

// ---- Retained Stop controls: closed-workflow guard, OFF/Fable legacy behavior and OFF negative control ----

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

// Closed-workflow control through the real source or packaged CLI. The switch is set to 1 for the final
// attempt, but a completed workflow remains closed by the ordinary workflow contract.
function r1fRunClosedWorkflowGuard(leg) {
  const tag = `${leg.id}.legacy-closed-guard-exit-2`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-closed-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-325b1-closed-state-'));
  const sessionId = 's1-review-closed-' + leg.id;
  const tokens = [dir, stateHome];
  try {
    r1fBuildWorkspace(dir);
    const seeded = r1fSeedSatisfied(leg, dir, stateHome, sessionId);
    if (seeded.fault) {
      record('INFRA', `${tag}.scenario`, 'seed failed: ' + r1fScrub(seeded.fault, tokens));
      return;
    }
    const disposition = r1fSpawn(leg, leg.controller, [
      'step', '--session-id', sessionId, '--step-id', VERIFY_STEP_ID, '--disposition', 'pass', '--evidence', 'attempt over closed state',
    ], dir, stateHome, { pilot: 1 });
    record(disposition.status === 2 ? 'PASS' : 'FAIL', tag,
      disposition.status === 2 ? `refused: ${r1fScrub((disposition.stderr || '').trim(), tokens).slice(0, 120)}` : `exit ${disposition.status} where 2 desired`);
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

// OFF negative control: both Stop runs exit 0, the stored workflow stays satisfied, no
// withhold-persist-failed diagnostic is emitted, and no pilot report is written.
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

function runRetainedStopControls() {
  for (const leg of R1F_LEGS) {
    try {
      r1fRunClosedWorkflowGuard(leg);
    } catch (error) {
      record('INFRA', `${leg.id}.closed-workflow.crash`, error.message.split('\n')[0]);
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

runRetainedStopControls();

console.log(`\nReview retained controls summary: ${passed} PASS, ${failed} FAIL, ${infra} INFRA across ${R1F_LEGS.length} legs`);
if (infra > 0) {
  console.error('S1 review suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (failed > 0) {
  console.error('S1 review suite: retained assertion FAIL present.');
  process.exitCode = 1;
} else {
  console.log('S1 review suite: all assertions PASS.');
}

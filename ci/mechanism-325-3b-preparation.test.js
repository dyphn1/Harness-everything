#!/usr/bin/env node
'use strict';

// #325 Phase 3b preparation (H1+H2): fixture inventory, legacy controls, switch sanitation, source/package parity and
// the runner's infrastructure bounds. This suite asserts no runtime behaviour change and no pilot credit. The qualified
// RED runner, its frozen registry and the runtime-fingerprint and recapture checks are archived by F4-T2 under
// ci/archive/325-prep (historical evidence, see its README.md). The archived runner is still invoked here, only for its
// infrastructure path (exit 2, child deadline, output bound), which is live.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const fx = require('./lib/doc-reconciliation-prep-fixtures');
const runner = require('./archive/325-prep/doc-reconciliation-red.js');

const ROOT = path.resolve(__dirname, '..');
const PREP_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-prep');
const RUNNER = path.join(__dirname, 'archive', '325-prep', 'doc-reconciliation-red.js');
const corpus = fx.readCaseCorpus(path.join(PREP_DIR, 'cases.json'));
const registry = JSON.parse(fs.readFileSync(path.join(PREP_DIR, 'pending-red.json'), 'utf8'));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-recon-prep-suite-'));

const ALLOWED_OPS = new Set(['route', 'plan', 'start', 'binding', 'step', 'obligation', 'stop', 'provideEvidence', 'mutateIdentity', 'timestampHints']);
const ALLOWED_OPERATORS = new Set(['equals', 'notEquals', 'includes', 'absent']);
const REQUIRED_CASE_FIELDS = ['id', 'family', 'description', 'topology', 'requirements', 'input', 'actions', 'expectations'];
const SHARED_FILES = [
  ['hooks/scripts/lib/workflow-obligations.js', 'plugins/harness-everything/hooks/scripts/lib/workflow-obligations.js'],
  ['hooks/scripts/workflow-disposition.js', 'plugins/harness-everything/hooks/scripts/workflow-disposition.js'],
  ['hooks/scripts/workflow-stop-gate.js', 'plugins/harness-everything/hooks/scripts/workflow-stop-gate.js'],
  ['hooks/scripts/lib/doc-reconciliation-pilot.js', 'plugins/harness-everything/hooks/scripts/lib/doc-reconciliation-pilot.js'],
];

let failed = 0;
function check(condition, message) {
  if (condition) console.log('  PASS ' + message);
  else { console.error('  FAIL ' + message); failed++; }
}
function checkCase(name, runCase) {
  try { runCase(); check(true, name); } catch (error) { check(false, `${name}: ${error.message.split('\n')[0]}`); }
}
function runRunner(args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8' });
}

console.log('=== #325 3b preparation: corpus, legacy controls and infrastructure bounds (H1+H2) ===');

// locks: unresolved — fixture-shape control (corpus field shape); no A/B/C/R3 clause
checkCase('inventory: the H2 corpus covers P01-P07 with the L1 field shape', () => {
  const ids = corpus.cases.map(item => item.id);
  assert.deepStrictEqual(ids, ['P01', 'P04', 'P06', 'P02a', 'P02b', 'P02c', 'P02g', 'P02d', 'P02e', 'P02f', 'P03', 'P05', 'P07-fable-staged', 'P07-fable-parallel', 'P07-fable-multi-agent-workspace', 'P07u']);
  assert.strictEqual(new Set(ids).size, ids.length, 'case ids are unique');
  for (const item of corpus.cases) {
    for (const field of REQUIRED_CASE_FIELDS) assert.ok(item[field] !== undefined, `${item.id} has ${field}`);
    assert.deepStrictEqual(Object.keys(item.input).sort(), ['baseFiles', 'candidateFiles', 'config', 'hostEvents', 'task'], `${item.id} input keys`);
    const actionIds = item.actions.map(action => action.id);
    assert.strictEqual(new Set(actionIds).size, actionIds.length, `${item.id} action ids are unique`);
    for (const action of item.actions) assert.ok(ALLOWED_OPS.has(action.op), `${item.id} op ${action.op} is allowed`);
    for (const mode of ['off', 'on']) {
      const ids2 = item.expectations[mode].map(assertion => assertion.id);
      assert.strictEqual(new Set(ids2).size, ids2.length, `${item.id} ${mode} assertion ids are unique`);
      for (const assertion of item.expectations[mode]) {
        assert.ok(ALLOWED_OPERATORS.has(assertion.operator), `${item.id} operator ${assertion.operator}`);
        assert.ok(Array.isArray(assertion.path) && assertion.path.length > 0, `${item.id}.${assertion.id} has a path`);
      }
    }
  }
});

// Infrastructure rule: an abnormal action result is never a qualified gap. The controls start from one healthy replay
// set of P01 and change only the ON route result, so every other fault and assertion is the unmodified replay's.
const p01 = corpus.cases.find(item => item.id === 'P01');
const p01Entries = registry.entries.filter(entry => entry.caseId === 'P01');
const healthyP01 = runner.replayAll(p01);
const injectIntoRoute = (patch, legs = ['source', 'packaged']) => {
  const injected = JSON.parse(JSON.stringify(healthyP01));
  for (const leg of legs) Object.assign(injected.on[leg].actions.route, patch);
  return injected;
};

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('negative control: an abnormal route in P01 is infrastructure, and --expect-red exits nonzero though later assertions still match', () => {
  const injected = injectIntoRoute({ exitCode: 1 });
  const later = p01.expectations.on.filter(assertion => assertion.id.startsWith('verify-obligation') || assertion.id.startsWith('stop-'));
  for (const leg of ['source', 'packaged']) {
    const before = fx.evaluateAll(healthyP01.on[leg], later);
    const after = fx.evaluateAll(injected.on[leg], later);
    assert.deepStrictEqual(after.map(item => [item.id, item.pass, item.actual]), before.map(item => [item.id, item.pass, item.actual]),
      `${leg}: the later assertions evaluate exactly as in the unmodified replay`);
    for (const item of after) {
      assert.strictEqual(item.pass, true,
        `${leg}: ${item.id} remains strict S1 GREEN, so only the infrastructure rule can stop the replay`);
    }
  }
  const result = runner.classifyCase(p01, injected, p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE', `status ${result.status}`);
  assert.deepStrictEqual(result.infrastructure, ['source.on.route: exit 1 outside policy [0]', 'packaged.on.route: exit 1 outside policy [0]']);
  assert.deepStrictEqual(result.offending, { leg: 'source', mode: 'on', actionId: 'route', fault: 'exit 1 outside policy [0]' });
  assert.deepStrictEqual(result.assertions, [], 'no assertion is qualified or classified for an infrastructure case');
  assert.strictEqual(runner.exitCodeFor({ cases: [result] }, 'expect-red'), 2, 'expected-RED mode exits nonzero');
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('negative control: a route killed by a signal or without an exit status is infrastructure', () => {
  const result = runner.classifyCase(p01, injectIntoRoute({ exitCode: null, signal: 'SIGTERM' }), p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE');
  assert.ok(result.infrastructure.includes('source.on.route: terminated by signal SIGTERM'), result.infrastructure.join('; '));
  assert.ok(result.infrastructure.includes('source.on.route: no exit status'), result.infrastructure.join('; '));
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('negative control: a spawn error on the route is infrastructure', () => {
  const result = runner.classifyCase(p01, injectIntoRoute({ exitCode: null, error: 'spawnSync node ENOENT' }), p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE');
  assert.ok(result.infrastructure.includes('source.on.route: spawn error spawnSync node ENOENT'), result.infrastructure.join('; '));
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('negative control: an accepted route exit without the routing checkpoint is malformed required output', () => {
  const result = runner.classifyCase(p01, injectIntoRoute({ stdout: 'routing unavailable' }), p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE');
  assert.ok(result.infrastructure.includes('source.on.route: malformed required output'), result.infrastructure.join('; '));
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('--expect-red exits nonzero from the CLI when a real route exit falls outside its policy', () => {
  const corpusCopy = JSON.parse(JSON.stringify(corpus));
  corpusCopy.cases.find(item => item.id === 'P01').actions.find(action => action.id === 'route').expectExit = { off: 1, on: 1 };
  const file = path.join(workDir, 'route-policy-cases.json');
  fs.writeFileSync(file, JSON.stringify(corpusCopy), 'utf8');
  const run = runRunner(['--expect-red', '--case', 'P01', '--cases', file]);
  assert.strictEqual(run.status, 2, `an infrastructure fault exits 2: ${run.stdout} ${run.stderr}`);
  assert.ok(run.stdout.includes('INFRASTRUCTURE'), run.stdout);
});

// Real process boundary: a substituted child (hung or flooding) under a short deadline runs through the CLI. The
// outer SIGKILL deadline turns a regression (the runner never returns) into a failed check instead of a hung suite.
const OUTER_DEADLINE_MS = 90000;
const PROMPT_EXIT_MS = 30000;
// Replay directories still on disk: for one case, or for every case when caseId is empty.
const replayDirsFor = caseId => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(caseId ? `doc-recon-${caseId}-` : 'doc-recon-')).length;
function runWithChildLimits(caseId, childLimits) {
  const corpusCopy = JSON.parse(JSON.stringify(corpus));
  corpusCopy.cases.find(item => item.id === caseId).childLimits = childLimits;
  const file = path.join(workDir, `${caseId}-child-limits.json`);
  fs.writeFileSync(file, JSON.stringify(corpusCopy), 'utf8');
  const started = Date.now();
  const run = spawnSync(process.execPath, [RUNNER, '--expect-red', '--case', caseId, '--cases', file], {
    cwd: ROOT, encoding: 'utf8', timeout: OUTER_DEADLINE_MS, killSignal: 'SIGKILL'
  });
  return { run, elapsed: Date.now() - started };
}

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('a hung route entrypoint cannot stall --expect-red: the CLI exits 2 promptly and removes the replay directories', () => {
  const before = replayDirsFor('P01');
  const { run, elapsed } = runWithChildLimits('P01', { timeoutMs: 500, substitutes: { route: 'hang-entrypoint.js' } });
  assert.strictEqual(run.signal, null, `the runner hung until the outer ${OUTER_DEADLINE_MS} ms deadline (signal ${run.signal})`);
  assert.strictEqual(run.status, 2, `exit ${run.status}: ${run.stdout} ${run.stderr}`);
  assert.ok(elapsed < PROMPT_EXIT_MS, `exit took ${elapsed} ms, bound ${PROMPT_EXIT_MS} ms`);
  assert.ok(run.stdout.includes('INFRASTRUCTURE') && run.stdout.includes('timed out at the child deadline (ETIMEDOUT)'), run.stdout);
  assert.strictEqual(replayDirsFor('P01'), before, 'replay directories are removed after the timeout');
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('a route that floods stdout is stopped by the output bound and exits 2 through the CLI', () => {
  const before = replayDirsFor('P01');
  const { run, elapsed } = runWithChildLimits('P01', { timeoutMs: 5000, substitutes: { route: 'flood-entrypoint.js' } });
  assert.strictEqual(run.signal, null, `the runner hung until the outer ${OUTER_DEADLINE_MS} ms deadline (signal ${run.signal})`);
  assert.strictEqual(run.status, 2, `exit ${run.status}: ${run.stdout} ${run.stderr}`);
  assert.ok(elapsed < PROMPT_EXIT_MS, `exit took ${elapsed} ms, bound ${PROMPT_EXIT_MS} ms`);
  assert.ok(run.stdout.includes('child output exceeded maxBuffer (ENOBUFS)'), run.stdout);
  assert.strictEqual(replayDirsFor('P01'), before, 'replay directories are removed after the output bound');
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('a faulted replay runs no action after its first infrastructure fault and still removes its directories', () => {
  const before = replayDirsFor('P01');
  const item = { ...p01, childLimits: { timeoutMs: 500, substitutes: { route: 'hang-entrypoint.js' } } };
  const root = fx.replayCase(item, 'source');
  assert.deepStrictEqual(Object.keys(root.actions), ['route'], 'only the faulted route is recorded');
  const faults = fx.infrastructureFaults(item, root, 'off');
  assert.ok(faults.length > 0 && faults.every(entry => entry.actionId === 'route'), `faults name only the route: ${JSON.stringify(faults)}`);
  assert.strictEqual(replayDirsFor('P01'), before, 'replay directories are removed after the fault');
});

// Corpus-level fail-fast through the real CLI. Every case hangs on the same shared route, so an unbounded runner would
// spend one deadline per replay (64 route timeouts). The fail-fast spends one, names the rest NOT_RUN, and exits 2.
const SHARED_HANG_DEADLINE_MS = 500;
const SHARED_HANG_BOUND_MS = 5000;
// locks: C — "unavailable observations ... cannot become a false PASS"; control: P01
checkCase('corpus-level: a route hung in every case costs one deadline, exits 2, and names the other cases NOT_RUN', () => {
  const everyCaseHangs = JSON.parse(JSON.stringify(corpus));
  for (const item of everyCaseHangs.cases) {
    item.childLimits = { timeoutMs: SHARED_HANG_DEADLINE_MS, substitutes: { route: 'hang-entrypoint.js' } };
  }
  const file = path.join(workDir, 'every-case-hangs.json');
  fs.writeFileSync(file, JSON.stringify(everyCaseHangs), 'utf8');
  const before = replayDirsFor('');
  const started = Date.now();
  const run = spawnSync(process.execPath, [RUNNER, '--expect-red', '--json', '--cases', file], {
    cwd: ROOT, encoding: 'utf8', timeout: OUTER_DEADLINE_MS, killSignal: 'SIGKILL'
  });
  const elapsed = Date.now() - started;
  assert.strictEqual(run.signal, null, `the runner hung until the outer ${OUTER_DEADLINE_MS} ms deadline (signal ${run.signal})`);
  assert.strictEqual(run.status, 2, `exit ${run.status}: ${run.stdout} ${run.stderr}`);
  assert.ok(elapsed < SHARED_HANG_BOUND_MS, `exit took ${elapsed} ms; one ${SHARED_HANG_DEADLINE_MS} ms deadline plus overhead must stay under ${SHARED_HANG_BOUND_MS} ms`);
  const report = JSON.parse(run.stdout);
  assert.strictEqual(report.replaysRun, 1, 'exactly one replay ran');
  const [first, ...rest] = report.cases;
  assert.strictEqual(first.caseId, 'P01');
  assert.strictEqual(first.status, 'INFRASTRUCTURE');
  assert.deepStrictEqual(first.offending, { leg: 'source', mode: 'off', actionId: 'route', fault: 'timed out at the child deadline (ETIMEDOUT)' });
  assert.strictEqual(first.actionsRun, 1, 'only the hung route ran');
  assert.deepStrictEqual(rest.map(item => item.caseId), corpus.cases.slice(1).map(item => item.id), 'every other case is named');
  assert.ok(rest.every(item => item.status === 'NOT_RUN'), 'the other cases are NOT_RUN, never silently omitted');
  assert.strictEqual(replayDirsFor(''), before, 'replay directories are removed');
});

// locks: unresolved — test-only override guard (tool control); no A/B/C/R3 clause
checkCase('the committed corpus carries no child-limit override, so production replays use the default deadline', () => {
  assert.ok(corpus.cases.every(item => item.childLimits === undefined), 'a childLimits key is test-only');
});

// locks: unresolved — deadline-shortening guard (tool control); no A/B/C/R3 clause
checkCase('a child deadline override can only shorten the default deadline', () => {
  const item = { ...corpus.cases.find(candidate => candidate.id === 'P06'), childLimits: { timeoutMs: 60000 } };
  assert.throws(() => fx.replayCase(item, 'source'), /may only shorten/);
});

// locks: C — "unavailable observations ... cannot become a false PASS"; control: P06
checkCase('a malformed expectExit policy is an infrastructure error, not a RED pass', () => {
  const corpusCopy = JSON.parse(JSON.stringify(corpus));
  corpusCopy.cases.find(item => item.id === 'P06').actions.find(action => action.id === 'route').expectExit = { off: 'two' };
  const file = path.join(workDir, 'malformed-policy-cases.json');
  fs.writeFileSync(file, JSON.stringify(corpusCopy), 'utf8');
  const run = runRunner(['--expect-red', '--case', 'P06', '--cases', file]);
  assert.strictEqual(run.status, 2, `a malformed policy exits 2: ${run.stdout} ${run.stderr}`);
});

// locks: unresolved — package parity control (shared runtime bytes); not a false-PASS claim
checkCase('P08 parity: shared runtime files are byte-identical between the source and packaged legs', () => {
  for (const [source, packaged] of SHARED_FILES) {
    const left = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, source))).digest('hex');
    const right = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, packaged))).digest('hex');
    assert.strictEqual(left, right, `${source} matches ${packaged}`);
  }
});

// Switch sanitation: an inherited ON request does not reach an OFF replay (one replay).
// locks: unresolved — OFF isolation from an inherited ON request; the I2 invariant is not in the A/B/C/R3 table
checkCase('switch sanitation: an inherited ON request does not reach an OFF replay', () => {
  const previous = process.env[fx.PILOT_SWITCH];
  process.env[fx.PILOT_SWITCH] = '1';
  try {
    const item = corpus.cases.find(candidate => candidate.id === 'P06');
    const root = fx.replayCase(item, 'source');
    const failures = fx.evaluateAll(root, item.expectations.off).filter(result => !result.pass);
    assert.strictEqual(failures.length, 0, 'OFF expectations still hold with an inherited ON request');
  } finally {
    if (previous === undefined) delete process.env[fx.PILOT_SWITCH];
    else process.env[fx.PILOT_SWITCH] = previous;
  }
});

// locks: unresolved — temporary-directory hygiene control; no A/B/C/R3 clause
checkCase('cleanup: replays remove their temporary workspace and state directories', () => {
  const prefix = 'doc-recon-P06-source-';
  const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(prefix)).length;
  fx.replayCase(corpus.cases.find(item => item.id === 'P06'), 'source');
  const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(prefix)).length;
  assert.strictEqual(after, before, 'no replay directory is left behind');
});

// F-a: separator-agnostic scrubbing. Windows-shaped strings from each leg must normalize to the same markers.
// locks: unresolved — replay path-normalisation control; no A/B/C/R3 clause
checkCase('F-a: Windows-shaped source and packaged paths normalize identically', () => {
  const roots = { repo: 'D:\\a\\repo', tmp: ['C:\\Users\\runneradmin\\AppData\\Local\\Temp'] };
  const sourceSkill = fx.scrubText('D:\\a\\repo\\tdd\\SKILL.md', roots);
  const packagedSkill = fx.scrubText('D:\\a\\repo\\plugins\\harness-everything\\skills\\tdd\\SKILL.md', roots);
  assert.strictEqual(sourceSkill, '<skill:tdd>', 'the source skill path is marked by skill id');
  assert.strictEqual(packagedSkill, sourceSkill, 'the packaged skill path is marked the same way');
  const sourceTmp = fx.scrubText('C:\\Users\\runneradmin\\AppData\\Local\\Temp\\doc-recon-P01-source-ws-0a1b2c3d-x9\\state\\workflow-run.json', roots);
  const packagedTmp = fx.scrubText('C:\\Users\\runneradmin\\AppData\\Local\\Temp\\doc-recon-P01-packaged-ws-5e6f7a8b-y2\\state\\workflow-run.json', roots);
  assert.strictEqual(packagedTmp, sourceTmp, 'temporary paths from each leg are marked the same way');
  assert.ok(!sourceTmp.includes('\\') && !sourceTmp.includes('doc-recon'), 'no raw separator or temp name survives');
  const sameAfterFold = fx.scrubText('C:/Users/runneradmin/AppData/Local/Temp/doc-recon-P01-source-ws-0a1b2c3d-x9/state/workflow-run.json', roots);
  assert.strictEqual(sameAfterFold, sourceTmp, 'POSIX and Windows spellings of one path normalize identically');
});

// F-b: a per-action switch override must not reach an OFF replay.
// locks: unresolved — OFF replay carries no per-action switch; the I2 invariant is not in the A/B/C/R3 table
checkCase('F-b: an OFF replay of P05 carries no per-action switch; the ON replay keeps its overrides', () => {
  const item = corpus.cases.find(candidate => candidate.id === 'P05');
  const off = fx.replayCase(item, 'source');
  for (const [id, action] of Object.entries(off.actions)) {
    assert.strictEqual(action.pilot, undefined, `OFF replay action ${id} has no switch value`);
  }
  const on = fx.replayCase(item, 'source', { pilot: '1' });
  assert.strictEqual(on.actions['stop-on-1'].pilot, '1', 'an ON replay keeps the ON action value');
  assert.strictEqual(on.actions['stop-off'].pilot, '0', 'an ON replay keeps the explicit OFF action value');
});

fs.rmSync(workDir, { recursive: true, force: true });
console.log(failed ? `\n${failed} preparation check(s) failed` : '\nAll preparation checks passed');
process.exitCode = failed ? 1 : 0;

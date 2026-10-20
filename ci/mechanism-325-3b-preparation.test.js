#!/usr/bin/env node
'use strict';

// #325 Phase 3b preparation (H1+H2): fixture inventory, the qualified expected-RED runner, legacy controls,
// switch sanitation, source/package parity and negative registry checks. This suite asserts no runtime
// behaviour change and no pilot credit. Desired-contract gaps are qualified by the registry, never
// asserted as passing behaviour. Full replay runs use the runner; negative checks use one case each.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const fx = require('./lib/doc-reconciliation-prep-fixtures');
const runner = require('./prep/doc-reconciliation-red.js');

const ROOT = path.resolve(__dirname, '..');
const PREP_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-prep');
const RUNNER = path.join(__dirname, 'prep', 'doc-reconciliation-red.js');
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
function writeRegistry(name, mutate) {
  const copy = JSON.parse(JSON.stringify(registry));
  mutate(copy);
  const file = path.join(workDir, name);
  fs.writeFileSync(file, `${JSON.stringify(copy, null, 2)}\n`, 'utf8');
  return file;
}

console.log('=== #325 3b preparation: corpus, qualified RED runner and controls (H1+H2) ===');

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

// The full replay runs once, through the runner's JSON report. Every case must be a control or a qualified gap,
// with matching parity between the two legs and no pilot credit.
let report = null;
checkCase('expected-RED mode: every case is CONTROL_PASS or EXPECTED_RED and exits 0', () => {
  const run = runRunner(['--expect-red', '--json']);
  assert.strictEqual(run.status, 0, `exit ${run.status}: ${(run.stderr || run.stdout).slice(0, 400)}`);
  report = JSON.parse(run.stdout);
});

checkCase('expected-RED report: legs agree, controls are green, no pilot credit, runtime fingerprint matches', () => {
  assert.ok(report, 'the report was produced');
  assert.strictEqual(report.pilotCredit, false, 'preparation reports never grant pilot credit');
  assert.strictEqual(report.runtimeFingerprintMatches, true, 'registry describes the current shared runtime bytes');
  for (const item of report.cases) {
    assert.ok(['CONTROL_PASS', 'EXPECTED_RED'].includes(item.status), `${item.caseId} is ${item.status}`);
    assert.strictEqual(item.parity, 'match', `${item.caseId} source and packaged legs agree`);
  }
  const controls = report.cases.filter(item => item.status === 'CONTROL_PASS').map(item => item.caseId).sort();
  assert.deepStrictEqual(controls, ['P02d', 'P06', 'P07u']);
});

checkCase('gap registry: every entry is qualified and the expected-RED mode accounts for all of them', () => {
  assert.ok(report, 'the report was produced');
  const qualified = report.cases.flatMap(item => item.assertions.filter(entry => entry.status === 'gap-qualified'));
  assert.strictEqual(qualified.length, registry.entries.length, 'each registry entry is observed exactly once');
  assert.ok(!report.cases.some(item => item.assertions.some(entry => entry.status === 'gap-unqualified' || entry.status === 'unexpected-pass')));
});

checkCase('strict mode fails on the recorded gaps and preserves the RED log', () => {
  const log = path.join(workDir, 'p01-red.json');
  const run = runRunner(['--strict', '--case', 'P01', '--log', log]);
  assert.strictEqual(run.status, 1, `strict mode exits 1 on gaps: ${run.stdout}`);
  const saved = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.ok(saved.cases[0].assertions.some(entry => entry.status === 'gap-qualified'), 'the log keeps the qualified gaps');
});

checkCase('malformed registry is an infrastructure error, not a RED pass', () => {
  const file = writeRegistry('missing-reason.json', copy => { delete copy.entries[0].reasonCode; });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 2, `registry errors exit 2: ${run.stdout} ${run.stderr}`);
});

checkCase('a registry that omits a gap fails expected-RED mode', () => {
  const file = writeRegistry('omit-gap.json', copy => { copy.entries = copy.entries.filter(entry => entry.assertionId !== 'P01.on.stop-unsatisfied' || entry.distribution !== 'source'); });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 1, `an unqualified gap fails: ${run.stdout}`);
});

checkCase('an unexpected PASS on a control fails expected-RED mode', () => {
  const file = writeRegistry('unexpected-pass.json', copy => {
    copy.entries.push({
      caseId: 'P06', assertionId: 'P06.on.stop-satisfied', distribution: 'source', baselineSha: copy.baselineSha,
      actual: 'satisfied', desired: 'running', blocker: '#341 E0', reasonCode: 'pretend-gap'
    });
  });
  const run = runRunner(['--expect-red', '--case', 'P06', '--registry', file]);
  assert.strictEqual(run.status, 1, `a passing assertion with a registry entry fails: ${run.stdout}`);
});

// Infrastructure rule: an abnormal action result is never a qualified gap. The controls change only the ON route
// result of P01, identically in both legs, so parity stays green and only the infrastructure rule can stop
// qualification. Everything else in the replays is the unmodified replay's.
const p01 = corpus.cases.find(item => item.id === 'P01');
const p01Entries = registry.entries.filter(entry => entry.caseId === 'P01');
const injectIntoRoute = patch => runner.replayAll(p01, (root, where) => {
  if (where.mode === 'on') Object.assign(root.actions.route, patch);
});

checkCase('negative control: an abnormal route in P01 is infrastructure, and --expect-red exits nonzero though later assertions still match', () => {
  const clean = runner.replayAll(p01);
  const injected = injectIntoRoute({ exitCode: 1 });
  const later = p01.expectations.on.filter(assertion => assertion.id.startsWith('verify-obligation') || assertion.id.startsWith('stop-'));
  for (const leg of ['source', 'packaged']) {
    const before = fx.evaluateAll(clean.on[leg], later);
    const after = fx.evaluateAll(injected.on[leg], later);
    assert.deepStrictEqual(after.map(item => [item.id, item.pass, item.actual]), before.map(item => [item.id, item.pass, item.actual]),
      `${leg}: the later assertions evaluate exactly as in the unmodified replay`);
    for (const item of after) {
      const entry = p01Entries.find(candidate => candidate.assertionId === `P01.on.${item.id}` && candidate.distribution === leg);
      assert.ok(entry && JSON.stringify(fx.normalize(entry.actual)) === JSON.stringify(fx.normalize(item.actual)),
        `${leg}: ${item.id} still matches its registry actual, so only the infrastructure rule can stop qualification`);
    }
  }
  const result = runner.classifyCase(p01, injected, p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE', `status ${result.status}`);
  assert.deepStrictEqual(result.infrastructure, ['source.on.route: exit 1 outside policy [0]', 'packaged.on.route: exit 1 outside policy [0]']);
  assert.deepStrictEqual(result.assertions, [], 'no assertion is qualified or classified for an infrastructure case');
  assert.strictEqual(runner.exitCodeFor({ cases: [result] }, 'expect-red'), 2, 'expected-RED mode exits nonzero');
});

checkCase('negative control: a route killed by a signal or without an exit status is infrastructure', () => {
  const result = runner.classifyCase(p01, injectIntoRoute({ exitCode: null, signal: 'SIGTERM' }), p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE');
  assert.ok(result.infrastructure.includes('source.on.route: terminated by signal SIGTERM'), result.infrastructure.join('; '));
  assert.ok(result.infrastructure.includes('source.on.route: no exit status'), result.infrastructure.join('; '));
});

checkCase('negative control: a spawn error on the route is infrastructure', () => {
  const result = runner.classifyCase(p01, injectIntoRoute({ exitCode: null, error: 'spawnSync node ENOENT' }), p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE');
  assert.ok(result.infrastructure.includes('source.on.route: spawn error spawnSync node ENOENT'), result.infrastructure.join('; '));
});

checkCase('negative control: an accepted route exit without the routing checkpoint is malformed required output', () => {
  const result = runner.classifyCase(p01, injectIntoRoute({ stdout: 'routing unavailable' }), p01Entries);
  assert.strictEqual(result.status, 'INFRASTRUCTURE');
  assert.ok(result.infrastructure.includes('source.on.route: malformed required output'), result.infrastructure.join('; '));
});

checkCase('--expect-red exits nonzero from the CLI when a real route exit falls outside its policy', () => {
  const corpusCopy = JSON.parse(JSON.stringify(corpus));
  corpusCopy.cases.find(item => item.id === 'P01').actions.find(action => action.id === 'route').expectExit = { off: 1, on: 1 };
  const file = path.join(workDir, 'route-policy-cases.json');
  fs.writeFileSync(file, JSON.stringify(corpusCopy), 'utf8');
  const run = runRunner(['--expect-red', '--case', 'P01', '--cases', file]);
  assert.strictEqual(run.status, 2, `an infrastructure fault exits 2: ${run.stdout} ${run.stderr}`);
  assert.ok(run.stdout.includes('INFRASTRUCTURE'), run.stdout);
});

checkCase('a malformed expectExit policy is an infrastructure error, not a RED pass', () => {
  const corpusCopy = JSON.parse(JSON.stringify(corpus));
  corpusCopy.cases.find(item => item.id === 'P06').actions.find(action => action.id === 'route').expectExit = { off: 'two' };
  const file = path.join(workDir, 'malformed-policy-cases.json');
  fs.writeFileSync(file, JSON.stringify(corpusCopy), 'utf8');
  const run = runRunner(['--expect-red', '--case', 'P06', '--cases', file]);
  assert.strictEqual(run.status, 2, `a malformed policy exits 2: ${run.stdout} ${run.stderr}`);
});

checkCase('a runtime fingerprint change invalidates qualification and prints the exact deliberate re-capture command', () => {
  const file = writeRegistry('stale-fingerprint.json', copy => { copy.runtimeFingerprint = '0'.repeat(64); });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 1, `a fingerprint mismatch fails: ${run.stdout}`);
  const output = run.stdout + run.stderr;
  assert.ok(output.includes('--recapture-candidate ci/fixtures/doc-obligations/reconciliation-prep/pending-red.candidate.json'), 'the re-capture command names the candidate');
  assert.ok(/--baseline-sha [0-9a-f]{40}/.test(output), 'the re-capture command names the commit');
  assert.ok(output.includes('nothing is auto-accepted'), 'the message says nothing is auto-accepted');
});

checkCase('recapture writes a reviewable candidate and never the committed registry', () => {
  const candidate = path.join(workDir, 'candidate.json');
  const before = fs.readFileSync(path.join(PREP_DIR, 'pending-red.json'), 'utf8');
  const run = spawnSync(process.execPath, [RUNNER, '--recapture-candidate', candidate, '--baseline-sha', registry.baselineSha, '--case', 'P06'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(fs.readFileSync(path.join(PREP_DIR, 'pending-red.json'), 'utf8'), before, 'the committed registry is untouched');
  const saved = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  assert.strictEqual(saved.entries.length, 0, 'a control case has no gaps to record');
  assert.strictEqual(saved.runtimeFingerprint, registry.runtimeFingerprint, 'the candidate describes the current runtime');
});

checkCase('a candidate with unreviewed reasons is rejected by the registry validator', () => {
  const file = writeRegistry('unreviewed.json', copy => { copy.entries[0].reasonCode = 'needs-reason'; });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 2, 'an unreviewed reason is a registry error');
});

checkCase('P08 parity: shared runtime files are byte-identical between the source and packaged legs', () => {
  for (const [source, packaged] of SHARED_FILES) {
    const left = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, source))).digest('hex');
    const right = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, packaged))).digest('hex');
    assert.strictEqual(left, right, `${source} matches ${packaged}`);
  }
});

// Switch sanitation: an inherited ON request does not reach an OFF replay (one replay).
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

checkCase('cleanup: replays remove their temporary workspace and state directories', () => {
  const prefix = 'doc-recon-P06-source-';
  const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(prefix)).length;
  fx.replayCase(corpus.cases.find(item => item.id === 'P06'), 'source');
  const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(prefix)).length;
  assert.strictEqual(after, before, 'no replay directory is left behind');
});

// F-a: separator-agnostic scrubbing. Windows-shaped strings from each leg must normalize to the same markers.
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
console.log(failed ? `\n${failed} preparation check(s) failed` : '\nAll preparation checks passed (desired-contract gaps are qualified, not asserted as behaviour)');
process.exitCode = failed ? 1 : 0;

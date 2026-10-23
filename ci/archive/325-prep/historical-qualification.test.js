#!/usr/bin/env node
'use strict';

// #325 Phase 3b historical qualification, archived by F4-T2 (owner clause T2, 2026-10-22) from
// ci/mechanism-325-3b-preparation.test.js at revision 0308386. Not discovered by ci/mechanism-test.js and not part of
// `npm run test:mechanism`. Run explicitly: node ci/archive/325-prep/historical-qualification.test.js
// These checks gate the frozen registry and the runtime fingerprint. They record the prep qualification; they are not a
// live behaviour gate. See README.md in this directory for the manifest and the residual failures.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PREP_DIR = path.join(ROOT, 'ci', 'fixtures', 'doc-obligations', 'reconciliation-prep');
const RUNNER = path.join(__dirname, 'doc-reconciliation-red.js');
const registry = JSON.parse(fs.readFileSync(path.join(PREP_DIR, 'pending-red.json'), 'utf8'));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-recon-prep-historical-'));

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

console.log('=== #325 3b historical qualification (archived by F4-T2) ===');

// The full replay runs once, through the runner's JSON report. Every case must be a control or a qualified gap,
// with matching parity between the two legs and no pilot credit.
let report = null;
// locks: historical — T2
checkCase('expected-RED mode: every case is CONTROL_PASS or EXPECTED_RED and exits 0', () => {
  const run = runRunner(['--expect-red', '--json']);
  assert.strictEqual(run.status, 0, `exit ${run.status}: ${(run.stderr || run.stdout).slice(0, 400)}`);
  report = JSON.parse(run.stdout);
});

// locks: historical — T2
checkCase('expected-RED report: legs agree, controls are green, no pilot credit, runtime fingerprint matches', () => {
  assert.ok(report, 'the report was produced');
  assert.strictEqual(report.pilotCredit, false, 'preparation reports never grant pilot credit');
  assert.strictEqual(report.runtimeFingerprintMatches, true, 'registry describes the current shared runtime bytes');
  for (const item of report.cases) {
    assert.ok(['CONTROL_PASS', 'EXPECTED_RED'].includes(item.status), `${item.caseId} is ${item.status}`);
    assert.strictEqual(item.parity, 'match', `${item.caseId} source and packaged legs agree`);
  }
  const controls = report.cases.filter(item => item.status === 'CONTROL_PASS').map(item => item.caseId).sort();
  // P02e is a control since F4-T3: its review gap closed (the ON self-authored review PASS is refused) and its registry entries were retired.
  assert.deepStrictEqual(controls, ['P01', 'P02a', 'P02b', 'P02c', 'P02d', 'P02e', 'P02f', 'P02g', 'P04', 'P06', 'P07-fable-multi-agent-workspace', 'P07-fable-parallel', 'P07-fable-staged', 'P07u']);
});

// locks: historical — T2
checkCase('gap registry: every entry is qualified and the expected-RED mode accounts for all of them', () => {
  assert.ok(report, 'the report was produced');
  const qualified = report.cases.flatMap(item => item.assertions.filter(entry => entry.status === 'gap-qualified'));
  assert.strictEqual(qualified.length, registry.entries.length, 'each registry entry is observed exactly once');
  assert.ok(!report.cases.some(item => item.assertions.some(entry => entry.status === 'gap-unqualified' || entry.status === 'unexpected-pass')));
});

// locks: historical — T2
checkCase('strict mode fails on the recorded gaps and preserves the RED log', () => {
  // Retargeted to P03 in F4-T3: P02e's gaps are closed, and P03 still has open verify-retry gaps on both legs.
  const log = path.join(workDir, 'p03-red.json');
  const run = runRunner(['--strict', '--case', 'P03', '--log', log]);
  assert.strictEqual(run.status, 1, `strict mode exits 1 on gaps: ${run.stdout}`);
  const saved = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.ok(saved.cases[0].assertions.some(entry => entry.status === 'gap-qualified'), 'the log keeps the qualified gaps');
});

// locks: historical — T2
checkCase('malformed registry is an infrastructure error, not a RED pass', () => {
  const file = writeRegistry('missing-reason.json', copy => { delete copy.entries[0].reasonCode; });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 2, `registry errors exit 2: ${run.stdout} ${run.stderr}`);
});

// locks: historical — T2
checkCase('a registry that omits a gap fails expected-RED mode', () => {
  const file = writeRegistry('omit-gap.json', copy => { copy.entries = copy.entries.filter(entry => entry.assertionId !== 'P03.on.verify-retry-exit' || entry.distribution !== 'source'); });
  const run = runRunner(['--expect-red', '--case', 'P03', '--registry', file]);
  assert.strictEqual(run.status, 1, `an unqualified gap fails: ${run.stdout}`);
});

// locks: historical — T2
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

// locks: historical — T2
checkCase('a runtime fingerprint change invalidates qualification and prints the exact deliberate re-capture command', () => {
  const file = writeRegistry('stale-fingerprint.json', copy => { copy.runtimeFingerprint = '0'.repeat(64); });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 1, `a fingerprint mismatch fails: ${run.stdout}`);
  const output = run.stdout + run.stderr;
  assert.ok(output.includes('--recapture-candidate ci/fixtures/doc-obligations/reconciliation-prep/pending-red.candidate.json'), 'the re-capture command names the candidate');
  assert.ok(/--baseline-sha [0-9a-f]{40}/.test(output), 'the re-capture command names the commit');
  assert.ok(output.includes('nothing is auto-accepted'), 'the message says nothing is auto-accepted');
});

// locks: historical — T2
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

// locks: historical — T2
checkCase('a candidate with unreviewed reasons is rejected by the registry validator', () => {
  const file = writeRegistry('unreviewed.json', copy => { copy.entries[0].reasonCode = 'needs-reason'; });
  const run = runRunner(['--expect-red', '--case', 'P01', '--registry', file]);
  assert.strictEqual(run.status, 2, 'an unreviewed reason is a registry error');
});

fs.rmSync(workDir, { recursive: true, force: true });
console.log(failed ? `\n${failed} historical check(s) failed` : '\nAll historical checks passed');
process.exitCode = failed ? 1 : 0;

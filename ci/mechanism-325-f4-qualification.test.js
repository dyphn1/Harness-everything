#!/usr/bin/env node
'use strict';

// #325 Phase 3b F4-T2: qualification tests, run through the real entries.
//
// Contract: docs/doc-workflow-reconciliation.md, "Test transport" and the qualification section. The origin provider's
// qualification check must resolve the retained evidence, validate captured kinds, IDs, correlation and recorded digests,
// and return unavailable (no credit) for missing, malformed, mismatched or unresolvable evidence. A valid export opens
// the gate, and credit still requires current accepted evidence.
//
// Every replay runs the real hook, workflow and Stop entries from a staged copy of one leg (ci/lib/doc-reconciliation-
// staged-tree.js). The staged copy carries the retained live-host capture and the export the scenario chooses, so no
// test writes into the repository, and the live tree's own export never decides a result.
//
// Statuses: CONTROL must pass now and at GREEN. RED fails now for its stated reason and passes at GREEN. FAIL is an
// unexpected result, including a RED that already passes. INFRA is a harness crash and never counts as RED.
// Strict by default; `--expect-red` exits 0 only when every CONTROL passes and every RED fails for its reason.
//
// Spy (test (e)): the file-access spy (ci/lib/doc-reconciliation-file-spy.js) is loaded before the CI preloader. It
// shows whether a child read the qualification export, so the test can assert that the preloader never does, and
// that the spy really sees a production read.

const fs = require('fs');
const os = require('os');
const path = require('path');

const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const { stage, SIBLING_CAPTURE } = require(path.join(__dirname, 'lib', 'doc-reconciliation-staged-tree'));
const SPY = path.join(__dirname, 'lib', 'doc-reconciliation-file-spy.js');
const F4_CASES = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');
const LEGS = ['source', 'packaged'];

const CASE = id => fx.readCaseCorpus(F4_CASES).cases.find(item => item.id === id);

// Assertions on the production replay of the first positive. Credit and the stop are the public outcomes.
const CREDIT = { id: 'credit', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: true, status: 'CONTROL' };
const NO_CREDIT = { id: 'no-credit', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: false, status: 'CONTROL' };
const STOP_SATISFIED = { id: 'stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL' };
const STOP_NOT_SATISFIED = { id: 'stop-not-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL' };
const STOP_EXIT = { id: 'stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' };

// RED until F4 I2a: the checkpoint validator still reads the earlier export form (captureSha256 beside the retained capture).
// It refuses a correct export of the in-flight form (harness.doc-reconciliation.qualification.v1, sibling sanitized capture)
// as 'does not bind the retained capture digest', so a valid export earns no credit at the checkpoint.
const RED_QUALIFICATION = 'missing-implementation: the checkpoint provider does not recognise the qualification export form (schema harness.doc-reconciliation.qualification.v1, sanitized capture as a sibling); a valid export is refused as not binding the digest (F4 I2a)';
// Retired from RED in F4-T3 (I2a implements the export form): strict CONTROL assertions, reason kept as the record.
const CREDIT_STRICT = { ...CREDIT, retired: 'F4-T3', reason: RED_QUALIFICATION };
const STOP_SATISFIED_STRICT = { ...STOP_SATISFIED, retired: 'F4-T3', reason: RED_QUALIFICATION };

let passCount = 0;
let redCount = 0;
let failCount = 0;
let infraCount = 0;

function record(status, id, detail) {
  const suffix = detail ? ` - ${detail}` : '';
  if (status === 'PASS') passCount += 1;
  else if (status === 'RED') redCount += 1;
  else if (status === 'FAIL') failCount += 1;
  else infraCount += 1;
  console.log(`   ${status.padEnd(5)} ${id}${suffix}`);
}

// Replays one scenario and evaluates its plan. A RED that already passes is a FAIL, as in the other mechanism suites.
function replayAndCheck(label, item, dist, options, plan) {
  let root;
  try {
    root = fx.replayCase(item, dist, options);
  } catch (error) {
    record('INFRA', label, `replay crash: ${error.message}`);
    return null;
  }
  const faults = fx.infrastructureFaults(item, root, options.pilot === undefined ? 'off' : 'on');
  if (faults.length) {
    record('INFRA', label, faults.map(fault => `${fault.actionId}: ${fault.message}`).join('; '));
    return null;
  }
  const results = fx.evaluateAll(root, plan.map(entry => ({ id: entry.id, path: entry.path, operator: entry.operator, expected: entry.expected })));
  plan.forEach((entry, index) => {
    const result = results[index];
    const id = `${label}.${entry.id}`;
    if (entry.status === 'CONTROL') {
      record(result.pass ? 'PASS' : 'FAIL', id, result.pass ? '' : `expected ${JSON.stringify(result.expected)} at ${entry.path.join('.')}, got ${JSON.stringify(result.actual).slice(0, 160)}`);
    } else if (result.pass) {
      record('FAIL', id, 'RED assertion unexpectedly passed now (expected to fail for its stated reason)');
    } else {
      record('RED', id, `${entry.reason}; actual ${JSON.stringify(result.actual).slice(0, 120)}`);
    }
  });
  return root;
}

// ---- (a) production with no export: withheld ----------------------------------------------------------------------

function partA() {
  console.log('\n== (a) production mode with no export is withheld ==');
  for (const leg of LEGS) {
    const staged = stage(leg);
    try {
      record(fs.existsSync(staged.exportFile) ? 'FAIL' : 'PASS', `(a).precondition-no-export@${leg}`, fs.existsSync(staged.exportFile) ? 'the staged tree already has an export' : '');
      replayAndCheck(`(a).production@${leg}`, CASE('F4-POS-body-edit'), staged.dist, { pilot: '1' }, [NO_CREDIT, STOP_NOT_SATISFIED, STOP_EXIT]);
    } finally {
      staged.cleanup();
    }
  }
}

// ---- (b) an edited export (one field changed): withheld --------------------------------------------------------

function partB() {
  console.log('\n== (b) an export with one edited field is withheld ==');
  for (const leg of LEGS) {
    const staged = stage(leg);
    try {
      const valid = staged.validExport();
      // One field changed: the correlation claim no longer matches what the sanitized capture shows.
      staged.writeExport(staged.validExport({ correlation: { ...valid.correlation, agentResultAliasCorrelated: false } }));
      replayAndCheck(`(b).edited-field@${leg}`, CASE('F4-POS-body-edit'), staged.dist, { pilot: '1' }, [NO_CREDIT, STOP_NOT_SATISFIED, STOP_EXIT]);
    } finally {
      staged.cleanup();
    }
  }
}

// ---- (c) an edited sanitized capture whose digest no longer matches: withheld ----------------------------------

function partC() {
  console.log('\n== (c) a sanitized capture whose digest no longer matches is withheld ==');
  for (const leg of LEGS) {
    const staged = stage(leg);
    try {
      staged.writeExport(staged.validExport());
      // The export is valid for the bytes it names. Editing those bytes (a trailing blank line) breaks only the digest.
      fs.appendFileSync(path.join(staged.libDir, SIBLING_CAPTURE), '\n');
      replayAndCheck(`(c).edited-capture@${leg}`, CASE('F4-POS-body-edit'), staged.dist, { pilot: '1' }, [NO_CREDIT, STOP_NOT_SATISFIED, STOP_EXIT]);
    } finally {
      staged.cleanup();
    }
  }
}

// ---- (d) the valid export passes qualification; credit still requires current accepted evidence -------------

function partD() {
  console.log('\n== (d) the valid export passes qualification; credit requires current accepted evidence ==');
  for (const leg of LEGS) {
    const staged = stage(leg);
    try {
      staged.writeExport(staged.validExport());
      // Valid export and the real positive evidence: qualification passes and the first positive is credited.
      replayAndCheck(`(d).valid-export-credit@${leg}`, CASE('F4-POS-body-edit'), staged.dist, { pilot: '1' }, [CREDIT_STRICT, STOP_SATISFIED_STRICT, STOP_EXIT]);
    } finally {
      staged.cleanup();
    }
    const withNoEvidence = stage(leg);
    try {
      withNoEvidence.writeExport(withNoEvidence.validExport());
      // The same valid export with no delivered host events: qualification alone never grants credit.
      replayAndCheck(`(d).valid-export-no-evidence@${leg}`, CASE('F4-NEG-zero-events'), withNoEvidence.dist, { pilot: '1' }, [NO_CREDIT, STOP_NOT_SATISFIED, STOP_EXIT]);
    } finally {
      withNoEvidence.cleanup();
    }
  }
}

// ---- (e) the CI preloader never reads the real export file (file-access spy) ----------------------------------

function readsOfExport(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(line => /doc-reconciliation-qualification\.json/.test(line));
}

function partE() {
  console.log('\n== (e) the CI preloader never reads the real export file (file-access spy) ==');
  const previous = process.env.F4_SPY_LOG;
  for (const leg of LEGS) {
    const staged = stage(leg);
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-spy-'));
    try {
      staged.writeExport(staged.validExport());
      // Preloader run: the spy is loaded first, then the CI preloader supplies the fake qualification.
      const preloadLog = path.join(logDir, 'preload.log');
      process.env.F4_SPY_LOG = preloadLog;
      const preloadRoot = replayAndCheck(`(e).preload-credit@${leg}`, CASE('F4-POS-body-edit'), staged.dist, { pilot: '1', preload: true, nodeArgs: ['--require', SPY] }, [CREDIT, STOP_EXIT]);
      record(preloadRoot && readsOfExport(preloadLog).length === 0 ? 'PASS' : 'FAIL', `(e).preloader-never-reads-export@${leg}`, readsOfExport(preloadLog).length === 0 ? '' : `the preloaded replay read the export: ${readsOfExport(preloadLog).join(' | ').slice(0, 200)}`);
      // Production run of the same staged tree: the spy must see the real export read, or the preloader result means nothing.
      const productionLog = path.join(logDir, 'production.log');
      process.env.F4_SPY_LOG = productionLog;
      replayAndCheck(`(e).production-reads-export-control@${leg}`, CASE('F4-POS-body-edit'), staged.dist, { pilot: '1', nodeArgs: ['--require', SPY] }, [STOP_EXIT]);
      record(readsOfExport(productionLog).length > 0 ? 'PASS' : 'FAIL', `(e).spy-sees-production-read@${leg}`, readsOfExport(productionLog).length > 0 ? '' : 'the spy recorded no export read in production mode, so the preload result is not evidence');
    } finally {
      if (previous === undefined) delete process.env.F4_SPY_LOG;
      else process.env.F4_SPY_LOG = previous;
      staged.cleanup();
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  }
}

function main() {
  partA();
  partB();
  partC();
  partD();
  partE();
  console.log('\n== F4 qualification evidence ==');
  console.log(`controls and passing checks: ${passCount}`);
  console.log(`RED assertions confirmed: ${redCount}`);
  console.log(`unexpected failures: ${failCount}`);
  console.log(`infrastructure faults: ${infraCount}`);
  const expectRed = process.argv.includes('--expect-red');
  if (!expectRed) {
    if (failCount === 0 && infraCount === 0 && redCount === 0) {
      console.log('\nSTATUS: GREEN (all assertions passed)');
      return 0;
    }
    console.log(`\nSTATUS: NOT-GREEN (red ${redCount}, unexpected ${failCount}, infra ${infraCount})`);
    return 1;
  }
  if (failCount === 0 && infraCount === 0) {
    console.log('\nSTATUS: RED-PLAN-MATCHED (all controls passed, all RED assertions failed for their stated reasons)');
    return 0;
  }
  console.log('\nSTATUS: RED-PLAN-MISMATCH');
  return 1;
}

process.exitCode = main();

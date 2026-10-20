#!/usr/bin/env node
'use strict';

// #325 Phase 3b preparation: strict and expected-RED replay over the real CLI, hook and Stop entry points.
//
//   node ci/prep/doc-reconciliation-red.js --strict      exits 1 on any desired-contract gap or control failure
//   node ci/prep/doc-reconciliation-red.js --expect-red  exits 0 only when every gap is qualified by the registry
//   node ci/prep/doc-reconciliation-red.js --recapture-candidate <file> --baseline-sha <40-hex>
//                                                        writes a candidate registry for review; never the registry
//
// Optional: --case <id> (repeatable), --cases <file>, --registry <file>, --json (print the report), --log <file>.
// Exit 2 means infrastructure or registry error (replay crash, malformed registry, unreadable file).
//
// This file is not discovered by filename. The preparation suite invokes --expect-red and parses the report.
// A qualified gap is an ON assertion that fails today and matches a registry entry exactly (case, assertion,
// distribution, actual and desired). Qualification is bound to the runtime fingerprint of the shared runtime
// files, not to the commit: a registry entry is valid only while those files are byte-identical to the capture.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const fx = require('../lib/doc-reconciliation-prep-fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const PREP_DIR = path.join(ROOT, 'ci', 'fixtures', 'doc-obligations', 'reconciliation-prep');
const DEFAULT_CASES = path.join(PREP_DIR, 'cases.json');
const DEFAULT_REGISTRY = path.join(PREP_DIR, 'pending-red.json');
const LEGS = ['source', 'packaged'];
const BLOCKER = '#341 E0';
const ENTRY_KEYS = ['caseId', 'assertionId', 'distribution', 'baselineSha', 'actual', 'desired', 'blocker', 'reasonCode'];
// Shared runtime files whose bytes define what the registry describes. Every P01-P08 replay loads the first
// three (verified by a preload probe, see h3.md). doc-evidence.js is not loaded by any replay, so it is excluded:
// #341 0B refactors it, and including it would turn this suite red for an unrelated reason.
const FINGERPRINT_FILES = [
  'hooks/scripts/lib/workflow-obligations.js',
  'hooks/scripts/workflow-disposition.js',
  'hooks/scripts/workflow-stop-gate.js'
];
const CANDIDATE_FILE = 'ci/fixtures/doc-obligations/reconciliation-prep/pending-red.candidate.json';
const UNREVIEWED_REASON = 'needs-reason';

class RegistryError extends Error {}

function fingerprint() {
  const hash = crypto.createHash('sha256');
  for (const rel of FINGERPRINT_FILES) {
    hash.update(`${rel}\0`);
    hash.update(fs.readFileSync(path.join(ROOT, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// Read-only: the commit named in the re-capture command. Falls back to a visible placeholder.
function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 && /^[0-9a-f]{40}$/.test(result.stdout.trim()) ? result.stdout.trim() : '<commit>';
}

function recaptureCommand(commit) {
  return `node ci/prep/doc-reconciliation-red.js --recapture-candidate ${CANDIDATE_FILE} --baseline-sha ${commit}`;
}

function parseArgs(argv) {
  const args = {
    mode: null, cases: [], casesFile: DEFAULT_CASES, registryFile: DEFAULT_REGISTRY,
    json: false, log: null, candidateFile: null, baselineSha: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--strict' || item === '--expect-red') args.mode = item.slice(2);
    else if (item === '--json') args.json = true;
    else if (item === '--case') args.cases.push(argv[++i]);
    else if (item === '--cases') args.casesFile = argv[++i];
    else if (item === '--registry') args.registryFile = argv[++i];
    else if (item === '--log') args.log = argv[++i];
    else if (item === '--recapture-candidate') { args.mode = 'recapture'; args.candidateFile = argv[++i]; }
    else if (item === '--baseline-sha') args.baselineSha = argv[++i];
    else throw new RegistryError(`unknown argument ${item}`);
  }
  if (!args.mode) throw new RegistryError('choose --strict, --expect-red, or --recapture-candidate <file>');
  if (args.mode === 'recapture') {
    if (!/^[0-9a-f]{40}$/.test(args.baselineSha || '')) throw new RegistryError('--recapture-candidate needs --baseline-sha <40-hex commit>');
    if (!args.candidateFile) throw new RegistryError('--recapture-candidate needs a file path');
  }
  for (const value of [args.casesFile, args.registryFile]) {
    if (value === undefined) throw new RegistryError('a file argument is missing its value');
  }
  return args;
}

// Structural validation of the registry against the corpus. Any violation is a registry error (exit 2).
function validateRegistry(registry, corpus) {
  if (!registry || typeof registry !== 'object') throw new RegistryError('registry must be a JSON object');
  if (registry.schemaVersion !== 1) throw new RegistryError('registry schemaVersion must be 1');
  if (!/^[0-9a-f]{40}$/.test(registry.baselineSha || '')) throw new RegistryError('registry baselineSha must be a 40-hex commit');
  if (!/^[0-9a-f]{64}$/.test(registry.runtimeFingerprint || '')) throw new RegistryError('registry runtimeFingerprint must be a sha256');
  if (!Array.isArray(registry.entries)) throw new RegistryError('registry entries must be an array');
  const cases = new Map(corpus.cases.map(item => [item.id, item]));
  const seen = new Set();
  for (const [index, entry] of registry.entries.entries()) {
    const where = `entries[${index}]`;
    if (!entry || typeof entry !== 'object') throw new RegistryError(`${where} must be an object`);
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...ENTRY_KEYS].sort())) {
      throw new RegistryError(`${where} must have exactly the keys ${ENTRY_KEYS.join(', ')}`);
    }
    const item = cases.get(entry.caseId);
    if (!item) throw new RegistryError(`${where} names unknown case ${entry.caseId}`);
    const onId = String(entry.assertionId || '').startsWith(`${entry.caseId}.on.`)
      ? entry.assertionId.slice(`${entry.caseId}.on.`.length)
      : null;
    if (!onId || !item.expectations.on.some(assertion => assertion.id === onId)) {
      throw new RegistryError(`${where} names ${entry.assertionId}, which is not an ON assertion of ${entry.caseId}`);
    }
    if (!LEGS.includes(entry.distribution)) throw new RegistryError(`${where} distribution must be source or packaged`);
    if (entry.baselineSha !== registry.baselineSha) throw new RegistryError(`${where} baselineSha differs from the registry capture`);
    if (entry.blocker !== BLOCKER) throw new RegistryError(`${where} blocker must be ${BLOCKER}`);
    if (typeof entry.reasonCode !== 'string' || !entry.reasonCode.trim()) throw new RegistryError(`${where} reasonCode must be non-empty`);
    if (entry.reasonCode === UNREVIEWED_REASON) throw new RegistryError(`${where} reasonCode is ${UNREVIEWED_REASON}; a reviewer must replace it`);
    if (entry.actual === undefined || entry.desired === undefined) throw new RegistryError(`${where} needs actual and desired values`);
    const identity = `${entry.caseId}|${entry.assertionId}|${entry.distribution}`;
    if (seen.has(identity)) throw new RegistryError(`${where} duplicates ${identity}`);
    seen.add(identity);
  }
}

const sameJson = (left, right) => JSON.stringify(fx.normalize(left)) === JSON.stringify(fx.normalize(right));

function comparable(root) {
  return Object.fromEntries(Object.entries(root.actions).map(([id, action]) => [id, {
    exitCode: action.exitCode,
    signal: action.signal,
    stdout: action.json === null ? action.stdout : null,
    json: fx.normalize(action.json),
    stderr: action.stderr,
    state: fx.normalize(action.state)
  }]).concat([['$final', fx.normalize(root.state)]]));
}

// Classifies one case. `replays` holds the scrubbed roots: off/on for each leg.
function classifyCase(item, replays, registryEntries) {
  const assertions = [];
  let failed = false;
  let qualifiedGaps = 0;
  for (const leg of LEGS) {
    for (const mode of ['off', 'on']) {
      const root = replays[mode][leg];
      for (const result of fx.evaluateAll(root, item.expectations[mode])) {
        const assertionId = `${item.id}.${mode}.${result.id}`;
        if (mode === 'off') {
          if (!result.pass) failed = true;
          assertions.push({ leg, mode, id: assertionId, status: result.pass ? 'pass' : 'control-fail', actual: result.actual });
          continue;
        }
        const entry = registryEntries.find(candidate => candidate.assertionId === assertionId && candidate.distribution === leg);
        if (result.pass) {
          if (entry) { failed = true; assertions.push({ leg, mode, id: assertionId, status: 'unexpected-pass', actual: result.actual }); }
          else assertions.push({ leg, mode, id: assertionId, status: 'pass', actual: result.actual });
          continue;
        }
        if (!entry) {
          failed = true;
          assertions.push({ leg, mode, id: assertionId, status: 'gap-unqualified', actual: result.actual, desired: result.expected });
        } else if (sameJson(entry.actual, result.actual) && sameJson(entry.desired, result.expected)) {
          qualifiedGaps += 1;
          assertions.push({ leg, mode, id: assertionId, status: 'gap-qualified', actual: result.actual, desired: result.expected });
        } else {
          failed = true;
          assertions.push({ leg, mode, id: assertionId, status: 'gap-mismatch', actual: result.actual, desired: result.expected, registered: entry.actual });
        }
      }
    }
  }
  // Parity: the two legs must agree on every normalized replay of this case.
  let parity = 'match';
  for (const mode of ['off', 'on']) {
    if (!sameJson(comparable(replays[mode].source), comparable(replays[mode].packaged))) {
      parity = 'mismatch';
      failed = true;
    }
  }
  const status = failed ? 'FAIL' : qualifiedGaps > 0 ? 'EXPECTED_RED' : 'CONTROL_PASS';
  return { caseId: item.id, status, qualifiedGaps, parity, assertions };
}

// Both legs, both modes, for one case. Fresh replays every time; nothing is reused between cases or legs.
function replayAll(item) {
  const replays = { off: {}, on: {} };
  for (const leg of LEGS) {
    replays.off[leg] = fx.scrubReplay(fx.replayCase(item, leg));
    replays.on[leg] = fx.scrubReplay(fx.replayCase(item, leg, { pilot: '1' }));
  }
  return replays;
}

function loadRegistry(file) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RegistryError(`registry unreadable: ${error.message.split('\n')[0]}`);
  }
  return registry;
}

function run(args) {
  const corpus = fx.readCaseCorpus(args.casesFile);
  const registry = loadRegistry(args.registryFile);
  validateRegistry(registry, corpus);
  const runtime = fingerprint();
  const cases = corpus.cases.filter(item => args.cases.length === 0 || args.cases.includes(item.id));
  if (args.cases.length && cases.length !== args.cases.length) throw new RegistryError('a --case names no corpus case');
  const report = {
    schemaVersion: 1,
    mode: args.mode,
    baselineSha: registry.baselineSha,
    runtimeFingerprintMatches: registry.runtimeFingerprint === runtime,
    pilotCredit: false,
    cases: []
  };
  for (const item of cases) {
    const result = classifyCase(item, replayAll(item), registry.entries.filter(entry => entry.caseId === item.id));
    if (registry.runtimeFingerprint !== runtime) {
      result.status = 'FAIL';
      result.reason = 'runtime fingerprint differs from the registry capture';
    }
    report.cases.push(result);
  }
  if (!report.runtimeFingerprintMatches) report.recaptureCommand = recaptureCommand(currentCommit());
  return report;
}

// Candidate registry from the observed gaps on the current runtime. The committed registry is never written.
// Reason codes carry over by identity; a gap that is new to the registry gets the unreviewed marker.
function recapture(args) {
  const corpus = fx.readCaseCorpus(args.casesFile);
  const existing = fs.existsSync(args.registryFile) ? loadRegistry(args.registryFile).entries || [] : [];
  const known = new Map(existing.map(entry => [`${entry.assertionId}|${entry.distribution}`, entry.reasonCode]));
  const entries = [];
  const problems = [];
  const cases = corpus.cases.filter(item => args.cases.length === 0 || args.cases.includes(item.id));
  for (const item of cases) {
    const result = classifyCase(item, replayAll(item), []);
    for (const assertion of result.assertions) {
      if (assertion.status === 'control-fail') problems.push(`${item.id} control fails: ${assertion.id}`);
      if (assertion.status === 'gap-unqualified') {
        entries.push({
          caseId: item.id,
          assertionId: assertion.id,
          distribution: assertion.leg,
          baselineSha: args.baselineSha,
          actual: assertion.actual,
          desired: assertion.desired,
          blocker: BLOCKER,
          reasonCode: known.get(`${assertion.id}|${assertion.leg}`) || UNREVIEWED_REASON
        });
      }
    }
    if (result.parity === 'mismatch') problems.push(`${item.id} source and packaged legs disagree`);
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    candidate: { schemaVersion: 1, phase: '325-3b-H2', baselineSha: args.baselineSha, runtimeFingerprint: fingerprint(), entries }
  };
}

function summarize(report) {
  const lines = report.cases.map(item => {
    const gaps = item.assertions.filter(entry => entry.status.startsWith('gap')).length;
    const reason = item.reason ? ` (${item.reason})` : '';
    return `${item.caseId.padEnd(30)} ${item.status.padEnd(13)} gaps=${gaps} parity=${item.parity}${reason}`;
  });
  return lines.join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[doc-reconciliation-red] ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (args.mode === 'recapture') {
    let outcome;
    try {
      outcome = recapture(args);
    } catch (error) {
      console.error(`[doc-reconciliation-red] infrastructure: ${error.message.split('\n')[0]}`);
      process.exitCode = 2;
      return;
    }
    if (!outcome.ok) {
      console.error(`[doc-reconciliation-red] candidate not written:\n  ${outcome.problems.join('\n  ')}`);
      process.exitCode = 1;
      return;
    }
    const target = path.resolve(ROOT, args.candidateFile);
    fs.writeFileSync(target, `${JSON.stringify(outcome.candidate, null, 2)}\n`, 'utf8');
    const unreviewed = outcome.candidate.entries.filter(entry => entry.reasonCode === UNREVIEWED_REASON).length;
    console.log(`candidate written: ${args.candidateFile} (${outcome.candidate.entries.length} entries, ${unreviewed} unreviewed)`);
    console.log('review it against pending-red.json; replace the committed registry only after review, then delete the candidate.');
    process.exitCode = 0;
    return;
  }
  let report;
  try {
    report = run(args);
  } catch (error) {
    console.error(`[doc-reconciliation-red] infrastructure: ${error.message.split('\n')[0]}`);
    process.exitCode = 2;
    return;
  }
  if (args.log) fs.writeFileSync(args.log, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(summarize(report));
  if (report.recaptureCommand) {
    console.error(`[doc-reconciliation-red] runtime fingerprint changed since the registry capture. Re-capture deliberately; nothing is auto-accepted:\n` +
      `  1. ${report.recaptureCommand}\n` +
      `  2. review ${CANDIDATE_FILE} against ci/fixtures/doc-obligations/reconciliation-prep/pending-red.json (entries, reasonCode, actual, desired)\n` +
      '  3. replace pending-red.json with the reviewed candidate and delete the candidate file');
  }
  const failed = report.cases.some(item => item.status === 'FAIL');
  const gaps = report.cases.some(item => item.assertions.some(entry => entry.status.startsWith('gap')));
  if (args.mode === 'strict') process.exitCode = failed || gaps ? 1 : 0;
  else process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();

module.exports = { fingerprint, validateRegistry, classifyCase, run, recapture, parseArgs, recaptureCommand, RegistryError, FINGERPRINT_FILES, CANDIDATE_FILE };

'use strict';

// #341 Phase 0B (B1p scaffold): new-file byte and load parity for the private capture module, detachment
// detectors for its returned owned views, and pins that keep the 0A oracle unchanged.
//
// B1 has landed, so a missing capture module or packaged copy is always a FAIL, never a SKIP (#341 E0 requires
// the module checks unconditionally).
//
// Nothing here is evidence that the module is correct. B1 binds the detachment flow to the landed signatures
// and runs it; this file only fixes the checks and the failure modes.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { types } = require('util');
const fx = require('./lib/doc-evidence-fixtures');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_SCRIPTS = path.join(ROOT, 'harness-everything', 'scripts');
const PACKAGED_SCRIPTS = path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts');
const CANONICAL_EVAL = path.join(CANONICAL_SCRIPTS, 'doc-evidence.js');
const PACKAGED_EVAL = path.join(PACKAGED_SCRIPTS, 'doc-evidence.js');
const CANONICAL_CAPTURE = path.join(CANONICAL_SCRIPTS, 'doc-evidence-capture.js');
const PACKAGED_CAPTURE = path.join(PACKAGED_SCRIPTS, 'doc-evidence-capture.js');
const CORPUS = path.join(__dirname, 'fixtures', 'doc-obligations', 'read-boundary');
const REQUIRED = true;

// Pins from b0-baseline-rebased.txt. They were re-pinned after the reviewed 0A head 0f475ab (owner review of #344)
// changed the corpus: RB102-105 second-invocation trace/counter sections, RB103 recipe, and the new RB106 case.
// The 0B refactor itself must not change these bytes again; the 0A-era pins in b0-baseline.md are superseded.
const ORACLE_PINS = [
  ['cases.json', path.join(CORPUS, 'cases.json'), '623cae95b9f9e9c243d89ec2f845ded10e9dd3d32fd9e36deb6f081b03983acb'],
  ['expected.json', path.join(CORPUS, 'expected.json'), 'd1c16f18b49223387a89edaa8491cf10a003ce31b1cbefd44a0cdd30f0cfdc87']
];
// Every retained transparency and in-call/post-return control that B1 must keep.
const RETAINED_CASES = ['RB36', 'RB38', 'RB39', 'RB40', 'RB41', 'RB102', 'RB103', 'RB104', 'RB105'];

let passed = 0;
let skipped = 0;
let failed = 0;

class Skip extends Error {}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkCase(name, run) {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    if (error instanceof Skip) {
      if (REQUIRED) {
        failed += 1;
        console.error(`FAIL ${name}: ${error.message} (capture module is required)`);
        return;
      }
      skipped += 1;
      console.log(`SKIP ${name}: ${error.message}`);
      return;
    }
    failed += 1;
    console.error(`FAIL ${name}: ${String(error.message).split('\n')[0]}`);
  }
}

function requirePresent(files, label) {
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Skip(`${label} absent until B1 lands (${path.relative(ROOT, file)})`);
    }
  }
}

// Detects a returned view that is not owned. Owned views are scalars, plain or null-prototype objects, and
// arrays, with only data properties. Caller Proxies and caller-input identities are rejected through the
// factory's identity registry. Descriptors are read from views the module allocated, so no caller getter runs.
function ownedViewViolations(value, recorder) {
  const violations = [];
  const seen = new Set();
  const visit = (node, at) => {
    if (node === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof node)) return;
    if (typeof node !== 'object') {
      violations.push(`${at}: ${typeof node} is not a scalar`);
      return;
    }
    if (types.isProxy(node)) {
      violations.push(`${at}: is a Proxy`);
      return;
    }
    if (recorder && recorder.idOf(node) !== undefined) {
      violations.push(`${at}: references a caller input object`);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    const proto = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
      violations.push(`${at}: prototype is not a plain, null or array prototype`);
      return;
    }
    for (const key of Reflect.ownKeys(node)) {
      if (typeof key === 'symbol') {
        violations.push(`${at}: symbol key`);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (!('value' in descriptor)) {
        violations.push(`${at}.${key}: accessor descriptor`);
        continue;
      }
      visit(descriptor.value, `${at}.${key}`);
    }
  };
  visit(value, 'view');
  return violations;
}

// A tiny factory recipe for detector self-tests: one artifacts entry with a digest.
const SELF_TEST_RECIPE = {
  nodes: { entry: { kind: 'object', props: { digest: 'a'.repeat(64) } } },
  input: { artifacts: { $ref: 'entry' }, obligations: { kind: 'array', items: [] } }
};

console.log('=== #341 0B B1p: capture module scaffold (new-file parity, detachment detectors, oracle pins) ===');

// Detector self-tests. They run now, so the detachment harness is validated before B1 relies on it.
checkCase('detector accepts owned scalars, records, null-prototype records and arrays', () => {
  const nullRecord = Object.assign(Object.create(null), { digest: 'b'.repeat(64) });
  const owned = { kind: 'present', value: 'x', nested: [{ kind: 'absent' }, nullRecord, [1, 'two', undefined, null]] };
  assert.deepStrictEqual(ownedViewViolations(owned, null), []);
});

checkCase('detector rejects a caller Proxy inside a returned view', () => {
  const built = fx.buildCase(SELF_TEST_RECIPE, { traced: true });
  const violations = ownedViewViolations({ leaked: built.input.artifacts }, built.recorder);
  assert.ok(violations.some(item => item.includes('is a Proxy')), violations.join('; '));
});

checkCase('detector rejects a reference to a caller input object', () => {
  const built = fx.buildCase(SELF_TEST_RECIPE, { traced: false });
  const violations = ownedViewViolations({ leaked: built.input.artifacts }, built.recorder);
  assert.ok(violations.some(item => item.includes('caller input object')), violations.join('; '));
});

checkCase('detector rejects an accessor descriptor, a function and a symbol key', () => {
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { return 1; } });
  assert.ok(ownedViewViolations(accessor, null).some(item => item.includes('accessor descriptor')));
  assert.ok(ownedViewViolations({ f: () => 1 }, null).some(item => item.includes('function is not a scalar')));
  assert.ok(ownedViewViolations({ [Symbol('tag')]: 1 }, null).some(item => item.includes('symbol key')));
});

// Oracle pins. The 0A corpus and expectations must stay byte-identical through 0B.
for (const [label, file, expected] of ORACLE_PINS) {
  checkCase(`oracle pin: ${label} is byte-identical to the B0 baseline`, () => {
    assert.strictEqual(sha256(file), expected, `${label} changed`);
  });
}

checkCase('oracle pin: canonical and packaged evaluators are byte-identical (B4 state)', () => {
  assert.strictEqual(sha256(CANONICAL_EVAL), sha256(PACKAGED_EVAL));
});

checkCase('retained controls: every RB36/RB38-41 and RB102-105 case is still in the corpus', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(CORPUS, 'cases.json'), 'utf8'));
  const ids = new Set(corpus.cases.map(item => item.caseId));
  const missing = RETAINED_CASES.filter(id => !ids.has(id));
  assert.deepStrictEqual(missing, []);
});

// Module-dependent checks. Each one is skipped, not passed, until its files exist.
checkCase('byte parity: canonical and packaged capture modules exist', () => {
  requirePresent([CANONICAL_CAPTURE, PACKAGED_CAPTURE], 'capture module');
});

checkCase('byte parity: canonical and packaged capture modules have identical bytes', () => {
  requirePresent([CANONICAL_CAPTURE, PACKAGED_CAPTURE], 'capture module');
  assert.strictEqual(sha256(CANONICAL_CAPTURE), sha256(PACKAGED_CAPTURE));
});

// Loads one evaluator from a temporary copy beside its capture module, and reports which capture file loaded.
// The copy is removed afterwards, and the module cache entries it created are dropped. Node keys the cache by
// realpath, so the directory is resolved first: on macOS os.tmpdir() (/var/...) is a symlink to /private/var/....
function loadEvaluatorCopy(evaluatorFile, captureFile) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'b1p-load-')));
  const evaluatorCopy = path.join(dir, 'doc-evidence.js');
  const captureCopy = path.join(dir, 'doc-evidence-capture.js');
  try {
    fs.copyFileSync(evaluatorFile, evaluatorCopy);
    fs.copyFileSync(captureFile, captureCopy);
    const mod = require(evaluatorCopy);
    const loaded = Object.keys(require.cache).filter(key => key.startsWith(dir));
    return { mod, loaded, captureCopy, dir };
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(dir)) delete require.cache[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

checkCase('load parity: the packaged evaluator loads its adjacent packaged capture module, never a canonical fallback', () => {
  requirePresent([PACKAGED_EVAL, PACKAGED_CAPTURE], 'packaged capture module');
  const { mod, loaded, captureCopy } = loadEvaluatorCopy(PACKAGED_EVAL, PACKAGED_CAPTURE);
  assert.strictEqual(typeof mod.checkDocObligations, 'function', 'public export is unchanged');
  assert.ok(loaded.includes(captureCopy), `the adjacent capture module loaded (${loaded.length} copy-local modules)`);
  assert.ok(!loaded.includes(fs.realpathSync(CANONICAL_CAPTURE)), 'no canonical capture module was loaded');
});

checkCase('load parity: the canonical evaluator loads its adjacent canonical capture module', () => {
  requirePresent([CANONICAL_EVAL, CANONICAL_CAPTURE], 'canonical capture module');
  const mod = require(CANONICAL_EVAL);
  assert.strictEqual(typeof mod.checkDocObligations, 'function', 'public export is unchanged');
  assert.ok(Object.keys(require.cache).includes(CANONICAL_CAPTURE), 'the canonical capture module loaded');
  assert.ok(!Object.keys(require.cache).includes(PACKAGED_CAPTURE), 'no packaged capture module was loaded');
});

checkCase('module contract: the capture module exports only createInvocationCapture', () => {
  requirePresent([CANONICAL_CAPTURE], 'capture module');
  const exported = require(CANONICAL_CAPTURE);
  assert.deepStrictEqual(Object.keys(exported), ['createInvocationCapture']);
  assert.strictEqual(typeof exported.createInvocationCapture, 'function');
});

// Detachment proof (plan §3, B04). Each contract is an assertion with its own event id, so the mutation runner
// credits a kill only to the contract the mutant breaks. Every contract runs over both distributions' modules.
const EVENT_FILE = process.env.HARNESS_ASSERTION_EVENT_FILE;
const SELECTED_ASSERTION = process.env.HARNESS_ASSERTION_ID;
const DETACHMENT_CASE = 'CAPTURE-B04';
const detachmentFailures = [];

function emit(event) {
  if (!EVENT_FILE) return;
  fs.appendFileSync(EVENT_FILE, `${JSON.stringify({ schemaVersion: 1, ...event })}\n`, 'utf8');
}

function assertion(contract, run) {
  const assertionId = `${DETACHMENT_CASE}.${contract}`;
  if (SELECTED_ASSERTION && SELECTED_ASSERTION !== assertionId) return;
  try {
    run();
  } catch (error) {
    // Only an assertion-library comparison is an assertion failure; anything else is infrastructure and propagates.
    if (!(error instanceof assert.AssertionError)) throw error;
    detachmentFailures.push(assertionId);
    emit({ event: 'assertion-failure', caseId: DETACHMENT_CASE, assertionId, errorCode: 'ERR_ASSERTION', message: String(error.message).split('\n')[0] });
    console.error(`FAIL ${assertionId}: ${String(error.message).split('\n')[0]}`);
    return;
  }
  emit({ event: 'assertion-pass', caseId: DETACHMENT_CASE, assertionId });
  console.log(`PASS ${assertionId}`);
}

// A caller input for one obligation: one deleted entry with a trusted baseline digest and a candidate artifact.
function detachmentInput() {
  return {
    entryOld: { path: 'docs/adr/OLD.md', reason: 'deleted' },
    baselineArtifacts: { 'docs/adr/OLD.md': 'e'.repeat(64) },
    artifacts: { 'docs/adr/NEW.md': { digest: '3'.repeat(64) } }
  };
}

// Every object reachable from the caller input. A returned view that holds one of these leaks caller state.
function inputObjects(input) {
  const seen = new Set();
  const walk = value => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) walk(child);
  };
  walk(input);
  return seen;
}

// Runs the capture schedule for one obligation and returns the views the evaluator would receive.
function captureViews(createInvocationCapture, input) {
  const baseline = { digest: 'b'.repeat(64), artifacts: input.baselineArtifacts };
  const capture = createInvocationCapture({ artifacts: input.artifacts, baseline });
  capture.initializeArtifactFallback();
  capture.captureBaselineIdentity();
  const obligation = capture.beginObligation('applicable');
  obligation.prepareBaselineContainer();
  const entry = obligation.captureEntry(input.entryOld);
  const absence = obligation.captureSourceAbsence(entry.token, input.entryOld.path);
  const baselineRead = obligation.captureBaselinePath(input.entryOld.path);
  obligation.acceptBaselineEntry({
    entryToken: entry.token,
    path: input.entryOld.path,
    reason: input.entryOld.reason,
    trustedBaselineDigest: baselineRead.value
  });
  return {
    obligation,
    entry,
    absence,
    baselineRead,
    entries: obligation.baselineEntries(),
    pairs: obligation.baselineAuditPairs()
  };
}

function eachModule(run) {
  for (const [name, file] of [['canonical', CANONICAL_CAPTURE], ['packaged', PACKAGED_CAPTURE]]) {
    run(name, require(file));
  }
}

function viewsOf(views) {
  return [views.entry, views.absence, views.baselineRead, ...views.entries, ...views.pairs];
}

assertion('detachment.no-input-references', () => eachModule((name, mod) => {
  const input = detachmentInput();
  const views = captureViews(mod.createInvocationCapture, input);
  const inputs = inputObjects(input);
  const recorder = { idOf: value => (inputs.has(value) ? 'caller-input' : undefined) };
  const violations = viewsOf(views).flatMap(view => ownedViewViolations(view, recorder));
  assert.deepStrictEqual(violations, [], `${name}: a returned view is not owned or references caller input`);
}));

assertion('detachment.views-fresh-copies', () => eachModule((name, mod) => {
  const { obligation } = captureViews(mod.createInvocationCapture, detachmentInput());
  const first = obligation.baselineEntries();
  const second = obligation.baselineEntries();
  assert.strictEqual(first.length, 1, `${name}: the accepted entry is returned`);
  assert.notStrictEqual(first, second, `${name}: each call returns a new array`);
  assert.notStrictEqual(first[0], second[0], `${name}: each call returns fresh copies, not one shared internal view`);
}));

assertion('detachment.views-unchanged-after-mutation', () => eachModule((name, mod) => {
  const input = detachmentInput();
  const views = captureViews(mod.createInvocationCapture, input);
  const before = JSON.stringify(viewsOf(views));
  input.baselineArtifacts['docs/adr/OLD.md'] = 'f'.repeat(64);
  input.entryOld.path = 'docs/adr/OTHER.md';
  input.artifacts['docs/adr/NEW.md'].digest = '4'.repeat(64);
  assert.strictEqual(JSON.stringify(viewsOf(views)), before, `${name}: a returned view changed after the caller mutated its input`);
}));

assertion('detachment.fresh-invocation-sees-new-data', () => eachModule((name, mod) => {
  const input = detachmentInput();
  captureViews(mod.createInvocationCapture, input);
  input.baselineArtifacts['docs/adr/OLD.md'] = 'f'.repeat(64);
  const fresh = captureViews(mod.createInvocationCapture, input);
  assert.strictEqual(fresh.baselineRead.value, 'f'.repeat(64), `${name}: a fresh invocation reads the mutated baseline value`);
}));

console.log(`\n[341 capture-module] ${passed} passed, ${skipped} skipped, ${failed + detachmentFailures.length} failed`);
if (skipped > 0 && !REQUIRED) {
  console.log('Skipped checks are not evidence. They run once B1 lands the module and its packaged copy.');
}
process.exitCode = failed || detachmentFailures.length ? 1 : 0;

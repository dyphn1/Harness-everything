'use strict';

// #341 Phase 0B (B1p scaffold): new-file byte and load parity for the private capture module, detachment
// detectors for its returned owned views, and pins that keep the 0A oracle unchanged.
//
// SKIP-until-present: while B1 is in progress the module and its packaged copy may not exist. A check that
// depends on them prints an explicit SKIP line and does not pass. Set HARNESS_341_CAPTURE_REQUIRED=1 to turn
// that absence into a FAIL; the coordinator sets it when B1 is accepted. Detector self-tests and oracle pins
// always run, because they do not depend on the module.
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
const REQUIRED = process.env.HARNESS_341_CAPTURE_REQUIRED === '1';

// Pins from b0-baseline.md. The oracle corpus must not change in 0B.
const ORACLE_PINS = [
  ['cases.json', path.join(CORPUS, 'cases.json'), 'c9e6792b76197cd30e29c2cfe66544cbc46ae46eae9ef84d038843239bc76386'],
  ['expected.json', path.join(CORPUS, 'expected.json'), '44e2c5c29fd6719f1aa67e86a197257727993c104c445b134d082e8891850f10']
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
        console.error(`FAIL ${name}: ${error.message} (HARNESS_341_CAPTURE_REQUIRED=1)`);
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

checkCase('oracle pin: canonical and packaged evaluators are still byte-identical (unchanged until B1)', () => {
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
// The copy is removed afterwards, and the module cache entries it created are dropped.
function loadEvaluatorCopy(evaluatorFile, captureFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b1p-load-'));
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
  assert.ok(!loaded.includes(CANONICAL_CAPTURE), 'no canonical capture module was loaded');
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

checkCase('detachment flow: returned owned views stay unchanged after caller mutation and a fresh invocation sees new data', () => {
  requirePresent([CANONICAL_CAPTURE], 'capture module');
  // The flow is bound to the landed signatures in B1. Until then this check cannot pass or fail; it skips.
  throw new Skip('detachment flow awaits B1 binding to the landed capture signatures');
});

console.log(`\n[341 capture-module scaffold] ${passed} passed, ${skipped} skipped, ${failed} failed`);
if (skipped > 0 && !REQUIRED) {
  console.log('Skipped checks are not evidence. They run once B1 lands the module and its packaged copy.');
}
process.exitCode = failed ? 1 : 0;

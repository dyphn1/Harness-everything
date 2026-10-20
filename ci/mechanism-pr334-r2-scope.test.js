'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const derivePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-obligations.js');
const fixturePath = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive', 'req-revision');
const derivePathRoot = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive');
const { deriveDocFacts, deriveDocObligations } = require(derivePath);
const CONFIG = JSON.parse(fs.readFileSync(path.join(derivePathRoot, 'config.json'), 'utf8'));
const TEST_A = 'ci/mechanism-pr334-r2-a.test.js';
const TEST_B = 'ci/mechanism-pr334-r2-b.test.js';
const A_BASE = '// REQ-GRPH-011\nassert.equal(runA(), 1);\n';
const A_CHANGED = '// REQ-GRPH-011\nassert.equal(runA(), 2);\n';

function readTree(root) {
  const files = {};
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

function deriveWithB(beforeB, afterB, afterA = A_CHANGED) {
  const baseFiles = readTree(path.join(fixturePath, 'base'));
  const candidateFiles = readTree(path.join(fixturePath, 'candidate'));
  // The fixture's own test is replaced by the two explicit inputs below.
  delete baseFiles['ci/mechanism-lint.test.js'];
  delete candidateFiles['ci/mechanism-lint.test.js'];
  baseFiles[TEST_A] = A_BASE;
  candidateFiles[TEST_A] = afterA;
  if (beforeB !== undefined) baseFiles[TEST_B] = beforeB;
  if (afterB !== undefined) candidateFiles[TEST_B] = afterB;

  const result = deriveDocFacts({
    base: { files: baseFiles },
    candidate: { files: candidateFiles },
    config: CONFIG
  });
  const requirementSync = deriveDocObligations(result.facts)
    .find(item => item.capability === 'requirement-sync');
  return { facts: result.facts, requirementSync };
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

checkCase('R2 comment-only unrelated REQ test stays out of changed A scope while legal A revision is delivered', () => {
  const { facts, requirementSync } = deriveWithB(
    '// REQ-GRPH-010\n// old note\nassert.equal(runB(), 1);\n',
    '// REQ-GRPH-010\n// revised note\nassert.equal(runB(), 1);\n'
  );

  assert.strictEqual(facts.requirementSyncTrigger, 'assertion-change', 'A assertion change triggers requirement-sync');
  assert.ok(facts.reqUpdates.some(item => item.id === 'REQ-GRPH-011' && item.file === 'docs/prd/graph/r002.md'),
    `the legal A successor is delivered: ${JSON.stringify(facts.reqUpdates)}`);
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-011'], 'only A contributes a cited REQ');
  assert.ok(facts.reqCitingTests.includes(TEST_A), 'A is a contributing test path');
  assert.ok(!facts.reqCitingTests.includes(TEST_B), 'comment-only B is not a contributing test path');
  assert.ok(requirementSync.scope.paths.includes(TEST_A), 'scope retains A');
  assert.ok(!requirementSync.scope.paths.includes(TEST_B), `scope excludes comment-only B: ${requirementSync.scope.paths}`);
});

checkCase('R2 title-only unrelated REQ test edit stays out of changed A scope', () => {
  const { facts, requirementSync } = deriveWithB(
    "test('REQ-GRPH-010 old title', () => { assert.equal(runB(), 1); });\n",
    "test('REQ-GRPH-010 renamed title', () => { assert.equal(runB(), 1); });\n"
  );

  assert.strictEqual(facts.assertionChanged, true, 'only A has an assertion change');
  assert.ok(!facts.reqCitingTests.includes(TEST_B), 'a title-only edit is not a contributing test path');
  assert.ok(!requirementSync.scope.paths.includes(TEST_B), 'title-only B is excluded from requirement-sync scope');
});

checkCase('R2 formatting-only unrelated REQ test edit stays out of changed A scope', () => {
  const { facts, requirementSync } = deriveWithB(
    '// REQ-GRPH-010\nassert.equal(runB(), 1);\n',
    '// REQ-GRPH-010\nassert.equal( runB( ), 1 );\n'
  );

  assert.strictEqual(facts.assertionChanged, true, 'formatting in B does not add a second assertion change');
  assert.ok(!facts.reqCitingTests.includes(TEST_B), 'formatting-only B is not a contributing test path');
  assert.ok(!requirementSync.scope.paths.includes(TEST_B), 'formatting-only B is excluded from requirement-sync scope');
});

checkCase('R2 genuine B assertion edit joins A in requirement-sync scope', () => {
  const { facts, requirementSync } = deriveWithB(
    '// REQ-GRPH-010\nassert.equal(runB(), 1);\n',
    '// REQ-GRPH-010\nassert.equal(runB(), 2);\n'
  );

  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-010', 'REQ-GRPH-011'],
    'both changed assertions contribute their own requirement IDs');
  assert.ok(facts.reqCitingTests.includes(TEST_A) && facts.reqCitingTests.includes(TEST_B),
    'both contributing test files remain in the path inventory');
  assert.ok(requirementSync.scope.paths.includes(TEST_A) && requirementSync.scope.paths.includes(TEST_B),
    `both changed test paths are scoped: ${requirementSync.scope.paths}`);
});

checkCase('R2 mixed known A assertion and unknown B attribution keeps B path and unknown scope', () => {
  const { facts, requirementSync } = deriveWithB(
    "test('REQ-GRPH-010 existing', () => { assert.equal(runB(), 1); });\n",
    "test('REQ-GRPH-010 existing', () => { assert.equal(runB(), 2);\n"
  );

  assert.strictEqual(facts.requirementScopeUnknown, true, 'malformed B attribution remains explicitly unknown');
  assert.strictEqual(requirementSync.applicability, 'unknown', 'known A evidence cannot close the mixed unknown scope');
  assert.strictEqual(requirementSync.scope.requirementIds, 'unknown', 'the scope does not claim a known subset');
  assert.ok(facts.reqCitingTests.includes(TEST_B), 'the unknown B path remains visible');
  assert.ok(requirementSync.scope.paths.includes(TEST_B), `unknown B path remains in scope: ${requirementSync.scope.paths}`);
});

helper.finish();

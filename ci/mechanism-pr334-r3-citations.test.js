'use strict';

const assert = require('assert');
const path = require('path');
const helper = require('./test-helper');

const { deriveDocFacts, deriveDocObligations } = require(path.join(
  __dirname,
  '..',
  'harness-everything',
  'scripts',
  'doc-obligations.js'
));

const TEST_PATH = 'ci/pr334-citations.test.js';
const A = 'REQ-GRPH-001';
const B = 'REQ-GRPH-002';
const C = 'REQ-GRPH-003';

function derive(beforeText, afterText) {
  const result = deriveDocFacts({
    base: { files: { [TEST_PATH]: beforeText } },
    candidate: { files: { [TEST_PATH]: afterText } },
    config: {}
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

function assertUnknownCitation({ facts, requirementSync }, expectedIds, reason) {
  assert.strictEqual(facts.requirementScopeUnknown, true, reason);
  assert.strictEqual(requirementSync.applicability, 'unknown', reason);
  assert.strictEqual(requirementSync.scope.requirementIds, 'unknown', reason);
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), expectedIds, 'candidate REQ identities remain visible');
  assert.ok(facts.reqCitingTests.includes(TEST_PATH), 'the candidate test path remains visible');
  assert.ok(requirementSync.scope.paths.includes(TEST_PATH), 'unknown candidate path remains in obligation scope');
}

checkCase('R3 retargeting test citation A to B with the same body is unknown and retains B', () => {
  const result = derive(
    `test('${A} stable title', () => { verifyShared(); });\n`,
    `test('${B} stable title', () => { verifyShared(); });\n`
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, null, 'a retarget is not misclassified as a newly added test');
  assertUnknownCitation(result, [B], 'body equality cannot make a changed REQ association known');
});

checkCase('R3 adding citation A to an existing test with the same body is unknown and retains A', () => {
  const result = derive(
    "test('unchanged title', () => { verifyShared(); });\n",
    `test('${A} unchanged title', () => { verifyShared(); });\n`
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, null, 'a citation change is not classified as a new test');
  assertUnknownCitation(result, [A], 'the added candidate citation is not silently dropped');
});

checkCase('R3 removing citation A from an existing test with the same body stays unknown, never N/A', () => {
  const result = derive(
    `test('${A} unchanged title', () => { verifyShared(); });\n`,
    "test('unchanged title', () => { verifyShared(); });\n"
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, null, 'citation removal is not an assertion edit');
  assertUnknownCitation(result, [A], 'removed identity remains visible while the association is unresolved');
});

checkCase('R3 adding B to an existing {A} citation keeps both candidate IDs under unknown scope', () => {
  const result = derive(
    `test('${A} title', () => { verifyShared(); });\n`,
    `test('${A} ${B} title', () => { verifyShared(); });\n`
  );

  assertUnknownCitation(result, [A, B], 'the full candidate set is preserved after an identity-set change');
});

checkCase('R3 reordering an unchanged REQ identity set remains a display-only title edit', () => {
  const result = derive(
    `test('${A} ${B} stable title', () => { verifyShared(); });\n`,
    `test('${B} ${A} stable title', () => { verifyShared(); });\n`
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, null, 'the cited set is unchanged');
  assert.strictEqual(result.facts.requirementScopeUnknown, false, 'sorted set identity remains stable');
  assert.deepStrictEqual(result.facts.citedReqs, [], 'a display-only ID reordering adds no candidate change');
  assert.strictEqual(result.requirementSync.applicability, 'N/A', 'unchanged citation identity stays N/A');
});

checkCase('R3 multiple same-body tests can reorder by citation identity without cross-pairing', () => {
  const result = derive(
    [
      `test('${A} first', () => { verifyShared(); });`,
      `test('${B} second', () => { verifyShared(); });`
    ].join('\n'),
    [
      `test('${B} second', () => { verifyShared(); });`,
      `test('${A} first', () => { verifyShared(); });`
    ].join('\n')
  );

  assert.strictEqual(result.facts.requirementScopeUnknown, false, 'same-body calls match by their unchanged REQ sets');
  assert.strictEqual(result.requirementSync.applicability, 'N/A', 'reordering unchanged calls is not a citation change');
});

checkCase('R3 shared-body A-to-C retarget stays unknown beside an unchanged B call', () => {
  const result = derive(
    [
      `test('${A} first', () => { verifyShared(); });`,
      `test('${B} second', () => { verifyShared(); });`
    ].join('\n'),
    [
      `test('${C} renamed first', () => { verifyShared(); });`,
      `test('${B} second', () => { verifyShared(); });`
    ].join('\n')
  );

  assertUnknownCitation(result, [C], 'the shared body cannot consume A and hide candidate C');
});

checkCase('R3 retargeting a legacy file-level REQ tag keeps candidate B and unknown scope', () => {
  const result = derive(
    `// ${A}\nassert.equal(run(), 1);\n`,
    `// ${B}\nassert.equal(run(), 1);\n`
  );

  assertUnknownCitation(result, [B], 'file-level citation retargeting is not a harmless comment edit');
});

checkCase('R3 adding a legacy file-level REQ tag to an unchanged assertion is an identity delta', () => {
  const result = derive(
    'assert.equal(run(), 1);\n',
    `// ${A}\nassert.equal(run(), 1);\n`
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, null, 'tag addition alone is not a new test or assertion edit');
  assertUnknownCitation(result, [A], 'a newly attached legacy tag remains an unresolved candidate identity');
});

checkCase('R3 removing a legacy file-level REQ tag keeps its old identity visible under unknown scope', () => {
  const result = derive(
    `// ${A}\nassert.equal(run(), 1);\n`,
    'assert.equal(run(), 1);\n'
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, null, 'tag removal alone is not a new test or assertion edit');
  assertUnknownCitation(result, [A], 'removed legacy identity and affected path remain visible');
});

checkCase('R3 ordinary comment typo remains outside REQ citation identity', () => {
  const result = derive(
    '// baseline note\nassert.equal(run(), 1);\n',
    '// basline note\nassert.equal(run(), 1);\n'
  );

  assert.strictEqual(result.facts.requirementScopeUnknown, false, 'ordinary comments do not create citation ambiguity');
  assert.deepStrictEqual(result.facts.citedReqs, [], 'ordinary comments contribute no cited ID');
  assert.strictEqual(result.requirementSync.applicability, 'N/A', 'ordinary comment typo stays N/A');
});

checkCase('R3 genuine new REQ test remains a new-test signal', () => {
  const result = derive(
    `test('${A} existing', () => { verifyA(); });\n`,
    [
      `test('${A} existing', () => { verifyA(); });`,
      `test('${B} added', verifyB);`
    ].join('\n')
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, 'new-test', 'a real test addition remains a new-test signal');
  assert.deepStrictEqual(result.facts.citedReqs.map(item => item.id), [B], 'the genuinely added candidate ID is retained');
  assert.strictEqual(result.requirementSync.applicability, 'applicable', 'a genuine test addition remains applicable');
});

checkCase('R3 same-citation assertion change remains attributed and applicable', () => {
  const result = derive(
    `test('${A} stable title', () => { assert.equal(run(), 1); });\n`,
    `test('${A} stable title', () => { assert.equal(run(), 2); });\n`
  );

  assert.strictEqual(result.facts.requirementSyncTrigger, 'assertion-change', 'an existing assertion edit keeps its trigger');
  assert.deepStrictEqual(result.facts.citedReqs.map(item => item.id), [A], 'the changed assertion retains its existing citation');
  assert.strictEqual(result.requirementSync.applicability, 'applicable', 'known same-REQ assertion edits remain applicable');
});

checkCase('R3 ambiguous same-REQ body replacement remains unknown and keeps candidate identity', () => {
  const result = derive(
    `test('${A} old', () => { verifyOld(); });\n`,
    `test('${A} replacement', () => { verifyNew(); });\n`
  );

  assertUnknownCitation(result, [A], 'an unresolved call association retains its candidate REQ');
});

helper.finish();

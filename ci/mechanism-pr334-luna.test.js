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

const TEST_PATH = 'ci/pr334-identity.test.js';

function deriveSnapshots(baseFiles, candidateFiles) {
  const result = deriveDocFacts({
    base: { files: baseFiles },
    candidate: { files: candidateFiles },
    config: {}
  });
  const requirementSync = deriveDocObligations(result.facts)
    .find(item => item.capability === 'requirement-sync');
  return { facts: result.facts, requirementSync };
}

function derive(beforeText, afterText) {
  return deriveSnapshots({ [TEST_PATH]: beforeText }, { [TEST_PATH]: afterText });
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

checkCase('PR334 title-only REQ test rename leaves assertion range unchanged and requirement-sync N/A', () => {
  const { facts, requirementSync } = derive(
    "test('REQ-GRPH-001 old title', () => { assert.equal(run(), 1); });\n",
    "test('REQ-GRPH-001 renamed title', () => { assert.equal(run(), 1); });\n"
  );

  assert.strictEqual(facts.assertionChanged, false, 'changed title tokens are outside the assertion call');
  assert.strictEqual(facts.requirementSyncTrigger, null, 'a title rename is not a new test or assertion edit');
  assert.deepStrictEqual(facts.citedReqs, [], 'a title-only edit contributes no changed assertion citation');
  assert.strictEqual(requirementSync.applicability, 'N/A', 'the title-only rename is not a sync candidate');
});

checkCase('PR334 changing a REQ ID in an existing test title keeps the new citation and marks identity unknown', () => {
  const { facts, requirementSync } = derive(
    "test('REQ-GRPH-001 unchanged title', () => { verify(); });\n",
    "test('REQ-GRPH-002 unchanged title', () => { verify(); });\n"
  );

  assert.strictEqual(facts.requirementSyncTrigger, null, 'the test body and inventory are unchanged');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-002'], 'the candidate citation is retained');
  assert.strictEqual(requirementSync.requirementScopeUnknown, true, 'body sameness does not settle changed citation identity');
  assert.strictEqual(requirementSync.applicability, 'unknown', 'changed citation identity is never treated as N/A');
});

checkCase('PR334 adding a REQ ID only to an existing test title keeps the new citation and marks identity unknown', () => {
  const { facts, requirementSync } = derive(
    "test('unchanged title', () => { verify(); });\n",
    "test('REQ-GRPH-001 unchanged title', () => { verify(); });\n"
  );

  assert.strictEqual(facts.requirementSyncTrigger, null, 'a title-only citation is not a new test');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-001'], 'the candidate citation is retained');
  assert.strictEqual(requirementSync.requirementScopeUnknown, true, 'body sameness does not settle changed citation identity');
  assert.strictEqual(requirementSync.applicability, 'unknown', 'changed citation identity is never treated as N/A');
});

checkCase('PR334 title rename plus a different REQ test assertion edit stays assertion-change and scopes only the edited assertion', () => {
  const { facts, requirementSync } = derive(
    [
      "test('REQ-GRPH-001 stable assertion', () => { assert.equal(runA(), 1); });",
      "test('REQ-GRPH-002 edited assertion', () => { assert.equal(runB(), 2); });"
    ].join('\n'),
    [
      "test('REQ-GRPH-001 renamed assertion title', () => { assert.equal(runA(), 1); });",
      "test('REQ-GRPH-002 edited assertion', () => { assert.equal(runB(), 3); });"
    ].join('\n')
  );

  assert.strictEqual(facts.assertionChanged, true, 'the changed numeric argument is inside REQ-GRPH-002 assertion');
  assert.strictEqual(facts.requirementSyncTrigger, 'assertion-change', 'an existing test body edit is not a new test');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-002'],
    'the title-only REQ-GRPH-001 rename does not enter the changed assertion scope');
  assert.strictEqual(requirementSync.applicability, 'applicable', 'the changed assertion triggers requirement-sync');
});

checkCase('PR334 title and assertion edits in one existing REQ test do not become a new-test signal', () => {
  const { facts, requirementSync } = derive(
    "test('REQ-GRPH-001 old title', () => { assert.equal(run(), 1); });\n",
    "test('REQ-GRPH-001 renamed title', () => { assert.equal(run(), 2); });\n"
  );

  assert.strictEqual(facts.assertionChanged, true, 'the assertion argument changed');
  assert.strictEqual(facts.requirementSyncTrigger, 'assertion-change', 'an existing requirement call remains the same test');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-001'],
    'the changed assertion retains its own requirement citation');
  assert.strictEqual(requirementSync.requirementScopeUnknown, true, 'simultaneous title and body edits make test identity ambiguous');
  assert.strictEqual(requirementSync.applicability, 'unknown', 'ambiguous identity cannot be treated as a fully known scope');
});

checkCase('PR334 a same-REQ call replacement with no stable identity is unknown, never silently N/A', () => {
  const { facts, requirementSync } = derive(
    "test('REQ-GRPH-001 old check', () => { verifyOldBehavior(); });\n",
    "test('REQ-GRPH-001 replacement check', () => { verifyNewBehavior(); });\n"
  );

  assert.strictEqual(facts.requirementSyncTrigger, null, 'the snapshots cannot prove whether this is a new test or a wholesale edit');
  assert.strictEqual(requirementSync.requirementScopeUnknown, true, 'ambiguous test identity remains explicit');
  assert.strictEqual(requirementSync.applicability, 'unknown', 'ambiguous identity is never downgraded to N/A');
});

checkCase('PR334 added REQ-citing test beside an unchanged one remains a new-test control', () => {
  const { facts, requirementSync } = derive(
    "test('REQ-GRPH-001 existing', () => { verifyA(); });\n",
    [
      "test('REQ-GRPH-001 existing', () => { verifyA(); });",
      "test('REQ-GRPH-002 added', verifyB);"
    ].join('\n')
  );

  assert.strictEqual(facts.assertionChanged, false, 'the helper-delegated addition has no assertion-body edit');
  assert.strictEqual(facts.requirementSyncTrigger, 'new-test', 'the added REQ-citing test is a new-test signal');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-002'],
    'the new test contributes its own cited requirement');
  assert.strictEqual(requirementSync.applicability, 'applicable', 'the new test triggers requirement-sync');
});

checkCase('PR334 reordering existing same-REQ test calls does not become a new-test identity', () => {
  const { facts, requirementSync } = derive(
    [
      "test('REQ-GRPH-001 first', () => { verifyFirst(); });",
      "test('REQ-GRPH-001 second', () => { verifySecond(); });"
    ].join('\n'),
    [
      "test('REQ-GRPH-001 second', () => { verifySecond(); });",
      "test('REQ-GRPH-001 first', () => { verifyFirst(); });"
    ].join('\n')
  );

  assert.notStrictEqual(facts.requirementSyncTrigger, 'new-test', 'the same REQ call inventory remains');
  assert.strictEqual(requirementSync.requirementScopeUnknown, false, 'both existing calls retain stable identities');
});

checkCase('PR334 a same-REQ helper test inserted before an identical existing test still contributes its citation', () => {
  const { facts, requirementSync } = derive(
    "test('REQ-GRPH-001 existing', () => { verifyA(); });\n",
    [
      "test('REQ-GRPH-001 added first', verifyA);",
      "test('REQ-GRPH-001 existing', () => { verifyA(); });"
    ].join('\n')
  );

  assert.strictEqual(facts.requirementSyncTrigger, 'new-test', 'the per-REQ test count increased');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-001'],
    'candidate-only changed tokens retain the added test citation');
  assert.strictEqual(requirementSync.applicability, 'applicable', 'the added test triggers requirement-sync');
});

checkCase('PR334 adding a file-level tag to an unchanged unwrapped assertion keeps the candidate identity under unknown scope', () => {
  const { facts, requirementSync } = derive(
    'assert.equal(run(), 1);\n',
    '// REQ-GRPH-001\nassert.equal(run(), 1);\n'
  );

  assert.strictEqual(facts.assertionChanged, false, 'the assertion tokens are unchanged');
  assert.strictEqual(facts.requirementSyncTrigger, null, 'adding a citation comment is not a new test');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-001'], 'the changed tag identity remains visible');
  assert.strictEqual(facts.requirementScopeUnknown, true, 'the legacy file-level association changed');
  assert.strictEqual(requirementSync.applicability, 'unknown', 'a file-level tag delta is never silently N/A');
});

checkCase('PR334 a newly added file-level-tagged unwrapped assertion keeps the legacy new-test and citation signal', () => {
  const { facts, requirementSync } = deriveSnapshots({}, {
    'ci/pr334-added.test.js': '// REQ-GRPH-001\nassert.equal(run(), 1);\n'
  });

  assert.strictEqual(facts.requirementSyncTrigger, 'new-test', 'the newly added tagged test file remains a candidate');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-001'],
    'the new file-level tag identifies the added assertion');
  assert.strictEqual(requirementSync.applicability, 'applicable', 'the added tagged test triggers requirement-sync');
});

helper.finish();

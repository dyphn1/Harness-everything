'use strict';

// PR #334 finding 4305942767: a no-REQ-change waiver for one cited REQ must not waive an unrelated
// cited REQ. These controls exercise the per-REQ requirementIds coverage in doc-evidence.js directly,
// with inline inputs, and do not touch the shared phase 3a suites.

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const helper = require('./test-helper');

const { checkDocObligations } = require(path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js'));

console.log('\n[pr334-haiku] per-REQ waiver coverage (finding 4305942767)...');

const OBLIGATION_ID = 'doc-change:requirement-sync';
const PRD = 'docs/prd/PRD-PR334-001.md';
const TEST = 'ci/pr334-waiver-fixture.test.js';
const REQ_A = 'REQ-PR334-001';
const REQ_B = 'REQ-PR334-002';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

const BASE_DIGEST = sha256('baseline tree before this change');
const TEST_DIGEST = sha256('candidate test assertions');
const STALE_TEST_DIGEST = sha256('earlier test assertions');
const PRD_DIGEST = sha256('candidate PRD with REQ-PR334-001 revised and REQ-PR334-002 unchanged');
// Mirrors prdSetDigest in doc-evidence.js: sha256 over sorted [path, digest] pairs under docs/prd/.
const PRD_SET_DIGEST = sha256(JSON.stringify([[PRD, PRD_DIGEST]]));

const ARTIFACTS = Object.freeze({ [TEST]: { digest: TEST_DIGEST }, [PRD]: { digest: PRD_DIGEST } });
const BASELINE = Object.freeze({ digest: BASE_DIGEST });

function requirementSync(overrides) {
  return {
    id: OBLIGATION_ID,
    capability: 'requirement-sync',
    strength: 'MUST',
    applicability: 'applicable',
    scope: { paths: [TEST, PRD] },
    acceptance: 'Evaluate whether affected requirements need an update or supported no-change record.',
    assertionChanged: true,
    requirementSyncTrigger: 'assertion-change',
    inventoryComplete: true,
    inventory: {
      complete: true,
      waiverInventoryComplete: true,
      baseDigest: BASE_DIGEST,
      candidateDigest: PRD_SET_DIGEST,
      configDigest: sha256('shared derive config')
    },
    citedReqs: [
      { id: REQ_A, file: PRD, resolution: 'resolved' },
      { id: REQ_B, file: PRD, resolution: 'resolved' }
    ],
    reqUpdates: [],
    ...(overrides || {})
  };
}

function execution(id, overrides) {
  return {
    id: id || 'exec-req',
    obligationId: OBLIGATION_ID,
    command: 'node ci/pr334-waiver-fixture.test.js',
    exitCode: 0,
    paths: [TEST, PRD],
    artifactDigests: { [TEST]: TEST_DIGEST, [PRD]: PRD_DIGEST },
    baseDigest: BASE_DIGEST,
    provenance: 'execution record bound to the current candidate and baseline',
    ...(overrides || {})
  };
}

function waiver(id, requirementIds, overrides) {
  return {
    id,
    obligationId: OBLIGATION_ID,
    kind: 'waiver',
    verdict: 'approve',
    summary: 'no-req-change',
    reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
    requirementIds,
    citedRecordIds: ['exec-req'],
    paths: [TEST, PRD],
    artifactDigests: { [TEST]: TEST_DIGEST, [PRD]: PRD_DIGEST },
    baseDigest: BASE_DIGEST,
    provenance: 'waiver record bound to the current candidate and baseline',
    ...(overrides || {})
  };
}

function run(obligation, { reviewRecords = [], executionRecords = [execution('exec-req')] } = {}) {
  return checkDocObligations({
    obligations: [obligation],
    artifacts: ARTIFACTS,
    baseline: BASELINE,
    executionRecords,
    reviewRecords
  });
}

function resultOf(output) {
  return output.results.find(item => item.obligationId === OBLIGATION_ID);
}

function unmetDiagnostic(output) {
  return output.diagnostics.find(item => item.code === 'req-sync-no-revision-or-waiver');
}

function unsupportedWaiver(output, waiverId) {
  return output.diagnostics.find(item => item.code === 'unsupported-waiver' && JSON.stringify(item).includes(waiverId));
}

const REVISED_A = [{ id: REQ_A, file: PRD }];
const REVISED_B = [{ id: REQ_B, file: PRD }];
const REVISED_BOTH = [{ id: REQ_A, file: PRD }, { id: REQ_B, file: PRD }];

function checkCase(name, body) {
  try {
    body();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// Negative controls: a waiver never covers a REQ it does not list, and malformed or stale coverage never passes.

checkCase('pr334-haiku A-only waiver with A revised and B unrevised: fail naming REQ-PR334-002 only', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-a', [REQ_A])]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'the A-only waiver cannot cover unrelated B');
  const diag = unmetDiagnostic(output);
  assert.ok(diag && JSON.stringify(diag).includes(REQ_B), 'B is named as unmet');
  assert.ok(diag && !JSON.stringify(diag).includes(REQ_A), 'the revised A is not named');
});

checkCase('pr334-haiku A-only waiver with neither REQ revised: fail naming REQ-PR334-002 only', () => {
  const output = run(requirementSync({ reqUpdates: [] }), {
    reviewRecords: [waiver('waiver-a', [REQ_A])]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'A is covered by its waiver, B is not');
  const diag = unmetDiagnostic(output);
  assert.ok(diag && JSON.stringify(diag).includes(REQ_B), 'B is named as unmet');
  assert.ok(diag && !JSON.stringify(diag).includes(REQ_A), 'the waived A is not named');
});

checkCase('pr334-haiku B-only waiver with A unrevised: fail naming REQ-PR334-001 only (mirror of A-only)', () => {
  const output = run(requirementSync({ reqUpdates: [] }), {
    reviewRecords: [waiver('waiver-b', [REQ_B])]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'the B-only waiver cannot cover unrelated A');
  const diag = unmetDiagnostic(output);
  assert.ok(diag && JSON.stringify(diag).includes(REQ_A), 'A is named as unmet');
  assert.ok(diag && !JSON.stringify(diag).includes(REQ_B), 'the waived B is not named');
});

checkCase('pr334-haiku B-only waiver and legal A revision but no execution evidence: not pass, B unsupported and named', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-b', [REQ_B])],
    executionRecords: []
  });
  assert.notStrictEqual(resultOf(output).outcome, 'pass', 'a waiver and a revision cannot pass without observed execution');
  assert.strictEqual(resultOf(output).outcome, 'fail', 'the waiver cites no observed record, so B is an attested absence');
  assert.ok(unsupportedWaiver(output, 'waiver-b'), 'the waiver citing no observed record is diagnosed by id');
  assert.ok(unmetDiagnostic(output) && JSON.stringify(unmetDiagnostic(output)).includes(REQ_B), 'B is named as unmet');
});

checkCase('pr334-haiku B-only waiver with stale baseDigest: not a valid contributor, fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-b-stale', [REQ_B], { baseDigest: sha256('older baseline') })]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'a stale-baseline waiver covers nothing');
  assert.ok(unsupportedWaiver(output, 'waiver-b-stale'), 'the stale waiver is diagnosed by id');
  assert.ok(unmetDiagnostic(output) && JSON.stringify(unmetDiagnostic(output)).includes(REQ_B), 'B stays unmet');
});

checkCase('pr334-haiku B-only waiver bound to a stale test digest: not a valid contributor, fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-b-digest', [REQ_B], {
      artifactDigests: { [TEST]: STALE_TEST_DIGEST, [PRD]: PRD_DIGEST }
    })]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'a waiver with a stale artifact digest covers nothing');
  assert.ok(unsupportedWaiver(output, 'waiver-b-digest'), 'the stale-digest waiver is diagnosed by id');
});

checkCase('pr334-haiku B-only waiver citing a stale execution record: not supported, fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-b-exec', [REQ_B])],
    executionRecords: [execution('exec-req', { artifactDigests: { [TEST]: STALE_TEST_DIGEST, [PRD]: PRD_DIGEST } })]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'a waiver citing stale execution does not cover B');
  assert.ok(unsupportedWaiver(output, 'waiver-b-exec'), 'the waiver citing stale execution is diagnosed by id');
});

checkCase('pr334-haiku empty requirementIds on an otherwise valid waiver: covers nothing, fail naming unrevised B', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-empty-ids', [])]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'an empty requirementIds list covers no REQ');
  assert.ok(unsupportedWaiver(output, 'waiver-empty-ids'), 'the waiver is diagnosed by id');
  assert.ok(unmetDiagnostic(output) && JSON.stringify(unmetDiagnostic(output)).includes(REQ_B), 'B stays unmet');
});

checkCase('pr334-haiku requirementIds given as a bare string: not coerced into coverage, fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-string-ids', REQ_B)]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'a string is not a requirementIds list');
  assert.ok(unsupportedWaiver(output, 'waiver-string-ids'), 'the malformed waiver is diagnosed by id');
});

checkCase('pr334-haiku malformed requirementIds members (null, number, object, empty string): covers nothing, fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-junk-ids', [null, 7, { id: REQ_B }, ''])]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'non-string members never match a cited REQ id');
  assert.ok(unmetDiagnostic(output) && JSON.stringify(unmetDiagnostic(output)).includes(REQ_B), 'B stays unmet');
});

checkCase('pr334-haiku lookalike requirementIds (superstring and prefix of REQ-PR334-002) do not cover B: fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-lookalike', ['REQ-PR334-0020', 'REQ-PR334-00'])]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'ids are matched exactly, not by substring or prefix');
  assert.ok(unmetDiagnostic(output) && JSON.stringify(unmetDiagnostic(output)).includes(REQ_B), 'B stays unmet');
});

checkCase('pr334-haiku B-only waiver with an empty citedRecordIds list: waiver cites no evidence, fail naming REQ-PR334-002', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-no-cites', [REQ_B], { citedRecordIds: [] })]
  });
  assert.strictEqual(resultOf(output).outcome, 'fail', 'a waiver with no cited execution covers nothing');
  assert.ok(unsupportedWaiver(output, 'waiver-no-cites'), 'the waiver is diagnosed by id');
});

checkCase('pr334-haiku B-only waiver with absent reqUpdates: unknown update data, none, not pass', () => {
  const output = run(requirementSync({ reqUpdates: undefined }), {
    reviewRecords: [waiver('waiver-b-unknown', [REQ_B])]
  });
  assert.notStrictEqual(resultOf(output).outcome, 'pass', 'unknown update data never passes');
  assert.strictEqual(resultOf(output).outcome, 'none', 'absent update data gives no absence fail either');
});

// Positive controls: each cited REQ is covered by its own revision or its own listing waiver.

checkCase('pr334-haiku B-only waiver with legal A revision and matching evidence: pass, waiver cited', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_A }), {
    reviewRecords: [waiver('waiver-b', [REQ_B])]
  });
  const result = resultOf(output);
  assert.strictEqual(result.outcome, 'pass', 'the waiver lists the one unrevised REQ and A is revised');
  assert.ok(result.recordRefs.includes('waiver-b'), 'the pass cites the waiver that covered B');
});

checkCase('pr334-haiku A-only waiver with legal B revision and matching evidence: pass (symmetric control)', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_B }), {
    reviewRecords: [waiver('waiver-a', [REQ_A])]
  });
  assert.strictEqual(resultOf(output).outcome, 'pass', 'the waiver lists the one unrevised REQ and B is revised');
});

checkCase('pr334-haiku both cited REQs revised, no waiver, matching evidence: pass', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_BOTH }));
  assert.strictEqual(resultOf(output).outcome, 'pass', 'revisions cover every cited REQ without any waiver');
});

checkCase('pr334-haiku separate single-id waivers for A and B, no revisions, matching evidence: pass', () => {
  const output = run(requirementSync({ reqUpdates: [] }), {
    reviewRecords: [waiver('waiver-a', [REQ_A]), waiver('waiver-b', [REQ_B])]
  });
  const result = resultOf(output);
  assert.strictEqual(result.outcome, 'pass', 'each cited REQ is covered by a waiver listing it');
  assert.ok(result.recordRefs.includes('waiver-a') && result.recordRefs.includes('waiver-b'),
    'both covering waivers are cited');
});

checkCase('pr334-haiku one multi-id waiver for A and B, no revisions, matching evidence: pass', () => {
  const output = run(requirementSync({ reqUpdates: [] }), {
    reviewRecords: [waiver('waiver-both', [REQ_A, REQ_B])]
  });
  assert.strictEqual(resultOf(output).outcome, 'pass', 'a waiver that lists both cited REQs covers both');
});

checkCase('pr334-haiku both REQs revised while a stale waiver is present: pass, stale waiver diagnosed and ignored', () => {
  const output = run(requirementSync({ reqUpdates: REVISED_BOTH }), {
    reviewRecords: [waiver('waiver-stale', [REQ_B], { baseDigest: sha256('older baseline') })]
  });
  assert.strictEqual(resultOf(output).outcome, 'pass', 'revisions do not depend on the stale waiver');
  assert.ok(unsupportedWaiver(output, 'waiver-stale'), 'the stale waiver is still diagnosed');
});

helper.finish();

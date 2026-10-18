'use strict';

// PR #334 round 2, finding 4307059310: the shared bound-failing-execution lane returned observed/fail
// before the requirement-sync identity/resolution validation ran. Unresolved cited REQs must never be
// observed fail; resolved, known, complete identities keep observed fail; unknown scope stays first.

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js');
let checkDocObligations;
try {
  ({ checkDocObligations } = require(modulePath));
} catch (error) {
  helper.check('pr334-r2. evidence module is available', false, error.message);
}

console.log('\n[pr334-r2] requirement-sync resolution before the failing-execution lane (finding 4307059310)...');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

const OBLIGATION_ID = 'doc-change:requirement-sync';
const TEST_PATH = 'ci/mechanism-lint.test.js';
const PRD = 'docs/prd/PRD-GRPH-001.md';
const PRD_OTHER = 'docs/prd/PRD-GRPH-002.md';
const REQ_A = 'REQ-GRPH-001';
const REQ_B = 'REQ-GRPH-002';
const TEST_DIGEST = sha256('assert.equal(run(), 2);');
const PRD_DIGEST = sha256('# PRD-GRPH-001 candidate');
const BASELINE = Object.freeze({ digest: sha256('pr334-r2 baseline') });

// F2 envelope: candidateDigest = digest over sorted [path, digest] pairs of artifacts under docs/prd/.
const ATTESTED_INVENTORY = Object.freeze({
  complete: true,
  waiverInventoryComplete: true,
  baseDigest: BASELINE.digest,
  candidateDigest: sha256(JSON.stringify([[PRD, PRD_DIGEST]])),
  configDigest: sha256('pr334-r2 config')
});

function requirementSync(overrides) {
  return Object.freeze({
    id: OBLIGATION_ID,
    capability: 'requirement-sync',
    strength: 'MUST',
    applicability: 'applicable',
    scope: { paths: [TEST_PATH, PRD] },
    acceptance: 'Evaluate whether affected requirements need an update or supported no-change record.',
    assertionChanged: true,
    inventoryComplete: true,
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }],
    reqUpdates: [],
    ...(overrides || {})
  });
}

function requirementSyncOmitting(key, overrides) {
  const obligation = { ...requirementSync(overrides) };
  delete obligation[key];
  return obligation;
}

function boundExecution(id, exitCode, obligationId) {
  return {
    id,
    obligationId: obligationId || OBLIGATION_ID,
    command: 'node ci/mechanism-lint.test.js',
    exitCode,
    paths: [TEST_PATH, PRD],
    artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
    baseDigest: BASELINE.digest,
    provenance: 'execution record bound to the current candidate and baseline'
  };
}

function run(obligation, executionRecords) {
  return checkDocObligations({
    obligations: [obligation],
    artifacts: { [TEST_PATH]: { digest: TEST_DIGEST }, [PRD]: { digest: PRD_DIGEST } },
    baseline: BASELINE,
    executionRecords,
    reviewRecords: []
  });
}

function resultFor(output, obligationId) {
  return output.results.find(item => item.obligationId === obligationId);
}

function hasDiagnostic(output, code) {
  return output.diagnostics.some(item => item.code === code);
}

function checkCase(name, cases) {
  try {
    cases();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// RED group 1: unresolved cited identities with a bound, complete, nonzero execution never observed fail.
const UNRESOLVED_IDENTITIES = [
  { label: 'missing declaration', citedReqs: [{ id: REQ_A, file: PRD, resolution: 'missing' }] },
  { label: 'ambiguous declaration', citedReqs: [{ id: REQ_A, file: PRD, resolution: 'ambiguous' }] },
  { label: 'analysis-error declaration', citedReqs: [{ id: REQ_A, file: PRD, resolution: 'analysis-error' }] },
  { label: 'mutated declaration', citedReqs: [{ id: REQ_A, file: PRD, resolution: 'mutated' }] },
  { label: 'duplicate id across two PRDs', citedReqs: [
    { id: REQ_A, file: PRD, resolution: 'resolved' },
    { id: REQ_A, file: PRD_OTHER, resolution: 'resolved' }
  ] },
  { label: 'null PRD file', citedReqs: [{ id: REQ_A, file: null, resolution: 'resolved' }] },
  { label: 'null identity id', citedReqs: [{ id: null, file: PRD, resolution: 'resolved' }] }
];

for (const { label, citedReqs } of UNRESOLVED_IDENTITIES) {
  checkCase(`pr334-r2 unresolved identity (${label}) with bound failing execution: none, unresolved, never observed fail`, () => {
    const output = run(requirementSync({ citedReqs }), [boundExecution('exec-fail', 1)]);
    const result = resultFor(output, OBLIGATION_ID);
    assert.ok(result, 'a result is reported');
    assert.strictEqual(result.outcome, 'none', 'an unresolved cited REQ is never an observed fail');
    assert.strictEqual(result.observation, 'unresolved', 'the unresolved REQ leaves the obligation unresolved');
    assert.deepStrictEqual(result.recordRefs, [], 'the failing record is not attributed to an unresolved REQ');
    assert.ok(hasDiagnostic(output, 'req-unresolved'), 'the unresolved REQ is named in a req-unresolved diagnostic');
  });
}

// RED group 2: null, empty, or absent cited identity gives no known identity, so the failing lane must not decide it.
const UNKNOWN_IDENTITIES = [
  { label: 'citedReqs null', obligation: () => requirementSync({ citedReqs: null }) },
  { label: 'citedReqs empty', obligation: () => requirementSync({ citedReqs: [] }) },
  { label: 'citedReqs absent', obligation: () => requirementSyncOmitting('citedReqs') }
];

for (const { label, obligation } of UNKNOWN_IDENTITIES) {
  checkCase(`pr334-r2 ${label} with bound failing execution: none, unresolved, never observed fail`, () => {
    const output = run(obligation(), [boundExecution('exec-fail', 1)]);
    const result = resultFor(output, OBLIGATION_ID);
    assert.strictEqual(result.outcome, 'none', 'an unknown cited identity is never an observed fail');
    assert.strictEqual(result.observation, 'unresolved', 'an unknown cited identity leaves the obligation unresolved');
    assert.ok(hasDiagnostic(output, 'req-sync-unverified'), 'the missing identity data is named in a diagnostic');
  });

  checkCase(`pr334-r2 ${label} with mixed pass and fail executions: none, never observed fail`, () => {
    const output = run(obligation(), [boundExecution('exec-pass', 0), boundExecution('exec-fail', 1)]);
    const result = resultFor(output, OBLIGATION_ID);
    assert.strictEqual(result.outcome, 'none', 'contradictory records under unknown identity yield none');
    assert.strictEqual(result.observation, 'unresolved', 'unknown identity keeps the obligation unresolved');
  });
}

checkCase('pr334-r2 one resolved and one missing cited REQ with bound failing execution: none, never observed fail', () => {
  const output = run(requirementSync({
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }, { id: REQ_B, file: PRD, resolution: 'missing' }]
  }), [boundExecution('exec-fail', 1)]);
  const result = resultFor(output, OBLIGATION_ID);
  assert.strictEqual(result.outcome, 'none', 'one unresolved cited REQ blocks the whole obligation from observed fail');
  assert.strictEqual(result.observation, 'unresolved');
});

checkCase('pr334-r2 one resolved and one missing cited REQ with mixed pass and fail executions: none, never observed fail', () => {
  const output = run(requirementSync({
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }, { id: REQ_B, file: PRD, resolution: 'ambiguous' }]
  }), [boundExecution('exec-pass', 0), boundExecution('exec-fail', 1)]);
  assert.strictEqual(resultFor(output, OBLIGATION_ID).outcome, 'none', 'contradictory records under an unresolved REQ yield none');
});

checkCase('pr334-r2 unresolved identity with a complete attested envelope and bound failing execution: none, not fail', () => {
  const output = run(requirementSync({
    inventory: ATTESTED_INVENTORY,
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'ambiguous' }]
  }), [boundExecution('exec-fail', 1)]);
  const result = resultFor(output, OBLIGATION_ID);
  assert.strictEqual(result.outcome, 'none', 'an attested envelope cannot turn an unresolved REQ into an observed fail');
  assert.strictEqual(result.observation, 'unresolved');
});

checkCase('pr334-r2 unresolved identity with bound passing execution: none, never pass', () => {
  const output = run(requirementSync({ citedReqs: [{ id: REQ_A, file: PRD, resolution: 'missing' }] }),
    [boundExecution('exec-pass', 0)]);
  assert.strictEqual(resultFor(output, OBLIGATION_ID).outcome, 'none', 'an unresolved REQ never passes');
});

// Controls: resolved, known, complete identities keep observed fail on a bound failing execution.
checkCase('pr334-r2 control: one resolved known identity with bound failing execution: observed fail', () => {
  const output = run(requirementSync({ citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }] }),
    [boundExecution('exec-fail', 1)]);
  const result = resultFor(output, OBLIGATION_ID);
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'fail', 'a resolved known complete identity keeps observed fail');
  assert.deepStrictEqual(result.recordRefs, ['exec-fail'], 'the failing record is attributed');
});

checkCase('pr334-r2 control: resolved REQ without a resolution label with bound failing execution: observed fail', () => {
  const output = run(requirementSync({ citedReqs: [{ id: REQ_A, file: PRD }] }), [boundExecution('exec-fail', 1)]);
  assert.strictEqual(resultFor(output, OBLIGATION_ID).outcome, 'fail', 'an absent resolution label is treated as resolved');
});

checkCase('pr334-r2 control: two resolved known identities with mixed pass and fail executions: observed fail', () => {
  const output = run(requirementSync({
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }, { id: REQ_B, file: PRD, resolution: 'resolved' }]
  }), [boundExecution('exec-pass', 0), boundExecution('exec-fail', 1)]);
  assert.strictEqual(resultFor(output, OBLIGATION_ID).outcome, 'fail', 'mixed pass and fail with resolved identities stays observed fail');
});

// Controls: unknown scope precedence is unchanged and stays ahead of resolution validation.
checkCase('pr334-r2 control: unknown scope with unresolved identity and bound failing execution: none, before resolution validation', () => {
  const output = run(requirementSync({
    requirementScopeUnknown: true,
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'missing' }]
  }), [boundExecution('exec-fail', 1)]);
  assert.strictEqual(resultFor(output, OBLIGATION_ID).outcome, 'none', 'an unknown scope is refused first');
  assert.ok(!hasDiagnostic(output, 'req-unresolved'), 'unknown scope returns before any resolution diagnostic');
});

checkCase('pr334-r2 control: unknown scope with resolved identity and bound failing execution: none, not observed fail', () => {
  const output = run(requirementSync({
    scope: { paths: [TEST_PATH, PRD], requirementIds: 'unknown' },
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }]
  }), [boundExecution('exec-fail', 1)]);
  assert.strictEqual(resultFor(output, OBLIGATION_ID).outcome, 'none', 'scope marked unknown by requirementIds is refused first');
});

checkCase('pr334-r2 control: other capability with unresolved citedReqs and bound failing execution: observed fail unchanged', () => {
  const output = run({
    id: 'doc-lint',
    capability: 'doc-lint',
    strength: 'MUST',
    applicability: 'applicable',
    scope: { paths: [TEST_PATH, PRD] },
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'missing' }]
  }, [boundExecution('exec-lint-fail', 1, 'doc-lint')]);
  const result = resultFor(output, 'doc-lint');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'fail', 'a non-requirement capability keeps observed fail on a bound failing execution');
});

helper.finish();

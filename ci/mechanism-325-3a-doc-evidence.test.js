'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js');
const fixtureDir = path.join(__dirname, 'fixtures', 'doc-obligations', 'evidence');
let checkDocObligations;
try {
  ({ checkDocObligations } = require(modulePath));
} catch (error) {
  helper.check('325-3a. evidence module is available', false, error.message);
}

console.log('\n[325-3a] doc-change evidence producer (RED)...');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Wire schema (scratchpad/325-3a/10-wire-schema.md §3; §8 overrides §4 and §6):
// checkDocObligations({ obligations, artifacts, baseline, executionRecords, reviewRecords })
//   -> { diagnostics, results }; each result = { obligationId, observation, outcome,
//        artifactDigest, baseDigest, provenance, recordRefs }.
// observation: "observed" | "unavailable" | "unresolved" | "not-observed" (separate from outcome)
// outcome: "pass" | "fail" | "none". Only observed+pass satisfies a MUST.
// §8 path binding: each record carries paths: [...] and artifactDigests: { "<path>": digest }.
// A MUST is satisfied only when EVERY path in obligation.scope.paths has an observed record
// bound to that path with the current candidate digest and the baseline baseDigest.

const ADR = 'docs/adr/GRPH-007.md';
const PRD = 'docs/prd/PRD-GRPH-001.md';
const CAND_TEXT = (rel) => fs.readFileSync(path.join(fixtureDir, 'candidate', rel), 'utf8');
const BASE_TEXT = (rel) => fs.readFileSync(path.join(fixtureDir, 'base', rel), 'utf8');
const BASE_DIGEST = sha256(BASE_TEXT(ADR)); // old/previous baseline digest
const ADR_DIGEST = sha256(CAND_TEXT(ADR)); // current candidate digest for the ADR
const PRD_DIGEST = sha256(CAND_TEXT(PRD)); // current candidate digest for the PRD

const CURRENT_BASELINE = Object.freeze({ digest: sha256(CAND_TEXT(ADR)) });

function obligation(capability, applicability, scopePaths, strength) {
  return Object.freeze({
    id: capability,
    capability,
    strength: strength || 'MUST',
    applicability,
    scope: { paths: [...scopePaths] },
    acceptance: 'Observed path-bound evidence with digests matching the current candidate and baseline'
  });
}

function executionRecord(overrides) {
  return Object.freeze({
    id: 'exec-1',
    obligationId: 'quality-review',
    command: 'node ci/linklint.js docs/adr/GRPH-007.md',
    exitCode: 0,
    paths: [ADR],
    artifactDigests: { [ADR]: ADR_DIGEST },
    baseDigest: CURRENT_BASELINE.digest,
    provenance: 'execution record produced inside the verification step',
    ...(overrides || {})
  });
}

function reviewRecord(overrides) {
  return Object.freeze({
    id: 'review-1',
    obligationId: 'quality-review',
    kind: 'review',
    verdict: 'approve',
    summary: 'independent reviewer approved the Decision change',
    paths: [ADR],
    artifactDigests: { [ADR]: ADR_DIGEST },
    baseDigest: CURRENT_BASELINE.digest,
    provenance: 'review record bound to the current candidate and baseline',
    citedRecordIds: [],
    reason: undefined,
    ...(overrides || {})
  });
}

function run(input) {
  return checkDocObligations(input);
}

function resultFor(output, obligationId) {
  return output.results.find(item => item.obligationId === obligationId);
}

function checkCase(name, cases) {
  try {
    cases();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// H3 case: fabricated claim — the obligation is applicable and MUST, but the
// producer gets zero records of any kind. No pass, no observed evidence.
checkCase('325-3a H3 fabricated claim: no execution record, MUST cannot pass', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: []
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported for the unanswered obligation');
  assert.ok(['unavailable', 'unresolved', 'not-observed'].includes(result.observation),
    `no submitted evidence is not observed: ${result.observation}`);
  assert.strictEqual(result.outcome, 'none', 'without evidence it never passes');
});

// H3 case: stale digest (§8 replaces the §4 oracle — stale = the record's
// artifactDigests[path] does not equal the current candidate digest for that path).
checkCase('325-3a H3 stale artifact digest: record made for the previous candidate is rejected', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({ artifactDigests: { [ADR]: BASE_DIGEST } })]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.ok(['unavailable', 'unresolved', 'not-observed'].includes(result.observation),
    'stale-only evidence is not an available match');
  assert.strictEqual(result.outcome, 'none', 'a record for the previous candidate cannot satisfy the MUST');
  const diag = output.diagnostics.find(item => item.code === 'stale-artifact-digest');
  assert.ok(diag, 'stale artifact digest is reported as a diagnostic');
  assert.strictEqual(diag.obligationId, 'quality-review', 'diagnostic names the obligation');
  assert.ok(typeof diag.message === 'string' && diag.message.length > 0, 'diagnostic carries a message');
});

// H3 case: stale base — the record was made against a different baseline.
checkCase('325-3a H3 stale base: record made against another baseline is rejected', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({ baseDigest: BASE_DIGEST })]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.ok(['unavailable', 'unresolved', 'not-observed'].includes(result.observation),
    'stale base evidence is not an available match');
  assert.strictEqual(result.outcome, 'none', 'a record for another baseline cannot satisfy the MUST');
  const diag = output.diagnostics.find(item => item.code === 'stale-base-digest');
  assert.ok(diag, 'stale base digest is reported as a diagnostic');
  assert.strictEqual(diag.obligationId, 'quality-review', 'diagnostic names the obligation');
});

// H3 positive control (§8): a correctly bound current record is accepted even
// though candidate != base.
checkCase('325-3a H3 positive control: fresh path-bound evidence for an edited artifact passes', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({})]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass');
  assert.ok(result.recordRefs.includes('review-1'), 'recordRefs cite the matching record');
  assert.ok(JSON.stringify(result.provenance).includes('bound to the current candidate and baseline'),
    'result provenance traces to the matching record');
});

// §8 path binding: every scope path needs a matched, path-bound record; a
// missing path leaves the MUST unsatisfied and a diagnostic names the path.
checkCase('325-3a H3 missing path: record covering only one scope path is a diagnostic naming the other', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR, PRD])],
    artifacts: { [ADR]: { digest: ADR_DIGEST }, [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({})]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.outcome, 'none', 'the unmet path leaves the MUST unsatisfied');
  const flat = JSON.stringify(output.diagnostics);
  assert.ok(output.diagnostics.length > 0, 'a diagnostic is reported');
  assert.ok(flat.includes(PRD), `the diagnostic names the missing path: ${flat}`);
});

// §8 control: the same digest bound to an unrelated path cannot satisfy the
// obligation, and the intended path is reported as missing.
checkCase('325-3a H3 unrelated path binding: same digest on another path cannot satisfy', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST }, [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({ paths: [PRD], artifactDigests: { [PRD]: ADR_DIGEST } })]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.outcome, 'none', 'the ADR path has no bound record');
  const flat = JSON.stringify(output.diagnostics);
  assert.ok(flat.includes(ADR), `the diagnostic names the unbound path: ${flat}`);
});

// H3 case: absent verifier — a passing *command* record with the right
// obligationId is NOT enough; the MUST needs a review record (§8).
checkCase('325-3a H3 absent verifier: command-only record cannot satisfy the quality review MUST', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({})],
    reviewRecords: []
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.ok(['unavailable', 'unresolved', 'not-observed'].includes(result.observation),
    `command alone is unresolved/not-observed, not a pass: ${result.observation}`);
  assert.strictEqual(result.outcome, 'none', 'a command exit 0 never satisfies an unreviewed MUST');
});

// H3 case: contradictory command results for the same obligation and binding.
checkCase('325-3a H3 contradictory command results fail closed', () => {
  const output = run({
    obligations: [obligation('link-check', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [
      executionRecord({ id: 'exec-pass', obligationId: 'link-check', exitCode: 0 }),
      executionRecord({ id: 'exec-fail', obligationId: 'link-check', exitCode: 1 })
    ],
    reviewRecords: []
  });
  const result = resultFor(output, 'link-check');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'observed', 'command results were observed');
  assert.strictEqual(result.outcome, 'fail', 'contradiction fails closed, never a pass');
});

// H3 case: a single failed command result. Also proves that observation and
// outcome are two separate fields on one result.
checkCase('325-3a H3 failed command result: observed=fail is still observed and never passes', () => {
  const output = run({
    obligations: [obligation('link-check', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-fail', obligationId: 'link-check', exitCode: 1 })],
    reviewRecords: []
  });
  const result = resultFor(output, 'link-check');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'observed', 'the command ran: evidence is observed');
  assert.strictEqual(result.outcome, 'fail');
  assert.ok('observation' in result && 'outcome' in result, 'observation and outcome are separate fields');
  assert.notStrictEqual(result.observation, result.outcome, 'observed fail is not conflated with pass');
});

// H3 case: unsupported waiver — no reason at all (§5, still valid under §8).
checkCase('325-3a H3 unsupported waiver: empty reason is a diagnostic, never a pass', () => {
  const output = run({
    obligations: [obligation('requirement-sync', 'applicable', [PRD])],
    artifacts: { [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({
      id: 'waiver-1',
      obligationId: 'requirement-sync',
      kind: 'waiver',
      verdict: 'approve',
      summary: ' ',
      reason: '',
      citedRecordIds: []
    })]
  });
  const result = resultFor(output, 'requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.outcome, 'none');
  const diag = output.diagnostics.find(item => item.code === 'unsupported-waiver');
  assert.ok(diag, 'unsupported waiver is reported as a diagnostic');
  assert.strictEqual(diag.obligationId, 'requirement-sync', 'diagnostic names the obligation');
  assert.ok(typeof diag.message === 'string' && diag.message.length > 0, 'diagnostic carries a message');
});

// H3 case: waiver with a reason but with citations that resolve to nothing.
checkCase('325-3a H3 unsupported waiver: reason cites no matching observed record stays unresolved', () => {
  const output = run({
    obligations: [obligation('requirement-sync', 'applicable', [PRD])],
    artifacts: { [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({
      id: 'waiver-1',
      obligationId: 'requirement-sync',
      kind: 'waiver',
      verdict: 'approve',
      summary: 'no-req-change claimed',
      reason: 'acceptance criteria unchanged',
      citedRecordIds: ['exec-does-not-exist']
    })]
  });
  const result = resultFor(output, 'requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'unresolved', 'the cited record does not resolve');
  assert.strictEqual(result.outcome, 'none', 'an unresolved citation never satisfies the MUST');
  assert.ok(output.diagnostics.some(item => item.code === 'unsupported-waiver'), 'unsupported waiver is diagnosed');
});

// H3 positive control: waiver with a reason plus a cited, observed, path-bound
// record satisfies the obligation (structured no-req-change per D6.6).
checkCase('325-3a H3 waiver with reason and matching cited observed record passes', () => {
  const output = run({
    obligations: [obligation('requirement-sync', 'applicable', [PRD])],
    artifacts: { [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({
      id: 'exec-req',
      obligationId: 'requirement-sync',
      paths: [PRD],
      artifactDigests: { [PRD]: PRD_DIGEST }
    })],
    reviewRecords: [reviewRecord({
      id: 'waiver-1',
      obligationId: 'requirement-sync',
      kind: 'waiver',
      verdict: 'approve',
      summary: 'no-req-change accepted with cited evidence',
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['exec-req'],
      paths: [PRD],
      artifactDigests: { [PRD]: PRD_DIGEST }
    })]
  });
  const result = resultFor(output, 'requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass');
  assert.ok(result.recordRefs.includes('waiver-1'), 'result cites the waiver');
  assert.ok(result.recordRefs.includes('exec-req'), 'result cites the supporting record');
});

// §8 review-record gate: a review record with perfect path binding but a
// non-approve verdict (or a missing/empty summary) is a diagnostic and no pass.
checkCase('325-3a H3 review gate: non-approve verdict or missing summary is a diagnostic, never a pass', () => {
  for (const bad of [
    reviewRecord({ verdict: 'reject' }),
    reviewRecord({ summary: undefined }),
    reviewRecord({ summary: '' })
  ]) {
    const output = run({
      obligations: [obligation('quality-review', 'applicable', [ADR])],
      artifacts: { [ADR]: { digest: ADR_DIGEST } },
      baseline: CURRENT_BASELINE,
      executionRecords: [],
      reviewRecords: [bad]
    });
    const result = resultFor(output, 'quality-review');
    assert.ok(result, `a result is reported for ${JSON.stringify(bad.verdict || bad.summary === undefined)}`);
    assert.strictEqual(result.outcome, 'none', 'only an approve verdict with a summary can satisfy quality-review');
    assert.ok(output.diagnostics.length > 0, 'the deficient review is visible as a diagnostic');
  }
});

// §8 code-only: applicability unknown -> observation not-observed, outcome none.
// Visible but NOT a failure; the pilot defines NO completion policy for this
// state (belongs to the later reconciliation contract). No lock is implied here.
checkCase('325-3a code-only unknown MUST stays not-observed, visible, and never passes (no policy implied)', () => {
  const output = run({
    obligations: [obligation('requirement-sync', 'unknown', ['src/lint.js'])],
    artifacts: { 'src/lint.js': { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: []
  });
  const result = resultFor(output, 'requirement-sync');
  assert.ok(result, 'the not-observed state stays visible as a result');
  assert.strictEqual(result.observation, 'not-observed', 'unknown applicability is not-observed');
  assert.strictEqual(result.outcome, 'none', 'not-observed is never a pass');
});

// §3: the full result field contract.
checkCase('325-3a result carries obligation id, observation, outcome, digests, provenance, recordRefs', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({})]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  for (const field of ['obligationId', 'observation', 'outcome', 'provenance']) {
    assert.ok(typeof result[field] === 'string' && result[field].length > 0, `${field} is a non-empty string`);
  }
  assert.ok(typeof result.artifactDigest === 'string' && result.artifactDigest.length > 0, 'artifactDigest is present');
  assert.ok(typeof result.baseDigest === 'string' && result.baseDigest.length > 0, 'baseDigest is present');
  assert.ok(Array.isArray(result.recordRefs), 'recordRefs is an array');
  assert.ok(result.recordRefs.includes('review-1'), 'recordRefs cites the matching record');
});

// §3: diagnostics are structured.
checkCase('325-3a diagnostics are structured code/obligationId/message entries', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({ artifactDigests: { [ADR]: BASE_DIGEST } })]
  });
  assert.ok(Array.isArray(output.diagnostics), 'diagnostics is an array');
  assert.ok(output.diagnostics.length > 0, 'a rejection is visible in diagnostics');
  for (const diag of output.diagnostics) {
    assert.ok(typeof diag.code === 'string' && diag.code.length > 0, 'diagnostic code is a non-empty string');
    assert.ok(diag.obligationId === undefined || typeof diag.obligationId === 'string', 'diagnostic obligationId is a string when present');
    assert.ok(typeof diag.message === 'string' && diag.message.length > 0, 'diagnostic message is a non-empty string');
  }
});

// §4/§8: a record for an obligation that is not in the input list is unrelated
// and cannot satisfy anything; results never report a pass out of nowhere.
checkCase('325-3a unrelated record (other obligation) cannot satisfy anything', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-other', obligationId: 'doc-lint' })],
    reviewRecords: []
  });
  assert.strictEqual(JSON.stringify(output.results).includes('"pass"'), false,
    'no result reports a pass for an unrelated record');
});

// N/A obligations never pass; their representation (presence or absence in
// results) is implementation freedom under the wire schema.
checkCase('325-3a N/A obligations never produce a pass', () => {
  const output = run({
    obligations: [obligation('doc-lint', 'N/A', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-1', obligationId: 'doc-lint' })],
    reviewRecords: []
  });
  assert.strictEqual(JSON.stringify(output.results).includes('"pass"'), false,
    'N/A never passes even with a matching record');
});

// Orphan waiver: a waiver whose obligationId matches no obligation in the input
// is unrelated to every obligation. It must satisfy nothing, be diagnosed by id,
// and leave every result at outcome "none".
checkCase('325-3a orphan waiver: unmatched obligationId satisfies nothing, is diagnosed as waiver-unmatched, outcomes stay none', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({
      id: 'waiver-orphan',
      obligationId: 'no-such-obligation',
      kind: 'waiver',
      verdict: 'approve',
      summary: 'orphan waiver for an obligation that does not exist',
      reason: 'no-req-change: acceptance criteria unchanged',
      citedRecordIds: []
    })]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'the real obligation still gets a result');
  assert.strictEqual(result.outcome, 'none', 'the orphan waiver satisfies no obligation');
  const diag = output.diagnostics.find(item => item.code === 'waiver-unmatched');
  assert.ok(diag, 'orphan waiver is reported with code waiver-unmatched');
  assert.ok(JSON.stringify(diag).includes('waiver-orphan'), `diagnostic names the waiver id: ${JSON.stringify(diag)}`);
  for (const item of output.results) {
    assert.strictEqual(item.outcome, 'none', `${item.obligationId} outcome is none`);
  }
});

// Round 2 (D): an independent positive control. The baseline is the BASE ADR digest, not the
// candidate digest, so candidate != baseline and a record for the baseline cannot pass as current.
const BASE_BASELINE = Object.freeze({ digest: BASE_DIGEST });

checkCase('325-3a H3 independent-baseline positive control: baseline digest differs from candidate digest and fresh evidence passes', () => {
  assert.notStrictEqual(BASE_DIGEST, ADR_DIGEST, 'the fixture base and candidate ADR digests differ');
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: BASE_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({ baseDigest: BASE_DIGEST })]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass', 'a record bound to the current candidate and the independent baseline passes');
  assert.ok(result.recordRefs.includes('review-1'), 'recordRefs cite the matching record');
});

checkCase('325-3a H3 independent-baseline control: a record bound to the candidate digest as its base is rejected', () => {
  const output = run({
    obligations: [obligation('quality-review', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: BASE_BASELINE,
    executionRecords: [],
    reviewRecords: [reviewRecord({ baseDigest: ADR_DIGEST })]
  });
  const result = resultFor(output, 'quality-review');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.outcome, 'none', 'a base digest that is not the selected baseline cannot satisfy the MUST');
  assert.ok(output.diagnostics.some(item => item.code === 'stale-base-digest'), 'the mismatched base is diagnosed');
});

// Round 2 (A, evidence level): the waiver record must itself be path-bound with current digests
// and a current baseDigest (§9A (b)). A stale waiver that cites current observed evidence is not a valid contributor.
checkCase('325-3a H3 waiver self-binding: a stale waiver citing current observed evidence cannot satisfy requirement-sync', () => {
  const output = run({
    obligations: [obligation('requirement-sync', 'applicable', [PRD])],
    artifacts: { [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({
      id: 'exec-req',
      obligationId: 'requirement-sync',
      paths: [PRD],
      artifactDigests: { [PRD]: PRD_DIGEST }
    })],
    reviewRecords: [reviewRecord({
      id: 'waiver-stale',
      obligationId: 'requirement-sync',
      kind: 'waiver',
      verdict: 'approve',
      summary: 'no-req-change accepted with cited evidence',
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['exec-req'],
      paths: [PRD],
      artifactDigests: { [PRD]: PRD_DIGEST },
      baseDigest: BASE_DIGEST
    })]
  });
  const result = resultFor(output, 'requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.outcome, 'none', 'the stale waiver is not a valid contributor, so the pass branch is not reached');
  assert.ok(JSON.stringify(output.diagnostics).includes('waiver-stale'), 'the stale waiver is diagnosed by id');
});

// Round 4 (§10): observed/fail for an unmet requirement-sync obligation, only when every §10 condition holds.
// The obligation carries assertionChanged, inventoryComplete and citedReqs/reqUpdates from derivation.
const TEST_PATH = 'ci/mechanism-lint.test.js';
const TEST_DIGEST = sha256('assert.equal(run(), 2);');

function reqSyncObligation(overrides) {
  return Object.freeze({
    id: 'doc-change:requirement-sync',
    capability: 'requirement-sync',
    strength: 'MUST',
    applicability: 'applicable',
    scope: { paths: [TEST_PATH, PRD] },
    acceptance: 'Evaluate whether affected requirements need an update or supported no-change record.',
    assertionChanged: true,
    inventoryComplete: true,
    citedReqs: [{ id: 'REQ-GRPH-001', file: PRD }],
    reqUpdates: [],
    ...(overrides || {})
  });
}

function runReqSync(obligation, extra) {
  return run({
    obligations: [obligation],
    artifacts: { [TEST_PATH]: { digest: TEST_DIGEST }, [PRD]: { digest: PRD_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: [],
    ...(extra || {})
  });
}

// Round 6 fix (inputs only): the round-4 §10 positives supply the F2 attested envelope, same shape as the
// round-6 fixture inventory.json. candidateDigest is the PRD-set digest of this case's artifacts (PRD only).
const ROUND4_ATTESTED_INVENTORY = Object.freeze({
  complete: true,
  waiverInventoryComplete: true,
  baseDigest: CURRENT_BASELINE.digest,
  candidateDigest: sha256(JSON.stringify([[PRD, PRD_DIGEST]])),
  configDigest: sha256('shared derive config')
});

checkCase('325-3a req-sync fail: all §10 conditions hold, no revision, no waiver => observed/fail with req-sync-no-revision-or-waiver naming REQ and file', () => {
  const output = runReqSync(reqSyncObligation({ inventory: ROUND4_ATTESTED_INVENTORY }));
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.strictEqual(result.observation, 'observed', 'the unmet obligation is an observed check');
  assert.strictEqual(result.outcome, 'fail', 'the unmet obligation is an observed failure');
  const diag = output.diagnostics.find(item => item.code === 'req-sync-no-revision-or-waiver');
  assert.ok(diag, 'the failure is diagnosed');
  assert.strictEqual(diag.obligationId, 'doc-change:requirement-sync', 'diagnostic names the obligation');
  const flat = JSON.stringify(diag);
  assert.ok(flat.includes('REQ-GRPH-001'), `diagnostic names the REQ id: ${flat}`);
  assert.ok(flat.includes(PRD), `diagnostic names the file: ${flat}`);
});

checkCase('325-3a req-sync negative: inventory incomplete is not a fail (§10)', () => {
  const output = runReqSync(reqSyncObligation({ inventoryComplete: false }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'incomplete inventory never establishes absence');
});

checkCase('325-3a req-sync negative: comment-only edit (assertionChanged false) is not a fail (§10)', () => {
  const output = runReqSync(reqSyncObligation({ assertionChanged: false }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'a comment-only change is not an unmet assertion change');
});

checkCase('325-3a req-sync negative: unknown assertion change is not a fail (§10)', () => {
  const output = runReqSync(reqSyncObligation({ assertionChanged: 'unknown' }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'an undeterminable assertion change is not a fail');
});

checkCase('325-3a req-sync negative: cited REQ with file null (not resolved in the inventory) is not a fail (§10)', () => {
  const output = runReqSync(reqSyncObligation({ citedReqs: [{ id: 'REQ-GRPH-001', file: null }] }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'an unresolved REQ does not establish absence');
});

checkCase('325-3a req-sync: invalid waiver with empty reason still fails, and also carries unsupported-waiver (§10 condition 5)', () => {
  const output = runReqSync(reqSyncObligation({ inventory: ROUND4_ATTESTED_INVENTORY }), {
    reviewRecords: [{
      id: 'waiver-empty',
      obligationId: 'doc-change:requirement-sync',
      kind: 'waiver',
      verdict: 'approve',
      summary: 'no-req-change',
      reason: '',
      citedRecordIds: [],
      paths: [TEST_PATH, PRD],
      artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
      baseDigest: CURRENT_BASELINE.digest,
      provenance: 'waiver record bound to the current candidate and baseline'
    }]
  });
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.outcome, 'fail', 'the unmet obligation still fails; the invalid waiver does not rescue it');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-no-revision-or-waiver'), 'the failure is diagnosed');
  assert.ok(output.diagnostics.some(item => item.code === 'unsupported-waiver' && item.obligationId === 'doc-change:requirement-sync'),
    'the invalid waiver attempt is also diagnosed');
});

checkCase('325-3a req-sync positive: valid revision alternative with matching evidence passes (existing behavior, not fail)', () => {
  const output = runReqSync(reqSyncObligation({ reqUpdates: [{ id: 'REQ-GRPH-001', file: PRD }] }), {
    executionRecords: [{
      id: 'exec-req',
      obligationId: 'doc-change:requirement-sync',
      command: 'node ci/mechanism-lint.test.js',
      exitCode: 0,
      paths: [TEST_PATH, PRD],
      artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
      baseDigest: CURRENT_BASELINE.digest,
      provenance: 'execution record bound to the current candidate and baseline'
    }]
  });
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass', 'a satisfied revision alternative passes');
});

// Round 5 (PR #334 review R4, R5). Evidence expectations only.

// R4: minimum execution-evidence schema. A bound record with exitCode 0 but no command or provenance is
// incomplete: a diagnostic, and it never passes.
checkCase('325-3a R4 incomplete execution record (bound, exitCode 0, no command or provenance): not pass, execution-record-incomplete', () => {
  const output = run({
    obligations: [obligation('doc-lint', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-bare', obligationId: 'doc-lint', command: undefined, provenance: undefined })],
    reviewRecords: []
  });
  const result = resultFor(output, 'doc-lint');
  assert.ok(result, 'a result is reported');
  assert.notStrictEqual(result.outcome, 'pass', 'an incomplete record never passes');
  const diag = output.diagnostics.find(item => item.code === 'execution-record-incomplete');
  assert.ok(diag, 'the incomplete record is diagnosed');
  assert.ok(JSON.stringify(diag).includes('exec-bare'), `the diagnostic names the record: ${JSON.stringify(diag)}`);
});

checkCase('325-3a R4 incomplete execution record (exitCode is a string "0"): not pass, execution-record-incomplete', () => {
  const output = run({
    obligations: [obligation('doc-lint', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-string-exit', obligationId: 'doc-lint', exitCode: '0' })],
    reviewRecords: []
  });
  const result = resultFor(output, 'doc-lint');
  assert.notStrictEqual(result.outcome, 'pass', 'a non-integer exit code never passes');
  assert.ok(output.diagnostics.some(item => item.code === 'execution-record-incomplete'), 'the record is diagnosed');
});

checkCase('325-3a R4 control: complete execution record (command, provenance, integer exitCode 0): doc-lint passes', () => {
  const output = run({
    obligations: [obligation('doc-lint', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-complete', obligationId: 'doc-lint' })],
    reviewRecords: []
  });
  const result = resultFor(output, 'doc-lint');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass', 'a complete bound record passes');
});

// R5: a no-REQ-change waiver is allowed only for a resolved requirement (file non-null). An orphan id
// (no PRD declaration) is unresolved, with a targeted diagnostic, and never passes.
checkCase('325-3a R5 orphan REQ + valid current waiver + passing execution: not pass, req-unresolved names the REQ id', () => {
  const output = runReqSync(reqSyncObligation({ citedReqs: [{ id: 'REQ-GRPH-099', file: null }] }), {
    executionRecords: [{
      id: 'exec-req',
      obligationId: 'doc-change:requirement-sync',
      command: 'node ci/mechanism-lint.test.js',
      exitCode: 0,
      paths: [TEST_PATH, PRD],
      artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
      baseDigest: CURRENT_BASELINE.digest,
      provenance: 'execution record bound to the current candidate and baseline'
    }],
    reviewRecords: [{
      id: 'waiver-orphan',
      obligationId: 'doc-change:requirement-sync',
      kind: 'waiver',
      verdict: 'approve',
      summary: 'no-req-change',
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['exec-req'],
      paths: [TEST_PATH, PRD],
      artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
      baseDigest: CURRENT_BASELINE.digest,
      provenance: 'waiver record bound to the current candidate and baseline'
    }]
  });
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.notStrictEqual(result.outcome, 'pass', 'an unresolved REQ never passes through a waiver');
  const diag = output.diagnostics.find(item => item.code === 'req-unresolved');
  assert.ok(diag, 'the unresolved REQ is diagnosed');
  assert.ok(JSON.stringify(diag).includes('REQ-GRPH-099'), `the diagnostic names the REQ id: ${JSON.stringify(diag)}`);
});

// Round 6 (Sol round-3 review F1, F2). The fail lane needs an attested envelope; the pass lane does not.
// Envelope: obligation.inventory = { complete, waiverInventoryComplete, baseDigest, candidateDigest, configDigest }.
// candidateDigest = sha256 over the sorted [path, digest] pairs of artifacts under docs/prd/.

function prdSetDigest(artifacts) {
  return sha256(JSON.stringify(Object.keys(artifacts).filter(p => p.startsWith('docs/prd/')).sort()
    .map(p => [p, artifacts[p].digest])));
}

const RS_ARTIFACTS = { [TEST_PATH]: { digest: TEST_DIGEST }, [PRD]: { digest: PRD_DIGEST } };
const ATTESTED_INVENTORY = Object.freeze({
  complete: true,
  waiverInventoryComplete: true,
  baseDigest: CURRENT_BASELINE.digest,
  candidateDigest: prdSetDigest(RS_ARTIFACTS),
  configDigest: sha256('shared derive config')
});

function attestedReqSync(overrides) {
  return reqSyncObligation({ inventory: ATTESTED_INVENTORY, ...(overrides || {}) });
}

function validWaiver(id, obligationId, citedRecordIds) {
  return {
    id,
    obligationId,
    kind: 'waiver',
    verdict: 'approve',
    summary: 'no-req-change',
    reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
    citedRecordIds,
    paths: [TEST_PATH, PRD],
    artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
    baseDigest: CURRENT_BASELINE.digest,
    provenance: 'waiver record bound to the current candidate and baseline'
  };
}

function boundExec(id) {
  return {
    id,
    obligationId: 'doc-change:requirement-sync',
    command: 'node ci/mechanism-lint.test.js',
    exitCode: 0,
    paths: [TEST_PATH, PRD],
    artifactDigests: { [TEST_PATH]: TEST_DIGEST, [PRD]: PRD_DIGEST },
    baseDigest: CURRENT_BASELINE.digest,
    provenance: 'execution record bound to the current candidate and baseline'
  };
}

// F1: resolution authority.
checkCase('325-3a F1 ambiguous cited ID + updated declaration + valid waiver + passing execution: not pass, req-unresolved names the REQ (round 6)', () => {
  const output = runReqSync(attestedReqSync({
    citedReqs: [{ id: 'REQ-GRPH-001', file: PRD, resolution: 'ambiguous' }],
    reqUpdates: [{ id: 'REQ-GRPH-001', file: PRD }]
  }), {
    executionRecords: [boundExec('exec-req')],
    reviewRecords: [validWaiver('waiver-ambiguous', 'doc-change:requirement-sync', ['exec-req'])]
  });
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.ok(result, 'a result is reported');
  assert.notStrictEqual(result.outcome, 'pass', 'an ambiguous REQ never passes, even with a single updated declaration');
  const diag = output.diagnostics.find(item => item.code === 'req-unresolved');
  assert.ok(diag && JSON.stringify(diag).includes('REQ-GRPH-001'), 'req-unresolved names the REQ id');
});

checkCase('325-3a F1 malformed current PRD (analysis error) with complete attested inventory and no waiver: not a fail (round 6)', () => {
  const output = runReqSync(attestedReqSync({
    citedReqs: [{ id: 'REQ-GRPH-001', file: PRD, resolution: 'analysis-error' }]
  }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail',
    'an analysis error is unresolved, never an observed absence');
});

checkCase('325-3a F1 candidate-deleted declaration (file from base fallback): not a fail (round 6)', () => {
  const output = runReqSync(attestedReqSync({
    citedReqs: [{ id: 'REQ-GRPH-001', file: PRD, resolution: 'missing' }]
  }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail',
    'a base-only declaration is not current authority');
});

checkCase('325-3a F1 control: uniquely resolved unchanged PRD + supported current waiver + passing execution: pass', () => {
  const output = runReqSync(attestedReqSync({
    citedReqs: [{ id: 'REQ-GRPH-001', file: PRD, resolution: 'resolved' }]
  }), {
    executionRecords: [boundExec('exec-req')],
    reviewRecords: [validWaiver('waiver-resolved', 'doc-change:requirement-sync', ['exec-req'])]
  });
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass', 'a resolved REQ with a supported waiver passes');
});

// F2: the fail lane needs an attested envelope; every mismatch or missing field is none with req-sync-envelope-unattested.
checkCase('325-3a F2 empty citedReqs with attested envelope and the other fail conditions: not a fail (every() on [] is vacuous) (round 6)', () => {
  const output = runReqSync(attestedReqSync({ citedReqs: [] }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'no cited REQ is not an observed absence');
});

checkCase('325-3a F2 stale obligation base (envelope baseDigest differs from baseline): none, req-sync-envelope-unattested (round 6)', () => {
  const output = runReqSync(attestedReqSync({
    inventory: { ...ATTESTED_INVENTORY, baseDigest: sha256('previous base') }
  }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'a stale base never establishes absence');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-envelope-unattested'), 'the envelope mismatch is diagnosed');
});

checkCase('325-3a F2 absent baseline: not a fail, req-sync-envelope-unattested (round 6)', () => {
  const output = run({
    obligations: [attestedReqSync()],
    artifacts: RS_ARTIFACTS,
    baseline: undefined,
    executionRecords: [],
    reviewRecords: []
  });
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'no baseline identity, no negative result');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-envelope-unattested'), 'the missing baseline is diagnosed');
});

checkCase('325-3a F2 absent artifact identity for the PRD scope path: not a fail, req-sync-envelope-unattested (round 6)', () => {
  const output = run({
    obligations: [attestedReqSync()],
    artifacts: { [TEST_PATH]: { digest: TEST_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [],
    reviewRecords: []
  });
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'no artifact identity, no negative result');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-envelope-unattested'), 'the missing identity is diagnosed');
});

checkCase('325-3a F2 unobserved waiver inventory (waiverInventoryComplete false) with empty records: not a fail, req-sync-envelope-unattested (round 6)', () => {
  const output = runReqSync(attestedReqSync({
    inventory: { ...ATTESTED_INVENTORY, waiverInventoryComplete: false }
  }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail',
    'empty records are not an observed absence unless the waiver inventory is attested');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-envelope-unattested'), 'the unobserved inventory is diagnosed');
});

checkCase('325-3a F2 missing configDigest: not a fail, req-sync-envelope-unattested (round 6)', () => {
  const { configDigest, ...withoutConfig } = ATTESTED_INVENTORY;
  const output = runReqSync(attestedReqSync({ inventory: withoutConfig }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'a missing config identity is unattested');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-envelope-unattested'), 'the missing field is diagnosed');
});

checkCase('325-3a F2 positive: fully attested current no-revision/no-waiver: observed/fail (round 6)', () => {
  const output = runReqSync(attestedReqSync());
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.observation, 'observed', 'the attested absence is an observed check');
  assert.strictEqual(result.outcome, 'fail', 'the attested absence is an observed failure');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-no-revision-or-waiver'), 'the failure is diagnosed');
});

// Round 8 (PR #334 review 2, Q2, Q3, Q4). Evidence expectations only.

// Q2: the absence fail is per cited REQ. A REQ that is neither revised nor covered by a valid waiver is missing.
const REQ_A = 'REQ-GRPH-001';
const REQ_B = 'REQ-GRPH-002';
const TWO_REQS = [{ id: REQ_A, file: PRD, resolution: 'resolved' }, { id: REQ_B, file: PRD, resolution: 'resolved' }];

checkCase('325-3a Q2 0 of 2 cited REQs revised, no waiver, attested: observed fail naming both REQs (round 8 control)', () => {
  const output = runReqSync(attestedReqSync({ citedReqs: TWO_REQS, reqUpdates: [] }));
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.outcome, 'fail', 'no cited REQ is revised or waived');
  const diag = output.diagnostics.find(item => item.code === 'req-sync-no-revision-or-waiver');
  assert.ok(diag && JSON.stringify(diag).includes(REQ_A) && JSON.stringify(diag).includes(REQ_B), 'both missing REQs are named');
});

checkCase('325-3a Q2 1 of 2 cited REQs revised, no waiver, attested: observed fail naming REQ-GRPH-002 (round 8)', () => {
  const output = runReqSync(attestedReqSync({ citedReqs: TWO_REQS, reqUpdates: [{ id: REQ_A, file: PRD }] }));
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.outcome, 'fail', 'REQ-GRPH-002 is neither revised nor waived');
  const diag = output.diagnostics.find(item => item.code === 'req-sync-no-revision-or-waiver');
  assert.ok(diag && JSON.stringify(diag).includes(REQ_B), 'the unrevised REQ is named');
  assert.ok(diag && !JSON.stringify(diag).includes(REQ_A), 'the revised REQ is not named as missing');
});

checkCase('325-3a Q2 2 of 2 cited REQs revised with matching evidence: pass (round 8 control)', () => {
  const output = runReqSync(attestedReqSync({ citedReqs: TWO_REQS, reqUpdates: [{ id: REQ_A, file: PRD }, { id: REQ_B, file: PRD }] }), {
    executionRecords: [boundExec('exec-req')]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'pass', 'every cited REQ is revised');
});

checkCase('325-3a Q2 1 of 2 cited REQs revised plus a valid covering waiver with matching evidence: pass (round 8 control)', () => {
  const output = runReqSync(attestedReqSync({ citedReqs: TWO_REQS, reqUpdates: [{ id: REQ_A, file: PRD }] }), {
    executionRecords: [boundExec('exec-req')],
    reviewRecords: [validWaiver('waiver-covering', 'doc-change:requirement-sync', ['exec-req'])]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'pass', 'a valid covering waiver satisfies every cited REQ');
});

// Q3: a new REQ-citing test that delegates to a helper reaches the fail lane through its trigger.
checkCase('325-3a Q3 new REQ-citing test delegating to a helper, complete envelope, no waiver: observed fail (round 8)', () => {
  const output = runReqSync(attestedReqSync({ assertionChanged: false, requirementSyncTrigger: 'new-test' }));
  const result = resultFor(output, 'doc-change:requirement-sync');
  assert.strictEqual(result.observation, 'observed', 'the unmet obligation is observed');
  assert.strictEqual(result.outcome, 'fail', 'a new REQ-citing test with no revision or waiver fails');
  assert.ok(output.diagnostics.some(item => item.code === 'req-sync-no-revision-or-waiver'), 'the failure is diagnosed');
});

checkCase('325-3a Q3 same new helper-delegated test without the envelope: none, not fail (round 8 control)', () => {
  const output = runReqSync(reqSyncObligation({ assertionChanged: false, requirementSyncTrigger: 'new-test' }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'the fail lane needs an attested envelope');
});

// Q4: an unknown scope (attribution impossible) never fails, whatever else is attested.
checkCase('325-3a Q4 unknown scope (attribution impossible) with otherwise fail-shaped inputs: not fail (round 8)', () => {
  const output = runReqSync(attestedReqSync({ applicability: 'unknown', citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }] }));
  assert.notStrictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'an unknown scope never establishes absence');
});

// Round 9 (PR #334 review round 6). Evidence expectations only.

// P1: an unknown requirement scope never passes and never establishes absence, even with valid evidence for the known subset.
checkCase('325-3a P1 unknown requirement scope (requirementScopeUnknown true), attested, no evidence: not a fail, outcome none (round 9)', () => {
  const output = runReqSync(attestedReqSync({ requirementScopeUnknown: true, citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }] }));
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none', 'an unknown scope yields none, never an absence fail');
});

checkCase('325-3a P1 unknown requirement scope (scope requirementIds unknown) with valid known-subset waiver and evidence: not pass, outcome none (round 9)', () => {
  const output = runReqSync(attestedReqSync({
    scope: { paths: [TEST_PATH, PRD], requirementIds: 'unknown' },
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }]
  }), {
    executionRecords: [boundExec('exec-req')],
    reviewRecords: [validWaiver('waiver-known', 'doc-change:requirement-sync', ['exec-req'])]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'valid evidence for the known subset does not pass an obligation whose scope is unknown');
});

checkCase('325-3a P1 unknown requirement scope with a revision of the known REQ and matching evidence: not pass, outcome none (round 9)', () => {
  const output = runReqSync(attestedReqSync({
    requirementScopeUnknown: true,
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }],
    reqUpdates: [{ id: REQ_A, file: PRD }]
  }), {
    executionRecords: [boundExec('exec-req')]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'a direct evidence input with an unknown scope is refused, even when the known REQ is revised');
});

// P2: an explicit trigger is authoritative. Null and unknown never fail; a legacy absent field keeps the old behavior.
checkCase('325-3a P2 explicit requirementSyncTrigger null with assertionChanged true, full attested fail-shaped inputs: not fail, outcome none (round 9)', () => {
  const output = runReqSync(attestedReqSync({ requirementSyncTrigger: null, assertionChanged: true }));
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'an explicit null trigger is not an active trigger');
});

checkCase('325-3a P2 explicit requirementSyncTrigger unknown with assertionChanged true, full attested fail-shaped inputs: not fail, outcome none (round 9)', () => {
  const output = runReqSync(attestedReqSync({ requirementSyncTrigger: 'unknown', assertionChanged: true }));
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'an unknown trigger never fails');
});

checkCase('325-3a P2 control: explicit assertion-change trigger, attested, no waiver: observed fail (round 9)', () => {
  const output = runReqSync(attestedReqSync({ requirementSyncTrigger: 'assertion-change', assertionChanged: true }));
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'an active trigger still fails under the other conditions');
});

checkCase('325-3a P2 legacy absent-field positive: obligation without requirementSyncTrigger keeps the existing fail behavior (round 9)', () => {
  const output = runReqSync(attestedReqSync());
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail',
    'the absent field is legacy input, and assertionChanged true may still fail');
});

// Round 10 (PR #334 review round 7, F1). An unknown requirement scope is refused before any outcome branch.
function boundFailingExec(id) {
  return { ...boundExec(id), exitCode: 1, provenance: 'failing execution record bound to the current candidate and baseline' };
}

checkCase('325-3a F1 unknown scope (requirementScopeUnknown true) with a bound failing execution: none, not observed fail (round 10)', () => {
  const output = runReqSync(attestedReqSync({ requirementScopeUnknown: true, citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }] }), {
    executionRecords: [boundFailingExec('exec-fail')]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'an unknown scope is refused before the failed-command branch');
});

checkCase('325-3a F1 unknown scope (scope requirementIds unknown) with a bound failing execution: none, not observed fail (round 10)', () => {
  const output = runReqSync(attestedReqSync({
    scope: { paths: [TEST_PATH, PRD], requirementIds: 'unknown' },
    citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }]
  }), {
    executionRecords: [boundFailingExec('exec-fail')]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'a scope marked unknown by requirementIds is refused before the failed-command branch');
});

checkCase('325-3a F1 unknown scope with contradictory current pass and fail records: none (round 10)', () => {
  const output = runReqSync(attestedReqSync({ requirementScopeUnknown: true, citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }] }), {
    executionRecords: [boundExec('exec-pass'), boundFailingExec('exec-fail')]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'none',
    'contradictory records for an unknown scope yield none');
});

checkCase('325-3a F1 control: known scope with a bound failing execution: observed fail (round 10)', () => {
  const output = runReqSync(attestedReqSync({ requirementScopeUnknown: false, citedReqs: [{ id: REQ_A, file: PRD, resolution: 'resolved' }] }), {
    executionRecords: [boundFailingExec('exec-fail')]
  });
  assert.strictEqual(resultFor(output, 'doc-change:requirement-sync').outcome, 'fail', 'a known scope keeps the failed-execution branch');
});

checkCase('325-3a F1 control: doc-lint with a bound failing execution (no unknown markers): observed fail, unchanged (round 10)', () => {
  const output = run({
    obligations: [obligation('doc-lint', 'applicable', [ADR])],
    artifacts: { [ADR]: { digest: ADR_DIGEST } },
    baseline: CURRENT_BASELINE,
    executionRecords: [executionRecord({ id: 'exec-lint-fail', obligationId: 'doc-lint', exitCode: 1 })],
    reviewRecords: []
  });
  const result = resultFor(output, 'doc-lint');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'fail', 'a non-requirement capability keeps observed fail on a bound failing execution');
});

helper.finish();

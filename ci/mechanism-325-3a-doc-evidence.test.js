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

helper.finish();

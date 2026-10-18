'use strict';

// PR #334 round 2 — cross-module boundary regression.
//
// This suite integrates the two round-2 findings across the module boundary:
//   * finding 4307059315 (doc-obligations requirement-sync scope): an unrelated
//     REQ-citing B test edited comment-only / formatting-only / title-only must
//     neither enter the requirement-sync scope nor block a legitimate pass for a
//     legal A revision + A assertion change. A genuine B assertion edit still
//     joins the scope.
//   * finding 4307059310 (doc-evidence resolution guard): a derived missing /
//     unresolved (duplicate) cited REQ plus a bound, complete, nonzero execution
//     must be unresolved/none with a req-unresolved diagnostic, never
//     observed/fail; a resolved cited REQ plus a bound nonzero execution keeps
//     the observed/fail lane.
//
// Unlike the per-module sibling suites, every case here drives the full
// deriveDocFacts -> deriveDocObligations -> checkDocObligations pipeline using the
// existing req-revision fixture/config plus the existing unresolved fixtures, so
// it catches regressions that only appear when the two modules interact.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helper = require('./test-helper');

const obligationsPath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-obligations.js');
const evidencePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive');
const CONFIG = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'config.json'), 'utf8'));

let deriveDocFacts, deriveDocObligations, checkDocObligations;
try {
  ({ deriveDocFacts, deriveDocObligations } = require(obligationsPath));
  ({ checkDocObligations } = require(evidencePath));
} catch (error) {
  helper.check('pr334-r2-boundary. derive/evidence modules are available', false, error.message);
}

console.log('\n[pr334-r2-boundary] cross-module derive -> obligations -> evidence regression...');

const BASELINE = 'sha256:pr334-r2-boundary-baseline';
const TEST_A = 'ci/mechanism-lint.test.js'; // legal-revision fixture test citing REQ-GRPH-011
const TEST_B = 'ci/mechanism-pr334-r2-b.test.js'; // unrelated B test citing REQ-GRPH-010
const REVISION_PRD = 'docs/prd/graph/r002.md';

function sha256(text) {
  return `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function readTree(dir) {
  const files = {};
  const walk = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(dir, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

function fixtureTree(name, side) {
  return readTree(path.join(fixtureRoot, name, side));
}

// Builds the legal-revision fixture tree with an explicit unrelated B test.
function withB(beforeB, afterB) {
  const base = fixtureTree('req-revision', 'base');
  const candidate = fixtureTree('req-revision', 'candidate');
  base[TEST_B] = beforeB;
  candidate[TEST_B] = afterB;
  return { base, candidate };
}

function derivePipeline(baseFiles, candidateFiles) {
  const { facts } = deriveDocFacts({
    base: { files: baseFiles },
    candidate: { files: candidateFiles },
    config: CONFIG,
    inventory: { complete: true }
  });
  const obligation = deriveDocObligations(facts).find(item => item.capability === 'requirement-sync');
  assert.ok(obligation, 'requirement-sync is in the derived obligation catalog');
  return { facts, obligation };
}

// Binds a bound, complete execution record to every requested candidate path and
// runs the derived obligation through the evidence checker.
function checkWithEvidence(obligation, candidateFiles, bindPaths, exitCode) {
  const artifacts = {};
  const executionRecords = bindPaths.map((targetPath, index) => {
    const text = candidateFiles[targetPath];
    assert.strictEqual(typeof text, 'string', `candidate text exists for evidence binding to ${targetPath}`);
    const digest = sha256(text);
    artifacts[targetPath] = { digest };
    return {
      id: `exec-${index}`,
      obligationId: obligation.id,
      command: `npm run verify -- ${targetPath}`,
      provenance: `bound execution record for ${targetPath}`,
      exitCode,
      baseDigest: BASELINE,
      artifactDigests: { [targetPath]: digest },
      paths: [targetPath]
    };
  });
  return checkDocObligations({
    obligations: [obligation],
    artifacts,
    baseline: { digest: BASELINE },
    executionRecords,
    reviewRecords: []
  });
}

function resultOf(output) {
  return output.results[0];
}

function hasDiagnostic(output, code) {
  return output.diagnostics.some(item => item.code === code);
}

function checkCase(name, body) {
  try {
    body();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// A legitimate A revision + assertion change must pass on A evidence alone; a
// non-substantive B edit must not add B to the scope or force B-only coverage.
function assertNonSubstantiveBKeepsAEvidencePassing(label, beforeB, afterB) {
  const { base, candidate } = withB(beforeB, afterB);
  const { facts, obligation } = derivePipeline(base, candidate);

  assert.strictEqual(facts.requirementSyncTrigger, 'assertion-change', 'the A assertion change triggers requirement-sync');
  assert.ok(facts.reqUpdates.some(item => item.id === 'REQ-GRPH-011' && item.file === REVISION_PRD),
    `the legal A successor is delivered: ${JSON.stringify(facts.reqUpdates)}`);
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-011'], 'only A contributes a cited REQ');
  assert.ok(!facts.reqCitingTests.includes(TEST_B), `${label} B is not a contributing test path`);
  assert.ok(!obligation.scope.paths.includes(TEST_B), `${label} B is excluded from the requirement-sync scope`);

  const output = checkWithEvidence(obligation, candidate, [TEST_A, REVISION_PRD], 0);
  assert.strictEqual(resultOf(output).outcome, 'pass',
    `${label} B leaves the legal A revision pass intact: ${JSON.stringify(resultOf(output))}`);
}

checkCase('pr334-r2-boundary. A assertion + legal A revision with a comment-only unrelated B edit: B stays out of scope and A evidence passes', () => {
  assertNonSubstantiveBKeepsAEvidencePassing(
    'comment-only',
    '// REQ-GRPH-010\n// old note\nassert.equal(runB(), 1);\n',
    '// REQ-GRPH-010\n// revised note\nassert.equal(runB(), 1);\n'
  );
});

checkCase('pr334-r2-boundary. title-only unrelated B edit stays out of scope and keeps the legal A revision pass', () => {
  assertNonSubstantiveBKeepsAEvidencePassing(
    'title-only',
    "test('REQ-GRPH-010 old title', () => { assert.equal(runB(), 1); });\n",
    "test('REQ-GRPH-010 renamed title', () => { assert.equal(runB(), 1); });\n"
  );
});

checkCase('pr334-r2-boundary. formatting-only unrelated B edit stays out of scope and keeps the legal A revision pass', () => {
  assertNonSubstantiveBKeepsAEvidencePassing(
    'formatting-only',
    '// REQ-GRPH-010\nassert.equal(runB(), 1);\n',
    '// REQ-GRPH-010\nassert.equal( runB( ), 1 );\n'
  );
});

checkCase('pr334-r2-boundary. a genuine unrelated B assertion edit joins the scope and needs B-bound evidence (positive control)', () => {
  const { base, candidate } = withB(
    '// REQ-GRPH-010\nassert.equal(runB(), 1);\n',
    '// REQ-GRPH-010\nassert.equal(runB(), 2);\n'
  );
  const { facts, obligation } = derivePipeline(base, candidate);

  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-010', 'REQ-GRPH-011'],
    'both changed assertions contribute their own requirement IDs');
  assert.ok(facts.reqCitingTests.includes(TEST_B), 'a genuine B assertion edit is a contributing test path');
  assert.ok(obligation.scope.paths.includes(TEST_B), `a genuine B assertion edit is scoped: ${obligation.scope.paths}`);

  const aOnly = checkWithEvidence(obligation, candidate, [TEST_A, REVISION_PRD], 0);
  assert.notStrictEqual(resultOf(aOnly).outcome, 'pass', 'A-only evidence is insufficient once B genuinely joins the scope');

  const full = checkWithEvidence(obligation, candidate, obligation.scope.paths, 0);
  assert.strictEqual(resultOf(full).outcome, 'pass', `full scope evidence passes: ${JSON.stringify(resultOf(full))}`);
});

checkCase('pr334-r2-boundary. derived missing cited REQ with a bound complete nonzero execution: unresolved/none, never observed fail', () => {
  const { facts, obligation } = derivePipeline(fixtureTree('orphan-req-test', 'base'), fixtureTree('orphan-req-test', 'candidate'));
  assert.strictEqual(obligation.applicability, 'applicable', 'the assertion change triggers requirement-sync');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-099'], 'the orphan citation is derived');
  assert.strictEqual(facts.citedReqs[0].resolution, 'missing', 'the orphan REQ is missing, not resolved');

  const output = checkWithEvidence(obligation, fixtureTree('orphan-req-test', 'candidate'), obligation.scope.paths, 1);
  const result = resultOf(output);
  assert.strictEqual(result.outcome, 'none', 'a missing cited REQ with a bound failing execution is never observed fail');
  assert.strictEqual(result.observation, 'unresolved', 'the missing REQ leaves the obligation unresolved');
  assert.ok(hasDiagnostic(output, 'req-unresolved'), 'the missing REQ is named in a req-unresolved diagnostic');
});

checkCase('pr334-r2-boundary. derived duplicate/unresolved cited REQ with a bound complete nonzero execution: unresolved/none, never observed fail', () => {
  const { facts, obligation } = derivePipeline(fixtureTree('dup-req-id', 'base'), fixtureTree('dup-req-id', 'candidate'));
  assert.strictEqual(obligation.applicability, 'applicable', 'the assertion change triggers requirement-sync');
  assert.deepStrictEqual(facts.citedReqs.map(item => item.id), ['REQ-GRPH-001'], 'the duplicated citation is derived once');
  assert.notStrictEqual(facts.citedReqs[0].resolution, 'resolved', 'a duplicate declaration never resolves');
  assert.strictEqual(facts.citedReqs[0].file, null, 'a duplicate declaration has no resolution file');

  const output = checkWithEvidence(obligation, fixtureTree('dup-req-id', 'candidate'), obligation.scope.paths, 1);
  const result = resultOf(output);
  assert.strictEqual(result.outcome, 'none', 'a duplicate/unresolved cited REQ with a bound failing execution is never observed fail');
  assert.strictEqual(result.observation, 'unresolved', 'the unresolved REQ leaves the obligation unresolved');
  assert.ok(hasDiagnostic(output, 'req-unresolved'), 'the unresolved REQ is named in a req-unresolved diagnostic');
});

checkCase('pr334-r2-boundary. resolved cited REQ with a bound complete nonzero execution keeps observed fail (positive control)', () => {
  const base = fixtureTree('req-revision', 'base');
  const candidate = fixtureTree('req-revision', 'candidate');
  const { facts, obligation } = derivePipeline(base, candidate);
  assert.strictEqual(facts.citedReqs[0].resolution, 'resolved', 'the legal successor resolves the cited REQ');
  assert.strictEqual(facts.citedReqs[0].file, REVISION_PRD, 'the cited REQ resolves to the successor');

  const output = checkWithEvidence(obligation, candidate, obligation.scope.paths, 1);
  const result = resultOf(output);
  assert.strictEqual(result.observation, 'observed', 'a resolved known identity keeps the failing-execution lane');
  assert.strictEqual(result.outcome, 'fail', 'a resolved cited REQ with a bound nonzero execution stays observed fail');
  assert.ok(!hasDiagnostic(output, 'req-unresolved'), 'a resolved REQ is never diagnosed unresolved');
});

helper.finish();

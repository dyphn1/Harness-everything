'use strict';

// PR #334 round 3 — cross-module boundary regression.
//
// Finding 4307119827 (requirement identity): a REQ retarget REQ-A -> REQ-B with an
// identical test body was silently paired by body equality and reported as
// requirement-sync N/A. Body sameness is not proof of a stable REQ-to-test
// association. A same-REQ display-title rename must still stay N/A, but any changed
// REQ set (retarget, add, remove, multi) must retain the new/changed REQ, be
// applicable or conservatively unknown, and never degrade to N/A. Unknown
// applicability can never pass or fail even with bound passing/failing records.
//
// Finding 4307119837 (ADR Decision heading): extractSection recognized only
// column-zero ATX headings, so a 1-3-space-indented `## Decision` was missed and its
// normative content change produced no quality-review/conflict-check MUST. Per
// CommonMark 0.31.2 (https://spec.commonmark.org/0.31.2/#atx-headings) an ATX
// heading may be indented 0-3 spaces; 4 spaces or a tab is an indented code block and
// a fenced `#` is not a heading. An indented next section still terminates Decision.
//
// Every case drives the full deriveDocFacts -> deriveDocObligations ->
// checkDocObligations pipeline using the existing valid REQ fixture and the existing
// typo-decision / decision-fence fixtures, so it catches regressions that only appear
// across the module boundary.

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
  helper.check('pr334-r3-boundary. derive/evidence modules are available', false, error.message);
}

console.log('\n[pr334-r3-boundary] REQ identity + ATX heading cross-module matrix...');

const BASELINE = 'sha256:pr334-r3-boundary-baseline';
const RETARGET_TEST = 'ci/pr334-r3-retarget.test.js';
const REQ_FILE = 'docs/prd/graph/r001.md';
const ADR_PATH = 'docs/adr/GRPH-007.md';

function fixtureFile(name, side, rel) {
  return fs.readFileSync(path.join(fixtureRoot, name, side, rel), 'utf8');
}

// Valid, effective PRD declaring REQ-GRPH-010 and REQ-GRPH-011 (both retained).
const VALID_PRD = fixtureFile('req-revision', 'base', REQ_FILE);
const TYPO_BASE = fixtureFile('typo-decision', 'base', ADR_PATH);

function checkCase(name, body) {
  try {
    body();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// ---------------------------------------------------------------------------
// Requirement-sync: derive -> obligations -> evidence
// ---------------------------------------------------------------------------

function derivePipeline(baseFiles, candidateFiles) {
  const { facts } = deriveDocFacts({
    base: { files: baseFiles },
    candidate: { files: candidateFiles },
    config: CONFIG,
    inventory: { complete: true }
  });
  const requirementSync = deriveDocObligations(facts).find(item => item.capability === 'requirement-sync');
  assert.ok(requirementSync, 'requirement-sync is in the derived obligation catalog');
  return { facts, obligation: requirementSync };
}

function reqScenario(baseTest, candidateTest) {
  const baseFiles = { [REQ_FILE]: VALID_PRD, [RETARGET_TEST]: baseTest };
  const candidateFiles = { [REQ_FILE]: VALID_PRD, [RETARGET_TEST]: candidateTest };
  const { facts, obligation } = derivePipeline(baseFiles, candidateFiles);
  return { facts, obligation, candidateFiles };
}

function sha256(text) {
  return `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

// Binds a bound, complete execution record to every scope path of the obligation.
function checkWithEvidence(obligation, candidateFiles, exitCode) {
  const artifacts = {};
  const executionRecords = [];
  for (const targetPath of obligation.scope.paths) {
    const text = candidateFiles[targetPath];
    if (typeof text !== 'string') continue;
    const digest = sha256(text);
    artifacts[targetPath] = { digest };
    executionRecords.push({
      id: `exec-${executionRecords.length}`,
      obligationId: obligation.id,
      command: `npm run verify -- ${targetPath}`,
      provenance: `bound execution record for ${targetPath}`,
      exitCode,
      baseDigest: BASELINE,
      artifactDigests: { [targetPath]: digest },
      paths: [targetPath]
    });
  }
  return checkDocObligations({
    obligations: [obligation],
    artifacts,
    baseline: { digest: BASELINE },
    executionRecords,
    reviewRecords: []
  });
}

function resultFor(scenario, exitCode) {
  return checkWithEvidence(scenario.obligation, scenario.candidateFiles, exitCode).results[0];
}

function isUnknownScope(obligation) {
  return obligation.scope && obligation.scope.requirementIds === 'unknown';
}

// A changed REQ set is never N/A; its bound evidence never passes and, when the
// applicability is conservatively unknown, it never passes OR fails.
function assertChangedSetNotNA(label, scenario) {
  const { facts, obligation } = scenario;
  assert.ok(['applicable', 'unknown'].includes(obligation.applicability),
    `${label}: a changed REQ set is applicable or unknown, never N/A (got ${JSON.stringify(obligation.applicability)})`);
  assert.notStrictEqual(facts.requirementSyncTrigger === null && !facts.requirementScopeUnknown, true,
    `${label}: the change is not silently trivial`);

  const passing = resultFor(scenario, 0);
  const failing = resultFor(scenario, 1);
  assert.notStrictEqual(passing.outcome, 'pass', `${label}: a bare REQ-set change with no revision evidence never passes`);
  assert.notStrictEqual(failing.outcome, 'pass', `${label}: a bare REQ-set change with no revision evidence never passes`);
  if (obligation.applicability === 'unknown') {
    assert.strictEqual(passing.outcome, 'none', `${label}: unknown applicability with bound passing records is never pass`);
    assert.strictEqual(failing.outcome, 'none', `${label}: unknown applicability with bound failing records is never fail`);
    assert.strictEqual(failing.observation, 'not-observed', `${label}: unknown applicability fails closed`);
  }
}

function scopedTest(scenario) {
  return scenario.facts.reqCitingTests.includes(RETARGET_TEST)
    || scenario.obligation.scope.paths.includes(RETARGET_TEST);
}

checkCase('pr334-r3-boundary. same-REQ display-title rename stays requirement-sync N/A (control)', () => {
  const scenario = reqScenario(
    "test('REQ-GRPH-011 old title', () => { verify(); });\n",
    "test('REQ-GRPH-011 renamed title', () => { verify(); });\n"
  );
  assert.strictEqual(scenario.facts.requirementSyncTrigger, null, 'a display-title rename is not a new test or assertion edit');
  assert.strictEqual(scenario.facts.requirementScopeUnknown, false, 'the unchanged body and REQ identity are stable');
  assert.deepStrictEqual(scenario.facts.citedReqs, [], 'a display-title rename contributes no changed citation');
  assert.strictEqual(scenario.obligation.applicability, 'N/A', 'a same-REQ display-title rename is not a sync candidate');
});

checkCase('pr334-r3-boundary. REQ retarget REQ-GRPH-011 -> REQ-GRPH-010 with identical body is never N/A and retains the new REQ', () => {
  const scenario = reqScenario(
    "test('REQ-GRPH-011 stable', () => { verify(); });\n",
    "test('REQ-GRPH-010 stable', () => { verify(); });\n"
  );
  assertChangedSetNotNA('retarget 011->010 identical body', scenario);

  const unknown = isUnknownScope(scenario.obligation);
  const retained = scenario.facts.citedReqs.some(item => item.id === 'REQ-GRPH-010');
  assert.ok(retained || unknown,
    `the retargeted new REQ-GRPH-010 is retained or the scope is explicitly unknown: ${JSON.stringify(scenario.facts.citedReqs)}`);
  assert.ok(scopedTest(scenario) || unknown,
    `the changed test stays in the requirement-sync scope: ${JSON.stringify(scenario.obligation.scope.paths)}`);
});

checkCase('pr334-r3-boundary. adding a REQ id to an existing test title is never N/A and retains the added REQ', () => {
  const scenario = reqScenario(
    "test('stable', () => { verify(); });\n",
    "test('REQ-GRPH-011 stable', () => { verify(); });\n"
  );
  assertChangedSetNotNA('add id', scenario);

  const unknown = isUnknownScope(scenario.obligation);
  const retained = scenario.facts.citedReqs.some(item => item.id === 'REQ-GRPH-011');
  assert.ok(retained || unknown,
    `the added REQ-GRPH-011 is retained or the scope is explicitly unknown: ${JSON.stringify(scenario.facts.citedReqs)}`);
  assert.ok(scopedTest(scenario) || unknown,
    `the changed test stays in the requirement-sync scope: ${JSON.stringify(scenario.obligation.scope.paths)}`);
});

checkCase('pr334-r3-boundary. removing a REQ id from an existing test title is never N/A and keeps the changed test in scope', () => {
  const scenario = reqScenario(
    "test('REQ-GRPH-011 stable', () => { verify(); });\n",
    "test('stable', () => { verify(); });\n"
  );
  assertChangedSetNotNA('remove id', scenario);
  assert.ok(scopedTest(scenario) || isUnknownScope(scenario.obligation),
    `a changed REQ set keeps the changed test in scope: ${JSON.stringify(scenario.obligation.scope.paths)}`);
});

checkCase('pr334-r3-boundary. multi-REQ set change is never N/A and keeps the changed test in scope', () => {
  const scenario = reqScenario(
    "test('REQ-GRPH-010 REQ-GRPH-011 multi', () => { verify(); });\n",
    "test('REQ-GRPH-011 multi', () => { verify(); });\n"
  );
  assertChangedSetNotNA('multi set change', scenario);
  const unknown = isUnknownScope(scenario.obligation);
  assert.ok(scenario.facts.citedReqs.some(item => item.id === 'REQ-GRPH-011') || unknown,
    `the surviving REQ-GRPH-011 is retained or the scope is explicitly unknown: ${JSON.stringify(scenario.facts.citedReqs)}`);
  assert.ok(scopedTest(scenario) || unknown,
    `the changed test stays in the requirement-sync scope: ${JSON.stringify(scenario.obligation.scope.paths)}`);
});

checkCase('pr334-r3-boundary. reordering identical same-REQ calls stays N/A (control)', () => {
  const scenario = reqScenario(
    [
      "test('REQ-GRPH-011 first', () => { verifyFirst(); });",
      "test('REQ-GRPH-011 second', () => { verifySecond(); });"
    ].join('\n') + '\n',
    [
      "test('REQ-GRPH-011 second', () => { verifySecond(); });",
      "test('REQ-GRPH-011 first', () => { verifyFirst(); });"
    ].join('\n') + '\n'
  );
  assert.notStrictEqual(scenario.facts.requirementSyncTrigger, 'new-test', 'the same REQ call inventory is unchanged');
  assert.strictEqual(scenario.facts.requirementScopeUnknown, false, 'both existing calls retain stable identities');
  assert.strictEqual(scenario.obligation.applicability, 'N/A', 'a pure reorder is not a sync candidate');
});

checkCase('pr334-r3-boundary. genuine added REQ-citing test stays applicable and keeps the observed-fail lane (control)', () => {
  const scenario = reqScenario(
    "test('REQ-GRPH-011 existing', () => { verifyA(); });\n",
    [
      "test('REQ-GRPH-011 existing', () => { verifyA(); });",
      "test('REQ-GRPH-011 added', verifyB);"
    ].join('\n') + '\n'
  );
  assert.strictEqual(scenario.facts.requirementSyncTrigger, 'new-test', 'the added REQ-citing test is a new-test signal');
  assert.strictEqual(scenario.obligation.applicability, 'applicable', 'a genuine added test is a sync candidate');
  assert.ok(scenario.facts.citedReqs.some(item => item.id === 'REQ-GRPH-011' && item.resolution === 'resolved'),
    `the added test cites a resolved REQ: ${JSON.stringify(scenario.facts.citedReqs)}`);
  const failing = resultFor(scenario, 1);
  assert.strictEqual(failing.observation, 'observed', 'a resolved known identity keeps the observed lane');
  assert.strictEqual(failing.outcome, 'fail', 'a resolved cited REQ with bound failing evidence is observed fail');
});

checkCase('pr334-r3-boundary. existing REQ assertion change stays applicable and keeps the observed-fail lane (control)', () => {
  const scenario = reqScenario(
    "// REQ-GRPH-011\nassert.equal(run(), 1);\n",
    "// REQ-GRPH-011\nassert.equal(run(), 2);\n"
  );
  assert.strictEqual(scenario.facts.requirementSyncTrigger, 'assertion-change', 'the changed assertion triggers requirement-sync');
  assert.strictEqual(scenario.obligation.applicability, 'applicable', 'a genuine assertion change is a sync candidate');
  assert.ok(scenario.facts.citedReqs.some(item => item.id === 'REQ-GRPH-011' && item.resolution === 'resolved'),
    `the changed assertion cites a resolved REQ: ${JSON.stringify(scenario.facts.citedReqs)}`);
  assert.strictEqual(resultFor(scenario, 1).outcome, 'fail', 'a resolved cited REQ with bound failing evidence is observed fail');
});

checkCase('pr334-r3-boundary. unknown requirement identity can never pass or fail even with bound records (control)', () => {
  const scenario = reqScenario(
    "test('REQ-GRPH-011 old check', () => { verifyOldBehavior(); });\n",
    "test('REQ-GRPH-011 replacement check', () => { verifyNewBehavior(); });\n"
  );
  assert.strictEqual(scenario.facts.requirementScopeUnknown, true, 'a same-REQ wholesale body replacement leaves identity ambiguous');
  assert.strictEqual(scenario.obligation.applicability, 'unknown', 'ambiguous identity is unknown, never downgraded to N/A');
  assert.strictEqual(isUnknownScope(scenario.obligation), true, 'the obligation carries an explicitly unknown requirement scope');

  const passing = resultFor(scenario, 0);
  const failing = resultFor(scenario, 1);
  assert.strictEqual(passing.outcome, 'none', 'unknown applicability with bound passing evidence is never pass');
  assert.strictEqual(failing.outcome, 'none', 'unknown applicability with bound failing evidence is never fail');
  assert.strictEqual(failing.observation, 'not-observed', 'unknown applicability fails closed');
});

// ---------------------------------------------------------------------------
// ADR Decision heading: derive -> obligations (CommonMark ATX indentation)
// ---------------------------------------------------------------------------

function deriveAdr(baseText, candidateText) {
  const { facts } = deriveDocFacts({
    base: { files: { [ADR_PATH]: baseText } },
    candidate: { files: { [ADR_PATH]: candidateText } },
    config: CONFIG
  });
  const byCapability = new Map(deriveDocObligations(facts).map(item => [item.capability, item]));
  return { facts, byCapability };
}

function assertDecisionMUSTs(label, baseText, candidateText) {
  const { facts, byCapability } = deriveAdr(baseText, candidateText);
  assert.strictEqual(facts.normativeChanged, true, `${label}: the Decision content change is normative`);
  for (const capability of ['quality-review', 'conflict-check']) {
    assert.strictEqual(byCapability.get(capability).applicability, 'applicable',
      `${label}: ${capability} is a MUST for a Decision change`);
  }
}

function assertNonNormative(label, baseText, candidateText) {
  const { byCapability } = deriveAdr(baseText, candidateText);
  for (const capability of ['quality-review', 'conflict-check']) {
    assert.strictEqual(byCapability.get(capability).applicability, 'N/A',
      `${label}: ${capability} must not fire for a non-Decision change`);
  }
}

// Reuses the typo-decision fixture, differing only in "Run lint" -> "Run lnt".
function decisionWithPad(pad) {
  const base = TYPO_BASE;
  const candidate = fixtureFile('typo-decision', 'candidate', ADR_PATH);
  const rewrite = text => text.replace('\n## Decision\n', `\n${pad}## Decision\n`);
  return [rewrite(base), rewrite(candidate)];
}

for (const [label, pad] of [['0-space', ''], ['1-space', ' '], ['2-space', '  '], ['3-space', '   ']]) {
  checkCase(`pr334-r3-boundary. a ${label}-indented Decision heading is a real ATX heading and fires the normative MUSTs`, () => {
    const [base, candidate] = decisionWithPad(pad);
    assertDecisionMUSTs(label, base, candidate);
  });
}

for (const [label, pad] of [['4-space', '    '], ['tab', '\t']]) {
  checkCase(`pr334-r3-boundary. a ${label}-indented "## Decision" is an indented code block, not a heading (negative)`, () => {
    const [base, candidate] = decisionWithPad(pad);
    assertNonNormative(label, base, candidate);
  });
}

for (const name of ['decision-fence-backtick', 'decision-fence-tilde']) {
  checkCase(`pr334-r3-boundary. a fenced fake heading does not terminate Decision (${name}, negative)`, () => {
    const base = fixtureFile(name, 'base', 'docs/adr/GRPH-010.md');
    const candidate = fixtureFile(name, 'candidate', 'docs/adr/GRPH-010.md');
    assertDecisionMUSTs(name, base, candidate);
    assert.strictEqual(base.includes('```') || base.includes('~~~'), true, `${name}: fixture carries a fence`);
  });
}

// Reuses the typo-decision fixture (Decision unchanged) and appends a next section
// whose heading indentation varies; only the next-section text changes.
function sectioned(pad, tail) {
  return `${TYPO_BASE}\n${pad}## Consequences\n\n${tail}\n`;
}

for (const [label, pad] of [['0-space', ''], ['1-space', ' '], ['2-space', '  ']]) {
  checkCase(`pr334-r3-boundary. a ${label}-indented next section terminates Decision (change outside is non-normative)`, () => {
    assertNonNormative(label, sectioned(pad, 'Consequence A.'), sectioned(pad, 'Consequence B.'));
  });
}

helper.finish();

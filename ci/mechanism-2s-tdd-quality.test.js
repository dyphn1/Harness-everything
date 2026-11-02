const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');
const { evaluateEvidence } = require('../tdd/scripts/quality-gate');

console.log('\n[2s] TDD quality evidence gate (issue #58)...');

const classes = {
  inputCompleteness: ['required', 'optional', 'omitted', 'empty', 'null', 'min', 'max', 'boundary'],
  outputCompleteness: ['value', 'type', 'schema', 'required-field', 'prohibited-extra-field', 'side-effect'],
  errorHandling: ['error-type', 'error-code', 'message', 'state-cleanup', 'rollback', 'no-unintended-output'],
  unexpectedInput: ['malformed', 'unknown', 'extra', 'unsupported', 'out-of-range', 'duplicate', 'wrong-type']
};

const scenarioCatalog = JSON.parse(fs.readFileSync(path.join(helper.root, 'tdd', 'fixtures', 'quality-scenarios.json'), 'utf8'));
const requiredScenarios = ['PASS', 'unit profile', 'integration profile', 'weighted integration failure', 'weighted unit failure', 'NON_CONFORMANT', 'SOURCE_DEFECT', 'SOURCE_CONFLICT', 'SOURCE_DEFECT without sourceEvidence', 'SOURCE_CONFLICT without sourceEvidence', 'SOURCE_CONFLICT node-versus-value', 'SOURCE_CONFLICT agreeing expectations', 'SOURCE_CONFLICT two-source evidence', 'SOURCE_CONFLICT unrelated assertions', 'malformed input', 'unexpected input', 'error handling', 'nondeterministic output', 'auditable N/A', 'skipped test'];
helper.check('2s. fixture catalog covers every required outcome', requiredScenarios.every(name => scenarioCatalog.scenarios.some(scenario => scenario.name === name)));

function checks(prefix, names) {
  return names.map((name, index) => ({
    id: `${prefix}-${index + 1}`,
    class: name,
    status: 'PASS',
    evidence: `tests/example.test.js#${prefix}-${name}`
  }));
}

function validEvidence() {
  const sideEffects = {
    createdFiles: [], changedFiles: [], deletedFiles: [],
    persistentState: {}, events: [], logs: [], externalCalls: []
  };
  return {
    schemaVersion: '1.0.0',
    requirements: [{
      requirementId: 'REQ-001',
      testProfile: 'integration',
      source: {
        type: 'SPEC', path: 'docs/example.md', section: 'Expected behavior', status: 'AUTHORITATIVE'
      },
      sourceConformance: 'PASS',
      sourceValidity: 'VALID',
      dimensions: {
        positiveParameters: { applicable: true, checks: checks('positive', ['supported-partition']) },
        negativeParameters: { applicable: true, checks: checks('negative', ['rejected-partition']) },
        inputCompleteness: { applicable: true, checks: checks('input', classes.inputCompleteness) },
        outputCompleteness: { applicable: true, checks: checks('output', classes.outputCompleteness) },
        errorHandling: { applicable: true, checks: checks('error', classes.errorHandling) },
        unexpectedInput: { applicable: true, checks: checks('unexpected', classes.unexpectedInput) },
        determinism: {
          applicable: true,
          runs: [
            { id: 'run-1', input: { value: 1 }, exitStatus: 0, errorCategory: null, output: { value: 2 }, sideEffects },
            { id: 'run-2', input: { value: 1 }, exitStatus: 0, errorCategory: null, output: { value: 2 }, sideEffects }
          ],
          normalizations: []
        },
        sourceTraceability: { applicable: true }
      },
      skippedTests: [],
      naDeclarations: []
    }]
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evaluate(mutator) {
  const evidence = validEvidence();
  if (mutator) mutator(evidence.requirements[0], evidence);
  return evaluateEvidence(evidence);
}

const pass = evaluate();
helper.check('2s. complete profile-routed evidence passes with a 100 score', pass.result === 'PASS' && pass.score === 100 && pass.requirements[0].testProfile === 'integration');
helper.check(
  '2s. report publishes the canonical weights and pass threshold',
  pass.scoring.requiredScore === 100 && pass.scoring.weights.positiveParameters === 0.15 && pass.scoring.weights.determinism === 0.10
);

const weightedIntegration = evaluate(req => { req.dimensions.positiveParameters.checks[0].status = 'FAIL'; });
helper.check('2s. integration score follows the canonical weighted formula exactly', weightedIntegration.score === 85);

const missingProfile = evaluate(req => { delete req.testProfile; });
helper.check('2s. every requirement must declare its selected test profile', missingProfile.result === 'FAIL' && missingProfile.errors.some(e => /testProfile/.test(e)));

const unknownProfile = evaluate(req => { req.testProfile = 'contract'; });
helper.check('2s. only unit and integration profiles are accepted', unknownProfile.result === 'FAIL' && unknownProfile.errors.some(e => /unit or integration/.test(e)));

const unitProfile = evaluate(req => {
  req.testProfile = 'unit';
  req.dimensions.determinism = { applicable: false, reason: 'This isolated unit does not cross an integration boundary.' };
});
helper.check('2s. unit evidence may mark integration determinism N/A with a reason', unitProfile.result === 'PASS' && unitProfile.requirements[0].dimensions.determinism.applicable === false);

const weightedUnit = evaluate(req => {
  req.testProfile = 'unit';
  req.dimensions.determinism = { applicable: false, reason: 'This isolated unit does not cross an integration boundary.' };
  req.dimensions.positiveParameters.checks[0].status = 'FAIL';
});
helper.check('2s. unit score renormalizes only the applicable canonical weights', weightedUnit.score === 83.33);

const integrationWithoutRepeat = evaluate(req => {
  req.dimensions.determinism = { applicable: false, reason: 'Not measured.' };
});
helper.check('2s. integration evidence cannot bypass repeated determinism checks', integrationWithoutRepeat.result === 'FAIL' && integrationWithoutRepeat.errors.some(e => /integration.*determinism/.test(e)));
helper.check(
  '2s. report exposes raw counts, percentages, and mandatory gates',
  pass.dimensions.inputCompleteness.passed === 8 &&
    pass.dimensions.inputCompleteness.required === 8 &&
    pass.dimensions.inputCompleteness.percentage === 100 &&
    Object.values(pass.mandatoryGates).every(Boolean)
);

const incompleteInput = evaluate(req => { req.dimensions.inputCompleteness.checks.pop(); });
helper.check('2s. missing an applicable input class is rejected', incompleteInput.result === 'FAIL' && incompleteInput.errors.some(e => /inputCompleteness.*boundary/.test(e)));

const incompleteOutput = evaluate(req => { req.dimensions.outputCompleteness.checks[0].status = 'FAIL'; });
helper.check('2s. incomplete output validation is rejected', incompleteOutput.result === 'FAIL' && incompleteOutput.mandatoryGates.allRequiredInputOutputValidated === false);

const failedUnexpected = evaluate(req => { req.dimensions.unexpectedInput.checks[0].status = 'FAIL'; });
helper.check('2s. failed unexpected-input behavior is rejected', failedUnexpected.result === 'FAIL' && failedUnexpected.dimensions.unexpectedInput.percentage < 100);

const untestedError = evaluate(req => { req.dimensions.errorHandling.checks[0].status = 'SKIPPED'; });
helper.check('2s. untested and skipped error paths are rejected and visible', untestedError.result === 'FAIL' && untestedError.skippedTests.length === 1 && untestedError.mandatoryGates.allDeclaredErrorPathsTested === false);

const nondeterministic = evaluate(req => { req.dimensions.determinism.runs[1].output.value = 3; });
helper.check('2s. unequal repeated integration output is rejected', nondeterministic.result === 'FAIL' && nondeterministic.dimensions.determinism.matchingRuns === 1);

const nonConformant = evaluate(req => { req.sourceConformance = 'NON_CONFORMANT'; });
helper.check('2s. implementation/source mismatches fail', nonConformant.result === 'FAIL' && nonConformant.mandatoryGates.noSourceMismatch === false);

const sourceDefect = evaluate(req => {
  req.sourceValidity = 'SOURCE_DEFECT';
  req.sourceNotes = 'The approved example appears internally wrong.';
  req.sourceEvidence = [{ source: 'docs/example.md', assertion: 'expect(output.value).toEqual(3)', expected: 3, observed: 2 }];
});
helper.check('2s. source defects are reported separately without inventing a mismatch', sourceDefect.result === 'PASS' && sourceDefect.requirements[0].sourceValidity === 'SOURCE_DEFECT');
const sourceDefectNoEvidence = evaluate(req => { req.sourceValidity = 'SOURCE_DEFECT'; req.sourceNotes = 'Appears wrong.'; });
helper.check('2s. source defects without quoted sourceEvidence are rejected', sourceDefectNoEvidence.result === 'FAIL' && sourceDefectNoEvidence.errors.some(e => /sourceEvidence/.test(e)));

const sourceConflictAdr = { type: 'ADR', path: 'docs/adr/001.md', section: 'Contract', status: 'AUTHORITATIVE' };
const conflictFrom = (req, sourceEvidence) => {
  req.sourceValidity = 'SOURCE_CONFLICT';
  req.sourceNotes = 'ADR-1 and SPEC-2 disagree.';
  req.additionalSources = [clone(sourceConflictAdr)];
  if (sourceEvidence !== undefined) req.sourceEvidence = sourceEvidence;
};

const sourceConflict = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', subject: 'list.head', assertion: 'expect(list.head).toEqual(1)', expected: 1, observed: { value: 1, next: null } },
  { source: 'docs/adr/001.md', subject: 'list.head', assertion: 'expect(list.head).toBeInstanceOf(Element)', expected: 'Element', observed: { value: 1, next: null } }
]));
helper.check('2s. unresolved authoritative source conflicts fail', sourceConflict.result === 'FAIL' && sourceConflict.mandatoryGates.noSourceConflict === false && sourceConflict.dimensions.sourceTraceability.traced === 2);
helper.check(
  '2s. properly evidenced two-source conflict is accepted as evidence; only the conflict gate stays closed',
  !sourceConflict.errors.some(e => /sourceEvidence/.test(e)) &&
    Object.entries(sourceConflict.requirements[0].mandatoryGates).filter(([, passed]) => !passed).map(([name]) => name).join() === 'noSourceConflict'
);

const conflictWithoutEvidence = evaluate(req => conflictFrom(req));
helper.check('2s. source conflicts without quoted sourceEvidence are rejected', conflictWithoutEvidence.result === 'FAIL' && conflictWithoutEvidence.errors.some(e => /sourceEvidence/.test(e)));

const nodeVersusValue = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', subject: 'list.head.value', assertion: 'expect(list.head.value).toEqual(1)', expected: 1, observed: { value: 1, next: null } },
  { source: 'docs/example.md', subject: 'list.head.next.value', assertion: 'expect(list.head.next.value).toEqual(2)', expected: 2, observed: { value: 2, next: null } }
]));
helper.check('2s. node-versus-value conflict citing one spec is rejected as a source conflict', nodeVersusValue.result === 'FAIL' && nodeVersusValue.errors.some(e => /two distinct authoritative sources/.test(e)));

const agreeingExpectations = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', subject: 'output.value', assertion: 'expect(output.value).toEqual(1)', expected: 1, observed: 2 },
  { source: 'docs/adr/001.md', subject: 'output.value', assertion: 'expect(output.value).toEqual(1)', expected: 1, observed: 2 }
]));
helper.check('2s. mismatch with agreeing expectations is not a source conflict', agreeingExpectations.result === 'FAIL' && agreeingExpectations.errors.some(e => /disagree across sources/.test(e)));

// Unequal expectations about unrelated targets in two sources are not a conflict.
const unrelatedAssertions = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', subject: 'foo', assertion: 'expect(foo).toEqual(1)', expected: 1, observed: 2 },
  { source: 'docs/adr/001.md', subject: 'bar', assertion: 'expect(bar).toEqual(3)', expected: 3, observed: 4 }
]));
helper.check('2s. unrelated assertions from two sources are rejected as a source conflict', unrelatedAssertions.result === 'FAIL' && unrelatedAssertions.errors.some(e => /same subject/.test(e)));

// The subject must be claimed explicitly and be the target the quote constrains.
const subjectMissing = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', assertion: 'expect(foo).toEqual(1)', expected: 1, observed: 2 },
  { source: 'docs/adr/001.md', assertion: 'expect(bar).toEqual(3)', expected: 3, observed: 2 }
]));
helper.check('2s. source conflict evidence without a subject is rejected', subjectMissing.result === 'FAIL' && subjectMissing.errors.some(e => /subject must name the contract target/.test(e)));
const subjectRelabelled = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', subject: 'foo', assertion: 'expect(foo).toEqual(1)', expected: 1, observed: 2 },
  { source: 'docs/adr/001.md', subject: 'foo', assertion: 'expect(bar).toEqual(3)', expected: 3, observed: 2 }
]));
helper.check('2s. a subject absent from the quoted assertion cannot manufacture a conflict', subjectRelabelled.result === 'FAIL' && subjectRelabelled.errors.some(e => /subject must appear as a whole target/.test(e)));
const nestedTarget = evaluate(req => conflictFrom(req, [
  { source: 'docs/example.md', subject: 'list.head', assertion: 'expect(list.head.value).toEqual(1)', expected: 1, observed: 2 },
  { source: 'docs/adr/001.md', subject: 'list.head', assertion: 'expect(list.head).toBeInstanceOf(Element)', expected: 'Element', observed: 2 }
]));
helper.check('2s. a nested property is not the same subject as its parent', nestedTarget.result === 'FAIL' && nestedTarget.errors.some(e => /subject must appear as a whole target/.test(e)));

const inferred = evaluate(req => { req.source = { type: 'INFERENCE', status: 'INFERRED', inferenceBasis: 'Observed public API and user-approved acceptance criteria.' }; });
helper.check('2s. inferred expectations remain explicit and traceable', inferred.result === 'PASS' && inferred.dimensions.sourceTraceability.percentage === 100);

const badNa = evaluate(req => { req.dimensions.negativeParameters = { applicable: false }; });
helper.check('2s. N/A declarations without a written reason are rejected', badNa.result === 'FAIL' && badNa.errors.some(e => /negativeParameters.*reason/.test(e)));

const goodNa = evaluate(req => { req.dimensions.negativeParameters = { applicable: false, reason: 'This parameterless behavior has no rejected partition.' }; });
helper.check('2s. reasoned N/A stays visible and does not lower applicable scores', goodNa.result === 'PASS' && goodNa.naDeclarations.length === 1);

const normalized = evaluate(req => {
  req.dimensions.determinism.runs[0].output.generatedId = 'a';
  req.dimensions.determinism.runs[1].output.generatedId = 'b';
  req.dimensions.determinism.normalizations = [{ path: 'output.generatedId', rule: 'generated ID may vary', sourceSection: 'docs/example.md#Volatile fields' }];
});
helper.check('2s. explicitly source-backed volatile fields may be normalized', normalized.result === 'PASS');

const malformed = clone(validEvidence());
malformed.requirements = 'not-an-array';
const malformedReport = evaluateEvidence(malformed);
helper.check('2s. malformed evidence fails closed', malformedReport.result === 'FAIL' && malformedReport.errors.length > 0);

const incompleteSideEffects = evaluate(req => { delete req.dimensions.determinism.runs[1].sideEffects.externalCalls; });
helper.check('2s. incomplete deterministic side-effect evidence is rejected', incompleteSideEffects.result === 'FAIL' && incompleteSideEffects.errors.some(e => /externalCalls is required/.test(e)));

const duplicate = clone(validEvidence());
duplicate.requirements.push(clone(duplicate.requirements[0]));
const duplicateReport = evaluateEvidence(duplicate);
helper.check('2s. duplicate requirement IDs are rejected', duplicateReport.result === 'FAIL' && duplicateReport.errors.some(e => /Duplicate requirementId/.test(e)));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tdd-quality-'));
const inputPath = path.join(tmp, 'evidence.json');
const outputPath = path.join(tmp, 'report.json');
fs.writeFileSync(inputPath, JSON.stringify(validEvidence()), 'utf8');
const cli = spawnSync(process.execPath, [path.join(helper.root, 'tdd', 'scripts', 'quality-gate.js'), inputPath, '--output', outputPath], { encoding: 'utf8' });
helper.check('2s. CLI emits per-requirement human scores and structured JSON', cli.status === 0 && /TDD Quality Gate: PASS/.test(cli.stdout) && /REQ-001 \[integration\]: PASS 100%/.test(cli.stdout) && fs.existsSync(outputPath));
const failInputPath = path.join(tmp, 'non-conformant.json');
const failOutputPath = path.join(tmp, 'non-conformant-report.json');
const failEvidence = validEvidence();
failEvidence.requirements[0].sourceConformance = 'NON_CONFORMANT';
fs.writeFileSync(failInputPath, JSON.stringify(failEvidence), 'utf8');
const failedCli = spawnSync(process.execPath, [path.join(helper.root, 'tdd', 'scripts', 'quality-gate.js'), failInputPath, '--output', failOutputPath], { encoding: 'utf8' });
let failedReport = null;
try { failedReport = JSON.parse(fs.readFileSync(failOutputPath, 'utf8')); } catch (e) { /* asserted below */ }
helper.check(
  '2s. CLI returns exit 1 and writes structured JSON for a valid FAIL report',
  failedCli.status === 1 && /TDD Quality Gate: FAIL/.test(failedCli.stdout) && failedReport && failedReport.result === 'FAIL'
);
const malformedPath = path.join(tmp, 'malformed.json');
fs.writeFileSync(malformedPath, '{', 'utf8');
const malformedCli = spawnSync(process.execPath, [path.join(helper.root, 'tdd', 'scripts', 'quality-gate.js'), malformedPath], { encoding: 'utf8' });
helper.check('2s. CLI returns exit 2 for malformed JSON', malformedCli.status === 2 && /TDD Quality Gate: FAIL/.test(malformedCli.stderr));
fs.rmSync(tmp, { recursive: true, force: true });

const shippedFixture = JSON.parse(fs.readFileSync(path.join(helper.root, 'tdd', 'fixtures', 'pass-evidence.json'), 'utf8'));
helper.check('2s. shipped PASS evidence is executable', evaluateEvidence(shippedFixture).result === 'PASS');

helper.finish();

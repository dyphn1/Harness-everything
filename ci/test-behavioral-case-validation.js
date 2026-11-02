'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSimpleYaml } = require('../behavioral-evals/run');
const { grade, parseTranscriptEvents } = require('../behavioral-evals/run');
const { validateCase, validateDirectory, negativeControls } = require('../behavioral-evals/case-validator');
const { canonicalRubric, extractTrace } = require('./ab-test-harness');

const casesDir = path.join(__dirname, '..', 'behavioral-evals', 'cases');
const failures = validateDirectory(casesDir, parseSimpleYaml);
assert.deepStrictEqual(failures, [], failures.map(failure => `${failure.file}: ${failure.errors.join('; ')}`).join('\n'));
assert.strictEqual(negativeControls().length, 0, 'negative controls must be rejected by the validator');
assert.deepStrictEqual(validateCase({
  id: 'tool-call-schema',
  prompt: 'inspect the fixture',
  max_turns: 1,
  fixture: { files: [{ path: 'index.js', content: '' }] },
  expectations: [{ type: 'tool_call', value: 'Bash' }]
}), [], 'tool_call must remain part of the runner/validator schema');

const setupCase = setup => ({
  id: 'fixture-setup-schema',
  prompt: 'inspect the prepared fixture',
  max_turns: 1,
  fixture: {
    files: [{ path: 'README.md', content: 'fixture' }],
    setup,
  },
  expectations: [{ type: 'trace_contains', value: 'fixture' }],
});
assert.deepStrictEqual(
  validateCase(setupCase('behavioral-evals/fixtures/setup/noop.js')),
  [],
  'checked-in repository-relative .js setup should be valid'
);
for (const [setup, expected] of [
  ['../escape.js', /fixture\.setup/],
  ['/tmp/escape.js', /fixture\.setup/],
  ['behavioral-evals/fixtures/setup/noop.txt', /\.js/],
  ['behavioral-evals/fixtures/setup/missing.js', /missing|checked-in/],
  [{ command: 'echo unsafe' }, /fixture\.setup/],
]) {
  const setupErrors = validateCase(setupCase(setup));
  assert.ok(setupErrors.some(error => expected.test(error)), `setup ${JSON.stringify(setup)} should be rejected: ${setupErrors.join('; ')}`);
}

const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-case-validation-'));
try {
  const transcriptPath = path.join(transcriptDir, 'trace.jsonl');
  const events = [
    { type: 'tool_use', part: { type: 'tool', tool: 'Edit', callID: 'edit-1', state: { status: 'completed', input: { file_path: 'slug.js' } } } },
    { type: 'tool_use', part: { type: 'tool', tool: 'Bash', callID: 'test-1', state: { status: 'running', input: { command: 'npm test' } } } },
    { type: 'tool_use', part: { type: 'tool', tool: 'Bash', callID: 'test-1', state: { status: 'completed', input: { command: 'npm test' } } } },
    { type: 'tool_use', part: { type: 'tool', tool: 'Bash', callID: 'denied-1', state: { status: 'denied', input: { command: 'npm install' } } } },
    { type: 'text', part: { type: 'text', text: 'done' } },
  ];
  fs.writeFileSync(transcriptPath, events.map(event => JSON.stringify(event)).join('\n'));
  const parsed = parseTranscriptEvents(transcriptPath);
  assert.strictEqual(parsed.events.filter(event => event.kind === 'tool').length, 3, 'tool lifecycle events should be merged by call id');
  const graded = grade({ expectations: [
    { type: 'tool_executed', value: { command: 'npm test' }, after_edit: true },
    { type: 'tool_denied', value: { command: 'npm install' } },
    { type: 'trace_contains', value: 'done' },
  ] }, transcriptDir, transcriptPath);
  assert.strictEqual(graded.passed, true, 'execution assertions should use ordered agent events');
  const spoofPath = path.join(transcriptDir, 'spoof.json');
  fs.writeFileSync(spoofPath, JSON.stringify({ result: 'I ran npm test after editing.' }));
  assert.strictEqual(grade({ expectations: [{ type: 'tool_executed', value: { command: 'npm test' } }] }, transcriptDir, spoofPath).passed, false, 'final text must not count as tool execution');
  assert.deepStrictEqual(
    canonicalRubric([
      { type: 'trace_contains', value: 'b', description: 'second' },
      { type: 'trace_contains', value: 'a', description: 'first' },
    ]),
    canonicalRubric([
      { type: 'trace_contains', value: 'a', description: 'renamed' },
      { type: 'trace_contains', value: 'b', description: 'also renamed' },
    ]),
    'A/B rubric normalization should ignore descriptions and criterion order'
  );
  assert.match(extractTrace(transcriptPath), /\[Bash\].*npm test/, 'A/B trace extraction should preserve tool event inputs');
} finally {
  fs.rmSync(transcriptDir, { recursive: true, force: true });
}

// Skill-core completion: passing project tests is artifact evidence only; the
// TDD case also requires an executed quality gate command.
const tddCase = parseSimpleYaml(fs.readFileSync(path.join(casesDir, 'baseline-tdd-workflow.yaml'), 'utf8'));
const qualityGate = tddCase.expectations.find(expectation => expectation.type === 'tdd_quality_gate');
assert.ok(qualityGate, 'baseline TDD case must require a passed TDD quality gate');
// The gate is graded by independently re-evaluating retained evidence, so the
// workspace holds a real passing evidence file and a failing variant.
const PASS_EVIDENCE = fs.readFileSync(path.join(__dirname, '..', 'tdd', 'fixtures', 'pass-evidence.json'), 'utf8');
const FAIL_EVIDENCE = (() => {
  const evidence = JSON.parse(PASS_EVIDENCE);
  evidence.requirements = evidence.requirements.map(requirement => ({ ...requirement, sourceConformance: 'FAIL' }));
  return JSON.stringify(evidence);
})();
const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-tdd-quality-gate-'));
try {
  fs.writeFileSync(path.join(gateDir, 'evidence.json'), PASS_EVIDENCE);
  fs.writeFileSync(path.join(gateDir, 'failing-evidence.json'), FAIL_EVIDENCE);
  fs.writeFileSync(path.join(gateDir, 'broken-evidence.json'), '{ not json');
  // A string command defaults to the gate's own success line when it is a
  // quality-gate invocation, so existing positives stay meaningful. An object
  // command states the observed output and exit code explicitly.
  const QUALITY_GATE_COMMAND_RE = /quality-gate\.js|tdd:quality|test:tdd-quality/;
  const gradeCommands = (name, commands) => {
    const transcriptPath = path.join(gateDir, `${name}.jsonl`);
    const events = commands.map((entry, index) => {
      const { command, output, exit } = typeof entry === 'string'
        ? { command: entry, output: QUALITY_GATE_COMMAND_RE.test(entry) ? 'TDD Quality Gate: PASS' : '', exit: undefined }
        : entry;
      const state = { status: 'completed', input: { command } };
      if (output !== undefined) state.output = output;
      if (exit !== undefined) state.metadata = { exit };
      return { type: 'tool_use', part: { type: 'tool', tool: 'Bash', callID: `${name}-${index}`, state } };
    });
    events.push({ type: 'text', part: { type: 'text', text: 'done' } });
    fs.writeFileSync(transcriptPath, events.map(event => JSON.stringify(event)).join('\n'));
    return grade({ expectations: [qualityGate] }, gateDir, transcriptPath);
  };
  const testsOnly = gradeCommands('tests-only', ['npm test']);
  assert.strictEqual(testsOnly.passed, false, 'passing project tests without the quality gate must fail the TDD case');
  assert.strictEqual(testsOnly.results[0].status, 'fail', 'missing quality gate must be a definitive fail, not inconclusive evidence');
  assert.strictEqual(gradeCommands('npm-gate', ['npm test', 'npm run tdd:quality -- evidence.json']).passed, true, 'npm run tdd:quality with evidence must satisfy the gate');
  assert.strictEqual(gradeCommands('node-gate', ['npm test', 'node tdd/scripts/quality-gate.js evidence.json']).passed, true, 'node quality-gate.js with evidence must satisfy the gate');
  assert.strictEqual(gradeCommands('installed-skill-gate', ['npm test', 'node .claude/skills/tdd/scripts/quality-gate.js evidence.json']).passed, true, 'quality gate under the installed skill dir must satisfy the gate');
  assert.strictEqual(gradeCommands('absolute-gate', ['npm test', 'node /tmp/ws/.harness/tdd/scripts/quality-gate.js evidence.json']).passed, true, 'absolute quality-gate path must satisfy the gate');
  for (const [name, commands] of [
    ['echo-mention', ['echo npm run tdd:quality']],
    ['compound-gate', ['npm run tdd:quality -- evidence.json && rm -rf build']],
    ['similar-name', ['npm run tdd:quality-notes']],
  ]) {
    assert.strictEqual(gradeCommands(name, commands).passed, false, `${name} must not count as an executed quality gate`);
  }
  // A completed tool call is not completion evidence: the gate outcome is
  // re-evaluated from the retained evidence, independent of transcript claims.
  const gateFailures = [
    ['nonzero-exit', ['npm test', 'npm run tdd:quality -- failing-evidence.json'], /re-evaluation of failing-evidence\.json is FAIL/],
    ['missing-evidence', ['npm test', 'npm run tdd:quality -- absent.json'], /not retained/],
    ['invalid-evidence', ['npm test', 'node tdd/scripts/quality-gate.js broken-evidence.json'], /not valid JSON/],
    ['no-evidence-arg', ['npm test', 'npm run tdd:quality'], /without an evidence file/],
    ['self-test-alias', ['npm test', 'npm run test:tdd-quality'], /repository self-test/],
    ['escaping-evidence', ['npm test', 'npm run tdd:quality -- ../evidence.json'], /outside the workspace/],
    ['missing-output-report', ['npm test', 'npm run tdd:quality -- evidence.json --output reports/quality.json'], /quality report reports\/quality\.json was not retained/],
    ['last-run-counts', ['npm run tdd:quality -- evidence.json', 'npm run tdd:quality -- failing-evidence.json'], /FAIL/],
  ];
  for (const [name, commands, reason] of gateFailures) {
    const graded = gradeCommands(name, commands);
    assert.strictEqual(graded.passed, false, `${name} must not satisfy the quality gate`);
    assert.strictEqual(graded.results[0].status, 'fail', `${name} must be a definitive fail`);
    assert.match(graded.results[0].reason, reason, `${name} should explain why`);
  }
  // OpenCode reports state.status "completed" even when the gate exits 1.
  const opencodeExit1 = path.join(gateDir, 'opencode-exit1.jsonl');
  fs.writeFileSync(opencodeExit1, [
    { type: 'tool_use', part: { type: 'tool', tool: 'bash', callID: 'gate', state: { status: 'completed', input: { command: 'npm run tdd:quality -- failing-evidence.json' }, output: 'TDD Quality Gate: FAIL\nexit code 1' } } },
    { type: 'text', part: { type: 'text', text: 'Quality gate done.' } },
  ].map(event => JSON.stringify(event)).join('\n'));
  assert.strictEqual(grade({ expectations: [qualityGate] }, gateDir, opencodeExit1).passed, false, 'completed OpenCode event with exit 1 must fail');
  // Fixing evidence and re-running is allowed: the last completed run counts.
  assert.strictEqual(gradeCommands('rerun-after-fix', ['npm run tdd:quality -- failing-evidence.json', 'npm run tdd:quality -- evidence.json']).passed, true, 'a passing re-run after a failing run should satisfy the gate');
  // Observed command outcome: the transcript must show the gate's own success
  // line and no error or non-zero exit before the evidence is trusted.
  const { evaluateEvidence } = require('../tdd/scripts/quality-gate.js');
  const observedGate = 'npm run tdd:quality -- evidence.json';
  const observedFailures = [
    ['failed-command-pass-evidence', { command: observedGate, output: 'npm ERR! Missing script: "tdd:quality"', exit: 1 }, /quality gate command failed/],
    ['nonzero-exit-no-error-text', { command: observedGate, output: 'TDD Quality Gate: PASS', exit: 1 }, /exited with code 1/],
    ['gate-printed-fail-evidence-now-pass', { command: observedGate, output: 'TDD Quality Gate: FAIL' }, /printed TDD Quality Gate: FAIL/],
  ];
  for (const [name, command, reason] of observedFailures) {
    const graded = gradeCommands(name, [command]);
    assert.strictEqual(graded.passed, false, `${name} must not satisfy the quality gate`);
    assert.strictEqual(graded.results[0].status, 'fail', `${name} must be a definitive fail`);
    assert.match(graded.results[0].reason, reason, `${name} should explain why`);
  }
  const unobservable = gradeCommands('unobservable-outcome', [{ command: observedGate, output: '' }]);
  assert.strictEqual(unobservable.results[0].status, 'inconclusive', 'a gate run with no observable output or exit code must be inconclusive');
  assert.strictEqual(unobservable.passed, false, 'an inconclusive gate run must not pass');
  assert.match(unobservable.results[0].reason, /not observable in the transcript/, 'inconclusive reason should say the outcome is not observable');
  // Claude stream-json: is_error on the tool_result is the host's failure
  // signal; the call is recorded as failed, so it never counts as executed.
  const claudeGate = (name, toolResult) => {
    const transcriptPath = path.join(gateDir, `${name}.jsonl`);
    fs.writeFileSync(transcriptPath, [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: observedGate } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bash-1', ...toolResult }] } },
      { type: 'result', subtype: 'success', result: 'done' },
    ].map(event => JSON.stringify(event)).join('\n'));
    return grade({ expectations: [qualityGate] }, gateDir, transcriptPath);
  };
  const claudeError = claudeGate('claude-error', { is_error: true, content: 'npm ERR! Missing script' });
  assert.strictEqual(claudeError.passed, false, 'Claude tool_result with is_error must not satisfy the gate');
  assert.strictEqual(claudeError.results[0].status, 'fail', 'Claude tool_result error must be a definitive fail');
  assert.match(claudeError.results[0].reason, /not executed/, 'Claude errored gate call should not count as executed');
  assert.strictEqual(claudeGate('claude-success', { is_error: false, content: [{ type: 'text', text: 'TDD Quality Gate: PASS' }] }).passed, true, 'Claude tool_result carrying the gate success line should pass');
  // Retained --output report: a full report must be present and must equal the
  // fresh re-evaluation over every top-level key.
  const realReport = evaluateEvidence(JSON.parse(PASS_EVIDENCE));
  assert.strictEqual(realReport.result, 'PASS', 'the pass fixture must re-evaluate to PASS');
  fs.mkdirSync(path.join(gateDir, 'reports'), { recursive: true });
  const reportPath = path.join(gateDir, 'reports', 'quality.json');
  fs.writeFileSync(reportPath, JSON.stringify({ result: 'PASS' }));
  const markerOnly = gradeCommands('marker-output-report', ['npm run tdd:quality -- evidence.json --output reports/quality.json']);
  assert.strictEqual(markerOnly.passed, false, 'a {"result":"PASS"} marker must not satisfy a retained report');
  assert.match(markerOnly.results[0].reason, /missing required keys: .*requirements/, 'a marker-only retained report should name the missing keys');
  fs.writeFileSync(reportPath, JSON.stringify(realReport, null, 2));
  assert.strictEqual(gradeCommands('retained-output-report', ['npm run tdd:quality -- evidence.json --output reports/quality.json']).passed, true, 'retained --output report equal to the re-evaluation should pass');
  fs.writeFileSync(reportPath, JSON.stringify({ ...realReport, score: realReport.score - 1 }, null, 2));
  const staleScore = gradeCommands('stale-output-report', ['npm run tdd:quality -- evidence.json --output reports/quality.json']);
  assert.strictEqual(staleScore.passed, false, 'a retained report with a stale score must fail');
  assert.match(staleScore.results[0].reason, /differs from re-evaluation at "score"/, 'a stale retained report should name the differing key');
} finally {
  fs.rmSync(gateDir, { recursive: true, force: true });
}

console.log(`Behavioral case validation passed (${fs.readdirSync(casesDir).filter(name => name.endsWith('.yaml')).length} cases + negative controls + ordered execution evidence).`);

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSimpleYaml } = require('../behavioral-evals/run');
const { grade, parseTranscriptEvents, checkJsonOnlyOutput } = require('../behavioral-evals/run');
const { validateCase, validateDirectory, validateExpectation, negativeControls } = require('../behavioral-evals/case-validator');
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

// final_output_json_only: pure checker, validator schema, shipped #308 case, and
// end-to-end grading over the final assistant message.
const SELECTION_KEYS = ['requestedProfile', 'effectiveProfile', 'profileAlias', 'assignedRole', 'runtimeModel', 'runtimeEffort'];
const SELECTION = { requestedProfile: 'fable', effectiveProfile: 'sonnet', profileAlias: 'fable-on-sonnet', assignedRole: 'worker', runtimeModel: 'claude-haiku-5-5', runtimeEffort: 'low' };
const LABEL = '<!-- harness-label {"judgement":"done","routing":"direct"} -->';
const RAW = JSON.stringify(SELECTION);
const FENCED = '```json\n' + JSON.stringify(SELECTION, null, 2) + '\n```';
const PASS_CASES = [
  ['raw JSON object', RAW],
  ['fenced json block', FENCED],
  ['untagged fence', '```\n' + RAW + '\n```'],
  ['raw JSON followed by harness-label line', RAW + '\n' + LABEL],
  ['fenced JSON followed by harness-label line', FENCED + '\n' + LABEL],
];
for (const [name, text] of PASS_CASES) {
  const verdict = checkJsonOnlyOutput(text, SELECTION_KEYS);
  assert.strictEqual(verdict.pass, true, `${name} should pass: ${verdict.reason}`);
}
const FAIL_CASES = [
  // The #308 pilot: correct fields, explanatory prose outside the JSON.
  ['prose before JSON (#308)', `"Fable on sonnect" means the fable profile runs on sonnet.\n\n${FENCED}`, /prose before/],
  ['prose after fence', `${FENCED}\nThat is the selection record.`, /outside the single JSON code fence/],
  ['prose after raw JSON', `${RAW}\nThat is the selection record.`, /not a single valid JSON value/],
  ['two fenced blocks', `${FENCED}\n${FENCED}`, /more than one code fence/],
  ['missing required key', JSON.stringify({ ...SELECTION, runtimeEffort: undefined }), /missing required JSON keys: runtimeEffort/],
  ['non-object JSON (array)', JSON.stringify([SELECTION]), /must be an object/],
  ['non-object JSON (scalar)', '"fable"', /must be an object/],
  ['empty final text', '', /empty/],
  ['label-only final text', LABEL, /empty/],
  ['missing final text', undefined, /missing/],
];
for (const [name, text, expected] of FAIL_CASES) {
  const verdict = checkJsonOnlyOutput(text, SELECTION_KEYS);
  assert.strictEqual(verdict.pass, false, `${name} should fail`);
  assert.match(verdict.reason, expected, `${name} should give a clear reason`);
}
assert.strictEqual(checkJsonOnlyOutput(RAW).pass, true, 'required_keys defaults to no key requirement');

for (const requiredKeys of ['requestedProfile', [''], ['  '], [1], ['ok', null]]) {
  const errors = validateExpectation({ type: 'final_output_json_only', required_keys: requiredKeys }, 0);
  assert.ok(errors.some(error => /required_keys must be an array of non-empty strings/.test(error)), `required_keys ${JSON.stringify(requiredKeys)} should be rejected`);
}
assert.deepStrictEqual(validateExpectation({ type: 'final_output_json_only' }, 0), [], 'final_output_json_only without required_keys is valid');
assert.deepStrictEqual(validateExpectation({ type: 'final_output_json_only', required_keys: SELECTION_KEYS }, 0), [], 'final_output_json_only with string keys is valid');

const profileCasePath = path.join(casesDir, 'baseline-profile-lookup-json-only.yaml');
const profileCase = parseSimpleYaml(fs.readFileSync(profileCasePath, 'utf8'));
assert.deepStrictEqual(validateCase(profileCase, { fileName: 'baseline-profile-lookup-json-only.yaml' }), [], 'profile-lookup JSON-only case should validate');
assert.deepStrictEqual(profileCase.expectations.map(expectation => expectation.type), ['final_output_json_only'], 'profile-lookup case should assert JSON-only output');
assert.deepStrictEqual(profileCase.expectations[0].required_keys, SELECTION_KEYS, 'profile-lookup case should require the six selection keys');
assert.match(profileCase.prompt, /return only a small JSON selection record with requestedProfile, effectiveProfile, profileAlias, assignedRole, runtimeModel, runtimeEffort\. No orchestration or delegation\./, 'profile-lookup prompt should match the #308 wording');

const jsonOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-json-only-'));
try {
  const writeTranscript = (name, finalText) => {
    const transcriptPath = path.join(jsonOnlyDir, name);
    const events = [
      { type: 'tool_use', part: { type: 'tool', tool: 'Read', callID: 'read-1', state: { status: 'completed', input: { file_path: 'README.md' } } } },
      { type: 'text', part: { type: 'text', text: 'Checking the profile table first.' } },
      { type: 'tool_use', part: { type: 'tool', tool: 'Read', callID: 'read-2', state: { status: 'completed', input: { file_path: 'profiles.md' } } } },
      { type: 'text', part: { type: 'text', text: finalText } },
    ];
    fs.writeFileSync(transcriptPath, events.map(event => JSON.stringify(event)).join('\n'));
    return transcriptPath;
  };
  const jsonOnlyExpectation = { expectations: [{ type: 'final_output_json_only', required_keys: SELECTION_KEYS }] };
  let transcriptCount = 0;
  const gradeFinal = finalText => grade(jsonOnlyExpectation, jsonOnlyDir, writeTranscript(`final-${transcriptCount++}.jsonl`, finalText));
  assert.strictEqual(gradeFinal(RAW).passed, true, 'raw JSON final message should pass end to end');
  assert.strictEqual(gradeFinal(`${FENCED}\n${LABEL}`).passed, true, 'fenced JSON with harness-label should pass end to end');
  const prose = gradeFinal(`Fable on sonnect means a profile.\n${FENCED}`);
  assert.strictEqual(prose.passed, false, 'prose before JSON must fail end to end');
  assert.strictEqual(prose.results[0].status, 'fail');
  assert.match(prose.results[0].reason, /prose before/);
  // Prose from an earlier turn (before the last tool call) is not the final message.
  const earlierProse = writeTranscript('earlier-prose.jsonl', RAW);
  assert.strictEqual(grade(jsonOnlyExpectation, jsonOnlyDir, earlierProse).passed, true, 'only the final assistant message is graded');

  // Multi-part final messages: the final turn may stream several text parts.
  const writeParts = (name, finalParts) => {
    const transcriptPath = path.join(jsonOnlyDir, name);
    const events = [
      { type: 'tool_use', part: { type: 'tool', tool: 'Read', callID: 'read-1', state: { status: 'completed', input: { file_path: 'profiles.md' } } } },
      ...finalParts.map(text => ({ type: 'text', part: { type: 'text', text } })),
    ];
    fs.writeFileSync(transcriptPath, events.map(event => JSON.stringify(event)).join('\n'));
    return transcriptPath;
  };
  const proseThenJson = grade(jsonOnlyExpectation, jsonOnlyDir, writeParts('prose-part-json-part.jsonl', ['"Fable on sonnect" means the fable profile on sonnet.', FENCED]));
  assert.strictEqual(proseThenJson.passed, false, 'prose part + JSON part must fail (#308 false pass)');
  assert.match(proseThenJson.results[0].reason, /prose before/);
  const jsonThenProse = grade(jsonOnlyExpectation, jsonOnlyDir, writeParts('json-part-prose-part.jsonl', [FENCED, 'That is the selection record.']));
  assert.strictEqual(jsonThenProse.passed, false, 'JSON part + prose part must fail');
  const splitBody = JSON.stringify(SELECTION, null, 2);
  const cut = splitBody.indexOf('"assignedRole"');
  const splitJson = grade(jsonOnlyExpectation, jsonOnlyDir, writeParts('split-json.jsonl', ['```json\n' + splitBody.slice(0, cut), splitBody.slice(cut) + '\n```']));
  assert.strictEqual(splitJson.passed, true, `JSON split across text parts should pass: ${splitJson.results[0].reason}`);

  // Claude stream-json: assistant content parts plus a terminal `result` that
  // repeats them. The repeat must not be double-counted, and must not mask prose.
  const writeClaude = (name, contentTexts, resultText) => {
    const transcriptPath = path.join(jsonOnlyDir, name);
    const lines = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'profiles.md' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] } },
      { type: 'assistant', message: { content: contentTexts.map(text => ({ type: 'text', text })) } },
      { type: 'result', subtype: 'success', result: resultText },
    ];
    fs.writeFileSync(transcriptPath, lines.map(line => JSON.stringify(line)).join('\n'));
    return transcriptPath;
  };
  assert.strictEqual(grade(jsonOnlyExpectation, jsonOnlyDir, writeClaude('claude-result-repeat.jsonl', [FENCED], FENCED)).passed, true, 'Claude result repeat must not double the JSON');
  assert.strictEqual(grade(jsonOnlyExpectation, jsonOnlyDir, writeClaude('claude-prose-parts.jsonl', ['Here is the record.', FENCED], FENCED)).passed, false, 'Claude prose content part must fail even when result holds only JSON');
} finally {
  fs.rmSync(jsonOnlyDir, { recursive: true, force: true });
}

console.log(`Behavioral case validation passed (${fs.readdirSync(casesDir).filter(name => name.endsWith('.yaml')).length} cases + negative controls + ordered execution evidence + json-only final output).`);

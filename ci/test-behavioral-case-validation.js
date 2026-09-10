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

console.log(`Behavioral case validation passed (${fs.readdirSync(casesDir).filter(name => name.endsWith('.yaml')).length} cases + negative controls + ordered execution evidence).`);

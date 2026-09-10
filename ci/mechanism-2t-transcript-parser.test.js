const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('./test-helper');
const {
  parseTranscript,
  parseTranscriptFile,
  gradeExecutionEvidence,
} = require('../behavioral-evals/transcript-parser');
const {
  grade,
  extractAgentTrace,
  parseTranscriptEvents,
  pairVerdict,
  summarizePairResults,
} = require('../behavioral-evals/run');

const fixtures = path.join(__dirname, '..', 'behavioral-evals', 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('\n[2t] Structured behavioral transcript parser...');

const claude = parseTranscript(readFixture('claude-success.jsonl'), 'claude');
helper.check('2t. Claude stream is parsed', claude.parseStatus === 'parsed' && claude.format === 'claude-stream-json', JSON.stringify(claude));
helper.check('2t. Claude trace keeps assistant text and tool input', claude.trace.includes('I will run the check.') && claude.trace.includes('[Bash]') && claude.trace.includes('npm test'), claude.trace);
helper.check('2t. Claude trace excludes tool output', !claude.trace.includes('zoom-out/SKILL.md') && !claude.trace.includes('all tests passed'), claude.trace);
helper.check('2t. Claude preserves result metadata', claude.metadata.cost === 0.0042 && claude.metadata.usage.input_tokens === 100 && claude.metadata.num_turns === 2, JSON.stringify(claude.metadata));
helper.check('2t. Claude correlates completed tool evidence', claude.executionEvidence.counts.attempted === 1 && claude.executionEvidence.counts.completed === 1 && claude.executionEvidence.counts.denied === 0, JSON.stringify(claude.executionEvidence));

const denied = parseTranscript(readFixture('claude-denied.jsonl'), 'claude');
helper.check('2t. Permission denial is evidence', denied.executionEvidence.counts.attempted === 1 && denied.executionEvidence.counts.denied === 1 && denied.executionEvidence.counts.completed === 0, JSON.stringify(denied.executionEvidence));
helper.check('2t. Denial grader passes only denied evidence', gradeExecutionEvidence({ type: 'tool_denied', value: 'Bash' }, denied).status === 'pass', JSON.stringify(gradeExecutionEvidence({ type: 'tool_denied', value: 'Bash' }, denied)));

const oral = parseTranscript(readFixture('claude-oral-only.jsonl'), 'claude');
helper.check('2t. Oral command mention has no attempted tool', oral.executionEvidence.counts.attempted === 0 && oral.executionEvidence.counts.completed === 0, JSON.stringify(oral.executionEvidence));
const oralTraceGrade = grade({
  expectations: [{ type: 'trace_contains', value: 'npm test' }],
}, path.join(fixtures, 'unused-workspace'), path.join(fixtures, 'claude-oral-only.jsonl'), 'claude');
helper.check('2t. Oral command prose cannot satisfy trace execution evidence', oralTraceGrade.status === 'inconclusive' && !oralTraceGrade.passed, JSON.stringify(oralTraceGrade));

const opencode = parseTranscript(readFixture('opencode-success.jsonl'), 'opencode');
helper.check('2t. Existing opencode JSONL remains supported', opencode.parseStatus === 'parsed' && opencode.format === 'opencode-jsonl', JSON.stringify(opencode));
helper.check('2t. Duplicate opencode tool events are one call', opencode.executionEvidence.counts.attempted === 1 && opencode.executionEvidence.counts.completed === 1, JSON.stringify(opencode.executionEvidence));
helper.check('2t. Opencode tool output never enters trace', !opencode.trace.includes('zoom-out/SKILL.md'), opencode.trace);

const duplicateExplicit = parseTranscript([
  JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'npm test' } },
    { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'npm test' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
  ] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
helper.check('2t. Explicit IDs coalesce only by their ID', duplicateExplicit.executionEvidence.counts.attempted === 2, JSON.stringify(duplicateExplicit.executionEvidence));

const resultBeforeCall = parseTranscript([
  JSON.stringify({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'late-call', content: 'done', is_error: false },
  ] } }),
  JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'late-call', name: 'Bash', input: { command: 'npm test' } },
  ] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
helper.check('2t. Out-of-order result and call events coalesce by ID', resultBeforeCall.executionEvidence.counts.attempted === 1 && resultBeforeCall.executionEvidence.counts.completed === 1, JSON.stringify(resultBeforeCall.executionEvidence));

const completedWithDenialPhrase = parseTranscript([
  JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'call-output', name: 'Bash', input: { command: 'cat report.txt' } },
  ] } }),
  JSON.stringify({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'call-output', content: 'command output: Permission denied', is_error: false },
  ] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
helper.check('2t. Output text cannot masquerade as permission denial', completedWithDenialPhrase.executionEvidence.counts.completed === 1 && completedWithDenialPhrase.executionEvidence.counts.denied === 0, JSON.stringify(completedWithDenialPhrase.executionEvidence));

const truncated = parseTranscript(readFixture('claude-truncated.jsonl').replace(/\n/g, '\r\n'), 'claude');
helper.check('2t. Truncated CRLF stream is inconclusive', truncated.parseStatus === 'partial' && truncated.parseError, JSON.stringify(truncated));
helper.check('2t. Partial execution evidence is inconclusive', gradeExecutionEvidence({ type: 'tool_completed', value: 'Bash' }, truncated).status === 'inconclusive', JSON.stringify(gradeExecutionEvidence({ type: 'tool_completed', value: 'Bash' }, truncated)));

const legacy = parseTranscriptFile(path.join(fixtures, 'claude-legacy.json'), 'claude');
helper.check('2t. Legacy JSON keeps readable final text', legacy.trace === 'Legacy final response', legacy.trace);
helper.check('2t. Legacy JSON does not claim tool visibility', legacy.executionEvidence.visibility === 'unavailable' && legacy.executionEvidence.counts.attempted === null, JSON.stringify(legacy.executionEvidence));
helper.check('2t. Unavailable evidence is inconclusive', gradeExecutionEvidence({ type: 'tool_completed', value: 'Bash' }, legacy).status === 'inconclusive', JSON.stringify(gradeExecutionEvidence({ type: 'tool_completed', value: 'Bash' }, legacy)));
helper.check('2t. Auto detection preserves legacy JSON', parseTranscriptFile(path.join(fixtures, 'claude-legacy.json')).format === 'claude-json', parseTranscriptFile(path.join(fixtures, 'claude-legacy.json')).format);

const legacyTraceGrade = grade({
  expectations: [{ type: 'trace_contains', value: 'Legacy final response' }],
}, path.join(fixtures, 'unused-workspace'), path.join(fixtures, 'claude-legacy.json'), 'claude');
helper.check('2t. Legacy final prose cannot produce a definitive trace grade', legacyTraceGrade.status === 'inconclusive' && !legacyTraceGrade.passed, JSON.stringify(legacyTraceGrade));

const userText = parseTranscript([
  JSON.stringify({ type: 'system', subtype: 'init' }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'tool output mentions npm test and zoom-out/SKILL.md' }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
helper.check('2t. Claude user-event text is not agent trace', !userText.trace.includes('tool output mentions npm test'), userText.trace);

const npmInstall = parseTranscript([
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'npm-install', name: 'Bash', input: { command: 'npm install' } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'npm-install', content: 'installed', is_error: false }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
for (const expectation of [
  { type: 'tool_executed', command: 'npm test' },
  { type: 'tool_executed', command: 'rm -rf /' },
  { type: 'tool_executed', tool: 'npm test' },
]) {
  const result = gradeExecutionEvidence(expectation, npmInstall);
  helper.check(`2t. ${JSON.stringify(expectation)} does not match another completed command`, !result.pass, JSON.stringify(result));
}

const npmCoverage = parseTranscript([
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'npm-coverage', name: 'Bash', input: { command: 'npm test --coverage' } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'npm-coverage', content: 'passed', is_error: false }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
helper.check('2t. Command targets reject extra arguments', !gradeExecutionEvidence({ type: 'tool_executed', command: 'npm test' }, npmCoverage).pass, JSON.stringify(gradeExecutionEvidence({ type: 'tool_executed', command: 'npm test' }, npmCoverage)));

const generic = parseTranscript([
  JSON.stringify({ type: 'tool_call', id: 'patch-1', name: 'apply_patch', input: { file_path: 'changes.patch' } }),
  JSON.stringify({ type: 'tool_result', tool_use_id: 'patch-1', is_error: false, content: 'patched' }),
  JSON.stringify({ type: 'tool_call', id: 'test-1', name: 'Bash', input: { command: 'npm test' } }),
  JSON.stringify({ type: 'tool_result', tool_use_id: 'test-1', is_error: false, content: 'passed' }),
  JSON.stringify({ type: 'text', text: 'finished' }),
].join('\n'), 'auto');
helper.check(
  '2t. top-level tool calls and results remain structured evidence',
  generic.parseStatus === 'parsed' && generic.executionEvidence.counts.completed === 2,
  JSON.stringify(generic)
);
helper.check(
  '2t. structured trace preserves tool-before-text event order',
  generic.trace.indexOf('[apply_patch]') < generic.trace.indexOf('[Bash]') && generic.trace.indexOf('[Bash]') < generic.trace.indexOf('finished'),
  generic.trace
);

const orderedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-parser-order-'));
const orderedTranscript = path.join(orderedDir, 'trace.jsonl');
fs.writeFileSync(orderedTranscript, [
  { type: 'tool_call', id: 'patch-file', name: 'tool', input: { file_path: 'changes.patch' }, status: 'completed' },
  { type: 'tool_call', id: 'run-test', name: 'Bash', input: { command: 'npm test' }, status: 'completed' },
  { type: 'text', text: 'finished' },
].map(event => JSON.stringify(event)).join('\n'));
const orderedEvents = parseTranscriptEvents(orderedTranscript);
const orderedTrace = extractAgentTrace(orderedTranscript);
helper.check('2t. bare patch filenames count as edits for after_edit grading', orderedEvents.events[0] && orderedEvents.events[0].edit === true, JSON.stringify(orderedEvents.events));
helper.check('2t. runner trace keeps bare patch, bash, then final text order', orderedTrace.indexOf('[tool]') < orderedTrace.indexOf('[Bash]') && orderedTrace.indexOf('[Bash]') < orderedTrace.indexOf('finished'), orderedTrace);
fs.rmSync(orderedDir, { recursive: true, force: true });

const todoPending = parseTranscript([
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'todo-pending', name: 'TodoWrite', input: { todos: [{ status: 'pending', content: 'wait' }] } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'todo-pending', content: 'saved', is_error: false }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'Done' }),
].join('\n'), 'claude');
const todoExpectation = { type: 'tool_completed', name: 'TodoWrite', input_contains: 'in_progress' };
helper.check('2t. Tool input qualifiers do not match unrelated TodoWrite state', !gradeExecutionEvidence(todoExpectation, todoPending).pass, JSON.stringify(gradeExecutionEvidence(todoExpectation, todoPending)));

const caseDir = path.join(__dirname, '..', 'behavioral-evals', 'cases');
const staleGuidance = fs.readdirSync(caseDir)
  .filter(file => file.endsWith('.yaml'))
  .filter(file => /#52|trace only captures|final message only/i.test(fs.readFileSync(path.join(caseDir, file), 'utf8')));
helper.check('2t. Behavioral cases do not retain the obsolete #52 trace limitation', staleGuidance.length === 0, staleGuidance.join(', '));

helper.check('2t. Non-definitive arm cannot produce effectiveness', pairVerdict({ outcome: 'inconclusive' }, { outcome: 'pass' }) === 'INCONCLUSIVE', pairVerdict({ outcome: 'inconclusive' }, { outcome: 'pass' }));
helper.check('2t. Session errors cannot produce effectiveness', pairVerdict({ outcome: 'session-error' }, { outcome: 'pass' }) === 'INCONCLUSIVE', pairVerdict({ outcome: 'session-error' }, { outcome: 'pass' }));
const pairSummary = summarizePairResults([
  { id: 'uncertain', verdict: 'INCONCLUSIVE', arms: { baseline: { outcome: 'inconclusive' }, treatment: { outcome: 'pass' } } },
  { id: 'effective', verdict: 'EFFECTIVE', arms: { baseline: { outcome: 'fail', tool_call_count: 0 }, treatment: { outcome: 'pass', tool_call_count: 1 } } },
]);
helper.check('2t. Inconclusive pairs are excluded from effectiveness aggregates', pairSummary.completed_pairs === 1 && pairSummary.session_failures === 0 && pairSummary.verdicts.INCONCLUSIVE === 0 && pairSummary.verdicts.EFFECTIVE === 1, JSON.stringify(pairSummary));
helper.check('2t. Missing tool counts preserve a null delta', summarizePairResults([
  { id: 'unknown-count', verdict: 'EFFECTIVE', arms: { baseline: { outcome: 'fail', tool_call_count: null }, treatment: { outcome: 'pass', tool_call_count: 1 } } },
]).tool_call_delta[0].treatment_minus_baseline === null, JSON.stringify(summarizePairResults([
  { id: 'unknown-count', verdict: 'EFFECTIVE', arms: { baseline: { outcome: 'fail', tool_call_count: null }, treatment: { outcome: 'pass', tool_call_count: 1 } } },
])));

helper.finish();

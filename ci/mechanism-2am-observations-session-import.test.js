#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = path.join(ROOT, 'scripts', 'system-one-observations-import-codex-sessions.js');
const EXPORTER = path.join(ROOT, 'scripts', 'system-one-observations-export.js');
const REVIEW = path.join(ROOT, 'scripts', 'system-one-observations-review.js');
const obs = require('../hooks/scripts/lib/observations');
const LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix"],"workflow":null,"skills":[]} -->';
const TIER1_LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier1","intents":["fix"],"workflow":null,"skills":[]} -->';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-session-label-import-'));
const sessions = path.join(root, 'sessions');
const store = path.join(root, 'observations');
fs.mkdirSync(path.join(sessions, '2026', '10'), { recursive: true });
const rollout = path.join(sessions, '2026', '10', 'rollout-fixture.jsonl');

const rows = [
  { type: 'session_meta', payload: { session_id: 'fixture-session' } },
  { type: 'event_msg', timestamp: '2026-09-26T23:59:59.000Z', payload: { type: 'task_started', turn_id: 'old', started_at: '2026-09-26T23:59:59.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'pre-revision prompt' }] } },
  { type: 'event_msg', timestamp: '2026-09-26T23:59:59.500Z', payload: { type: 'task_complete', turn_id: 'old', last_agent_message: LABEL } },
  { type: 'event_msg', timestamp: '2026-09-27T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'included', started_at: '2026-09-27T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [
    { type: 'input_text', text: 'Please fix the parser. Contact user@example.com.' },
    { type: 'input_text', text: 'injected host context must stay out of the prompt row' }
  ] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'later context message' }] } },
  { type: 'event_msg', timestamp: '2026-09-27T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'included', last_agent_message: 'Done.\n' + LABEL } },
  { type: 'event_msg', timestamp: '2026-09-30T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'assistant-fallback', started_at: '2026-09-30T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fallback prompt from the rollout message' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Completed answer.\n' + LABEL }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'assistant-fallback' } },
  { type: 'event_msg', timestamp: '2026-09-30T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'explicit-unlabeled-final', started_at: '2026-09-30T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'an earlier assistant message had a label' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Earlier answer.\n' + TIER1_LABEL }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'explicit-unlabeled-final', last_agent_message: 'This is the explicit final reply without a label.' } },
  { type: 'event_msg', timestamp: '2026-09-30T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'unobserved-write', started_at: '2026-09-30T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'write a small parser change' }] } },
  { type: 'response_item', payload: { type: 'function_call', name: 'apply_patch', arguments: '*** Begin Patch\n*** Add File: parser.js\n+module.exports = true;\n*** End Patch' } },
  { type: 'event_msg', timestamp: '2026-09-30T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'unobserved-write', last_agent_message: TIER1_LABEL } },
  { type: 'event_msg', timestamp: '2026-09-30T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'not-final-assistant', started_at: '2026-09-30T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do not use an earlier assistant message label' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: LABEL }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A later assistant message replaced this one.' }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'not-final-assistant', last_agent_message: 'No label in the final assistant message.' } },
  { type: 'event_msg', timestamp: '2026-09-28T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'missing-prompt', started_at: '2026-09-28T00:00:00.000Z' } },
  { type: 'event_msg', timestamp: '2026-09-28T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'missing-prompt', last_agent_message: LABEL } },
  { type: 'event_msg', timestamp: '2026-09-29T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'invalid-label', started_at: '2026-09-29T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'malformed label prompt' }] } },
  { type: 'event_msg', timestamp: '2026-09-29T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'invalid-label', last_agent_message: '<!-- harness-label {bad json} -->' } },
  { type: 'event_msg', timestamp: '2026-09-30T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'ambiguous-summary', started_at: '2026-09-30T00:00:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'resolve conflicting final representations' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Actual final answer.\n' + LABEL }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'ambiguous-summary', last_agent_message: 'The completion summary omitted the final response text.' } },
  { type: 'event_msg', timestamp: '2026-09-30T00:02:00.000Z', payload: { type: 'task_started', turn_id: 'after-ambiguous', started_at: '2026-09-30T00:02:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue after ambiguous final representations' }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:03:00.000Z', payload: { type: 'task_complete', turn_id: 'after-ambiguous', last_agent_message: 'Follow-up answer.\n' + LABEL } },
  { type: 'event_msg', timestamp: '2026-09-30T00:04:00.000Z', payload: { type: 'task_started', turn_id: 'equivalent-body', started_at: '2026-09-30T00:04:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'recover an equivalent assistant body' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Equivalent final answer.\n' + LABEL }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:05:00.000Z', payload: { type: 'task_complete', turn_id: 'equivalent-body', last_agent_message: 'Equivalent final answer.' } },
  { type: 'event_msg', timestamp: '2026-09-30T00:06:00.000Z', payload: { type: 'task_started', turn_id: 'nonstring-completion', started_at: '2026-09-30T00:06:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fallback from non-string completion' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Non-string fallback answer.\n' + LABEL }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:07:00.000Z', payload: { type: 'task_complete', turn_id: 'nonstring-completion', last_agent_message: null } },
  { type: 'event_msg', timestamp: '2026-09-30T00:08:00.000Z', payload: { type: 'task_started', turn_id: 'invalid-with-assistant-label', started_at: '2026-09-30T00:08:00.000Z' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'reject malformed completion despite assistant label' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'A different assistant body.\n' + LABEL }] } },
  { type: 'event_msg', timestamp: '2026-09-30T00:09:00.000Z', payload: { type: 'task_complete', turn_id: 'invalid-with-assistant-label', last_agent_message: '<!-- harness-label {bad json} -->' } },
];
fs.writeFileSync(rollout, rows.map(row => JSON.stringify(row)).join('\n') + '\n');

function runImport(targetStore = store) {
  return spawnSync(process.execPath, [IMPORTER, '--sessions', sessions, '--store', targetStore, '--since', '2026-09-27'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

try {
  const hookEnv = { HARNESS_OBSERVATIONS: 'on', HARNESS_OBSERVATIONS_DIR: store };
  obs.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'fixture-session', turn_id: 'included',
    prompt: 'Please fix the parser. Contact user@example.com.', cwd: root }, hookEnv);
  obs.handle({ hook_event_name: 'PostToolUse', session_id: 'fixture-session', turn_id: 'included', cwd: root,
    tool_name: 'apply_patch', tool_input: { patch: '*** Begin Patch\n*** Add File: parser.js\n+module.exports = true;\n*** End Patch' } }, hookEnv);
  obs.handle({ hook_event_name: 'Stop', session_id: 'fixture-session', turn_id: 'included', last_agent_message: TIER1_LABEL }, hookEnv);

  const first = runImport();
  assert.strictEqual(first.status, 0, 'session import failed:\n' + first.stdout + '\n' + first.stderr);
  const report = JSON.parse(first.stdout);
  assert.strictEqual(report.imported, 5);
  assert.strictEqual(report.skipped.beforeCutoff, 1);
  assert.strictEqual(report.skipped.missingPrompt, 1);
  assert.strictEqual(report.skipped.missingLabel, 2, 'an explicit unlabeled completion remains a missing-label skip when the labeled assistant item was commentary');
  assert.strictEqual(report.skipped.ambiguousFinalMessage, 1, 'conflicting final representations with a labeled final assistant item are reported as ambiguous');
  assert.strictEqual(report.skipped.invalidLabel, 2, 'an invalid completion label remains invalid even when an assistant item has a valid label');
  assert.strictEqual(report.skipped.duplicate, 1, 'backfill skips a turn already captured by live Codex hooks');
  assert.strictEqual(report.skipped.ambiguousLiveMatch, 0);

  const index = JSON.parse(fs.readFileSync(path.join(store, 'observations-index.json'), 'utf8'));
  assert.strictEqual(index.records.length, 6);
  const liveRecord = index.records.find(entry => entry.writer && entry.writer.turnId === 'included');
  assert(liveRecord, 'live records retain Codex turn IDs for cross-source dedupe');
  assert.strictEqual(liveRecord.behavior.filesWritten, 1, 'the live fixture contains an observed file write');
  assert.deepStrictEqual(obs.contradictions(liveRecord.selfReport, liveRecord.behavior), ['tier1-with-writes']);
  assert.strictEqual(index.records.filter(entry => entry.writer && entry.writer.sessionId === 'fixture-session' && entry.writer.turnId === 'included').length, 1,
    'live capture and session backfill leave one record for a turn');

  const fallbackRecord = index.records.find(entry => entry.captureMethod === 'session-backfill' && entry.turn === 3);
  assert(fallbackRecord, 'the response_item assistant label is recovered when task_complete omits it');
  const fallbackText = JSON.parse(fs.readFileSync(path.join(store, 'text', fallbackRecord.contentSha256 + '.json'), 'utf8'));
  assert.strictEqual(fallbackText.prompt, 'fallback prompt from the rollout message');
  const backfilledTier1 = index.records.find(entry => entry.captureMethod === 'session-backfill' && entry.selfReport.tier === 'tier1');
  assert(backfilledTier1, 'the tier1 label from the rollout is imported');
  assert.strictEqual(backfilledTier1.behavior, null, 'session backfill records behavior as unobserved rather than zero');
  assert(!index.records.some(entry => entry.writer && entry.writer.turnId === 'ambiguous-summary'),
    'a differing completion string must not inherit the assistant message label');
  const afterAmbiguous = index.records.find(entry => entry.writer && entry.writer.turnId === 'after-ambiguous');
  assert(afterAmbiguous, 'the turn after an ambiguous final can still be imported');
  const afterAmbiguousText = JSON.parse(fs.readFileSync(path.join(store, 'text', afterAmbiguous.contentSha256 + '.json'), 'utf8'));
  assert.strictEqual(afterAmbiguousText.previous, '', 'an unresolved final disagreement must not seed later previous-message context');
  assert(index.records.some(entry => entry.writer && entry.writer.turnId === 'equivalent-body'),
    'a completion string matching the assistant body after label removal safely recovers its label');
  assert(index.records.some(entry => entry.writer && entry.writer.turnId === 'nonstring-completion'),
    'a non-string task_complete field falls back to the final assistant label');
  assert(!index.records.some(entry => entry.writer && entry.writer.turnId === 'invalid-with-assistant-label'),
    'a valid assistant label never replaces an invalid completion label');

  const exportDir = path.join(root, 'export');
  const exported = spawnSync(process.execPath, [EXPORTER, '--store', store, '--out', exportDir, '--self-report-only'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(exported.status, 0, 'export after backfill failed:\n' + exported.stdout + '\n' + exported.stderr);
  const labels = fs.readFileSync(path.join(exportDir, 'labels-observed.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const exportReport = JSON.parse(fs.readFileSync(path.join(exportDir, 'export-report.json'), 'utf8'));
  assert.strictEqual(labels.filter(label => label.behaviorEvidence === 'unobserved').length, 5);
  assert.deepStrictEqual(exportReport.behaviorEvidence, { observed: 1, unobserved: 5 });
  assert.strictEqual(exportReport.contradictions['tier1-with-writes'], 1, 'only the observed live write contributes a contradiction');

  const reviewHtml = path.join(root, 'review.html');
  const reviewed = spawnSync(process.execPath, [REVIEW, '--store', store, '--out', reviewHtml], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(reviewed.status, 0, 'observation review page failed:\n' + reviewed.stdout + '\n' + reviewed.stderr);
  assert.match(fs.readFileSync(reviewHtml, 'utf8'), /Behavior evidence is unobserved/);

  const legacyStore = path.join(root, 'legacy-observations');
  fs.mkdirSync(legacyStore, { recursive: true });
  fs.writeFileSync(path.join(legacyStore, 'observations-index.json'), JSON.stringify({ schemaVersion: 1, records: [
    {
      id: 'legacy-live-record', source: 'observation', host: 'codex', turn: 2,
      writer: { sessionId: 'fixture-session' }, contentSha256: 'legacy-content-hash', behavior: { filesWritten: 1 }
    },
    {
      id: 'old-backfill-record', source: 'observation', captureMethod: 'session-backfill', host: 'codex', turn: 1,
      writer: { sessionId: 'older-session', turnId: 'old' }, behavior: { filesWritten: 0, toolCalls: 0 }
    }
  ] }));
  const legacy = runImport(legacyStore);
  assert.strictEqual(legacy.status, 0, legacy.stderr);
  const legacyReport = JSON.parse(legacy.stdout);
  assert.strictEqual(legacyReport.skipped.ambiguousLiveMatch, 1,
    'legacy live records without a turn ID are explicitly skipped when the same session/turn is ambiguous');
  assert.strictEqual(legacyReport.migratedUnobservedBehavior, 1, 'prior backfill records are migrated away from synthetic zero behavior');
  const legacyIndex = JSON.parse(fs.readFileSync(path.join(legacyStore, 'observations-index.json'), 'utf8'));
  assert.strictEqual(legacyIndex.records.find(entry => entry.id === 'old-backfill-record').behavior, null);

  const second = runImport();
  assert.strictEqual(second.status, 0, second.stderr);
  assert.strictEqual(JSON.parse(second.stdout).imported, 0, 'repeated imports must not duplicate records');
  assert.strictEqual(JSON.parse(second.stdout).skipped.duplicate, 6);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(store, 'observations-index.json'), 'utf8')).records.length, 6);

  const lockSessions = path.join(root, 'lock-timeout-sessions');
  fs.mkdirSync(lockSessions, { recursive: true });
  const lockRollout = path.join(lockSessions, 'lock-timeout.jsonl');
  fs.writeFileSync(lockRollout, [
    { type: 'event_msg', timestamp: '2026-10-01T00:00:00.000Z', payload: { type: 'task_started', turn_id: 'lock-timeout', started_at: '2026-10-01T00:00:00.000Z' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a unique turn that cannot be persisted while locked' }] } },
    { type: 'event_msg', timestamp: '2026-10-01T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'lock-timeout', last_agent_message: LABEL } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const lockStore = path.join(root, 'lock-timeout-store');
  fs.mkdirSync(lockStore, { recursive: true });
  fs.writeFileSync(path.join(lockStore, '.index.lock'), 'held for importer timeout fixture');
  const locked = spawnSync(process.execPath, [IMPORTER, '--sessions', lockSessions, '--store', lockStore, '--since', '2026-09-27'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(locked.status, 1, 'an importer lock timeout must return a failing CLI exit code');
  const lockReport = JSON.parse(locked.stdout);
  assert.strictEqual(lockReport.failed.lockTimeout, 1, 'the report distinguishes a lock timeout from a duplicate');
  assert.strictEqual(fs.existsSync(path.join(lockStore, 'observations-index.json')), false,
    'a unique turn must not be reported as persisted when the index lock times out');

  const migrationStore = path.join(root, 'migration-timeout-store');
  fs.mkdirSync(migrationStore, { recursive: true });
  fs.writeFileSync(path.join(migrationStore, 'observations-index.json'), JSON.stringify({ schemaVersion: 1, records: [
    { id: 'old-backfill', captureMethod: 'session-backfill', behavior: { filesWritten: 0 } }
  ] }));
  fs.writeFileSync(path.join(migrationStore, '.index.lock'), 'held during migration fixture');
  const migrationLocked = spawnSync(process.execPath, [IMPORTER, '--sessions', lockSessions, '--store', migrationStore, '--since', '2026-09-27'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(migrationLocked.status, 1, 'a migration lock timeout must also fail the importer CLI');
  assert.strictEqual(JSON.parse(migrationLocked.stdout).failed.lockTimeout, 1,
    'the migration path reports its lock timeout through the same failure count');
  const migrationIndex = JSON.parse(fs.readFileSync(path.join(migrationStore, 'observations-index.json'), 'utf8'));
  assert.deepStrictEqual(migrationIndex.records[0].behavior, { filesWritten: 0 },
    'a failed migration does not rewrite the index or proceed with imports');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('PASS: post-revision Codex session labels import as redacted, prompt-paired, idempotent observations.');

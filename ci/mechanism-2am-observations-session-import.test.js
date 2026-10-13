#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = path.join(ROOT, 'scripts', 'system-one-observations-import-codex-sessions.js');
const LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix"],"workflow":null,"skills":[]} -->';

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
  { type: 'event_msg', timestamp: '2026-09-30T00:01:00.000Z', payload: { type: 'task_complete', turn_id: 'assistant-fallback', last_agent_message: 'The completion summary omitted the final response text.' } },
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
];
fs.writeFileSync(rollout, rows.map(row => JSON.stringify(row)).join('\n') + '\n');

function runImport() {
  return spawnSync(process.execPath, [IMPORTER, '--sessions', sessions, '--store', store, '--since', '2026-09-27'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

try {
  const first = runImport();
  assert.strictEqual(first.status, 0, 'session import failed:\n' + first.stdout + '\n' + first.stderr);
  const report = JSON.parse(first.stdout);
  assert.strictEqual(report.imported, 2);
  assert.strictEqual(report.skipped.beforeCutoff, 1);
  assert.strictEqual(report.skipped.missingPrompt, 1);
  assert.strictEqual(report.skipped.missingLabel, 1, 'an earlier assistant label is not reused after a later unlabeled answer');
  assert.strictEqual(report.skipped.invalidLabel, 1);

  const index = JSON.parse(fs.readFileSync(path.join(store, 'observations-index.json'), 'utf8'));
  assert.strictEqual(index.records.length, 2);
  const record = index.records[0];
  assert.strictEqual(record.host, 'codex');
  assert.strictEqual(record.captureMethod, 'session-backfill');
  assert.strictEqual(record.selfReport.tier, 'tier2');
  const text = JSON.parse(fs.readFileSync(path.join(store, 'text', record.contentSha256 + '.json'), 'utf8'));
  assert.strictEqual(text.prompt, 'Please fix the parser. Contact <email>.', 'only the first user text item is retained and redacted');
  const fallbackRecord = index.records.find(entry => entry.turn > record.turn);
  assert(fallbackRecord, 'the response_item assistant label is recovered when task_complete omits it');
  const fallbackText = JSON.parse(fs.readFileSync(path.join(store, 'text', fallbackRecord.contentSha256 + '.json'), 'utf8'));
  assert.strictEqual(fallbackText.prompt, 'fallback prompt from the rollout message');

  const second = runImport();
  assert.strictEqual(second.status, 0, second.stderr);
  assert.strictEqual(JSON.parse(second.stdout).imported, 0, 'repeated imports must not duplicate records');
  assert.strictEqual(JSON.parse(second.stdout).skipped.duplicate, 2);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(store, 'observations-index.json'), 'utf8')).records.length, 2);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('PASS: post-revision Codex session labels import as redacted, prompt-paired, idempotent observations.');

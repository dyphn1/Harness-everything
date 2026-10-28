#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _internals: providerInternals } = require('../hooks/scripts/lib/doc-reconciliation-provider');

const ROOT = path.resolve(__dirname, '..');
const SANITIZER = path.join(ROOT, 'benchmarks/results/live-host/claude-341-outline-dispatch-2026-10-28/sanitize-outline-capture.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-sanitizer-'));

function marker(token) {
  return `HARNESS_OUTLINE_DISPATCH_V1 taskId=task-test attemptId=attempt-1 token=${token} workerRoot=/private/worker`;
}

function markerTokens(value) {
  const tokens = [];
  const strings = [];
  const collect = item => {
    if (typeof item === 'string') strings.push(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === 'object') Object.values(item).forEach(collect);
  };
  collect(value);
  for (const text of strings) {
    for (const match of text.matchAll(/HARNESS_OUTLINE_DISPATCH_V1[^\r\n]*?\btoken=([^\s]+)/g)) tokens.push(match[1]);
  }
  return tokens;
}

try {
  const shortToken = 'OVERLAP-42';
  const longToken = 'OVERLAP-42-long';
  const input = path.join(dir, 'raw.jsonl');
  const first = path.join(dir, 'first.jsonl');
  const second = path.join(dir, 'second.jsonl');
  const wrappers = [
    { t: 1, payload: { hook_event_name: 'PreToolUse', session_id: 'synthetic-session', tool_name: 'Agent',
      tool_use_id: 'toolu_synthetic1', tool_input: { prompt: `${marker(shortToken)}\nrepeat=${shortToken}` } } },
    { t: 2, payload: { hook_event_name: 'PostToolUse', session_id: 'synthetic-session', tool_name: 'Agent',
      tool_use_id: 'toolu_synthetic2', tool_input: { command: `echo ${shortToken} ${longToken}` },
      tool_response: { stdout: `${marker(shortToken)}\n${marker(longToken)}\nrepeat=${longToken} ${shortToken}` } } },
  ];
  fs.writeFileSync(input, wrappers.map(item => JSON.stringify(item)).join('\n') + '\n');

  for (const output of [first, second]) {
    const run = spawnSync(process.execPath, [SANITIZER, input, output], { encoding: 'utf8' });
    assert.equal(run.status, 0, 'sanitizer must accept the synthetic capture');
    assert.ok(fs.existsSync(output), 'sanitizer must write the exported capture');
  }

  const bytes = fs.readFileSync(first);
  assert.deepEqual(fs.readFileSync(second), bytes, 'synthetic token mappings must be stable across runs');
  const text = bytes.toString('utf8');
  assert.ok(!text.includes(shortToken) && !text.includes(longToken),
    'sanitized output must remove every marker token from nested exported strings');
  const records = text.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.event), ['PreToolUse', 'PostToolUse'], 'sanitization must preserve record order');
  assert.equal(Object.hasOwn(records[0], 'tool_response'), false, 'sanitization must preserve absent fields');
  assert.equal(records[0].session_id, '<session-1>', 'existing session ID mapping remains a positive control');
  const mapped = markerTokens(records);
  assert.equal(mapped.length, 3, 'all exported marker occurrences must remain parseable');
  assert.ok(mapped.every(token => token.length > 0 && !/\s/.test(token)), 'synthetic marker tokens must be nonempty and whitespace-free');
  assert.equal(mapped[0], mapped[1], 'equal originals must map to equal placeholders');
  assert.notEqual(mapped[0], mapped[2], 'different originals must map to distinct placeholders');
  for (const record of records) {
    for (const value of [record.tool_input?.prompt, record.tool_response?.stdout].filter(Boolean)) {
      for (const line of value.split(/\r?\n/).filter(line => line.startsWith('HARNESS_OUTLINE_DISPATCH_V1 '))) {
        assert.ok(providerInternals.parseOutlineDispatchPrompt(line), 'sanitized marker must retain the production parser grammar');
      }
    }
  }
  console.log('PASS sanitizer replaces repeated and overlapping marker tokens in nested exported strings');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

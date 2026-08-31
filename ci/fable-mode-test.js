#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const selector = path.join(root, 'fable-mode', 'scripts', 'model-selector.js');
const router = path.join(root, 'harness-everything', 'scripts', 'tier-router.js');
const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fable-mode-'));
const auditFile = path.join(auditDir, 'audit.jsonl');

function runNode(file, args) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

function selectorArgs(overrides = {}) {
  const input = {
    requested: 'opus',
    available: 'opus,sonnet,haiku',
    'available-agents': 'fable-orchestrator,fable-worker-sonnet,fable-worker-haiku',
    fallback: 'stop',
    'host-model': 'opus',
    'audit-file': auditFile,
    'stage-brief': 'Choose the architecture',
    'pass-condition': 'ADR exists and names the decision',
    'verification-command': 'npm test',
    'verifier-result': 'pending',
    ...overrides
  };
  return Object.entries(input).flatMap(([key, value]) => [`--${key}`, value]);
}

function readRecord(result) {
  assert.ok(result.stdout.trim(), `selector produced no JSON: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

console.log('=== Fable model mode contract tests ===');

const selected = runNode(selector, selectorArgs());
assert.strictEqual(selected.status, 0, selected.stderr);
const selectedRecord = readRecord(selected);
assert.strictEqual(selectedRecord.status, 'selected');
assert.strictEqual(selectedRecord.requestedModel, 'opus');
assert.strictEqual(selectedRecord.effectiveModel, 'opus');
assert.strictEqual(selectedRecord.fallbackReason, 'none');
assert.strictEqual(selectedRecord.agent, 'fable-orchestrator');

const sonnect = runNode(selector, selectorArgs({ requested: 'sonnect', available: 'haiku,sonnet' }));
assert.strictEqual(sonnect.status, 0, sonnect.stderr);
const sonnectRecord = readRecord(sonnect);
assert.strictEqual(sonnectRecord.requestedModel, 'sonnet');
assert.strictEqual(sonnectRecord.requestedInput, 'sonnect');

const inline = runNode(selector, selectorArgs({
  requested: 'opus',
  available: 'sonnet',
  fallback: 'inline',
  'host-model': 'sonnet'
}));
assert.strictEqual(inline.status, 0, inline.stderr);
const inlineRecord = readRecord(inline);
assert.strictEqual(inlineRecord.status, 'fallback');
assert.strictEqual(inlineRecord.effectiveModel, 'sonnet');
assert.match(inlineRecord.fallbackReason, /opus is not in availableModels/);
assert.strictEqual(inlineRecord.escalationRequired, false);

const blocked = runNode(selector, selectorArgs({ requested: 'opus', available: 'sonnet' }));
assert.strictEqual(blocked.status, 2);
const blockedRecord = readRecord(blocked);
assert.strictEqual(blockedRecord.status, 'blocked');
assert.strictEqual(blockedRecord.effectiveModel, null);
assert.strictEqual(blockedRecord.escalationRequired, true);
assert.match(blockedRecord.fallbackReason, /inline fallback was not authorized/);

const missingAgent = runNode(selector, selectorArgs({
  requested: 'sonnet',
  available: 'sonnet',
  'available-agents': 'fable-worker-haiku',
  fallback: 'inline',
  'host-model': 'opus'
}));
assert.strictEqual(missingAgent.status, 0, missingAgent.stderr);
const missingAgentRecord = readRecord(missingAgent);
assert.strictEqual(missingAgentRecord.status, 'fallback');
assert.strictEqual(missingAgentRecord.effectiveModel, 'opus');
assert.match(missingAgentRecord.fallbackReason, /fable-worker-sonnet is not in availableAgents/);

const missingField = runNode(selector, selectorArgs({ 'pass-condition': '' }));
assert.strictEqual(missingField.status, 2);
assert.match(missingField.stderr, /passCondition is required/);

const explicitRoute = runNode(router, ['fable on sonnect for architecture synthesis']);
assert.strictEqual(explicitRoute.status, 0);
assert.match(explicitRoute.stdout, /REQUESTED FABLE MODEL MODE: sonnet/);
assert.match(explicitRoute.stdout, /fable-mode\/fable-sonnet\/SKILL\.md/);

const ordinaryTier2 = runNode(router, ['Fix this checkout bug and add a regression test.']);
assert.strictEqual(ordinaryTier2.status, 0);
assert.match(ordinaryTier2.stdout, /RECOMMENDED TIER: Tier 2/);
assert.doesNotMatch(ordinaryTier2.stdout, /REQUESTED FABLE MODEL MODE/);
assert.doesNotMatch(ordinaryTier2.stdout, /fable-opus\/SKILL\.md/);

const auditLines = fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.strictEqual(auditLines.length, 5);
for (const line of auditLines) {
  const record = JSON.parse(line);
  for (const field of ['requestedModel', 'effectiveModel', 'fallbackReason', 'stageBrief', 'passCondition', 'verificationCommand', 'verifierResult']) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, field), `audit missing ${field}`);
  }
}
fs.rmSync(auditDir, { recursive: true, force: true });

console.log('PASS: selected, sonnect alias, inline fallback, blocked escalation, audit fields, and routing separation');

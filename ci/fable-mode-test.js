#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');
const { evaluateRuntimeFloor } = require('../fable-mode/scripts/model-selector.js');

const root = path.resolve(__dirname, '..');
const selector = path.join(root, 'fable-mode', 'scripts', 'model-selector.js');
const router = path.join(root, 'harness-everything', 'scripts', 'tier-router.js');
const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fable-mode-'));
const auditFile = path.join(auditDir, 'audit.jsonl');

function runNode(file, args) {
  return spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8' });
}

function selectorArgs(overrides = {}) {
  const input = {
    requested: 'opus',
    'available-agents': 'fable-orchestrator,fable-worker-sonnet,fable-worker-haiku',
    fallback: 'stop',
    host: 'codex',
    'runtime-model': 'gpt-6.1-sol',
    'runtime-effort': 'xhigh',
    'audit-file': auditFile,
    'stage-brief': 'Choose the architecture',
    'pass-condition': 'ADR exists and names the decision',
    'verification-command': 'npm test',
    'verifier-result': 'pending',
    ...overrides
  };
  return Object.entries(input).flatMap(([key, value]) => ['--' + key, String(value)]);
}

function readRecord(result) {
  assert.ok(result.stdout.trim(), 'selector produced no JSON: ' + result.stderr);
  return JSON.parse(result.stdout);
}

console.log('=== Fable behavior profile + runtime floor contract tests ===');

const publicDescription = 'Stage large tasks through plans, named fable agents, failable checks, and skeptical review; fable on opus|sonnet|haiku selects a behavior profile, not a runtime model.';
const fableSkillText = fs.readFileSync(path.join(root, 'fable-mode', 'SKILL.md'), 'utf8');
assert.ok(fableSkillText.includes('description: "' + publicDescription + '"'));

for (const task of ['positive-opus-mode.yaml', 'positive-sonnet-mode.yaml', 'positive-haiku-mode.yaml', 'positive-trigger.yaml']) {
  const source = fs.readFileSync(path.join(root, 'evals', 'fable-mode', 'tasks', task), 'utf8');
  assert.ok(source.includes('description: "' + publicDescription + '"'), task + ' must keep the exact public fable-mode description');
}

const behavior = JSON.parse(fs.readFileSync(path.join(root, 'fable-mode', 'behavior-profile-matrix.json'), 'utf8'));
assert.strictEqual(behavior.profiles.orchestrator.legacyAlias, 'opus');
assert.ok(behavior.profiles.reasoning.aliases.includes('sonnect'));

const floors = JSON.parse(fs.readFileSync(path.join(root, 'fable-mode', 'runtime-model-floor-matrix.json'), 'utf8'));
assert.strictEqual(floors.hosts.claude.orchestrator.minVersion, '5.5');
assert.strictEqual(floors.hosts.claude.orchestrator.minEffort, 'medium');
assert.strictEqual(floors.hosts.claude.reasoning.minVersion, '5.5');
assert.strictEqual(floors.hosts.claude.mechanical.minVersion, '5.5');
assert.strictEqual(floors.hosts.codex.orchestrator.minGeneration, 6);
assert.strictEqual(floors.hosts.codex.orchestrator.minEffort, 'xhigh');
assert.strictEqual(floors.hosts.codex.reasoning.minEffort, 'medium');
assert.strictEqual(floors.hosts.codex.mechanical.family, 'luna');
assert.strictEqual(floors.hosts.codex.mechanical.minEffort, 'xhigh');

for (const profile of ['fable-opus', 'fable-sonnet', 'fable-haiku']) {
  const source = fs.readFileSync(path.join(root, 'fable-mode', profile, 'SKILL.md'), 'utf8');
  assert.match(source, /Reference profile, not a standalone plugin skill/);
}
for (const agent of ['fable-orchestrator.md', 'fable-worker-sonnet.md', 'fable-worker-haiku.md', 'fable-verifier.md']) {
  const source = fs.readFileSync(path.join(root, 'fable-mode', 'agents', agent), 'utf8');
  assert.match(source, /^model: inherit$/m, agent + ' must not pin a branded runtime model');
}

const guardrailSource = fs.readFileSync(path.join(root, 'fable-mode', 'execution-guardrails', 'SKILL.md'), 'utf8');
assert.match(guardrailSource, /reference-only, not an always-on carrier/);
assert.doesNotMatch(guardrailSource, /These rules are always-on/);

const selected = runNode(selector, selectorArgs());
assert.strictEqual(selected.status, 0, selected.stderr);
const selectedRecord = readRecord(selected);
assert.strictEqual(selectedRecord.status, 'selected');
assert.strictEqual(selectedRecord.requestedProfile, 'orchestrator');
assert.strictEqual(selectedRecord.effectiveProfile, 'orchestrator');
assert.strictEqual(selectedRecord.profileAlias, 'opus');
assert.strictEqual(selectedRecord.agent, 'fable-orchestrator');
assert.strictEqual(selectedRecord.runtimeFloorStatus, 'meets-recommended');

const sonnect = runNode(selector, selectorArgs({
  requested: 'sonnect',
  host: 'claude',
  'runtime-model': 'claude-sonnet-5.5',
  'runtime-effort': 'medium'
}));
assert.strictEqual(sonnect.status, 0, sonnect.stderr);
const sonnectRecord = readRecord(sonnect);
assert.strictEqual(sonnectRecord.requestedProfile, 'reasoning');
assert.strictEqual(sonnectRecord.profileAlias, 'sonnect');
assert.strictEqual(sonnectRecord.runtimeFloorStatus, 'meets-recommended');

const belowFloor = runNode(selector, selectorArgs({
  requested: 'opus',
  host: 'codex',
  'runtime-model': 'gpt-6-sol',
  'runtime-effort': 'medium'
}));
assert.strictEqual(belowFloor.status, 0, belowFloor.stderr);
const belowFloorRecord = readRecord(belowFloor);
assert.strictEqual(belowFloorRecord.status, 'selected');
assert.strictEqual(belowFloorRecord.effectiveProfile, 'orchestrator');
assert.strictEqual(belowFloorRecord.runtimeFloorStatus, 'below-recommended');
assert.strictEqual(belowFloorRecord.escalationRequired, false);

const unknownFamily = evaluateRuntimeFloor('reasoning', {
  host: 'codex',
  runtimeModel: 'vendor-private-model',
  runtimeEffort: 'xhigh'
});
assert.strictEqual(unknownFamily.status, 'unknown');
assert.match(unknownFamily.reason, /not comparable/);

const unknownEffort = evaluateRuntimeFloor('reasoning', {
  host: 'codex',
  runtimeModel: 'gpt-6.1-sol',
  runtimeEffort: 'custom-effort'
});
assert.strictEqual(unknownEffort.status, 'unknown');
assert.match(unknownEffort.reason, /not comparable/);

const inline = runNode(selector, selectorArgs({
  requested: 'sonnet',
  'available-agents': 'fable-worker-haiku',
  fallback: 'inline'
}));
assert.strictEqual(inline.status, 0, inline.stderr);
const inlineRecord = readRecord(inline);
assert.strictEqual(inlineRecord.status, 'fallback');
assert.strictEqual(inlineRecord.effectiveProfile, 'reasoning');
assert.match(inlineRecord.fallbackReason, /execute the same reasoning behavior profile inline/);

const blocked = runNode(selector, selectorArgs({
  requested: 'sonnet',
  'available-agents': 'fable-worker-haiku',
  fallback: 'stop'
}));
assert.strictEqual(blocked.status, 2);
const blockedRecord = readRecord(blocked);
assert.strictEqual(blockedRecord.status, 'blocked');
assert.strictEqual(blockedRecord.effectiveProfile, null);
assert.strictEqual(blockedRecord.escalationRequired, true);
assert.match(blockedRecord.fallbackReason, /inline fallback was not authorized/);

const missingField = runNode(selector, selectorArgs({ 'pass-condition': '' }));
assert.strictEqual(missingField.status, 2);
assert.match(missingField.stderr, /passCondition is required/);

const explicitRoute = runNode(router, ['fable on sonnect for architecture synthesis']);
assert.strictEqual(explicitRoute.status, 0);
assert.match(explicitRoute.stdout, /REQUESTED FABLE PROFILE: sonnect/);
assert.match(explicitRoute.stdout, /=> ROUTE: fable-mode\/SKILL\.md/);
assert.doesNotMatch(explicitRoute.stdout, /REQUESTED FABLE MODEL MODE/);
assert.doesNotMatch(explicitRoute.stdout, /=> ROUTE: fable-mode\/fable-sonnet\/SKILL\.md/);

const ordinaryTier2 = runNode(router, ['Fix this checkout bug and add a regression test.']);
assert.strictEqual(ordinaryTier2.status, 0);
assert.match(ordinaryTier2.stdout, /RECOMMENDED TIER: Tier 2/);
assert.doesNotMatch(ordinaryTier2.stdout, /REQUESTED FABLE PROFILE/);

const warningBatchContract = '**Warning batching.** Collect minor concerns and list them together in the next natural report or handoff; their count alone MUST NOT stop, pause, or return the worker/stage. An independently material, confirmed concern may stop the current stage and be surfaced immediately.';
for (const rel of [
  'fable-mode/agents/fable-worker-haiku.md',
  'fable-mode/agents/fable-worker-sonnet.md',
  'fable-mode/agents/fable-orchestrator.md',
  'fable-mode/execution-guardrails/SKILL.md'
]) {
  const prompt = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\s+/g, ' ');
  assert.ok(prompt.includes(warningBatchContract), rel + ' must keep minor-concern batching reporting-only');
}

const auditLines = fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.strictEqual(auditLines.length, 5);
for (const line of auditLines) {
  const record = JSON.parse(line);
  for (const field of [
    'requestedProfile', 'effectiveProfile', 'profileAlias', 'runtimeModel', 'runtimeEffort',
    'recommendedRuntimeFloor', 'runtimeFloorStatus', 'runtimeFloorReason', 'fallbackReason',
    'stageBrief', 'passCondition', 'verificationCommand', 'verifierResult'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, field), 'audit missing ' + field);
  }
}
fs.rmSync(auditDir, { recursive: true, force: true });

console.log('PASS: profiles are behavior contracts; runtime floors are advisory; agent fallback remains explicit');

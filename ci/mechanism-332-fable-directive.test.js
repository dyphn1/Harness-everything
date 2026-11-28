#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ROUTER = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');

function route(prompt) {
  const result = spawnSync(process.execPath, [ROUTER], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }),
    env: { ...process.env, HARNESS_SYSTEM_ONE_MODE: 'off' },
  });
  assert.equal(result.status, 0, `${prompt}: router exits successfully\n${result.stderr}`);
  const match = result.stdout.match(/ROUTER WORKFLOW PLAN \(JSON\): (\{[^\r\n]+\})/);
  assert.ok(match, `${prompt}: real kernel entry emits workflow plan`);
  return { ...JSON.parse(match[1]), routerOutput: result.stdout };
}

const mention = route('我記得有 fable-decision skill');
assert.notEqual(mention.strategy, 'fable-staged', 'a Fable skill mention does not select Fable');

for (const prompt of [
  '不要用 fable，改 README 錯字',
  'Do not use fable, fix a typo in README.md',
]) {
  const plan = route(prompt);
  assert.notEqual(plan.strategy, 'fable-staged', `${prompt}: prohibition does not select Fable`);
  assert.notEqual(plan.fallback.disposition, 'blocked', `${prompt}: prohibition alone does not conflict`);
}

const englishTypo = route('Fix a typo in README.md');
assert.equal(englishTypo.tier, 'tier1');
assert.equal(englishTypo.strategy, 'direct-single');

const zhExplicit = route('用 fable 跨專案實作這個功能');
assert.equal(zhExplicit.strategy, 'fable-staged', 'explicit Chinese request selects Fable');

const prohibitedMacro = route('Do not use fable; redesign the architecture across the repository');
assert.equal(prohibitedMacro.tier, 'tier3', 'real macro workload keeps its structural tier');
assert.equal(prohibitedMacro.strategy, 'iterative-single', 'prohibition downgrades to a single-agent topology');
assert.notEqual(prohibitedMacro.fallback.disposition, 'blocked', 'prohibition alone is not a conflict');

const prohibitedProfile = route('Do not use fable on opus to audit the entire repository architecture');
assert.equal(prohibitedProfile.strategy, 'iterative-single',
  'a negated profile invocation is not an explicit strategy request');
assert.ok(!prohibitedProfile.routerOutput.includes('REQUESTED FABLE PROFILE'),
  'a negated profile invocation is not treated as a requested model');
assert.ok(!prohibitedProfile.reasonCodes.includes('explicit-request-conflicts-with-prohibition'));

const contradiction = route('Use fable to redesign the architecture. Do not use fable for this task.');
assert.equal(contradiction.fallback.disposition, 'blocked', 'contradictory clauses remain blocked');
assert.ok(contradiction.reasonCodes.includes('explicit-request-conflicts-with-prohibition'));

for (const [prompt, strategy] of [
  ['fable-staged audit the whole repository architecture', 'fable-staged'],
  ['fable-parallel for independent read-only repository audits', 'fable-parallel'],
]) {
  assert.equal(route(prompt).strategy, strategy, `${prompt}: named topology remains selectable`);
}
assert.notEqual(route('Do not use fable-staged for this task').strategy, 'fable-staged',
  'negated named strategy is not an explicit request');

assert.equal(route('What is fable on sonnet? Return only JSON.').strategy, 'direct-single',
  'profile lookup remains a lookup');
assert.equal(route('改 README 錯字').tier, 'unclassified', 'Chinese typo stays bounded without new Tier 1 recognition');

console.log('PASS: #332 Fable directive real-entry controls');

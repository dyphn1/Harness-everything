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
  '不要改用 fable 修 README 錯字',
  'Do not use fable, fix a typo in README.md',
  'Could you not use fable to fix a typo in README.md',
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

for (const prompt of [
  '改用 fable 修 README 錯字',
  '幫我改用 fable 修 README 錯字',
  '請改用 fable 修 README 錯字',
  '麻煩改用 fable 修 README 錯字',
  'Could you use fable to fix a typo in README.md',
  'Would you please use fable to fix a typo in README.md',
]) {
  const plan = route(prompt);
  assert.equal(plan.strategy, 'fable-staged', `${prompt}: explicit request selects Fable`);
  assert.ok(plan.reasonCodes.includes('explicit-strategy-request'), `${prompt}: explicit request is recorded`);
}

for (const prompt of [
  '改用 fable-staged 修 README 錯字',
  '改用 fable on sonnet 修 README 錯字',
]) {
  const plan = route(prompt);
  assert.equal(plan.strategy, 'fable-staged', `${prompt}: named strategy/profile remains selectable`);
  assert.ok(plan.reasonCodes.includes('explicit-strategy-request'), `${prompt}: named request is recorded`);
  if (prompt.includes('sonnet')) assert.ok(plan.routerOutput.includes('REQUESTED FABLE PROFILE: sonnet'));
}

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

for (const prompt of [
  'Never use fable, fix a typo in README.md',
  'Never use fable-mode, fix a typo in README.md',
  'Cannot use fable, fix a typo in README.md',
  "Can't use fable, fix a typo in README.md",
  'Not use fable, fix a typo in README.md',
  '別用 fable，改 README 錯字',
  '別用 fable-mode，改 README 錯字',
  '請勿使用 fable，改 README 錯字',
  '勿用 fable，改 README 錯字',
  '避免用 fable，改 README 錯字',
  '停止使用 fable，改 README 錯字',
]) {
  const plan = route(prompt);
  assert.notEqual(plan.strategy, 'fable-staged', `${prompt}: prohibition is not a request`);
  assert.ok(!plan.reasonCodes.includes('explicit-strategy-request'), `${prompt}: no explicit request`);
  assert.notEqual(plan.fallback.disposition, 'blocked', `${prompt}: prohibition is not a conflict`);
}

for (const prefix of ['Please', "Let's", 'Now', 'Could you', 'Could you please', 'Would you', 'Would you please', '請', '幫我', '麻煩']) {
  for (const verb of ['use fable', 'run fable', 'enter fable', '使用 fable', '用 fable', '啟用 fable', '進入 fable', '執行 fable', '改用 fable']) {
    assert.equal(route(`${prefix} ${verb} to redesign the repository architecture`).strategy, 'fable-staged',
      `${prefix} + ${verb}: clause-leading request selects Fable`);
  }
}

const englishNegationPrefixes = ['Do not', "Don't", 'Never', 'Cannot', "Can't", 'Not', 'No', 'Without'];
const englishNegationTargets = ['fable', 'fable-mode', 'use fable', 'use fable-mode', 'fable to fix a typo'];
const chineseNegationPrefixes = ['不要', '不需要', '無需', '無須', '不必', '毋須', '不用', '不會', '別', '勿', '請勿', '避免', '停止'];
const chineseNegationTargets = ['fable', '使用 fable', '用 fable', '啟用 fable', '進入 fable', '執行 fable'];
const negationMatrix = [
  ...englishNegationPrefixes.flatMap(prefix => englishNegationTargets.map(target => `${prefix} ${target} to fix a typo in README.md`)),
  ...chineseNegationPrefixes.flatMap(prefix => chineseNegationTargets.map(target => `${prefix}${target} 修 README 錯字`)),
];
assert.equal(negationMatrix.length, 118, 'the class-level negation matrix covers 118 inputs');
for (const prompt of negationMatrix) {
  const plan = route(prompt);
  assert.notEqual(plan.strategy, 'fable-staged', `${prompt}: negation does not select Fable`);
  assert.ok(!plan.reasonCodes.includes('explicit-strategy-request'), `${prompt}: negation is not an explicit request`);
  assert.notEqual(plan.fallback.disposition, 'blocked', `${prompt}: negation alone is not a conflict`);
}

for (const prefix of ['please', "let's", 'now', '請', '幫我', '改用', '麻煩']) {
  const plan = route(`${prefix} maybe use fable to fix a typo in README.md`);
  assert.ok(!plan.reasonCodes.includes('explicit-strategy-request'), `${prefix}: unknown modifier is not explicit`);
  assert.notEqual(plan.fallback.disposition, 'blocked', `${prefix}: unknown modifier is not a conflict`);
}

for (const prompt of [
  'Never use fable; redesign the architecture across the repository',
  '請勿使用 fable；重構整個 repository architecture',
]) {
  const plan = route(prompt);
  assert.equal(plan.tier, 'tier3', `${prompt}: structural tier remains`);
  assert.equal(plan.strategy, 'iterative-single', `${prompt}: prohibition downgrades topology`);
  assert.ok(plan.reasonCodes.includes('user-prohibited-fable'), `${prompt}: prohibition reason is visible`);
}

for (const prompt of [
  'Redesign the architecture across the entire repository',
  '重構整個 repository architecture',
]) {
  const plan = route(prompt);
  assert.equal(plan.tier, 'tier3', `${prompt}: structural tier remains without prohibition`);
  assert.equal(plan.strategy, 'fable-staged', `${prompt}: positive control retains the Tier 3 default`);
}

for (const prompt of [
  'Do not use fable; use fable-parallel for this task',
  'Use fable-parallel; do not use fable for this task',
  'Cannot use fable on opus; fable on sonnet for this task',
  'Fable on sonnet; do not use fable for this task',
]) {
  const plan = route(prompt);
  assert.equal(plan.fallback.disposition, 'blocked', `${prompt}: real contradiction remains blocked`);
}

assert.notEqual(route('I remember fable-staged; fix a typo in README.md').strategy, 'fable-staged');
const laterProfile = route('I remember fable on opus; use fable on sonnet for this task');
assert.equal(laterProfile.strategy, 'fable-staged');
assert.ok(laterProfile.routerOutput.includes('REQUESTED FABLE PROFILE: sonnet'));
const quotedSeparator = route('Use “fable; use fable on opus” as an example');
assert.notEqual(quotedSeparator.strategy, 'fable-staged');
assert.ok(!quotedSeparator.reasonCodes.includes('explicit-strategy-request'));

console.log('PASS: #332 Fable directive real-entry controls');

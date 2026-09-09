#!/usr/bin/env node
/**
 * Negative control validator for quality gates.
 * Tests that known-bad fixtures are correctly rejected by each gate.
 *
 * Usage: node ci/negative-controls.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let fixtureCounter = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}`);
    console.error(`   ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function runGate(script) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'ci', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ...result,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function installFixture(source, label) {
  const target = path.join(ROOT, `issue20-negative-${process.pid}-${++fixtureCounter}-${label}`);
  assert(!fs.existsSync(target), `refusing to overwrite existing path: ${target}`);
  fs.cpSync(path.join(ROOT, source), target, { recursive: true });
  return target;
}

function removeFixtures(targets) {
  for (const target of targets.reverse()) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function expectGateFailure(name, script, fixtures, matcher) {
  test(name, () => {
    const targets = [];
    try {
      for (const fixture of fixtures) targets.push(installFixture(fixture.source, fixture.label));
      const result = runGate(script);
      assert(result.status !== 0, `${script} unexpectedly passed (exit ${result.status})`);
      assert(matcher.test(result.output), `${script} failed without the expected diagnostic:\n${result.output}`);
      console.log(`   real gate: ${script} exited ${result.status}`);
    } finally {
      removeFixtures(targets);
    }
  });
}

expectGateFailure(
  'consistency-check rejects malformed frontmatter',
  'consistency-check.js',
  [{ source: 'ci/fixtures/bad-frontmatter-colon', label: 'bad-frontmatter' }],
  /frontmatter YAML syntax valid|YAMLException|unquoted colon/i
);

expectGateFailure(
  'consistency-check rejects a missing frontmatter delimiter',
  'consistency-check.js',
  [{ source: 'eval-framework/fixtures/missing-delimiter', label: 'missing-delimiter' }],
  /delimiter|frontmatter/i
);

expectGateFailure(
  'description-collision rejects duplicate descriptions',
  'description-collision.js',
  [
    { source: 'ci/fixtures/duplicate-description/skill-a', label: 'duplicate-a' },
    { source: 'ci/fixtures/duplicate-description/skill-b', label: 'duplicate-b' },
  ],
  /COLLISION/i
);

expectGateFailure(
  'consistency-check rejects an over-budget skill',
  'consistency-check.js',
  [{ source: 'eval-framework/fixtures/over-budget-skill', label: 'over-budget' }],
  /exceeds hard limit|word count/i
);

test('normal repository passes the exercised gates', () => {
  const consistency = runGate('consistency-check.js');
  const collision = runGate('description-collision.js');
  assert(consistency.status === 0, `consistency-check failed (exit ${consistency.status})`);
  assert(collision.status === 0, `description-collision failed (exit ${collision.status})`);
  console.log('   real gates: consistency-check.js and description-collision.js exited 0');
});

console.log(`\nNegative control results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All negative controls verified by executing the real gates.');

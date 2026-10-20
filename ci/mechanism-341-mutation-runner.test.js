'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CHECKS, LEGACY_ASSERTIONS, addLoaderPreload, runChecks, stripLoaderPreload } = require('./mutation-check');
const { MUTATIONS, prepareMutation } = require('./mutation-loader');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-mutation-runner-'));

function write(relative, contents) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function checkTuple({ mutantId, target = 'synthetic-target.js', mode = 'assert', caseId = 'RB00', assertionId = 'RB00.synthetic.target-is-true', timeoutMs = 10000 } = {}) {
  const [result] = runChecks({
    root,
    allowTestMutations: true,
    timeoutMs,
    testEnv: {
      HARNESS_SYNTHETIC_MODE: mode,
      HARNESS_SYNTHETIC_TARGET: path.join(root, 'synthetic-target.js'),
    },
    checks: [{
      label: `${mutantId || 'control'} / ${mode}`,
      target,
      mutantId: mutantId || 'test-kill',
      test: 'synthetic-test.js',
      ...(caseId ? { caseId } : {}),
      assertionId,
    }],
  });
  assert.ok(result, 'runner returns one report per selected tuple');
  return result;
}

function checkLegacyTuple({ test, caseId, assertionId, signature }) {
  const [result] = runChecks({
    root,
    allowTestMutations: true,
    timeoutMs: 10000,
    testEnv: { HARNESS_SYNTHETIC_TARGET: path.join(root, 'synthetic-target.js') },
    checks: [{
      label: assertionId,
      target: 'synthetic-target.js',
      mutantId: 'test-kill',
      test,
      caseId,
      assertionId,
    }],
    legacyAssertions: { [assertionId]: signature },
  });
  return result;
}

try {
  const targetPath = write('synthetic-target.js', 'module.exports = true;\n');
  write('synthetic-other.js', 'module.exports = true;\n');
  write('ci/test-helper.js', [
    "'use strict';",
    'module.exports.check = function check(name, condition) { if (!condition) process.exitCode = 1; };',
    '',
  ].join('\n'));
  write('synthetic-test.js', String.raw`
const assert = require('assert');
const fs = require('fs');
const selectedCase = process.env.HARNESS_CASE_ID || 'RB00';
const selectedAssertion = process.env.HARNESS_ASSERTION_ID || 'RB00.synthetic.target-is-true';
const eventFile = process.env.HARNESS_ASSERTION_EVENT_FILE;
function emit(event, caseId = selectedCase, assertionId = selectedAssertion) {
  const record = { schemaVersion: 1, event, caseId, assertionId };
  if (event === 'assertion-failure') record.errorCode = 'ERR_ASSERTION';
  fs.appendFileSync(eventFile, JSON.stringify(record) + '\n');
}
const mode = process.env.HARNESS_SYNTHETIC_MODE;
if (mode === 'control-failure') {
  emit('assertion-failure');
  process.exitCode = 1;
} else if ((mode === 'generic-failure' || mode === 'parity-only-failure') && process.env.HARNESS_MUTATION) {
  require(process.env.HARNESS_SYNTHETIC_TARGET);
  console.error(mode === 'generic-failure' ? '❌ synthetic suite failed' : 'FAIL source/package parity');
  process.exitCode = 1;
} else if (mode === 'unrelated-assertion' && process.env.HARNESS_MUTATION) {
  require(process.env.HARNESS_SYNTHETIC_TARGET);
  emit('assertion-failure', selectedCase, selectedAssertion + '.different');
  process.exitCode = 1;
} else if (mode === 'selected-and-unrelated' && process.env.HARNESS_MUTATION) {
  require(process.env.HARNESS_SYNTHETIC_TARGET);
  emit('assertion-failure');
  emit('assertion-failure', selectedCase, selectedAssertion + '.different');
  process.exitCode = 1;
} else if (mode === 'selected-then-crash' && process.env.HARNESS_MUTATION) {
  require(process.env.HARNESS_SYNTHETIC_TARGET);
  emit('assertion-failure');
  throw new Error('synthetic infrastructure crash after assertion event');
} else if (mode === 'does-not-load-target' && process.env.HARNESS_MUTATION) {
  emit('assertion-pass');
} else if (mode === 'timeout' && process.env.HARNESS_MUTATION) {
  require(process.env.HARNESS_SYNTHETIC_TARGET);
  setInterval(() => {}, 1000);
} else if (mode === 'nested-process') {
  const { spawnSync } = require('child_process');
  const target = process.env.HARNESS_SYNTHETIC_TARGET;
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(require(' + JSON.stringify(target) + ')))'], { encoding: 'utf8' });
  if (child.error || child.signal || child.status !== 0) throw new Error('nested target process failed before its assertion');
  try {
    assert.strictEqual(child.stdout, 'true');
    emit('assertion-pass');
  } catch (error) {
    if (error && error.code === 'ERR_ASSERTION') {
      emit('assertion-failure');
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
} else {
  const value = require(process.env.HARNESS_SYNTHETIC_TARGET);
  try {
    assert.strictEqual(value, true);
    emit('assertion-pass');
  } catch (error) {
    if (error && error.code === 'ERR_ASSERTION') {
      emit('assertion-failure');
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
`);
  write('synthetic-legacy-helper-test.js', [
    "'use strict';",
    "const helper = require('./ci/test-helper');",
    "helper.check('legacy helper assertion', require(process.env.HARNESS_SYNTHETIC_TARGET) === true);",
    '',
  ].join('\n'));
  write('synthetic-legacy-assert-test.js', [
    "'use strict';",
    "const assert = require('assert');",
    "assert.strictEqual(require(process.env.HARNESS_SYNTHETIC_TARGET), true, 'legacy assert assertion');",
    '',
  ].join('\n'));
  write('synthetic-legacy-callsite-test.js', [
    "'use strict';",
    "const assert = require('assert');",
    'assert.strictEqual(require(process.env.HARNESS_SYNTHETIC_TARGET), true);',
    '',
  ].join('\n'));
  write('synthetic-legacy-output-test.js', [
    "'use strict';",
    "const value = require(process.env.HARNESS_SYNTHETIC_TARGET);",
    "if (value === true) console.log('PASS legacy output assertion');",
    "else { console.error('FAIL legacy output assertion'); process.exitCode = 1; }",
    '',
  ].join('\n'));

  const original = fs.readFileSync(targetPath, 'utf8');
  const tupleKeys = new Set();
  for (const tuple of CHECKS) {
    assert.ok(tuple.label && tuple.target && tuple.mutantId && tuple.test && tuple.assertionId, 'production tuple declares target, mutant, test, and assertion');
    assert.ok(MUTATIONS[tuple.mutantId], `production tuple has a registered transform: ${tuple.mutantId}`);
    assert.ok(tuple.assertionId.startsWith(`${tuple.caseId}.`), 'legacy assertion ID is scoped to its stable legacy case ID');
    if (!/^RB\d{2,}$/.test(tuple.caseId)) {
      assert.ok(LEGACY_ASSERTIONS[tuple.assertionId], `legacy tuple has an anchored intended assertion: ${tuple.assertionId}`);
    }
    const key = `${tuple.target}\0${tuple.mutantId}\0${tuple.test}\0${tuple.assertionId}`;
    assert.ok(!tupleKeys.has(key), 'mutation tuples are explicit and unique');
    tupleKeys.add(key);
  }
  const loaderPath = require.resolve('./mutation-loader');
  const inheritedOptions = `--trace-warnings --import="${loaderPath}" --max-old-space-size=2048`;
  assert.strictEqual(
    stripLoaderPreload(inheritedOptions, loaderPath),
    '--trace-warnings --max-old-space-size=2048',
    'the inherited mutation-loader import is removed from NODE_OPTIONS'
  );
  assert.strictEqual(
    stripLoaderPreload(`--trace-warnings --require="${loaderPath}" --max-old-space-size=2048`, loaderPath),
    '--trace-warnings --max-old-space-size=2048',
    'a legacy mutation-loader require is also removed from NODE_OPTIONS'
  );
  const invalidPackageCwd = path.join(root, 'invalid-package-cwd');
  fs.mkdirSync(invalidPackageCwd, { recursive: true });
  fs.writeFileSync(path.join(invalidPackageCwd, 'package.json'), '{ invalid');
  const preloadProbe = require('child_process').spawnSync(process.execPath, ['-e', "process.stdout.write('preload-ok')"], {
    cwd: invalidPackageCwd,
    env: { ...process.env, NODE_OPTIONS: addLoaderPreload('', loaderPath) },
    encoding: 'utf8',
  });
  assert.strictEqual(preloadProbe.status, 0, `loader import must tolerate an invalid package.json cwd: ${preloadProbe.stderr}`);
  assert.strictEqual(preloadProbe.stdout, 'preload-ok');
  const noOp = prepareMutation({ root, target: 'synthetic-target.js', mutantId: 'test-noop', allowTestMutations: true });
  assert.strictEqual(noOp.applied, false, 'no-op transform is not applied');
  assert.strictEqual(noOp.parses, true, 'no-op source still parses');
  assert.throws(() => prepareMutation({ root, target: 'synthetic-target.js', mutantId: 'not-known', allowTestMutations: true }), /unknown mutant/i);
  assert.throws(() => prepareMutation({ root, target: 'synthetic-other.js', mutantId: 'test-kill', allowTestMutations: true }), /wrong target/i);

  const invalidSyntax = prepareMutation({ root, target: 'synthetic-target.js', mutantId: 'test-syntax', allowTestMutations: true });
  assert.strictEqual(invalidSyntax.applied, true, 'syntax mutant changes bytes');
  assert.strictEqual(invalidSyntax.parses, false, 'syntax mutant is rejected by parser preflight');

  const killed = checkTuple({ mutantId: 'test-kill' });
  assert.strictEqual(killed.verdict, 'KILLED', `only the selected typed assertion qualifies the synthetic mutant: ${JSON.stringify(killed)}`);
  assert.deepStrictEqual({ control: killed.control, applied: killed.applied, parses: killed.parses, loaded: killed.loaded, intendedAssertion: killed.intendedAssertion }, {
    control: 'PASS', applied: true, parses: true, loaded: true, intendedAssertion: 'FAIL'
  });

  const savedEnv = new Map(['HARNESS_MUTATION', 'HARNESS_MUTATION_TARGET', 'HARNESS_MUTATION_LOADER_PRELOAD', 'NODE_OPTIONS']
    .map(key => [key, process.env[key]]));
  try {
    process.env.HARNESS_MUTATION = 'stale-inherited-mutant';
    process.env.HARNESS_MUTATION_TARGET = targetPath;
    process.env.HARNESS_MUTATION_LOADER_PRELOAD = '1';
    process.env.NODE_OPTIONS = inheritedOptions;
    const isolated = checkTuple({ mutantId: 'test-kill' });
    assert.strictEqual(isolated.verdict, 'KILLED', 'control and mutant runs clear inherited selection before setting their own');
  } finally {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const noOpResult = checkTuple({ mutantId: 'test-noop' });
  assert.strictEqual(noOpResult.verdict, 'INVALID_MUTANT', 'no-op mutation cannot receive kill credit');
  assert.strictEqual(noOpResult.applied, false);

  const unknown = checkTuple({ mutantId: 'not-known' });
  assert.strictEqual(unknown.verdict, 'INVALID_MUTANT', 'unknown mutation IDs fail closed');

  const wrongTarget = checkTuple({ mutantId: 'test-kill', target: 'synthetic-other.js' });
  assert.strictEqual(wrongTarget.verdict, 'INVALID_MUTANT', 'a mutation registered for another target fails closed');

  const syntax = checkTuple({ mutantId: 'test-syntax' });
  assert.strictEqual(syntax.verdict, 'INVALID_MUTANT', 'unparseable transformed source cannot be a kill');
  assert.strictEqual(syntax.applied, true);
  assert.strictEqual(syntax.parses, false);

  const survived = checkTuple({ mutantId: 'test-survive' });
  assert.strictEqual(survived.verdict, 'SURVIVED', 'a valid loaded mutation that preserves the asserted behavior survives');
  assert.strictEqual(survived.loaded, true);
  assert.strictEqual(survived.intendedAssertion, 'PASS');

  const controlFailure = checkTuple({ mutantId: 'test-kill', mode: 'control-failure' });
  assert.strictEqual(controlFailure.verdict, 'CONTROL_FAILED', 'a red unmutated control is infrastructure failure');
  assert.strictEqual(controlFailure.applied, false, 'runner stops before mutant preflight after a red control');

  const crash = checkTuple({ mutantId: 'test-crash' });
  assert.notStrictEqual(crash.verdict, 'KILLED', 'an import/runtime crash cannot be credited as a kill');
  assert.strictEqual(crash.loaded, false, 'a module that throws during load has no loaded evidence');

  const exitsDuringLoad = checkTuple({ mutantId: 'test-exit' });
  assert.strictEqual(exitsDuringLoad.verdict, 'INFRA_MUTATED', 'process.exit during module evaluation cannot count as an assertion kill');
  assert.strictEqual(exitsDuringLoad.loaded, true, 'a transformed module that exits during evaluation still emits its load evidence');
  assert.strictEqual(exitsDuringLoad.intendedAssertion, 'MISSING', 'exit without the selected assertion remains unqualified');

  const unrelated = checkTuple({ mutantId: 'test-kill', mode: 'unrelated-assertion' });
  assert.strictEqual(unrelated.verdict, 'INFRA_MUTATED', 'a different assertion ID cannot kill the selected mutant');

  const selectedAndUnrelated = checkTuple({ mutantId: 'test-kill', mode: 'selected-and-unrelated' });
  assert.strictEqual(selectedAndUnrelated.verdict, 'KILLED', 'the exact selected assertion still qualifies when other typed assertions also fail');

  const selectedThenCrash = checkTuple({ mutantId: 'test-kill', mode: 'selected-then-crash' });
  assert.strictEqual(selectedThenCrash.verdict, 'INFRA_MUTATED', 'an uncaught infrastructure exception after an assertion event cannot count as a kill');

  const genericFailure = checkTuple({ mutantId: 'test-kill', mode: 'generic-failure' });
  assert.strictEqual(genericFailure.verdict, 'INFRA_MUTATED', 'generic failure text cannot kill a mutant');
  assert.strictEqual(genericFailure.loaded, true);

  const parityFailure = checkTuple({ mutantId: 'test-kill', mode: 'parity-only-failure' });
  assert.strictEqual(parityFailure.verdict, 'INFRA_MUTATED', 'source/package parity output cannot kill a mutant');
  assert.strictEqual(parityFailure.loaded, true);

  const unloaded = checkTuple({ mutantId: 'test-kill', mode: 'does-not-load-target' });
  assert.strictEqual(unloaded.verdict, 'UNLOADED', 'a matching test event without transformed-module load evidence is unqualified');
  assert.strictEqual(unloaded.loaded, false);

  const timeout = checkTuple({ mutantId: 'test-kill', mode: 'timeout', timeoutMs: 2000 });
  assert.strictEqual(timeout.verdict, 'INFRA_MUTATED', 'a timed-out child cannot count as an intended assertion kill');
  assert.strictEqual(timeout.loaded, true, 'the timeout occurs after the transformed module loaded');

  const nested = checkTuple({ mutantId: 'test-kill', mode: 'nested-process' });
  assert.strictEqual(nested.verdict, 'KILLED', 'mutation preload and load evidence propagate into exact Node child processes');
  assert.strictEqual(nested.loaded, true);

  const legacyHelperCase = 'LEGACY.synthetic-legacy-helper-test';
  const legacyHelper = checkLegacyTuple({
    test: 'synthetic-legacy-helper-test.js',
    caseId: legacyHelperCase,
    assertionId: `${legacyHelperCase}.selected-check`,
    signature: { kind: 'helper', label: 'legacy helper assertion' },
  });
  assert.strictEqual(legacyHelper.verdict, 'KILLED', `legacy helper checks emit a typed selected assertion event: ${JSON.stringify(legacyHelper)}`);

  const legacyAssertCase = 'LEGACY.synthetic-legacy-assert-test';
  const legacyAssert = checkLegacyTuple({
    test: 'synthetic-legacy-assert-test.js',
    caseId: legacyAssertCase,
    assertionId: `${legacyAssertCase}.selected-assert`,
    signature: { kind: 'assert', method: 'strictEqual', messageIndex: 2, message: 'legacy assert assertion' },
  });
  assert.strictEqual(legacyAssert.verdict, 'KILLED', 'legacy Node assert failures emit the exact selected assertion event');

  const legacyCallsiteCase = 'LEGACY.synthetic-legacy-callsite-test';
  const legacyCallsite = checkLegacyTuple({
    test: 'synthetic-legacy-callsite-test.js',
    caseId: legacyCallsiteCase,
    assertionId: `${legacyCallsiteCase}.selected-callsite`,
    signature: { kind: 'assert', method: 'strictEqual', callSite: { file: 'synthetic-legacy-callsite-test.js', line: 3 } },
  });
  assert.strictEqual(legacyCallsite.verdict, 'KILLED', 'legacy assert signatures can qualify an exact source callsite without matching generic failures');

  const legacyOutputCase = 'LEGACY.synthetic-legacy-output-test';
  const legacyOutput = checkLegacyTuple({
    test: 'synthetic-legacy-output-test.js',
    caseId: legacyOutputCase,
    assertionId: `${legacyOutputCase}.selected-output`,
    signature: {
      kind: 'output',
      pass: /^PASS legacy output assertion$/,
      fail: /^FAIL legacy output assertion$/,
    },
  });
  assert.strictEqual(legacyOutput.verdict, 'KILLED', 'anchored legacy output signatures qualify only their selected failure');

  assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), original, 'mutation qualification never overwrites a synthetic target');
  console.log('Phase 0A mutation runner qualification passed: control, tuple, transform, parse, load, intended assertion, and negative controls.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

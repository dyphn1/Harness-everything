'use strict';

// #341 Phase 0C enforcement suite.
// C1 (isolation): the frozen isolation policy is run against the exact canonical and packaged source pairs, and the
// reviewed weakened-boundary transforms are applied in memory. Every negative asserts its pinned ruleId; runtime or
// load failures do not count as enforcement. COMP-C2-BOUND N05/N06 are deliberate C1 survivors.
// C2 (ast, c2.md Requests 1-3): the same transforms are rejected by the pinned AST supplement, with complete
// structure coverage. Positive controls cover local rename, format and comment changes. Fail-closed controls cover
// invalid syntax and parser-version mismatch. AST-path sensitivity controls disable only the AST target-drift or
// program-drift sink in the actually loaded checker source. Fingerprints are never regenerated or accepted here.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { checkBoundary } = require('./lib/doc-evidence-boundary-check');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'read-boundary');
const POLICY_PATH = path.join(FIXTURE_DIR, 'boundary-policy.json');
const CONTROLS_PATH = path.join(FIXTURE_DIR, 'boundary-controls.json');
const CHECKER_PATH = path.join(__dirname, 'lib', 'doc-evidence-boundary-check.js');
const policyText = fs.readFileSync(POLICY_PATH, 'utf8');
const policy = JSON.parse(policyText);
const controls = JSON.parse(fs.readFileSync(CONTROLS_PATH, 'utf8'));
// C2 (AST) covers only controls with an AST route. N02c is isolation-only: its AST rejection would be a numbering side effect.
const astControls = controls.controls.filter(control => !control.routes || control.routes.includes('ast'));
// Code-level expectations (isolation route). Several codes share one ruleId, so an alias or return rule can be removed
// without changing the rule-level outcome; these assertions pin the specific emitter each control must trigger.
// AST-route pinned target expected for controls whose AST rejection must come from a named target (c2-fix).
const INTENDED_AST_TARGETS = {
  N02c: { contract: 'ast-target-context-destructure', location: '@evaluateObligation-context-destructure' }
};
const INTENDED_CODES = {
  N01: ['CONTEXT_ALIAS_OR_COMPUTED_USE'],
  N02: ['CONTEXT_ALIAS_OR_COMPUTED_USE'],
  N01d: ['CONTEXT_ALIAS_OR_COMPUTED_USE'],
  N02d: ['CONTEXT_ALIAS_OR_COMPUTED_USE'],
  N02c: ['CONTEXT_CONSUMER_SURFACE'],
  N03: ['RETURNED_VIEW_ESCAPE'],
  N04: ['RETURNED_VIEW_ESCAPE']
};
const checkerRequire = createRequire(CHECKER_PATH);

const EVENT_FILE = process.env.HARNESS_ASSERTION_EVENT_FILE;
const SELECTED_ASSERTION = process.env.HARNESS_ASSERTION_ID;
const SELECTED_CASE = process.env.HARNESS_CASE_ID
  || (SELECTED_ASSERTION ? SELECTED_ASSERTION.slice(0, SELECTED_ASSERTION.indexOf('.')) : undefined);
const claimedAssertions = new Set();
const claimedCases = new Set();
const failures = [];

const FAIL_CLOSED_CODES = ['SOURCE_PAIR_MISSING', 'AST_POLICY_INVALID', 'AST_PARSER_UNAVAILABLE', 'AST_PARSE_FAILED',
  'AST_NODE_UNSUPPORTED', 'AST_TARGET_INCOMPLETE', 'CHECKER_FAIL_CLOSED', 'CHECKER_EXECUTION_FAILED',
  'CHECKER_EXECUTION_TIMEOUT', 'MODULE_LOAD_FAILED', 'MODULE_IMPORT_DENIED'];

const LOOP_CONTROL_CHILD_TIMEOUT_MS = 5000;

function emit(event) {
  if (!EVENT_FILE) return;
  fs.appendFileSync(EVENT_FILE, `${JSON.stringify({ schemaVersion: 1, ...event })}\n`, 'utf8');
}

function assertion(caseId, contract, run) {
  const assertionId = `${caseId}.${contract}`;
  claimedCases.add(caseId);
  claimedAssertions.add(assertionId);
  if (SELECTED_CASE && SELECTED_CASE !== caseId) return;
  if (SELECTED_ASSERTION && SELECTED_ASSERTION !== assertionId) return;
  try {
    run();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    failures.push(assertionId);
    emit({ event: 'assertion-failure', caseId, assertionId, errorCode: 'ERR_ASSERTION',
      message: String(error.message).split('\n')[0] });
    console.error(`FAIL ${assertionId}: ${String(error.message).split('\n')[0]}`);
    return;
  }
  emit({ event: 'assertion-pass', caseId, assertionId });
  console.log(`PASS ${assertionId}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourcePair(distribution, files) {
  const selected = policy.distributions[distribution];
  if (!selected || files.evaluator !== selected.evaluator || files.capture !== selected.capture) {
    throw new Error(`fixture paths do not match frozen policy for ${distribution}`);
  }
  return {
    evaluator: fs.readFileSync(path.join(ROOT, selected.evaluator), 'utf8'),
    capture: fs.readFileSync(path.join(ROOT, selected.capture), 'utf8')
  };
}

function applyControl(control, original) {
  const sources = { ...original };
  for (const transform of control.transforms) {
    if (!['evaluator', 'capture'].includes(transform.file)
      || typeof transform.from !== 'string' || typeof transform.to !== 'string') {
      throw new Error(`${control.id}: malformed transform`);
    }
    const occurrences = sources[transform.file].split(transform.from).length - 1;
    if (occurrences !== 1) {
      throw new Error(`${control.id}: ${transform.file} anchor occurred ${occurrences} times, expected once`);
    }
    sources[transform.file] = sources[transform.file].replace(transform.from, transform.to);
  }
  if (sources.evaluator === original.evaluator && sources.capture === original.capture) {
    throw new Error(`${control.id}: neither source was weakened`);
  }
  for (const kind of ['evaluator', 'capture']) {
    new vm.Script(sources[kind], { filename: `${control.id}/${kind}.js` });
  }
  return sources;
}

function insertInfiniteLoop(source, functionName) {
  const signature = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'g'); // portability-lint: allow RegExp source, not a path
  const matches = [...source.matchAll(signature)];
  assert.equal(matches.length, 1, `${functionName}: expected exactly one function entrypoint`);
  const weakened = source.replace(signature, match => `${match}\n  while (true) {}`);
  new vm.Script(weakened, { filename: `timeout-control/${functionName}.js` });
  return weakened;
}

function boundedLoopControlResult(input, label) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [CHECKER_PATH, '--c1-test-fast-isolation'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: LOOP_CONTROL_CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(child.error && child.error.code, undefined,
    `${label}: the bounded test child must finish before ${LOOP_CONTROL_CHILD_TIMEOUT_MS}ms`);
  assert.equal(child.signal, null, `${label}: the bounded test child was not terminated`);
  assert.equal(child.status, 0, `${label}: child exit ${child.status}; stderr=${child.stderr}`);
  const result = JSON.parse(child.stdout);
  assert.equal(result.coverage.complete, false, `${label}: timeout leaves C1 coverage incomplete`);
  assert.deepEqual(result.diagnostics.map(item => item.code), ['CHECKER_EXECUTION_TIMEOUT'],
    `${label}: the argv-gated short-deadline path returns only the deterministic fail-closed diagnostic`);
  return { result, elapsedMs };
}

function appendAfterCaptureExports(source, injectedLines) {
  const anchor = 'module.exports = { createInvocationCapture };';
  assert.equal(source.split(anchor).length - 1, 1,
    'capture source must have one exact module export anchor');
  return source.replace(anchor, [anchor, ...injectedLines].join('\n'));
}

function insertHostArgumentProbe(source, functionName) {
  const signature = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'g'); // portability-lint: allow RegExp source, not a path
  assert.equal([...source.matchAll(signature)].length, 1,
    `${functionName}: expected exactly one host-argument probe entrypoint`);
  const probe = [
    '  for (const candidate of [arguments[0], arguments[0] && arguments[0].obligations, arguments[0] && arguments[0].artifacts]) {',
    '    if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) continue;',
    '    try {',
    "      candidate.constructor.constructor('return process')();",
    "      throw new Error('__C1_HOST_ARGUMENT_ESCAPED__');",
    '    } catch (error) {',
    "      if (error && error.message === '__C1_HOST_ARGUMENT_ESCAPED__') throw error;",
    '    }',
    '  }'
  ].join('\n');
  return source.replace(signature, match => `${match}\n${probe}`);
}

function insertHostArrayCallbackProbe(source) {
  const anchor = `baselineEntries() {
          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry }));
        },`;
  assert.equal(source.split(anchor).length - 1, 1,
    'capture source must have one exact baselineEntries callback probe anchor');
  return source.replace(anchor, `baselineEntries() {
          const entries = [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry }));
          const nativeEvery = Array.prototype.every;
          Array.prototype.every = function (callback) {
            try {
              callback.constructor.constructor('return process')();
              throw new Error('__C1_HOST_CALLBACK_ESCAPED__');
            } catch (error) {
              if (error && error.message === '__C1_HOST_CALLBACK_ESCAPED__') throw error;
            }
            return nativeEvery.call(this, callback);
          };
          return entries;
        },`);
}

function insertHostBridgeProbe(source) {
  return appendAfterCaptureExports(source, [
    'try {',
    "  const escapedProcess = crypto.createHash.constructor('return process')();",
    "  module.exports.__cryptoEscapedHostProcess = typeof escapedProcess.pid === 'number';",
    '} catch {}',
    'try {',
    "  const escapedProcess = require.constructor('return process')();",
    "  module.exports.__requireEscapedHostProcess = typeof escapedProcess.pid === 'number';",
    '} catch {}'
  ]);
}

function insertSigtermResistantEscape(source) {
  return appendAfterCaptureExports(source, [
    "const hostProcess = crypto.createHash.constructor('return process')();",
    "hostProcess.on('SIGTERM', () => {});",
    "const hostSetInterval = crypto.createHash.constructor('return setInterval')();",
    'hostSetInterval(() => {}, 1000);'
  ]);
}

function boundedDirectControlResult(input, label) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [CHECKER_PATH, '--c1-isolation-child'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: LOOP_CONTROL_CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(child.error && child.error.code, undefined,
    `${label}: the SIGKILL-guarded checker child must finish before ${LOOP_CONTROL_CHILD_TIMEOUT_MS}ms`);
  assert.equal(child.signal, null, `${label}: checker child was not terminated`);
  assert.equal(child.status, 0, `${label}: child exit ${child.status}; stderr=${child.stderr}`);
  return { result: JSON.parse(child.stdout), elapsedMs };
}

function boundedSigkillControlResult(label) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [CHECKER_PATH, '--c1-timeout-kill-test'], {
    encoding: 'utf8',
    timeout: LOOP_CONTROL_CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(child.error && child.error.code, undefined,
    `${label}: external SIGKILL deadline ${LOOP_CONTROL_CHILD_TIMEOUT_MS}ms must contain the control`);
  assert.equal(child.signal, null, `${label}: timeout wrapper finished before the external deadline`);
  assert.equal(child.status, 0, `${label}: wrapper exit ${child.status}; stderr=${child.stderr}`);
  return { result: JSON.parse(child.stdout), elapsedMs };
}

function controlStatus(result, intendedRuleId) {
  if (result.diagnostics.some(diagnostic => diagnostic.ruleId === intendedRuleId)) return 'REJECTED';
  if (result.coverage.complete && result.diagnostics.length === 0) return 'SURVIVED';
  return 'UNCHECKED';
}

// C1 expectation: the pinned status for each control (N05/N06 are deliberate isolation survivors).
function assertExpectedControl(control, result) {
  const intended = result.diagnostics.filter(diagnostic => diagnostic.ruleId === control.intendedRuleId);
  const actual = controlStatus(result, control.intendedRuleId);
  assert.equal(actual, control.expectedC1Status,
    `${control.id}: intended ${control.intendedRuleId}; expected ${control.expectedC1Status}, got ${actual}; diagnostics=${JSON.stringify(result.diagnostics)}; missing=${JSON.stringify(result.coverage.missing)}`);
  if (control.expectedC1Status === 'REJECTED') {
    assert.ok(intended.length > 0, `${control.id}: rejection must carry intended rule ${control.intendedRuleId}`);
    assert.ok(!result.diagnostics.some(item => FAIL_CLOSED_CODES.includes(item.code)),
      `${control.id}: a checker/load failure is not enforcement`);
  } else if (control.expectedC1Status === 'SURVIVED') {
    assert.equal(result.coverage.complete, true, `${control.id}: survivor must complete declared C1 coverage`);
    assert.deepEqual(result.diagnostics, [], `${control.id}: survivor has no boundary diagnostics`);
  }
}

// C2 expectation: every N01-N09 control, including the dormant variants, must be rejected by its pinned AST rule with
// complete structure coverage and no fail-closed condition. A survivor under the AST route is a failure.
function assertAstComplete(result, label) {
  assert.equal(result.method, 'ast', `${label}: AST route ran`);
  assert.ok(result.coverage.checked.includes('source-pair'), `${label}: source pair checked`);
  assert.ok(result.coverage.checked.includes('ast-structure'), `${label}: AST structure checked`);
  assert.deepEqual(result.coverage.missing, [], `${label}: no declared AST coverage missing`);
  assert.equal(result.coverage.complete, true, `${label}: AST coverage is complete`);
}

function assertAstRejection(control, result) {
  assertAstComplete(result, control.id);
  assert.ok(!result.diagnostics.some(item => FAIL_CLOSED_CODES.includes(item.code)),
    `${control.id}: a fail-closed AST condition is not enforcement (${JSON.stringify(result.diagnostics.map(item => item.code))})`);
  const intended = result.diagnostics.filter(diagnostic => diagnostic.ruleId === control.intendedRuleId);
  assert.ok(intended.length > 0, `${control.id}: AST rejection must carry intended rule ${control.intendedRuleId}; diagnostics=${JSON.stringify(result.diagnostics)}`);
  if (control.intendedRuleId === 'COMP-C2-BOUND') {
    assert.ok(intended.every(item => item.exceptionId === 'COMP-C2-BOUND'),
      `${control.id}: the exception rule must name its bounded exception ID`);
  }
}

function loadCheckerFromSource(source) {
  const isolatedModule = { exports: {} };
  const allowed = new Set(['node:child_process', 'node:fs', 'acorn', 'acorn-walk', 'acorn/package.json', 'acorn-walk/package.json']);
  const sandbox = {
    module: isolatedModule,
    exports: isolatedModule.exports,
    require(specifier) {
      if (specifier === 'node:vm') return vm;
      if (specifier === 'node:crypto') return crypto;
      if (allowed.has(specifier)) return checkerRequire(specifier);
      throw new Error(`checker self-test denied import ${String(specifier)}`);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: 'ci/lib/doc-evidence-boundary-check.js', timeout: 5000 });
  if (typeof isolatedModule.exports.checkBoundary !== 'function') {
    throw new Error('mutated checker source did not export checkBoundary');
  }
  const check = isolatedModule.exports.checkBoundary;
  // The sandbox has its own Array/Object realm. Round-trip results so node:assert compares them as ordinary values;
  // without this, deepStrictEqual([], []) fails across realms and a sensitivity check can pass for the wrong reason.
  return input => JSON.parse(JSON.stringify(check(input)));
}

function noDiagnosticsChecker() {
  const source = fs.readFileSync(CHECKER_PATH, 'utf8');
  const activeAdd = `  const add = (code, file, location, ruleId, exceptionId) => {\n    diagnostics.push({\n      code,\n      file: typeof file === 'string' ? file : '<policy>',\n      location: typeof location === 'string' ? location : 'input',\n      ruleId,\n      ...(exceptionId ? { exceptionId } : {})\n    });\n  };`;
  const disabledAdd = `  let __c1TestAddSinkCalls = 0;\n  const add = (code, file, location, ruleId, exceptionId) => {\n    void [code, file, location, ruleId, exceptionId];\n    __c1TestAddSinkCalls++;\n  };`;
  const count = source.split(activeAdd).length - 1;
  assert.equal(count, 1, 'checker-disable self-test must find exactly one diagnostic sink');
  let disabledSource = source.replace(activeAdd, disabledAdd);
  const finalReturn = `  return {\n    method,\n    coverage: { complete: missing.length === 0, checked, missing: unique(missing) },\n    diagnostics\n  };\n}\n\nfunction runAstBoundaryCheck`;
  const instrumentedReturn = `  return {\n    method,\n    coverage: { complete: missing.length === 0, checked, missing: unique(missing), testAddSinkCalls: __c1TestAddSinkCalls },\n    diagnostics\n  };\n}\n\nfunction runAstBoundaryCheck`;
  assert.equal(disabledSource.split(finalReturn).length - 1, 1,
    'checker-disable self-test must find exactly one C1 result return for its sink sentinel');
  disabledSource = disabledSource.replace(finalReturn, instrumentedReturn);

  // Run the transformed module as an actual CLI child. This uses the production --c1-isolation-child entrypoint,
  // with real process/filename bindings and the same child boundary as checkBoundary().
  const tempDir = fs.mkdtempSync(path.join(FIXTURE_DIR, '.c1-disabled-checker-'));
  const baselinePath = path.join(tempDir, 'doc-evidence-boundary-check-baseline.js');
  const disabledPath = path.join(tempDir, 'doc-evidence-boundary-check-disabled.js');
  fs.writeFileSync(baselinePath, source, 'utf8');
  fs.writeFileSync(disabledPath, disabledSource, 'utf8');
  return {
    baseline(input) {
      return runCheckerChild(baselinePath, input, 'unchanged baseline');
    },
    run(input) {
      return runCheckerChild(disabledPath, input, 'disabled checker');
    },
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function runCheckerChild(checkerPath, input, label) {
  const child = spawnSync(process.execPath, [checkerPath, '--c1-isolation-child'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: LOOP_CONTROL_CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(child.error && child.error.code, undefined,
    `${label}: real C1 child must finish before ${LOOP_CONTROL_CHILD_TIMEOUT_MS}ms`);
  assert.equal(child.signal, null, `${label}: real C1 child must not be terminated`);
  assert.equal(child.status, 0, `${label}: real C1 child exit ${child.status}; stderr=${child.stderr}`);
  let result;
  assert.doesNotThrow(() => { result = JSON.parse(child.stdout); }, `${label}: child must return JSON`);
  assert.ok(result && typeof result === 'object' && Array.isArray(result.diagnostics),
    `${label}: child must return a boundary result`);
  return result;
}

// Disables one AST drift emission only. AST checkBoundary dispatches directly to runAstBoundaryCheck before it reads
// process or __filename, so this VM-only source loader remains valid for the AST route.
function astDriftDisabledChecker(emissionCode) {
  const source = fs.readFileSync(CHECKER_PATH, 'utf8');
  const line = new RegExp(`^\\s*add\\('${emissionCode}'.*$`, 'gm'); // portability-lint: allow regex source, not a file name
  const matches = source.match(line) || [];
  assert.equal(matches.length, 1, `${emissionCode} disable self-test must find exactly one emission`);
  return loadCheckerFromSource(source.replace(line, '      void 0;'));
}

console.log('=== #341 Phase 0C enforcement (C1 isolation + C2 ast) ===');
assert.equal(policy.status, 'frozen-for-c1', 'boundary policy is frozen for the C1 trial');
assert.equal(controls.phase, 'C1', 'control inventory targets C1');
assert.equal(controls.expectedRuleIdsPending, false, 'all intended rule IDs are pinned independently of observed output');
assert.ok(controls.controls.length > 0, 'control inventory is nonempty');
for (const control of controls.controls) {
  assert.equal(typeof control.intendedRuleId, 'string', `${control.id} pins an intended rule ID`);
  assert.ok(['REJECTED', 'SURVIVED'].includes(control.expectedC1Status), `${control.id} pins an expected C1 outcome`);
}

if (SELECTED_CASE && !/^C[12]-[A-Za-z0-9-]+$/.test(SELECTED_CASE)) {
  console.error(`infrastructure: invalid HARNESS_CASE_ID ${SELECTED_CASE}`);
  process.exit(2);
}
if (SELECTED_ASSERTION && (!SELECTED_CASE || !SELECTED_ASSERTION.startsWith(`${SELECTED_CASE}.`))) {
  console.error(`infrastructure: HARNESS_ASSERTION_ID ${SELECTED_ASSERTION} does not belong to case ${SELECTED_CASE}`);
  process.exit(2);
}

const policyHashAtStart = sha256(POLICY_PATH);

for (const [distribution, files] of Object.entries(controls.distributions)) {
  const original = sourcePair(distribution, files);

  // ---- C1 isolation ----
  const positive = checkBoundary({ distribution, sources: original, policy, method: 'isolation' });
  const positiveCase = `C1-positive-${distribution}`;
  assertion(positiveCase, 'boundary.complete-isolation-policy', () => {
    assert.equal(positive.coverage.complete, true, `${distribution}: unchanged pair has complete coverage`);
    assert.deepEqual(positive.diagnostics, [], `${distribution}: unchanged pair has no diagnostics`);
  });

  for (const control of controls.controls) {
    const caseId = `C1-${control.id}-${distribution}`;
    const sources = applyControl(control, original);
    const result = checkBoundary({ distribution, sources, policy, method: 'isolation' });
    const ruleName = control.intendedRuleId.replace(/[^A-Za-z0-9-]/g, '-');
    assertion(caseId, `boundary.intended-rule-${ruleName}`, () => assertExpectedControl(control, result));
    for (const code of INTENDED_CODES[control.id] || []) {
      assertion(caseId, `boundary.intended-code-${code}`, () => {
        assert.ok(result.diagnostics.some(item => item.code === code),
          `${control.id}: the ${code} emitter must fire; diagnostics=${JSON.stringify(result.diagnostics.map(item => item.code))}`);
      });
    }
    const diagnostics = result.diagnostics.map(item => `${item.code}/${item.ruleId}${item.exceptionId ? `/${item.exceptionId}` : ''}`).join(',') || 'none';
    console.log(`EVIDENCE ${caseId} expected=${control.expectedC1Status} actual=${controlStatus(result, control.intendedRuleId)} coverage=${result.coverage.complete ? 'complete' : `missing:${result.coverage.missing.join(',')}`} diagnostics=${diagnostics}`);
  }

  // Prove N01/N02/N03 rejection assertions are rule-sensitive: a test-only mutation of the actual C1 checker source
  // runs as a real child through --c1-isolation-child. The sentinel distinguishes a reached no-diagnostics sink from
  // any generic fail-closed/infrastructure result.
  const disabledChecker = noDiagnosticsChecker();
  try {
    for (const id of ['N01', 'N02', 'N03']) {
      const control = controls.controls.find(item => item.id === id);
      if (!control) throw new Error(`checker-disable self-test missing ${id}`);
      const sources = applyControl(control, original);
      const input = { distribution, sources, policy, method: 'isolation' };
      const baseline = disabledChecker.baseline(input);
      assertExpectedControl(control, baseline);
      const disabledResult = disabledChecker.run(input);
      const caseId = `C1-checker-disabled-${id}-${distribution}`;
      assertion(caseId, 'assertion.child-sink-sensitivity', () => {
        assert.ok(!disabledResult.diagnostics.some(item => FAIL_CLOSED_CODES.includes(item.code)),
          `${id}: fail-closed or infrastructure results cannot count as a sensitivity kill; diagnostics=${JSON.stringify(disabledResult.diagnostics)}`);
        assert.ok(disabledResult.coverage.testAddSinkCalls > 0,
          `${id}: disabled add() sink must be reached in the real child; sentinel=${disabledResult.coverage.testAddSinkCalls}`);
        assert.ok(!disabledResult.diagnostics.some(item => item.ruleId === control.intendedRuleId),
          `${id}: disabled checker must omit intended rule ${control.intendedRuleId}`);
        assert.throws(() => assertExpectedControl(control, disabledResult), error =>
          error instanceof assert.AssertionError
            && error.message.includes(`intended ${control.intendedRuleId}; expected REJECTED`),
        `${id}: intended-rule assertion must fail because its diagnostic is missing`);
        console.log(`EVIDENCE ${caseId} baseline=REJECTED intended=${control.intendedRuleId} disabled=missing sentinel=${disabledResult.coverage.testAddSinkCalls} infrastructure=none`);
      });
    }
  } finally {
    disabledChecker.cleanup();
  }

  // ---- C2 ast (persistent, per luna's Requests 1-3) ----
  const astPositive = checkBoundary({ distribution, sources: original, policy, method: 'ast' });
  assertion(`C2-positive-${distribution}`, 'boundary.ast-complete-unchanged', () => {
    assertAstComplete(astPositive, `${distribution}: unchanged pair`);
    assert.deepEqual(astPositive.diagnostics, [], `${distribution}: unchanged pair has no AST diagnostics`);
  });

  for (const control of astControls) {
    const caseId = `C2-${control.id}-${distribution}`;
    const ruleName = control.intendedRuleId.replace(/[^A-Za-z0-9-]/g, '-');
    assertion(caseId, 'transform.applied-exactly-once', () => {
      const sources = applyControl(control, original);
      assert.ok(sources.evaluator !== original.evaluator || sources.capture !== original.capture,
        `${control.id}: the transform changed the selected pair`);
    });
    const sources = applyControl(control, original);
    const astResult = checkBoundary({ distribution, sources, policy, method: 'ast' });
    assertion(caseId, `boundary.ast-intended-rule-${ruleName}`, () => assertAstRejection(control, astResult));
    if (INTENDED_AST_TARGETS[control.id]) {
      const pinned = INTENDED_AST_TARGETS[control.id];
      assertion(caseId, `boundary.${pinned.contract}`, () => {
        assert.ok(astResult.diagnostics.some(item => item.location === pinned.location && item.ruleId === control.intendedRuleId),
          `${control.id}: the AST rejection must come from pinned target ${pinned.location} under ${control.intendedRuleId}; diagnostics=${JSON.stringify(astResult.diagnostics.map(item => item.location + '/' + item.ruleId))}`);
      });
    }
    const diagnostics = astResult.diagnostics.map(item => `${item.code}/${item.ruleId}${item.exceptionId ? `/${item.exceptionId}` : ''}`).join(',') || 'none';
    console.log(`EVIDENCE ${caseId} expected=REJECTED actual=${astResult.diagnostics.some(item => item.ruleId === control.intendedRuleId) ? 'REJECTED' : 'NOT-REJECTED'} coverage=${astResult.coverage.complete ? 'complete' : `missing:${astResult.coverage.missing.join(',')}`} diagnostics=${diagnostics}`);
  }

  // Positive: a unique local rename of a declared capture-module local, and a formatting/comment-only change.
  const capturePresent = original.capture.split('candidateDigestCache').length - 1;
  assert.ok(capturePresent > 0, 'the rename positive control has a local to rename');
  const renamed = { evaluator: original.evaluator, capture: original.capture.split('candidateDigestCache').join('uniqueCandidateDigestCacheAlias') };
  assertion(`C2-positive-rename-${distribution}`, 'boundary.ast-accepts-local-rename', () => {
    const result = checkBoundary({ distribution, sources: renamed, policy, method: 'ast' });
    assertAstComplete(result, `${distribution}: local rename`);
    assert.deepEqual(result.diagnostics, [], `${distribution}: a unique local rename is accepted`);
  });
  const formatted = {
    evaluator: original.evaluator.replace(/\n/g, '\r\n'),
    capture: `${original.capture.replace(/\n/g, '\r\n')}\r\n// C2 positive control: trailing comment, formatting only.\r\n`
  };
  assertion(`C2-positive-format-${distribution}`, 'boundary.ast-accepts-format-and-comments', () => {
    const result = checkBoundary({ distribution, sources: formatted, policy, method: 'ast' });
    assertAstComplete(result, `${distribution}: formatting and comments`);
    assert.deepEqual(result.diagnostics, [], `${distribution}: CRLF and trailing comments are accepted`);
  });

  // Locality (c2-fix): a benign unused local inside one unrelated function must drift only that function's target. The
  // full-program fingerprint still reports the edit. Before c2-fix a single new local moved six unrelated targets.
  const LOCALITY_ANCHOR = 'function isPlainObject(value) {\n  return Boolean(value) && typeof value === \'object\' && !Array.isArray(value);\n}';
  assert.equal(original.capture.split(LOCALITY_ANCHOR).length - 1, 1, 'the locality probe has one isPlainObject anchor');
  const localityCapture = original.capture.replace(LOCALITY_ANCHOR, () => LOCALITY_ANCHOR.replace('{\n  return', '{\n  const unrelatedProbeLocal = 1;\n  void unrelatedProbeLocal;\n  return'));
  assertion(`C2-locality-${distribution}`, 'boundary.ast-benign-local-stays-local', () => {
    const result = checkBoundary({ distribution, sources: { evaluator: original.evaluator, capture: localityCapture }, policy, method: 'ast' });
    assert.equal(result.coverage.complete, true, `${distribution}: the locality probe keeps complete AST coverage`);
    const targetDrift = result.diagnostics.filter(item => item.code === 'AST_TARGET_DRIFT').map(item => item.location);
    assert.deepEqual(targetDrift, ['isPlainObject'], `${distribution}: only the edited target drifts; saw ${JSON.stringify(targetDrift)}`);
    assert.ok(result.diagnostics.some(item => item.code === 'AST_PROGRAM_DRIFT'), `${distribution}: the full-program fingerprint still reports the edit`);
  });

  // Fail-closed: invalid syntax, and a parser-version pin that does not match the installed parser.
  const syntaxMarker = 'function checkDocObligations(';
  assert.equal(original.evaluator.split(syntaxMarker).length - 1, 1, 'the syntax fail-closed control has one anchor');
  const badSyntax = { evaluator: original.evaluator.replace(syntaxMarker, 'function checkDocObligations((('), capture: original.capture };
  assertion(`C2-failclosed-syntax-${distribution}`, 'boundary.ast-fails-closed-on-syntax', () => {
    const result = checkBoundary({ distribution, sources: badSyntax, policy, method: 'ast' });
    assert.equal(result.coverage.complete, false, 'invalid syntax is incomplete coverage');
    assert.ok(!result.coverage.checked.includes('ast-structure'), 'invalid syntax never checks AST structure');
    assert.ok(result.diagnostics.some(item => item.code === 'AST_PARSE_FAILED' && item.ruleId === 'AST_PARSE_COMPLETE'),
      'invalid syntax reports AST_PARSE_FAILED under AST_PARSE_COMPLETE');
  });
  const pinMismatch = JSON.parse(JSON.stringify(policy));
  pinMismatch.astSupplement.parser.acorn = '0.0.0';
  assertion(`C2-failclosed-parser-pin-${distribution}`, 'boundary.ast-fails-closed-on-parser-pin', () => {
    const result = checkBoundary({ distribution, sources: original, policy: pinMismatch, method: 'ast' });
    assert.equal(result.coverage.complete, false, 'a parser-version mismatch is incomplete coverage');
    assert.ok(result.diagnostics.some(item => item.code === 'AST_PARSER_UNAVAILABLE' && item.ruleId === 'AST_PARSER_PINNED'),
      'a parser-version mismatch reports AST_PARSER_UNAVAILABLE under AST_PARSER_PINNED');
  });

  // AST-path sensitivity: disable only the AST target-drift emission in the actually loaded checker source. Every
  // N01-N09 AST rejection must then fail its intended-rule assertion, so the AST rule path is what is being tested.
  const targetDisabled = astDriftDisabledChecker('AST_TARGET_DRIFT');
  for (const control of astControls) {
    const sources = applyControl(control, original);
    const disabledResult = targetDisabled({ distribution, sources, policy, method: 'ast' });
    assertion(`C2-checker-disabled-ast-target-${control.id}-${distribution}`, 'assertion.rejects-disabled-ast-target', () => {
      assert.throws(() => assertAstRejection(control, disabledResult),
        error => error instanceof assert.AssertionError && error.message.includes('AST rejection must carry intended rule'),
        `${control.id}: the AST rejection assertion must fail on the missing intended rule when AST target-drift emission is disabled`);
    });
  }

  // Separation: with only the program-drift emission disabled, the target-level catches of N05/N06 must still reject.
  const programDisabled = astDriftDisabledChecker('AST_PROGRAM_DRIFT');
  for (const id of ['N05', 'N06']) {
    const control = controls.controls.find(item => item.id === id);
    if (!control) throw new Error(`AST program-drift self-test missing ${id}`);
    const sources = applyControl(control, original);
    const programResult = programDisabled({ distribution, sources, policy, method: 'ast' });
    assertion(`C2-checker-program-drift-disabled-${id}-${distribution}`, 'assertion.target-drift-still-rejects', () => {
      assertAstRejection(control, programResult);
    });
  }
}

// C1 infinite-loop controls use the argv-gated 1,000 ms deadline; production C1 has a 10,000 ms hosted-runner budget.
const [loopDistribution, loopFiles] = Object.entries(controls.distributions)[0];
const loopOriginal = sourcePair(loopDistribution, loopFiles);
for (const control of [
  { caseId: 'C1-timeout-evaluator-loop', kind: 'evaluator', functionName: 'checkDocObligations' },
  { caseId: 'C1-timeout-capture-loop', kind: 'capture', functionName: 'createInvocationCapture' }
]) {
  const sources = { ...loopOriginal, [control.kind]: insertInfiniteLoop(loopOriginal[control.kind], control.functionName) };
  assertion(control.caseId, 'execution-timeout.fails-closed', () => {
    const { elapsedMs } = boundedLoopControlResult({
      distribution: loopDistribution,
      sources,
      policy,
      method: 'isolation'
    }, control.caseId);
    console.log(`EVIDENCE ${control.caseId} result=CHECKER_EXECUTION_TIMEOUT elapsedMs=${elapsedMs}`);
  });
}

assertion('C1-timeout-sigkill-load-bearing', 'sigkill-terminates-sigterm-resistant-child', () => {
  const { result, elapsedMs } = boundedSigkillControlResult('C1-timeout-sigkill-load-bearing');
  assert.equal(result.coverage.complete, false, 'the actual C1 deadline leaves coverage incomplete');
  const diagnosticCodes = result.diagnostics.map(item => item.code);
  assert.deepEqual(diagnosticCodes, ['CHECKER_EXECUTION_TIMEOUT'],
    `SIGKILL timeout is classified as CHECKER_EXECUTION_TIMEOUT; actual=${diagnosticCodes.join(',')}`);
  console.log(`EVIDENCE C1-timeout-sigkill-load-bearing result=CHECKER_EXECUTION_TIMEOUT elapsedMs=${elapsedMs} outerDeadlineMs=${LOOP_CONTROL_CHILD_TIMEOUT_MS}`);
});

assertion('C1-host-bridge-probe', 'host-function-constructors-are-unreachable', () => {
  const sources = {
    evaluator: insertHostArgumentProbe(loopOriginal.evaluator, 'checkDocObligations'),
    capture: insertHostArgumentProbe(
      insertHostBridgeProbe(insertHostArrayCallbackProbe(loopOriginal.capture)), 'createInvocationCapture')
  };
  const { result, elapsedMs } = boundedDirectControlResult({
    distribution: loopDistribution,
    sources,
    policy,
    method: 'isolation'
  }, 'C1-host-bridge-probe');
  console.log(`EVIDENCE C1-host-bridge-probe complete=${result.coverage.complete} diagnostics=${result.diagnostics.map(item => item.code).join(',')} elapsedMs=${elapsedMs}`);
  assert.equal(result.coverage.complete, true, 'blocked bridge probes leave C1 coverage complete');
  assert.deepEqual(result.diagnostics.map(item => item.code), ['MODULE_IMPORT_SURFACE'],
    'only the intentional require-surface mutation is diagnosed');
  assert.ok(!result.diagnostics.some(item => item.code === 'MODULE_EXPORT_SURFACE'),
    'neither exposed crypto nor require yields a host process export');
  console.log(`EVIDENCE C1-host-bridge-probe result=BLOCKED elapsedMs=${elapsedMs}`);
});

assertion('C1-timeout-sigterm-resistant', 'escape-is-rejected-within-external-deadline', () => {
  const sources = { ...loopOriginal, capture: insertSigtermResistantEscape(loopOriginal.capture) };
  const { result, elapsedMs } = boundedDirectControlResult({
    distribution: loopDistribution,
    sources,
    policy,
    method: 'isolation'
  }, 'C1-timeout-sigterm-resistant');
  assert.equal(result.coverage.complete, false, 'the escaped SIGTERM-resistant child is rejected');
  assert.ok(result.diagnostics.some(item => FAIL_CLOSED_CODES.includes(item.code)),
    `the SIGTERM-resistant control must fail closed; diagnostics=${JSON.stringify(result.diagnostics)}`);
  console.log(`EVIDENCE C1-timeout-sigterm-resistant result=${result.diagnostics[0].code} elapsedMs=${elapsedMs}`);
});

// Fingerprints are reviewed inputs. This run must never rewrite the policy or its pinned fingerprints.
assertion('C2-guard', 'boundary.policy-hash-stable', () => {
  assert.equal(sha256(POLICY_PATH), policyHashAtStart, 'the frozen policy file is unchanged by the suite');
});

if (SELECTED_ASSERTION && !claimedAssertions.has(SELECTED_ASSERTION)) {
  console.error(`infrastructure: unknown HARNESS_ASSERTION_ID ${SELECTED_ASSERTION}`);
  process.exit(2);
}
if (SELECTED_CASE && !claimedCases.has(SELECTED_CASE)) {
  console.error(`infrastructure: unknown HARNESS_CASE_ID ${SELECTED_CASE}`);
  process.exit(2);
}
if (failures.length) {
  console.error(`FAIL ${failures.length} enforcement assertion(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('PASS all C1 isolation controls, C2 AST controls, positive/fail-closed controls, and AST-path sensitivity');

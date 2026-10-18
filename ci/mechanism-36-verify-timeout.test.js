const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const helper = require('./test-helper');

const root = helper.root;
const pluginSource = fs.readFileSync(path.join(root, 'opencode-plugin', 'index.mjs'), 'utf8');
const cliSource = fs.readFileSync(path.join(root, 'opencode-plugin', 'hooks', 'verify.js'), 'utf8');

function extractConst(source, name) {
  const match = source.match(new RegExp(`^const ${name} = .*$`, 'm'));
  assert.ok(match, `expected a ${name} declaration in source`);
  return match[0];
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected function ${name} in source`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} is not brace-balanced`);
}

function loadVerificationLogic(source) {
  const context = {
    process: { env: {} },
    execSync: null,
    getAvailableScripts: () => ({ test: true }),
  };
  vm.createContext(context);
  const script = [
    extractConst(source, 'VERIFY_TIMEOUT_ENV'),
    extractConst(source, 'DEFAULT_VERIFY_TIMEOUT_MS'),
    extractConst(source, 'VERIFY_MAX_BUFFER'),
    extractConst(source, 'VERIFY_OUTPUT_LIMIT'),
    extractFunction(source, 'verifyTimeoutMs'),
    extractFunction(source, 'verificationEvidence'),
    extractFunction(source, 'boundedDiagnostic'),
    extractFunction(source, 'verificationDiagnostic'),
    extractFunction(source, 'classifyVerificationError'),
    extractFunction(source, 'runVerification'),
  ].join('\n\n');
  vm.runInContext(script, context, { filename: 'verification-logic.js' });
  return context;
}

function loadSignatureLogic(source) {
  const context = { createHash: crypto.createHash };
  vm.createContext(context);
  const script = [
    extractConst(source, 'FAILURE_MARKER_PATTERNS'),
    extractConst(source, 'CONTEXT_MARKER_PATTERNS'),
    extractFunction(source, 'normalizeFailureLine'),
    extractFunction(source, 'firstFailureMarker'),
    extractFunction(source, 'buildFailureSignature'),
  ].join('\n\n');
  vm.runInContext(script, context, { filename: 'signature-logic.js' });
  return context;
}

const DEFAULTS = [pluginSource, cliSource];
const LABELS = ['opencode-plugin/index.mjs', 'opencode-plugin/hooks/verify.js'];

// Source contract: budget, outcome taxonomy, and buffer hygiene are present.
for (let i = 0; i < DEFAULTS.length; i += 1) {
  const source = DEFAULTS[i];
  const label = LABELS[i];
  assert.ok(/HARNESS_VERIFY_TIMEOUT_MS/.test(source), `${label} reads HARNESS_VERIFY_TIMEOUT_MS`);
  assert.ok(!/timeout:\s*60000\b/.test(source), `${label} no longer hard-codes a 60s verification timeout`);
  assert.ok(/timed out after/.test(source), `${label} labels timeout failures as timeouts`);
  assert.ok(/test_failure/.test(source), `${label} classifies confirmed failing checks`);
  assert.ok(/execution_error/.test(source), `${label} classifies spawn-level execution errors`);
  assert.ok(/maxBuffer/.test(source), `${label} bounds captured output instead of using the 1 MiB default`);
  const declared = Number(source.match(/^const DEFAULT_VERIFY_TIMEOUT_MS = (\d+);?$/m)[1]);
  assert.ok(declared >= 300000, `${label} default budget (${declared}ms) clears a several-minute suite`);
}

// Both copies must agree, or the manual CLI drifts from the live plugin.
assert.strictEqual(
  extractConst(pluginSource, 'DEFAULT_VERIFY_TIMEOUT_MS').match(/= (\d+)/)[1],
  extractConst(cliSource, 'DEFAULT_VERIFY_TIMEOUT_MS').match(/= (\d+)/)[1],
  'the plugin and the manual CLI declare the same default budget',
);
assert.strictEqual(
  extractConst(pluginSource, 'VERIFY_TIMEOUT_ENV').match(/"(.*)"/)[1],
  extractConst(cliSource, 'VERIFY_TIMEOUT_ENV').match(/'([^']*)'/)[1],
  'the plugin and the manual CLI read the same env override',
);
assert.strictEqual(
  extractConst(pluginSource, 'VERIFY_MAX_BUFFER').match(/= (\d+ \* \d+ \* \d+)/)[1],
  extractConst(cliSource, 'VERIFY_MAX_BUFFER').match(/= (\d+ \* \d+ \* \d+)/)[1],
  'the plugin and the manual CLI allow the same output buffer',
);

// Behavior: budget resolution.
{
  const context = loadVerificationLogic(pluginSource);
  assert.strictEqual(context.verifyTimeoutMs(), 600000, 'unset env uses the default budget');
  for (const value of ['abc', '0', '-5', '']) {
    context.process.env.HARNESS_VERIFY_TIMEOUT_MS = value;
    assert.strictEqual(context.verifyTimeoutMs(), 600000, `invalid override "${value}" falls back to the default`);
  }
  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '1234';
  assert.strictEqual(context.verifyTimeoutMs(), 1234, 'a positive override wins');
  assert.ok(!Number.isNaN(Number(context.verifyTimeoutMs())), 'the resolved budget is numeric');
}

// Behavior: outcome classification per failure kind.
{
  const context = loadVerificationLogic(pluginSource);
  const calls = [];
  context.execSync = (command, options) => {
    calls.push({ command, options });
    return '';
  };
  let result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.allPassed, true, 'a passing script verifies');
  assert.strictEqual(result.results[0].outcome, 'pass', 'a passing script is classified pass');
  assert.strictEqual(calls.length, 1, 'one command ran');
  assert.strictEqual(calls[0].command, 'npm test', 'the test script is the command');
  assert.strictEqual(calls[0].options.timeout, 600000, 'execSync receives the default budget');
  assert.strictEqual(calls[0].options.maxBuffer, 16 * 1024 * 1024, 'execSync receives the raised output buffer');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '120';
  calls.length = 0;
  context.execSync = (command, options) => {
    calls.push({ command, options });
    return '';
  };
  context.runVerification('/nonexistent-workspace');
  assert.strictEqual(calls[0].options.timeout, 120, 'execSync receives the overridden budget');

  delete context.process.env.HARNESS_VERIFY_TIMEOUT_MS;
  context.execSync = () => {
    const error = new Error('spawnSync npm test ETIMEDOUT');
    error.code = 'ETIMEDOUT';
    error.signal = 'SIGTERM'; // the live execSync timeout kill shape
    error.stdout = 'Harness OS - Self-Regression Test Suite\n';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.allPassed, false, 'a timeout is a verification failure');
  assert.strictEqual(result.results[0].timedOut, true, 'the timeout is recorded as a timeout');
  assert.strictEqual(result.results[0].outcome, 'timeout', 'a timeout is classified as timeout, not test_failure');
  assert.ok(/timed out after 600s/.test(result.results[0].error), 'the failure names the budget');
  assert.ok(/HARNESS_VERIFY_TIMEOUT_MS/.test(result.results[0].error), 'the failure names the override');
  assert.ok(/Self-Regression/.test(result.results[0].error), 'the failure keeps the last output for diagnosis');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '50';
  context.execSync = () => {
    const started = Date.now();
    while (Date.now() - started < 120) { /* simulate a kill at the budget without an error code */ }
    const error = new Error('Command failed: npm test');
    error.stdout = 'partial output';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].timedOut, true, 'a kill at the budget is recognized without an ETIMEDOUT code');
  assert.strictEqual(result.results[0].outcome, 'timeout', 'a kill at the budget is classified as timeout');

  // P2: a signal is external termination; only budget expiry is a timeout.
  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '600000';
  context.execSync = () => {
    const error = new Error('Command failed: npm test');
    error.signal = 'SIGTERM'; // killed early by a user, host, or process manager
    throw error; // status stays null: no verdict from the suite
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].outcome, 'execution_error', 'an early external SIGTERM is an execution error, not a timeout');
  assert.strictEqual(result.results[0].timedOut, false, 'an early external SIGTERM does not claim a timeout');
  assert.strictEqual(result.results[0].signal, 'SIGTERM', 'the signal is retained for diagnostics');
  assert.ok(/signal SIGTERM/.test(result.results[0].error), 'the execution error names the signal');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '50';
  context.execSync = () => {
    const started = Date.now();
    while (Date.now() - started < 80) { /* killed once the budget already elapsed, like execSync's own timeout */ }
    const error = new Error('spawnSync npm test SIGTERM');
    error.signal = 'SIGTERM';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].outcome, 'timeout', 'a signal kill with no exit status once the budget elapsed is a timeout');

  context.execSync = () => {
    const started = Date.now();
    while (Date.now() - started < 80) { /* slow, but it still produced a verdict */ }
    const error = new Error('Command failed: npm test');
    error.status = 1;
    error.stdout = 'confirmed failure after a slow run';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].outcome, 'test_failure', 'a real exit status stays a confirmed failure even past the budget');
  assert.strictEqual(result.results[0].timedOut, false, 'a confirmed verdict is not a timeout');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '600000';
  context.execSync = () => {
    const error = new Error('Command failed: npm test');
    error.status = 1;
    error.stdout = 'real assertion failure';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].timedOut, false, 'a fast failure is not mislabeled as a timeout');
  assert.strictEqual(result.results[0].outcome, 'test_failure', 'a non-zero exit is a confirmed test failure');
  assert.strictEqual(result.results[0].error, 'real assertion failure', 'a fast failure reports its output');

  context.execSync = () => {
    const error = new Error('spawnSync npm test ENOBUFS');
    error.code = 'ENOBUFS';
    error.stdout = 'x'.repeat(300);
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].outcome, 'execution_error', 'ENOBUFS is an execution error, not a test failure');
  assert.ok(/execution error: ENOBUFS/.test(result.results[0].error), 'the execution error names its cause');
  assert.ok(!/timed out/.test(result.results[0].error), 'ENOBUFS is not reported as a timeout');

  context.execSync = () => {
    const error = new Error('spawnSync npm test ENOENT');
    error.code = 'ENOENT';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].outcome, 'execution_error', 'a missing executable is an execution error');
  assert.strictEqual(result.results[0].exitCode, null, 'a spawn-level error has no exit status');
}

// Behavior: test_failure evidence spans both streams in full (P1).
{
  const context = loadVerificationLogic(pluginSource);
  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '600000';
  context.execSync = () => {
    const error = new Error('Command failed: npm test');
    error.status = 1;
    error.stdout = '> fixture@0.0.0 test\n> node fixture.js\n';
    error.stderr = 'AssertionError [ERR_ASSERTION]: alpha boom\n';
    throw error;
  };
  const bothStreams = context.runVerification('/nonexistent-workspace').results[0];
  assert.strictEqual(bothStreams.outcome, 'test_failure', 'a both-stream failure is a confirmed test failure');
  assert.ok(/alpha boom/.test(bothStreams.error), 'the user-visible diagnostic includes the stderr assertion');
  assert.ok(/node fixture\.js/.test(bothStreams.error), 'the user-visible diagnostic keeps the stdout banner');
  assert.ok(/alpha boom/.test(bothStreams.evidence), 'the kept evidence includes stderr');
  assert.ok(/node fixture\.js/.test(bothStreams.evidence), 'the kept evidence includes stdout');

  context.execSync = () => {
    const error = new Error('Command failed: npm test');
    error.status = 1;
    error.stdout = `${'A'.repeat(2000)}TAIL-MARKER`;
    throw error;
  };
  const longOutput = context.runVerification('/nonexistent-workspace').results[0];
  assert.ok(longOutput.error.length < 2200, 'the user-visible diagnostic stays bounded');
  assert.ok(/TAIL-MARKER/.test(longOutput.error), 'the trailing failure evidence survives diagnostic truncation');
  assert.ok(/chars omitted/.test(longOutput.error), 'the elision is explicit in the diagnostic');
  assert.ok(longOutput.evidence.length > 2000 && /TAIL-MARKER/.test(longOutput.evidence), 'the full evidence is retained untruncated for signature analysis');

  context.execSync = () => {
    const error = new Error('Command failed: npm test');
    error.code = 'ENOBUFS';
    error.stdout = `${'A'.repeat(2000)}TAIL-MARKER`;
    throw error;
  };
  const spawnError = context.runVerification('/nonexistent-workspace').results[0];
  assert.strictEqual(spawnError.evidence, undefined, 'only confirmed test failures keep full evidence');
}

// Behavior: the manual CLI mirror classifies the same way.
{
  const context = loadVerificationLogic(cliSource);
  const calls = [];
  context.execSync = (command, options) => {
    calls.push({ command, options });
    return '';
  };
  let result = context.runVerification('npm test');
  assert.strictEqual(result.success, true, 'the CLI verifies a passing command');
  assert.strictEqual(result.outcome, 'pass', 'the CLI classifies a passing command');
  assert.strictEqual(calls[0].options.timeout, 600000, 'the CLI uses the default budget');
  assert.strictEqual(calls[0].options.maxBuffer, 16 * 1024 * 1024, 'the CLI uses the raised output buffer');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '700';
  context.execSync = () => {
    const started = Date.now();
    while (Date.now() - started < 800) { /* outlive the budget */ }
    throw new Error('Command failed: npm test');
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.success, false, 'the CLI reports the failure');
  assert.strictEqual(result.timedOut, true, 'the CLI marks a timeout');
  assert.strictEqual(result.outcome, 'timeout', 'the CLI classifies the timeout');
  assert.ok(/timed out after 1s/.test(result.error), 'the CLI names the budget in the error');
  assert.ok(/HARNESS_VERIFY_TIMEOUT_MS/.test(result.error), 'the CLI names the override in the error');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '600000';
  context.execSync = () => {
    const error = new Error('Command failed');
    error.status = 2;
    error.stderr = 'lint error';
    throw error;
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.timedOut, false, 'the CLI does not mislabel a fast failure');
  assert.strictEqual(result.outcome, 'test_failure', 'the CLI classifies the non-zero exit');
  assert.strictEqual(result.error, 'lint error', 'the CLI reports stderr for a fast failure');

  // P2 parity: an early external SIGTERM is not a budget timeout.
  context.execSync = () => {
    const error = new Error('Command failed');
    error.signal = 'SIGTERM';
    throw error;
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.outcome, 'execution_error', 'the CLI treats an early external SIGTERM as an execution error');
  assert.strictEqual(result.timedOut, false, 'the CLI does not claim a timeout for an early SIGTERM');
  assert.ok(/signal SIGTERM/.test(result.error), 'the CLI keeps the signal in diagnostics');

  context.execSync = () => {
    const error = new Error('spawnSync npm test ETIMEDOUT');
    error.code = 'ETIMEDOUT';
    error.signal = 'SIGTERM';
    error.stdout = 'Harness OS - Self-Regression Test Suite\n';
    throw error;
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.outcome, 'timeout', 'the CLI classifies the live ETIMEDOUT shape as a budget timeout');
  assert.strictEqual(result.timedOut, true, 'the CLI marks the budget timeout');

  // P1 parity: both streams feed the CLI diagnostic and evidence.
  context.execSync = () => {
    const error = new Error('Command failed');
    error.status = 1;
    error.stdout = '> fixture@0.0.0 test\n';
    error.stderr = 'AssertionError [ERR_ASSERTION]: alpha boom\n';
    throw error;
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.outcome, 'test_failure', 'the CLI classifies a both-stream failure');
  assert.ok(/alpha boom/.test(result.error), 'the CLI diagnostic includes stderr');
  assert.ok(/fixture@0\.0\.0/.test(result.error), 'the CLI diagnostic includes stdout');
  assert.ok(/alpha boom/.test(result.evidence), 'the CLI keeps stderr evidence');

  context.execSync = () => {
    const error = new Error('Command failed');
    error.code = 'ENOBUFS';
    throw error;
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.outcome, 'execution_error', 'the CLI classifies spawn-level failures');
  assert.ok(!/timed out/.test(result.error), 'the CLI does not report ENOBUFS as a timeout');
}

// Behavior: failure signatures key on real failing-check evidence.
{
  const context = loadSignatureLogic(pluginSource);
  const banner = '> harness-everything@0.34.0 test\n> node self-evolve/scripts/self-regression.js\n';
  const result = (error, extra = {}) => ({ command: 'npm test', outcome: 'test_failure', exitCode: 1, signal: null, error, ...extra });

  const alpha = result(`${banner}✖ alpha check (1.2ms)\nAssertionError [ERR_ASSERTION]: alpha boom`);
  assert.strictEqual(context.buildFailureSignature(alpha), context.buildFailureSignature(alpha), 'the same observation yields the same signature');
  const beta = result(`${banner}✖ beta check (0.8ms)\nAssertionError [ERR_ASSERTION]: beta boom`);
  assert.notStrictEqual(context.buildFailureSignature(alpha), context.buildFailureSignature(beta), 'different failing checks sharing a banner do not collide');

  const ansi = result(`${banner}\u001b[31m✖\u001b[39m alpha check (1.2ms)`);
  assert.strictEqual(context.buildFailureSignature(ansi), context.buildFailureSignature(alpha), 'ANSI decoration and timing suffixes do not change the signature');

  const tapA = result('not ok 2 - parser handles unicode');
  const tapB = result('not ok 5 - parser handles unicode');
  assert.strictEqual(context.buildFailureSignature(tapA), context.buildFailureSignature(tapB), 'TAP plan numbering does not change the signature');

  // P1: full stdout+stderr evidence drives the marker/digest, not a prefix.
  const withEvidence = (stdout, stderr) => {
    const evidence = stderr ? `${stdout}\nstderr:\n${stderr}` : stdout;
    return result(evidence, { evidence });
  };
  const sharedStdout = '> fixture@0.0.0 test\n> node fixture.js\n';
  const stderrAlpha = withEvidence(sharedStdout, 'AssertionError [ERR_ASSERTION]: alpha boom');
  const stderrBeta = withEvidence(sharedStdout, 'AssertionError [ERR_ASSERTION]: beta boom');
  assert.notStrictEqual(
    context.buildFailureSignature(stderrAlpha),
    context.buildFailureSignature(stderrBeta),
    'shared stdout with different stderr assertions does not collide',
  );

  const prefix = 'progress '.repeat(400); // longer than the old 2 KiB leading-prefix cut
  const tailAlpha = withEvidence(`${prefix}HARNESS-UNIQUE-ALPHA`, '');
  const tailBeta = withEvidence(`${prefix}HARNESS-UNIQUE-BETA`, '');
  assert.ok(/unrecognized-output/.test(context.buildFailureSignature(tailAlpha)), 'markerless evidence uses the digest fallback');
  assert.notStrictEqual(
    context.buildFailureSignature(tailAlpha),
    context.buildFailureSignature(tailBeta),
    'a >2 KiB shared markerless prefix with different tails does not collide',
  );
  assert.strictEqual(
    context.buildFailureSignature(tailAlpha),
    context.buildFailureSignature(withEvidence(`${prefix}HARNESS-UNIQUE-ALPHA`, '')),
    'identical evidence still matches',
  );

  // P1: the Jest suite header is context; the test block is the identity.
  const jestLike = (name, file = 'src/parser.test.js') => `FAIL ${file}\n  ● parser › accepts ${name}\n    AssertionError: ${name}\n`;
  assert.strictEqual(
    context.firstFailureMarker(jestLike('alpha')),
    'FAIL src/parser.test.js: ● parser › accepts alpha',
    'the Jest suite header is carried as context for the specific test block',
  );
  const jestAlpha = result(jestLike('alpha'));
  const jestBeta = result(jestLike('beta'));
  const jestGamma = result(jestLike('gamma'));
  assert.notStrictEqual(context.buildFailureSignature(jestAlpha), context.buildFailureSignature(jestBeta), 'different Jest failures from the same file do not collide');
  assert.notStrictEqual(context.buildFailureSignature(jestBeta), context.buildFailureSignature(jestGamma), 'the second and third Jest failures stay distinct too');
  assert.strictEqual(context.buildFailureSignature(jestAlpha), context.buildFailureSignature(result(jestLike('alpha'))), 'an identical Jest failure still matches');
  assert.notStrictEqual(
    context.buildFailureSignature(jestAlpha),
    context.buildFailureSignature(result(jestLike('alpha', 'src/other.test.js'))),
    'the file context distinguishes same-named first failures across suites',
  );

  const failOnly = result('FAIL src/parser.test.js\n');
  assert.ok(/unrecognized-output/.test(context.buildFailureSignature(failOnly)), 'a lone suite header is not a failing-check identity');
  assert.notStrictEqual(
    context.buildFailureSignature(failOnly),
    context.buildFailureSignature(result('FAIL src/other.test.js\n')),
    'lone suite headers from different files stay distinct via the digest',
  );

  assert.strictEqual(context.firstFailureMarker('  ● Console\n    console.log\n      noise\n'), null, 'the Jest Console section is not a failure marker');
  const jestWithConsole = `FAIL src/parser.test.js\n  ● Console\n\n    console.log\n      noise\n\n  ● parser › accepts alpha\n`;
  assert.strictEqual(context.firstFailureMarker(jestWithConsole), 'FAIL src/parser.test.js: ● parser › accepts alpha', 'a Console block before the failure does not confuse the marker');


  // P2: Mocha indents both numbered failures and assertion lines. Signatures
  // must use the test identity, not the whole output (volatile stack/timing).
  const mochaLike = (name, frame) =>
    `  1) should parse ${name}\n     AssertionError: expected true to equal false\n       at Context.<anonymous> (fixture.test.js:${frame}:7)\n`;
  const mochaAlpha = result(mochaLike('alpha', 17));
  const mochaBeta = result(mochaLike('beta', 18));
  assert.strictEqual(
    context.firstFailureMarker(mochaLike('alpha', 17)),
    '1) should parse alpha',
    'indented Mocha test-number lines are recognized and normalized',
  );
  assert.notStrictEqual(
    context.buildFailureSignature(mochaAlpha),
    context.buildFailureSignature(mochaBeta),
    'different indented Mocha failures have different signatures',
  );
  assert.strictEqual(
    context.buildFailureSignature(mochaAlpha),
    context.buildFailureSignature(result(mochaLike('alpha', 93))),
    'the same Mocha failure keeps one signature despite changing stack line numbers',
  );
  assert.strictEqual(
    context.firstFailureMarker('     AssertionError [ERR_ASSERTION]: same assertion\n'),
    'AssertionError [ERR_ASSERTION]: same assertion',
    'indented assertion-only output is recognized as failure evidence',
  );
  assert.notStrictEqual(
    context.buildFailureSignature(result('     AssertionError: alpha boom\n')),
    context.buildFailureSignature(result('     AssertionError: beta boom\n')),
    'distinct indented assertion failures remain distinct',
  );
  assert.strictEqual(
    context.firstFailureMarker('not ok 7 - TAP check\n'),
    'not ok - TAP check',
    'TAP marker numbering is normalized independently of Mocha indentation support',
  );

  const bannerOnly = result(banner);
  assert.strictEqual(context.buildFailureSignature(bannerOnly), context.buildFailureSignature(result(banner)), 'identical markerless output still matches');
  const bannerPlusTail = result(`${banner}different tail`);
  assert.notStrictEqual(context.buildFailureSignature(bannerOnly), context.buildFailureSignature(bannerPlusTail), 'markerless signatures fall back to the full-output digest');
  assert.ok(/unrecognized-output/.test(context.buildFailureSignature(bannerOnly)), 'markerless signatures are labeled as unrecognized output');
  assert.ok(/exit=1/.test(context.buildFailureSignature(bannerOnly)), 'the signature records the exit condition');

  const nodeTest = '# failing tests:\n✖ failing tests:\n✖ real specific check (3ms)\n';
  assert.strictEqual(context.firstFailureMarker(nodeTest), '✖ real specific check', 'the generic failing-tests header is skipped for the specific check');
}

console.log('mechanism-36-verify-timeout: plugin and CLI verification budget, outcome taxonomy, and signature contracts hold');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
  assert.ok(/VERIFY_OUTPUT_LIMIT = 2000/.test(source), `${label} bounds retained output`);
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
// The plugin now streams output; the standalone CLI retains its 16 MiB
// synchronous capture. Actual async runner contracts are exercised in 338.

// Behavior: budget resolution.
{
  const context = loadVerificationLogic(cliSource);
  assert.strictEqual(context.verifyTimeoutMs(), 600000, 'unset env uses the default budget');
  for (const value of ['abc', '0', '-5', '']) {
    context.process.env.HARNESS_VERIFY_TIMEOUT_MS = value;
    assert.strictEqual(context.verifyTimeoutMs(), 600000, `invalid override "${value}" falls back to the default`);
  }
  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '1234';
  assert.strictEqual(context.verifyTimeoutMs(), 1234, 'a positive override wins');
  assert.ok(!Number.isNaN(Number(context.verifyTimeoutMs())), 'the resolved budget is numeric');
}

// Plugin outcome, evidence and cleanup behavior is covered with real child
// processes in mechanism-338-opencode-async.test.js and mechanism-39.

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

console.log('mechanism-36-verify-timeout: plugin and CLI verification budget and outcome taxonomy hold');

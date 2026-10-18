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
    extractFunction(source, 'verifyTimeoutMs'),
    extractFunction(source, 'runVerification'),
  ].join('\n\n');
  vm.runInContext(script, context, { filename: 'verification-logic.js' });
  return context;
}

const DEFAULTS = [pluginSource, cliSource];
const LABELS = ['opencode-plugin/index.mjs', 'opencode-plugin/hooks/verify.js'];

// Source contract: the 60s cap that killed healthy self-regression runs is gone.
for (let i = 0; i < DEFAULTS.length; i += 1) {
  const source = DEFAULTS[i];
  const label = LABELS[i];
  assert.ok(/HARNESS_VERIFY_TIMEOUT_MS/.test(source), `${label} reads HARNESS_VERIFY_TIMEOUT_MS`);
  assert.ok(!/timeout:\s*60000\b/.test(source), `${label} no longer hard-codes a 60s verification timeout`);
  assert.ok(/timed out after/.test(source), `${label} labels timeout failures as timeouts`);
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

// Behavior: the plugin passes the resolved budget to execSync and classifies outcomes.
{
  const context = loadVerificationLogic(pluginSource);
  const calls = [];
  context.execSync = (command, options) => {
    calls.push({ command, options });
    return '';
  };
  let result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.allPassed, true, 'a passing script verifies');
  assert.strictEqual(calls.length, 1, 'one command ran');
  assert.strictEqual(calls[0].command, 'npm test', 'the test script is the command');
  assert.strictEqual(calls[0].options.timeout, 600000, 'execSync receives the default budget');

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
    error.stdout = 'Harness OS - Self-Regression Test Suite\n';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.allPassed, false, 'a timeout is a verification failure');
  assert.strictEqual(result.results[0].timedOut, true, 'the timeout is recorded as a timeout');
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

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '600000';
  context.execSync = () => {
    const error = new Error('Command failed: npm test');
    error.stdout = 'real assertion failure';
    throw error;
  };
  result = context.runVerification('/nonexistent-workspace');
  assert.strictEqual(result.results[0].timedOut, false, 'a fast failure is not mislabeled as a timeout');
  assert.strictEqual(result.results[0].error, 'real assertion failure', 'a fast failure reports its output');
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
  assert.strictEqual(calls[0].options.timeout, 600000, 'the CLI uses the default budget');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '700';
  context.execSync = () => {
    const started = Date.now();
    while (Date.now() - started < 800) { /* outlive the budget */ }
    throw new Error('Command failed: npm test');
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.success, false, 'the CLI reports the failure');
  assert.strictEqual(result.timedOut, true, 'the CLI marks a timeout');
  assert.ok(/timed out after 1s/.test(result.error), 'the CLI names the budget in the error');
  assert.ok(/HARNESS_VERIFY_TIMEOUT_MS/.test(result.error), 'the CLI names the override in the error');

  context.process.env.HARNESS_VERIFY_TIMEOUT_MS = '600000';
  context.execSync = () => {
    const error = new Error('Command failed');
    error.stderr = 'lint error';
    throw error;
  };
  result = context.runVerification('npm test');
  assert.strictEqual(result.timedOut, false, 'the CLI does not mislabel a fast failure');
  assert.strictEqual(result.error, 'lint error', 'the CLI reports stderr for a fast failure');
}

console.log('mechanism-36-verify-timeout: plugin and CLI verification budget contracts hold');

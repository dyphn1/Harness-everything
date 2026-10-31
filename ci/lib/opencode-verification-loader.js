const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const childProcess = require('child_process');

// Load the private runner without adding exports to the portable plugin's
// host-discovery surface. Parsing preserves async declarations and boundaries.
module.exports = function loadRunner(root, overrides = {}) {
  const source = fs.readFileSync(path.join(root, 'opencode-plugin/index.mjs'), 'utf8');
  const names = new Set(['FAILURE_MARKER_PATTERNS', 'CONTEXT_MARKER_PATTERNS',
    'VERIFY_TIMEOUT_ENV', 'DEFAULT_VERIFY_TIMEOUT_MS', 'VERIFY_OUTPUT_LIMIT',
    'VERIFY_LINE_LIMIT', 'VERIFY_KILL_GRACE_MS', 'normalizeFailureLine',
    'firstFailureMarker', 'buildFailureSignature', 'getAvailableScripts',
    'verifyTimeoutMs', 'createVerificationCapture', 'terminateVerificationChild',
    'runVerificationCommand', 'runVerification']);
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const declarations = ast.body.filter(node => names.has(node.id?.name || node.declarations?.[0]?.id?.name));
  const context = { process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    createHash: require('crypto').createHash, spawn: childProcess.spawn,
    existsSync: fs.existsSync, readFileSync: fs.readFileSync, join: path.join, ...overrides };
  return vm.runInNewContext(declarations.map(node => source.slice(node.start, node.end)).join('\n')
    + '\n;({ runVerification, runVerificationCommand, createVerificationCapture, buildFailureSignature, verifyTimeoutMs })', context);
};

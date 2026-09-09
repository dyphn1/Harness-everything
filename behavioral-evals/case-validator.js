'use strict';

/**
 * Structural validation for behavioral-evals case fixtures.
 *
 * This is deliberately independent from the live grading loop so case authors
 * can validate execution-evidence assertions before spending model tokens.
 */

const fs = require('fs');
const path = require('path');

const EXPECTATION_TYPES = new Set([
  'trace_contains',
  'trace_not_contains',
  'file_contains',
  'file_not_exists',
  'command_exit_0',
  'tool_attempted',
  'tool_executed',
  'tool_completed',
  'tool_denied',
  'execution_evidence',
]);

const PRESSURE_CATEGORIES = new Set([
  'budget', 'authority', 'complexity', 'expert', 'fatigue', 'management',
  'documentation', 'error-handling', 'security', 'tests', 'verification',
  'social', 'sunk-cost', 'scope-bypass',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.replace(/\\/g, '/').trim();
  if (candidate.includes('\0') || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) return null;
  const parts = candidate.split('/');
  if (parts.some(part => part === '..')) return null;
  const normalized = path.posix.normalize(candidate);
  if (normalized === '.' || normalized.startsWith('../')) return null;
  return normalized;
}

function validateFixture(fixture) {
  const errors = [];
  if (!isPlainObject(fixture)) return ['fixture must be a mapping'];
  if (!Array.isArray(fixture.files) || fixture.files.length === 0) {
    errors.push('fixture.files must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  for (const [index, file] of fixture.files.entries()) {
    if (!isPlainObject(file)) {
      errors.push(`fixture.files[${index}] must be a mapping`);
      continue;
    }
    const normalized = normalizeRelativePath(file.path);
    if (!normalized) errors.push(`fixture.files[${index}] path must be relative and cannot contain ..`);
    else {
      const key = normalized.toLowerCase();
      if (seen.has(key)) errors.push(`duplicate fixture path: ${normalized}`);
      seen.add(key);
      if (normalized === '.git' || normalized.startsWith('.git/')) errors.push(`fixture cannot seed git internals: ${normalized}`);
    }
    if (file.content === undefined || file.content === null) errors.push(`fixture.files[${index}] content is missing`);
  }
  if (fixture.git !== undefined && typeof fixture.git !== 'boolean') errors.push('fixture.git must be boolean');
  return errors;
}

function validateExpectation(expectation, index) {
  const errors = [];
  if (!isPlainObject(expectation)) return [`expectations[${index}] must be a mapping`];
  const type = expectation.type;
  if (expectation.after_edit !== undefined && typeof expectation.after_edit !== 'boolean') errors.push(`expectations[${index}] after_edit must be boolean`);
  if (!EXPECTATION_TYPES.has(type)) errors.push(`expectations[${index}] has unknown type: ${type}`);
  if (['file_contains', 'file_not_exists'].includes(type)) {
    if (!normalizeRelativePath(expectation.path)) errors.push(`expectations[${index}] path must be relative`);
  }
  if (['trace_contains', 'trace_not_contains', 'file_contains'].includes(type) && typeof expectation.value !== 'string') {
    errors.push(`expectations[${index}] ${type} requires a string value`);
  }
  if (type === 'command_exit_0' && typeof expectation.command !== 'string') errors.push(`expectations[${index}] command_exit_0 requires command`);
  if (['tool_attempted', 'tool_executed', 'tool_completed', 'tool_denied', 'execution_evidence'].includes(type)) {
    if (expectation.value === undefined && expectation.tool === undefined && expectation.name === undefined) {
      errors.push(`expectations[${index}] ${type} requires a tool/value target`);
    }
    if (expectation.value !== undefined && !['string', 'number'].includes(typeof expectation.value) && !isPlainObject(expectation.value)) {
      errors.push(`expectations[${index}] execution target must be scalar or mapping`);
    }
  }
  return errors;
}

function validateCase(caseData, { fileName = null } = {}) {
  const errors = [];
  if (!isPlainObject(caseData)) return ['case must be a mapping'];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(caseData.id || ''))) errors.push('id must be a lowercase slug');
  if (fileName && path.basename(fileName, path.extname(fileName)) !== caseData.id) errors.push('filename must match id');
  if (typeof caseData.prompt !== 'string' || !caseData.prompt.trim()) errors.push('prompt is required');
  if (!Number.isInteger(caseData.max_turns) || caseData.max_turns < 1) errors.push('max_turns must be a positive integer');
  errors.push(...validateFixture(caseData.fixture));
  if (!Array.isArray(caseData.expectations) || caseData.expectations.length === 0) errors.push('expectations must be a non-empty array');
  else caseData.expectations.forEach((expectation, index) => errors.push(...validateExpectation(expectation, index)));
  if (caseData.pressure) {
    if (!PRESSURE_CATEGORIES.has(caseData.pressure_category)) errors.push(`unknown pressure_category: ${caseData.pressure_category}`);
    if (!/skip|don't|not|quick|minutes|urgent/i.test(caseData.prompt || '')) errors.push('pressure prompt does not contain pressure language');
  }
  if (caseData.loaded_skills !== undefined && (!Array.isArray(caseData.loaded_skills) || caseData.loaded_skills.some(skill => typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill)))) {
    errors.push('loaded_skills must contain safe skill names');
  }
  return errors;
}

function parseCaseFile(filePath, parseYaml) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}

function validateDirectory(directory, parseYaml) {
  const failures = [];
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.yaml')).sort()) {
    const filePath = path.join(directory, name);
    let data;
    try { data = parseCaseFile(filePath, parseYaml); }
    catch (error) {
      failures.push({ file: filePath, errors: [`YAML parse failed: ${error.message}`] });
      continue;
    }
    const errors = validateCase(data, { fileName: name });
    if (errors.length) failures.push({ file: filePath, errors });
  }
  return failures;
}

function discoverCaseFiles(directory) {
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.yaml'))
    .sort()
    .map(name => path.join(directory, name));
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'validate';
  if (command !== 'validate') throw new Error('Usage: case-validator.js validate [directory]');
  const directory = path.resolve(argv[1] || path.join(__dirname, 'cases'));
  if (!fs.existsSync(directory)) throw new Error(`case directory not found: ${directory}`);
  // Keep the parser dependency lazy so the validator remains usable as a
  // small library without loading the live runner.
  const { parseSimpleYaml } = require('./run');
  const failures = validateDirectory(directory, parseSimpleYaml);
  const total = discoverCaseFiles(directory).length;
  for (const failure of failures) console.error(`❌ ${failure.file}: ${failure.errors.join('; ')}`);
  if (failures.length) {
    console.error(`\n${failures.length} invalid case file(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ All ${total} behavioral case files are structurally valid.`);
}

// These controls are intentionally invalid. If a future validator change
// lets one through, the structural gate must fail instead of silently losing
// the boundary that protects disposable evaluation workspaces.
function negativeControls() {
  const controls = [
    { id: 'bad-path', prompt: 'x', max_turns: 1, fixture: { files: [{ path: '../escape.js', content: 'x' }] }, expectations: [{ type: 'trace_contains', value: 'x' }] },
    { id: 'duplicate-path', prompt: 'x', max_turns: 1, fixture: { files: [{ path: 'x.js', content: '' }, { path: 'x.js', content: '' }] }, expectations: [{ type: 'trace_contains', value: 'x' }] },
    { id: 'bad-execution', prompt: 'x', max_turns: 1, fixture: { files: [{ path: 'x.js', content: '' }] }, expectations: [{ type: 'tool_executed' }] },
  ];
  return controls.map(control => ({ control, errors: validateCase(control) })).filter(result => result.errors.length === 0);
}

module.exports = {
  EXPECTATION_TYPES,
  normalizeRelativePath,
  validateFixture,
  validateExpectation,
  validateCase,
  validateDirectory,
  discoverCaseFiles,
  negativeControls,
};

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Case validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

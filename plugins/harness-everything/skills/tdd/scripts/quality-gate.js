#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';
const DIMENSIONS = [
  'positiveParameters',
  'negativeParameters',
  'inputCompleteness',
  'outputCompleteness',
  'errorHandling',
  'unexpectedInput',
  'determinism',
  'sourceTraceability'
];
const WEIGHTS = {
  positiveParameters: 0.15,
  negativeParameters: 0.15,
  inputCompleteness: 0.15,
  outputCompleteness: 0.15,
  errorHandling: 0.15,
  unexpectedInput: 0.10,
  determinism: 0.10,
  sourceTraceability: 0.05
};
const REQUIRED_CLASSES = {
  inputCompleteness: ['required', 'optional', 'omitted', 'empty', 'null', 'min', 'max', 'boundary'],
  outputCompleteness: ['value', 'type', 'schema', 'required-field', 'prohibited-extra-field', 'side-effect'],
  errorHandling: ['error-type', 'error-code', 'message', 'state-cleanup', 'rollback', 'no-unintended-output'],
  unexpectedInput: ['malformed', 'unknown', 'extra', 'unsupported', 'out-of-range', 'duplicate', 'wrong-type']
};
const CHECK_STATUSES = new Set(['PASS', 'FAIL', 'SKIPPED', 'N/A']);
const SIDE_EFFECT_FIELDS = ['createdFiles', 'changedFiles', 'deletedFiles', 'persistentState', 'events', 'logs', 'externalCalls'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
}

function equal(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeRun(run, normalizations, errors, prefix) {
  const comparable = {
    exitStatus: run.exitStatus,
    errorCategory: run.errorCategory,
    output: clone(run.output),
    sideEffects: clone(run.sideEffects)
  };

  for (const normalization of normalizations) {
    if (!isObject(normalization) || !nonEmpty(normalization.path) || !nonEmpty(normalization.rule) || !nonEmpty(normalization.sourceSection)) {
      errors.push(`${prefix}.normalizations entries require path, rule, and sourceSection`);
      continue;
    }
    const parts = normalization.path.split('.');
    if (!['output', 'sideEffects'].includes(parts[0]) || parts.some(part => !part)) {
      errors.push(`${prefix}.normalizations path must start with output or sideEffects`);
      continue;
    }
    let cursor = comparable;
    let found = true;
    for (let index = 0; index < parts.length - 1; index++) {
      if (!isObject(cursor) && !Array.isArray(cursor)) { found = false; break; }
      if (!Object.prototype.hasOwnProperty.call(cursor, parts[index])) { found = false; break; }
      cursor = cursor[parts[index]];
    }
    const leaf = parts[parts.length - 1];
    if (!found || (!isObject(cursor) && !Array.isArray(cursor)) || !Object.prototype.hasOwnProperty.call(cursor, leaf)) {
      errors.push(`${prefix}.normalizations path does not exist in every run: ${normalization.path}`);
      continue;
    }
    cursor[leaf] = `[normalized: ${normalization.rule}]`;
  }
  return comparable;
}

function emptyDimension(applicable = false) {
  return { applicable, passed: 0, required: 0, percentage: applicable ? 0 : null };
}

function evaluateChecks(name, dimension, errors, prefix, skippedTests, naDeclarations) {
  if (!isObject(dimension) || typeof dimension.applicable !== 'boolean') {
    errors.push(`${prefix}.${name} requires an explicit boolean applicable field`);
    return emptyDimension(true);
  }
  if (!dimension.applicable) {
    if (!nonEmpty(dimension.reason)) errors.push(`${prefix}.${name} N/A requires a written reason`);
    const declaration = { dimension: name, reason: dimension.reason || '' };
    naDeclarations.push(declaration);
    return { ...emptyDimension(false), reason: dimension.reason || '' };
  }
  if (!Array.isArray(dimension.checks) || dimension.checks.length === 0) {
    errors.push(`${prefix}.${name} requires at least one executed check`);
    return { ...emptyDimension(true), checks: [] };
  }

  const seenIds = new Set();
  const seenClasses = new Set();
  let passed = 0;
  let required = 0;
  let executed = 0;
  const checks = dimension.checks.map((check, index) => {
    const location = `${prefix}.${name}.checks[${index}]`;
    if (!isObject(check)) {
      errors.push(`${location} must be an object`);
      return check;
    }
    if (!nonEmpty(check.id)) errors.push(`${location}.id is required`);
    else if (seenIds.has(check.id)) errors.push(`${location}.id is duplicated: ${check.id}`);
    else seenIds.add(check.id);
    if (!nonEmpty(check.class)) errors.push(`${location}.class is required`);
    else seenClasses.add(check.class);
    if (!CHECK_STATUSES.has(check.status)) errors.push(`${location}.status must be PASS, FAIL, SKIPPED, or N/A`);
    if (check.status === 'N/A') {
      if (!nonEmpty(check.reason)) errors.push(`${location} N/A requires a written reason`);
      naDeclarations.push({ dimension: name, checkId: check.id || `index-${index}`, reason: check.reason || '' });
    } else {
      required++;
      if (check.status === 'PASS') passed++;
      if (check.status === 'PASS' || check.status === 'FAIL') executed++;
      if (check.status === 'SKIPPED') skippedTests.push({ dimension: name, checkId: check.id || `index-${index}` });
      if (!nonEmpty(check.evidence)) errors.push(`${location}.evidence is required for applicable checks`);
    }
    return clone(check);
  });

  for (const requiredClass of REQUIRED_CLASSES[name] || []) {
    if (!seenClasses.has(requiredClass)) errors.push(`${prefix}.${name} is missing declared class ${requiredClass}; mark it N/A with a reason when inapplicable`);
  }
  if (required === 0 || executed === 0) errors.push(`${prefix}.${name} has no executed applicable case`);
  return {
    applicable: true,
    passed,
    required,
    percentage: required === 0 ? 0 : round(passed / required * 100),
    checks
  };
}

function evaluateDeterminism(dimension, source, errors, prefix, naDeclarations) {
  if (!isObject(dimension) || typeof dimension.applicable !== 'boolean') {
    errors.push(`${prefix}.determinism requires an explicit boolean applicable field`);
    return { ...emptyDimension(true), matchingRuns: 0, totalRuns: 0, runs: [], normalizations: [] };
  }
  if (!dimension.applicable) {
    if (!nonEmpty(dimension.reason)) errors.push(`${prefix}.determinism N/A requires a written reason`);
    naDeclarations.push({ dimension: 'determinism', reason: dimension.reason || '' });
    return { ...emptyDimension(false), matchingRuns: 0, totalRuns: 0, runs: [], normalizations: [], reason: dimension.reason || '' };
  }

  const runs = Array.isArray(dimension.runs) ? dimension.runs : [];
  const normalizations = Array.isArray(dimension.normalizations) ? dimension.normalizations : [];
  if (runs.length < 2) errors.push(`${prefix}.determinism requires at least two runs`);
  if (normalizations.length > 0 && source.status !== 'AUTHORITATIVE') {
    errors.push(`${prefix}.determinism normalization requires an authoritative source`);
  }
  const ids = new Set();
  for (const [index, run] of runs.entries()) {
    const location = `${prefix}.determinism.runs[${index}]`;
    if (!isObject(run)) { errors.push(`${location} must be an object`); continue; }
    if (!nonEmpty(run.id)) errors.push(`${location}.id is required`);
    else if (ids.has(run.id)) errors.push(`${location}.id is duplicated: ${run.id}`);
    else ids.add(run.id);
    for (const field of ['input', 'exitStatus', 'errorCategory', 'output', 'sideEffects']) {
      if (!Object.prototype.hasOwnProperty.call(run, field)) errors.push(`${location}.${field} is required`);
    }
    if (!Number.isInteger(run.exitStatus)) errors.push(`${location}.exitStatus must be an integer`);
    if (run.errorCategory !== null && typeof run.errorCategory !== 'string') errors.push(`${location}.errorCategory must be a string or null`);
    if (!isObject(run.sideEffects)) errors.push(`${location}.sideEffects must be an object`);
    else {
      for (const field of SIDE_EFFECT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(run.sideEffects, field)) errors.push(`${location}.sideEffects.${field} is required`);
      }
      for (const field of ['createdFiles', 'changedFiles', 'deletedFiles', 'events', 'logs', 'externalCalls']) {
        if (!Array.isArray(run.sideEffects[field])) errors.push(`${location}.sideEffects.${field} must be an array`);
      }
    }
  }

  let matchingRuns = runs.length > 0 ? 1 : 0;
  if (runs.length > 0) {
    const baselineInput = runs[0].input;
    const baseline = normalizeRun(runs[0], normalizations, errors, `${prefix}.determinism`);
    for (let index = 1; index < runs.length; index++) {
      const candidate = normalizeRun(runs[index], normalizations, errors, `${prefix}.determinism`);
      if (equal(baselineInput, runs[index].input) && equal(baseline, candidate)) matchingRuns++;
    }
  }
  return {
    applicable: true,
    passed: matchingRuns,
    required: runs.length,
    percentage: runs.length === 0 ? 0 : round(matchingRuns / runs.length * 100),
    matchingRuns,
    totalRuns: runs.length,
    runs: clone(runs),
    normalizations: clone(normalizations)
  };
}

function evaluateSource(source, errors, prefix) {
  if (!isObject(source)) {
    errors.push(`${prefix}.source is required`);
    return { source: {}, traced: 0, total: 1, percentage: 0 };
  }
  if (!['AUTHORITATIVE', 'INFERRED'].includes(source.status)) errors.push(`${prefix}.source.status must be AUTHORITATIVE or INFERRED`);
  if (!nonEmpty(source.type)) errors.push(`${prefix}.source.type is required`);
  if (source.status === 'AUTHORITATIVE') {
    if (!nonEmpty(source.path)) errors.push(`${prefix}.source.path is required for authoritative sources`);
    if (!nonEmpty(source.section)) errors.push(`${prefix}.source.section is required for authoritative sources`);
  }
  if (source.status === 'INFERRED' && !nonEmpty(source.inferenceBasis)) errors.push(`${prefix}.source.inferenceBasis is required for inferred expectations`);
  const valid = source.status === 'AUTHORITATIVE'
    ? nonEmpty(source.type) && nonEmpty(source.path) && nonEmpty(source.section)
    : source.status === 'INFERRED' && nonEmpty(source.type) && nonEmpty(source.inferenceBasis);
  return { source: clone(source), traced: valid ? 1 : 0, total: 1, percentage: valid ? 100 : 0 };
}

function scoreDimensions(dimensions) {
  let weighted = 0;
  let appliedWeight = 0;
  for (const name of DIMENSIONS) {
    const dimension = dimensions[name];
    if (!dimension || dimension.applicable === false || dimension.percentage === null) continue;
    weighted += dimension.percentage * WEIGHTS[name];
    appliedWeight += WEIGHTS[name];
  }
  return appliedWeight === 0 ? 0 : round(weighted / appliedWeight);
}

function scoringDetails(dimensions) {
  let weightedPoints = 0;
  let applicableWeight = 0;
  for (const name of DIMENSIONS) {
    const dimension = dimensions[name];
    if (!dimension || dimension.applicable === false || dimension.percentage === null) continue;
    weightedPoints += dimension.percentage * WEIGHTS[name];
    applicableWeight += WEIGHTS[name];
  }
  return {
    weights: { ...WEIGHTS },
    method: 'weightedPoints / applicableWeight',
    weightedPoints: round(weightedPoints),
    applicableWeight: round(applicableWeight),
    requiredScore: 100
  };
}

function evaluateRequirement(requirement, index, errors) {
  const prefix = `requirements[${index}]`;
  const localErrorsBefore = errors.length;
  if (!['unit', 'integration'].includes(requirement.testProfile)) {
    errors.push(`${prefix}.testProfile must be unit or integration`);
  }
  if (!Array.isArray(requirement.skippedTests)) errors.push(`${prefix}.skippedTests must be an array`);
  if (!Array.isArray(requirement.naDeclarations)) errors.push(`${prefix}.naDeclarations must be an array`);
  if (requirement.flakyTests !== undefined && !Array.isArray(requirement.flakyTests)) errors.push(`${prefix}.flakyTests must be an array`);
  const skippedTests = Array.isArray(requirement.skippedTests) ? clone(requirement.skippedTests) : [];
  const naDeclarations = Array.isArray(requirement.naDeclarations) ? clone(requirement.naDeclarations) : [];
  const sourceResult = evaluateSource(requirement.source, errors, prefix);
  const additionalSourceResults = [];
  if (requirement.additionalSources !== undefined && !Array.isArray(requirement.additionalSources)) {
    errors.push(`${prefix}.additionalSources must be an array`);
  }
  for (const [sourceIndex, source] of (Array.isArray(requirement.additionalSources) ? requirement.additionalSources : []).entries()) {
    additionalSourceResults.push(evaluateSource(source, errors, `${prefix}.additionalSources[${sourceIndex}]`));
  }
  const dimensionsInput = isObject(requirement.dimensions) ? requirement.dimensions : {};
  if (!isObject(requirement.dimensions)) errors.push(`${prefix}.dimensions is required`);
  const dimensions = {};
  for (const name of DIMENSIONS.slice(0, 6)) {
    dimensions[name] = evaluateChecks(name, dimensionsInput[name], errors, prefix, skippedTests, naDeclarations);
  }
  dimensions.determinism = evaluateDeterminism(dimensionsInput.determinism, requirement.source || {}, errors, prefix, naDeclarations);
  if (requirement.testProfile === 'integration' && dimensions.determinism.applicable === false) {
    errors.push(`${prefix}.integration profile requires applicable determinism evidence`);
  }
  if (!isObject(dimensionsInput.sourceTraceability) || dimensionsInput.sourceTraceability.applicable !== true) {
    errors.push(`${prefix}.sourceTraceability must be applicable`);
  }
  dimensions.sourceTraceability = {
    applicable: true,
    passed: sourceResult.traced + additionalSourceResults.reduce((sum, result) => sum + result.traced, 0),
    required: 1 + additionalSourceResults.length,
    traced: sourceResult.traced + additionalSourceResults.reduce((sum, result) => sum + result.traced, 0),
    total: 1 + additionalSourceResults.length,
    percentage: sourceResult.traced + additionalSourceResults.reduce((sum, result) => sum + result.traced, 0) === 1 + additionalSourceResults.length ? 100 : 0
  };

  if (!nonEmpty(requirement.requirementId)) errors.push(`${prefix}.requirementId is required`);
  if (!['PASS', 'NON_CONFORMANT'].includes(requirement.sourceConformance)) errors.push(`${prefix}.sourceConformance must be PASS or NON_CONFORMANT`);
  if (!['VALID', 'SOURCE_DEFECT', 'SOURCE_CONFLICT'].includes(requirement.sourceValidity)) errors.push(`${prefix}.sourceValidity must be VALID, SOURCE_DEFECT, or SOURCE_CONFLICT`);
  if (['SOURCE_DEFECT', 'SOURCE_CONFLICT'].includes(requirement.sourceValidity) && !nonEmpty(requirement.sourceNotes)) {
    errors.push(`${prefix}.sourceNotes is required for ${requirement.sourceValidity}`);
  }
  if (requirement.sourceValidity === 'SOURCE_CONFLICT' && additionalSourceResults.length === 0) {
    errors.push(`${prefix}.additionalSources must identify the conflicting authoritative source`);
  }
  const declaredSources = [requirement.source, ...(Array.isArray(requirement.additionalSources) ? requirement.additionalSources : [])];
  if (requirement.sourceValidity === 'SOURCE_CONFLICT' && declaredSources.some(source => !isObject(source) || source.status !== 'AUTHORITATIVE')) {
    errors.push(`${prefix}.SOURCE_CONFLICT may only identify authoritative sources`);
  }

  const scoring = scoringDetails(dimensions);
  const score = scoreDimensions(dimensions);
  const gates = {
    applicableDimensionsExecuted: DIMENSIONS.every(name => dimensions[name].applicable === false || dimensions[name].required > 0),
    sourceTraceabilityComplete: dimensions.sourceTraceability.percentage === 100,
    noSourceMismatch: requirement.sourceConformance === 'PASS',
    noSourceConflict: requirement.sourceValidity !== 'SOURCE_CONFLICT',
    allRequiredInputOutputValidated: ['inputCompleteness', 'outputCompleteness'].every(name => dimensions[name].applicable === false || dimensions[name].percentage === 100),
    allDeclaredErrorPathsTested: dimensions.errorHandling.applicable === false || dimensions.errorHandling.percentage === 100,
    integrationRepeated: dimensions.determinism.applicable === false || dimensions.determinism.totalRuns >= 2,
    deterministicOutputs: dimensions.determinism.applicable === false || dimensions.determinism.percentage === 100,
    noSkippedOrFlakyTests: skippedTests.length === 0 && (!Array.isArray(requirement.flakyTests) || requirement.flakyTests.length === 0),
    qualityScoreComplete: score === 100
  };
  const result = errors.length === localErrorsBefore && Object.values(gates).every(Boolean) ? 'PASS' : 'FAIL';
  return {
    requirementId: requirement.requirementId || null,
    testProfile: requirement.testProfile || null,
    source: sourceResult.source,
    additionalSources: additionalSourceResults.map(result => result.source),
    sourceConformance: requirement.sourceConformance || null,
    sourceValidity: requirement.sourceValidity || null,
    ...(requirement.sourceNotes ? { sourceNotes: requirement.sourceNotes } : {}),
    dimensions,
    skippedTests,
    flakyTests: Array.isArray(requirement.flakyTests) ? clone(requirement.flakyTests) : [],
    naDeclarations,
    mandatoryGates: gates,
    scoring,
    score,
    result
  };
}

function aggregateDimensions(requirements) {
  const aggregate = {};
  for (const name of DIMENSIONS) {
    const applicable = requirements.filter(requirement => requirement.dimensions[name].applicable !== false);
    const passed = applicable.reduce((sum, requirement) => sum + requirement.dimensions[name].passed, 0);
    const required = applicable.reduce((sum, requirement) => sum + requirement.dimensions[name].required, 0);
    aggregate[name] = {
      applicable: applicable.length > 0,
      passed,
      required,
      percentage: required === 0 ? null : round(passed / required * 100)
    };
    if (name === 'determinism') {
      aggregate[name].matchingRuns = passed;
      aggregate[name].totalRuns = required;
    }
    if (name === 'sourceTraceability') {
      aggregate[name].traced = passed;
      aggregate[name].total = required;
    }
  }
  return aggregate;
}

function evaluateEvidence(evidence) {
  const errors = [];
  if (!isObject(evidence)) errors.push('Evidence root must be an object');
  if (isObject(evidence) && evidence.schemaVersion !== VERSION) errors.push(`schemaVersion must be ${VERSION}`);
  if (!isObject(evidence) || !Array.isArray(evidence.requirements) || evidence.requirements.length === 0) {
    errors.push('requirements must be a non-empty array');
  }

  const inputRequirements = isObject(evidence) && Array.isArray(evidence.requirements) ? evidence.requirements : [];
  const requirements = [];
  const seenIds = new Set();
  inputRequirements.forEach((requirement, index) => {
    if (!isObject(requirement)) {
      errors.push(`requirements[${index}] must be an object`);
      return;
    }
    if (nonEmpty(requirement.requirementId)) {
      if (seenIds.has(requirement.requirementId)) errors.push(`Duplicate requirementId: ${requirement.requirementId}`);
      seenIds.add(requirement.requirementId);
    }
    requirements.push(evaluateRequirement(requirement, index, errors));
  });

  const dimensions = aggregateDimensions(requirements);
  const scoring = scoringDetails(dimensions);
  const score = scoreDimensions(dimensions);
  const mandatoryGates = {
    applicableDimensionsExecuted: requirements.length > 0 && requirements.every(req => req.mandatoryGates.applicableDimensionsExecuted),
    sourceTraceabilityComplete: requirements.length > 0 && requirements.every(req => req.mandatoryGates.sourceTraceabilityComplete),
    noSourceMismatch: requirements.length > 0 && requirements.every(req => req.mandatoryGates.noSourceMismatch),
    noSourceConflict: requirements.length > 0 && requirements.every(req => req.mandatoryGates.noSourceConflict),
    allRequiredInputOutputValidated: requirements.length > 0 && requirements.every(req => req.mandatoryGates.allRequiredInputOutputValidated),
    allDeclaredErrorPathsTested: requirements.length > 0 && requirements.every(req => req.mandatoryGates.allDeclaredErrorPathsTested),
    integrationRepeated: requirements.length > 0 && requirements.every(req => req.mandatoryGates.integrationRepeated),
    deterministicOutputs: requirements.length > 0 && requirements.every(req => req.mandatoryGates.deterministicOutputs),
    noSkippedOrFlakyTests: requirements.length > 0 && requirements.every(req => req.mandatoryGates.noSkippedOrFlakyTests),
    qualityScoreComplete: score === 100
  };
  const skippedTests = requirements.flatMap(req => req.skippedTests.map(test => ({ requirementId: req.requirementId, ...test })));
  const naDeclarations = requirements.flatMap(req => req.naDeclarations.map(declaration => ({ requirementId: req.requirementId, ...declaration })));
  const result = errors.length === 0 && Object.values(mandatoryGates).every(Boolean) ? 'PASS' : 'FAIL';
  return { schemaVersion: VERSION, requirements, dimensions, mandatoryGates, skippedTests, naDeclarations, scoring, score, result, errors };
}

function printSummary(report) {
  console.log(`TDD Quality Gate: ${report.result}`);
  console.log(`Score: ${report.score}%`);
  console.log('Requirements:');
  for (const requirement of report.requirements) {
    console.log(`- ${requirement.requirementId} [${requirement.testProfile}]: ${requirement.result} ${requirement.score}%`);
  }
  console.log('Dimensions:');
  for (const name of DIMENSIONS) {
    const dimension = report.dimensions[name];
    const score = dimension.percentage === null ? 'N/A' : `${dimension.percentage}%`;
    console.log(`- ${name}: ${dimension.passed}/${dimension.required} (${score})`);
  }
  for (const [name, passed] of Object.entries(report.mandatoryGates)) console.log(`- gate ${name}: ${passed ? 'PASS' : 'FAIL'}`);
  for (const error of report.errors) console.error(`- error: ${error}`);
}

function runCli(argv) {
  const args = argv.slice(2);
  const inputPath = args[0];
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (!inputPath || (outputIndex >= 0 && !outputPath)) {
    console.error('Usage: node tdd/scripts/quality-gate.js <evidence.json> [--output <report.json>]');
    return 2;
  }
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  } catch (error) {
    console.error(`TDD Quality Gate: FAIL\n- error: ${error.message}`);
    return 2;
  }
  const report = evaluateEvidence(evidence);
  printSummary(report);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  return report.result === 'PASS' ? 0 : 1;
}

if (require.main === module) process.exit(runCli(process.argv));

module.exports = { DIMENSIONS, REQUIRED_CLASSES, VERSION, evaluateEvidence, runCli };

#!/usr/bin/env node
'use strict';

// #325 H1 deterministic qualification: provider independence/preparation.
// H1 only: advisory suggestions are never passed to the F4 consumer.

const fs = require('fs');
const path = require('path');

const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const { stage } = require(path.join(__dirname, 'lib', 'doc-reconciliation-staged-tree'));
const F4_CASES = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_OBLIGATIONS = require(path.join(REPO_ROOT, 'harness-everything', 'scripts', 'doc-obligations.js'));
const PACKAGED_OBLIGATIONS = require(path.join(REPO_ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'doc-obligations.js'));
const SOURCE_PROVIDER = require(path.join(REPO_ROOT, 'harness-everything', 'scripts', 'doc-providers.js'));
const PACKAGED_PROVIDER = require(path.join(REPO_ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'doc-providers.js'));

const LEGS = ['source', 'packaged'];
const CASE = id => fx.readCaseCorpus(F4_CASES).cases.find(item => item.id === id);

const EXPECTED_MUSTS = [
  { id: 'doc-change:doc-lint', capability: 'doc-lint', strength: 'MUST', applicability: 'applicable', scope: { paths: ['docs/a.md'] }, acceptance: 'Run document lifecycle lint for every changed governed document.' },
  { id: 'doc-change:link-check', capability: 'link-check', strength: 'MUST', applicability: 'applicable', scope: { paths: ['docs/a.md'] }, acceptance: 'Check in-repository links for every changed governed document.' }
];

const PROVIDER_A_INPUT = {
  activeStep: { id: 'verify-docs', stepType: 'verification' },
  neededCapabilities: ['doc-lint'],
  availableProviderMetadata: [
    { providerId: 'fixture-lint-a', capabilities: ['doc-lint'], stepTypes: ['verification'], requiresHostCapabilities: ['execution-events'], locator: { kind: 'tool', id: 'fixture-lint-a' } }
  ],
  hostCapabilities: ['execution-events']
};

const PROVIDER_B_INPUT = {
  activeStep: { id: 'verify-docs', stepType: 'verification' },
  neededCapabilities: ['doc-lint'],
  availableProviderMetadata: [
    { providerId: 'fixture-lint-b', capabilities: ['doc-lint'], stepTypes: ['verification'], requiresHostCapabilities: ['execution-events'], locator: { kind: 'tool', id: 'fixture-lint-b' } }
  ],
  hostCapabilities: ['execution-events']
};

const PROVIDER_OMITTED_INPUT = {
  activeStep: { id: 'verify-docs', stepType: 'verification' },
  neededCapabilities: ['doc-lint'],
  availableProviderMetadata: [],
  hostCapabilities: []
};

const PROVIDER_A_SUGGESTION = [{ capability: 'doc-lint', providerId: 'fixture-lint-a', availability: 'available', reason: 'active-step capability and host requirements match' }];
const PROVIDER_B_SUGGESTION = [{ capability: 'doc-lint', providerId: 'fixture-lint-b', availability: 'available', reason: 'active-step capability and host requirements match' }];
const PROVIDER_OMITTED_UNAVAILABLE = [{ capability: 'doc-lint', reason: 'no available provider metadata for the active-step capability' }];

let passCount = 0;
let failCount = 0;
let infraCount = 0;

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function record(status, id, detail) {
  const suffix = detail ? ` - ${detail}` : '';
  if (status === 'PASS') passCount += 1;
  else if (status === 'FAIL') failCount += 1;
  else infraCount += 1;
  console.log(`   ${status.padEnd(5)} ${id}${suffix}`);
}

function cloneZero(caseDef) {
  return {
    ...caseDef,
    id: `${caseDef.id}-zero-evidence`,
    actions: caseDef.actions.filter(action => action.id !== 'lint-run' && action.id !== 'post-lint')
  };
}

function checkProvider(leg, providerCase) {
  const module = leg === 'source' ? SOURCE_PROVIDER : PACKAGED_PROVIDER;
  let input;
  let expectedSuggestions;
  let expectedUnavailable;
  if (providerCase === 'A') {
    input = PROVIDER_A_INPUT;
    expectedSuggestions = PROVIDER_A_SUGGESTION;
    expectedUnavailable = [];
  } else if (providerCase === 'B') {
    input = PROVIDER_B_INPUT;
    expectedSuggestions = PROVIDER_B_SUGGESTION;
    expectedUnavailable = [];
  } else {
    input = PROVIDER_OMITTED_INPUT;
    expectedSuggestions = [];
    expectedUnavailable = PROVIDER_OMITTED_UNAVAILABLE;
  }
  const result = module.suggestDocProviders(input);
  const ok = deepEqual(result.suggestions, expectedSuggestions) && deepEqual(result.unavailable, expectedUnavailable);
  record(ok ? 'PASS' : 'FAIL', `H1.${leg}.${providerCase}.provider-suggestion`, ok ? '' : `suggestions=${JSON.stringify(result.suggestions)}, unavailable=${JSON.stringify(result.unavailable)}`);
  return ok;
}

function checkDerivedMusts(leg, label) {
  const module = leg === 'source' ? SOURCE_OBLIGATIONS : PACKAGED_OBLIGATIONS;
  const caseDef = CASE('F4-POS-body-edit');
  const config = JSON.parse(caseDef.input.baseFiles['.agents/harness-everything/project-docs.json']);
  const base = { files: caseDef.input.baseFiles };
  const candidate = { files: { ...caseDef.input.baseFiles, ...caseDef.input.candidateFiles } };
  const { facts } = module.deriveDocFacts({ base, candidate, config, inventory: { complete: true } });
  const obligations = module.deriveDocObligations(facts);
  const fullMusts = obligations.filter(item => item.strength === 'MUST' && item.applicability === 'applicable');

  let ok = deepEqual(fullMusts, EXPECTED_MUSTS);
  for (const item of fullMusts) {
    if (!item.id || !item.capability || !item.strength || !item.applicability || !item.scope || !Array.isArray(item.scope.paths) || item.scope.paths.some(pathValue => !pathValue) || !item.acceptance) ok = false;
  }
  record(ok ? 'PASS' : 'FAIL', `${label}.derived-full-musts`, ok ? '' : JSON.stringify(fullMusts));
  return ok;
}

function runCell(leg, providerCase, evidenceMode) {
  const label = `H1.${leg}.${providerCase}.${evidenceMode}`;
  const staged = stage(leg);
  try {
    checkProvider(leg, providerCase);
    checkDerivedMusts(leg, label);

    staged.writeExport(staged.validExport());

    const baseCase = CASE('F4-POS-body-edit');
    const caseDef = evidenceMode === 'valid' ? baseCase : cloneZero(baseCase);

    const root = fx.replayCase(caseDef, staged.dist, { pilot: '1' });
    const faults = fx.infrastructureFaults(caseDef, root, 'on');
    if (faults.length) {
      record('INFRA', label, faults.map(fault => `${fault.actionId}: ${fault.message}`).join('; '));
      return;
    }

    const pilot = root.pilot || {};
    const checks = [];

    checks.push(deepEqual(root.pilotReportOrigin, 'runtime'));
    checks.push(deepEqual(pilot.reportOrigin, 'runtime'));
    checks.push(deepEqual(pilot.expectedMustIds, ['doc-change:doc-lint', 'doc-change:link-check']));
    const verifyAction = root.actions && root.actions['verify-pass'];
    const verifyRequirement = verifyAction?.state?.obligations?.requirements?.find(item => item.id === 'req-verify');
    checks.push(verifyRequirement?.requiredBindings?.some(binding => binding.id === 'verification-loop' && binding.status === 'loaded') === true);

    if (evidenceMode === 'valid') {
      checks.push(pilot.pilotCredit === true);
      checks.push(pilot.pilotStatus === 'credited');
      checks.push(deepEqual(pilot.unsatisfied, []));
      checks.push(deepEqual(pilot.creditedCapabilities, ['doc-lint', 'link-check']));
      checks.push(Array.isArray(pilot.acceptedRefs) && pilot.acceptedRefs.some(ref => ref.endsWith('#doc-lint')) && pilot.acceptedRefs.some(ref => ref.endsWith('#link-check')));
      checks.push(verifyAction && verifyAction.exitCode === 0);
      const stopAction = root.actions && root.actions.stop;
      checks.push(stopAction && stopAction.exitCode === 0);
      checks.push(stopAction && stopAction.state && stopAction.state.workflow && stopAction.state.workflow.state === 'satisfied');
    } else {
      checks.push(pilot.pilotCredit === false);
      checks.push(pilot.pilotStatus === 'unresolved');
      checks.push(Array.isArray(pilot.unsatisfied) && pilot.unsatisfied.length >= 2);
      checks.push(pilot.unsatisfied.some(item => item.obligationId === 'doc-change:doc-lint'));
      checks.push(pilot.unsatisfied.some(item => item.obligationId === 'doc-change:link-check'));
      checks.push(deepEqual(pilot.creditedCapabilities, []));
      checks.push(deepEqual(pilot.acceptedRefs, []));
      checks.push(verifyAction && verifyAction.exitCode === 2);
      const stopAction = root.actions && root.actions.stop;
      checks.push(stopAction && stopAction.exitCode === 0);
      checks.push(stopAction && stopAction.state && stopAction.state.workflow && stopAction.state.workflow.state === 'running');
    }

    record(checks.every(Boolean) ? 'PASS' : 'FAIL', label, checks.every(Boolean) ? '' : `checks=${JSON.stringify(checks)}, pilot=${JSON.stringify(pilot).slice(0, 500)}`);
  } catch (error) {
    record('FAIL', label, error.message);
  } finally {
    staged.cleanup();
  }
}

function main() {
  console.log('\n== H1 qualification: provider side input and F4 replay matrix ==');
  for (const leg of LEGS) {
    for (const providerCase of ['A', 'B', 'omitted']) {
      for (const evidenceMode of ['valid', 'zero']) {
        runCell(leg, providerCase, evidenceMode);
      }
    }
  }

  console.log('\n== H1 qualification evidence ==');
  console.log(`passing checks: ${passCount}`);
  console.log(`unexpected failures: ${failCount}`);
  console.log(`infrastructure faults: ${infraCount}`);
  if (failCount === 0 && infraCount === 0) {
    console.log('\nSTATUS: GREEN (all assertions passed)');
    return 0;
  }
  console.log('\nSTATUS: NOT-GREEN');
  return 1;
}

process.exitCode = main();

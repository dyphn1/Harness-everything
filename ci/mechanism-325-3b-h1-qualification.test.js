#!/usr/bin/env node
'use strict';

// #325 H1 deterministic qualification: provider independence/preparation.
// H1 only: advisory suggestions are never passed to the F4 consumer.

const path = require('path');

const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
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

function main() {
  console.log('\n== H1 qualification: direct provider and derived-obligation contracts ==');
  for (const leg of LEGS) {
    for (const providerCase of ['A', 'B', 'omitted']) {
      checkProvider(leg, providerCase);
    }
    checkDerivedMusts(leg, `H1.${leg}`);
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

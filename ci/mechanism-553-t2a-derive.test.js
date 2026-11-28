#!/usr/bin/env node
'use strict';

// #553 T2-A dedicated 3a-H1 derive suite. The two F4-POS-body-edit full-MUST
// derivation cells moved here from ci/mechanism-325-3b-h1-qualification.test.js.
// Base, candidate and config are byte-exact copies in ci/fixtures/553-t2a/body-edit/;
// the read-only F4 corpus is no longer a dependency of this suite.
// Both legs load the real doc-obligations.js (canonical and packaged). No skip,
// no fingerprint or golden recapture.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', '553-t2a', 'body-edit');
const CONFIG_REL = '.agents/harness-everything/project-docs.json';
const LEGS = [
  { name: 'source', dir: path.join(ROOT, 'harness-everything', 'scripts') },
  { name: 'packaged', dir: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts') }
];
const EXPECTED_MUSTS = [
  { id: 'doc-change:doc-lint', capability: 'doc-lint', strength: 'MUST', applicability: 'applicable', scope: { paths: ['docs/a.md'] }, acceptance: 'Run document lifecycle lint for every changed governed document.' },
  { id: 'doc-change:link-check', capability: 'link-check', strength: 'MUST', applicability: 'applicable', scope: { paths: ['docs/a.md'] }, acceptance: 'Check in-repository links for every changed governed document.' }
];

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

function readFixture(rel) {
  return fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
}

function buildInput() {
  const baseFiles = {
    [CONFIG_REL]: readFixture(path.join('base', CONFIG_REL)),
    'docs/a.md': readFixture(path.join('base', 'docs', 'a.md')),
    'docs/b.md': readFixture(path.join('base', 'docs', 'b.md'))
  };
  const candidateFiles = { 'docs/a.md': readFixture(path.join('candidate', 'docs', 'a.md')) };
  return {
    config: JSON.parse(baseFiles[CONFIG_REL]),
    base: { files: baseFiles },
    candidate: { files: { ...baseFiles, ...candidateFiles } }
  };
}

function checkDerivedMusts(leg, input) {
  const id = `H1.${leg.name}.derived-full-musts`;
  const modulePath = path.join(leg.dir, 'doc-obligations.js');
  if (!fs.existsSync(modulePath)) {
    record('INFRA', id, `module-missing: ${path.relative(ROOT, modulePath)} does not exist`);
    return false;
  }
  let module;
  try {
    delete require.cache[require.resolve(modulePath)];
    module = require(modulePath);
  } catch (error) {
    record('INFRA', id, `module-load: ${error.message.split('\n')[0]}`);
    return false;
  }
  const { facts } = module.deriveDocFacts({ base: input.base, candidate: input.candidate, config: input.config, inventory: { complete: true } });
  const obligations = module.deriveDocObligations(facts);
  const fullMusts = obligations.filter(item => item.strength === 'MUST' && item.applicability === 'applicable');

  let ok = deepEqual(fullMusts, EXPECTED_MUSTS);
  for (const item of fullMusts) {
    if (!item.id || !item.capability || !item.strength || !item.applicability || !item.scope || !Array.isArray(item.scope.paths) || item.scope.paths.some(pathValue => !pathValue) || !item.acceptance) ok = false;
  }
  record(ok ? 'PASS' : 'FAIL', id, ok ? '' : JSON.stringify(fullMusts));
  return ok;
}

function main() {
  console.log('\n== 553 T2-A derive: F4-POS-body-edit full MUSTs, source and packaged legs ==');
  let input;
  try {
    input = buildInput();
  } catch (error) {
    console.error(`[553-t2a-derive] infrastructure: fixture unreadable: ${error.message.split('\n')[0]}`);
    return 2;
  }
  for (const leg of LEGS) checkDerivedMusts(leg, input);

  console.log('\n== 553 T2-A derive evidence ==');
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

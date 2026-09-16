#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { collectContract, renderContractMarkdown, validateContract } = require('../scripts/repository-contract');

const contract = collectContract();
const failures = validateContract(contract);
assert.deepStrictEqual(failures, [], `Repository contract drift:\n- ${failures.join('\n- ')}`);

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
assert.strictEqual(
  packageLock.packages?.['']?.engines?.node,
  packageJson.engines?.node,
  'package-lock.json root engines.node must mirror package.json engines.node; run npm install --package-lock-only after changing the Node runtime contract',
);

const rendered = renderContractMarkdown(contract);
assert.match(rendered, /Minimum supported Node\.js/);
assert.match(rendered, /GitHub Actions runtime majors/);
assert.ok(contract.ci.qualityGates.includes('test:consistency'), 'CI contract must expose test:consistency');
assert.ok(contract.behavioralEvals.scheduled, 'Behavioral eval schedule must remain visible to the contract');

console.log('Repository contract verified: runtime, lockfile, workflows, action majors, schedule, gates, and generated docs are synchronized.');

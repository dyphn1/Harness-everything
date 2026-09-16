#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { collectContract, renderContractMarkdown, validateContract } = require('../scripts/repository-contract');

const contract = collectContract();
const failures = validateContract(contract);
assert.deepStrictEqual(failures, [], `Repository contract drift:\n- ${failures.join('\n- ')}`);

const rendered = renderContractMarkdown(contract);
assert.match(rendered, /Minimum supported Node\.js/);
assert.match(rendered, /GitHub Actions runtime majors/);
assert.ok(contract.ci.qualityGates.includes('test:consistency'), 'CI contract must expose test:consistency');
assert.ok(contract.behavioralEvals.scheduled, 'Behavioral eval schedule must remain visible to the contract');

console.log('Repository contract verified: runtime, workflows, action majors, schedule, gates, and generated docs are synchronized.');

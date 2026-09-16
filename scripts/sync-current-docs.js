#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { collectContract, renderContractMarkdown } = require('./repository-contract');

const ROOT = path.resolve(__dirname, '..');
const output = path.join(ROOT, 'docs', 'repository-contract.md');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, renderContractMarkdown(collectContract(ROOT)), 'utf8');
console.log(`Updated ${path.relative(ROOT, output).replace(/\\/g, '/')}`);

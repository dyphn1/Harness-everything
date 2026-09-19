#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function resolveAuditRuntime() {
  const candidates = [
    path.resolve(__dirname, '../../contract-integrity/scripts/audit.js'),
    path.resolve(__dirname, '../../../contract-integrity/scripts/audit.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('contract-integrity audit runtime is not packaged with this verification-loop installation');
}

function main() {
  try {
    const target = resolveAuditRuntime();
    const { runCli } = require(target);
    if (typeof runCli !== 'function') throw new Error('contract-integrity audit runtime does not export runCli');
    process.exitCode = runCli([process.execPath, target, ...process.argv.slice(2)]);
  } catch (error) {
    console.error('[Verification Contract Gate] ' + error.message);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { resolveAuditRuntime };

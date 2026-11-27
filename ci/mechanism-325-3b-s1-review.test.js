#!/usr/bin/env node
'use strict';

// Historical document links still name this suite. Keep a small migration
// index here; the behavioral controls run from the general Stop suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const destination = path.join(__dirname, 'mechanism-553-stop.test.js');
const source = fs.readFileSync(destination, 'utf8');
for (const id of [
  'closed-workflow',
  'p2a-off-pending',
  'p2a-fable-on',
  'p2b-off-negative',
  'ordinary-missing-verify',
  'ordinary-satisfied',
]) {
  assert.ok(source.includes(id), `migrated Stop suite is missing retained case ${id}`);
}

console.log('S1 review Stop controls map to ci/mechanism-553-stop.test.js.');

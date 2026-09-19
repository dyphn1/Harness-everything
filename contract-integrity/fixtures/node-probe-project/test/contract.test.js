'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptsLimit } = require('../src/limit');

test('[REQ-001] accepts supported boundary', () => {
  assert.equal(acceptsLimit(1), true);
  assert.equal(acceptsLimit(10), true);
});

test('[REQ-001] rejects out-of-range input', () => {
  assert.equal(acceptsLimit(0), false, '[REQ-001] out-of-range input must be rejected');
});

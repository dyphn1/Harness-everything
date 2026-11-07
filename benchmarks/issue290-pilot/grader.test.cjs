const assert = require('node:assert/strict');
const vm = require('node:vm');
const { equalValues } = require('./grader.cjs');

for (const [actual, expected] of [
  [[undefined], [null]], [[NaN], [null]], [[Infinity], [null]],
  [{value: undefined}, {}], [Array(1), [null]],
]) assert.throws(() => equalValues(actual, expected), assert.AssertionError);
equalValues(vm.runInNewContext('[1, {x: undefined}, NaN]'), [1, {x: undefined}, NaN]);
console.log('grader equality PASS: five JSON-loss negative controls and cross-realm positive control');

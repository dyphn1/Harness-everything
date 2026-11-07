'use strict';

// Execute every upstream Polyglot assertion without a package-install/model
// cost. This explicit adaptation supports exactly the matchers in the pinned
// simple-linked-list spec, failing closed on anything else.
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('url');
const path = require('path');
const equalValues = (actual, expected) => assert.deepEqual(structuredClone(actual), structuredClone(expected));

async function grade(target) {
  const api = await import(pathToFileURL(path.resolve(target)).href);
  const spec = fs.readFileSync(path.join(__dirname, 'fixtures/polyglot/simple-linked-list.spec.js'), 'utf8');
  assert.equal((spec.match(/\b(?:x)?test\(/g) || []).length, 23, 'pinned test inventory');
  const body = spec.replace(/^import .*;\s*/m, '').replace(/\bxtest\(/g, 'test(');
  let before = () => {};
  const results = [];
  const sandbox = {
    ...api,
    describe: (_name, fn) => { const previous = before; before = () => {}; fn(); before = previous; },
    beforeEach: fn => { before = fn; },
    test: (name, fn) => {
      try { before(); fn(); results.push({name, pass: true}); }
      catch (e) { results.push({name, pass: false, error: e.message}); }
    },
    expect: actual => ({
      toEqual: expected => equalValues(actual, expected),
      toBeDefined: () => assert.notEqual(actual, undefined),
      not: {toThrow: () => assert.doesNotThrow(actual)},
    }),
  };
  vm.runInNewContext(body, sandbox, {timeout: 10000});
  assert.equal(results.length, 23, 'all upstream cases executed');
  console.log(JSON.stringify({pass: results.every(r => r.pass), tests: results.length, results}));
  return results.every(r => r.pass);
}

if (require.main === module) grade(process.argv[2]).then(pass => { process.exitCode = pass ? 0 : 1; }).catch(e => {
  console.log(JSON.stringify({pass: false, graderError: e.message})); process.exitCode = 2;
});
module.exports = {grade, equalValues};

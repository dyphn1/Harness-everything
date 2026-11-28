#!/usr/bin/env node
'use strict';

// Dedicated 3a derived-MUST suite (T2-C #553): preserves doc-change:derived-regenerate
// MUST semantics from ci/mechanism-e1-derived-regenerate.test.js against the surviving
// doc-obligations.js entry on both source and packaged legs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helper = require('./test-helper');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', '553-t2c', 'derived-regenerate-must');
const VIEW = 'docs/governed-index.md';
const LEGS = [
  { name: 'source', modulePath: path.join(ROOT, 'harness-everything', 'scripts', 'doc-obligations.js') },
  { name: 'packaged', modulePath: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'doc-obligations.js') },
];

function readTree(root) {
  const files = {};
  if (!fs.existsSync(root)) return files;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full).split(path.sep).join('/');
        files[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return files;
}

const CONFIG = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'config.json'), 'utf8'));
const BASE_FILES = readTree(path.join(FIXTURE_DIR, 'base'));
const CANDIDATE_FILES = readTree(path.join(FIXTURE_DIR, 'candidate'));

console.log('\n[553-t2c] derived-regenerate MUST semantics (source + packaged)...');

for (const leg of LEGS) {
  let deriveDocFacts;
  let deriveDocObligations;
  try {
    ({ deriveDocFacts, deriveDocObligations } = require(leg.modulePath));
  } catch (error) {
    helper.check(`553-t2c [${leg.name}] doc-obligations module is available`, false, error.message);
    continue;
  }

  try {
    const result = deriveDocFacts({
      base: { files: { ...BASE_FILES } },
      candidate: { files: { ...CANDIDATE_FILES } },
      config: CONFIG,
    });
    const obligations = deriveDocObligations(result.facts);
    const obligation = obligations.find(item => item.capability === 'derived-regenerate');
    assert.ok(obligation, 'derived-regenerate must derive from the real baseline and candidate bytes');
    assert.equal(obligation.id, 'doc-change:derived-regenerate');
    assert.equal(obligation.strength, 'MUST');
    assert.equal(obligation.applicability, 'applicable', 'derived-regenerate must not disappear as N/A');
    assert.deepEqual(obligation.scope, { paths: [VIEW] });
    helper.check(`553-t2c [${leg.name}] wholeSeamFixture derives doc-change:derived-regenerate as applicable MUST`, true);
  } catch (error) {
    helper.check(`553-t2c [${leg.name}] wholeSeamFixture derives doc-change:derived-regenerate as applicable MUST`, false, error.message);
  }

  try {
    const staleCandidate = {
      ...CANDIDATE_FILES,
      [VIEW]: CANDIDATE_FILES[VIEW] + '\nmanual stale edit\n',
    };
    const result = deriveDocFacts({
      base: { files: { ...BASE_FILES } },
      candidate: { files: staleCandidate },
      config: CONFIG,
    });
    const obligations = deriveDocObligations(result.facts);
    const obligation = obligations.find(item => item.capability === 'derived-regenerate');
    assert.ok(obligation, 'stale view must remain an expected derived MUST');
    assert.equal(obligation.id, 'doc-change:derived-regenerate');
    assert.equal(obligation.strength, 'MUST');
    assert.equal(obligation.applicability, 'applicable', 'stale view must remain applicable');
    assert.deepEqual(obligation.scope, { paths: [VIEW] });
    helper.check(`553-t2c [${leg.name}] stale derived view retains doc-change:derived-regenerate as applicable MUST`, true);
  } catch (error) {
    helper.check(`553-t2c [${leg.name}] stale derived view retains doc-change:derived-regenerate as applicable MUST`, false, error.message);
  }
}

helper.finish();

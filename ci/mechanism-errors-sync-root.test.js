#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { render } = require('../scripts/errors-sync');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'errors-sync.js');
const HARNESS_INDEX = path.join(ROOT, '.agents', 'harness-everything', 'errors', 'index.jsonl');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'errors sync root '));
const targetRoot = path.join(temp, 'target repo');
const errorsDir = path.join(targetRoot, '.agents', 'harness-everything', 'errors');
const targetIndex = path.join(errorsDir, 'index.jsonl');

function invoke(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

try {
  const harnessIndexDigest = digest(HARNESS_INDEX);
  const harnessIndex = fs.readFileSync(HARNESS_INDEX, 'utf8');
  assert.equal(invoke(['--check']).status, 0, 'the no-root Harness check is the regression control');
  assert.equal(render(), harnessIndex, 'render() defaults to the current Harness root');
  assert.ok(targetRoot.includes(' '), 'the target root must contain a space');
  assert.equal(isWithin(ROOT, targetRoot), false, 'the temporary target must stay outside the Harness root');

  fs.mkdirSync(errorsDir, { recursive: true });
  fs.writeFileSync(path.join(errorsDir, 'E-0001-root-test.md'), [
    '---',
    'id: E-0001',
    'signature: root-test',
    'class: test',
    'scope: in',
    'status: lesson',
    '---',
    'A target-repository fixture.',
    '',
  ].join('\n'));

  const expectedIndex = `${JSON.stringify({
    id: 'E-0001',
    signature: 'root-test',
    class: 'test',
    title: null,
    scope: 'in',
    status: 'lesson',
    sites: [],
    violates: null,
    mechanism_ref: null,
    episodes: 0,
    rounds: [],
    file: path.posix.join('.agents/harness-everything/errors', 'E-0001-root-test.md'),
  })}\n`;
  fs.writeFileSync(targetIndex, expectedIndex);
  assert.equal(invoke(['--check', '--root', targetRoot]).status, 0,
    '--check --root must accept a current target index');

  fs.appendFileSync(targetIndex, '{stale}\n');
  const stale = invoke(['--check', `--root=${targetRoot}`]);
  assert.equal(stale.status, 1, '--check --root= must reject a stale target index');
  assert.match(stale.stderr, /is stale/, 'stale target check must report the stale index');

  const written = invoke(['--root', targetRoot]);
  assert.equal(written.status, 0, '--root must write the target repository index');
  assert.equal(fs.readFileSync(targetIndex, 'utf8'), expectedIndex, 'target output must use a root-relative posix file path');
  assert.equal(render(targetRoot), expectedIndex, 'render(root) must render the target repository');

  const missingErrorsRoot = path.join(temp, 'repo without errors');
  fs.mkdirSync(missingErrorsRoot);
  const missingErrors = invoke(['--check', '--root', missingErrorsRoot]);
  assert.equal(missingErrors.status, 1, 'a root without its errors directory must be refused');
  assert.ok(missingErrors.stderr.includes(JSON.stringify(missingErrorsRoot)), 'missing-directory error must name the resolved root');
  assert.equal(missingErrors.stderr.trimEnd().split(/\r?\n/).length, 1, 'missing-directory error must be one line');
  assert.equal(fs.existsSync(path.join(missingErrorsRoot, '.agents')), false, 'missing errors directory must not be created');

  const nonexistentRoot = path.join(temp, 'missing repo');
  const missingRoot = invoke(['--check', `--root=${nonexistentRoot}`]);
  assert.equal(missingRoot.status, 1, 'a nonexistent root must be refused');
  assert.ok(missingRoot.stderr.includes(JSON.stringify(nonexistentRoot)), 'missing-root error must name the resolved root');
  assert.equal(fs.existsSync(nonexistentRoot), false, 'a nonexistent root must not be created');

  assert.equal(digest(HARNESS_INDEX), harnessIndexDigest, 'target sync must not change the Harness index');
  console.log('PASS errors-sync supports target roots without changing the Harness index');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

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

function snapshot(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) return { type: 'symlink', target: fs.readlinkSync(file) };
  if (stat.isDirectory()) return {
    type: 'directory',
    entries: Object.fromEntries(fs.readdirSync(file).sort().map(name => [name, snapshot(path.join(file, name))]))
  };
  if (stat.isFile()) return { type: 'file', bytes: fs.readFileSync(file).toString('base64') };
  return { type: 'other', mode: stat.mode };
}

function seedLedger(name) {
  const root = path.join(temp, name);
  const dir = path.join(root, '.agents', 'harness-everything', 'errors');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'E-0001-root-test.md'), [
    '---', 'id: E-0001', 'signature: root-test', 'class: test',
    'scope: in', 'status: lesson', '---', 'A target-repository fixture.', ''
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'index.jsonl'), render(root));
  return { root, dir, index: path.join(dir, 'index.jsonl'), record: path.join(dir, 'E-0001-root-test.md') };
}

function assertUnsafeRefused(target, unchanged, tempDirs) {
  const before = unchanged.map(snapshot);
  const harnessBefore = fs.readFileSync(HARNESS_INDEX);
  for (const args of [[], ['--check']]) {
    const result = invoke([...args, '--root', target.root]);
    assert.notEqual(result.status, 0, `${args.length ? '--check' : 'write'} refuses an unsafe target`);
    assert.ok(result.stderr.trim(), 'unsafe target reports a reason');
    for (const dir of tempDirs) {
      assert.deepEqual(fs.readdirSync(dir).filter(name => /index\.jsonl.*\.tmp$/.test(name)), [],
        'refusal leaves no temporary index file');
    }
  }
  assert.deepEqual(unchanged.map(snapshot), before, 'refusal preserves target records and external sentinels');
  assert.deepEqual(fs.readFileSync(HARNESS_INDEX), harnessBefore, 'target refusal preserves the Harness index');
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

  const previousIndexInode = fs.statSync(targetIndex).ino;
  const written = invoke(['--root', targetRoot]);
  assert.equal(written.status, 0, '--root must write the target repository index');
  assert.equal(fs.readFileSync(targetIndex, 'utf8'), expectedIndex, 'target output must use a root-relative posix file path');
  assert.equal(render(targetRoot), expectedIndex, 'render(root) must render the target repository');
  if (process.platform !== 'win32') {
    assert.notEqual(fs.statSync(targetIndex).ino, previousIndexInode, 'publication atomically replaces the index file');
  }
  assert.deepEqual(fs.readdirSync(errorsDir).filter(name => /index\.jsonl.*\.tmp$/.test(name)), [],
    'successful publication removes its temporary file');

  fs.unlinkSync(targetIndex);
  const missingIndexCheck = invoke(['--check', '--root', targetRoot]);
  assert.equal(missingIndexCheck.status, 1, '--check refuses a missing target index as stale');
  const createMissingIndex = invoke(['--root', targetRoot]);
  assert.equal(createMissingIndex.status, 0, 'write creates a missing regular target index');
  assert.equal(fs.readFileSync(targetIndex, 'utf8'), expectedIndex, 'a newly created index has canonical bytes');

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

  const symlinkIndex = seedLedger('symlinked index repo');
  const externalSentinel = path.join(temp, 'external index sentinel');
  fs.writeFileSync(externalSentinel, 'external index bytes\n');
  fs.unlinkSync(symlinkIndex.index);
  fs.symlinkSync(externalSentinel, symlinkIndex.index, 'file');
  assertUnsafeRefused(symlinkIndex, [symlinkIndex.index, symlinkIndex.record, externalSentinel], [symlinkIndex.dir]);

  const danglingIndex = seedLedger('dangling index repo');
  const danglingTarget = path.join(temp, 'missing external index');
  fs.unlinkSync(danglingIndex.index);
  fs.symlinkSync(danglingTarget, danglingIndex.index, 'file');
  assert.equal(fs.existsSync(danglingTarget), false, 'the dangling-link control target is absent');
  assertUnsafeRefused(danglingIndex, [danglingIndex.index, danglingIndex.record], [danglingIndex.dir]);

  const nonRegularIndex = seedLedger('nonregular index repo');
  fs.unlinkSync(nonRegularIndex.index);
  fs.mkdirSync(nonRegularIndex.index);
  const nonRegularSentinel = path.join(nonRegularIndex.index, 'keep.txt');
  fs.writeFileSync(nonRegularSentinel, 'directory index sentinel\n');
  assertUnsafeRefused(nonRegularIndex, [nonRegularIndex.index, nonRegularSentinel, nonRegularIndex.record], [nonRegularIndex.dir]);

  const symlinkErrors = seedLedger('symlinked errors repo');
  const externalErrors = path.join(temp, 'external errors directory');
  fs.renameSync(symlinkErrors.dir, externalErrors);
  fs.mkdirSync(path.dirname(symlinkErrors.dir), { recursive: true });
  fs.symlinkSync(externalErrors, symlinkErrors.dir, process.platform === 'win32' ? 'junction' : 'dir');
  assertUnsafeRefused(symlinkErrors, [symlinkErrors.dir, path.join(externalErrors, 'index.jsonl'),
    path.join(externalErrors, 'E-0001-root-test.md')], [externalErrors]);

  const symlinkIntermediate = seedLedger('symlinked intermediate repo');
  const intermediate = path.join(symlinkIntermediate.root, '.agents', 'harness-everything');
  const externalIntermediate = path.join(temp, 'external intermediate ledger');
  fs.renameSync(intermediate, externalIntermediate);
  fs.symlinkSync(externalIntermediate, intermediate, process.platform === 'win32' ? 'junction' : 'dir');
  const externalLedger = path.join(externalIntermediate, 'errors');
  assertUnsafeRefused(symlinkIntermediate, [intermediate, path.join(externalLedger, 'index.jsonl'),
    path.join(externalLedger, 'E-0001-root-test.md')], [externalLedger]);

  assert.equal(digest(HARNESS_INDEX), harnessIndexDigest, 'target sync must not change the Harness index');
  console.log('PASS errors-sync supports target roots without changing the Harness index');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

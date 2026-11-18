'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CHECKER_SOURCE = path.join(ROOT, 'scripts', 'check-packet-write-set.js');
const FIXED_DATE = '2000-01-01T00:00:00Z';

function isOutside(root, target, pathApi = path) {
  const relative = pathApi.relative(root, target);
  return relative.startsWith('..') || pathApi.isAbsolute(relative);
}

assert.equal(isOutside('D:\\repo', 'C:\\tmp\\fixture', path.win32), true, 'cross-drive fixtures are outside');
assert.equal(isOutside('D:\\repo', path.win32.join('D:\\repo', 'fixture'), path.win32), false, 'same-drive children are inside');

function gitEnv(tempRoot) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(tempRoot, 'empty-global-config'),
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Packet Fixture',
    GIT_AUTHOR_EMAIL: 'packet-fixture@example.test',
    GIT_COMMITTER_NAME: 'Packet Fixture',
    GIT_COMMITTER_EMAIL: 'packet-fixture@example.test',
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_DATE: FIXED_DATE,
  };
}

function runGit(repo, tempRoot, args) {
  return execFileSync('git', ['-C', repo, ...args], { env: gitEnv(tempRoot) });
}

function gitText(repo, tempRoot, ...args) {
  return runGit(repo, tempRoot, args).toString('utf8').trim();
}

function write(repo, relativePath, content) {
  const file = path.join(repo, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function commitAll(repo, tempRoot, message) {
  runGit(repo, tempRoot, ['add', '--all']);
  runGit(repo, tempRoot, ['commit', '--quiet', '-m', message]);
  return gitText(repo, tempRoot, 'rev-parse', 'HEAD');
}

function makeRepo(t) {
  assert.ok(fs.existsSync(CHECKER_SOURCE), 'checker entry point must be available to the fixture invocation');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packet write set fixture '));
  assert.ok(isOutside(ROOT, tempRoot), 'throwaway git repository is outside the checkout');
  const repo = path.join(tempRoot, 'repo with spaces');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--quiet', repo], { env: gitEnv(tempRoot) });
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  return { repo, tempRoot };
}

function runChecker(repo, tempRoot, { base, head, allow = [], allowFile } = {}) {
  const args = [CHECKER_SOURCE, '--base', base];
  if (head) args.push('--head', head);
  for (const pattern of allow) args.push('--allow', pattern);
  if (allowFile) args.push('--allow-file', allowFile);
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: 'utf8',
    env: gitEnv(tempRoot),
  });
  assert.equal(result.error, undefined, result.error && result.error.message);
  return result;
}

function outOfSetPaths(result) {
  return result.stdout.split(/\r?\n/).filter(line => line.startsWith('OUT_OF_SET '))
    .map(line => JSON.parse(line.slice('OUT_OF_SET '.length)));
}

function snapshotTree(root) {
  const files = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (entry.isDirectory()) visit(file);
      else if (entry.isSymbolicLink()) files[relative] = `link:${fs.readlinkSync(file)}`;
      else files[relative] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  visit(root);
  return files;
}

test('allows matching globs and allow files without accepting similar prefixes', t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, 'docs/guide.md', 'before\n');
  write(repo, 'docs-extra/guide.md', 'before\n');
  const unusualPath = process.platform === 'win32' ? 'docs/space and [guide].md' : 'docs/space and\n[guide].md';
  const base = commitAll(repo, tempRoot, 'baseline');

  write(repo, 'docs/guide.md', 'after\n');
  write(repo, unusualPath, 'new\n');
  write(repo, 'docs-extra/guide.md', 'after\n');
  const head = commitAll(repo, tempRoot, 'change docs');

  const partial = runChecker(repo, tempRoot, { base, head, allow: ['docs/**'] });
  assert.equal(partial.status, 1, partial.stderr);
  assert.deepEqual(outOfSetPaths(partial), ['docs-extra/guide.md']);

  const allowFile = path.join(tempRoot, 'allow patterns.txt');
  fs.writeFileSync(allowFile, 'docs/**\r\ndocs-extra/guide.md\r\n');
  const allowed = runChecker(repo, tempRoot, { base, head, allowFile });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(outOfSetPaths(allowed), []);
  assert.ok(allowed.stdout.includes(`ALLOWED ${JSON.stringify(unusualPath)}`));
});

test('rejects a deleted path unless the deleted endpoint is allowed', t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, 'docs/delete-me.md', 'before\n');
  const base = commitAll(repo, tempRoot, 'baseline');
  fs.rmSync(path.join(repo, 'docs', 'delete-me.md'));
  const head = commitAll(repo, tempRoot, 'delete path');

  const rejected = runChecker(repo, tempRoot, { base, head, allow: ['docs/other.md'] });
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.deepEqual(outOfSetPaths(rejected), ['docs/delete-me.md']);
  const allowed = runChecker(repo, tempRoot, { base, head, allow: ['docs/delete-me.md'] });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('checks both endpoints of a committed rename across the write-set boundary', t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, 'approved/old.txt', 'content\n');
  const base = commitAll(repo, tempRoot, 'baseline');
  fs.mkdirSync(path.join(repo, 'outside'), { recursive: true });
  runGit(repo, tempRoot, ['mv', 'approved/old.txt', 'outside/new.txt']);
  const head = commitAll(repo, tempRoot, 'move across boundary');

  const oldAllowed = runChecker(repo, tempRoot, { base, head, allow: ['approved/**'] });
  assert.equal(oldAllowed.status, 1, oldAllowed.stderr);
  assert.deepEqual(outOfSetPaths(oldAllowed), ['outside/new.txt']);
  const newAllowed = runChecker(repo, tempRoot, { base, head, allow: ['outside/**'] });
  assert.equal(newAllowed.status, 1, newAllowed.stderr);
  assert.deepEqual(outOfSetPaths(newAllowed), ['approved/old.txt']);
  const bothAllowed = runChecker(repo, tempRoot, { base, head, allow: ['approved/**', 'outside/**'] });
  assert.equal(bothAllowed.status, 0, bothAllowed.stderr);
});

test('checks staged, unstaged, untracked and staged-rename paths without mutating the worktree', t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, '.gitignore', 'ignored/**\n');
  write(repo, 'tracked.txt', 'before\n');
  write(repo, 'move/old.txt', 'content\n');
  const base = commitAll(repo, tempRoot, 'baseline');

  write(repo, 'tracked.txt', 'after\n');
  write(repo, 'staged.txt', 'staged\n');
  runGit(repo, tempRoot, ['add', '--', 'staged.txt']);
  fs.mkdirSync(path.join(repo, 'generated'), { recursive: true });
  runGit(repo, tempRoot, ['mv', 'move/old.txt', 'generated/moved.txt']);
  write(repo, 'generated/untracked.json', '{"generated":true}\n');
  write(repo, 'ignored/output.log', 'ignored\n');
  const before = snapshotTree(repo);

  const partial = runChecker(repo, tempRoot, { base, allow: ['staged.txt'] });
  assert.equal(partial.status, 1, partial.stderr);
  assert.deepEqual(outOfSetPaths(partial), [
    'generated/moved.txt',
    'generated/untracked.json',
    'move/old.txt',
    'tracked.txt',
  ]);
  assert.ok(!partial.stdout.includes('ignored/output.log'), 'ignored untracked output is excluded');

  const explicitHead = runChecker(repo, tempRoot, { base, head: 'HEAD', allow: ['staged.txt'] });
  assert.equal(explicitHead.status, 1, explicitHead.stderr);
  assert.deepEqual(outOfSetPaths(explicitHead), outOfSetPaths(partial));

  const allAllowed = runChecker(repo, tempRoot, {
    base,
    allow: ['generated/**', 'move/**', 'staged.txt', 'tracked.txt'],
  });
  assert.equal(allAllowed.status, 0, allAllowed.stderr);
  assert.deepEqual(snapshotTree(repo), before, 'checker leaves files and Git metadata byte-identical');
});

test('compares only the requested commits when --head is not the worktree HEAD', t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, 'base.txt', 'base\n');
  const base = commitAll(repo, tempRoot, 'baseline');
  write(repo, 'allowed.txt', 'in requested head\n');
  const head = commitAll(repo, tempRoot, 'requested head');
  write(repo, 'later.txt', 'after requested head\n');
  commitAll(repo, tempRoot, 'worktree HEAD');
  write(repo, 'dirty.txt', 'uncommitted\n');

  const result = runChecker(repo, tempRoot, { base, head, allow: ['allowed.txt'] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outOfSetPaths(result), []);
  assert.match(result.stdout, /commits only/i);
  assert.doesNotMatch(result.stdout, /later\.txt|dirty\.txt/);
});

test('returns usage errors for an unknown base and a missing allow list', t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, 'tracked.txt', 'base\n');
  const base = commitAll(repo, tempRoot, 'baseline');

  const badBase = runChecker(repo, tempRoot, { base: 'missing-base', allow: ['tracked.txt'] });
  assert.equal(badBase.status, 2);
  assert.match(badBase.stderr, /base|commit|revision/i);

  const missingAllow = spawnSync(process.execPath, [
    CHECKER_SOURCE, '--base', base,
  ], { cwd: repo, encoding: 'utf8', env: gitEnv(tempRoot) });
  assert.equal(missingAllow.status, 2);
});

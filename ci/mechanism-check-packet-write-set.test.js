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
  return relative === '..' || relative.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(relative);
}

test('temporary fixture containment respects Windows path segments and drives', () => {
  for (const [target, outside] of [
    ['D:\\repo', false],
    ['D:\\repo\\..cache', false],
    ['D:\\repo\\child', false],
    ['D:\\other', true],
    ['D:\\', true],
    ['C:\\temp', true],
  ]) {
    assert.equal(isOutside('D:\\repo', target, path.win32), outside, target);
  }
});

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

function runChecker(repo, tempRoot, { base, head, allow = [], allowFile } = {}, extraEnv = {}) {
  const args = [CHECKER_SOURCE, '--base', base];
  if (head) args.push('--head', head);
  for (const pattern of allow) args.push('--allow', pattern);
  if (allowFile) args.push('--allow-file', allowFile);
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...gitEnv(tempRoot), ...extraEnv },
  });
  assert.equal(result.error, undefined, result.error && result.error.message);
  return result;
}

function sparseRuleCounter(tempRoot, { fail = false } = {}) {
  const directory = path.join(tempRoot, 'git counter');
  fs.mkdirSync(directory, { recursive: true });
  const log = path.join(directory, 'check-rules calls');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const wrapper = path.join(directory, 'git');
  fs.writeFileSync(wrapper, [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    "const { spawnSync } = require('node:child_process');",
    `const realGit = ${JSON.stringify(realGit)};`,
    'const args = process.argv.slice(2);',
    "const checkRules = args.includes('sparse-checkout') && args.includes('check-rules');",
    'if (checkRules) {',
    "  if (process.env.WRITE_SET_FAIL_CHECK_RULES === '1') {",
    "    process.stderr.write('injected check-rules failure\\n');",
    '    process.exit(1);',
    '  }',
    "  fs.appendFileSync(process.env.WRITE_SET_CHECK_RULES_LOG, 'x');",
    '}',
    "const child = spawnSync(realGit, args, { stdio: 'inherit' });",
    "if (child.error) { console.error(child.error.message); process.exitCode = 1; }",
    'else process.exitCode = child.status ?? 1;',
    '',
  ].join('\n'), { mode: 0o755 });
  return {
    env: {
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      WRITE_SET_CHECK_RULES_LOG: log,
      WRITE_SET_FAIL_CHECK_RULES: fail ? '1' : '0',
    },
    count: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').length : 0,
  };
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
  runGit(repo, tempRoot, ['update-index', '--assume-unchanged', '--', 'base.txt']);
  try {
    write(repo, 'base.txt', 'hidden workspace-only change\n');
    write(repo, 'dirty.txt', 'uncommitted\n');

    const result = runChecker(repo, tempRoot, { base, head, allow: ['allowed.txt'] });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(outOfSetPaths(result), []);
    assert.match(result.stdout, /commits only/i);
    assert.doesNotMatch(result.stdout, /base\.txt|later\.txt|dirty\.txt/);
  } finally {
    runGit(repo, tempRoot, ['update-index', '--no-assume-unchanged', '--', 'base.txt']);
  }
});

test('batches sparse-rule checks and distinguishes hidden deletions from omissions', { skip: process.platform === 'win32' }, t => {
  const { repo, tempRoot } = makeRepo(t);
  const includedPath = 'included/tracked\nname.txt';
  const omittedPaths = ['omitted/space name.txt', 'omitted/new\nline.txt'];
  write(repo, includedPath, 'inside sparse cone\n');
  for (const file of omittedPaths) write(repo, file, `outside sparse cone: ${file}\n`);
  const base = commitAll(repo, tempRoot, 'baseline');
  write(repo, 'later.txt', 'committed after the requested head\n');
  commitAll(repo, tempRoot, 'later commit');

  runGit(repo, tempRoot, ['sparse-checkout', 'set', 'included']);
  for (const file of omittedPaths) assert.equal(fs.existsSync(path.join(repo, ...file.split('/'))), false, `${file} is outside the sparse cone`);
  runGit(repo, tempRoot, ['update-index', '--skip-worktree', '--', includedPath]);
  fs.rmSync(path.join(repo, ...includedPath.split('/')));
  assert.equal(gitText(repo, tempRoot, 'status', '--porcelain'), '', 'Git hides the in-cone deletion');

  const counter = sparseRuleCounter(tempRoot);
  const before = snapshotTree(repo);
  const result = runChecker(repo, tempRoot, { base, allow: ['later.txt'] }, counter.env);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(outOfSetPaths(result), [includedPath]);
  for (const file of omittedPaths) assert.ok(!result.stdout.includes(JSON.stringify(file)), `${file} is not reported`);
  assert.equal(counter.count(), 1, 'all sparse candidates use one check-rules subprocess');
  assert.deepEqual(snapshotTree(repo), before, 'inspection preserves the index flags and repository state');

  const allowed = runChecker(repo, tempRoot, { base, head: 'HEAD', allow: [includedPath, 'later.txt'] }, counter.env);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.ok(allowed.stdout.includes(`ALLOWED ${JSON.stringify(includedPath)}`));
  assert.equal(counter.count(), 2, 'the second candidate batch also uses one subprocess');
  assert.deepEqual(snapshotTree(repo), before, 'allowed inspection preserves the index flags and repository state');

  const historical = runChecker(repo, tempRoot, { base, head: base, allow: ['later.txt'] }, counter.env);
  assert.equal(historical.status, 0, historical.stderr);
  assert.match(historical.stdout, /commits only/);
  assert.equal(counter.count(), 2, 'a non-current --head does not inspect sparse worktree paths');

  const cleanFixture = makeRepo(t);
  write(cleanFixture.repo, 'included/only.txt', 'present\n');
  const cleanBase = commitAll(cleanFixture.repo, cleanFixture.tempRoot, 'baseline');
  runGit(cleanFixture.repo, cleanFixture.tempRoot, ['sparse-checkout', 'set', 'included']);
  const cleanCounter = sparseRuleCounter(cleanFixture.tempRoot);
  const clean = runChecker(cleanFixture.repo, cleanFixture.tempRoot, { base: cleanBase, allow: ['included/**'] }, cleanCounter.env);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(cleanCounter.count(), 0, 'no sparse-rule process is needed without missing skip-worktree paths');
});

test('fails closed when batched sparse-rule inspection fails', { skip: process.platform === 'win32' }, t => {
  const { repo, tempRoot } = makeRepo(t);
  write(repo, 'included/deleted.txt', 'inside sparse cone\n');
  write(repo, 'omitted/hidden.txt', 'outside sparse cone\n');
  const base = commitAll(repo, tempRoot, 'baseline');
  runGit(repo, tempRoot, ['sparse-checkout', 'set', 'included']);
  runGit(repo, tempRoot, ['update-index', '--skip-worktree', '--', 'included/deleted.txt']);
  fs.rmSync(path.join(repo, 'included', 'deleted.txt'));
  assert.equal(gitText(repo, tempRoot, 'status', '--porcelain'), '');
  const before = snapshotTree(repo);

  const counter = sparseRuleCounter(tempRoot, { fail: true });
  const result = runChecker(repo, tempRoot, { base, allow: ['allowed/**'] }, counter.env);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /git sparse-checkout failed/);
  assert.equal(counter.count(), 0, 'the injected failing inspection is not recorded as a successful invocation');
  assert.deepEqual(snapshotTree(repo), before, 'failed inspection does not mutate the index or worktree');
});

for (const flag of ['assume-unchanged', 'skip-worktree']) {
  test(`checks actual worktree content hidden by --${flag}`, t => {
    const { repo, tempRoot } = makeRepo(t);
    const file = process.platform === 'win32' ? 'hidden [file].txt' : 'hidden [file]\nname.txt';
    write(repo, file, 'before\n');
    const base = commitAll(repo, tempRoot, 'baseline');
    runGit(repo, tempRoot, ['update-index', `--${flag}`, '--', file]);
    try {
      const clean = runChecker(repo, tempRoot, { base, allow: ['allowed/**'] });
      assert.equal(clean.status, 0, clean.stderr);
      assert.equal(clean.stdout, '');

      write(repo, file, 'after!\n');
      assert.equal(gitText(repo, tempRoot, 'status', '--porcelain'), '', 'Git hides the edit');
      const before = snapshotTree(repo);
      const rejected = runChecker(repo, tempRoot, { base, allow: ['allowed/**'] });
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.deepEqual(outOfSetPaths(rejected), [file]);

      const allowed = runChecker(repo, tempRoot, { base, head: 'HEAD', allow: [file] });
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.ok(allowed.stdout.includes(`ALLOWED ${JSON.stringify(file)}`));
      assert.deepEqual(snapshotTree(repo), before, 'inspection preserves the index flags');
    } finally {
      runGit(repo, tempRoot, ['update-index', `--no-${flag}`, '--', file]);
    }
  });
}

test('reports a flagged-file inspection error when Git cannot clean its content', t => {
  const { repo, tempRoot } = makeRepo(t);
  const file = 'hidden.txt';
  write(repo, '.gitattributes', 'hidden.txt filter=broken\n');
  write(repo, file, 'tracked\n');
  const base = commitAll(repo, tempRoot, 'baseline');
  runGit(repo, tempRoot, ['update-index', '--assume-unchanged', '--', file]);
  try {
    runGit(repo, tempRoot, ['config', 'filter.broken.clean', 'exit 1']);
    runGit(repo, tempRoot, ['config', 'filter.broken.required', 'true']);
    const result = runChecker(repo, tempRoot, { base, allow: ['allowed/**'] });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /git hash-object failed/);
  } finally {
    runGit(repo, tempRoot, ['config', '--remove-section', 'filter.broken']);
    runGit(repo, tempRoot, ['update-index', '--no-assume-unchanged', '--', file]);
  }
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

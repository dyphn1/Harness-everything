'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'using-git-worktrees', 'scripts', 'submodule-reachability.js');

function run(command, args, cwd, { allowFailure = false, env = {}, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function git(cwd, args, options) {
  return run('git', args, cwd, options);
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Harness Test']);
  git(dir, ['config', 'user.email', 'harness@example.invalid']);
}

function readJsonRun(cwd) {
  const result = run(process.execPath, [HELPER, '--json'], cwd, { allowFailure: true });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`helper did not emit JSON (status=${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { ...result, parsed };
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-submodule-reachability-'));

try {
  const child = path.join(base, 'child');
  const superRepo = path.join(base, 'super');
  const worktree = path.join(base, 'super-wt');

  initRepo(child);
  fs.writeFileSync(path.join(child, 'seed.txt'), 'seed\n');
  git(child, ['add', 'seed.txt']);
  git(child, ['commit', '-m', 'seed']);
  const seedSha = git(child, ['rev-parse', 'HEAD']).stdout.trim();

  initRepo(superRepo);
  fs.writeFileSync(path.join(superRepo, 'README.md'), 'super\n');
  git(superRepo, ['add', 'README.md']);
  git(superRepo, ['commit', '-m', 'super seed']);
  git(superRepo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'libs/sub']);
  git(superRepo, ['commit', '-am', 'add submodule']);

  git(superRepo, ['worktree', 'add', worktree, '-b', 'feat']);
  git(worktree, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init']);
  const linkedSub = path.join(worktree, 'libs', 'sub');
  git(linkedSub, ['config', 'user.name', 'Harness Test']);
  git(linkedSub, ['config', 'user.email', 'harness@example.invalid']);

  // RED case: a new commit exists only in the linked worktree's submodule git dir.
  git(linkedSub, ['commit', '--allow-empty', '-m', 'isolated child commit']);
  const isolatedSha = git(linkedSub, ['rev-parse', 'HEAD']).stdout.trim();
  const isolated = readJsonRun(worktree);
  assert.strictEqual(isolated.status, 1, 'an unpublished linked-worktree submodule commit must fail');
  assert.strictEqual(isolated.parsed.ok, false);
  assert.strictEqual(isolated.parsed.linkedWorktree, true);
  const isolatedSub = isolated.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.ok(isolatedSub, 'submodule must be reported');
  assert.strictEqual(isolatedSub.sha, isolatedSha);
  assert.strictEqual(isolatedSub.detached, true, 'submodule update should leave HEAD detached');
  assert.strictEqual(isolatedSub.perWorktreeModuleDir, true);
  assert.strictEqual(isolatedSub.reachableFromRemote, false);
  assert.strictEqual(isolatedSub.presentInPrimary, false);
  assert.strictEqual(isolatedSub.externallyReachable, false);

  // A local branch name alone does not make the commit externally reachable.
  git(linkedSub, ['switch', '-c', 'task']);
  const namedLocal = readJsonRun(worktree);
  assert.strictEqual(namedLocal.status, 1, 'a named but unpublished branch must still fail');
  const namedLocalSub = namedLocal.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.strictEqual(namedLocalSub.detached, false);
  assert.strictEqual(namedLocalSub.reachableFromRemote, false);
  assert.strictEqual(namedLocalSub.presentInPrimary, false);
  assert.strictEqual(namedLocalSub.externallyReachable, false);

  // Recovery path: name the commit, fetch it into the primary checkout's submodule object store.
  const primarySub = path.join(superRepo, 'libs', 'sub');
  git(primarySub, ['fetch', linkedSub, 'task:task']);
  const recovered = readJsonRun(worktree);
  assert.strictEqual(recovered.status, 0, 'a commit present in the primary checkout must pass');
  const recoveredSub = recovered.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.strictEqual(recoveredSub.presentInPrimary, true);
  assert.strictEqual(recoveredSub.externallyReachable, true);

  // Remote path: make a new commit that is absent from primary, then publish it.
  git(linkedSub, ['switch', 'task']);
  git(linkedSub, ['commit', '--allow-empty', '-m', 'remote child commit']);
  const remoteSha = git(linkedSub, ['rev-parse', 'HEAD']).stdout.trim();
  git(linkedSub, ['push', '-u', 'origin', 'task']);
  const remote = readJsonRun(worktree);
  assert.strictEqual(remote.status, 0, 'a commit reachable from a remote-tracking ref must pass');
  const remoteSub = remote.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.strictEqual(remoteSub.sha, remoteSha);
  assert.strictEqual(remoteSub.reachableFromRemote, true);
  assert.strictEqual(remoteSub.externallyReachable, true);

  // No-submodule control.
  const plain = path.join(base, 'plain');
  initRepo(plain);
  git(plain, ['commit', '--allow-empty', '-m', 'plain']);
  const noSubmodule = readJsonRun(plain);
  assert.strictEqual(noSubmodule.status, 0);
  assert.strictEqual(noSubmodule.parsed.ok, true);
  assert.deepStrictEqual(noSubmodule.parsed.submodules, []);

  // A deinitialized submodule can make `git -C <submodule>` resolve to the
  // superproject. Never use that unrelated HEAD or its remote refs as proof
  // that the staged gitlink is reachable.
  const uninitWorktree = path.join(base, 'super-wt-uninitialized');
  git(superRepo, ['worktree', 'add', uninitWorktree, '-b', 'feat-uninitialized']);
  git(uninitWorktree, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init']);
  const uninitializedSub = path.join(uninitWorktree, 'libs', 'sub');
  git(uninitializedSub, ['config', 'user.name', 'Harness Test']);
  git(uninitializedSub, ['config', 'user.email', 'harness@example.invalid']);
  git(uninitializedSub, ['commit', '--allow-empty', '-m', 'uninitialized submodule commit']);
  const uninitializedSha = git(uninitializedSub, ['rev-parse', 'HEAD']).stdout.trim();
  git(uninitWorktree, ['add', 'libs/sub']);
  const superSha = git(uninitWorktree, ['rev-parse', 'HEAD']).stdout.trim();
  git(uninitWorktree, ['update-ref', 'refs/remotes/origin/main', superSha]);
  git(uninitWorktree, ['submodule', 'deinit', '--force', '--', 'libs/sub']);

  const uninitialized = readJsonRun(uninitWorktree);
  assert.strictEqual(uninitialized.status, 1, 'an uninitialized staged gitlink without external reachability must fail');
  const uninitializedEntry = uninitialized.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.ok(uninitializedEntry, 'uninitialized submodule must be reported');
  assert.strictEqual(uninitializedEntry.initialized, false);
  assert.strictEqual(uninitializedEntry.sha, uninitializedSha);
  assert.strictEqual(uninitializedEntry.reachableFromRemote, false);
  assert.strictEqual(uninitializedEntry.presentInPrimary, false);
  assert.strictEqual(uninitializedEntry.externallyReachable, false);

  // An unmerged gitlink has no single target SHA and must fail as an
  // inspection error instead of checking the submodule's current HEAD.
  const conflictWorktree = path.join(base, 'super-wt-conflict');
  git(superRepo, ['worktree', 'add', conflictWorktree, '-b', 'feat-conflict']);
  git(conflictWorktree, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init']);
  const zeroSha = '0'.repeat(seedSha.length);
  const conflictIndex = [
    `0 ${zeroSha} 0\tlibs/sub`,
    `160000 ${seedSha} 1\tlibs/sub`,
    `160000 ${isolatedSha} 2\tlibs/sub`,
    `160000 ${remoteSha} 3\tlibs/sub`,
    '',
  ].join('\n');
  git(conflictWorktree, ['update-index', '--index-info'], { input: conflictIndex });
  const conflictStatus = git(conflictWorktree, ['submodule', 'status', '--recursive']).stdout.trim();
  assert.match(conflictStatus, /^U/, `fixture must produce an unmerged gitlink: ${conflictStatus}`);
  const conflict = run(process.execPath, [HELPER, '--json'], conflictWorktree, { allowFailure: true });
  assert.strictEqual(conflict.status, 2, `unmerged gitlink must fail inspection: ${conflict.stdout}\n${conflict.stderr}`);
  assert.match(conflict.stderr, /unmerged submodule gitlink/i);

  console.log('Worktree submodule reachability: detached, named-unpublished, uninitialized, and unmerged gitlinks fail safely; primary/remote reachability and no-submodule controls pass.');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

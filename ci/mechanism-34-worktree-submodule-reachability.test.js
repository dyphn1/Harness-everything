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

  // Clean initialized submodules use a leading-space status marker. The helper
  // must preserve/normalize that state instead of consuming the first SHA byte
  // as a prefix when command output is trimmed.
  const cleanRawStatus = git(worktree, ['submodule', 'status', '--recursive']).stdout;
  assert.match(cleanRawStatus, /^ [0-9a-f]{40,64}\s+libs\/sub\b/, 'fixture must begin with a clean initialized submodule');
  const clean = readJsonRun(worktree);
  assert.strictEqual(clean.status, 0, 'a clean initialized linked-worktree submodule must be inspectable');
  assert.strictEqual(clean.parsed.ok, true);
  assert.strictEqual(clean.parsed.linkedWorktree, true);
  const cleanSub = clean.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.ok(cleanSub, 'clean initialized submodule must be reported');
  assert.strictEqual(cleanSub.sha, seedSha);
  assert.strictEqual(cleanSub.initialized, true);
  assert.strictEqual(cleanSub.detached, true);
  assert.strictEqual(cleanSub.externallyReachable, true);

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

  // A published working HEAD must not hide an unpublished staged/committed gitlink.
  git(linkedSub, ['commit', '--allow-empty', '-m', 'recorded but unpublished']);
  const recordedSha = git(linkedSub, ['rev-parse', 'HEAD']).stdout.trim();
  git(worktree, ['add', 'libs/sub']);
  git(linkedSub, ['checkout', '--detach', seedSha]);
  const stagedOnly = readJsonRun(worktree);
  assert.deepStrictEqual(readJsonRun(worktree).parsed, stagedOnly.parsed, 'identical topology must produce identical evidence');
  assert.strictEqual(stagedOnly.status, 1, 'the unpublished index SHA must fail even with a published working HEAD');
  let reference = stagedOnly.parsed.submodules[0].referencedCommits.find(item => item.sha === recordedSha);
  assert.deepStrictEqual(reference.sources, ['index']);
  assert.strictEqual(reference.externallyReachable, false);

  git(worktree, ['commit', '-m', 'record unpublished gitlink']);
  // Stage the safe SHA over it: the unsafe committed SHA must still be checked.
  git(worktree, ['add', 'libs/sub']);
  const committedOnly = readJsonRun(worktree);
  assert.strictEqual(committedOnly.status, 1, 'the unpublished superproject HEAD SHA must fail independently of index and working HEAD');
  reference = committedOnly.parsed.submodules[0].referencedCommits.find(item => item.sha === recordedSha);
  assert.deepStrictEqual(reference.sources, ['HEAD']);
  assert.strictEqual(reference.externallyReachable, false);

  git(primarySub, ['fetch', linkedSub, 'task:recorded-recovery']);
  const recordedRecovered = readJsonRun(worktree);
  assert.deepStrictEqual(readJsonRun(worktree).parsed, recordedRecovered.parsed, 'recovered evidence must be deterministic');
  assert.strictEqual(recordedRecovered.status, 0, 'recovering the recorded SHA in primary must allow the unchanged topology');
  reference = recordedRecovered.parsed.submodules[0].referencedCommits.find(item => item.sha === recordedSha);
  assert.strictEqual(reference.presentInPrimary, true);
  assert.strictEqual(reference.externallyReachable, true);

  // Nested recovery: Git stores a nested submodule under the parent's module
  // repository (.../modules/<parent>/modules/<child>), not by flattening the
  // full worktree path below the top-level common dir.
  const nestedLeafOrigin = path.join(base, 'nested-leaf-origin');
  const nestedParentOrigin = path.join(base, 'nested-parent-origin');
  const nestedSuper = path.join(base, 'nested-super');
  const nestedWorktree = path.join(base, 'nested-super-wt');

  initRepo(nestedLeafOrigin);
  fs.writeFileSync(path.join(nestedLeafOrigin, 'leaf.txt'), 'leaf\n');
  git(nestedLeafOrigin, ['add', 'leaf.txt']);
  git(nestedLeafOrigin, ['commit', '-m', 'leaf seed']);

  initRepo(nestedParentOrigin);
  fs.writeFileSync(path.join(nestedParentOrigin, 'parent.txt'), 'parent\n');
  git(nestedParentOrigin, ['add', 'parent.txt']);
  git(nestedParentOrigin, ['commit', '-m', 'parent seed']);
  git(nestedParentOrigin, ['-c', 'protocol.file.allow=always', 'submodule', 'add', nestedLeafOrigin, 'nested/leaf']);
  git(nestedParentOrigin, ['commit', '-am', 'add nested leaf']);

  initRepo(nestedSuper);
  fs.writeFileSync(path.join(nestedSuper, 'README.md'), 'nested super\n');
  git(nestedSuper, ['add', 'README.md']);
  git(nestedSuper, ['commit', '-m', 'nested super seed']);
  git(nestedSuper, ['-c', 'protocol.file.allow=always', 'submodule', 'add', nestedParentOrigin, 'libs/sub']);
  git(nestedSuper, ['commit', '-am', 'add nested parent']);
  git(nestedSuper, ['worktree', 'add', nestedWorktree, '-b', 'nested-feat']);
  git(nestedWorktree, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive']);

  const linkedNestedLeaf = path.join(nestedWorktree, 'libs', 'sub', 'nested', 'leaf');
  git(linkedNestedLeaf, ['config', 'user.name', 'Harness Test']);
  git(linkedNestedLeaf, ['config', 'user.email', 'harness@example.invalid']);
  git(linkedNestedLeaf, ['switch', '-c', 'nested-task']);
  git(linkedNestedLeaf, ['commit', '--allow-empty', '-m', 'nested worktree-only commit']);
  const nestedSha = git(linkedNestedLeaf, ['rev-parse', 'HEAD']).stdout.trim();

  const primaryNestedParent = path.join(nestedSuper, 'libs', 'sub');
  git(primaryNestedParent, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive']);
  const primaryNestedLeaf = path.join(primaryNestedParent, 'nested', 'leaf');
  git(primaryNestedLeaf, ['fetch', linkedNestedLeaf, 'nested-task:nested-recovery']);
  git(primaryNestedParent, ['submodule', 'deinit', '--force', '--', 'nested/leaf']);

  const nestedRecovered = readJsonRun(nestedWorktree);
  assert.strictEqual(nestedRecovered.status, 0, 'a nested commit recovered only in the primary module object store must pass');
  const nestedEntry = nestedRecovered.parsed.submodules.find(entry => entry.path === 'libs/sub/nested/leaf');
  assert.ok(nestedEntry, 'nested submodule must be reported');
  assert.strictEqual(nestedEntry.sha, nestedSha);
  assert.strictEqual(nestedEntry.reachableFromRemote, false);
  assert.strictEqual(nestedEntry.presentInPrimary, true);
  assert.strictEqual(nestedEntry.externallyReachable, true);

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

  // A deinitialized primary submodule leaves an empty directory, so
  // `git -C <primary>/<submodule>` resolves to the primary superproject. An
  // object in that unrelated store is not proof of submodule reachability.
  const fallbackWorktree = path.join(base, 'super-wt-primary-fallback');
  git(superRepo, ['worktree', 'add', fallbackWorktree, '-b', 'feat-primary-fallback']);
  git(fallbackWorktree, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init']);
  const fallbackSub = path.join(fallbackWorktree, 'libs', 'sub');
  git(fallbackSub, ['config', 'user.name', 'Harness Test']);
  git(fallbackSub, ['config', 'user.email', 'harness@example.invalid']);
  git(fallbackSub, ['switch', '-c', 'fallback-task']);
  git(fallbackSub, ['commit', '--allow-empty', '-m', 'superproject-store only commit']);
  const fallbackSha = git(fallbackSub, ['rev-parse', 'HEAD']).stdout.trim();
  git(fallbackWorktree, ['add', 'libs/sub']);
  // Empty the primary checkout directory without touching shared submodule
  // config, which would also uninitialize the linked worktree.
  fs.rmSync(primarySub, { recursive: true, force: true });
  fs.mkdirSync(primarySub);
  fs.rmSync(path.join(superRepo, '.git', 'modules', 'libs', 'sub'), { recursive: true, force: true });
  git(superRepo, ['fetch', fallbackSub, 'fallback-task:refs/foreign/fallback-task']);
  assert.strictEqual(git(superRepo, ['cat-file', '-e', `${fallbackSha}^{commit}`], { allowFailure: true }).status, 0,
    'fixture must place the commit only in the primary superproject object store');
  const fallback = readJsonRun(fallbackWorktree);
  assert.strictEqual(fallback.status, 1, 'a commit found only through git -C fallback to the superproject must fail');
  const fallbackEntry = fallback.parsed.submodules.find(entry => entry.path === 'libs/sub');
  assert.strictEqual(fallbackEntry.initialized, true);
  assert.strictEqual(fallbackEntry.sha, fallbackSha);
  assert.strictEqual(fallbackEntry.presentInPrimary, false);
  assert.strictEqual(fallbackEntry.externallyReachable, false);

  console.log('Worktree submodule reachability: detached, named-unpublished, uninitialized, and unmerged gitlinks fail safely; primary/remote reachability and no-submodule controls pass.');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

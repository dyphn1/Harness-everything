'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function git(cwd, args) {
  return run('git', args, cwd);
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Harness Behavioral Fixture']);
  git(dir, ['config', 'user.email', 'behavioral-fixture@example.invalid']);
}

const workspace = process.cwd();
const child = path.join(workspace, 'child-origin');
const superRepo = path.join(workspace, 'super');
const worktree = path.join(workspace, 'super-wt');
const toolsDir = path.join(workspace, '.fixture-tools');

initRepo(child);
fs.writeFileSync(path.join(child, 'module.txt'), 'seed\n');
git(child, ['add', 'module.txt']);
git(child, ['commit', '-m', 'seed child']);

initRepo(superRepo);
fs.writeFileSync(path.join(superRepo, 'README.md'), 'superproject fixture\n');
git(superRepo, ['add', 'README.md']);
git(superRepo, ['commit', '-m', 'seed superproject']);
git(superRepo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'libs/sub']);
git(superRepo, ['commit', '-am', 'add child submodule']);

git(superRepo, ['worktree', 'add', worktree, '-b', 'eval/submodule-reachability']);
git(worktree, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init']);
const linkedSub = path.join(worktree, 'libs', 'sub');
git(linkedSub, ['config', 'user.name', 'Harness Behavioral Agent']);
git(linkedSub, ['config', 'user.email', 'behavioral-agent@example.invalid']);

fs.mkdirSync(toolsDir, { recursive: true });
fs.copyFileSync(
  path.join(ROOT, 'using-git-worktrees', 'scripts', 'submodule-reachability.js'),
  path.join(toolsDir, 'submodule-reachability.js')
);
fs.copyFileSync(
  path.join(__dirname, 'verify-worktree-submodule.js'),
  path.join(toolsDir, 'verify-worktree-submodule.js')
);

fs.writeFileSync(
  path.join(workspace, '.fixture-topology.json'),
  JSON.stringify({
    primary: 'super',
    linked_worktree: 'super-wt',
    submodule: 'super-wt/libs/sub',
  }, null, 2) + '\n'
);

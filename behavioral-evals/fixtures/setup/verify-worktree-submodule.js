'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  const workspace = process.cwd();
  const superRepo = path.join(workspace, 'super-wt');
  const submodule = path.join(superRepo, 'libs', 'sub');
  const content = fs.readFileSync(path.join(submodule, 'module.txt'), 'utf8');
  if (!content.includes('feature-ready')) fail('submodule content was not updated');

  const sha = git(submodule, ['rev-parse', 'HEAD']);
  const branch = git(submodule, ['branch', '--show-current']);
  if (!branch) fail('submodule commit remains detached');

  const remoteRefs = git(submodule, [
    'for-each-ref', '--contains', sha, '--format=%(refname:short)', 'refs/remotes/'
  ]).split(/\r?\n/).filter(Boolean);
  if (remoteRefs.length === 0) fail('submodule commit is not published to a remote-tracking ref');

  if (git(submodule, ['status', '--porcelain'])) fail('submodule working tree is not clean');
  if (git(superRepo, ['status', '--porcelain', '--', 'libs/sub'])) fail('superproject gitlink is not clean');

  const tree = git(superRepo, ['ls-tree', 'HEAD', 'libs/sub']);
  const match = tree.match(/^160000 commit ([0-9a-f]{40,64})\tlibs\/sub$/);
  if (!match || match[1] !== sha) fail('superproject HEAD does not record the new submodule commit');

  console.log(JSON.stringify({ ok: true, sha, branch, remoteRefs }));
} catch (error) {
  fail(error.message);
}

#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function runGit(args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${message ? `: ${message}` : ''}`);
  }
  return result;
}

function gitText(args, cwd, options) {
  const result = runGit(args, cwd, options);
  return result.status === 0 ? result.stdout.trim() : '';
}

function absoluteCommonDir(root) {
  const absolute = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], root, { allowFailure: true });
  if (absolute.status === 0) return path.resolve(absolute.stdout.trim());
  const raw = gitText(['rev-parse', '--git-common-dir'], root);
  return path.resolve(root, raw);
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function parseSubmoduleStatus(text) {
  if (!text.trim()) return [];
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^(.)([0-9a-fA-F]{40,64})\s+(.+?)(?:\s+\(.+\))?$/);
    if (!match) throw new Error(`cannot parse git submodule status line: ${line}`);
    return {
      prefix: match[1],
      recordedSha: match[2],
      path: match[3],
    };
  });
}

function primaryHasCommit(primaryRoot, commonDir, submodulePath, sha) {
  if (!primaryRoot) return false;
  const primarySub = path.join(primaryRoot, ...submodulePath.split('/'));
  let result = runGit(['-C', primarySub, 'cat-file', '-e', `${sha}^{commit}`], primaryRoot, { allowFailure: true });
  if (result.status === 0) return true;

  // Direct submodules created by `git submodule add` have their repository
  // here even if the primary checkout's working tree path is absent.
  const moduleGitDir = path.join(commonDir, 'modules', ...submodulePath.split('/'));
  result = runGit(['--git-dir', moduleGitDir, 'cat-file', '-e', `${sha}^{commit}`], primaryRoot, { allowFailure: true });
  return result.status === 0;
}

function inspect(root = process.cwd()) {
  root = path.resolve(root);
  const superGitDir = path.resolve(gitText(['rev-parse', '--absolute-git-dir'], root));
  const commonDir = absoluteCommonDir(root);
  const linkedWorktree = superGitDir !== commonDir;
  const primaryRoot = linkedWorktree && path.basename(commonDir).toLowerCase() === '.git'
    ? path.dirname(commonDir)
    : null;
  const status = gitText(['submodule', 'status', '--recursive'], root);
  const submodules = [];

  for (const entry of parseSubmoduleStatus(status)) {
    const subPath = path.join(root, ...entry.path.split('/'));
    const head = runGit(['-C', subPath, 'rev-parse', 'HEAD'], root, { allowFailure: true });
    if (head.status !== 0) {
      submodules.push({
        path: entry.path,
        sha: entry.recordedSha,
        initialized: false,
        detached: null,
        perWorktreeModuleDir: null,
        reachableFromRemote: false,
        remoteRefs: [],
        presentInPrimary: false,
        externallyReachable: true,
      });
      continue;
    }

    const sha = head.stdout.trim();
    const branch = gitText(['-C', subPath, 'branch', '--show-current'], root);
    const subGitDir = path.resolve(gitText(['-C', subPath, 'rev-parse', '--absolute-git-dir'], root));
    const remoteRefs = gitText(
      ['-C', subPath, 'for-each-ref', '--contains', sha, '--format=%(refname:short)', 'refs/remotes/'],
      root
    ).split(/\r?\n/).filter(Boolean);
    const reachableFromRemote = remoteRefs.length > 0;
    const presentInPrimary = linkedWorktree
      ? primaryHasCommit(primaryRoot, commonDir, entry.path, sha)
      : true;
    const externallyReachable = !linkedWorktree || reachableFromRemote || presentInPrimary;

    submodules.push({
      path: entry.path,
      sha,
      initialized: true,
      detached: branch === '',
      branch: branch || null,
      gitDir: subGitDir,
      perWorktreeModuleDir: linkedWorktree && isInside(subGitDir, path.join(commonDir, 'worktrees')),
      reachableFromRemote,
      remoteRefs,
      presentInPrimary,
      externallyReachable,
    });
  }

  return {
    root,
    linkedWorktree,
    gitDir: superGitDir,
    commonDir,
    primaryRoot,
    ok: submodules.every(entry => entry.externallyReachable),
    submodules,
  };
}

function printHuman(report) {
  console.log(`Superproject: ${report.root}`);
  console.log(`Linked worktree: ${report.linkedWorktree ? 'yes' : 'no'}`);
  if (!report.submodules.length) {
    console.log('Submodules: none');
    return;
  }
  for (const entry of report.submodules) {
    const state = entry.externallyReachable ? 'OK' : 'UNREACHABLE';
    console.log(`[${state}] ${entry.path} @ ${entry.sha}`);
    if (!entry.initialized) {
      console.log('  initialized: no');
      continue;
    }
    console.log(`  branch: ${entry.branch || '(detached)'}`);
    console.log(`  per-worktree git dir: ${entry.perWorktreeModuleDir ? 'yes' : 'no'}`);
    console.log(`  remote reachability: ${entry.remoteRefs.length ? entry.remoteRefs.join(', ') : 'none'}`);
    console.log(`  present in primary checkout: ${entry.presentInPrimary ? 'yes' : 'no'}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd();
  if (rootIndex >= 0 && !root) throw new Error('--root requires a path');
  const report = inspect(root);
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else printHuman(report);
  process.exitCode = report.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`submodule-reachability: ${error.message}`);
    process.exit(2);
  }
}

module.exports = { inspect, parseSubmoduleStatus, primaryHasCommit };

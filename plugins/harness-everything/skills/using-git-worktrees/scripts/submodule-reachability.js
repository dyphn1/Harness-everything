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
    // gitText() trims the whole command output, so the first clean-status
    // marker (a leading space) may already be gone. Accept only the four Git
    // status states here; an omitted marker is normalized back to clean.
    const match = line.match(/^([ +U-]?)([0-9a-fA-F]{40,64})\s+(.+?)(?:\s+\(.+\))?$/);
    if (!match) throw new Error(`cannot parse git submodule status line: ${line}`);
    return {
      prefix: match[1] || ' ',
      recordedSha: match[2],
      path: match[3],
    };
  });
}

function primaryHasCommit(primaryRoot, commonDir, submodulePath, sha, moduleGitDir = null) {
  if (!primaryRoot) return false;
  const primarySub = path.join(primaryRoot, ...submodulePath.split('/'));
  let result = runGit(['-C', primarySub, 'cat-file', '-e', `${sha}^{commit}`], primaryRoot, { allowFailure: true });
  if (result.status === 0) return true;

  // A nested submodule repository is stored below its parent's module repo,
  // e.g. .git/modules/parent/modules/child. Callers pass that exact location
  // when recursion is known; direct submodules retain the historical fallback.
  const candidateGitDir = moduleGitDir || path.join(commonDir, 'modules', ...submodulePath.split('/'));
  result = runGit(['--git-dir', candidateGitDir, 'cat-file', '-e', `${sha}^{commit}`], primaryRoot, { allowFailure: true });
  return result.status === 0;
}

// Read the recorded gitlinks from their owning repository, not from the
// submodule working HEAD (which may have been checked out to an older commit).
function recordedGitlinks(owner, relativePath) {
  const commits = new Map();
  function add(sha, source) {
    if (!commits.has(sha)) commits.set(sha, { sha, sources: [] });
    commits.get(sha).sources.push(source);
  }
  const index = runGit(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', relativePath], owner).stdout;
  for (const record of index.split('\0').filter(Boolean)) {
    const match = record.match(/^160000 ([0-9a-f]{40,64}) ([0-3])\t(.*)$/s);
    if (!match || match[3] !== relativePath) continue;
    if (match[2] !== '0') throw new Error(`unmerged submodule gitlink cannot be verified: ${relativePath}`);
    add(match[1], 'index');
  }
  if (runGit(['rev-parse', '--verify', 'HEAD'], owner, { allowFailure: true }).status === 0) {
    const tree = runGit(['--literal-pathspecs', 'ls-tree', '-z', 'HEAD', '--', relativePath], owner).stdout;
    for (const record of tree.split('\0').filter(Boolean)) {
      const match = record.match(/^160000 commit ([0-9a-f]{40,64})\t(.*)$/s);
      if (match && match[2] === relativePath) add(match[1], 'HEAD');
    }
  }
  return [...commits.values()];
}

function inspect(root = process.cwd()) {
  root = path.resolve(gitText(['rev-parse', '--show-toplevel'], path.resolve(root)));
  const superGitDir = path.resolve(gitText(['rev-parse', '--absolute-git-dir'], root));
  const commonDir = absoluteCommonDir(root);
  const linkedWorktree = superGitDir !== commonDir;
  const primaryRoot = linkedWorktree && path.basename(commonDir).toLowerCase() === '.git'
    ? path.dirname(commonDir)
    : null;
  const status = gitText(['submodule', 'status', '--recursive'], root);
  const submodules = [];
  const initializedPaths = [];
  const primaryModuleDirs = new Map();

  for (const entry of parseSubmoduleStatus(status)) {
    if (entry.prefix === 'U') {
      throw new Error(`unmerged submodule gitlink cannot be verified: ${entry.path}`);
    }

    const parentPath = initializedPaths.filter(parent => entry.path.startsWith(parent + '/'))
      .sort((a, b) => b.length - a.length)[0];
    const owner = parentPath ? path.join(root, ...parentPath.split('/')) : root;
    const relativePath = parentPath ? entry.path.slice(parentPath.length + 1) : entry.path;
    const subPath = path.join(root, ...entry.path.split('/'));
    const parentModuleGitDir = parentPath ? primaryModuleDirs.get(parentPath) : null;
    const primaryModuleGitDir = parentPath
      ? path.join(parentModuleGitDir, 'modules', ...relativePath.split('/'))
      : path.join(commonDir, 'modules', ...entry.path.split('/'));
    primaryModuleDirs.set(entry.path, primaryModuleGitDir);
    const referencedCommits = recordedGitlinks(owner, relativePath).map(reference => {
      // A recorded object may be absent locally but already recovered in primary.
      const hasObject = entry.prefix !== '-' && runGit(
        ['cat-file', '-e', `${reference.sha}^{commit}`], subPath, { allowFailure: true }
      ).status === 0;
      const remoteRefs = hasObject ? gitText(
        ['for-each-ref', '--contains', reference.sha, '--format=%(refname:short)', 'refs/remotes/'], subPath
      ).split(/\r?\n/).filter(Boolean) : [];
      const presentInPrimary = linkedWorktree
        ? primaryHasCommit(primaryRoot, commonDir, entry.path, reference.sha, primaryModuleGitDir) : true;
      return {
        ...reference,
        remoteRefs,
        reachableFromRemote: remoteRefs.length > 0,
        presentInPrimary,
        externallyReachable: !linkedWorktree || remoteRefs.length > 0 || presentInPrimary,
      };
    });

    if (entry.prefix === '-') {
      const presentInPrimary = linkedWorktree
        ? primaryHasCommit(primaryRoot, commonDir, entry.path, entry.recordedSha, primaryModuleGitDir)
        : true;
      const externallyReachable = !linkedWorktree || presentInPrimary;
      submodules.push({
        path: entry.path,
        sha: entry.recordedSha,
        initialized: false,
        detached: null,
        perWorktreeModuleDir: null,
        reachableFromRemote: false,
        remoteRefs: [],
        presentInPrimary,
        referencedCommits,
        externallyReachable: externallyReachable && referencedCommits.every(reference => reference.externallyReachable),
      });
      continue;
    }

    initializedPaths.push(entry.path);
    const head = runGit(['-C', subPath, 'rev-parse', 'HEAD'], root, { allowFailure: true });
    if (head.status !== 0) {
      throw new Error(`cannot inspect initialized submodule ${entry.path}: ${(head.stderr || head.stdout || '').trim()}`);
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
      ? primaryHasCommit(primaryRoot, commonDir, entry.path, sha, primaryModuleGitDir)
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
      referencedCommits,
      externallyReachable: externallyReachable && referencedCommits.every(reference => reference.externallyReachable),
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
    for (const reference of entry.referencedCommits) {
      console.log(`  ${reference.sources.join('/')} gitlink: ${reference.sha} (${reference.externallyReachable ? 'OK' : 'UNREACHABLE'})`);
    }
    if (!entry.initialized) {
      console.log('  initialized: no');
      console.log(`  present in primary checkout: ${entry.presentInPrimary ? 'yes' : 'no'}`);
      if (report.linkedWorktree && !entry.presentInPrimary) {
        console.log('  remote reachability: unverified; initialize the submodule or fetch the commit into the primary checkout');
      }
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

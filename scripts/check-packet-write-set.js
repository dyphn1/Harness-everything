#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const USAGE = 'Usage: node scripts/check-packet-write-set.js --base <sha> [--head <rev>] --allow <path-or-glob>... [--allow-file <file>]';

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { allow: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--base', '--head', '--allow', '--allow-file'].includes(name)) {
      throw new UsageError(`unknown option ${JSON.stringify(name)}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`${name} requires a value`);
    index += 1;
    if (name === '--base' || name === '--head' || name === '--allow-file') {
      const key = name.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      if (options[key] !== undefined) throw new UsageError(`${name} may be used only once`);
      options[key] = value;
    } else {
      options.allow.push(value);
    }
  }
  if (!options.base) throw new UsageError('--base is required');
  if (!options.allow.length && !options.allowFile) throw new UsageError('at least one --allow or --allow-file is required');
  return options;
}

function git(args, cwd = process.cwd(), input) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  if (process.env.GIT_CONFIG_GLOBAL !== undefined) env.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  });
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
    cwd,
    encoding: null,
    input,
    shell: false,
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`could not run git: ${result.error.message}`);
  return result;
}

function repositoryRoot() {
  const result = git(['rev-parse', '--show-toplevel']);
  if (result.status !== 0) throw new UsageError('current working directory is not inside a Git repository');
  return result.stdout.toString('utf8').trim();
}

function commit(revision, label, repo) {
  const result = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`], repo);
  if (result.status !== 0) throw new UsageError(`invalid ${label} commit ${JSON.stringify(revision)}`);
  return result.stdout.toString('utf8').trim();
}

function pathsFrom(result, args) {
  if (result.status !== 0) {
    const detail = result.stderr.toString('utf8').trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function globRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          source += '(?:[\\s\\S]*/)?';
          index += 1;
        } else {
          source += '[\\s\\S]*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function readAllowPatterns(options) {
  const patterns = [...options.allow];
  if (options.allowFile) {
    const file = path.resolve(process.cwd(), options.allowFile);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    patterns.push(...lines);
  }
  if (!patterns.length) throw new UsageError('allow file contains no path patterns');
  return patterns.map(pattern => {
    if (pattern.includes('\0')) throw new UsageError('allow patterns cannot contain NUL bytes');
    return globRegExp(pattern);
  });
}

function gitBooleanConfig(repo, key, fallback) {
  const args = ['config', '--bool', '--get', key];
  const result = git(args, repo);
  if (result.status === 1 && !result.stderr.length) return fallback;
  return pathsFrom(result, args)[0]?.trim() === 'true';
}

function sparseCheckoutIncludes(repo, files) {
  const args = ['sparse-checkout', 'check-rules', '-z'];
  const input = Buffer.from(`${files.join('\0')}\0`);
  return new Set(pathsFrom(git(args, repo, input), args));
}

function flaggedWorkingTreeChanges(repo) {
  const args = ['ls-files', '-v', '--stage', '-z'];
  const changes = [];
  const sparseRuleCandidates = [];
  let sparseCheckout;
  for (const entry of pathsFrom(git(args, repo), args)) {
    // Lowercase tags mark assume-unchanged; S/s marks skip-worktree.
    if (!/^[a-zS] /.test(entry)) continue;
    const separator = entry.indexOf('\t');
    const [tag, mode, oid, stage] = entry.slice(0, separator).split(' ');
    if (stage !== '0') continue;
    const file = entry.slice(separator + 1);
    const absolute = path.join(repo, file);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) {
      // Skip only paths excluded by the active sparse rules; an in-cone deletion
      // can also carry the skip-worktree bit.
      if (tag.toUpperCase() === 'S'
        && (sparseCheckout ??= gitBooleanConfig(repo, 'core.sparseCheckout', false))) {
        sparseRuleCandidates.push(file);
      } else {
        changes.push(file);
      }
      continue;
    }

    let hashArgs;
    let hashCwd = repo;
    let input;
    if (mode === '160000' && stat.isDirectory()) {
      // An uninitialized submodule has no checked-out commit to compare.
      if (!fs.lstatSync(path.join(absolute, '.git'), { throwIfNoEntry: false })) continue;
      hashArgs = ['rev-parse', '--verify', 'HEAD'];
      hashCwd = absolute;
    } else if (mode === '120000' && stat.isSymbolicLink()) {
      hashArgs = ['hash-object', '--stdin'];
      input = fs.readlinkSync(absolute, { encoding: 'buffer' });
    } else if (mode === '120000' && stat.isFile() && !gitBooleanConfig(repo, 'core.symlinks', true)) {
      // Git can check out a symlink as a plain file containing its target.
      hashArgs = ['hash-object', '--no-filters', '--', file];
    } else if (mode.startsWith('100') && stat.isFile()) {
      // Apply Git's clean filters just as when comparing normal tracked files.
      hashArgs = ['hash-object', `--path=${file}`, '--', file];
    } else {
      changes.push(file);
      continue;
    }
    const actual = pathsFrom(git(hashArgs, hashCwd, input), hashArgs)[0]?.trim();
    if (!actual) throw new Error(`could not compare tracked path ${JSON.stringify(file)}`);
    if (actual !== oid) changes.push(file);
  }
  if (sparseRuleCandidates.length) {
    const included = sparseCheckoutIncludes(repo, sparseRuleCandidates);
    for (const file of sparseRuleCandidates) {
      if (included.has(file)) changes.push(file);
    }
  }
  return changes;
}

function changedPaths(base, head, includeWorkingTree, repo) {
  const paths = new Set();
  const diffs = [['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, head]];
  if (includeWorkingTree) diffs.push(
    ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', '--cached', 'HEAD'],
    ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z'],
  );
  for (const args of diffs) {
    for (const file of pathsFrom(git(args, repo), args)) paths.add(file);
  }
  if (includeWorkingTree) {
    const untrackedArgs = ['ls-files', '--others', '--exclude-standard', '-z'];
    for (const file of pathsFrom(git(untrackedArgs, repo), untrackedArgs)) paths.add(file);
    for (const file of flaggedWorkingTreeChanges(repo)) paths.add(file);
  }
  return [...paths].sort();
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const allowed = readAllowPatterns(options);
    const repo = repositoryRoot();
    const base = commit(options.base, 'base', repo);
    const head = commit(options.head || 'HEAD', 'head', repo);
    const currentHead = options.head ? commit('HEAD', 'worktree HEAD', repo) : head;
    const includeWorkingTree = head === currentHead;
    if (!includeWorkingTree) console.log('Comparison: commits only (--head is not the current HEAD).');
    let outOfSet = 0;
    for (const file of changedPaths(base, head, includeWorkingTree, repo)) {
      const isAllowed = allowed.some(pattern => pattern.test(file));
      console.log(`${isAllowed ? 'ALLOWED' : 'OUT_OF_SET'} ${JSON.stringify(file)}`);
      if (!isAllowed) outOfSet += 1;
    }
    process.exitCode = outOfSet ? 1 : 0;
  } catch (error) {
    console.error(`error: ${error.message}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

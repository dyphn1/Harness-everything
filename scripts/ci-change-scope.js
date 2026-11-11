#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const ALLOWED_PREFIXES = [
  'docs/',
  'benchmarks/results/',
  '.agents/harness-everything/errors/',
];

function parsePaths(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes[bytes.length - 1] !== 0) return null;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const paths = text.slice(0, -1).split('\0');
  if (!paths.length || paths.some(file => !file || file.startsWith('/') || file.includes('\\') ||
    file.split('/').some(part => !part || part === '.' || part === '..'))) return null;
  return paths;
}

function isAllowed(file) {
  return file === 'CHANGELOG.md' || ALLOWED_PREFIXES.some(prefix => file.startsWith(prefix));
}

function classifyPaths(bytes) {
  const paths = parsePaths(bytes);
  return paths && paths.every(isAllowed) ? 'docs-only' : 'full';
}

function classifyChangeSet(eventName, baseSha, headSha, options = {}) {
  if (eventName !== 'pull_request' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseSha || '') ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(headSha || '')) return 'full';

  const cwd = options.cwd || process.cwd();
  const runGit = options.runGit || ((args, settings) => execFileSync('git', args, settings));
  try {
    const mergeBase = runGit(['merge-base', baseSha, headSha], { cwd, windowsHide: true }).toString('ascii').trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(mergeBase)) return 'full';
    // Disabling rename detection makes both endpoints part of the path set.
    const paths = runGit(['diff', '--no-renames', '--name-only', '-z', mergeBase, headSha], { cwd, windowsHide: true });
    return classifyPaths(paths);
  } catch {
    return 'full';
  }
}

if (require.main === module) {
  const [, , eventName, baseSha, headSha] = process.argv;
  process.stdout.write(`${classifyChangeSet(eventName, baseSha, headSha)}\n`);
}

module.exports = { classifyPaths, classifyChangeSet };

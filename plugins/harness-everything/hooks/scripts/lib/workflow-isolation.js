'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (result.status !== 0) throw new Error('cannot verify Git worktree isolation');
  return result.stdout.trim();
}

function canonical(value) {
  const resolved = path.resolve(value);
  // The JS resolver preserves Windows 8.3 spellings (RUNNER~1), while Git
  // reports the long directory name. Native resolution gives one identity.
  try { return fs.realpathSync.native(resolved); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    return path.join(canonical(parent), path.basename(resolved));
  }
}

function key(value) {
  const result = canonical(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function within(root, target) {
  const relative = path.relative(key(root), key(target));
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function linkedWorktree(cwd, boundRoot) {
  const common = canonical(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const gitDir = canonical(git(cwd, ['rev-parse', '--absolute-git-dir']));
  const boundCommon = canonical(git(boundRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const top = canonical(git(cwd, ['rev-parse', '--show-toplevel']));
  if (key(common) === key(gitDir) || key(common) !== key(boundCommon)) return null;
  const worktrees = git(boundRoot, ['worktree', 'list', '--porcelain', '-z']).split('\0');
  return worktrees.some(field => field.startsWith('worktree ') && key(field.slice(9)) === key(top)) ? top : null;
}

// A conservative read subset, not a general shell sandbox.
function classifyShell(command) {
  const text = String(command || '').trim();
  if (!text || /[;&|`\r\n<>$(){}\x00]/.test(text)) return 'mutation-or-unknown';
  if (/^git\s+worktree\s+add\s+/i.test(text) && !/\s--(?:force|checkout|detach)(?:\s|=|$)/i.test(text)) return 'worktree-setup';
  if (/\s(?:--(?:output|ext-diff|textconv|exec|pre|pre-glob|pager|open|batch|filters)|-[xoO])(?:\b|=)|\s-(?:exec|execdir|delete|fprint|fprintf)\b/i.test(text)) return 'mutation-or-unknown';
  if (/^git\s+(?:status|rev-parse|diff|log|show|ls-files|check-ignore)(?:\s|$)/i.test(text) ||
      /^git\s+branch\s+--show-current$/i.test(text) || /^git\s+worktree\s+list(?:\s|$)/i.test(text) ||
      /^(?:pwd|ls|dir|cat|type|head|tail|wc|stat|rg|Get-Location|Get-ChildItem|Get-Content|Select-String|Test-Path)(?:\s|$)/i.test(text)) return 'read-only';
  return 'mutation-or-unknown';
}

function inputOf(payload) { return payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? {}; }
function cwdOf(payload, root) {
  const input = inputOf(payload);
  return input.workdir || input.cwd || input.working_directory || input.workingDirectory ||
    payload.cwd || payload.working_directory || payload.workingDirectory || root;
}
function commandOf(payload) {
  const input = inputOf(payload);
  return String(input.command || input.script || input.cmd || '');
}
function mutationPaths(payload) {
  const input = inputOf(payload);
  if ((payload.tool_name || payload.tool) === 'apply_patch') {
    const patch = typeof input === 'string' ? input : input.patch || input.input || '';
    return [...String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)].map(match => match[1].trim());
  }
  return [input.file_path || input.filePath || input.path].filter(value => typeof value === 'string' && value.trim());
}
function assertTargets(payload, cwd, isolatedRoot) {
  const targets = mutationPaths(payload);
  if (!targets.length) throw new Error('mutation target is unknown; cannot verify worktree isolation');
  for (const target of targets) {
    const resolved = path.resolve(cwd, target);
    if (!within(isolatedRoot, resolved) || within(path.join(isolatedRoot, '.git'), resolved)) {
      throw new Error('mutation target escapes Git worktree isolation or modifies Git metadata');
    }
    let parent = path.dirname(resolved);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (key(git(parent, ['rev-parse', '--show-toplevel'])) !== key(isolatedRoot)) throw new Error('mutation target belongs to a different repository');
  }
}
function assertShellScope(command, cwd, isolatedRoot) {
  if (/(?:^|[;&|\r\n])\s*(?:cd|chdir|pushd|Set-Location|Push-Location)\b/i.test(command)) {
    throw new Error('use the shell tool working-directory field so isolation can be verified');
  }
  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s;&|<>]+/g) || [];
  for (const token of tokens.slice(1)) {
    const value = token.replace(/^["']|["']$/g, '').replace(/^[A-Za-z-]+=/, '');
    if ((path.isAbsolute(value) || /^\.\.[\\/]/.test(value)) && !within(isolatedRoot, path.resolve(cwd, value))) {
      throw new Error('explicit shell path escapes Git worktree isolation');
    }
  }
}

module.exports = { canonical, key, within, linkedWorktree, classifyShell, inputOf, cwdOf, commandOf, mutationPaths, assertTargets, assertShellScope };

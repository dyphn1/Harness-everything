'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

function gitRaw(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 5000,
    maxBuffer: options.maxBuffer ?? (16 * 1024 * 1024),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result.status !== 0) throw new Error('cannot verify Git worktree isolation');
  return result.stdout;
}

function git(cwd, args) {
  return gitRaw(cwd, args).trim();
}

function fingerprintLimitError(count, maxPaths) {
  const error = new Error('workspace fingerprint path limit exceeded');
  error.code = 'HARNESS_FINGERPRINT_LIMIT';
  error.count = count;
  error.maxPaths = maxPaths;
  return error;
}

function hashWorktreePaths(root, relatives) {
  const values = new Map();
  const batch = [];
  for (const relative of relatives) {
    const target = path.join(root, relative);
    let stat;
    try { stat = fs.lstatSync(target); }
    catch (error) {
      if (error.code === 'ENOENT') {
        values.set(relative, null);
        continue;
      }
      throw error;
    }
    if (stat.isDirectory()) {
      const result = spawnSync('git', ['-C', target, 'rev-parse', 'HEAD'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
      });
      values.set(relative, { mode: '160000', oid: result.status === 0 ? result.stdout.trim() : 'directory' });
      continue;
    }
    const mode = stat.isSymbolicLink() ? '120000' : ((stat.mode & 0o111) ? '100755' : '100644');
    // --stdin-paths is line-delimited. Rare pathnames containing a newline use
    // the legacy one-file call so the fingerprint remains exact.
    if (/[\r\n]/.test(relative)) {
      const one = spawnSync('git', ['hash-object', '--path=' + relative, '--', relative], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000,
      });
      if (one.status !== 0) throw new Error('cannot fingerprint workspace content');
      values.set(relative, { mode, oid: one.stdout.trim() });
      continue;
    }
    batch.push({ relative, mode });
  }

  if (batch.length > 0) {
    const hashed = spawnSync('git', ['hash-object', '--stdin-paths'], {
      cwd: root,
      input: batch.map(item => item.relative).join('\n') + '\n',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (hashed.status !== 0) throw new Error('cannot fingerprint workspace content');
    const oids = hashed.stdout.split(/\r?\n/).filter(Boolean);
    if (oids.length !== batch.length) throw new Error('cannot fingerprint workspace content');
    for (let i = 0; i < batch.length; i++) {
      values.set(batch[i].relative, { mode: batch[i].mode, oid: oids[i] });
    }
  }
  return values;
}

function workspaceFingerprint(cwd, options = {}) {
  const root = canonical(git(cwd, ['rev-parse', '--show-toplevel']));
  const entries = new Map();
  const largeGitRead = { timeout: 15000, maxBuffer: 64 * 1024 * 1024 };
  for (const record of gitRaw(root, ['ls-files', '-s', '-z'], largeGitRead).split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('cannot fingerprint workspace index');
    const meta = record.slice(0, tab).trim().split(/\s+/);
    const relative = record.slice(tab + 1);
    const mode = meta[0];
    const oid = meta[1];
    entries.set(relative, { relative, mode, oid });
  }

  const changed = gitRaw(root, ['diff-files', '--name-only', '-z'], largeGitRead).split('\0').filter(Boolean);
  const untracked = gitRaw(root, ['ls-files', '--others', '--exclude-standard', '-z'], largeGitRead).split('\0').filter(Boolean);
  const observedPaths = [...new Set([...changed, ...untracked])];
  const maxPaths = Number.isInteger(options.maxPaths) && options.maxPaths > 0 ? options.maxPaths : 5000;
  if (observedPaths.length > maxPaths) throw fingerprintLimitError(observedPaths.length, maxPaths);
  const worktreeValues = hashWorktreePaths(root, observedPaths);

  // Substitute current worktree content for tracked paths that differ from the
  // index. This keeps the fingerprint stable across git add / git commit when
  // visible workspace content did not change.
  for (const relative of changed) {
    const value = worktreeValues.get(relative);
    if (value) entries.set(relative, { relative, mode: value.mode, oid: value.oid });
    else entries.delete(relative);
  }

  for (const relative of untracked) {
    const value = worktreeValues.get(relative);
    if (value) entries.set(relative, { relative, mode: value.mode, oid: value.oid });
  }

  const digest = crypto.createHash('sha256');
  digest.update('harness-workspace-fingerprint-v1\0');
  for (const entry of [...entries.values()].sort((a, b) => a.relative.localeCompare(b.relative))) {
    digest.update(entry.relative); digest.update('\0');
    digest.update(entry.mode); digest.update('\0');
    digest.update(entry.oid); digest.update('\0');
  }
  return digest.digest('hex');
}

function shellProbeKey(payload, cwd) {
  const toolUseId = String(payload?.tool_use_id || payload?.toolUseId || '').trim();
  const tool = String(payload?.tool_name || payload?.tool || '');
  if (toolUseId) {
    // Host tool-use identity is stable across Pre/Post payload cwd drift.
    return crypto.createHash('sha256')
      .update('harness-shell-probe-v3\0')
      .update(toolUseId).update('\0')
      .update(tool)
      .digest('hex');
  }
  // Compatibility fallback for hosts that do not expose tool_use_id.
  const command = commandOf(payload);
  return crypto.createHash('sha256')
    .update('harness-shell-probe-v2-fallback\0')
    .update(tool).update('\0')
    .update(key(cwd)).update('\0')
    .update(command)
    .digest('hex');
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

// A conservative read subset, not a general shell sandbox. Top-level chaining
// (`;`, `&&`, `||`, `|`) and the `2>&1`/`1>&2` fd-duplication redirect
// are permitted only when every resulting segment independently matches the
// trusted read-only set below. The scanner is deliberately lexical rather than
// a raw regex split so quoted/escaped separator characters remain arguments.
// Unsupported shell syntax still fails closed.
const DANGEROUS_FLAG_RE = /\s(?:--(?:output|ext-diff|textconv|exec|pre|pre-glob|pager|open|batch|filters)|-[xoO])(?:\b|=)|\s-(?:exec|execdir|delete|fprint|fprintf)\b/i;
const READ_ONLY_PREFIX_RE = /^(?:git\s+(?:status|rev-parse|diff|log|show|ls-files|check-ignore)(?:\s|$)|git\s+branch\s+--show-current$|git\s+worktree\s+list(?:\s|$)|gh\s+(?:issue|pr)\s+(?:view|list)(?:\s|$)|gh\s+repo\s+view(?:\s|$)|gh\s+auth\s+status(?:\s|$)|(?:pwd|ls|dir|cat|type|head|tail|wc|stat|rg|grep|echo|Get-Location|Get-ChildItem|Get-Content|Select-String|Test-Path)(?:\s|$))/i;
const VERIFY_COMMAND_RE = /\b(test|spec|jest|vitest|mocha|pytest|rspec|phpunit|tsc|eslint|lint|build|compile|verify|check)\b/i;

function isVerificationShell(command) {
  return VERIFY_COMMAND_RE.test(String(command || ''));
}

function isReadOnlySegment(segment) {
  return READ_ONLY_PREFIX_RE.test(segment) && !DANGEROUS_FLAG_RE.test(segment);
}

function splitShellSegments(text) {
  const segments = [];
  let current = '';
  let quote = null;

  const push = () => {
    const segment = current.trim();
    if (!segment) return false;
    segments.push(segment);
    current = '';
    return true;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }

    if (quote === '"') {
      if (ch === '$' || ch === '`') return null;
      current += ch;
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\') {
        if (i + 1 >= text.length) return null;
        current += text[++i];
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= text.length) return null;
      current += ch + text[++i];
      continue;
    }

    if (ch === '$' || ch === '`' || ch === '(' || ch === ')' || ch === '{' || ch === '}' ||
        ch === '\r' || ch === '\n' || ch === '\x00') return null;

    // Only treat fd duplication as syntax at a token boundary. Quoted text such
    // as "2>&1" was handled above and remains literal argument content.
    if ((ch === '1' || ch === '2') && text[i + 1] === '>' && text[i + 2] === '&' &&
        (text[i + 3] === '1' || text[i + 3] === '2') &&
        (i === 0 || /\s/.test(text[i - 1])) &&
        (i + 4 === text.length || /[\s;|&]/.test(text[i + 4]))) {
      current += ' ';
      i += 3;
      continue;
    }

    if (ch === '>' || ch === '<') return null;

    if (ch === ';') {
      if (!push()) return null;
      continue;
    }

    if (ch === '|') {
      if (!push()) return null;
      if (text[i + 1] === '|') i++;
      continue;
    }

    if (ch === '&') {
      if (text[i + 1] !== '&' || !push()) return null;
      i++;
      continue;
    }

    current += ch;
  }

  if (quote || !push()) return null;
  return segments;
}

function classifyShell(command) {
  const text = String(command || '').trim();
  if (!text) return 'untrusted';
  const segments = splitShellSegments(text);
  if (!segments) return 'untrusted';
  if (segments.length === 1) {
    if (/^git\s+worktree\s+add\s+/i.test(segments[0]) && !/\s--(?:force|checkout|detach)(?:\s|=|$)/i.test(segments[0])) return 'worktree-setup';
    return isReadOnlySegment(segments[0]) ? 'read-only' : 'mutation-or-unknown';
  }
  return segments.every(isReadOnlySegment) ? 'read-only' : 'mutation-or-unknown';
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

// Bound workspace root plus its linked worktrees. Git failures (e.g. a
// non-git workspace) degrade to the root alone instead of throwing, so
// Tier-2 accounting never blocks on this enumeration (#165; cf. #162).
function worktreeRoots(root) {
  const roots = [root];
  try {
    for (const field of git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0')) {
      if (field.startsWith('worktree ')) {
        const candidate = field.slice('worktree '.length).trim();
        if (candidate) roots.push(candidate);
      }
    }
  } catch (_) { /* root alone */ }
  return roots;
}

// Direct-tool (Edit/Write/apply_patch) targets count against the Tier-2
// budget only when at least one target lies inside the workspace (#165).
// Unknown targets (no parseable path) stay conservative and count.
function directMutationInWorkspace(payload, cwd, root) {
  const targets = mutationPaths(payload);
  if (!targets.length) return true;
  const roots = worktreeRoots(root);
  return targets.some(target => {
    const resolved = path.resolve(cwd, target);
    return roots.some(candidate => within(candidate, resolved));
  });
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

module.exports = { canonical, key, within, linkedWorktree, classifyShell, isVerificationShell, workspaceFingerprint, shellProbeKey, inputOf, cwdOf, commandOf, mutationPaths, worktreeRoots, directMutationInWorkspace, assertTargets, assertShellScope };

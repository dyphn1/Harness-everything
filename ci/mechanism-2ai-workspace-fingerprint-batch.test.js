#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const isolation = require(path.join(ROOT, 'hooks/scripts/lib/workflow-isolation'));
const pluginIsolation = require(path.join(ROOT, 'plugins/harness-everything/hooks/scripts/lib/workflow-isolation'));
const state = require(path.join(ROOT, 'hooks/scripts/lib/harness-state'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-workspace-fingerprint-'));
const repo = path.join(temp, 'repo');
fs.mkdirSync(repo);
const env = {
  ...process.env,
  HARNESS_STATE_HOME: path.join(temp, 'state'),
  HARNESS_WORKSPACE_ROOT: repo,
};
process.env.HARNESS_STATE_HOME = env.HARNESS_STATE_HOME;
process.env.HARNESS_WORKSPACE_ROOT = env.HARNESS_WORKSPACE_ROOT;

let passed = 0;
function check(value, message) {
  assert.ok(value, message);
  passed++;
  console.log('PASS ' + message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repo,
    env,
    input: options.input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function git(args) {
  return run('git', args);
}

function node(script, payload, args = []) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: repo,
    env,
    input: payload === undefined ? undefined : JSON.stringify(payload),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitRaw(args) {
  return run('git', args);
}

function legacyHashWorktreePath(root, relative) {
  const target = path.join(root, relative);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isDirectory()) {
    const result = spawnSync('git', ['-C', target, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return { mode: '160000', oid: result.status === 0 ? result.stdout.trim() : 'directory' };
  }
  const mode = stat.isSymbolicLink() ? '120000' : ((stat.mode & 0o111) ? '100755' : '100644');
  const result = spawnSync('git', ['hash-object', '--path=' + relative, '--', relative], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('legacy fingerprint failed for ' + relative);
  return { mode, oid: result.stdout.trim() };
}

function legacyFingerprint(cwd) {
  const root = isolation.canonical(gitRaw(['rev-parse', '--show-toplevel']).trim());
  const entries = new Map();
  for (const record of gitRaw(['ls-files', '-s', '-z']).split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    assert.ok(tab >= 0, 'legacy index record has a tab');
    const meta = record.slice(0, tab).trim().split(/\s+/);
    const relative = record.slice(tab + 1);
    entries.set(relative, { relative, mode: meta[0], oid: meta[1] });
  }
  for (const relative of gitRaw(['diff-files', '--name-only', '-z']).split('\0').filter(Boolean)) {
    const value = legacyHashWorktreePath(root, relative);
    if (value) entries.set(relative, { relative, mode: value.mode, oid: value.oid });
    else entries.delete(relative);
  }
  for (const relative of gitRaw(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    const value = legacyHashWorktreePath(root, relative);
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

try {
  git(['init']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked\n');
  fs.writeFileSync(path.join(repo, 'delete-me.txt'), 'delete me\n');
  git(['add', '.']);
  git(['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', 'commit', '-m', 'fixture']);

  const cleanLegacy = legacyFingerprint(repo);
  check(isolation.workspaceFingerprint(repo) === cleanLegacy,
    '#169 batched fingerprint matches the legacy clean-worktree fingerprint');
  check(pluginIsolation.workspaceFingerprint(repo) === cleanLegacy,
    '#169 packaged plugin fingerprint matches canonical/legacy on a clean worktree');

  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked changed\n');
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'untracked\n');
  const dirtyLegacy = legacyFingerprint(repo);
  const dirtyBatched = isolation.workspaceFingerprint(repo);
  check(dirtyBatched === dirtyLegacy,
    '#169 batched fingerprint matches legacy for dirty tracked + untracked content');
  check(pluginIsolation.workspaceFingerprint(repo) === dirtyLegacy,
    '#169 packaged plugin batched fingerprint matches legacy dirty semantics');

  git(['add', 'tracked.txt', 'untracked.txt']);
  check(isolation.workspaceFingerprint(repo) === dirtyBatched,
    '#169 staging visible content does not change the workspace fingerprint');

  fs.unlinkSync(path.join(repo, 'delete-me.txt'));
  check(isolation.workspaceFingerprint(repo) === legacyFingerprint(repo),
    '#169 tracked deletion keeps legacy fingerprint semantics');

  git(['reset', '--hard', 'HEAD']);
  git(['clean', '-fdx']);
  const bulk = path.join(repo, 'bulk');
  fs.mkdirSync(bulk);
  for (let i = 0; i < 1000; i++) {
    fs.writeFileSync(path.join(bulk, 'file-' + String(i).padStart(4, '0') + '.txt'), 'x\n');
  }

  const startedAt = process.hrtime.bigint();
  const bulkFingerprint = isolation.workspaceFingerprint(repo);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  check(/^[a-f0-9]{64}$/.test(bulkFingerprint),
    '#169 1000-untracked-file fingerprint returns a valid digest');
  check(elapsedMs < 5000,
    '#169 1000-untracked-file fingerprint stays below 5s regression ceiling (actual ' + elapsedMs.toFixed(1) + 'ms)');
  check(pluginIsolation.workspaceFingerprint(repo) === bulkFingerprint,
    '#169 packaged plugin fingerprint remains byte-identical for 1000 untracked files');

  let limitError = null;
  try {
    isolation.workspaceFingerprint(repo, { maxPaths: 10 });
  } catch (error) {
    limitError = error;
  }
  check(limitError?.code === 'HARNESS_FINGERPRINT_LIMIT' &&
    limitError.count === 1000 &&
    limitError.maxPaths === 10,
    '#169 explicit fingerprint cap reports a structured conservative-fallback signal');

  for (let i = 1000; i < 5101; i++) {
    fs.writeFileSync(path.join(bulk, 'file-' + String(i).padStart(4, '0') + '.txt'), 'x\n');
  }
  const sessionId = 'workspace-fingerprint-limit';
  const payload = { session_id: sessionId, cwd: repo };
  const routed = node('harness-everything/scripts/kernel-router.js', {
    ...payload,
    prompt: 'Fix this checkout bug with a regression test',
  });
  check(routed.status === 0, '#169 large-workspace Tier-2 fixture routes normally');
  const started = node('hooks/scripts/workflow-disposition.js', undefined, ['start', '--session-id', sessionId]);
  check(started.status === 0, '#169 large-workspace Tier-2 fixture starts normally');

  const admitted = node('hooks/scripts/workflow-gate.js', {
    ...payload,
    tool_name: 'Bash',
    tool_use_id: 'toolu_fingerprint_limit',
    tool_input: { command: 'node large-fingerprint.js' },
  });
  check(admitted.status === 0,
    '#169 >5000 observed paths degrade conservatively instead of blocking the shell call');
  const workflowFile = path.join(state.getSessionDir(repo, sessionId), 'workflow-run.json');
  const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
  check(workflow.state === 'running' &&
    !workflow.budget?.counters &&
    !fs.existsSync(path.join(state.getSessionDir(repo, sessionId), 'mutation-probes')),
    '#190 shell admission no longer creates conservative budget/probe state');

  console.log('PASS: batched workspace fingerprint (' + passed + ' assertions, 1000-file ' + elapsedMs.toFixed(1) + 'ms)');
} finally {
  if (!temp.startsWith(path.join(os.tmpdir(), 'harness-workspace-fingerprint-'))) {
    throw new Error('unsafe fixture cleanup');
  }
  fs.rmSync(temp, { recursive: true, force: true });
}

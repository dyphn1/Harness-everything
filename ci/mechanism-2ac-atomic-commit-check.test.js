#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const canonical = path.join(ROOT, 'hooks', 'scripts', 'atomic-commit-check.js');
const plugin = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'atomic-commit-check.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-atomic-commit-'));
const repo = path.join(temp, 'repo');
const outside = path.join(temp, 'outside');
const stateHome = path.join(temp, 'state');

function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function invoke({ session, tool = 'Edit', target, patch }) {
  const toolInput = tool === 'apply_patch'
    ? { patch }
    : { file_path: target };
  const payload = {
    session_id: session,
    hook_event_name: 'PostToolUse',
    tool_name: tool,
    tool_input: toolInput,
    cwd: repo,
  };
  return spawnSync(process.execPath, [canonical], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
  });
}

function sixInvocations(args) {
  const results = [];
  for (let i = 0; i < 6; i++) results.push(invoke(args));
  return results;
}

try {
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  git(['init']);
  git(['config', 'user.email', 'harness@example.invalid']);
  git(['config', 'user.name', 'Harness Test']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base\n', 'utf8');
  git(['add', 'tracked.txt']);
  git(['commit', '-m', 'initial']);

  assert.strictEqual(
    fs.readFileSync(canonical, 'utf8'),
    fs.readFileSync(plugin, 'utf8'),
    'canonical and packaged atomic-commit hooks must remain byte-identical',
  );

  // Negative control for #90: keep the repository dirty with a pre-existing,
  // unrelated file. Six host edits outside the workspace must still never
  // increment the repository edit counter or emit a commit nudge.
  fs.writeFileSync(path.join(repo, 'pre-existing-unrelated.txt'), 'unrelated\n', 'utf8');
  const outsideTarget = path.join(outside, 'scratch.txt');
  const outsideResults = sixInvocations({ session: 'outside-edit', target: outsideTarget });
  assert.ok(outsideResults.every(result => result.status === 0), 'outside-workspace Edit calls must never nudge even when the repo is already dirty');
  assert.ok(outsideResults.every(result => !String(result.stderr || '').includes('Atomic Commit Check')), 'outside-workspace Edit calls must stay silent');

  const outsidePatchResults = sixInvocations({
    session: 'outside-patch',
    tool: 'apply_patch',
    patch: `*** Begin Patch\n*** Update File: ${outsideTarget}\n@@\n-old\n+new\n*** End Patch`,
  });
  assert.ok(outsidePatchResults.every(result => result.status === 0), 'outside-workspace apply_patch headers must not increment the count');
  fs.rmSync(path.join(repo, 'pre-existing-unrelated.txt'));

  // A clean worktree is never a valid reason to request a commit. The sixth
  // in-workspace event therefore stays non-blocking and resets the stale count.
  const cleanResults = sixInvocations({ session: 'clean-tree', target: path.join(repo, 'tracked.txt') });
  assert.ok(cleanResults.every(result => result.status === 0), 'clean worktree must not nudge at the threshold');
  assert.ok(cleanResults.every(result => !String(result.stderr || '').includes('Atomic Commit Check')), 'clean worktree must not print a commit reminder');

  // Real in-workspace edits with Git-visible changes still preserve the nudge.
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n', 'utf8');
  const dirtyResults = sixInvocations({ session: 'dirty-tree', target: path.join(repo, 'tracked.txt') });
  assert.ok(dirtyResults.slice(0, 5).every(result => result.status === 0), 'first five in-workspace edits remain non-blocking');
  assert.strictEqual(dirtyResults[5].status, 2, 'sixth in-workspace edit with uncommitted changes nudges');
  assert.match(String(dirtyResults[5].stderr || ''), /6 edits since the last commit/, 'nudge wording is tool-neutral');
  assert.doesNotMatch(String(dirtyResults[5].stderr || ''), /apply_patch calls/, 'nudge no longer claims all edits are apply_patch calls');

  // apply_patch paths inside the repository count too.
  const patchResults = sixInvocations({
    session: 'inside-patch',
    tool: 'apply_patch',
    patch: '*** Begin Patch\n*** Update File: tracked.txt\n@@\n-old\n+new\n*** End Patch',
  });
  assert.strictEqual(patchResults[5].status, 2, 'in-workspace apply_patch header participates in the threshold');

  // Moving HEAD resets the counter for the same session.
  git(['add', 'tracked.txt']);
  git(['commit', '-m', 'save change']);
  const afterCommit = invoke({ session: 'dirty-tree', target: path.join(repo, 'tracked.txt') });
  assert.strictEqual(afterCommit.status, 0, 'counter resets after a commit moves HEAD');

  console.log('PASS: atomic commit check scopes edits to the workspace and suppresses clean-tree false nudges');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

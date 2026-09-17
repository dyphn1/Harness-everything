#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'hooks', 'scripts', 'workflow-gate.js');
let failed = 0;

function check(condition, message) {
  if (condition) console.log(`✅ worktree-isolation: ${message}`);
  else { console.error(`❌ worktree-isolation: ${message}`); failed++; }
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-isolation-'));
const home = path.join(temp, 'home');
const repo = path.join(temp, 'repo');
const linked = path.join(temp, 'repo-linked');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(repo, { recursive: true });

const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  HARNESS_STATE_HOME: path.join(home, '.agents', 'harness-everything'),
  CLAUDE: '1',
};
process.env.HARNESS_STATE_HOME = env.HARNESS_STATE_HOME;
process.env.HOME = home;
process.env.USERPROFILE = home;

try {
  check(git(repo, ['init']).status === 0, 'fixture git repository initializes');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
  check(git(repo, ['add', 'README.md']).status === 0, 'fixture file stages');
  check(git(repo, ['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', 'commit', '-m', 'fixture']).status === 0, 'fixture baseline commits');

  const workspace = require(path.join(ROOT, 'scripts', 'lib', 'workspace'));
  const state = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'harness-state'));
  const sessionId = 'worktree-isolation-test';
  const context = { session_id: sessionId, host_id: 'mechanism-test', cwd: repo };
  workspace.bindWorkspaceSession(sessionId, repo, context, true);
  const sessionDir = state.getSessionDir(repo, sessionId, context);
  const workflowFile = path.join(sessionDir, 'workflow-run.json');

  function writeWorkflow(tier, strategy) {
    fs.writeFileSync(workflowFile, `${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      sessionId,
      tier,
      strategy,
      state: 'active',
      // Escape suppresses the Fable-entry check so this suite isolates the
      // independent worktree safety invariant.
      disposition: { status: 'escaped' },
    }, null, 2)}\n`, 'utf8');
  }

  function runGate(tool, cwd, input = {}) {
    const payload = {
      session_id: sessionId,
      host_id: 'mechanism-test',
      cwd,
      tool_name: tool,
      tool_input: input,
    };
    return spawnSync(process.execPath, [GATE], {
      cwd: ROOT,
      env,
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
  }

  writeWorkflow('tier3', 'fable-staged');

  const primaryWrite = runGate('Write', repo, { file_path: path.join(repo, 'src.js'), content: 'x' });
  check(primaryWrite.status === 2, 'Tier 3 direct write is blocked in the primary working tree');
  check(/worktree isolation/i.test(primaryWrite.stderr), 'blocked write explains the isolation requirement');

  const primaryDelete = runGate('Bash', repo, { command: 'rm -rf src' });
  check(primaryDelete.status === 2, 'Tier 3 destructive shell mutation is blocked in the primary working tree');

  const chainedBypass = runGate('Bash', repo, { command: 'git status --short && rm -rf src' });
  check(chainedBypass.status === 2, 'read-only prefix cannot hide a chained mutation');

  const readOnly = runGate('Bash', repo, { command: 'git status --short' });
  check(readOnly.status === 0, 'read-only discovery remains allowed before isolation');

  const setup = runGate('Bash', repo, { command: `git worktree add "${linked}" -b harness-isolation-test` });
  check(setup.status === 0, 'git worktree creation is allowed as the isolation transition');

  const createLinked = git(repo, ['worktree', 'add', linked, '-b', 'harness-isolation-test']);
  check(createLinked.status === 0, 'fixture linked worktree is created');

  const isolatedWrite = runGate('Write', linked, { file_path: path.join(linked, 'src.js'), content: 'x' });
  check(isolatedWrite.status === 0, 'Tier 3 mutation is allowed after entering a linked worktree');

  writeWorkflow('tier2', 'iterative-single');
  const tier2Write = runGate('Write', repo, { file_path: path.join(repo, 'small.js'), content: 'x' });
  check(tier2Write.status === 0, 'Tier 2 is not globally forced into worktree isolation');
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

if (failed > 0) {
  console.error(`FAIL: worktree isolation gate (${failed} failure${failed === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('PASS: major-workflow worktree isolation gate');

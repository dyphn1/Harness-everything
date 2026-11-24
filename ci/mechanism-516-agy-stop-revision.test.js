'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGED_SCRIPTS = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-516-agy-stop-'));
const STATE_HOME = path.join(TEMP_ROOT, 'state-home');
const NO_GIT_PATH = path.join(TEMP_ROOT, 'no-git');
const originalStateHome = process.env.HARNESS_STATE_HOME;
fs.mkdirSync(STATE_HOME, { recursive: true });
fs.mkdirSync(NO_GIT_PATH, { recursive: true });
process.env.HARNESS_STATE_HOME = STATE_HOME;

const { getSessionDir } = require(path.join(PACKAGED_SCRIPTS, 'lib', 'harness-state'));
const realpath = fs.realpathSync.native || fs.realpathSync;

function run(script, payload, args = [], extraEnv = {}) {
  const childEnv = { ...process.env, HARNESS_STATE_HOME: STATE_HOME, ...extraEnv };
  delete childEnv.HARNESS_REQUIRE_VERIFICATION;
  delete childEnv.HARNESS_DOC_RECONCILIATION_PILOT;
  delete childEnv.HARNESS_WORKSPACE_ROOT;
  const result = spawnSync(process.execPath, [path.join(PACKAGED_SCRIPTS, script), ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: childEnv,
    timeout: 20000
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `${script} failed: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function makeWorkspace(name, withGit = true) {
  const root = path.join(TEMP_ROOT, name);
  fs.mkdirSync(root, { recursive: true });
  if (withGit) {
    git(root, ['init']);
    git(root, ['config', 'user.name', 'Harness test']);
    git(root, ['config', 'user.email', 'harness@example.test']);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'baseline\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '-m', 'test baseline']);
  }
  return realpath(root);
}

function postTool(root, sessionId, toolCall, fields = {}) {
  return run('agy-post-tool.js', {
    conversationId: sessionId,
    workspacePaths: [root],
    toolCall,
    ...fields
  });
}

function writeFile(root, sessionId, target, content) {
  fs.writeFileSync(target, content, 'utf8');
  postTool(root, sessionId, { name: 'write_file', args: { Path: target, Content: content } });
}

function handoffPath(root, sessionId) {
  return path.join(getSessionDir(root, sessionId), 'handoff-state.json');
}

function readHandoff(root, sessionId) {
  return JSON.parse(fs.readFileSync(handoffPath(root, sessionId), 'utf8'));
}

function runUnknownCommand(root, sessionId, command = 'harness_unrecognized_command') {
  const before = readHandoff(root, sessionId).lastEditAt || 0;
  while (Date.now() <= before) {}
  postTool(root, sessionId, {
    name: 'run_command',
    args: { CommandLine: command, Cwd: root }
  });
  const after = readHandoff(root, sessionId).lastEditAt || 0;
  assert.ok(after > before, 'unrecognized run_command must preserve the existing AGY shell edit signal');
  return after;
}

function stop(root, sessionId, extraEnv = {}) {
  return run('agy-stop.js', {
    conversationId: sessionId,
    workspacePaths: [root],
    terminationReason: 'NO_TOOL_CALL'
  }, [], extraEnv);
}

function expectAllow(root, sessionId, message, extraEnv = {}) {
  assert.deepStrictEqual(stop(root, sessionId, extraEnv), { decision: 'allow' }, message);
}

try {
  const repo = makeWorkspace('git-workspace');
  const session = 'p516-main';
  const tracked = path.join(repo, 'tracked.txt');
  assert.strictEqual(git(repo, ['status', '--porcelain']), '', 'the Git fixture starts clean');

  // A direct in-workspace edit earns one continuation; shell timestamp churn
  // during the same unresolved revision must not earn another.
  writeFile(repo, session, tracked, 'direct edit\n');
  assert.notStrictEqual(git(repo, ['status', '--porcelain']), '', 'the direct edit makes the Git fixture dirty');
  assert.strictEqual(stop(repo, session).decision, 'continue', 'the first unresolved edit gets one continuation');
  for (let i = 0; i < 3; i++) {
    runUnknownCommand(repo, session);
    expectAllow(repo, session, `shell timestamp churn ${i + 1} must not spend a second continuation`);
  }

  // A reason change from missing verification to a tool failure stays within
  // the same revision and uses the already-spent continuation.
  postTool(repo, session, {
    name: 'run_command',
    args: { CommandLine: 'harness_unrecognized_failure', Cwd: repo }
  }, { error: 'command failed' });
  expectAllow(repo, session, 'a failure reason transition in the same revision must not rearm the allowance');

  // A proven verification resolves the episode. A later failure in the same
  // content revision starts a fresh unresolved episode and gets one allowance.
  postTool(repo, session, {
    name: 'run_command',
    args: { CommandLine: 'npm test', Cwd: repo }
  }, { toolResponse: { exitCode: 0 } });
  expectAllow(repo, session, 'proven verification resolves the prior episode');
  postTool(repo, session, {
    name: 'run_command',
    args: { CommandLine: 'npm test', Cwd: repo }
  }, { error: 'new failure after resolution' });
  assert.strictEqual(stop(repo, session).decision, 'continue', 'a new unresolved episode after verification gets one continuation');
  expectAllow(repo, session, 'the new episode is still bounded to one continuation');

  // A real tracked-content edit made by a shell reopens one continuation even
  // though state-persist also changes lastEditAt for the unrecognized command.
  fs.writeFileSync(tracked, 'shell changed tracked bytes\n');
  runUnknownCommand(repo, session);
  assert.strictEqual(stop(repo, session).decision, 'continue', 'new tracked bytes rearm one continuation');
  expectAllow(repo, session, 'the tracked-content revision is bounded to one continuation');

  // Non-ignored untracked bytes are part of the same content identity. Staging
  // and committing those exact bytes must not rearm the allowance.
  const untracked = path.join(repo, 'shell-generated.txt');
  fs.writeFileSync(untracked, 'untracked shell bytes\n');
  runUnknownCommand(repo, session);
  assert.strictEqual(stop(repo, session).decision, 'continue', 'new non-ignored untracked bytes rearm one continuation');
  git(repo, ['add', 'tracked.txt', 'shell-generated.txt']);
  git(repo, ['commit', '-m', 'record shell output']);
  assert.strictEqual(git(repo, ['status', '--porcelain']), '', 'the Git fixture returns to clean after commit');
  runUnknownCommand(repo, session, 'git add tracked.txt && git commit -m record');
  expectAllow(repo, session, 'staging or committing the same bytes must not rearm the allowance');

  // A missed content probe during a reason transition must preserve the last
  // known digest so a real edit without a direct-write event still rearms once.
  const probeMiss = makeWorkspace('probe-miss-workspace');
  const probeMissSession = 'p516-probe-miss';
  const probeMissTracked = path.join(probeMiss, 'tracked.txt');
  writeFile(probeMiss, probeMissSession, probeMissTracked, 'direct edit\n');
  assert.strictEqual(stop(probeMiss, probeMissSession).decision, 'continue', 'the probe-miss fixture spends its first allowance with a valid digest');
  postTool(probeMiss, probeMissSession, {
    name: 'run_command',
    args: { CommandLine: 'harness_unrecognized_failure', Cwd: probeMiss }
  }, { error: 'reason transition during probe miss' });
  expectAllow(probeMiss, probeMissSession, 'a reason transition during a missed Git probe stays within the spent allowance', { PATH: NO_GIT_PATH });
  fs.writeFileSync(probeMissTracked, 'new bytes without direct-write event\n');
  assert.strictEqual(stop(probeMiss, probeMissSession).decision, 'continue', 'recovered Git detects changed bytes after the probe miss and rearms exactly once');
  expectAllow(probeMiss, probeMissSession, 'the recovered content revision is still bounded to one continuation');

  // The same reason transition on unchanged bytes remains allowed after Git returns.
  const unchangedProbe = makeWorkspace('unchanged-probe-workspace');
  const unchangedSession = 'p516-unchanged-probe';
  writeFile(unchangedProbe, unchangedSession, path.join(unchangedProbe, 'tracked.txt'), 'direct edit\n');
  assert.strictEqual(stop(unchangedProbe, unchangedSession).decision, 'continue', 'the unchanged-byte control spends one allowance with a valid digest');
  postTool(unchangedProbe, unchangedSession, {
    name: 'run_command',
    args: { CommandLine: 'harness_unrecognized_failure', Cwd: unchangedProbe }
  }, { error: 'same reason transition during probe miss' });
  expectAllow(unchangedProbe, unchangedSession, 'the unchanged-byte reason transition is allowed while Git is unavailable', { PATH: NO_GIT_PATH });
  expectAllow(unchangedProbe, unchangedSession, 'unchanged bytes remain allowed after Git returns');
  expectAllow(unchangedProbe, unchangedSession, 'unchanged bytes do not gain verification credit or a new allowance');

  // Non-Git workspaces fall back to the stable direct revision/session budget.
  const plain = makeWorkspace('non-git-workspace', false);
  const plainSession = 'p516-non-git';
  writeFile(plain, plainSession, path.join(plain, 'edited.txt'), 'edit\n');
  assert.strictEqual(stop(plain, plainSession).decision, 'continue', 'non-Git pending edit gets one continuation');
  for (let i = 0; i < 2; i++) {
    runUnknownCommand(plain, plainSession);
    expectAllow(plain, plainSession, 'a failed workspace fingerprint probe must still be bounded');
  }

  // If the marker cannot be written safely, Stop must fail open rather than
  // return continue without a durable cap.
  const markerRoot = makeWorkspace('marker-failure-workspace', false);
  const markerSession = 'p516-marker-failure';
  writeFile(markerRoot, markerSession, path.join(markerRoot, 'edited.txt'), 'edit\n');
  const stopStatePath = path.join(getSessionDir(markerRoot, markerSession), 'agy-stop-state.json');
  fs.mkdirSync(stopStatePath);
  expectAllow(markerRoot, markerSession, 'a marker write failure must allow stop');

  console.log('AGY Stop revision allowance verified through packaged hooks.');
} finally {
  if (originalStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = originalStateHome;
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
}

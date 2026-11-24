'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createV2Driver } = require('./lib/opencode-v2-driver');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const LEDGER = path.join(ROOT, '.agents', 'harness-everything', 'errors');
const ERRORS_SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const COMMITLINT = fs.readFileSync(path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'), 'utf8');
const OLD_ENV = Object.fromEntries(['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_TELEMETRY', 'HARNESS_SYSTEM_ONE_MODE']
  .map(key => [key, process.env[key]]));
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-394-opencode-ledger-')));

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function addLedger(workspace) {
  const target = path.join(workspace, '.agents', 'harness-everything', 'errors');
  fs.cpSync(LEDGER, target, { recursive: true });
  const generated = spawnSync(process.execPath, [ERRORS_SYNC, '--root', workspace], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
}

function packagePlugin() {
  const installed = path.join(TMP, 'opencode-install');
  const pluginDir = path.join(installed, 'plugins');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(PLUGIN, path.join(pluginDir, 'harness-enforcement.mjs'));
  for (const relative of [
    'harness-everything/scripts/kernel-router.js',
    'hooks/scripts/lib/observations.js',
    'hooks/scripts/lib/ledger-match.js',
    'hooks/scripts/lib/harness-state.js',
    'scripts/lib/workspace.js',
  ]) {
    const destination = path.join(installed, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relative), destination);
  }
  fs.cpSync(path.join(ROOT, 'hooks/scripts/lib/platforms'), path.join(installed, 'hooks/scripts/lib/platforms'), { recursive: true });
  return path.join(pluginDir, 'harness-enforcement.mjs');
}

async function toolCall(driver, sessionID, id, status = 'completed', output = 'ok', exit = 0,
  command = 'git commit -m "docs(errors): Bad Case"') {
  const before = { tool: 'bash', sessionID, agent: 'build', messageID: `message-${id}`, id, input: { command } };
  const beforeSnapshot = structuredClone(before);
  assert.equal(await driver.toolHook('execute.before')(before), undefined);
  assert.deepEqual(before, beforeSnapshot, 'execute.before does not change the tool request');

  const after = {
    ...before,
    status,
    ...(status === 'error'
      ? { error: { name: 'ToolError', message: output } }
      : { result: { output, metadata: exit === null ? {} : { exit } } }),
  };
  const afterSnapshot = structuredClone(after);
  assert.equal(await driver.toolHook('execute.after')(after), undefined);
  assert.deepEqual(after, afterSnapshot, 'execute.after does not change the host tool result');
}

async function context(driver, sessionID, base = 'base system') {
  const event = { sessionID, kind: 'primary', system: [{ type: 'text', text: base }] };
  await driver.sessionHook('context')(event);
  return event.system.map(part => part.text || '').join('\n');
}

test.after(() => {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('OpenCode V2 carries real ledger matches through the source and packaged context hooks', async () => {
  assert.ok(isOutside(ROOT, TMP), 'fixture state must stay outside the repository');
  const workspace = path.join(TMP, 'workspace');
  const otherWorkspace = path.join(TMP, 'other-workspace');
  const emptyWorkspace = path.join(TMP, 'empty-workspace');
  const sharedStateHome = path.join(TMP, 'harness-state');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(otherWorkspace, { recursive: true });
  fs.mkdirSync(emptyWorkspace, { recursive: true });
  addLedger(workspace);
  addLedger(otherWorkspace);
  process.env.HARNESS_TELEMETRY = 'off';
  delete process.env.HARNESS_SYSTEM_ONE_MODE;

  const sessionWorkspaces = {
    same: workspace,
    other: workspace,
    separateWorkspace: otherWorkspace,
    shellAction: workspace,
    shellFailure: workspace,
    noLedger: emptyWorkspace,
    masked: workspace,
    unknownExit: workspace,
    disposal: workspace,
    sessionCleanup: workspace,
  };
  const sessionLookup = async ({ sessionID }) => ({ id: sessionID, location: { directory: sessionWorkspaces[sessionID] } });
  const driver = await createV2Driver({ workspace, sessionLookup });
  process.env.HARNESS_STATE_HOME = sharedStateHome;
  const command = 'git -C x commit -m "docs(errors): Bad Case"';
  try {
    assert.ok(driver.toolHooks.has('execute.before') && driver.toolHooks.has('execute.after'));
    assert.ok(driver.sessionHooks.has('context'));
    assert.equal(driver.toolHooks.size, 2, 'the carrier registers no permission hook or additional tool gate');

    const before = { tool: 'bash', sessionID: 'same', agent: 'build', messageID: 'message-same', id: 'same-action', input: { command } };
    const beforeSnapshot = structuredClone(before);
    assert.equal(await driver.toolHook('execute.before')(before), undefined);
    assert.deepEqual(before, beforeSnapshot);

    const failure = {
      ...before,
      status: 'error',
      error: { name: 'ToolError', message: COMMITLINT },
    };
    const failureSnapshot = structuredClone(failure);
    assert.equal(await driver.toolHook('execute.after')(failure), undefined);
    assert.deepEqual(failure, failureSnapshot, 'the failed shell result remains untouched');

    const wrongSessionSystem = [{ type: 'text', text: 'base system' }];
    await driver.sessionHook('context')({ sessionID: 'other', kind: 'primary', system: wrongSessionSystem });
    assert.deepEqual(wrongSessionSystem, [{ type: 'text', text: 'base system' }], 'a pending lesson stays bound to its session');

    const delivered = await context(driver, 'same');
    assert.equal((delivered.match(/Cue:\n/g) || []).length, 2,
      'action selection runs in execute.before and failure selection in execute.after; both arrive at the next model request');
    assert.match(delivered, /subject-case/);
    assert.equal(await context(driver, 'same'), 'base system', 'a delivered phase is not replayed on another context build');

    await toolCall(driver, 'other', 'other-action', 'completed', COMMITLINT, 0);
    assert.equal((await context(driver, 'other')).match(/Cue:\n/g)?.length, 1,
      'a direct command with diagnostic-looking output and zero exit remains action-only');

    await toolCall(driver, 'masked', 'masked-action', 'completed', COMMITLINT, 0,
      'git commit -m "Bad Subject"; echo "$?"');
    assert.equal((await context(driver, 'masked')).match(/Cue:\n/g)?.length, 2,
      'a precise commitlint diagnostic recovers a commit failure masked by a compound shell exit');

    await toolCall(driver, 'unknownExit', 'unknown-exit-action', 'completed', COMMITLINT, null,
      'git commit -m "Bad Subject"; echo "$?"');
    assert.equal((await context(driver, 'unknownExit')).match(/Cue:\n/g)?.length, 1,
      'a completed compound command without metadata.exit remains action-only');

    await toolCall(driver, 'separateWorkspace', 'workspace-action', 'completed', COMMITLINT, 1);
    assert.equal((await context(driver, 'separateWorkspace')).match(/Cue:\n/g)?.length, 2,
      'a completed tool result with nonzero metadata.exit and captured diagnostics selects failure too');

    // Live OpenCode 2.1.4 shape (E-0006/E-0008): tool "shell", input carries workdir,
    // after-result carries metadata.exit and commitlint output.
    const shellCommand = 'git -C x commit -m "docs(errors): Bad Case"';
    const shellBase = { tool: 'shell', agent: 'build', messageID: 'message-shell', input: { command: shellCommand, workdir: workspace } };

    const shellActionEvent = { ...shellBase, sessionID: 'shellAction', id: 'shell-action' };
    const shellActionSnapshot = structuredClone(shellActionEvent);
    assert.equal(await driver.toolHook('execute.before')(shellActionEvent), undefined);
    assert.deepEqual(shellActionEvent, shellActionSnapshot, 'execute.before does not change a live shell tool request');
    assert.equal((await context(driver, 'shellAction')).match(/Cue:\n/g)?.length, 1,
      'a live shell action event delivers the action lesson');

    const shellFailureBefore = { ...shellBase, sessionID: 'shellFailure', id: 'shell-failure-before' };
    assert.equal(await driver.toolHook('execute.before')(shellFailureBefore), undefined);
    const shellFailureAfter = {
      ...shellFailureBefore,
      id: 'shell-failure-after',
      status: 'completed',
      result: {
        output: { exit: 1, truncated: false, output: COMMITLINT, status: 'completed' },
        content: [{ type: 'text', text: COMMITLINT }],
        metadata: { status: 'completed', truncated: false, exit: 1 },
      },
    };
    const shellFailureSnapshot = structuredClone(shellFailureAfter);
    assert.equal(await driver.toolHook('execute.after')(shellFailureAfter), undefined);
    assert.deepEqual(shellFailureAfter, shellFailureSnapshot, 'execute.after does not change a live shell tool result');
    const shellDelivered = await context(driver, 'shellFailure');
    assert.equal((shellDelivered.match(/Cue:\n/g) || []).length, 2,
      'live shell action and failure events deliver both lessons');
    assert.match(shellDelivered, /subject-case/, 'the failure lesson carries the commitlint diagnostic');

    await toolCall(driver, 'noLedger', 'no-ledger-action');
    assert.equal(await context(driver, 'noLedger'), 'base system', 'an unrelated workspace without a ledger is silent');

    await toolCall(driver, 'sessionCleanup', 'session-cleanup-action');
    const state = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
    const sessionState = state.getSessionDir(workspace, 'sessionCleanup', { workspace_root: workspace, session_id: 'sessionCleanup', host_id: 'opencode' });
    const claims = fs.readdirSync(sessionState).filter(file => file.endsWith('.claim'));
    assert.equal(claims.length, 1);
    driver.emit('session.deleted', 'sessionCleanup');
    await driver.waitFor(
      () => claims.every(file => !fs.existsSync(path.join(sessionState, file))),
      { label: 'session invalidation releases undelivered matcher reservation' },
    );

    await driver.toolHook('execute.before')({
      tool: 'bash', sessionID: 'disposal', agent: 'build', messageID: 'message-disposal', id: 'pending-action', input: { command },
    });
  } finally {
    await driver.teardown();
  }

  const packaged = await createV2Driver({ plugin: packagePlugin(), workspace, sessionLookup });
  process.env.HARNESS_STATE_HOME = sharedStateHome;
  try {
    await packaged.toolHook('execute.before')({
      tool: 'bash', sessionID: 'disposal', agent: 'build', messageID: 'message-disposal-2', id: 'pending-action-2', input: { command },
    });
    const packagedDelivery = await context(packaged, 'disposal');
    assert.match(packagedDelivery, /subject-case/,
      'disposing the prior carrier releases an undelivered claim, and the packaged loader resolves the shared matcher');
  } finally {
    await packaged.teardown();
  }
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const LEDGER = path.join(ROOT, '.agents', 'harness-everything', 'errors');
const COMMITLINT = fs.readFileSync(path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'), 'utf8');
const OLD_ENV = Object.fromEntries(['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_TELEMETRY', 'HARNESS_SYSTEM_ONE_MODE']
  .map(key => [key, process.env[key]]));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-394-opencode-ledger-'));

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function addLedger(workspace) {
  fs.cpSync(LEDGER, path.join(workspace, '.agents', 'harness-everything', 'errors'), { recursive: true });
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

function createV2Context(sessionWorkspaces, pluginFile = PLUGIN) {
  const toolHooks = new Map();
  const sessionHooks = new Map();
  const eventQueue = [];
  let eventWaiter;
  let currentEvent;
  const ctx = {
    location: { directory: ROOT },
    tool: { hook: async (name, callback) => { toolHooks.set(name, callback); return { dispose: async () => {} }; } },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: sessionWorkspaces[sessionID] } }),
      hook: async (name, callback) => { sessionHooks.set(name, callback); return { dispose: async () => {} }; },
      prompt: async () => ({}),
      context: async () => [],
    },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => {
              currentEvent?.resolve();
              currentEvent = null;
              if (eventQueue.length) {
                currentEvent = eventQueue.shift();
                return Promise.resolve({ value: currentEvent.event, done: false });
              }
              if (signal.aborted) return Promise.resolve({ done: true });
              return new Promise(resolve => {
                eventWaiter = resolve;
                signal.addEventListener('abort', () => resolve({ done: true }), { once: true });
              });
            },
          };
        },
      }),
    },
  };
  return import(pathToFileURL(pluginFile).href).then(async mod => ({
    toolHooks,
    sessionHooks,
    pushEvent: event => new Promise(resolve => {
      const item = { event, resolve };
      if (eventWaiter) {
        currentEvent = item;
        eventWaiter({ value: event, done: false });
        eventWaiter = null;
      } else eventQueue.push(item);
    }),
    dispose: await mod.default.setup(ctx),
  }));
}

async function toolCall(harness, sessionID, id, status = 'completed', output = 'ok', exit = 0) {
  const command = 'git commit -m "docs(errors): Bad Case"';
  const before = { tool: 'bash', sessionID, agent: 'build', messageID: `message-${id}`, id, input: { command } };
  const beforeSnapshot = structuredClone(before);
  assert.equal(await harness.toolHooks.get('execute.before')(before), undefined);
  assert.deepEqual(before, beforeSnapshot, 'execute.before does not change the tool request');

  const after = {
    ...before,
    status,
    ...(status === 'error'
      ? { error: { name: 'ToolError', message: output } }
      : { result: { output, metadata: { exit } } }),
  };
  const afterSnapshot = structuredClone(after);
  assert.equal(await harness.toolHooks.get('execute.after')(after), undefined);
  assert.deepEqual(after, afterSnapshot, 'execute.after does not change the host tool result');
}

async function context(harness, sessionID, base = 'base system') {
  const event = { sessionID, kind: 'primary', system: [{ type: 'text', text: base }] };
  await harness.sessionHooks.get('context')(event);
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
  const home = path.join(TMP, 'home');
  const workspace = path.join(TMP, 'workspace');
  const otherWorkspace = path.join(TMP, 'other-workspace');
  const emptyWorkspace = path.join(TMP, 'empty-workspace');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(otherWorkspace, { recursive: true });
  fs.mkdirSync(emptyWorkspace, { recursive: true });
  addLedger(workspace);
  addLedger(otherWorkspace);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HARNESS_STATE_HOME = path.join(TMP, 'harness-state');
  process.env.HARNESS_TELEMETRY = 'off';
  delete process.env.HARNESS_SYSTEM_ONE_MODE;

  const sessionWorkspaces = {
    same: workspace,
    other: workspace,
    separateWorkspace: otherWorkspace,
    noLedger: emptyWorkspace,
    disposal: workspace,
    sessionCleanup: workspace,
  };
  const harness = await createV2Context(sessionWorkspaces);
  const command = 'git commit -m "docs(errors): Bad Case"';
  try {
    assert.ok(harness.toolHooks.has('execute.before') && harness.toolHooks.has('execute.after'));
    assert.ok(harness.sessionHooks.has('context'));
    assert.equal(harness.toolHooks.size, 2, 'the carrier registers no permission hook or additional tool gate');

    const before = { tool: 'bash', sessionID: 'same', agent: 'build', messageID: 'message-same', id: 'same-action', input: { command } };
    const beforeSnapshot = structuredClone(before);
    assert.equal(await harness.toolHooks.get('execute.before')(before), undefined);
    assert.deepEqual(before, beforeSnapshot);

    const failure = {
      ...before,
      status: 'error',
      error: { name: 'ToolError', message: COMMITLINT },
    };
    const failureSnapshot = structuredClone(failure);
    assert.equal(await harness.toolHooks.get('execute.after')(failure), undefined);
    assert.deepEqual(failure, failureSnapshot, 'the failed shell result remains untouched');

    const wrongSessionSystem = [{ type: 'text', text: 'base system' }];
    await harness.sessionHooks.get('context')({ sessionID: 'other', kind: 'primary', system: wrongSessionSystem });
    assert.deepEqual(wrongSessionSystem, [{ type: 'text', text: 'base system' }], 'a pending lesson stays bound to its session');

    const delivered = await context(harness, 'same');
    assert.equal((delivered.match(/Cue:\n/g) || []).length, 2,
      'action selection runs in execute.before and failure selection in execute.after; both arrive at the next model request');
    assert.match(delivered, /subject-case/);
    assert.equal(await context(harness, 'same'), 'base system', 'a delivered phase is not replayed on another context build');

    await toolCall(harness, 'other', 'other-action', 'completed', COMMITLINT, 0);
    assert.equal((await context(harness, 'other')).match(/Cue:\n/g)?.length, 1,
      'diagnostic text with a zero exit remains action-only in a second session');

    await toolCall(harness, 'separateWorkspace', 'workspace-action', 'completed', COMMITLINT, 1);
    assert.equal((await context(harness, 'separateWorkspace')).match(/Cue:\n/g)?.length, 2,
      'a completed tool result with nonzero metadata.exit and captured diagnostics selects failure too');

    await toolCall(harness, 'noLedger', 'no-ledger-action');
    assert.equal(await context(harness, 'noLedger'), 'base system', 'an unrelated workspace without a ledger is silent');

    await toolCall(harness, 'sessionCleanup', 'session-cleanup-action');
    const state = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
    const sessionState = state.getSessionDir(workspace, 'sessionCleanup', { workspace_root: workspace, session_id: 'sessionCleanup', host_id: 'opencode' });
    const claims = fs.readdirSync(sessionState).filter(file => file.endsWith('.claim'));
    assert.equal(claims.length, 1);
    await harness.pushEvent({ type: 'session.deleted', sessionID: 'sessionCleanup' });
    assert.ok(claims.every(file => !fs.existsSync(path.join(sessionState, file))),
      'session invalidation releases an undelivered matcher reservation');

    await harness.toolHooks.get('execute.before')({
      tool: 'bash', sessionID: 'disposal', agent: 'build', messageID: 'message-disposal', id: 'pending-action', input: { command },
    });
  } finally {
    await harness.dispose();
  }

  const packaged = await createV2Context(sessionWorkspaces, packagePlugin());
  try {
    await packaged.toolHooks.get('execute.before')({
      tool: 'bash', sessionID: 'disposal', agent: 'build', messageID: 'message-disposal-2', id: 'pending-action-2', input: { command },
    });
    const packagedDelivery = await context(packaged, 'disposal');
    assert.match(packagedDelivery, /subject-case/,
      'disposing the prior carrier releases an undelivered claim, and the packaged loader resolves the shared matcher');
  } finally {
    await packaged.dispose();
  }
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const observations = require('../hooks/scripts/lib/observations');
const exporter = require('../scripts/system-one-observations-export');
const workspaceState = require('../scripts/lib/workspace');
const harnessState = require('../hooks/scripts/lib/harness-state');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const VERIFY_KILL_GRACE_MS = Number(fs.readFileSync(PLUGIN, 'utf8').match(/const VERIFY_KILL_GRACE_MS = (\d+)/)?.[1]);
const HEARTBEAT_INTERVAL_MS = 20;
const HEARTBEAT_POLL_MS = 10;
const VALID_LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix","test"],"workflow":"iterative-single","skills":["tdd"]} -->';
const SECOND_LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["edit"],"workflow":"iterative-single","skills":[]} -->';
assert.ok(Number.isFinite(VERIFY_KILL_GRACE_MS), 'the verification runner exposes its process-group grace in source');

// OpenCode 2.x events are flat: {id, created, type, durable, [location], data},
// the session id lives at data.sessionID, and a completed turn ends with
// session.execution.succeeded because V2 hosts do not send session.idle.
function v2Event(type, sessionID, data = {}) {
  return { id: `evt-${type}-${sessionID}`, created: Date.now(), type, durable: true, data: { sessionID, ...data } };
}

function fixture(observationMode = 'on') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-observations-'));
  const workspace = path.join(dir, 'workspace');
  const store = path.join(dir, 'observations');
  fs.mkdirSync(workspace, { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const envBefore = Object.fromEntries(['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS']
    .map(key => [key, process.env[key]]));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.HARNESS_STATE_HOME = path.join(dir, 'harness-state');
  process.env.HARNESS_OBSERVATIONS_DIR = store;
  process.env.HARNESS_OBSERVATIONS = observationMode;

  const sessionHooks = new Map();
  const toolHooks = new Map();
  const events = [];
  const waiters = [];
  let deliveredEvent = null;
  let beforeEventConsumed = null;
  let eventStreamEnded = false;
  let contextMessageID = 'user-message';
  let contextPrompt = 'fix the observed turn';
  let finalText = VALID_LABEL;
  let sessionLookup = async ({ sessionID }) => ({ id: sessionID, location: { directory: workspace } });
  let sessionLookups = 0;
  const ctx = {
    location: { directory: workspace },
    session: {
      get: async input => { sessionLookups++; return sessionLookup(input); },
      hook: async (name, callback) => {
        sessionHooks.set(name, event => {
          if (name === 'prompt') {
            contextMessageID = event.messageID || event.messageId || null;
            contextPrompt = event.prompt?.text || '';
          }
          return callback(event);
        });
        return { dispose: async () => {} };
      },
      prompt: async () => ({}),
      context: async () => [
        { info: { role: 'user', id: contextMessageID }, parts: [{ type: 'text', text: contextPrompt }] },
        { info: { role: 'assistant', id: 'assistant-message' }, parts: [{ type: 'text', text: finalText }] },
      ],
    },
    tool: {
      hook: async (name, callback) => { toolHooks.set(name, callback); return { dispose: async () => {} }; },
    },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (deliveredEvent) {
              deliveredEvent.consumed();
              deliveredEvent = null;
            }
            const deliver = item => {
              deliveredEvent = item;
              return { value: item.event, done: false };
            };
            if (events.length) return Promise.resolve(deliver(events.shift()));
            if (signal.aborted) {
              eventStreamEnded = true;
              return Promise.resolve({ done: true });
            }
            return new Promise(resolve => {
              const waiter = item => {
                signal.removeEventListener('abort', onAbort);
                resolve(deliver(item));
              };
              const onAbort = () => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                eventStreamEnded = true;
                resolve({ done: true });
              };
              waiters.push(waiter);
              signal.addEventListener('abort', onAbort, { once: true });
            });
          },
          return: async () => {
            eventStreamEnded = true;
            return { done: true };
          },
        }),
      }),
    },
  };
  const push = event => {
    return new Promise(consumed => {
      const item = { event, consumed: () => {
        const before = beforeEventConsumed;
        beforeEventConsumed = null;
        try { before?.(); } finally { consumed(); }
      } };
      const waiter = waiters.shift();
      if (waiter) waiter(item);
      else events.push(item);
    });
  };

  return {
    dir, workspace, store, ctx, sessionHooks, toolHooks, push,
    setFinal(text) { finalText = text; },
    setSessionLookup(lookup) { sessionLookup = lookup; },
    sessionLookupCount() { return sessionLookups; },
    setBeforeEventConsumed(callback) { beforeEventConsumed = callback; },
    eventStreamEnded() { return eventStreamEnded; },
    restore() {
      for (const [key, value] of Object.entries(envBefore)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function install(f, plugin = PLUGIN) {
  const mod = await import(pathToFileURL(plugin).href);
  return mod.default.setup(f.ctx);
}

function recordList(store) {
  const file = path.join(store, 'observations-index.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).records : [];
}

function routerArtifact(workspace, sessionID) {
  const stateDir = path.join(workspaceState.getWorkspaceStateDir(workspace), 'state', 'sessions', harnessState.sessionDirectoryName(sessionID));
  return path.join(stateDir, 'workflow-run.json');
}

function editStateArtifact(workspace, sessionID) {
  const stateDir = path.join(workspaceState.getWorkspaceStateDir(workspace), 'state', 'sessions', harnessState.sessionDirectoryName(sessionID));
  return path.join(stateDir, 'edit-state.json');
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('OpenCode observation was not written');
    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_POLL_MS));
  }
}

async function waitUntil(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_POLL_MS));
  }
  return true;
}

async function waitForProcessStop(pid, heartbeat, timeout) {
  const deadline = Date.now() + timeout;
  let previousSize = fs.statSync(heartbeat).size;
  let stableSince = null;
  while (Date.now() < deadline) {
    let running = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
    const size = fs.existsSync(heartbeat) ? fs.statSync(heartbeat).size : 0;
    if (!running && size === previousSize) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= HEARTBEAT_INTERVAL_MS * 2) return true;
    } else {
      previousSize = size;
      stableSince = null;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

async function resolvesWithin(promise, timeout) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true, () => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stateDir(workspace, sessionID) {
  return path.dirname(editStateArtifact(workspace, sessionID));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function makeWorkspace(f, name) {
  const workspace = path.join(f.dir, name);
  fs.mkdirSync(workspace, { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  return workspace;
}

function writeVerificationPackage(f, source) {
  fs.writeFileSync(path.join(f.workspace, 'package.json'), JSON.stringify({
    name: 'opencode-v2-consumer-fixture', version: '1.0.0', scripts: { test: 'node verify.js' },
  }));
  fs.writeFileSync(path.join(f.workspace, 'verify.js'), source);
}

async function sendEdit(f, sessionID, id) {
  const event = { tool: 'edit', sessionID, id, messageID: `assistant-${id}`, input: { filePath: 'changed.js' } };
  await f.toolHooks.get('execute.before')(event);
  await f.toolHooks.get('execute.after')({ ...event, status: 'completed', result: {} });
}

test('inject: the documented OpenCode hooks deliver the kernel router output and exact label line', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'), 'setup registers prompt admission');
    assert.ok(f.sessionHooks.has('context'), 'setup registers the system context transform');
    const prompt = { sessionID: 'inject-session', messageID: 'inject-turn', prompt: { text: 'git status' } };
    await f.sessionHooks.get('prompt')(prompt);
    const context = { sessionID: 'inject-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    assert.equal(prompt.prompt.text, 'git status', 'injection leaves the persisted user prompt unchanged');
    const injected = context.system.map(part => part.text || '').join('\n');
    assert.match(injected, /=> WORKFLOW STRATEGY: deferred/);
    assert.match(injected, /Use JSON null for workflow when the strategy is deferred/);

    const expectedRun = spawnSync(process.execPath, [path.join(ROOT, 'harness-everything/scripts/kernel-router.js')], {
      cwd: f.workspace,
      env: { ...process.env, HARNESS_STATE_HOME: path.join(f.dir, 'expected-state') },
      input: JSON.stringify({ host: 'opencode', session_id: 'expected-session', cwd: f.workspace, prompt: prompt.prompt.text }),
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(expectedRun.status, 0, expectedRun.stderr);
    const exactLabelLine = expectedRun.stdout.split(/\r?\n/).find(line => line.includes('<!-- harness-label '))?.trim();
    assert.ok(exactLabelLine, 'the canonical kernel router prints its label contract');
    assert.ok(injected.includes(exactLabelLine), 'the model receives the exact kernel-router label template');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('runtime: a non-Node host binary still runs the router on Node and injects its output', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  const warnings = [];
  const originalWarn = console.warn;
  const originalExecPath = process.execPath;
  const hadBun = Object.hasOwn(process.versions, 'bun');
  const originalBun = process.versions.bun;
  try {
    // Reproduce the live witness: OpenCode is a compiled Bun binary, so the
    // plugin's process.execPath is the opencode executable - not node - and the
    // Bun runtime shows up as process.versions.bun. The stub below is a real,
    // executable, non-node program that exits non-zero, so the current code's
    // spawn(process.execPath, ['.js']) cannot produce router output.
    const stubRuntime = path.join(f.dir, process.platform === 'win32' ? 'stub-runtime.cmd' : 'stub-runtime');
    fs.writeFileSync(stubRuntime, process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    Object.defineProperty(process, 'execPath', { value: stubRuntime, configurable: true, writable: true });
    Object.defineProperty(process.versions, 'bun', { value: '1.2.0', configurable: true });
    console.warn = message => warnings.push(String(message));

    dispose = await install(f);
    assert.deepEqual(warnings, [], 'setup without traffic produces no warnings');
    const prompt = { sessionID: 'runtime-session', messageID: 'runtime-turn', prompt: { text: 'add a small behavior change' } };
    await f.sessionHooks.get('prompt')(prompt);
    const context = { sessionID: 'runtime-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    const injected = context.system.map(part => part.text || '').join('\n');
    assert.match(injected, /=> ROUTER WORKFLOW PLAN/, 'the router ran on Node despite a non-Node host binary');
    assert.deepEqual(warnings, []);
  } finally {
    if (dispose) await dispose();
    console.warn = originalWarn;
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true, writable: true });
    if (hadBun) Object.defineProperty(process.versions, 'bun', { value: originalBun, configurable: true });
    else delete process.versions.bun;
    f.restore();
  }
});

for (const reason of ['spawn-failed', 'runtime-failed', 'runtime-missing']) {
  test(`runtime: ${reason} warns without prompt content and admits the prompt`, async () => {
    const f = fixture('off');
    const originalExecPath = process.execPath;
    const originalWarn = console.warn;
    const warnings = [];
    let dispose;
    try {
      let plugin = PLUGIN;
      if (reason === 'spawn-failed') {
        // Exercise the same ENOENT as a missing Node on PATH, including on
        // Windows where executable lookup can also use the host directory.
        Object.defineProperty(process, 'execPath', {
          value: path.join(f.dir, 'missing-node'), configurable: true, writable: true,
        });
      } else {
        plugin = path.join(f.dir, 'opencode-plugin', 'index.mjs');
        fs.mkdirSync(path.dirname(plugin));
        fs.copyFileSync(PLUGIN, plugin);
        if (reason === 'runtime-failed') {
          const router = path.join(f.dir, 'harness-everything/scripts/kernel-router.js');
          const observationsFile = path.join(f.dir, 'hooks/scripts/lib/observations.js');
          fs.mkdirSync(path.dirname(router), { recursive: true });
          fs.mkdirSync(path.dirname(observationsFile), { recursive: true });
          fs.writeFileSync(router, "console.log('PRIVATE-ROUTER-OUTPUT'); require('./missing-router-runtime');\n");
          fs.writeFileSync(observationsFile, 'module.exports = { enabled: () => false };\n');
        }
      }
      console.warn = message => warnings.push(String(message));
      dispose = await install(f, plugin);
      assert.deepEqual(warnings, []);
      for (const count of [1, 2]) {
        const sessionID = 'private-router-failure-session';
        const prompt = { sessionID, messageID: `private-turn-${count}`, prompt: { text: 'private prompt text' } };
        await assert.doesNotReject(() => f.sessionHooks.get('prompt')(prompt));
        const context = { sessionID, kind: 'primary', system: [], messages: [] };
        await f.sessionHooks.get('context')(context);
        assert.deepEqual(context.system, [], 'failed output is never injected');
        assert.equal(warnings.length, count);
        assert.equal(warnings.at(-1), `[Harness] OpenCode router-unavailable (${reason}; count=${count})`);
      }
    } finally {
      if (dispose) await dispose();
      console.warn = originalWarn;
      Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true, writable: true });
      f.restore();
    }
  });
}

test('record: OpenCode prompt, tool and idle events append one host-tagged record to the shared store', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'));
    await f.sessionHooks.get('prompt')({ sessionID: 'record-session', messageID: 'record-turn', prompt: { text: 'fix the observed turn' } });
    await f.sessionHooks.get('prompt')({ sessionID: 'record-session', messageID: 'record-turn', prompt: { text: 'fix the observed turn' } });
    await f.toolHooks.get('execute.after')({
      status: 'completed', tool: 'edit', sessionID: 'record-session', id: 'call-1', input: { filePath: 'changed.js' }, result: {},
    });
    f.push(v2Event('session.execution.succeeded', 'record-session'));
    await waitFor(() => recordList(f.store).length === 1);
    const [record] = recordList(f.store);
    assert.equal(record.host, 'opencode');
    assert.equal(record.writer.sessionId, 'record-session');
    assert.equal(record.writer.turnId, 'record-turn');
    assert.equal(record.turn, 1, 'a repeated admission with the same message id does not start a second turn');
    assert.equal(record.selfReport.tier, 'tier2');
    assert.equal(record.behavior.filesWritten, 1);
    assert.equal(f.sessionLookupCount(), 1, 'a duplicate prompt reuses the existing session binding');
    const text = JSON.parse(fs.readFileSync(path.join(f.store, 'text', `${record.contentSha256}.json`), 'utf8'));
    assert.equal(text.prompt, 'fix the observed turn');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('workspace: V2 prompt and observations bind to the session directory when setup and server workspaces differ', { concurrency: false }, async () => {
  const f = fixture();
  const sessionWorkspace = path.join(f.dir, 'session-workspace');
  const serverWorkspace = path.join(f.dir, 'server-workspace');
  for (const workspace of [sessionWorkspace, serverWorkspace]) {
    fs.mkdirSync(workspace, { recursive: true });
    const gitInit = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
    assert.equal(gitInit.status, 0, gitInit.stderr);
  }
  f.setSessionLookup(async ({ sessionID }) => ({ id: sessionID, location: { directory: sessionWorkspace } }));
  const originalCwd = process.cwd();
  let dispose;
  try {
    process.chdir(serverWorkspace);
    dispose = await install(f);
    const sessionID = 'cross-workspace-session';
    const messageID = 'cross-workspace-turn';
    await f.sessionHooks.get('prompt')({ sessionID, messageID, prompt: { text: 'record the authoritative session workspace' } });
    await f.sessionHooks.get('prompt')({ sessionID, messageID, prompt: { text: 'record the authoritative session workspace' } });

    const pendingFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const pendingCwd = JSON.parse(fs.readFileSync(pendingFile, 'utf8')).pending?.cwd;
    const context = { sessionID, kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    assert.match(context.system.map(part => part.text || '').join('\n'), /=> ROUTER WORKFLOW PLAN/);
    await f.toolHooks.get('execute.after')({
      status: 'completed', tool: 'edit', sessionID, id: 'cross-workspace-call', input: { filePath: 'changed.js' }, result: {},
    });
    f.push(v2Event('session.execution.succeeded', sessionID));
    await waitFor(() => recordList(f.store).length === 1);

    const [record] = recordList(f.store);
    const artifactPaths = {
      setupA: routerArtifact(f.workspace, sessionID),
      sessionB: routerArtifact(sessionWorkspace, sessionID),
      serverC: routerArtifact(serverWorkspace, sessionID),
    };
    const artifacts = Object.fromEntries(Object.entries(artifactPaths).map(([key, file]) => [key, fs.existsSync(file)]));
    const actual = { artifacts, artifactPaths, observationCwdHash: pendingCwd, recordRouter: record.router };
    assert.deepEqual(artifacts, { setupA: false, sessionB: true, serverC: false },
      `router workspace artifacts must follow session B; actual=${JSON.stringify(actual)}`);
    assert.equal(pendingCwd, observations.sha(sessionWorkspace, 16),
      `the completed turn's observation must start with session B attribution; actual=${JSON.stringify(actual)}`);
    const sessionRun = JSON.parse(fs.readFileSync(artifactPaths.sessionB, 'utf8'));
    assert.equal(record.router?.tier, sessionRun.workflowPlan?.tier || sessionRun.tier,
      `the production observation router field must reflect session B state; actual=${JSON.stringify(actual)}`);
    assert.equal(record.writer.sessionId, sessionID);
    assert.equal(record.writer.turnId, messageID);
    assert.equal(record.behavior.filesWritten, 1);
    assert.equal(record.selfReportReason, null);
    assert.equal(f.sessionLookupCount(), 1, 'one session lookup is used for the distinct prompt');
    const editStatePaths = {
      setupA: editStateArtifact(f.workspace, sessionID),
      sessionB: editStateArtifact(sessionWorkspace, sessionID),
      serverC: editStateArtifact(serverWorkspace, sessionID),
    };
    const editStates = Object.fromEntries(Object.entries(editStatePaths).map(([key, file]) => [key, fs.existsSync(file)]));
    assert.deepEqual(editStates, { setupA: false, sessionB: true, serverC: false },
      `edit state from the completed edit must follow session B; actual=${JSON.stringify({ editStates, editStatePaths })}`);
  } finally {
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('workspace: session directory is used when setup provides no location', { concurrency: false }, async () => {
  const f = fixture();
  const sessionWorkspace = path.join(f.dir, 'session-workspace');
  const serverWorkspace = path.join(f.dir, 'server-workspace');
  for (const workspace of [sessionWorkspace, serverWorkspace]) {
    fs.mkdirSync(workspace, { recursive: true });
    const gitInit = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
    assert.equal(gitInit.status, 0, gitInit.stderr);
  }
  f.ctx.location = undefined;
  f.ctx.directory = undefined;
  f.setSessionLookup(async ({ sessionID }) => ({ id: sessionID, location: { directory: sessionWorkspace } }));
  const originalCwd = process.cwd();
  let dispose;
  try {
    process.chdir(serverWorkspace);
    dispose = await install(f);
    const sessionID = 'session-without-setup-location';
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'without-setup-turn', prompt: { text: 'use the host session directory' } });
    f.push(v2Event('session.execution.succeeded', sessionID));
    await waitFor(() => recordList(f.store).length === 1);

    const artifactPaths = [f.workspace, sessionWorkspace, serverWorkspace].map(workspace => routerArtifact(workspace, sessionID));
    assert.deepEqual(artifactPaths.map(file => fs.existsSync(file)), [false, true, false]);
    assert.equal(recordList(f.store)[0].writer.turnId, 'without-setup-turn');
    assert.equal(recordList(f.store)[0].selfReportReason, null);
    assert.equal(f.sessionLookupCount(), 1);
  } finally {
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('workspace: interleaved sessions keep their own router, tool and completion bindings', { concurrency: false }, async () => {
  const f = fixture();
  const workspaceB = path.join(f.dir, 'workspace-b');
  fs.mkdirSync(workspaceB, { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q', workspaceB], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  f.setSessionLookup(async ({ sessionID }) => ({ id: sessionID, location: { directory: sessionID === 'session-b' ? workspaceB : f.workspace } }));
  let dispose;
  try {
    dispose = await install(f);
    for (const [sessionID, messageID] of [['session-a', 'turn-a'], ['session-b', 'turn-b']]) {
      await f.sessionHooks.get('prompt')({ sessionID, messageID, prompt: { text: `capture ${sessionID}` } });
    }
    const pendingA = JSON.parse(fs.readFileSync(path.join(f.store, 'sessions', `${observations.sha('session-a', 32)}.json`), 'utf8')).pending;
    const pendingB = JSON.parse(fs.readFileSync(path.join(f.store, 'sessions', `${observations.sha('session-b', 32)}.json`), 'utf8')).pending;
    assert.equal(pendingA.cwd, observations.sha(f.workspace, 16));
    assert.equal(pendingB.cwd, observations.sha(workspaceB, 16));

    for (const sessionID of ['session-a', 'session-b']) {
      await f.toolHooks.get('execute.after')({
        status: 'completed', tool: 'edit', sessionID, id: `call-${sessionID}`, input: { filePath: `${sessionID}.js` }, result: {},
      });
    }
    f.push(v2Event('session.execution.succeeded', 'session-b'));
    await waitFor(() => recordList(f.store).length === 1);
    f.push(v2Event('session.execution.succeeded', 'session-a'));
    await waitFor(() => recordList(f.store).length === 2);

    const bySession = Object.fromEntries(recordList(f.store).map(record => [record.writer.sessionId, record]));
    assert.deepEqual(Object.keys(bySession).sort(), ['session-a', 'session-b']);
    assert.equal(bySession['session-a'].writer.turnId, 'turn-a');
    assert.equal(bySession['session-b'].writer.turnId, 'turn-b');
    assert.equal(bySession['session-a'].behavior.filesWritten, 1);
    assert.equal(bySession['session-b'].behavior.filesWritten, 1);
    assert.ok(bySession['session-a'].router?.tier);
    assert.ok(bySession['session-b'].router?.tier);
    assert.equal(f.sessionLookupCount(), 2);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('workspace: unresolved identity skips state and observations and does not inject a stale route', { concurrency: false }, async () => {
  const f = fixture();
  const serverWorkspace = path.join(f.dir, 'server-workspace');
  fs.mkdirSync(serverWorkspace, { recursive: true });
  const originalCwd = process.cwd();
  const originalWarn = console.warn;
  const warnings = [];
  let dispose;
  try {
    dispose = await install(f);
    const sessionID = 'unresolved-session';
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'known-turn', prompt: { text: 'known workspace route' } });
    const firstContext = { sessionID, kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(firstContext);
    const oldRoute = firstContext.system.map(part => part.text || '').join('\n');
    assert.match(oldRoute, /=> ROUTER WORKFLOW PLAN/);
    const stateFile = routerArtifact(f.workspace, sessionID);
    const stateBefore = fs.readFileSync(stateFile, 'utf8');

    process.chdir(serverWorkspace);
    f.ctx.location = undefined;
    f.ctx.directory = undefined;
    f.setSessionLookup(async () => { throw new Error('private lookup detail'); });
    console.warn = message => warnings.push(String(message));
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'unresolved-turn', prompt: { text: 'must not reuse the previous route' } });
    const nextContext = { sessionID, kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(nextContext);
    assert.deepEqual(nextContext.system, [], 'a previous router payload is not reused after identity fails');
    assert.equal(fs.readFileSync(stateFile, 'utf8'), stateBefore, 'the failed lookup does not rerun the router in workspace A');
    assert.equal(fs.existsSync(routerArtifact(serverWorkspace, sessionID)), false, 'the server cwd receives no router state');
    assert.deepEqual(recordList(f.store), [], 'the unresolved prompt creates no completed observation');
    assert.match(warnings.join('\n'), /session-lookup-failed; count=1/);
    assert.doesNotMatch(warnings.join('\n'), /unresolved-session|must not reuse|private lookup detail|server-workspace/);
    f.push(v2Event('session.execution.succeeded', sessionID));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(recordList(f.store), []);
  } finally {
    if (dispose) await dispose();
    console.warn = originalWarn;
    process.chdir(originalCwd);
    f.restore();
  }
});

test('workspace: rejected, empty and relative session identities fail open without cwd state', { concurrency: false }, async () => {
  const cases = [
    { name: 'rejected', reason: 'session-lookup-failed', lookup: async () => { throw new Error('private lookup detail'); } },
    { name: 'empty', reason: 'session-directory-unavailable', lookup: async () => ({}) },
    { name: 'relative', reason: 'session-directory-invalid', lookup: async () => ({ location: { directory: 'relative/session' } }) },
  ];
  for (const item of cases) {
    const f = fixture();
    const serverWorkspace = path.join(f.dir, 'server-workspace');
    fs.mkdirSync(serverWorkspace, { recursive: true });
    f.ctx.location = undefined;
    f.ctx.directory = undefined;
    f.setSessionLookup(item.lookup);
    const originalCwd = process.cwd();
    const originalWarn = console.warn;
    const warnings = [];
    let dispose;
    try {
      process.chdir(serverWorkspace);
      console.warn = message => warnings.push(String(message));
      dispose = await install(f);
      const sessionID = `identity-${item.name}`;
      await f.sessionHooks.get('prompt')({ sessionID, messageID: 'unresolved-turn', prompt: { text: 'admission stays open' } });
      const context = { sessionID, kind: 'primary', system: [], messages: [] };
      await f.sessionHooks.get('context')(context);
      assert.deepEqual(context.system, [], `${item.name} identity does not inject routing context`);
      f.push(v2Event('session.execution.succeeded', sessionID));
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(recordList(f.store), [], `${item.name} identity does not create observations`);
      assert.equal(fs.existsSync(path.join(f.dir, 'harness-state', 'workspaces')), false,
        `${item.name} identity does not initialize setup or cwd enforcement state`);
      assert.match(warnings.join('\n'), new RegExp(`${item.reason}; count=1`));
      assert.doesNotMatch(warnings.join('\n'), new RegExp(`${sessionID}|admission stays open|private lookup detail|server-workspace`));
      assert.equal(f.sessionLookupCount(), 1);
    } finally {
      if (dispose) await dispose();
      console.warn = originalWarn;
      process.chdir(originalCwd);
      f.restore();
    }
  }
});

test('workspace: a session lookup that never settles releases prompt admission without cwd fallback', { concurrency: false }, async () => {
  const f = fixture();
  const serverWorkspace = path.join(f.dir, 'server-workspace');
  fs.mkdirSync(serverWorkspace, { recursive: true });
  f.ctx.location = undefined;
  f.ctx.directory = undefined;
  f.setSessionLookup(() => new Promise(() => {}));
  const originalCwd = process.cwd();
  const originalWarn = console.warn;
  const warnings = [];
  let dispose;
  try {
    process.chdir(serverWorkspace);
    console.warn = message => warnings.push(String(message));
    dispose = await install(f);
    const started = Date.now();
    await f.sessionHooks.get('prompt')({ sessionID: 'pending-identity', messageID: 'pending-turn', prompt: { text: 'do not wait forever' } });
    assert.ok(Date.now() - started < 6000, 'prompt admission is released by the bounded identity lookup');
    assert.equal(f.sessionLookupCount(), 1);
    assert.equal(fs.existsSync(path.join(f.dir, 'harness-state', 'workspaces')), false);
    assert.deepEqual(recordList(f.store), []);
    assert.match(warnings.join('\n'), /session-lookup-timeout; count=1/);
    assert.doesNotMatch(warnings.join('\n'), /pending-identity|do not wait forever|server-workspace/);
  } finally {
    if (dispose) await dispose();
    console.warn = originalWarn;
    process.chdir(originalCwd);
    f.restore();
  }
});

test('workspace: an unbound session lifecycle event resolves its own workspace before resetting state', { concurrency: false }, async () => {
  const f = fixture();
  const sessionWorkspace = path.join(f.dir, 'session-workspace');
  fs.mkdirSync(sessionWorkspace, { recursive: true });
  f.setSessionLookup(async ({ sessionID }) => ({ id: sessionID, location: { directory: sessionWorkspace } }));
  const sessionID = 'created-session';
  const stateFile = routerArtifact(sessionWorkspace, sessionID);
  const stateDir = path.dirname(stateFile);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, '{"stale":true}');
  let dispose;
  try {
    dispose = await install(f);
    f.push(v2Event('session.created', sessionID));
    await waitFor(() => f.sessionLookupCount() === 1 && !fs.existsSync(stateDir));
    assert.equal(fs.existsSync(routerArtifact(f.workspace, sessionID)), false);
    assert.deepEqual(recordList(f.store), []);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('malformed: invalid labels remain null with a reason and export counts are grouped by host', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    f.setFinal('Done.\n<!-- harness-label {"validity":"valid","tier":3,"skills_used":[]} -->');
    await f.sessionHooks.get('prompt')({ sessionID: 'malformed-opencode', messageID: 'bad-opencode', prompt: { text: 'record an invalid label' } });
    f.push(v2Event('session.execution.succeeded', 'malformed-opencode'));
    await waitFor(() => recordList(f.store).length === 1);
    assert.equal(recordList(f.store)[0].selfReport, null);
    assert.equal(recordList(f.store)[0].selfReportReason, 'label-invalid');

    observations.handle({ host: 'claude', session_id: 'malformed-claude', cwd: f.workspace,
      hook_event_name: 'UserPromptSubmit', turn_id: 'bad-claude', prompt: 'another malformed label' }, process.env);
    observations.handle({ host: 'claude', session_id: 'malformed-claude', cwd: f.workspace,
      hook_event_name: 'Stop', turn_id: 'bad-claude', last_assistant_message: '<!-- harness-label {bad json} -->' }, process.env);
    observations.handle({ host: 'claude', session_id: 'missing-label', cwd: f.workspace,
      hook_event_name: 'UserPromptSubmit', turn_id: 'missing', prompt: 'label omitted' }, process.env);
    observations.handle({ host: 'claude', session_id: 'missing-label', cwd: f.workspace,
      hook_event_name: 'Stop', turn_id: 'missing', last_assistant_message: 'No label' }, process.env);

    const output = path.join(f.dir, 'export');
    const report = exporter.run(['--store', f.store, '--out', output]);
    assert.deepEqual(report.malformedLabelsByHost, { opencode: 1, claude: 1 });
    assert.equal(report.selfReportReasons['label-missing'], 1, 'a missing label is kept separate from malformed labels');
    const selfOnly = exporter.run(['--store', f.store, '--out', path.join(f.dir, 'self-only'), '--self-report-only']);
    assert.deepEqual(selfOnly.malformedLabelsByHost, { opencode: 1, claude: 1 }, 'self-report filtering does not hide malformed-label counts');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('opt-out: HARNESS_OBSERVATIONS=off disables capture while prompt routing stays active', { concurrency: false }, async () => {
  const f = fixture('off');
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'));
    await f.sessionHooks.get('prompt')({ sessionID: 'optout-session', messageID: 'optout-turn', prompt: { text: 'routing still applies' } });
    const context = { sessionID: 'optout-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    assert.match(context.system.map(part => part.text || '').join('\n'), /=> ROUTER WORKFLOW PLAN/);
    await f.push(v2Event('session.execution.succeeded', 'optout-session'));
    assert.deepEqual(recordList(f.store), []);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('record: a V2 flat session.execution.succeeded after the prompt hook closes the turn with the parsed label', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID: 'v2-session', messageID: 'v2-turn-1', prompt: { text: 'close the observed v2 turn' } });
    // Witness stream: session.step.ended then session.execution.succeeded, flat
    // events with the session id at data.sessionID.
    f.push(v2Event('session.step.ended', 'v2-session', { assistantMessageID: 'assistant-message', finish: 'stop', rawFinish: 'stop', cost: 0, tokens: {} }));
    f.push(v2Event('session.execution.succeeded', 'v2-session'));
    await waitFor(() => recordList(f.store).length === 1);
    const [record] = recordList(f.store);
    assert.equal(record.host, 'opencode');
    assert.equal(record.writer.sessionId, 'v2-session');
    assert.equal(record.writer.turnId, 'v2-turn-1');
    assert.notEqual(record.selfReportReason, 'stop-missing', 'the V2 turn end must close the record, not leave it pending');
    assert.equal(record.selfReport?.tier, 'tier2');
    assert.equal(record.selfReportReason, null);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('record: V2 context uses the final text after tool steps and anchors it to the prompted turn', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    f.ctx.session.context = async () => [
      { id: 'previous-user', time: { created: 0 }, text: 'previous turn', files: [], type: 'user' },
      { id: 'previous-assistant', time: { created: 0, streamed: 0, completed: 0 }, type: 'assistant', agent: 'test', model: { id: 'test', providerID: 'test', variant: 'default' }, content: [{ type: 'text', text: VALID_LABEL }], finish: 'stop', rawFinish: 'stop', cost: 0, tokens: {} },
      { id: 'v2-context-turn', time: { created: 0 }, text: 'current turn', files: [], type: 'user' },
      { id: 'tool-step', time: { created: 0, streamed: 0, completed: 0 }, type: 'assistant', agent: 'test', model: { id: 'test', providerID: 'test', variant: 'default' }, content: [{ type: 'tool', name: 'search' }], finish: 'tool-calls', rawFinish: 'tool-calls', cost: 0, tokens: {} },
      { id: 'final-assistant', time: { created: 0, streamed: 0, completed: 0 }, type: 'assistant', agent: 'test', model: { id: 'test', providerID: 'test', variant: 'default' }, content: [{ type: 'text', text: `Done.\n${SECOND_LABEL}` }], finish: 'stop', rawFinish: 'stop', cost: 0, tokens: {} },
      { id: 'idle', time: { created: 0 }, type: 'idle', outcome: 'success' },
    ];
    await f.sessionHooks.get('prompt')({ sessionID: 'v2-context', messageID: 'v2-context-turn', prompt: { text: 'record the final V2 message' } });
    f.push(v2Event('session.step.ended', 'v2-context', { assistantMessageID: 'final-assistant', finish: 'stop', rawFinish: 'stop', cost: 0, tokens: {} }));
    f.push(v2Event('session.execution.succeeded', 'v2-context'));
    await waitFor(() => recordList(f.store).length === 1);

    const [record] = recordList(f.store);
    assert.equal(record.host, 'opencode');
    assert.equal(record.writer.turnId, 'v2-context-turn');
    assert.equal(record.selfReportReason, null);
    assert.deepEqual(record.selfReport?.intents, ['edit'], 'the final assistant text is used instead of the earlier turn label');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('control: V2 context never reuses an assistant label from before the prompted message', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    f.ctx.session.context = async () => [
      { id: 'previous-user', time: { created: 0 }, text: 'previous turn', files: [], type: 'user' },
      { id: 'previous-assistant', time: { created: 0, streamed: 0, completed: 0 }, type: 'assistant', agent: 'test', model: { id: 'test', providerID: 'test', variant: 'default' }, content: [{ type: 'text', text: VALID_LABEL }], finish: 'stop', rawFinish: 'stop', cost: 0, tokens: {} },
      { id: 'v2-no-final-turn', time: { created: 0 }, text: 'current turn', files: [], type: 'user' },
      { id: 'idle', time: { created: 0 }, type: 'idle', outcome: 'success' },
    ];
    await f.sessionHooks.get('prompt')({ sessionID: 'v2-no-final', messageID: 'v2-no-final-turn', prompt: { text: 'do not reuse a previous label' } });
    f.push(v2Event('session.execution.succeeded', 'v2-no-final'));
    await waitFor(() => recordList(f.store).length === 1);

    const [record] = recordList(f.store);
    assert.equal(record.selfReport, null);
    assert.equal(record.selfReportReason, 'final-message-unavailable');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('record: two consecutive V2 turns in one session each produce a completed record', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID: 'v2-multi', messageID: 'v2-multi-1', prompt: { text: 'first observed v2 turn' } });
    f.push(v2Event('session.execution.succeeded', 'v2-multi'));
    await waitFor(() => recordList(f.store).length === 1);

    await f.sessionHooks.get('prompt')({ sessionID: 'v2-multi', messageID: 'v2-multi-2', prompt: { text: 'second observed v2 turn' } });
    f.setFinal(SECOND_LABEL);
    f.push(v2Event('session.execution.succeeded', 'v2-multi'));
    await waitFor(() => recordList(f.store).length === 2);

    const records = recordList(f.store);
    assert.deepEqual(records.map(record => record.turn), [1, 2]);
    assert.deepEqual(records.map(record => record.writer.turnId), ['v2-multi-1', 'v2-multi-2']);
    assert.ok(records.every(record => record.selfReportReason === null && record.selfReport?.tier === 'tier2'));
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('control: a V2 turn end without a prompt route records nothing', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    f.push(v2Event('session.execution.succeeded', 'no-route'));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(recordList(f.store), []);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('control: repeated V2 session.execution.succeeded events for one turn record it once', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID: 'dedupe', messageID: 'dedupe-1', prompt: { text: 'dedupe the turn end' } });
    const firstDone = f.push({ ...v2Event('session.execution.succeeded', 'dedupe'), id: 'evt-dedupe-1' });
    const secondDone = f.push({ ...v2Event('session.execution.succeeded', 'dedupe'), id: 'evt-dedupe-2' });
    await Promise.all([firstDone, secondDone]);
    await waitFor(() => recordList(f.store).some(record => record.writer.sessionId === 'dedupe'));

    // Positive control in the same fixture: a second session completes and
    // flushes the async observation path without duplicating the first turn.
    await f.sessionHooks.get('prompt')({ sessionID: 'dedupe-control', messageID: 'dedupe-control-1', prompt: { text: 'flush the observation path' } });
    await f.push(v2Event('session.execution.succeeded', 'dedupe-control'));
    await waitFor(() => recordList(f.store).some(record => record.writer.sessionId === 'dedupe-control'));

    const dedupeRecords = recordList(f.store).filter(record => record.writer.sessionId === 'dedupe');
    assert.equal(dedupeRecords.length, 1, 'the same turn must not be recorded twice');
    assert.equal(dedupeRecords[0].selfReportReason, null);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('control: the plugin exports only the V2 default definition with setup and no server', { concurrency: false }, async () => {
  const mod = await import(pathToFileURL(PLUGIN).href);
  assert.deepStrictEqual(Object.keys(mod).sort(), ['default']);
  assert.equal(typeof mod.default.setup, 'function');
  assert.equal(Object.hasOwn(mod.default, 'server'), false);
});

test('V2 consumers α1: flat execution.succeeded verifies the edit in its session once', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'flat-v2-verification';
  const checkLog = path.join(f.dir, 'check-runs.txt');
  writeVerificationPackage(f, `require('node:fs').appendFileSync(${JSON.stringify(checkLog)}, 'check\\n')`);
  let dispose;
  try {
    dispose = await install(f);
    await sendEdit(f, sessionID, 'flat-edit');
    const editFile = editStateArtifact(f.workspace, sessionID);
    assert.equal(readJson(editFile).verificationPending, true, 'the V2 edit created pending enforcement state');

    f.push(v2Event('session.execution.succeeded', sessionID));
    const verified = await waitUntil(() => fs.existsSync(checkLog) && !readJson(editFile).verificationPending);
    assert.equal(verified, true, 'flat data.sessionID completion runs the real check and clears the session edit state');
    assert.equal(fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length, 1, 'one completion runs the check once');
    assert.equal(readJson(path.join(stateDir(f.workspace, sessionID), 'compliance.json')).verifiedEdits, 1);
    assert.equal(readJson(editFile).editsSinceVerification, 0);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

async function flatLifecycleReset(startType, lifecycleType) {
  const f = fixture('off');
  const sessionID = `flat-reset-${startType}-${lifecycleType}`;
  const unrelated = 'unrelated-session';
  const ready = path.join(f.dir, 'verification-ready');
  const heartbeat = path.join(f.dir, 'verification-heartbeat');
  const workerPIDFile = path.join(f.dir, 'verification-worker.pid');
  writeVerificationPackage(f, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(workerPIDFile)},String(process.pid));fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),${HEARTBEAT_INTERVAL_MS})`);
  let dispose;
  let workerPID;
  try {
    dispose = await install(f);
    await sendEdit(f, unrelated, 'unrelated-edit');
    const defaultFile = editStateArtifact(f.workspace, 'default');
    fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
    fs.writeFileSync(defaultFile, '{"sentinel":true}');

    await sendEdit(f, sessionID, `${lifecycleType}-edit`);
    f.push(v2Event(startType, sessionID));
    assert.equal(await waitUntil(() => fs.existsSync(ready) && fs.existsSync(heartbeat) && fs.statSync(heartbeat).size > 0), true,
      'the check is running and has produced a heartbeat before cancellation');
    workerPID = Number(fs.readFileSync(workerPIDFile, 'utf8'));
    assert.ok(Number.isSafeInteger(workerPID) && workerPID > 0, 'the running check process has a valid PID');
    const cleanupBound = process.platform === 'win32'
      ? 3000 // Windows taskkill is awaited by the runner and has no configured SIGTERM grace.
      : VERIFY_KILL_GRACE_MS + HEARTBEAT_INTERVAL_MS * 2 + HEARTBEAT_POLL_MS;
    const lifecycleConsumed = await resolvesWithin(f.push(v2Event(lifecycleType, sessionID)), cleanupBound);
    const processStopped = await waitForProcessStop(workerPID, heartbeat, cleanupBound);

    const actual = {
      lifecycleConsumed,
      sessionRemoved: !fs.existsSync(stateDir(f.workspace, sessionID)),
      unrelatedPreserved: fs.existsSync(editStateArtifact(f.workspace, unrelated)),
      defaultPreserved: fs.existsSync(defaultFile),
      processStopped,
    };
    assert.deepEqual(actual, { lifecycleConsumed: true, sessionRemoved: true, unrelatedPreserved: true, defaultPreserved: true, processStopped: true },
      `flat ${lifecycleType} must cancel a check started by flat ${startType} and reset only ${sessionID}; actual=${JSON.stringify(actual)}`);
  } finally {
    if (workerPID) {
      try { process.kill(workerPID, process.platform === 'win32' ? undefined : 'SIGKILL'); } catch { /* test failure cleanup */ }
    }
    if (dispose) await dispose();
    f.restore();
  }
}

for (const startType of ['session.execution.succeeded']) {
  for (const lifecycleType of ['session.created', 'session.deleted']) {
    test(`V2 consumers α2: flat ${startType} check is cancelled by flat ${lifecycleType}`, { concurrency: false }, async () => {
      await flatLifecycleReset(startType, lifecycleType);
    });
  }
}

test('V2 consumers α2: old same-ID completion cannot clear a recreated session check', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'flat-recreated-session';
  const newReady = path.join(f.dir, 'new-verification-ready');
  const newHeartbeat = path.join(f.dir, 'new-verification-heartbeat');
  const newPIDFile = path.join(f.dir, 'new-verification-worker.pid');
  let startOldPrompt;
  const oldPromptStarted = new Promise(resolve => { startOldPrompt = resolve; });
  let resolveOldPrompt;
  const oldPromptCompletion = new Promise(resolve => { resolveOldPrompt = resolve; });
  f.ctx.session.prompt = async ({ text }) => {
    if (text.includes('first generation failure')) {
      startOldPrompt();
      await oldPromptCompletion;
    }
  };
  writeVerificationPackage(f, "console.error('AssertionError: first generation failure');process.exit(1)");
  let dispose;
  let newPID;
  try {
    dispose = await install(f);
    await sendEdit(f, sessionID, 'old-generation-edit');
    f.push(v2Event('session.execution.succeeded', sessionID));
    assert.equal(await resolvesWithin(oldPromptStarted, 3000), true,
      'the first generation is held in asynchronous follow-up delivery');

    const cleanupBound = process.platform === 'win32' ? 3000
      : VERIFY_KILL_GRACE_MS + HEARTBEAT_INTERVAL_MS * 2 + HEARTBEAT_POLL_MS;
    const oldDeleteConsumed = await resolvesWithin(f.push(v2Event('session.deleted', sessionID)), cleanupBound);
    const recreateConsumed = await resolvesWithin(f.push(v2Event('session.created', sessionID)), cleanupBound);
    writeVerificationPackage(f,
      `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(newPIDFile)},String(process.pid));fs.writeFileSync(${JSON.stringify(newReady)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(newHeartbeat)},'x'),${HEARTBEAT_INTERVAL_MS})`);
    await sendEdit(f, sessionID, 'new-generation-edit');
    f.push(v2Event('session.execution.succeeded', sessionID));
    assert.equal(await waitUntil(() => fs.existsSync(newReady) && fs.existsSync(newHeartbeat) && fs.statSync(newHeartbeat).size > 0), true,
      'the recreated generation starts a check while old completion delivery is pending');
    newPID = Number(fs.readFileSync(newPIDFile, 'utf8'));
    resolveOldPrompt();
    await new Promise(resolve => setImmediate(resolve));

    const newDeleteConsumed = await resolvesWithin(f.push(v2Event('session.deleted', sessionID)), cleanupBound);
    const newProcessStopped = await waitForProcessStop(newPID, newHeartbeat, cleanupBound);
    const actual = {
      oldDeleteConsumed,
      recreateConsumed,
      newDeleteConsumed,
      newSessionRemoved: !fs.existsSync(stateDir(f.workspace, sessionID)),
      newProcessStopped,
    };
    assert.deepEqual(actual, {
      oldDeleteConsumed: true,
      recreateConsumed: true,
      newDeleteConsumed: true,
      newSessionRemoved: true,
      newProcessStopped: true,
    }, `an old same-ID completion must not clear the recreated controller; actual=${JSON.stringify(actual)}`);
  } finally {
    resolveOldPrompt();
    if (newPID) {
      try { process.kill(newPID, process.platform === 'win32' ? undefined : 'SIGKILL'); } catch { /* test failure cleanup */ }
    }
    if (dispose) await dispose();
    f.restore();
  }
});

test('V2 consumers α: flat lifecycle and completion events without an id leave default state untouched', { concurrency: false }, async () => {
  const f = fixture('off');
  const checkLog = path.join(f.dir, 'check-runs.txt');
  writeVerificationPackage(f, `require('node:fs').appendFileSync(${JSON.stringify(checkLog)}, 'check\\n')`);
  const defaultSession = 'default';
  const defaultEdit = editStateArtifact(f.workspace, defaultSession);
  const defaultSentinel = path.join(stateDir(f.workspace, defaultSession), 'sentinel.json');
  let dispose;
  try {
    dispose = await install(f);
    await sendEdit(f, defaultSession, 'default-edit');
    fs.writeFileSync(defaultSentinel, 'keep');
    const defaultBefore = fs.readFileSync(defaultEdit, 'utf8');
    const missingIDEvent = type => ({ id: `evt-${type}-missing-id`, created: Date.now(), type, durable: true, data: {} });

    const flushThrough = async suffix => {
      const sessionID = `flush-${suffix}`;
      const markerFile = editStateArtifact(f.workspace, sessionID);
      fs.mkdirSync(path.dirname(markerFile), { recursive: true });
      fs.writeFileSync(markerFile, '{"sentinel":true}');
      f.push(v2Event('session.created', sessionID));
      assert.equal(await waitUntil(() => !fs.existsSync(stateDir(f.workspace, sessionID))), true,
        'a later valid lifecycle event confirms the missing-id event was consumed');
    };

    f.push(missingIDEvent('session.execution.succeeded'));
    await flushThrough('completion');
    assert.deepEqual({
      defaultEditUnchanged: fs.readFileSync(defaultEdit, 'utf8') === defaultBefore,
      defaultSentinelPreserved: fs.existsSync(defaultSentinel),
      checkNotRun: !fs.existsSync(checkLog),
    }, { defaultEditUnchanged: true, defaultSentinelPreserved: true, checkNotRun: true },
    'execution.succeeded without data.sessionID must not verify the fabricated default session');

    for (const type of ['session.created', 'session.deleted']) {
      f.push(missingIDEvent(type));
      await flushThrough(type);
    }
    assert.deepEqual({
      defaultEditUnchanged: fs.readFileSync(defaultEdit, 'utf8') === defaultBefore,
      defaultSentinelPreserved: fs.existsSync(defaultSentinel),
      checkNotRun: !fs.existsSync(checkLog),
    }, { defaultEditUnchanged: true, defaultSentinelPreserved: true, checkNotRun: true },
    'flat lifecycle events without data.sessionID must not reset the fabricated default session');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('V2 consumers α3: repeated V2 completions and a post-completion duplicate verify one revision once', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'v2-double-completion';
  const checkLog = path.join(f.dir, 'check-runs.txt');
  writeVerificationPackage(f, `require('node:fs').appendFileSync(${JSON.stringify(checkLog)}, 'check\\n')`);
  let dispose;
  try {
    dispose = await install(f);
    const deliveries = [
      { label: 'back-to-back', sequential: false, duplicate: true },
      { label: 'post-completion', sequential: true, duplicate: true },
      { label: 'next-revision-control', sequential: false, duplicate: false },
    ];
    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      await sendEdit(f, sessionID, `success-edit-${i + 1}`);
      const first = f.push({ ...v2Event('session.execution.succeeded', sessionID), id: `evt-a3-pass-${i + 1}-a` });
      if (delivery.sequential) {
        const completed = await waitUntil(() => fs.existsSync(checkLog)
          && fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length === i + 1
          && readJson(editStateArtifact(f.workspace, sessionID)).verificationPending === false);
        assert.equal(completed, true, 'the first end notification completed the check');
        await first;
        await f.push({ ...v2Event('session.execution.succeeded', sessionID), id: `evt-a3-pass-${i + 1}-b` });
      } else if (delivery.duplicate) {
        const second = f.push({ ...v2Event('session.execution.succeeded', sessionID), id: `evt-a3-pass-${i + 1}-b` });
        await Promise.all([first, second]);
      } else {
        await first;
      }
      assert.equal(await waitUntil(() => fs.existsSync(checkLog)
        && fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length >= i + 1
        && readJson(editStateArtifact(f.workspace, sessionID)).verificationPending === false), true,
      `delivery ${delivery.label} completed verification`);
      assert.equal(fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length, i + 1,
        `delivery ${delivery.label} ran one check`);
      assert.equal(readJson(path.join(stateDir(f.workspace, sessionID), 'compliance.json')).verifiedEdits, i + 1,
        'compliance advances once for each new edit revision');
      assert.equal(readJson(editStateArtifact(f.workspace, sessionID)).editsSinceVerification, 0);
    }
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('V2 consumers α3: duplicate completion notifications do not duplicate verification', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'v2-duplicate-completion';
  const checkLog = path.join(f.dir, 'check-runs.txt');
  writeVerificationPackage(f, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(checkLog)},'x\\n');console.error('AssertionError [ERR_ASSERTION]: stable fixture failure');process.exit(1)`);
  let dispose;
  try {
    dispose = await install(f);
    const deliveries = [
      { label: 'back-to-back', sequential: false, duplicate: true },
      { label: 'post-completion', sequential: true, duplicate: true },
      { label: 'next-revision-control', sequential: false, duplicate: false },
    ];
    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      await sendEdit(f, sessionID, `failure-edit-${i + 1}`);
      const first = f.push({ ...v2Event('session.execution.succeeded', sessionID), id: `evt-a3-fail-${i + 1}-a` });
      if (delivery.sequential) {
        assert.equal(await waitUntil(() => readJson(editStateArtifact(f.workspace, sessionID)).followUpPending === true), true,
          'the first end notification delivered its follow-up');
        await first;
        await f.push({ ...v2Event('session.execution.succeeded', sessionID), id: `evt-a3-fail-${i + 1}-b` });
      } else if (delivery.duplicate) {
        const second = f.push({ ...v2Event('session.execution.succeeded', sessionID), id: `evt-a3-fail-${i + 1}-b` });
        await Promise.all([first, second]);
      } else {
        await first;
      }
      assert.equal(await waitUntil(() => fs.existsSync(editStateArtifact(f.workspace, sessionID))
        && readJson(editStateArtifact(f.workspace, sessionID)).followUpPending === true), true,
      `revision ${i + 1} recorded one completed failing check`);
      assert.equal(fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length, i + 1, 'one check ran per edit revision');
      assert.equal(fs.existsSync(path.join(stateDir(f.workspace, sessionID), 'circuit-breaker.json')), false,
        'verification failure does not create recurrence state');
      assert.equal(readJson(path.join(stateDir(f.workspace, sessionID), 'compliance.json')).totalEdits, i + 1,
        'each new edit is recorded once');
    }
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('V2 consumers β1: failed next-prompt identity cannot reuse the previous workspace binding', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'failed-next-prompt';
  const serverWorkspace = makeWorkspace(f, 'server-c');
  const originalCwd = process.cwd();
  let lookups = 0;
  f.ctx.location = undefined;
  f.ctx.directory = undefined;
  f.setSessionLookup(async () => {
    lookups++;
    if (lookups === 1) return { id: sessionID, location: { directory: f.workspace } };
    throw new Error('private lookup detail');
  });
  process.chdir(serverWorkspace);
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-a', prompt: { text: 'first turn in A' } });
    await sendEdit(f, sessionID, 'turn-a-edit');
    const editFile = editStateArtifact(f.workspace, sessionID);
    const complianceFile = path.join(stateDir(f.workspace, sessionID), 'compliance.json');
    const routerFile = routerArtifact(f.workspace, sessionID);
    const observationFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const serverEnforcementFiles = [
      editStateArtifact(serverWorkspace, sessionID),
      path.join(stateDir(serverWorkspace, sessionID), 'compliance.json'),
    ];
    assert.deepEqual({
      editRevision: readJson(editFile).editRevision,
      totalEdits: readJson(complianceFile).totalEdits,
      observationCwd: readJson(observationFile).pending?.cwd,
    }, {
      editRevision: 1,
      totalEdits: 1,
      observationCwd: observations.sha(f.workspace, 16),
    }, 'valid first-turn binding writes surviving edit, compliance and observation state in workspace A');
    const before = {
      edit: fs.readFileSync(editFile, 'utf8'),
      compliance: fs.readFileSync(complianceFile, 'utf8'),
      router: fs.readFileSync(routerFile, 'utf8'),
      observation: fs.readFileSync(observationFile, 'utf8'),
    };

    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-b', prompt: { text: 'next turn has failed identity' } });
    const context = { sessionID, kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    await sendEdit(f, sessionID, 'turn-b-edit');
    await f.push(v2Event('session.execution.succeeded', sessionID));
    await new Promise(resolve => setTimeout(resolve, 100));

    const actual = {
      noStaleContext: context.system.length === 0,
      workspaceAEditUnchanged: fs.readFileSync(editFile, 'utf8') === before.edit,
      workspaceAComplianceUnchanged: fs.readFileSync(complianceFile, 'utf8') === before.compliance,
      workspaceARouterUnchanged: fs.readFileSync(routerFile, 'utf8') === before.router,
      noStaleObservation: fs.readFileSync(observationFile, 'utf8') === before.observation,
      noCompletedObservation: recordList(f.store).length === 0,
      noServerEnforcementState: serverEnforcementFiles.every(file => !fs.existsSync(file)),
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, {
      noStaleContext: true,
      workspaceAEditUnchanged: true,
      workspaceAComplianceUnchanged: true,
      workspaceARouterUnchanged: true,
      noStaleObservation: true,
      noCompletedObservation: true,
      noServerEnforcementState: true,
      noServerWorkspaceState: true,
    }, `failed P2 identity must skip workspace-dependent work; actual=${JSON.stringify(actual)}`);
  } finally {
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('V2 consumers β1 control: a resolved next prompt binds tools only to workspace B', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'resolved-next-prompt';
  const workspaceB = makeWorkspace(f, 'session-b');
  const serverWorkspace = makeWorkspace(f, 'server-c');
  const originalCwd = process.cwd();
  let lookups = 0;
  f.ctx.location = undefined;
  f.ctx.directory = undefined;
  f.setSessionLookup(async () => {
    lookups++;
    return { id: sessionID, location: { directory: lookups === 1 ? f.workspace : workspaceB } };
  });
  process.chdir(serverWorkspace);
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'resolved-turn-a', prompt: { text: 'first turn in A' } });
    await sendEdit(f, sessionID, 'resolved-turn-a-edit');
    const editA = editStateArtifact(f.workspace, sessionID);
    const complianceA = path.join(stateDir(f.workspace, sessionID), 'compliance.json');
    const beforeA = fs.readFileSync(editA, 'utf8');
    const beforeComplianceA = fs.readFileSync(complianceA, 'utf8');

    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'resolved-turn-b', prompt: { text: 'second turn in B' } });
    await sendEdit(f, sessionID, 'resolved-turn-b-edit');
    const pendingFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const serverEnforcementFiles = [
      editStateArtifact(serverWorkspace, sessionID),
      path.join(stateDir(serverWorkspace, sessionID), 'compliance.json'),
    ];
    const actual = {
      workspaceAUnchanged: fs.readFileSync(editA, 'utf8') === beforeA,
      workspaceAComplianceUnchanged: fs.readFileSync(complianceA, 'utf8') === beforeComplianceA,
      workspaceBRevision: readJson(editStateArtifact(workspaceB, sessionID)).editRevision,
      workspaceBTotalEdits: readJson(path.join(stateDir(workspaceB, sessionID), 'compliance.json')).totalEdits,
      observationCwd: readJson(pendingFile).pending.cwd,
      expectedObservationCwd: observations.sha(workspaceB, 16),
      noServerEnforcementState: serverEnforcementFiles.every(file => !fs.existsSync(file)),
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, {
      workspaceAUnchanged: true,
      workspaceAComplianceUnchanged: true,
      workspaceBRevision: 1,
      workspaceBTotalEdits: 1,
      observationCwd: observations.sha(workspaceB, 16),
      expectedObservationCwd: observations.sha(workspaceB, 16),
      noServerEnforcementState: true,
      noServerWorkspaceState: true,
    }, `resolved P2 identity binds only to B; actual=${JSON.stringify(actual)}`);
  } finally {
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('V2 consumers β2: a pending identity makes prior-turn tool events safely skip', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'pending-next-prompt';
  const serverWorkspace = makeWorkspace(f, 'pending-server-c');
  const originalCwd = process.cwd();
  let lookupCount = 0;
  let resolvePending;
  let lookupStarted = false;
  f.ctx.location = undefined;
  f.ctx.directory = undefined;
  f.setSessionLookup(async () => {
    lookupCount++;
    if (lookupCount === 1) return { id: sessionID, location: { directory: f.workspace } };
    return new Promise(resolve => { resolvePending = resolve; lookupStarted = true; });
  });
  process.chdir(serverWorkspace);
  let dispose;
  let pendingPrompt;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-a', prompt: { text: 'first turn in A' } });
    await sendEdit(f, sessionID, 'pending-turn-a-edit');
    const editFile = editStateArtifact(f.workspace, sessionID);
    const complianceFile = path.join(stateDir(f.workspace, sessionID), 'compliance.json');
    const routerFile = routerArtifact(f.workspace, sessionID);
    const observationFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const serverEnforcementFiles = [
      editStateArtifact(serverWorkspace, sessionID),
      path.join(stateDir(serverWorkspace, sessionID), 'compliance.json'),
    ];
    assert.deepEqual({
      editRevision: readJson(editFile).editRevision,
      totalEdits: readJson(complianceFile).totalEdits,
      observationCwd: readJson(observationFile).pending?.cwd,
    }, {
      editRevision: 1,
      totalEdits: 1,
      observationCwd: observations.sha(f.workspace, 16),
    }, 'valid first-turn binding writes surviving edit, compliance and observation state in workspace A');
    const before = {
      edit: fs.readFileSync(editFile, 'utf8'),
      compliance: fs.readFileSync(complianceFile, 'utf8'),
      router: fs.readFileSync(routerFile, 'utf8'),
      observation: fs.readFileSync(observationFile, 'utf8'),
    };

    pendingPrompt = f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-b', prompt: { text: 'identity remains pending' } });
    assert.equal(await waitUntil(() => lookupStarted), true, 'P2 lookup is pending');
    await sendEdit(f, sessionID, 'ambiguous-assistant-tool');
    await f.push(v2Event('session.execution.succeeded', sessionID));
    await new Promise(resolve => setTimeout(resolve, 100));
    const actual = {
      workspaceAEditUnchanged: fs.readFileSync(editFile, 'utf8') === before.edit,
      workspaceAComplianceUnchanged: fs.readFileSync(complianceFile, 'utf8') === before.compliance,
      workspaceARouterUnchanged: fs.readFileSync(routerFile, 'utf8') === before.router,
      noStaleObservation: fs.readFileSync(observationFile, 'utf8') === before.observation,
      noCompletedObservation: recordList(f.store).length === 0,
      noServerEnforcementState: serverEnforcementFiles.every(file => !fs.existsSync(file)),
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, {
      workspaceAEditUnchanged: true,
      workspaceAComplianceUnchanged: true,
      workspaceARouterUnchanged: true,
      noStaleObservation: true,
      noCompletedObservation: true,
      noServerEnforcementState: true,
      noServerWorkspaceState: true,
    }, `an uncorrelated tool or completion event cannot select the old binding while identity is pending; actual=${JSON.stringify(actual)}`);
  } finally {
    if (resolvePending) resolvePending({});
    if (pendingPrompt) await pendingPrompt;
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('V2 consumers β2 control: once a pending identity resolves to workspace B, surviving state writes there only', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'pending-then-resolved';
  const workspaceB = makeWorkspace(f, 'pending-session-b');
  const serverWorkspace = makeWorkspace(f, 'pending-control-server-c');
  const originalCwd = process.cwd();
  let lookupCount = 0;
  let resolvePending;
  let lookupStarted = false;
  f.ctx.location = undefined;
  f.ctx.directory = undefined;
  f.setSessionLookup(async () => {
    lookupCount++;
    if (lookupCount === 1) return { id: sessionID, location: { directory: f.workspace } };
    return new Promise(resolve => { resolvePending = resolve; lookupStarted = true; });
  });
  process.chdir(serverWorkspace);
  let dispose;
  let pendingPrompt;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'pending-ctrl-turn-a', prompt: { text: 'first turn in A' } });
    await sendEdit(f, sessionID, 'pending-ctrl-turn-a-edit');
    const editA = editStateArtifact(f.workspace, sessionID);
    const complianceA = path.join(stateDir(f.workspace, sessionID), 'compliance.json');
    const observationFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const beforeEditA = fs.readFileSync(editA, 'utf8');
    const beforeComplianceA = fs.readFileSync(complianceA, 'utf8');

    pendingPrompt = f.sessionHooks.get('prompt')({ sessionID, messageID: 'pending-ctrl-turn-b', prompt: { text: 'second turn resolves to B' } });
    assert.equal(await waitUntil(() => lookupStarted), true, 'P2 lookup is pending');
    await sendEdit(f, sessionID, 'pending-ctrl-skipped-edit');
    assert.equal(fs.readFileSync(editA, 'utf8'), beforeEditA, 'pending edit does not mutate workspace A');
    assert.equal(fs.existsSync(editStateArtifact(workspaceB, sessionID)), false, 'pending edit does not pre-create workspace B');

    resolvePending({ id: sessionID, location: { directory: workspaceB } });
    await pendingPrompt;
    pendingPrompt = null;
    await sendEdit(f, sessionID, 'pending-ctrl-turn-b-edit');

    const serverEnforcementFiles = [
      editStateArtifact(serverWorkspace, sessionID),
      path.join(stateDir(serverWorkspace, sessionID), 'compliance.json'),
    ];
    const actual = {
      workspaceAEditUnchanged: fs.readFileSync(editA, 'utf8') === beforeEditA,
      workspaceAComplianceUnchanged: fs.readFileSync(complianceA, 'utf8') === beforeComplianceA,
      workspaceBRevision: readJson(editStateArtifact(workspaceB, sessionID)).editRevision,
      workspaceBTotalEdits: readJson(path.join(stateDir(workspaceB, sessionID), 'compliance.json')).totalEdits,
      observationCwd: readJson(observationFile).pending.cwd,
      expectedObservationCwd: observations.sha(workspaceB, 16),
      noServerEnforcementState: serverEnforcementFiles.every(file => !fs.existsSync(file)),
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, {
      workspaceAEditUnchanged: true,
      workspaceAComplianceUnchanged: true,
      workspaceBRevision: 1,
      workspaceBTotalEdits: 1,
      observationCwd: observations.sha(workspaceB, 16),
      expectedObservationCwd: observations.sha(workspaceB, 16),
      noServerEnforcementState: true,
      noServerWorkspaceState: true,
    }, `resolved pending identity binds surviving state only to B; actual=${JSON.stringify(actual)}`);
  } finally {
    if (resolvePending) resolvePending({});
    if (pendingPrompt) await pendingPrompt;
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('V2 consumers β2: a prompt cache miss does not trigger a fallback identity lookup', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'pending-without-binding';
  const workspaceB = makeWorkspace(f, 'fallback-b');
  let lookupCount = 0;
  let resolvePending;
  f.setSessionLookup(async () => {
    lookupCount++;
    if (lookupCount === 1) return new Promise(resolve => { resolvePending = resolve; });
    return { id: sessionID, location: { directory: workspaceB } };
  });
  let dispose;
  let pendingPrompt;
  try {
    dispose = await install(f);
    pendingPrompt = f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-pending', prompt: { text: 'identity is unresolved' } });
    assert.equal(await waitUntil(() => lookupCount === 1 && typeof resolvePending === 'function'), true);
    await sendEdit(f, sessionID, 'cache-miss-tool');
    const actual = {
      lookupCount,
      fallbackWorkspaceState: fs.existsSync(editStateArtifact(workspaceB, sessionID)),
    };
    assert.deepEqual(actual, { lookupCount: 1, fallbackWorkspaceState: false },
      `current unresolved prompt blocks a generic cache-miss lookup; actual=${JSON.stringify(actual)}`);
  } finally {
    if (resolvePending) resolvePending({});
    if (pendingPrompt) await pendingPrompt;
    if (dispose) await dispose();
    f.restore();
  }
});

test('V2 consumers β2: a late session lookup cannot resurrect a deleted session', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'late-lookup-deleted-session';
  let lookupCount = 0;
  let resolvePending;
  let lookupStarted = false;
  f.setSessionLookup(async () => {
    lookupCount++;
    if (lookupCount === 1) return { id: sessionID, location: { directory: f.workspace } };
    return new Promise(resolve => { resolvePending = resolve; lookupStarted = true; });
  });
  let dispose;
  let pendingPrompt;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-a', prompt: { text: 'workspace A' } });
    const routerFile = routerArtifact(f.workspace, sessionID);
    assert.equal(fs.existsSync(routerFile), true, 'P1 published its workspace route');
    pendingPrompt = f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-b', prompt: { text: 'lookup will finish after deletion' } });
    assert.equal(await waitUntil(() => lookupStarted), true, 'P2 lookup is pending');

    f.push(v2Event('session.deleted', sessionID));
    const deleted = await waitUntil(() => !fs.existsSync(routerFile));
    assert.equal(deleted, true, 'the known owner binding resets the session without waiting for P2 lookup');
    resolvePending({ id: sessionID, location: { directory: f.workspace } });
    await pendingPrompt;
    pendingPrompt = null;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(fs.existsSync(routerFile), false, 'the late P2 result cannot republish routing state after deletion');
  } finally {
    if (resolvePending) resolvePending({});
    if (pendingPrompt) await pendingPrompt;
    if (dispose) await dispose();
    f.restore();
  }
});

test('D1 disposal: a held lookup and queued prompt do not construct or publish after abort', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'd1-disposal-late-prompt';
  let releaseLookup;
  let lookupStarted = false;
  f.setSessionLookup(() => {
    if (lookupStarted) return { id: sessionID, location: { directory: f.workspace } };
    return new Promise(resolve => {
      releaseLookup = resolve;
      lookupStarted = true;
    });
  });
  const legacyDir = path.join(f.dir, '.harness-state');
  const legacyFile = path.join(legacyDir, 'migration-witness.json');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(legacyFile, '{"mustRemain":true}');

  let dispose;
  let firstPrompt;
  let queuedPrompt;
  let disposing;
  let firstSettled = false;
  let queuedSettled = false;
  try {
    dispose = await install(f);
    firstPrompt = f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-first', prompt: { text: 'held lookup' },
    });
    firstPrompt.then(() => { firstSettled = true; }, () => { firstSettled = true; });
    assert.equal(await waitUntil(() => lookupStarted), true, 'the first prompt reached the held identity lookup');
    queuedPrompt = f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-queued', prompt: { text: 'queued behind lookup' },
    });
    queuedPrompt.then(() => { queuedSettled = true; }, () => { queuedSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.sessionLookupCount(), 1, 'the next prompt is queued behind the held lookup');

    disposing = dispose();
    releaseLookup({ id: sessionID, location: { directory: f.workspace } });
    await disposing;
    const chainsSettledAtDispose = firstSettled && queuedSettled;
    await Promise.all([firstPrompt, queuedPrompt, disposing]);
    await new Promise(resolve => setImmediate(resolve));

    const promptState = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const actual = {
      factoryNotConstructed: fs.existsSync(legacyFile),
      routerNotStarted: !fs.existsSync(routerArtifact(f.workspace, sessionID)),
      promptNotObserved: !fs.existsSync(promptState),
      lookupCount: f.sessionLookupCount(),
      chainsSettledAtDispose,
    };
    assert.deepEqual(actual, {
      factoryNotConstructed: true,
      routerNotStarted: true,
      promptNotObserved: true,
      lookupCount: 1,
      chainsSettledAtDispose: true,
    }, `disposed prompt chains must settle without publication; actual=${JSON.stringify(actual)}`);
  } finally {
    if (releaseLookup) releaseLookup({});
    if (firstPrompt) await firstPrompt;
    if (queuedPrompt) await queuedPrompt;
    if (dispose) await dispose();
    f.restore();
  }
});

test('D1 disposal: abort before the enforcement continuation does not publish its binding', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'd1-disposal-enforcement-continuation';
  const legacyDir = path.join(f.dir, '.harness-state');
  const legacyFile = path.join(legacyDir, 'migration-witness.json');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(legacyFile, '{"mustMoveOnlyIfConstructed":true}');

  const NativeAbortController = global.AbortController;
  let instrument = false;
  let addedAfterSetup = 0;
  let dispose;
  let disposing;
  let prompt;
  global.AbortController = class extends NativeAbortController {
    constructor() {
      super();
      const addEventListener = this.signal.addEventListener.bind(this.signal);
      this.signal.addEventListener = (type, listener, options) => {
        const result = addEventListener(type, listener, options);
        if (instrument && type === 'abort' && ++addedAfterSetup === 2) {
          queueMicrotask(() => { disposing = dispose(); });
        }
        return result;
      };
    }
  };
  try {
    dispose = await install(f);
    await new Promise(resolve => setImmediate(resolve));
    instrument = true;
    prompt = f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-enforcement', prompt: { text: 'resolve identity then abort at factory handoff' },
    });
    assert.equal(await waitUntil(() => Boolean(disposing)), true, 'the real factory registered its abort listener');
    await Promise.all([prompt, disposing]);

    const actual = {
      factoryWasConstructed: !fs.existsSync(legacyFile),
      routerNotPublished: !fs.existsSync(routerArtifact(f.workspace, sessionID)),
      promptNotObserved: !fs.existsSync(path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`)),
      editStateNotPublished: !fs.existsSync(editStateArtifact(f.workspace, sessionID)),
    };
    assert.deepEqual(actual, {
      factoryWasConstructed: true,
      routerNotPublished: true,
      promptNotObserved: true,
      editStateNotPublished: true,
    }, `the factory continuation must not publish after disposal; actual=${JSON.stringify(actual)}`);
  } finally {
    global.AbortController = NativeAbortController;
    if (prompt) await prompt;
    if (dispose) await dispose();
    f.restore();
  }
});

test('D1 disposal: a running router publishes no context and is reaped before dispose resolves', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'd1-disposal-router-child';
  const preload = path.join(f.dir, 'hold-router-child.cjs');
  const readyFile = path.join(f.dir, 'router-child.pid');
  const outputFile = path.join(f.dir, 'router-child-output-held');
  const closedFile = path.join(f.dir, 'router-child-closed');
  const previousEnv = Object.fromEntries(['NODE_OPTIONS', 'D1_ROUTER_READY', 'D1_ROUTER_OUTPUT', 'D1_ROUTER_CLOSED']
    .map(key => [key, process.env[key]]));
  fs.writeFileSync(preload, [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.D1_ROUTER_READY, String(process.pid));",
    "const write = process.stdout.write.bind(process.stdout);",
    "process.stdout.write = (chunk, ...args) => { fs.appendFileSync(process.env.D1_ROUTER_OUTPUT, String(chunk)); return write(chunk, ...args); };",
    "process.on('SIGTERM', () => setTimeout(() => { try { fs.writeFileSync(process.env.D1_ROUTER_CLOSED, 'closed'); } finally { process.exit(0); } }, 80));",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  process.env.NODE_OPTIONS = `--require=${preload}`;
  process.env.D1_ROUTER_READY = readyFile;
  process.env.D1_ROUTER_OUTPUT = outputFile;
  process.env.D1_ROUTER_CLOSED = closedFile;
  let dispose;
  let prompt;
  let childPID;
  try {
    dispose = await install(f);
    prompt = f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-router-child', prompt: { text: 'hold router output until cleanup' },
    });
    assert.equal(await waitUntil(() => fs.existsSync(readyFile) && fs.existsSync(outputFile)), true,
      'the real router child produced its result but remained alive at the held output boundary');
    assert.ok(fs.readFileSync(outputFile, 'utf8').trim().length > 0, 'the child has a real route result buffered for publication');
    childPID = Number(fs.readFileSync(readyFile, 'utf8'));
    const processAlive = () => {
      try { process.kill(childPID, 0); return true; }
      catch (error) { return error.code !== 'ESRCH'; }
    };
    const context = { sessionID, kind: 'primary', system: [] };
    f.sessionHooks.get('context')(context);
    assert.deepEqual(context.system, [], 'a route is not injected while its child result is pending');

    await dispose();
    const childClosedWhenDisposeResolved = !processAlive();
    await prompt;
    const contextAfterDispose = { sessionID, kind: 'primary', system: [] };
    f.sessionHooks.get('context')(contextAfterDispose);
    const actual = {
      childClosed: !processAlive(),
      childClosedWhenDisposeResolved,
      delayedCloseObserved: process.platform === 'win32' || fs.existsSync(closedFile),
      contextStillEmpty: context.system.length === 0,
      noPostDisposeInjection: contextAfterDispose.system.length === 0,
    };
    assert.deepEqual(actual, {
      childClosed: true,
      childClosedWhenDisposeResolved: true,
      delayedCloseObserved: true,
      contextStillEmpty: true,
      noPostDisposeInjection: true,
    },
      `disposal waits for child cleanup before resolving; actual=${JSON.stringify(actual)}`);
  } finally {
    if (dispose) await dispose();
    if (prompt) await prompt;
    if (childPID && !fs.existsSync(closedFile)) {
      try { process.kill(childPID, 'SIGKILL'); } catch {}
      await waitUntil(() => {
        try { process.kill(childPID, 0); return false; }
        catch (error) { return error.code === 'ESRCH'; }
      }, 1000);
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    f.restore();
  }
});

test('D1 disposal: pending execute.before and execute.after bindings settle without enforcement', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'd1-disposal-pending-tools';
  const legacyDir = path.join(f.dir, '.harness-state');
  const legacyFile = path.join(legacyDir, 'migration-witness.json');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(legacyFile, '{"mustRemain":true}');
  let releaseLookup;
  const lookup = new Promise(resolve => { releaseLookup = resolve; });
  f.setSessionLookup(() => lookup);
  let dispose;
  let before;
  let after;
  let disposing;
  let beforeSettled = false;
  let afterSettled = false;
  try {
    dispose = await install(f);
    const event = { tool: 'edit', sessionID, id: 'd1-tool', input: { filePath: 'changed.js' } };
    before = f.toolHooks.get('execute.before')(event);
    after = f.toolHooks.get('execute.after')({ ...event, status: 'completed', result: {} });
    before.then(() => { beforeSettled = true; }, () => { beforeSettled = true; });
    after.then(() => { afterSettled = true; }, () => { afterSettled = true; });
    assert.equal(await waitUntil(() => f.sessionLookupCount() === 2), true, 'both tool hooks reached their pending binding lookup');

    disposing = dispose();
    releaseLookup({ id: sessionID, location: { directory: f.workspace } });
    await disposing;
    const hooksSettledAtDispose = beforeSettled && afterSettled;
    await Promise.all([before, after, disposing]);
    await new Promise(resolve => setImmediate(resolve));

    const actual = {
      factoryNotConstructed: fs.existsSync(legacyFile),
      editStateNotCreated: !fs.existsSync(editStateArtifact(f.workspace, sessionID)),
      complianceNotCreated: !fs.existsSync(path.join(stateDir(f.workspace, sessionID), 'compliance.json')),
      observationsEmpty: recordList(f.store).length === 0,
      hooksSettledAtDispose,
    };
    assert.deepEqual(actual, {
      factoryNotConstructed: true,
      editStateNotCreated: true,
      complianceNotCreated: true,
      observationsEmpty: true,
      hooksSettledAtDispose: true,
    }, `tool hooks admitted before disposal must not publish after the pending binding; actual=${JSON.stringify(actual)}`);
  } finally {
    releaseLookup({});
    if (before) await before;
    if (after) await after;
    if (dispose) await dispose();
    f.restore();
  }
});

test('D1 disposal: the event consumer settles when its session binding is pending', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'd1-disposal-event-binding';
  const legacyDir = path.join(f.dir, '.harness-state');
  const legacyFile = path.join(legacyDir, 'migration-witness.json');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(legacyFile, '{"mustRemain":true}');
  let releaseLookup;
  let lookupStarted = false;
  f.setSessionLookup(() => new Promise(resolve => {
    releaseLookup = resolve;
    lookupStarted = true;
  }));
  let dispose;
  let consumed;
  let disposing;
  try {
    dispose = await install(f);
    consumed = f.push(v2Event('session.execution.succeeded', sessionID));
    assert.equal(await waitUntil(() => lookupStarted), true, 'the event loop is waiting for its session binding');
    disposing = dispose();
    releaseLookup({ id: sessionID, location: { directory: f.workspace } });
    await disposing;
    const eventConsumerSettledAtDispose = f.eventStreamEnded();
    await consumed;

    const actual = {
      eventConsumerSettled: eventConsumerSettledAtDispose,
      factoryNotConstructed: fs.existsSync(legacyFile),
      noRouteState: !fs.existsSync(routerArtifact(f.workspace, sessionID)),
      lookupCount: f.sessionLookupCount(),
    };
    assert.deepEqual(actual, {
      eventConsumerSettled: true,
      factoryNotConstructed: true,
      noRouteState: true,
      lookupCount: 1,
    }, `dispose drains the event consumer without a late binding; actual=${JSON.stringify(actual)}`);
  } finally {
    if (releaseLookup) releaseLookup({});
    if (consumed) await consumed;
    if (dispose) await dispose();
    f.restore();
  }
});

test('D1 disposal: queued turn delivery cannot complete telemetry or start verification after abort', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'd1-disposal-deferred-delivery';
  const verificationStarted = path.join(f.dir, 'verification-started');
  const editFile = editStateArtifact(f.workspace, sessionID);
  const complianceFile = path.join(stateDir(f.workspace, sessionID), 'compliance.json');
  const telemetryFile = path.join(workspaceState.getWorkspaceStateDir(f.workspace), 'state', 'telemetry', 'events.jsonl');
  const previousTelemetry = process.env.HARNESS_TELEMETRY;
  process.env.HARNESS_TELEMETRY = 'local';
  writeVerificationPackage(f, `require('node:fs').writeFileSync(${JSON.stringify(verificationStarted)}, 'started')`);
  let dispose;
  let consumed;
  let disposing;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-deferred', prompt: { text: 'establish a real binding' },
    });
    const skill = { tool: 'skill', sessionID, id: 'd1-skill', input: { skill: 'ponytail' } };
    await f.toolHooks.get('execute.before')(skill);
    await f.toolHooks.get('execute.after')({ ...skill, status: 'completed', result: {} });
    await sendEdit(f, sessionID, 'd1-edit');
    const editBefore = fs.readFileSync(editFile, 'utf8');
    const complianceBefore = fs.readFileSync(complianceFile, 'utf8');
    assert.ok(fs.readFileSync(telemetryFile, 'utf8').includes('"event":"skill.loaded"'), 'the control created an active telemetry binding');

    f.setBeforeEventConsumed(() => { disposing = dispose(); });
    consumed = f.push(v2Event('session.execution.succeeded', sessionID));
    assert.equal(await waitUntil(() => Boolean(disposing)), true, 'dispose starts after delivery is queued and before its callback');
    await Promise.all([consumed, disposing]);
    const telemetry = fs.readFileSync(telemetryFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const actual = {
      noLateSkillCompletion: !telemetry.some(row => row.event === 'skill.complete' && row.sessionID === sessionID),
      verificationNotStarted: !fs.existsSync(verificationStarted),
      editStateUnchanged: fs.readFileSync(editFile, 'utf8') === editBefore,
      complianceUnchanged: fs.readFileSync(complianceFile, 'utf8') === complianceBefore,
      eventConsumerSettled: f.eventStreamEnded(),
    };
    assert.deepEqual(actual, {
      noLateSkillCompletion: true,
      verificationNotStarted: true,
      editStateUnchanged: true,
      complianceUnchanged: true,
      eventConsumerSettled: true,
    }, `deferred event work is suppressed after abort; actual=${JSON.stringify(actual)}`);
  } finally {
    if (consumed) await consumed;
    if (dispose) await dispose();
    if (previousTelemetry === undefined) delete process.env.HARNESS_TELEMETRY;
    else process.env.HARNESS_TELEMETRY = previousTelemetry;
    f.restore();
  }
});

for (const outcome of ['resolved', 'rejected']) {
  test(`D1 disposal: held completion context ${outcome} cannot publish a late Stop`, { concurrency: false }, async () => {
    const f = fixture();
    const sessionID = `d1-disposal-completion-${outcome}`;
    let finishContext;
    let contextStarted = false;
    f.ctx.session.context = () => {
      contextStarted = true;
      return new Promise((resolve, reject) => {
        finishContext = outcome === 'resolved' ? resolve : reject;
      });
    };
    let dispose;
    let completion;
    let disposing;
    try {
      dispose = await install(f);
      await f.sessionHooks.get('prompt')({
        sessionID, messageID: 'd1-completion', prompt: { text: 'hold completion context across disposal' },
      });
      completion = f.push(v2Event('session.execution.succeeded', sessionID));
      assert.equal(await waitUntil(() => contextStarted), true, 'the completion observation is waiting on host context');

      disposing = dispose();
      if (outcome === 'resolved') finishContext([
        { info: { role: 'user', id: 'd1-completion' }, parts: [{ type: 'text', text: 'held completion context' }] },
        { info: { role: 'assistant', id: 'd1-assistant' }, parts: [{ type: 'text', text: VALID_LABEL }] },
      ]);
      else finishContext(new Error('context unavailable after disposal'));
      await Promise.all([completion, disposing]);

      const actual = {
        completedRecords: recordList(f.store).length,
        pendingTurnRetained: fs.existsSync(path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`)),
      };
      assert.deepEqual(actual, { completedRecords: 0, pendingTurnRetained: true },
        `a disposed completion cannot publish Stop after context ${outcome}; actual=${JSON.stringify(actual)}`);
    } finally {
      if (finishContext && !disposing) finishContext([]);
      if (completion) await completion;
      if (dispose) await dispose();
      f.restore();
    }
  });
}

test('D2 disposal: pending completion context detaches before the host read settles', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'd2-disposal-pending-context';
  let finishContext;
  let contextStarted = false;
  let contextReleased = false;
  const unhandledRejections = [];
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  f.ctx.session.context = () => {
    contextStarted = true;
    return new Promise((resolve, reject) => {
      finishContext = reject;
    });
  };
  let dispose;
  let completion;
  let disposing;
  let deadline;
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd2-completion', prompt: { text: 'detach pending completion context on disposal' },
    });
    completion = f.push(v2Event('session.execution.succeeded', sessionID));
    assert.equal(await waitUntil(() => contextStarted), true, 'the real V2 observer entered the unresolved host read');

    disposing = dispose();
    const settlement = await Promise.race([
      disposing.then(() => 'settled'),
      new Promise(resolve => { deadline = setTimeout(() => resolve('deadline'), 1000); }),
    ]);
    clearTimeout(deadline);
    assert.equal(settlement, 'settled', 'disposal settles while the raw context promise is still unresolved');
    assert.equal(contextReleased, false, 'the raw host read remains unresolved when disposal settles');

    finishContext(new Error('late context failure'));
    contextReleased = true;
    await completion;
    await new Promise(resolve => setImmediate(resolve));

    const actual = {
      completedRecords: recordList(f.store).length,
      pendingTurnRetained: fs.existsSync(path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`)),
      unhandledRejections: unhandledRejections.length,
    };
    assert.deepEqual(actual, { completedRecords: 0, pendingTurnRetained: true, unhandledRejections: 0 },
      `a late context rejection cannot publish Stop, resurrect state, or go unhandled; actual=${JSON.stringify(actual)}`);
  } finally {
    clearTimeout(deadline);
    if (finishContext && !contextReleased) {
      finishContext(new Error('late context failure during cleanup'));
      contextReleased = true;
    }
    if (completion) await completion;
    if (dispose) await dispose();
    process.removeListener('unhandledRejection', onUnhandledRejection);
    f.restore();
  }
});

for (const outcome of ['throw', 'reject']) {
  test(`D2 control: live completion context ${outcome}s still fails open`, { concurrency: false }, async () => {
    const f = fixture();
    const sessionID = `d2-live-context-${outcome}`;
    f.ctx.session.context = () => {
      if (outcome === 'throw') throw new Error('context unavailable');
      return Promise.reject(new Error('context unavailable'));
    };
    let dispose;
    let completion;
    try {
      dispose = await install(f);
      await f.sessionHooks.get('prompt')({
        sessionID, messageID: `d2-${outcome}`, prompt: { text: 'context errors remain fail open while live' },
      });
      completion = f.push(v2Event('session.execution.succeeded', sessionID));
      await waitFor(() => recordList(f.store).length === 1);
      await completion;

      const [record] = recordList(f.store);
      assert.equal(record.host, 'opencode');
      assert.equal(record.writer.sessionId, sessionID);
      assert.equal(record.selfReportReason, 'final-message-unavailable');
    } finally {
      if (dispose) await dispose();
      f.restore();
    }
  });
}

test('D1 disposal: resolved callbacks cannot inject context, admit prompts, or update tool state', { concurrency: false }, async () => {
  const f = fixture();
  const sessionID = 'd1-disposal-after-callbacks';
  const nextSessionID = 'd1-disposal-new-session';
  const promptState = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
  const nextPromptState = path.join(f.store, 'sessions', `${observations.sha(nextSessionID, 32)}.json`);
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-before-dispose', prompt: { text: 'resolve route before teardown' },
    });
    const contextBefore = { sessionID, kind: 'primary', system: [] };
    f.sessionHooks.get('context')(contextBefore);
    assert.ok(contextBefore.system.length > 0, 'the normal resolved route is injectable before disposal');
    await sendEdit(f, sessionID, 'd1-before-dispose-edit');
    const editFile = editStateArtifact(f.workspace, sessionID);
    const complianceFile = path.join(stateDir(f.workspace, sessionID), 'compliance.json');
    const promptStateBefore = fs.readFileSync(promptState, 'utf8');
    const editStateBefore = fs.readFileSync(editFile, 'utf8');
    const complianceBefore = fs.readFileSync(complianceFile, 'utf8');
    const lookupsBefore = f.sessionLookupCount();

    await dispose();
    const contextAfter = { sessionID, kind: 'primary', system: [] };
    f.sessionHooks.get('context')(contextAfter);
    await f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-after-dispose', prompt: { text: 'must not start a new prompt chain' },
    });
    const event = { tool: 'edit', sessionID, id: 'd1-after-dispose-edit', input: { filePath: 'changed.js' } };
    await f.toolHooks.get('execute.before')(event);
    await f.toolHooks.get('execute.after')({ ...event, status: 'completed', result: {} });

    const actual = {
      cachedContextNotInjected: contextAfter.system.length === 0,
      noPromptAdmission: f.sessionLookupCount() === lookupsBefore,
      noNewPromptObservation: !fs.existsSync(nextPromptState),
      existingPromptObservationUnchanged: fs.readFileSync(promptState, 'utf8') === promptStateBefore,
      editStateUnchanged: fs.readFileSync(editFile, 'utf8') === editStateBefore,
      complianceUnchanged: fs.readFileSync(complianceFile, 'utf8') === complianceBefore,
      eventConsumerSettled: f.eventStreamEnded(),
    };
    assert.deepEqual(actual, {
      cachedContextNotInjected: true,
      noPromptAdmission: true,
      noNewPromptObservation: true,
      existingPromptObservationUnchanged: true,
      editStateUnchanged: true,
      complianceUnchanged: true,
      eventConsumerSettled: true,
    }, `post-disposal callbacks stay closed; actual=${JSON.stringify(actual)}`);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('D1 disposal: a queued session deletion still cleans active work after abort', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'd1-disposal-admitted-delete';
  const ready = path.join(f.dir, 'delete-verification-ready');
  const heartbeat = path.join(f.dir, 'delete-verification-heartbeat');
  writeVerificationPackage(f, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20)`);
  let dispose;
  let idleConsumed;
  let deleteConsumed;
  let disposing;
  let promptCalls = 0;
  f.ctx.session.prompt = async () => { promptCalls++; return {}; };
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({
      sessionID, messageID: 'd1-delete', prompt: { text: 'start a real bound session' },
    });
    await sendEdit(f, sessionID, 'd1-delete-edit');
    idleConsumed = f.push(v2Event('session.execution.succeeded', sessionID));
    assert.equal(await waitUntil(() => fs.existsSync(ready) && fs.existsSync(heartbeat)), true,
      'the V2 completion started real verification work');
    await idleConsumed;

    deleteConsumed = f.push(v2Event('session.deleted', sessionID));
    queueMicrotask(() => { disposing = dispose(); });
    assert.equal(await waitUntil(() => Boolean(disposing)), true, 'dispose starts after reset delivery is queued');
    await Promise.all([deleteConsumed, disposing]);
    const heartbeatAtClose = fs.statSync(heartbeat).size;
    await new Promise(resolve => setTimeout(resolve, 100));

    const actual = {
      sessionStateRemoved: !fs.existsSync(stateDir(f.workspace, sessionID)),
      verificationChildStopped: fs.statSync(heartbeat).size === heartbeatAtClose,
      noFollowUpPrompt: promptCalls === 0,
      eventConsumerSettled: f.eventStreamEnded(),
    };
    assert.deepEqual(actual, {
      sessionStateRemoved: true,
      verificationChildStopped: true,
      noFollowUpPrompt: true,
      eventConsumerSettled: true,
    }, `cleanup already admitted before abort still completes; actual=${JSON.stringify(actual)}`);
  } finally {
    if (idleConsumed) await idleConsumed;
    if (deleteConsumed) await deleteConsumed;
    if (dispose) await dispose();
    f.restore();
  }
});

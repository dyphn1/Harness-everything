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
const VALID_LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix","test"],"workflow":"iterative-single","skills":["tdd"]} -->';
const SECOND_LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["edit"],"workflow":"iterative-single","skills":[]} -->';

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
            if (events.length) return Promise.resolve({ value: events.shift(), done: false });
            if (signal.aborted) return Promise.resolve({ done: true });
            return new Promise(resolve => {
              waiters.push(resolve);
              signal.addEventListener('abort', () => resolve({ done: true }), { once: true });
            });
          },
        }),
      }),
    },
  };
  const push = event => {
    const waiter = waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else events.push(event);
  };

  return {
    dir, workspace, store, ctx, sessionHooks, toolHooks, push,
    setFinal(text) { finalText = text; },
    setSessionLookup(lookup) { sessionLookup = lookup; },
    sessionLookupCount() { return sessionLookups; },
    restore() {
      for (const [key, value] of Object.entries(envBefore)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function install(f) {
  const mod = await import(pathToFileURL(PLUGIN).href);
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
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function waitUntil(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return true;
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

function completionEvent(kind, sessionID) {
  return kind === 'idle'
    ? { type: 'session.idle', sessionID }
    : v2Event('session.execution.succeeded', sessionID);
}

test('inject: the documented OpenCode hooks deliver the kernel router output and exact label line', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'), 'setup registers prompt admission');
    assert.ok(f.sessionHooks.has('context'), 'setup registers the system context transform');
    const prompt = { sessionID: 'inject-session', messageID: 'inject-turn', prompt: { text: 'add a small behavior change' } };
    await f.sessionHooks.get('prompt')(prompt);
    const context = { sessionID: 'inject-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    assert.equal(prompt.prompt.text, 'add a small behavior change', 'injection leaves the persisted user prompt unchanged');
    const injected = context.system.map(part => part.text || '').join('\n');
    assert.match(injected, /=> ROUTER WORKFLOW PLAN/);

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

    dispose = await install(f);
    const prompt = { sessionID: 'runtime-session', messageID: 'runtime-turn', prompt: { text: 'add a small behavior change' } };
    await f.sessionHooks.get('prompt')(prompt);
    const context = { sessionID: 'runtime-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    const injected = context.system.map(part => part.text || '').join('\n');
    assert.match(injected, /=> ROUTER WORKFLOW PLAN/, 'the router ran on Node despite a non-Node host binary');
  } finally {
    if (dispose) await dispose();
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true, writable: true });
    if (hadBun) Object.defineProperty(process.versions, 'bun', { value: originalBun, configurable: true });
    else delete process.versions.bun;
    f.restore();
  }
});

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
    f.push({ type: 'session.idle', sessionID: 'record-session' });
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
    f.push({ type: 'session.created', sessionID });
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
    f.push({ type: 'session.idle', sessionID: 'malformed-opencode' });
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
    f.push({ type: 'session.idle', sessionID: 'optout-session' });
    await new Promise(resolve => setTimeout(resolve, 50));
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

test('control: a legacy session.idle and a V2 session.execution.succeeded for one turn record it once', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    await f.sessionHooks.get('prompt')({ sessionID: 'dedupe', messageID: 'dedupe-1', prompt: { text: 'dedupe the turn end' } });
    f.push(v2Event('session.execution.succeeded', 'dedupe'));
    f.push({ type: 'session.idle', sessionID: 'dedupe' });
    await waitFor(() => recordList(f.store).length === 1);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(recordList(f.store).length, 1, 'the same turn must not be recorded twice');
    assert.equal(recordList(f.store)[0].selfReportReason, null);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('control: the V1 HarnessEnforcement factory export remains available', { concurrency: false }, async () => {
  const mod = await import(pathToFileURL(PLUGIN).href);
  assert.equal(typeof mod.HarnessEnforcement, 'function');
  assert.equal(typeof mod.default.setup, 'function');
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

async function flatLifecycleReset(type) {
  const f = fixture('off');
  const sessionID = `flat-reset-${type}`;
  const unrelated = 'unrelated-session';
  const ready = path.join(f.dir, 'verification-ready');
  const heartbeat = path.join(f.dir, 'verification-heartbeat');
  writeVerificationPackage(f, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20)`);
  let dispose;
  try {
    dispose = await install(f);
    await sendEdit(f, unrelated, 'unrelated-edit');
    const defaultFile = editStateArtifact(f.workspace, 'default');
    fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
    fs.writeFileSync(defaultFile, '{"sentinel":true}');

    await sendEdit(f, sessionID, `${type}-edit`);
    f.push(completionEvent('idle', sessionID));
    assert.equal(await waitUntil(() => fs.existsSync(ready)), true, 'legacy idle started the deliberately pending check');
    f.push(completionEvent('succeeded', sessionID));
    await new Promise(resolve => setTimeout(resolve, 50));
    f.push(v2Event(type, sessionID));
    await new Promise(resolve => setTimeout(resolve, 250));
    const heartbeatAtReset = fs.existsSync(heartbeat) ? fs.statSync(heartbeat).size : 0;
    await new Promise(resolve => setTimeout(resolve, 120));

    const actual = {
      sessionRemoved: !fs.existsSync(stateDir(f.workspace, sessionID)),
      unrelatedPreserved: fs.existsSync(editStateArtifact(f.workspace, unrelated)),
      defaultPreserved: fs.existsSync(defaultFile),
      processStopped: fs.existsSync(heartbeat) && fs.statSync(heartbeat).size === heartbeatAtReset,
    };
    assert.deepEqual(actual, { sessionRemoved: true, unrelatedPreserved: true, defaultPreserved: true, processStopped: true },
      `flat ${type} must reset/cancel only ${sessionID}; actual=${JSON.stringify(actual)}`);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
}

test('V2 consumers α2: flat session.created cancels and resets only its bound session', { concurrency: false }, async () => {
  await flatLifecycleReset('session.created');
});

test('V2 consumers α2: flat session.deleted cancels and resets only its bound session', { concurrency: false }, async () => {
  await flatLifecycleReset('session.deleted');
});

test('V2 consumers α3: both completion orders and a post-completion counterpart verify one revision once', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'v2-double-completion';
  const checkLog = path.join(f.dir, 'check-runs.txt');
  writeVerificationPackage(f, `require('node:fs').appendFileSync(${JSON.stringify(checkLog)}, 'check\\n')`);
  let dispose;
  try {
    dispose = await install(f);
    const orders = [
      { first: 'succeeded', second: 'idle', sequential: false },
      { first: 'idle', second: 'succeeded', sequential: false },
      { first: 'idle', second: 'succeeded', sequential: true },
    ];
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      await sendEdit(f, sessionID, `success-edit-${i + 1}`);
      f.push(completionEvent(order.first, sessionID));
      if (order.sequential) {
        const completed = await waitUntil(() => fs.existsSync(checkLog)
          && fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length === i + 1
          && readJson(editStateArtifact(f.workspace, sessionID)).verificationPending === false);
        assert.equal(completed, true, 'the first end notification completed the check');
        f.push(completionEvent(order.second, sessionID));
      } else {
        f.push(completionEvent(order.second, sessionID));
      }
      await waitUntil(() => fs.existsSync(checkLog)
        && fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length >= i + 1);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length, i + 1,
        `completion pair ${order.first}/${order.second} ran one check`);
      assert.equal(readJson(path.join(stateDir(f.workspace, sessionID), 'compliance.json')).verifiedEdits, i + 1,
        'compliance advances once for each new edit revision');
      assert.equal(readJson(editStateArtifact(f.workspace, sessionID)).editsSinceVerification, 0);
    }
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('V2 consumers α3: duplicate completion notifications do not advance Rule-of-3', { concurrency: false }, async () => {
  const f = fixture('off');
  const sessionID = 'v2-rule-of-three';
  const checkLog = path.join(f.dir, 'check-runs.txt');
  writeVerificationPackage(f, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(checkLog)},'x\\n');console.error('AssertionError [ERR_ASSERTION]: stable fixture failure');process.exit(1)`);
  let dispose;
  try {
    dispose = await install(f);
    const orders = [
      { first: 'succeeded', second: 'idle', sequential: false },
      { first: 'idle', second: 'succeeded', sequential: false },
      { first: 'idle', second: 'succeeded', sequential: true },
    ];
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      await sendEdit(f, sessionID, `failure-edit-${i + 1}`);
      f.push(completionEvent(order.first, sessionID));
      if (order.sequential) {
        assert.equal(await waitUntil(() => readJson(editStateArtifact(f.workspace, sessionID)).followUpPending === true), true,
          'the first end notification delivered its follow-up');
        f.push(completionEvent(order.second, sessionID));
      } else {
        f.push(completionEvent(order.second, sessionID));
      }
      assert.equal(await waitUntil(() => fs.existsSync(editStateArtifact(f.workspace, sessionID))
        && readJson(editStateArtifact(f.workspace, sessionID)).followUpPending === true), true,
      `revision ${i + 1} recorded one completed failing check`);
      const breaker = readJson(path.join(stateDir(f.workspace, sessionID), 'circuit-breaker.json'));
      const count = Object.values(breaker.failures)[0]?.count;
      assert.equal(count, i + 1, `duplicate completion for revision ${i + 1} does not add a failure`);
      assert.equal(breaker.reflectionPending, i === 2, 'reflection is forced only on the third separate failed revision');
      assert.equal(fs.readFileSync(checkLog, 'utf8').trim().split(/\r?\n/).length, i + 1, 'one check ran per edit revision');
      assert.equal(readJson(path.join(stateDir(f.workspace, sessionID), 'compliance.json')).circuitBreakerTrips, i === 2 ? 1 : 0);
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
    const captureFile = path.join(stateDir(f.workspace, sessionID), 'opencode-captures.jsonl');
    const observationFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const before = {
      edit: fs.readFileSync(editFile, 'utf8'),
      compliance: fs.readFileSync(path.join(stateDir(f.workspace, sessionID), 'compliance.json'), 'utf8'),
      capture: fs.readFileSync(captureFile, 'utf8'),
      observation: fs.readFileSync(observationFile, 'utf8'),
    };

    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-b', prompt: { text: 'next turn has failed identity' } });
    const context = { sessionID, kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    await sendEdit(f, sessionID, 'turn-b-edit');
    f.push(v2Event('session.execution.succeeded', sessionID));
    await new Promise(resolve => setTimeout(resolve, 100));

    const actual = {
      noStaleContext: context.system.length === 0,
      workspaceAUnchanged: fs.readFileSync(editFile, 'utf8') === before.edit
        && fs.readFileSync(path.join(stateDir(f.workspace, sessionID), 'compliance.json'), 'utf8') === before.compliance,
      noStaleCapture: fs.readFileSync(captureFile, 'utf8') === before.capture,
      noStaleObservation: fs.readFileSync(observationFile, 'utf8') === before.observation,
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, {
      noStaleContext: true, workspaceAUnchanged: true, noStaleCapture: true, noStaleObservation: true, noServerWorkspaceState: true,
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
    const beforeA = fs.readFileSync(editA, 'utf8');

    await f.sessionHooks.get('prompt')({ sessionID, messageID: 'resolved-turn-b', prompt: { text: 'second turn in B' } });
    await sendEdit(f, sessionID, 'resolved-turn-b-edit');
    const pendingFile = path.join(f.store, 'sessions', `${observations.sha(sessionID, 32)}.json`);
    const actual = {
      workspaceAUnchanged: fs.readFileSync(editA, 'utf8') === beforeA,
      workspaceBRevision: readJson(editStateArtifact(workspaceB, sessionID)).editRevision,
      observationCwd: readJson(pendingFile).pending.cwd,
      expectedObservationCwd: observations.sha(workspaceB, 16),
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, {
      workspaceAUnchanged: true,
      workspaceBRevision: 1,
      observationCwd: observations.sha(workspaceB, 16),
      expectedObservationCwd: observations.sha(workspaceB, 16),
      noServerWorkspaceState: true,
    }, `resolved P2 identity binds only to B; actual=${JSON.stringify(actual)}`);
  } finally {
    if (dispose) await dispose();
    process.chdir(originalCwd);
    f.restore();
  }
});

test('V2 consumers β2: a pending identity makes prior-turn tool events safely skip', { concurrency: false }, async () => {
  const f = fixture('off');
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
    const captureFile = path.join(stateDir(f.workspace, sessionID), 'opencode-captures.jsonl');
    const beforeEdit = fs.readFileSync(editFile, 'utf8');
    const beforeCapture = fs.readFileSync(captureFile, 'utf8');

    pendingPrompt = f.sessionHooks.get('prompt')({ sessionID, messageID: 'user-turn-b', prompt: { text: 'identity remains pending' } });
    assert.equal(await waitUntil(() => lookupStarted), true, 'P2 lookup is pending');
    await sendEdit(f, sessionID, 'ambiguous-assistant-tool');
    const actual = {
      workspaceAUnchanged: fs.readFileSync(editFile, 'utf8') === beforeEdit,
      noStaleCapture: fs.readFileSync(captureFile, 'utf8') === beforeCapture,
      noServerWorkspaceState: !fs.existsSync(routerArtifact(serverWorkspace, sessionID)),
    };
    assert.deepEqual(actual, { workspaceAUnchanged: true, noStaleCapture: true, noServerWorkspaceState: true },
      `an uncorrelated tool messageID cannot select the old binding; actual=${JSON.stringify(actual)}`);
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

    f.push({ type: 'session.deleted', properties: { sessionID } });
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

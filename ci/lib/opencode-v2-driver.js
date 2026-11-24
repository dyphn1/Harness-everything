'use strict';

// Shared OpenCode V2 test driver (#453). Drives the plugin only through its
// default definition: `default.setup(ctx)` with a host-shaped ctx. It never
// imports or calls any named factory and writes no plugin state by hand.
//
//   const d = await createV2Driver({ plugin?, workspace?, scripts?, sessionLookup? });
//   d.toolHook('execute.before')   -> registered callback (also d.toolHooks Map)
//   d.sessionHook('prompt')        -> registered callback (also d.sessionHooks Map)
//   d.emit('session.execution.succeeded', 's1', extra) -> V2 envelope pushed onto the stream
//   d.prompts                      -> recorded ctx.session.prompt inputs {sessionID, text}
//   d.waitFor(pred, {label, timeoutMs}) -> poll an effect with a deadline (rejects with diagnostics)
//   d.settled({quietMs})           -> consumption + quiescence, for "nothing happened" assertions
//   d.teardown()                   -> dispose setup, end the stream, restore env, remove temp dir

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const ENV_KEYS = ['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS'];
const DEFAULT_TIMEOUT_MS = 5000;
const POLL_MS = 10;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// OpenCode 2.x events are flat: {id, created, type, durable, data:{sessionID,...}}.
function v2Event(type, sessionID, data = {}) {
  return { id: `evt-${type}-${sessionID}-${Date.now()}`, created: Date.now(), type, durable: true, data: { sessionID, ...data } };
}

async function createV2Driver(options = {}) {
  const pluginPath = path.resolve(options.plugin || DEFAULT_PLUGIN);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-v2-driver-'));
  // Canonicalise (macOS /var -> /private/var, Windows short names) so the
  // workspace the host reports matches the key the plugin derives.
  const canonicalRoot = fs.realpathSync.native(tempRoot);
  const workspace = options.workspace ? path.resolve(options.workspace) : path.join(canonicalRoot, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const stateHome = path.join(canonicalRoot, 'harness-state');
  if (options.scripts) {
    fs.writeFileSync(path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: options.scripts }, null, 2));
  }

  const envBefore = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  process.env.HOME = canonicalRoot;
  process.env.USERPROFILE = canonicalRoot;
  process.env.HARNESS_STATE_HOME = stateHome;
  process.env.HARNESS_OBSERVATIONS_DIR = path.join(canonicalRoot, 'observations');
  process.env.HARNESS_OBSERVATIONS = options.observations || 'off';
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };

  const prompts = [];
  const toolHooks = new Map();
  const sessionHooks = new Map();
  const queue = [];
  let wake = null;
  let activity = 0;
  let consumed = 0;
  let subscribeCount = 0;
  let streamEnded = false;
  const sessionLookup = options.sessionLookup
    || (async ({ sessionID }) => ({ id: sessionID, location: { directory: workspace } }));

  const ctx = {
    location: { directory: workspace },
    tool: {
      hook: async (name, callback) => {
        toolHooks.set(name, async event => { activity++; return callback(event); });
        return { dispose: async () => { toolHooks.delete(name); } };
      },
    },
    session: {
      get: async input => { activity++; return sessionLookup(input); },
      prompt: async input => { activity++; prompts.push(input); return {}; },
      hook: async (name, callback) => {
        sessionHooks.set(name, async event => { activity++; return callback(event); });
        return { dispose: async () => { sessionHooks.delete(name); } };
      },
      context: async () => [],
    },
    event: {
      subscribe: ({ signal }) => {
        subscribeCount++;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              while (!queue.length) {
                if (signal.aborted) { streamEnded = true; return { done: true, value: undefined }; }
                await new Promise(resolve => {
                  const onAbort = () => resolve();
                  wake = () => { signal.removeEventListener('abort', onAbort); resolve(); };
                  signal.addEventListener('abort', onAbort, { once: true });
                });
                wake = null;
              }
              consumed++;
              activity++;
              return { done: false, value: queue.shift() };
            },
            return: async () => { streamEnded = true; return { done: true, value: undefined }; },
          }),
        };
      },
    },
  };

  const mod = await import(pathToFileURL(pluginPath).href);
  const definition = mod.default;
  const disposeSetup = await definition.setup(ctx);

  const diagnostics = () => `prompts=${prompts.length}; queued=${queue.length}; consumed=${consumed}; streamEnded=${streamEnded}; hooks=${[...toolHooks.keys(), ...sessionHooks.keys()].join(',')}`;

  async function waitFor(predicate, { label = 'effect', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`V2 driver: ${label} did not occur within ${timeoutMs}ms (${diagnostics()})`);
      await sleep(POLL_MS);
    }
  }

  let tornDown = false;
  return {
    workspace, stateHome, definition, prompts, toolHooks, sessionHooks,
    toolHook: name => toolHooks.get(name),
    sessionHook: name => sessionHooks.get(name),
    subscribeCount: () => subscribeCount,
    eventStreamEnded: () => streamEnded,
    emit(type, sessionID, data) {
      queue.push(v2Event(type, sessionID, data));
      if (wake) wake();
    },
    waitFor,
    // Waits until queued events are consumed, then until no hook/prompt/session
    // activity occurs for `quietMs`. Proves "nothing (more) happened" within
    // a bounded window; use waitFor() for positive effects.
    async settled({ quietMs = 200, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      await waitFor(() => queue.length === 0, { label: 'event queue drain', timeoutMs });
      const deadline = Date.now() + timeoutMs;
      let last = -1;
      let since = Date.now();
      while (Date.now() - since < quietMs) {
        if (Date.now() > deadline) throw new Error(`V2 driver: did not become quiet within ${timeoutMs}ms (${diagnostics()})`);
        if (activity !== last) { last = activity; since = Date.now(); }
        await sleep(POLL_MS);
      }
    },
    async teardown() {
      if (tornDown) return;
      tornDown = true;
      try {
        if (typeof disposeSetup === 'function') await disposeSetup();
        await waitFor(() => streamEnded, { label: 'event stream end' });
      } finally {
        restoreEnv();
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

module.exports = { createV2Driver, v2Event, DEFAULT_PLUGIN };

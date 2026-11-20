const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');

console.log('\n[2p] opencode 2.x default-export entrypoint: registration and firing behavior...');

// OpenCode 2.x requires a default export { id, setup } that registers hooks
// through ctx.tool.hook / ctx.event.subscribe. The named V1 factory still
// exists for OpenCode 1 hosts and the mechanism tests; this test covers the
// V2 adapter that the real host actually loads.

helper.check(
  '2p. the plugin entrypoint resolves the canonical router and observations runtime from the source checkout',
  fs.existsSync(path.join(helper.root, 'opencode-plugin', 'index.mjs'))
    && fs.existsSync(path.join(helper.root, 'harness-everything', 'scripts', 'kernel-router.js'))
    && fs.existsSync(path.join(helper.root, 'hooks', 'scripts', 'lib', 'observations.js')),
  'plugin entrypoint or shared runtime missing'
);

(async () => {
  // Isolate state exactly like mechanism-2n: HOME -> temp, no HARNESS_STATE_HOME.
  delete process.env.HARNESS_STATE_HOME;
  const fakeHome = helper.tempDir('.mechanism-test-opencode-v2-home');
  const workspace = helper.tempDir('.mechanism-test-opencode-v2-workspace');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  // Mirrors the plugin getWorkspaceKey(): cwd-realpath + slug + 12-char sha1.
  const realWorkspace = fs.realpathSync(path.resolve(workspace));
  const slug = realWorkspace.split(path.sep).pop().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  const stateRoot = path.join(fakeHome, '.agents', 'harness-everything', 'workspaces', `${slug}-${hash}`, 'state', 'sessions');

  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: 'node -e "process.exit(1)"' } }, null, 2)
  );

  const prompts = [];
  const registered = [];
  const sessionHooks = [];
  let subscribeCount = 0;
  let consumedEvents = 0;
  const eventQueue = [];
  const fakeCtx = {
    location: { directory: workspace },
    tool: {
      hook: async (name, callback) => {
        registered.push({ name, callback });
        return { dispose: async () => {} };
      },
    },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: workspace } }),
      prompt: async (input) => {
        prompts.push(input);
        return {};
      },
      hook: async (name, callback) => {
        sessionHooks.push({ name, callback });
        return { dispose: async () => {} };
      },
      context: async () => [],
    },
    event: {
      subscribe: (options) => {
        subscribeCount++;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              while (eventQueue.length === 0) {
                if (options.signal.aborted) return { done: true, value: undefined };
                await new Promise((resolve) => setTimeout(resolve, 5));
              }
              consumedEvents++;
              return { done: false, value: eventQueue.shift() };
            },
          }),
        };
      },
    },
  };

  const push = (event) => eventQueue.push(event);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) {
        const editState = path.join(stateRoot, 's1', 'edit-state.json');
        throw new Error(`V2 async verification did not settle: prompts=${prompts.length}; consumedEvents=${consumedEvents}; queued=${eventQueue.length}; editState=${fs.existsSync(editState) ? fs.readFileSync(editState, 'utf8') : 'missing'}`);
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };

  const mod = await import(pathToFileURL(path.join(helper.root, 'opencode-plugin', 'index.mjs')).href);
  const definition = mod.default;

  helper.check(
    '2p. the module default-exports an OpenCode 2 definition with a string id and setup function',
    definition && typeof definition.setup === 'function' && typeof definition.id === 'string' && definition.id.length > 0,
    `default export keys: ${JSON.stringify(definition && Object.keys(definition))}`
  );

  helper.check(
    '2p. the module still exports the V1 HarnessEnforcement factory for OpenCode 1 hosts and tests',
    typeof mod.HarnessEnforcement === 'function',
    `exports: ${Object.keys(mod).join(', ')}`
  );

  await definition.setup(fakeCtx);

  helper.check(
    '2p. setup registers the V2 tool hooks under their OpenCode 2 names',
    registered.some((r) => r.name === 'execute.before') && registered.some((r) => r.name === 'execute.after'),
    JSON.stringify(registered.map((r) => r.name))
  );

  helper.check(
    '2p. setup registers documented prompt admission and model context hooks',
    sessionHooks.some((r) => r.name === 'prompt') && sessionHooks.some((r) => r.name === 'context'),
    JSON.stringify(sessionHooks.map((r) => r.name))
  );

  helper.check('2p. setup subscribes to the event stream exactly once', subscribeCount === 1, `subscribes: ${subscribeCount}`);

  const before = registered.find((r) => r.name === 'execute.before').callback;
  const after = registered.find((r) => r.name === 'execute.after').callback;

  // Flow 1: repeated failures use real V2 event shapes and leave edits available:
  // execute.before/after carry {tool, sessionID, id, input}; the event stream
  // carries flat {type, sessionID}.
  const sessionDir = path.join(stateRoot, 's1');
  for (let i = 1; i <= 3; i++) {
    await before({ tool: 'edit', sessionID: 's1', id: `before-${i}`, input: {} });
    await after({ tool: 'edit', sessionID: 's1', id: `c${i}`, input: {} });
    push({ type: 'session.idle', sessionID: 's1' });
    await waitFor(() => prompts.length === i);
  }

  helper.check(
    '2p. three v2-shaped edit/idle cycles send verification reminders',
    prompts.length === 3,
    `prompts: ${prompts.length}`
  );

  helper.check(
    '2p. the V2 ctx.session.prompt receives {sessionID, text}, not the V1 {path, body} shape',
    prompts.every((p) => typeof p.sessionID === 'string' && typeof p.text === 'string'
      && /verification failed/i.test(p.text) && !/reflection token|## Goal|forced reflection|retries before/i.test(p.text)),
    JSON.stringify(prompts)
  );

  helper.check(
    '2p. repeated failures create no breaker state',
    !fs.existsSync(path.join(sessionDir, 'circuit-breaker.json')),
    sessionDir
  );

  let nextEditAllowed = true;
  try {
    await before({ tool: 'edit', sessionID: 's1', id: 'after-threshold', input: {} });
  } catch {
    nextEditAllowed = false;
  }
  if (nextEditAllowed) {
    await after({ tool: 'edit', sessionID: 's1', id: 'after-threshold-ran', input: { filePath: path.join(workspace, 'after-threshold.js') } });
  }
  helper.check('2p. the next v2-shaped edit remains available after the former threshold', nextEditAllowed);
  helper.check('2p. the permitted next edit reaches the V2 after hook',
    nextEditAllowed && JSON.parse(fs.readFileSync(path.join(sessionDir, 'edit-state.json'), 'utf8')).editRevision === 4,
    sessionDir);

  // A pre-retirement pending token is inert at the V2 adapter seam.
  const legacyDir = path.join(stateRoot, 'legacy-pending');
  const legacyBreakerFile = path.join(legacyDir, 'circuit-breaker.json');
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyState = JSON.stringify({
    failures: { old: { count: 3, firstSeen: 1, lastSeen: 2 } },
    reflectionPending: true, reflectionRequestedAt: 2, reflectionToken: 'old-token', reflectionSignature: 'old'
  }, null, 2);
  fs.writeFileSync(legacyBreakerFile, legacyState);
  let legacyEditAllowed = true;
  try {
    await before({ tool: 'edit', sessionID: 'legacy-pending', id: 'legacy-edit', input: {} });
  } catch {
    legacyEditAllowed = false;
  }
  if (legacyEditAllowed) {
    await after({ tool: 'edit', sessionID: 'legacy-pending', id: 'legacy-edit-after', input: { filePath: path.join(workspace, 'legacy.js') } });
  }
  helper.check(
    '2p. legacy pending token state stays inert and the V2 edit completes',
    legacyEditAllowed && fs.readFileSync(legacyBreakerFile, 'utf8') === legacyState
      && fs.existsSync(path.join(legacyDir, 'edit-state.json')),
    legacyDir
  );

  // Flow 3: session reset through the flat V2 event shape.
  await after({ tool: 'edit', sessionID: 'reset', id: 'reset-edit', input: {} });
  helper.check('2p. an edit created state for its session before the reset probe', fs.existsSync(path.join(stateRoot, 'reset', 'edit-state.json')), 'state/reset');
  push({ type: 'session.created', sessionID: 'reset' });
  await settle();
  helper.check(
    '2p. a flat v2 session.created event resets that session state',
    !fs.existsSync(path.join(stateRoot, 'reset', 'edit-state.json')),
    'edit-state.json survived the reset'
  );

  helper.finish();
})().catch((err) => {
  console.error('2p. opencode v2 entrypoint test crashed:', err);
  process.exit(1);
});

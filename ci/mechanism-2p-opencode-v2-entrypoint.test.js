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
  '2p. the plugin ships as a single self-contained module',
  fs.existsSync(path.join(helper.root, 'opencode-plugin', 'index.mjs')),
  'index.mjs missing'
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
  let subscribeCount = 0;
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
      prompt: async (input) => {
        prompts.push(input);
        return {};
      },
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
              return { done: false, value: eventQueue.shift() };
            },
          }),
        };
      },
    },
  };

  const push = (event) => eventQueue.push(event);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

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

  helper.check('2p. setup subscribes to the event stream exactly once', subscribeCount === 1, `subscribes: ${subscribeCount}`);

  const before = registered.find((r) => r.name === 'execute.before').callback;
  const after = registered.find((r) => r.name === 'execute.after').callback;

  // Flow 1: a failure loop drives verification through real V2 event shapes:
  // execute.before/after carry {tool, sessionID, id, input}; the event stream
  // carries flat {type, sessionID}.
  const sessionDir = path.join(stateRoot, 's1');
  for (let i = 1; i <= 3; i++) {
    await after({ tool: 'edit', sessionID: 's1', id: `c${i}`, input: {} });
    push({ type: 'session.idle', sessionID: 's1' });
    await settle();
  }

  helper.check(
    '2p. three v2-shaped edit/idle cycles force reflection',
    prompts.length === 3,
    `prompts: ${prompts.length}`
  );

  helper.check(
    '2p. the V2 ctx.session.prompt receives {sessionID, text}, not the V1 {path, body} shape',
    prompts.every((p) => typeof p.sessionID === 'string' && typeof p.text === 'string'),
    JSON.stringify(prompts)
  );

  const breaker = JSON.parse(fs.readFileSync(path.join(sessionDir, 'circuit-breaker.json'), 'utf8'));
  const signature = Object.keys(breaker.failures)[0];
  helper.check(
    '2p. three same-signature failures via the v2 hooks force reflectionPending',
    breaker.failures[signature].count === 3 && breaker.reflectionPending === true,
    JSON.stringify(breaker)
  );

  let blocked = false;
  try {
    await before({ tool: 'edit', sessionID: 's1', id: 'blocked-edit', input: {} });
  } catch {
    blocked = true;
  }
  helper.check('2p. a pending reflection blocks a v2-shaped edit call', blocked, 'edit call was allowed during pending reflection');

  // Flow 2: the reflection artifact is accepted through the V2 after hook,
  // proving input-args mapping across the adapter.
  const token = (prompts.map((p) => (p.text.match(/reflection token: ([A-Za-z0-9_-]+)/i) || [])[1]).filter(Boolean).pop());
  const reflectionFile = path.join(sessionDir, 'zoom-out-report.md');
  fs.writeFileSync(
    reflectionFile,
    `## Goal\nfix the fixture\n## Failed Attempts\nthree retries\n## Verified Facts\ntest stays red\n## Diagnosis\nthe fixture intentionally fails\n## Decision\nRESUME: change the fixture\nReflection token: ${token}\n`
  );
  await after({ tool: 'write', sessionID: 's1', id: 'reflect-write', input: { filePath: reflectionFile } });

  const breakerAfter = JSON.parse(fs.readFileSync(path.join(sessionDir, 'circuit-breaker.json'), 'utf8'));
  helper.check(
    '2p. a v2-shaped reflection artifact completes the reflection',
    breakerAfter.reflectionPending === false && Number.isFinite(breakerAfter.lastReflection) && breakerAfter.failures[signature].count === 0,
    JSON.stringify(breakerAfter)
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

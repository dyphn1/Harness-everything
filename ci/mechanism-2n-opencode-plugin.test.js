const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');
const { createV2Driver, v2Event } = require('./lib/opencode-v2-driver');

console.log('\n[2n] opencode enforcement plugin: V2 hook API and firing behavior...');

const pluginDir = path.join(helper.root, 'opencode-plugin');
const pluginFile = path.join(pluginDir, 'index.mjs');
const pluginManifestFile = path.join(pluginDir, 'plugin.json');

helper.check(
  '2n. the repository inventory manifest exists',
  fs.existsSync(pluginManifestFile),
  `${pluginManifestFile} missing`
);

if (fs.existsSync(pluginManifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(pluginManifestFile, 'utf8'));
  const onDisk = fs.readdirSync(path.join(pluginDir, 'hooks'))
    .filter((file) => file.endsWith('.js'))
    .sort();
  const declared = Object.values(manifest.hooks || {})
    .map((file) => path.relative(path.join(pluginDir, 'hooks'), path.join(pluginDir, file)))
    .sort();
  helper.check(
    '2n. every standalone hook file on disk is declared in the inventory manifest',
    onDisk.every((file) => declared.includes(file)),
    `undeclared: ${onDisk.filter((file) => !declared.includes(file)).join(', ')}`
  );
  helper.check(
    '2n. every declared inventory hook path exists on disk',
    declared.every((file) => onDisk.includes(file)),
    `dangling: ${declared.filter((file) => !onDisk.includes(file)).join(', ')}`
  );
  helper.check(
    '2n. no standalone hook is declared more than once',
    new Set(declared).size === declared.length,
    declared.join(', ')
  );
}

helper.check(
  '2n. the plugin entrypoint is a single self-contained file',
  fs.existsSync(pluginFile) && !/require\(['"]\.\//.test(fs.readFileSync(pluginFile, 'utf8')),
  `${pluginFile} missing or imports a sibling file`
);

// Mirrors the plugin's own getWorkspaceKey(directory) exactly (issue #42
// item #4) - duplicated here rather than imported since the plugin exports
// only its V2 default definition.
function getWorkspaceStateRoot(stateHome, workspace) {
  const realWorkspace = fs.realpathSync.native(path.resolve(workspace));
  const slug = path.basename(realWorkspace).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  return path.join(stateHome, 'workspaces', `${slug}-${hash}`);
}

function writePackageScript(workspace, script) {
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: script } }, null, 2)
  );
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function toolBeforeEvent(tool, sessionID, id, input = {}) {
  return { tool, sessionID, agent: 'build', messageID: `msg-${id}`, id, input };
}

function toolAfterEvent(tool, sessionID, id, input = {}) {
  return {
    tool,
    sessionID,
    agent: 'build',
    messageID: `msg-${id}`,
    id,
    input,
    status: 'completed',
    result: { title: '', output: '', metadata: {} },
  };
}

// Local V2 host fixture for prompt transport failures (opencode-v2-driver.js
// always resolves ctx.session.prompt and is outside this packet's write-set).
async function createPromptRetryV2Driver() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-2n-retry-'));
  const canonicalRoot = fs.realpathSync.native(tempRoot);
  const workspace = path.join(canonicalRoot, 'workspace');
  const stateHome = path.join(canonicalRoot, 'harness-state');
  fs.mkdirSync(workspace, { recursive: true });
  writePackageScript(workspace, 'node -e "process.exit(1)"');

  const envKeys = ['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS'];
  const envBefore = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  process.env.HOME = canonicalRoot;
  process.env.USERPROFILE = canonicalRoot;
  process.env.HARNESS_STATE_HOME = stateHome;
  process.env.HARNESS_OBSERVATIONS_DIR = path.join(canonicalRoot, 'observations');
  process.env.HARNESS_OBSERVATIONS = 'off';

  const prompts = [];
  const toolHooks = new Map();
  const queue = [];
  let wake = null;
  let streamEnded = false;
  let rejectNextPrompt = false;

  const ctx = {
    location: { directory: workspace },
    tool: {
      hook: async (name, callback) => {
        toolHooks.set(name, callback);
        return { dispose: async () => { toolHooks.delete(name); } };
      },
    },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: workspace } }),
      prompt: async (input) => {
        prompts.push(input);
        if (rejectNextPrompt) {
          rejectNextPrompt = false;
          throw new Error('prompt transport unavailable');
        }
        return {};
      },
      hook: async () => ({ dispose: async () => {} }),
      context: async () => [],
    },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            while (!queue.length) {
              if (signal.aborted) { streamEnded = true; return { done: true, value: undefined }; }
              await new Promise((resolve) => {
                const onAbort = () => resolve();
                wake = () => { signal.removeEventListener('abort', onAbort); resolve(); };
                signal.addEventListener('abort', onAbort, { once: true });
              });
              wake = null;
            }
            return { done: false, value: queue.shift() };
          },
          return: async () => { streamEnded = true; return { done: true, value: undefined }; },
        }),
      }),
    },
  };

  async function waitFor(predicate, label, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error(`prompt-retry V2 fixture: ${label} did not occur within ${timeoutMs}ms (prompts=${prompts.length}; queued=${queue.length})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  let disposeSetup;
  try {
    const mod = await import(pathToFileURL(pluginFile).href);
    disposeSetup = await mod.default.setup(ctx);
  } catch (err) {
    restoreEnv();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw err;
  }

  let tornDown = false;
  return {
    workspace,
    stateHome,
    prompts,
    toolHook: (name) => toolHooks.get(name),
    setRejectNextPrompt: (value) => { rejectNextPrompt = value; },
    emit(type, sessionID, data) {
      queue.push(v2Event(type, sessionID, data));
      if (wake) wake();
    },
    waitFor,
    async teardown() {
      if (tornDown) return;
      tornDown = true;
      try {
        if (typeof disposeSetup === 'function') await disposeSetup();
        await waitFor(() => streamEnded, 'event stream end');
      } finally {
        restoreEnv();
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

// Hook firing against OpenCode 2.x default { id, setup(ctx) } definition via
// ci/lib/opencode-v2-driver.js. HOME and HARNESS_STATE_HOME are redirected to
// temp directories so real session state is untouched.
(async () => {
  const d = await createV2Driver({
    scripts: { test: 'node -e "process.exit(0)"' },
  });
  try {
    const workspaceStateRoot = getWorkspaceStateRoot(d.stateHome, d.workspace);
    const stateRoot = path.join(workspaceStateRoot, 'state');
    const stateDir = path.join(stateRoot, 'sessions', 's1');
    const secondSessionDir = path.join(stateRoot, 'sessions', 's2');
    const editStateFile = path.join(stateDir, 'edit-state.json');
    const breakerFile = path.join(stateDir, 'circuit-breaker.json');
    const complianceFile = path.join(stateDir, 'compliance.json');
    const legacyDir = path.join(path.dirname(d.stateHome), '.harness-state');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'circuit-breaker.json'), JSON.stringify({ legacy: true }));

    helper.check(
      '2n. registers the V2 hooks it uses (execute.before/after, prompt/context, event.subscribe)',
      ['execute.before', 'execute.after'].every((k) => typeof d.toolHook(k) === 'function')
        && d.toolHooks.size === 2
        && ['prompt', 'context'].every((k) => typeof d.sessionHook(k) === 'function')
        && d.sessionHooks.size === 2
        && d.subscribeCount() === 1,
      `toolHooks=${[...d.toolHooks.keys()].join(',')}; sessionHooks=${[...d.sessionHooks.keys()].join(',')}; subscribes=${d.subscribeCount()}`
    );

    // --- edit tracking (execute.after) ---
    await d.toolHook('execute.after')(toolAfterEvent('read', 's1', 'c0'));
    helper.check('2n. non-edit tools do not mark verification pending', !fs.existsSync(editStateFile), 'edit-state.json created by a read');

    await d.toolHook('execute.after')(toolAfterEvent('edit', 's1', 'c1'));
    let editState = JSON.parse(fs.readFileSync(editStateFile, 'utf8'));
    helper.check(
      '2n. an edit tool call marks verification pending',
      editState.verificationPending === true && editState.editsSinceVerification === 1,
      JSON.stringify(editState)
    );

    // --- verification gate on session.execution.succeeded: passing case clears pending ---
    d.emit('session.execution.succeeded', 's1');
    await d.waitFor(
      () => {
        const current = readJsonIfExists(editStateFile);
        return current && current.verificationPending === false && current.editsSinceVerification === 0;
      },
      { label: 'passing verification clears pending state' }
    );
    await d.settled({ quietMs: 100 });
    editState = JSON.parse(fs.readFileSync(editStateFile, 'utf8'));
    helper.check(
      '2n. a passing verification on session.execution.succeeded clears pending state',
      editState.verificationPending === false && editState.editsSinceVerification === 0,
      JSON.stringify(editState)
    );
    helper.check('2n. no follow-up prompt is sent when verification passes', d.prompts.length === 0, `${d.prompts.length} prompt(s) sent`);

    // Repeated verification failures keep reminding but never block permitted edits.
    writePackageScript(d.workspace, 'node -e "process.exit(1)"');
    const editAllowedAfterFailures = [];
    for (let i = 1; i <= 4; i++) {
      let allowed = true;
      try {
        await d.toolHook('execute.before')(toolBeforeEvent('edit', 's1', `retry-${i}`));
      } catch {
        allowed = false;
      }
      editAllowedAfterFailures.push(allowed);
      if (!allowed) break;
      await d.toolHook('execute.after')(toolAfterEvent('edit', 's1', `c${i + 1}`));
      d.emit('session.execution.succeeded', 's1');
      await d.waitFor(() => d.prompts.length === i, { label: `failure reminder prompt ${i}` });
    }
    await d.settled({ quietMs: 100 });
    helper.check(
      '2n. four edits proceed through repeated failures, including beyond the former threshold',
      editAllowedAfterFailures.every(Boolean),
      JSON.stringify(editAllowedAfterFailures)
    );
    const failurePrompts = d.prompts.map((call) => call.text);
    helper.check(
      '2n. each failed verification sends a reminder without a trip, token, or report demand',
      failurePrompts.length === 4 && failurePrompts.every((text) => /verification failed/i.test(text)
        && !/reflection token|## Goal|forced reflection|retries before/i.test(text)),
      JSON.stringify(failurePrompts)
    );
    helper.check(
      '2n. verification failures create no breaker file or trip counters',
      !fs.existsSync(breakerFile)
        && !Object.hasOwn(JSON.parse(fs.readFileSync(complianceFile, 'utf8')), 'circuitBreakerTrips')
        && !Object.hasOwn(JSON.parse(fs.readFileSync(complianceFile, 'utf8')), 'reflectionsForced'),
      fs.existsSync(breakerFile) ? fs.readFileSync(breakerFile, 'utf8') : JSON.stringify(JSON.parse(fs.readFileSync(complianceFile, 'utf8')))
    );

    let pendingReadAllowed = true;
    try {
      await d.toolHook('execute.before')(toolBeforeEvent('read', 's1', 'pending-read'));
    } catch {
      pendingReadAllowed = false;
    }
    helper.check('2n. non-edit tools remain available after repeated failures', pendingReadAllowed, 'execute.before blocked a read');

    const legacyPendingDir = path.join(stateRoot, 'sessions', 'legacy-pending');
    const legacyBreakerFile = path.join(legacyPendingDir, 'circuit-breaker.json');
    fs.mkdirSync(legacyPendingDir, { recursive: true });
    const legacyPendingState = JSON.stringify({
      failures: { old: { count: 3, firstSeen: 1, lastSeen: 2 } },
      reflectionPending: true, reflectionRequestedAt: 2, reflectionToken: 'old-token', reflectionSignature: 'old'
    }, null, 2);
    fs.writeFileSync(legacyBreakerFile, legacyPendingState);
    let legacyEditAllowed = true;
    try {
      await d.toolHook('execute.before')(toolBeforeEvent('edit', 'legacy-pending', 'legacy-edit'));
    } catch {
      legacyEditAllowed = false;
    }
    helper.check(
      '2n. legacy pending reflection state stays inert and does not block an edit',
      legacyEditAllowed && fs.readFileSync(legacyBreakerFile, 'utf8') === legacyPendingState,
      fs.readFileSync(legacyBreakerFile, 'utf8')
    );
    if (legacyEditAllowed) {
      await d.toolHook('execute.after')(
        toolAfterEvent('edit', 'legacy-pending', 'legacy-edit-after', { filePath: path.join(d.workspace, 'legacy.js') })
      );
    }
    helper.check(
      '2n. legacy pending state permits the full V2 edit lifecycle',
      JSON.parse(fs.readFileSync(path.join(legacyPendingDir, 'edit-state.json'), 'utf8')).verificationPending === true,
      path.join(legacyPendingDir, 'edit-state.json')
    );

    // A repeated completion event after a follow-up is already pending is a no-op
    // (positive controls: the 4 failure prompts above on s1 and s2 below).
    const promptsAfterFailure = d.prompts.length;
    d.emit('session.execution.succeeded', 's1');
    await d.settled({ quietMs: 200 });
    helper.check(
      '2n. repeated session.execution.succeeded does not duplicate verification or follow-up prompts',
      d.prompts.length === promptsAfterFailure,
      `${d.prompts.length} prompt(s) sent`
    );

    // The same workspace can host independent sessions.
    const promptsBeforeS2 = d.prompts.length;
    await d.toolHook('execute.before')(toolBeforeEvent('edit', 's2', 's2-c1'));
    await d.toolHook('execute.after')(toolAfterEvent('edit', 's2', 's2-c1'));
    d.emit('session.execution.succeeded', 's2');
    await d.waitFor(() => d.prompts.length === promptsBeforeS2 + 1, { label: 's2 verification prompt' });
    await d.settled({ quietMs: 100 });
    helper.check(
      '2n. a second session keeps independent edit state',
      fs.existsSync(path.join(secondSessionDir, 'edit-state.json')) && !fs.existsSync(path.join(secondSessionDir, 'circuit-breaker.json')),
      secondSessionDir
    );

    // A fresh session.created event is the explicit reset contract for a reused
    // session identity, and it removes only that session's plugin state.
    d.emit('session.created', 's1');
    await d.waitFor(() => !fs.existsSync(editStateFile), { label: 'session.created resets s1 state' });
    await d.settled({ quietMs: 100 });
    helper.check('2n. session.created resets only the current session state', !fs.existsSync(editStateFile), editStateFile);
    let resetAllowed = true;
    try {
      await d.toolHook('execute.before')(toolBeforeEvent('edit', 's1', 'after-reset'));
    } catch {
      resetAllowed = false;
    }
    helper.check('2n. a reset session can edit again', resetAllowed, 'execute.before remained locked');

    // Invalid session IDs are hashed into a child directory. Resetting one can
    // therefore never recurse into the workspace state parent or another path.
    const sessionsRoot = path.join(stateRoot, 'sessions');
    const outsideSentinel = path.join(d.stateHome, 'outside-session-sentinel');
    fs.mkdirSync(outsideSentinel, { recursive: true });
    fs.writeFileSync(path.join(outsideSentinel, 'keep.txt'), 'keep');
    const unsafeSession = '../../outside-session-sentinel';
    const unsafeSessionDir = path.join(
      sessionsRoot,
      `session-${crypto.createHash('sha1').update(unsafeSession).digest('hex').slice(0, 12)}`
    );
    await d.toolHook('execute.after')(toolAfterEvent('edit', '..', 'dotdot'));
    await d.toolHook('execute.after')(toolAfterEvent('edit', '.', 'dot'));
    await d.toolHook('execute.after')(toolAfterEvent('edit', unsafeSession, 'unsafe'));
    await d.waitFor(() => fs.existsSync(path.join(unsafeSessionDir, 'edit-state.json')), { label: 'unsafe session hashed dir created' });
    d.emit('session.created', unsafeSession);
    await d.waitFor(() => !fs.existsSync(unsafeSessionDir), { label: 'unsafe session reset completes' });
    await d.settled({ quietMs: 100 });
    const sessionEntries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
    helper.check(
      '2n. dot and dotdot session IDs never escape the sessions root',
      !fs.existsSync(path.join(stateRoot, 'edit-state.json')) &&
        sessionEntries.every((entry) => entry.isDirectory() && !['.', '..'].includes(entry.name)),
      sessionEntries.map((entry) => entry.name).join(', ')
    );
    helper.check('2n. resetting an unsafe session cannot delete an outside sentinel', fs.existsSync(path.join(outsideSentinel, 'keep.txt')), outsideSentinel);
    helper.check('2n. resetting s1 leaves the independent s2 state', fs.existsSync(path.join(secondSessionDir, 'edit-state.json')), secondSessionDir);

    helper.check(
      '2n. legacy flat state migrates into the workspace-keyed root',
      !fs.existsSync(legacyDir) && fs.existsSync(path.join(workspaceStateRoot, 'circuit-breaker.json')),
      JSON.stringify({ legacyDir, workspaceStateRoot })
    );
    helper.check('2n. hook state stayed inside the redirected HOME', fs.existsSync(stateRoot), `no state root under ${d.stateHome}`);
  } finally {
    await d.teardown();
  }

  // A prompt transport failure is retryable without re-running verification.
  const retryDriver = await createPromptRetryV2Driver();
  try {
    const retryStateRoot = path.join(getWorkspaceStateRoot(retryDriver.stateHome, retryDriver.workspace), 'state');
    const retrySessionDir = path.join(retryStateRoot, 'sessions', 'prompt-retry');
    const retryEditStateFile = path.join(retrySessionDir, 'edit-state.json');

    retryDriver.setRejectNextPrompt(true);
    await retryDriver.toolHook('execute.before')(toolBeforeEvent('edit', 'prompt-retry', 'retry-c1'));
    await retryDriver.toolHook('execute.after')(toolAfterEvent('edit', 'prompt-retry', 'retry-c1'));
    retryDriver.emit('session.execution.succeeded', 'prompt-retry');
    await retryDriver.waitFor(
      () => retryDriver.prompts.length === 1 && readJsonIfExists(retryEditStateFile)?.followUpDeliveryPending === true,
      'failed prompt delivery state'
    );
    let retryEditState = JSON.parse(fs.readFileSync(retryEditStateFile, 'utf8'));
    helper.check(
      '2n. failed prompt delivery remains retryable',
      retryDriver.prompts.length === 1 &&
        retryEditState.followUpPending === false &&
        retryEditState.followUpDeliveryPending === true &&
        !fs.existsSync(path.join(retrySessionDir, 'circuit-breaker.json')),
      JSON.stringify(retryEditState)
    );

    retryDriver.emit('session.execution.succeeded', 'prompt-retry');
    await retryDriver.waitFor(
      () => {
        const current = readJsonIfExists(retryEditStateFile);
        return retryDriver.prompts.length === 2
          && current?.followUpPending === true
          && current?.followUpDeliveryPending === false;
      },
      'retried follow-up delivery'
    );
    retryEditState = JSON.parse(fs.readFileSync(retryEditStateFile, 'utf8'));
    helper.check(
      '2n. next session.execution.succeeded retries the saved follow-up exactly once',
      retryDriver.prompts.length === 2 &&
        retryEditState.followUpPending === true &&
        retryEditState.followUpDeliveryPending === false &&
        !fs.existsSync(path.join(retrySessionDir, 'circuit-breaker.json')),
      JSON.stringify(retryEditState)
    );
  } finally {
    await retryDriver.teardown();
  }

  helper.finish();
})().catch((err) => {
  console.error('2n. opencode plugin test crashed:', err);
  process.exit(1);
});

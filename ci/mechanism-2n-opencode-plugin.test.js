const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');

console.log('\n[2n] opencode enforcement plugin: real hook API and firing behavior...');

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
  '2n. the V1 enforcement factory remains in the plugin entrypoint',
  fs.existsSync(pluginFile) && !/require\(['"]\.\//.test(fs.readFileSync(pluginFile, 'utf8')),
  `${pluginFile} missing or imports a sibling file`
);

// Hook firing, against opencode's real Hooks interface (verified from
// packages/plugin/src/index.ts and packages/web/.../plugins.mdx in the
// opencode source - see opencode-plugin/README.md). Two isolations are
// load-bearing: HOME -> temp, because the plugin persists under
// ~/.agents/harness-everything/ and an un-redirected run would corrupt real
// session state; workspace -> temp, with a
// package.json this test controls, so verification pass/fail is
// deterministic.
(async () => {
  const fakeHome = helper.tempDir('.mechanism-test-opencode-home');
  const workspace = helper.tempDir('.mechanism-test-opencode-workspace');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  delete process.env.HARNESS_STATE_HOME;

  // Mirrors the plugin's own getWorkspaceKey(directory) exactly (issue #42
  // item #4) - duplicated here rather than imported since the plugin only
  // exports HarnessEnforcement.
  const realWorkspace = fs.realpathSync(path.resolve(workspace));
  const slug = path.basename(realWorkspace).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  const stateHome = path.join(fakeHome, '.agents', 'harness-everything');
  const stateRoot = path.join(stateHome, 'workspaces', `${slug}-${hash}`, 'state');
  const stateDir = path.join(stateRoot, 'sessions', 's1');
  const secondSessionDir = path.join(stateRoot, 'sessions', 's2');
  const retrySessionDir = path.join(stateRoot, 'sessions', 'prompt-retry');
  const editStateFile = path.join(stateDir, 'edit-state.json');
  const breakerFile = path.join(stateDir, 'circuit-breaker.json');
  const complianceFile = path.join(stateDir, 'compliance.json');
  const legacyDir = path.join(fakeHome, '.harness-state');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'circuit-breaker.json'), JSON.stringify({ legacy: true }));

  function writePackageScript(script) {
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: script } }, null, 2)
    );
  }

  const promptCalls = [];
  let rejectNextPrompt = false;
  const mockClient = {
    session: {
      prompt: async (opts) => {
        promptCalls.push(opts);
        if (rejectNextPrompt) {
          rejectNextPrompt = false;
          throw new Error('prompt transport unavailable');
        }
        return {};
      }
    }
  };

  const { HarnessEnforcement } = await import(pathToFileURL(pluginFile).href);

  const hooks = await HarnessEnforcement({
    client: mockClient,
    directory: workspace,
    worktree: workspace,
    project: {},
    serverUrl: new URL('http://localhost:4096'),
    experimental_workspace: { register() {} },
    $: async () => {}
  });

  helper.check(
    '2n. exports exactly the hooks it uses (tool.execute.before/after, event)',
    ['tool.execute.before', 'tool.execute.after', 'event'].every((k) => typeof hooks[k] === 'function') &&
      Object.keys(hooks).length === 3,
    `got keys: ${Object.keys(hooks).join(', ')}`
  );

  // --- edit tracking (tool.execute.after) ---
  await hooks['tool.execute.after']({ tool: 'read', sessionID: 's1', callID: 'c0' }, { title: '', output: '', metadata: {} });
  helper.check('2n. non-edit tools do not mark verification pending', !fs.existsSync(editStateFile), 'edit-state.json created by a read');

  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's1', callID: 'c1' }, { title: '', output: '', metadata: {} });
  let editState = JSON.parse(fs.readFileSync(editStateFile, 'utf8'));
  helper.check(
    '2n. an edit tool call marks verification pending',
    editState.verificationPending === true && editState.editsSinceVerification === 1,
    JSON.stringify(editState)
  );

  // --- verification gate on session.idle: passing case clears pending ---
  writePackageScript('node -e "process.exit(0)"');
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  editState = JSON.parse(fs.readFileSync(editStateFile, 'utf8'));
  helper.check(
    '2n. a passing verification on session.idle clears pending state',
    editState.verificationPending === false && editState.editsSinceVerification === 0,
    JSON.stringify(editState)
  );
  helper.check('2n. no follow-up prompt is sent when verification passes', promptCalls.length === 0, `${promptCalls.length} prompt(s) sent`);

  // Repeated verification failures keep reminding but never block permitted edits.
  writePackageScript('node -e "process.exit(1)"');
  const editAllowedAfterFailures = [];
  for (let i = 1; i <= 4; i++) {
    let allowed = true;
    try {
      await hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1', callID: `retry-${i}` }, { args: {} });
    } catch {
      allowed = false;
    }
    editAllowedAfterFailures.push(allowed);
    if (!allowed) break;
    await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's1', callID: `c${i + 1}` }, { title: '', output: '', metadata: {} });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  }
  helper.check(
    '2n. four edits proceed through repeated failures, including beyond the former threshold',
    editAllowedAfterFailures.every(Boolean),
    JSON.stringify(editAllowedAfterFailures)
  );
  const failurePrompts = promptCalls.map((call) => call.body.parts[0].text);
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
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 's1', callID: 'pending-read' }, { args: {} });
  } catch {
    pendingReadAllowed = false;
  }
  helper.check('2n. non-edit tools remain available after repeated failures', pendingReadAllowed, 'tool.execute.before blocked a read');

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
    await hooks['tool.execute.before']({ tool: 'edit', sessionID: 'legacy-pending', callID: 'legacy-edit' }, { args: {} });
  } catch {
    legacyEditAllowed = false;
  }
  helper.check(
    '2n. legacy pending reflection state stays inert and does not block an edit',
    legacyEditAllowed && fs.readFileSync(legacyBreakerFile, 'utf8') === legacyPendingState,
    fs.readFileSync(legacyBreakerFile, 'utf8')
  );
  if (legacyEditAllowed) {
    await hooks['tool.execute.after'](
      { tool: 'edit', sessionID: 'legacy-pending', callID: 'legacy-edit-after' },
      { title: '', output: '', metadata: {}, args: { filePath: path.join(workspace, 'legacy.js') } }
    );
  }
  helper.check('2n. legacy pending state permits the full V1 edit lifecycle',
    JSON.parse(fs.readFileSync(path.join(legacyPendingDir, 'edit-state.json'), 'utf8')).verificationPending === true,
    path.join(legacyPendingDir, 'edit-state.json'));

  // A repeated idle event after a follow-up is already pending is a no-op.
  const promptsAfterFailure = promptCalls.length;
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  helper.check(
    '2n. repeated idle does not duplicate verification or follow-up prompts',
    promptCalls.length === promptsAfterFailure,
    `${promptCalls.length} prompt(s) sent`
  );

  // The same workspace can host independent sessions.
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's2', callID: 's2-c1', args: {} }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's2' } } });
  helper.check(
    '2n. a second session keeps independent edit state',
    fs.existsSync(path.join(secondSessionDir, 'edit-state.json')) && !fs.existsSync(path.join(secondSessionDir, 'circuit-breaker.json')),
    secondSessionDir
  );

  // A prompt transport failure is retryable without re-running verification.
  const promptsBeforeDeliveryFailure = promptCalls.length;
  rejectNextPrompt = true;
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 'prompt-retry', callID: 'retry-c1' }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'prompt-retry' } } });
  let retryEditState = JSON.parse(fs.readFileSync(path.join(retrySessionDir, 'edit-state.json'), 'utf8'));
  helper.check(
    '2n. failed prompt delivery remains retryable',
    promptCalls.length === promptsBeforeDeliveryFailure + 1 &&
      retryEditState.followUpPending === false &&
      retryEditState.followUpDeliveryPending === true &&
      !fs.existsSync(path.join(retrySessionDir, 'circuit-breaker.json')),
    JSON.stringify(retryEditState)
  );
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'prompt-retry' } } });
  retryEditState = JSON.parse(fs.readFileSync(path.join(retrySessionDir, 'edit-state.json'), 'utf8'));
  helper.check(
    '2n. next idle retries the saved follow-up exactly once',
    promptCalls.length === promptsBeforeDeliveryFailure + 2 &&
      retryEditState.followUpPending === true &&
      retryEditState.followUpDeliveryPending === false &&
      !fs.existsSync(path.join(retrySessionDir, 'circuit-breaker.json')),
    JSON.stringify(retryEditState)
  );

  // A fresh session event is the explicit reset contract for a reused session
  // identity, and it removes only that session's plugin state.
  await hooks.event({ event: { type: 'session.created', properties: { info: { id: 's1' } } } });
  helper.check('2n. session.created resets only the current session state', !fs.existsSync(editStateFile), editStateFile);
  let resetAllowed = true;
  try {
    await hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1', callID: 'after-reset' }, { args: {} });
  } catch {
    resetAllowed = false;
  }
  helper.check('2n. a reset session can edit again', resetAllowed, 'tool.execute.before remained locked');

  // Invalid session IDs are hashed into a child directory. Resetting one can
  // therefore never recurse into the workspace state parent or another path.
  const sessionsRoot = path.join(stateRoot, 'sessions');
  const outsideSentinel = path.join(stateHome, 'outside-session-sentinel');
  fs.mkdirSync(outsideSentinel, { recursive: true });
  fs.writeFileSync(path.join(outsideSentinel, 'keep.txt'), 'keep');
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: '..', callID: 'dotdot' }, { title: '', output: '', metadata: {} });
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: '.', callID: 'dot' }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.created', properties: { info: { id: '../../outside-session-sentinel' } } } });
  const sessionEntries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  helper.check(
    '2n. dot and dotdot session IDs never escape the sessions root',
    !fs.existsSync(path.join(stateRoot, 'edit-state.json')) &&
      sessionEntries.every((entry) => entry.isDirectory() && !['.', '..'].includes(entry.name)),
    sessionEntries.map((entry) => entry.name).join(', ')
  );
  helper.check('2n. resetting an unsafe session cannot delete an outside sentinel', fs.existsSync(path.join(outsideSentinel, 'keep.txt')), outsideSentinel);
  helper.check('2n. resetting s1 leaves the independent s2 state', fs.existsSync(path.join(secondSessionDir, 'edit-state.json')), secondSessionDir);

  const workspaceStateRoot = path.dirname(stateRoot);
  helper.check(
    '2n. legacy flat state migrates into the workspace-keyed root',
    !fs.existsSync(legacyDir) && fs.existsSync(path.join(workspaceStateRoot, 'circuit-breaker.json')),
    JSON.stringify({ legacyDir, workspaceStateRoot })
  );
  helper.check('2n. hook state stayed inside the redirected HOME', fs.existsSync(stateRoot), `no state root under ${stateHome}`);

  helper.finish();
})().catch((err) => {
  console.error('2n. opencode plugin test crashed:', err);
  process.exit(1);
});

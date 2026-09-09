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
  '2n. the plugin ships as a single self-contained module (installable by copying one file)',
  fs.existsSync(pluginFile) && !/require\(['"]\.\//.test(fs.readFileSync(pluginFile, 'utf8')),
  `${pluginFile} missing or imports a sibling file`
);

// Hook firing, against opencode's real Hooks interface (verified from
// packages/plugin/src/index.ts and packages/web/.../plugins.mdx in the
// opencode source - see opencode-plugin/README.md). Two isolations are
// load-bearing: HOME -> temp, because the plugin persists under
// ~/.agents/harness-everything/ and an un-redirected run would corrupt a
// real session's circuit-breaker state; workspace -> temp, with a
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

  // --- verification gate: failing case drives the circuit breaker ---
  writePackageScript('node -e "process.exit(1)"');

  for (let i = 1; i <= 2; i++) {
    await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's1', callID: `c${i + 1}` }, { title: '', output: '', metadata: {} });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  }
  let breaker = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
  const sig = Object.keys(breaker.failures)[0];
  helper.check(
    '2n. two failures on the same signature: still allowed, not yet tripped',
    breaker.failures[sig].count === 2 && breaker.hardLock === false,
    JSON.stringify(breaker)
  );
  helper.check('2n. each failed verification sends exactly one follow-up prompt', promptCalls.length === 2, `${promptCalls.length} prompt(s) sent`);

  // 3rd failure -> force reflection
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's1', callID: 'c4' }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  breaker = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
  let compliance = JSON.parse(fs.readFileSync(complianceFile, 'utf8'));
  helper.check(
    '2n. 3rd failure on the same signature forces reflection',
    breaker.failures[sig].count === 3 && compliance.reflectionsForced === 1,
    JSON.stringify({ breaker, compliance })
  );
  helper.check(
    '2n. the forced-reflection prompt says to reflect',
    /reflect/i.test(promptCalls[promptCalls.length - 1].body.parts[0].text),
    promptCalls[promptCalls.length - 1].body.parts[0].text
  );

  let pendingEditBlocked = false;
  try {
    await hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1', callID: 'pending-edit' }, { args: {} });
  } catch {
    pendingEditBlocked = true;
  }
  helper.check('2n. pending reflection blocks another code edit', pendingEditBlocked, 'tool.execute.before allowed an edit before the report');

  let pendingReadAllowed = true;
  try {
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 's1', callID: 'pending-read' }, { args: {} });
  } catch {
    pendingReadAllowed = false;
  }
  helper.check('2n. pending reflection still allows read tools', pendingReadAllowed, 'tool.execute.before blocked a read during reflection');

  // Complete the reflection through the real hook sequence: the forced
  // prompt names a token and artifact, then the agent writes that artifact
  // through an edit-shaped tool call. No test seeding of breaker state.
  const reflectionPrompt = promptCalls[promptCalls.length - 1].body.parts[0].text;
  const reflectionTokenMatch = reflectionPrompt.match(/reflection token: ([A-Za-z0-9_-]+)/i);
  helper.check('2n. the forced-reflection prompt names a verifiable artifact token', !!reflectionTokenMatch, reflectionPrompt);
  const reflectionToken = reflectionTokenMatch && reflectionTokenMatch[1];
  const reflectionFile = path.join(stateDir, 'zoom-out-report.md');
  fs.writeFileSync(
    reflectionFile,
    `RESUME: misplaced\n## Goal\nfix the fixture\n## Failed Attempts\nthree retries\n## Verified Facts\ntest remains red\n## Diagnosis\nthe fixture intentionally fails\n## Decision\nA decision without a directive\nReflection token: ${reflectionToken}\n`,
    'utf8'
  );
  await hooks['tool.execute.after'](
    { tool: 'write', sessionID: 's1', callID: 'reflection' },
    { title: '', output: '', metadata: {}, args: { filePath: reflectionFile } }
  );
  breaker = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
  helper.check(
    '2n. a directive outside the Decision section does not complete reflection',
    breaker.reflectionPending === true && breaker.lastReflection === null,
    JSON.stringify(breaker)
  );

  fs.writeFileSync(
    reflectionFile,
    `## Goal\nfix the fixture\n## Failed Attempts\nthree retries\n## Verified Facts\ntest remains red\n## Diagnosis\nthe fixture intentionally fails\n## Decision\nRESUME: change the fixture\nReflection token: ${reflectionToken}\n`,
    'utf8'
  );
  await hooks['tool.execute.after'](
    { tool: 'apply_patch', sessionID: 's1', callID: 'reflection-patch' },
    {
      title: '',
      output: '',
      metadata: {},
      args: { patchText: `*** Begin Patch\n*** Update File: ${reflectionFile}\n@@\n*** End Patch` }
    }
  );
  breaker = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
  helper.check(
    '2n. apply_patch reflection completes the lifecycle and persists lastReflection',
    Number.isFinite(breaker.lastReflection) && breaker.lastReflection > 0 && breaker.reflectionPending === false,
    JSON.stringify(breaker)
  );

  // A repeated idle event after the follow-up is already pending is a no-op.
  // The breaker must wait for a fresh code edit before counting another try.
  const promptsAfterReflection = promptCalls.length;
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  helper.check(
    '2n. repeated idle does not duplicate verification or follow-up prompts',
    promptCalls.length === promptsAfterReflection,
    `${promptCalls.length} prompt(s) sent`
  );

  const patchSessionDir = path.join(stateRoot, 'sessions', 'patch-only');
  const patchBreakerFile = path.join(patchSessionDir, 'circuit-breaker.json');
  const patchReflectionFile = path.join(patchSessionDir, 'zoom-out-report.md');
  const patchReflectionToken = 'patch-reflection-token';
  fs.mkdirSync(patchSessionDir, { recursive: true });
  fs.writeFileSync(
    patchBreakerFile,
    JSON.stringify({
      failures: { fixture: { count: 3, firstSeen: Date.now() - 1000 } },
      hardLock: false,
      lastReflection: null,
      lastReflectionSignature: null,
      reflectionPending: true,
      reflectionRequestedAt: Date.now(),
      reflectionToken: patchReflectionToken,
      reflectionSignature: 'fixture'
    }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    patchReflectionFile,
    `## Goal\nfix the fixture\n## Failed Attempts\nthree retries\n## Verified Facts\ntest remains red\n## Diagnosis\nthe fixture intentionally fails\n## Decision\nRESUME: change the fixture\nReflection token: ${patchReflectionToken}\n`,
    'utf8'
  );
  const patchText = `*** Begin Patch\n*** Update File: ${patchReflectionFile}\n@@\n*** End Patch`;
  let patchBeforeAllowed = true;
  try {
    await hooks['tool.execute.before'](
      { tool: 'apply_patch', sessionID: 'patch-only', callID: 'patch-before' },
      { args: { patchText } }
    );
  } catch (error) {
    patchBeforeAllowed = false;
  }
  helper.check(
    '2n. apply_patch is allowed to write a pending reflection artifact',
    patchBeforeAllowed,
    'tool.execute.before blocked output.args.patchText'
  );
  await hooks['tool.execute.after'](
    { tool: 'apply_patch', sessionID: 'patch-only', callID: 'patch-after' },
    { title: '', output: '', metadata: {}, args: { patchText } }
  );
  const patchBreaker = JSON.parse(fs.readFileSync(patchBreakerFile, 'utf8'));
  helper.check(
    '2n. apply_patch output args complete a pending reflection',
    patchBreaker.reflectionPending === false && Number.isFinite(patchBreaker.lastReflection),
    JSON.stringify(patchBreaker)
  );

  // A new code edit after a completed reflection is the post-reflection retry.
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's1', callID: 'c5' }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  breaker = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
  helper.check('2n. the same failure returning after a reflection hard-locks the breaker', breaker.hardLock === true, JSON.stringify(breaker));
  helper.check(
    '2n. the hard-lock prompt says locked',
    /lock/i.test(promptCalls[promptCalls.length - 1].body.parts[0].text),
    promptCalls[promptCalls.length - 1].body.parts[0].text
  );

  // --- circuit breaker enforcement (tool.execute.before) ---
  let blocked = false;
  try {
    await hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1', callID: 'c6' }, { args: {} });
  } catch {
    blocked = true;
  }
  helper.check('2n. hard-locked breaker throws on the next edit attempt', blocked, 'tool.execute.before did not throw');

  let readBlocked = false;
  try {
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 's1', callID: 'c7' }, { args: {} });
  } catch {
    readBlocked = true;
  }
  helper.check('2n. a hard lock only blocks edit-shaped tools, not read', !readBlocked, 'tool.execute.before blocked a read');

  // The same workspace can host independent sessions. Session s2 starts with
  // a fresh breaker and cannot inherit s1's hard lock.
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 's2', callID: 's2-c1', args: {} }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's2' } } });
  const secondBreaker = JSON.parse(fs.readFileSync(path.join(secondSessionDir, 'circuit-breaker.json'), 'utf8'));
  helper.check(
    '2n. a second session has an independent breaker stream',
    secondBreaker.hardLock === false && Object.values(secondBreaker.failures).some((entry) => entry.count === 1),
    JSON.stringify(secondBreaker)
  );

  const corruptSessionDir = path.join(stateRoot, 'sessions', 'corrupt');
  const corruptBreakerFile = path.join(corruptSessionDir, 'circuit-breaker.json');
  fs.mkdirSync(corruptSessionDir, { recursive: true });
  fs.writeFileSync(corruptBreakerFile, '{not-json', 'utf8');
  let corruptStateBlocked = false;
  let corruptStateMessage = '';
  try {
    await hooks['tool.execute.before']({ tool: 'edit', sessionID: 'corrupt', callID: 'corrupt-edit' }, { args: {} });
  } catch (error) {
    corruptStateBlocked = true;
    corruptStateMessage = String(error && error.message ? error.message : error);
  }
  helper.check(
    '2n. corrupt breaker state fails closed before an edit',
    corruptStateBlocked && /corrupt/i.test(corruptStateMessage),
    corruptStateMessage || 'tool.execute.before allowed an edit with corrupt breaker state'
  );

  // A prompt transport failure is retryable without re-running verification
  // or incrementing the circuit-breaker count.
  const promptsBeforeDeliveryFailure = promptCalls.length;
  rejectNextPrompt = true;
  await hooks['tool.execute.after']({ tool: 'edit', sessionID: 'prompt-retry', callID: 'retry-c1' }, { title: '', output: '', metadata: {} });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'prompt-retry' } } });
  let retryEditState = JSON.parse(fs.readFileSync(path.join(retrySessionDir, 'edit-state.json'), 'utf8'));
  let retryBreaker = JSON.parse(fs.readFileSync(path.join(retrySessionDir, 'circuit-breaker.json'), 'utf8'));
  helper.check(
    '2n. failed prompt delivery remains retryable',
    promptCalls.length === promptsBeforeDeliveryFailure + 1 &&
      retryEditState.followUpPending === false &&
      retryEditState.followUpDeliveryPending === true &&
      retryBreaker.failures[Object.keys(retryBreaker.failures)[0]].count === 1,
    JSON.stringify({ retryEditState, retryBreaker })
  );
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'prompt-retry' } } });
  retryEditState = JSON.parse(fs.readFileSync(path.join(retrySessionDir, 'edit-state.json'), 'utf8'));
  retryBreaker = JSON.parse(fs.readFileSync(path.join(retrySessionDir, 'circuit-breaker.json'), 'utf8'));
  helper.check(
    '2n. next idle retries the saved follow-up exactly once',
    promptCalls.length === promptsBeforeDeliveryFailure + 2 &&
      retryEditState.followUpPending === true &&
      retryEditState.followUpDeliveryPending === false &&
      retryBreaker.failures[Object.keys(retryBreaker.failures)[0]].count === 1,
    JSON.stringify({ retryEditState, retryBreaker })
  );

  // A fresh session event is the explicit reset contract for a reused session
  // identity, and it removes only that session's plugin state.
  await hooks.event({ event: { type: 'session.created', properties: { info: { id: 's1' } } } });
  helper.check('2n. session.created resets only the current session state', !fs.existsSync(breakerFile), breakerFile);
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
  helper.check('2n. resetting s1 leaves the independent s2 state', fs.existsSync(path.join(secondSessionDir, 'circuit-breaker.json')), secondSessionDir);

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

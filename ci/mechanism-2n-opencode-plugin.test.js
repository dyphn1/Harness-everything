const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');

console.log('\n[2n] opencode enforcement plugin: real hook API and firing behavior...');

const pluginDir = path.join(helper.root, 'opencode-plugin');
const pluginFile = path.join(pluginDir, 'index.mjs');

helper.check(
  '2n. the old JSON-manifest plugin is gone (never invoked by opencode - see #37)',
  !fs.existsSync(path.join(pluginDir, 'plugin.json')),
  'opencode-plugin/plugin.json still exists'
);

helper.check(
  '2n. the plugin ships as a single self-contained module (installable by copying one file)',
  fs.existsSync(pluginFile) && !/require\(['"]\.\//.test(fs.readFileSync(pluginFile, 'utf8')),
  `${pluginFile} missing or imports a sibling file`
);

// Hook firing, against opencode's real Hooks interface (verified from
// packages/plugin/src/index.ts and packages/web/.../plugins.mdx in the
// opencode source - see opencode-plugin/README.md). Two isolations are
// load-bearing: HOME -> temp, because the plugin persists to
// ~/.harness-state and an un-redirected run would corrupt a real session's
// circuit-breaker state; workspace -> temp, with a package.json this test
// controls, so verification pass/fail is deterministic.
(async () => {
  const fakeHome = helper.tempDir('.mechanism-test-opencode-home');
  const workspace = helper.tempDir('.mechanism-test-opencode-workspace');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  const stateDir = path.join(fakeHome, '.harness-state');
  const editStateFile = path.join(stateDir, 'edit-state.json');
  const breakerFile = path.join(stateDir, 'circuit-breaker.json');
  const complianceFile = path.join(stateDir, 'compliance.json');

  function writePackageScript(script) {
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: script } }, null, 2)
    );
  }

  const promptCalls = [];
  const mockClient = {
    session: {
      prompt: async (opts) => {
        promptCalls.push(opts);
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

  // simulate the reflection having happened, then trip again -> hard lock
  breaker.lastReflection = Date.now();
  fs.writeFileSync(breakerFile, JSON.stringify(breaker, null, 2));

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

  helper.check('2n. hook state stayed inside the redirected HOME', fs.existsSync(stateDir), `no .harness-state under ${fakeHome}`);

  helper.finish();
})().catch((err) => {
  console.error('2n. opencode plugin test crashed:', err);
  process.exit(1);
});

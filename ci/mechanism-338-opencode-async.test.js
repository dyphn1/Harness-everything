const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');
const { createV2Driver, v2Event, DEFAULT_PLUGIN } = require('./lib/opencode-v2-driver');
const workspaceState = require('../scripts/lib/workspace');
const harnessState = require('../hooks/scripts/lib/harness-state');

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

// Local V2 disposal harness: createV2Driver.teardown() deletes stateHome
// immediately after disposeSetup(), whereas the disposal check must inspect
// edit-state.json and compliance.json after dispose() settles.
async function createDisposableV2Harness() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-338-disposal-'));
  const canonicalRoot = fs.realpathSync.native(tempRoot);
  const workspace = path.join(canonicalRoot, 'workspace');
  const stateHome = path.join(canonicalRoot, 'harness-state');
  fs.mkdirSync(workspace, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: workspace });

  const envKeys = ['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS'];
  const envBefore = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
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
      hook: async () => ({ dispose: async () => {} }),
      prompt: async value => { prompts.push(value); return {}; },
      context: async () => [],
    },
    event: {
      subscribe: ({ signal }) => ({
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
            return { done: false, value: queue.shift() };
          },
          return: async () => { streamEnded = true; return { done: true, value: undefined }; },
        }),
      }),
    },
  };

  const mod = await import(pathToFileURL(DEFAULT_PLUGIN).href);
  const disposeSetup = await mod.default.setup(ctx);
  let disposed = false;
  let tornDown = false;

  async function waitFor(predicate, { label = 'effect', timeoutMs = 5000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`disposal harness: ${label} did not occur within ${timeoutMs}ms`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  return {
    workspace,
    prompts,
    toolHook: name => toolHooks.get(name),
    emit(type, sessionID, data) {
      queue.push(v2Event(type, sessionID, data));
      if (wake) wake();
    },
    waitFor,
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof disposeSetup === 'function') await disposeSetup();
      await waitFor(() => streamEnded, { label: 'disposal event stream end' });
    },
    async teardown() {
      if (tornDown) return;
      tornDown = true;
      try {
        if (!disposed && typeof disposeSetup === 'function') await disposeSetup();
      } finally {
        for (const [key, value] of Object.entries(envBefore)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

(async () => {
  const d = await createV2Driver();
  try {
    const workspace = d.workspace;
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    const runner = require('./lib/opencode-verification-loader')(helper.root, { buildFailureSignature: undefined });
    const configure = scripts => fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'async-fixture', scripts }));
    // npm uses cmd.exe on Windows: JSON string escaping is not shell quoting.
    // Keep source out of shell commands. setup-node places this Node on PATH;
    // a quoted absolute executable adds another cmd.exe /s quoting boundary.
    const nodeFile = file => `node "${file}"`;
    let fixtureID = 0;
    const node = program => {
      const file = `program-${++fixtureID}.cjs`;
      fs.writeFileSync(path.join(workspace, file), `require('fs').writeFileSync('${file}.started', 'yes');\n${program}`);
      return nodeFile(file);
    };
    const sessionsRoot = () => path.join(workspaceState.getWorkspaceStateDir(workspace), 'state', 'sessions');
    const sessionDir = sessionID => path.join(sessionsRoot(), harnessState.sessionDirectoryName(sessionID));
    const readEditState = sessionID => {
      const file = path.join(sessionDir(sessionID), 'edit-state.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };

    let calls = 0;
    const v2Edit = async (sessionID, hooks = d) => {
      const call = ++calls;
      const event = {
        tool: 'edit',
        sessionID,
        agent: 'build',
        messageID: `msg-${sessionID}-${call}`,
        id: `338-${call}`,
        input: { filePath: 'code.js' },
      };
      await hooks.toolHook('execute.before')(event);
      await hooks.toolHook('execute.after')({ ...event, status: 'completed', result: {} });
    };

    const slowCommand = node('setTimeout(() => {}, 600)');
    configure({ test: slowCommand });
    await v2Edit('heartbeat');
    let heartbeats = 0;
    const ticker = setInterval(() => { heartbeats++; }, 20);
    d.emit('session.execution.succeeded', 'heartbeat');
    await d.waitFor(() => readEditState('heartbeat')?.verificationPending === false, { label: 'slow verification completion' });
    clearInterval(ticker);
    helper.check('338. slow verification leaves the plugin event loop responsive',
      heartbeats >= 3 && fs.existsSync(path.join(workspace, 'program-1.cjs.started')) && d.prompts.length === 0,
      `heartbeats=${heartbeats}; ${d.prompts.at(-1)?.text || ''}`);

    const largeBytes = 320 * 65536;
    const largeCommand = node("for(let i=0;i<320;i++)process.stdout.write('x'.repeat(65536)); process.stdout.write('',()=>require('fs').writeFileSync('large-output-bytes.txt',String(320*65536))); console.error('AssertionError: large-output-check');process.exitCode=1");
    configure({ test: largeCommand });
    await v2Edit('large-output');
    d.emit('session.execution.succeeded', 'large-output');
    await d.waitFor(() => d.prompts.length >= 1, { label: 'large output verification prompt', timeoutMs: 10000 });
    const largePromptText = d.prompts.at(-1)?.text || '';
    helper.check('338. output beyond the former 16 MiB cap preserves a real test verdict',
      fs.existsSync(path.join(workspace, 'large-output-bytes.txt'))
        && fs.readFileSync(path.join(workspace, 'large-output-bytes.txt'), 'utf8') === String(largeBytes)
        && /verification failed/.test(largePromptText) && /large-output-check/.test(largePromptText)
        && d.prompts.at(-1)?.sessionID === 'large-output',
      largePromptText);
    const largeResult = await runner.runVerificationCommand(workspace, largeCommand, 10000);
    helper.check('338. a nonzero exit above the former output cap remains a test failure',
      largeBytes > 16*1024*1024 && largeResult.outcome === 'test_failure' && largeResult.exitCode === 1
        && /large-output-check/.test(largeResult.error),
      JSON.stringify(largeResult));
    helper.check('338. streamed diagnostics stay bounded', largePromptText.length < 2600, `prompt bytes=${largePromptText.length}`);

    configure({
      test: node("setTimeout(() => require('fs').writeFileSync('budget-test-finished.txt','yes'), 2200)"),
      lint: node("require('fs').writeFileSync('budget-lint-started.txt','yes');setTimeout(() => {}, 2200)"),
      build: node("require('fs').writeFileSync('must-not-build.txt','ran')"),
    });
    process.env.HARNESS_VERIFY_TIMEOUT_MS = '4000';
    const started = Date.now();
    const previous = d.prompts.length;
    try {
      await v2Edit('total-budget');
      d.emit('session.execution.succeeded', 'total-budget');
      await d.waitFor(() => d.prompts.length === previous + 1, { label: 'shared budget timeout prompt', timeoutMs: 10000 });
    } finally {
      delete process.env.HARNESS_VERIFY_TIMEOUT_MS;
    }
    const budgetPromptText = d.prompts.at(-1)?.text || '';
    helper.check('338. all scripts share one verification budget',
      d.prompts.length === previous + 1 && /timed out/.test(budgetPromptText)
        && fs.existsSync(path.join(workspace, 'budget-test-finished.txt'))
        && fs.existsSync(path.join(workspace, 'budget-lint-started.txt')),
      `duration=${Date.now()-started}; ${budgetPromptText}`);
    helper.check('338. an expired sequence never launches later scripts', !fs.existsSync(path.join(workspace, 'must-not-build.txt')));

    const missing = await runner.runVerificationCommand(path.join(workspace, 'missing-cwd'), 'npm test', 2000);
    helper.check('338. spawn ENOENT is an execution error with no verdict', missing.outcome === 'execution_error' && missing.exitCode === null && /ENOENT/.test(missing.error), JSON.stringify(missing));
    const pass = await runner.runVerificationCommand(workspace, node('process.exit(0)'), 2000);
    helper.check('338. actual exit zero is pass', pass.success && pass.outcome === 'pass' && pass.exitCode === 0, JSON.stringify(pass));
    const failed = await runner.runVerificationCommand(workspace, node("console.log('FAIL parser.test.js');console.error('AssertionError: parse alpha');process.exitCode=2"), 2000);
    helper.check('338. nonzero exit remains a test failure with bounded diagnostics',
      failed.outcome === 'test_failure' && failed.exitCode === 2 && /parse alpha/.test(failed.error), JSON.stringify(failed));

    // Both shell and nested child remain in the inherited process group.
    fs.writeFileSync(path.join(workspace, 'grandchild.js'), "const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync('heartbeat.txt','x'),20)");
    fs.writeFileSync(path.join(workspace, 'worker.js'), "require('child_process').spawn(process.execPath,['grandchild.js'],{stdio:'inherit'});setInterval(()=>{},1000)");
    const cleanupResult = await runner.runVerificationCommand(workspace, nodeFile('worker.js'), 700);
    const heartbeat = path.join(workspace, 'heartbeat.txt');
    const size = fs.existsSync(heartbeat) ? fs.statSync(heartbeat).size : -1;
    await new Promise(resolve => setTimeout(resolve, 200));
    helper.check('338. timeout stops nested SIGTERM-ignoring child output', cleanupResult.outcome === 'timeout' && size > 0 && fs.statSync(heartbeat).size === size, JSON.stringify({ cleanupResult, size }));
    if (process.platform !== 'win32') {
      const externalRunner = require('./lib/opencode-verification-loader')(helper.root, {
        buildFailureSignature: undefined,
        spawn: (command, options) => {
          const child = require('child_process').spawn(command, options);
          setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 300);
          return child;
        },
      });
      const signalled = await externalRunner.runVerificationCommand(workspace, nodeFile('worker.js'), 3000);
      const afterSignal = fs.statSync(heartbeat).size;
      await new Promise(resolve => setTimeout(resolve, 200));
      helper.check('338. early external signals are execution errors and also clean the group', signalled.outcome === 'execution_error' && signalled.signal === 'SIGTERM' && !signalled.timedOut && fs.statSync(heartbeat).size === afterSignal, JSON.stringify(signalled));
    }

    const readyTxt = path.join(workspace, 'ready.txt');
    const readyPid = path.join(workspace, 'ready.pid');
    fs.writeFileSync(path.join(workspace, 'ready.js'), "const fs=require('fs');fs.writeFileSync('ready.pid',String(process.pid));fs.writeFileSync('ready.txt','yes');setInterval(()=>{},1000)");
    configure({ test: nodeFile('ready.js') });
    await v2Edit('edited-during-run');
    const beforeConcurrent = d.prompts.length;
    d.emit('session.execution.succeeded', 'edited-during-run');
    await d.waitFor(() => fs.existsSync(readyTxt), { label: 'ready.js started for edited-during-run' });
    const concurrentPid = Number(fs.readFileSync(readyPid, 'utf8'));
    d.emit('session.execution.succeeded', 'edited-during-run');
    await d.settled({ quietMs: 50 });
    await v2Edit('edited-during-run');
    await d.waitFor(() => !isAlive(concurrentPid), { label: 'cancelled verification child exit' });
    await d.settled({ quietMs: 200 });
    const editedState = readEditState('edited-during-run');
    helper.check('338. a concurrent edit cancels stale verification without duplicate follow-ups',
      editedState?.verificationPending === true && editedState?.editsSinceVerification === 2 && d.prompts.length === beforeConcurrent,
      JSON.stringify(editedState));

    configure({ test: node('process.exit(0)') });
    d.emit('session.execution.succeeded', 'edited-during-run');
    await d.waitFor(() => readEditState('edited-during-run')?.verificationPending === false, { label: 'fresh turn end verifies newer edits' });
    helper.check('338. a fresh idle verifies the newer edits',
      readEditState('edited-during-run')?.verificationPending === false && d.prompts.length === beforeConcurrent);

    if (fs.existsSync(readyTxt)) fs.unlinkSync(readyTxt);
    if (fs.existsSync(readyPid)) fs.unlinkSync(readyPid);
    configure({ test: nodeFile('ready.js') });
    await v2Edit('deleted-during-run');
    d.emit('session.execution.succeeded', 'deleted-during-run');
    await d.waitFor(() => fs.existsSync(readyTxt), { label: 'ready.js started for deleted-during-run' });
    const deletedPid = Number(fs.readFileSync(readyPid, 'utf8'));
    d.emit('session.deleted', 'deleted-during-run');
    await d.waitFor(() => !fs.existsSync(sessionDir('deleted-during-run')) && !isAlive(deletedPid), { label: 'session deletion cleanup and child exit' });
    await d.settled({ quietMs: 200 });
    helper.check('338. session deletion aborts the runner without resurrecting state',
      !fs.existsSync(sessionDir('deleted-during-run')) && !isAlive(deletedPid) && d.prompts.length === beforeConcurrent);

    // V2 consumes reset/delete events while idle verification is pending.
    fs.writeFileSync(path.join(workspace, 'v2.js'), "const fs=require('fs');fs.writeFileSync('v2.pid',String(process.pid));fs.writeFileSync('v2-ready.txt','yes');setInterval(()=>fs.appendFileSync('v2-heartbeat.txt','x'),20)");
    configure({ test: nodeFile('v2.js') });
    const v2Ready = path.join(workspace, 'v2-ready.txt');
    const v2Pid = path.join(workspace, 'v2.pid');
    const v2Heartbeat = path.join(workspace, 'v2-heartbeat.txt');
    for (const type of ['session.deleted', 'session.created']) {
      const sessionID = `v2-${type}`;
      if (fs.existsSync(v2Ready)) fs.unlinkSync(v2Ready);
      if (fs.existsSync(v2Pid)) fs.unlinkSync(v2Pid);
      if (fs.existsSync(v2Heartbeat)) fs.unlinkSync(v2Heartbeat);
      await v2Edit(sessionID);
      d.emit('session.execution.succeeded', sessionID);
      await d.waitFor(() => fs.existsSync(v2Ready) && fs.existsSync(v2Heartbeat), { label: `v2.js started for ${type}` });
      const childPid = Number(fs.readFileSync(v2Pid, 'utf8'));
      d.emit(type, sessionID);
      await d.waitFor(() => !fs.existsSync(sessionDir(sessionID)) && !isAlive(childPid), { label: `V2 ${type} stops child and removes state` });
      const stopped = fs.statSync(v2Heartbeat).size;
      await d.settled({ quietMs: 150 });
      helper.check(`338. V2 consumes ${type} during verification and stops its child`,
        fs.statSync(v2Heartbeat).size === stopped && !isAlive(childPid) && d.prompts.length === beforeConcurrent);
    }

    // A new turn end can arrive while an edit-cancelled child is still being reaped.
    // That turn end must verify the newer revision after cleanup, rather than vanish.
    if (fs.existsSync(readyTxt)) fs.unlinkSync(readyTxt);
    if (fs.existsSync(readyPid)) fs.unlinkSync(readyPid);
    configure({ test: nodeFile('ready.js') });
    await v2Edit('idle-during-cleanup');
    d.emit('session.execution.succeeded', 'idle-during-cleanup');
    await d.waitFor(() => fs.existsSync(readyTxt), { label: 'ready.js started for idle-during-cleanup' });
    const cleanupPid = Number(fs.readFileSync(readyPid, 'utf8'));
    await v2Edit('idle-during-cleanup');
    configure({ test: node('process.exit(0)') });
    d.emit('session.execution.succeeded', 'idle-during-cleanup');
    await d.waitFor(() => !isAlive(cleanupPid) && readEditState('idle-during-cleanup')?.verificationPending === false, { label: 'idle during cleanup verifies latest edit' });
    const afterCleanup = readEditState('idle-during-cleanup');
    helper.check('338. idle arriving during cancellation verifies the latest edit after cleanup',
      afterCleanup?.verificationPending === false && afterCleanup?.editsSinceVerification === 0 && !isAlive(cleanupPid) && d.prompts.length === beforeConcurrent,
      JSON.stringify(afterCleanup));

    if (fs.existsSync(readyTxt)) fs.unlinkSync(readyTxt);
    if (fs.existsSync(readyPid)) fs.unlinkSync(readyPid);
    configure({ test: nodeFile('ready.js') });
    await v2Edit('deleted-while-waiting');
    d.emit('session.execution.succeeded', 'deleted-while-waiting');
    await d.waitFor(() => fs.existsSync(readyTxt), { label: 'ready.js started for deleted-while-waiting' });
    const waitingPid = Number(fs.readFileSync(readyPid, 'utf8'));
    await v2Edit('deleted-while-waiting');
    d.emit('session.execution.succeeded', 'deleted-while-waiting');
    d.emit('session.deleted', 'deleted-while-waiting');
    await d.waitFor(() => !fs.existsSync(sessionDir('deleted-while-waiting')) && !isAlive(waitingPid), { label: 'deletion invalidates waiting verification' });
    await d.settled({ quietMs: 200 });
    helper.check('338. deletion invalidates an idle waiting for cancelled-child cleanup',
      !fs.existsSync(sessionDir('deleted-while-waiting')) && !isAlive(waitingPid) && d.prompts.length === beforeConcurrent);
  } finally {
    await d.teardown();
  }

  // Disposal leg in its own V2 harness so state files remain inspectable after dispose().
  const v2 = await createDisposableV2Harness();
  try {
    fs.writeFileSync(path.join(v2.workspace, 'package.json'), JSON.stringify({ name: 'async-disposal-fixture', scripts: { test: 'node "v2.js"' } }));
    fs.writeFileSync(path.join(v2.workspace, 'v2.js'), "const fs=require('fs');fs.writeFileSync('v2.pid',String(process.pid));fs.writeFileSync('v2-ready.txt','yes');setInterval(()=>fs.appendFileSync('v2-heartbeat.txt','x'),20)");
    const callEvent = {
      tool: 'edit',
      sessionID: 'v2-disposed',
      agent: 'build',
      messageID: 'msg-v2-disposed-1',
      id: '338-v2-disposed-1',
      input: { filePath: 'code.js' },
    };
    await v2.toolHook('execute.before')(callEvent);
    await v2.toolHook('execute.after')({ ...callEvent, status: 'completed', result: {} });
    v2.emit('session.execution.succeeded', 'v2-disposed');
    const disposalReady = path.join(v2.workspace, 'v2-ready.txt');
    const disposalPidFile = path.join(v2.workspace, 'v2.pid');
    const disposalHeartbeat = path.join(v2.workspace, 'v2-heartbeat.txt');
    await v2.waitFor(() => fs.existsSync(disposalReady) && fs.existsSync(disposalHeartbeat), { label: 'v2.js started for disposal' });
    const disposalPid = Number(fs.readFileSync(disposalPidFile, 'utf8'));
    await v2.dispose();
    const v2DisposedDir = path.join(workspaceState.getWorkspaceStateDir(v2.workspace), 'state', 'sessions', harnessState.sessionDirectoryName('v2-disposed'));
    const disposeStateFiles = ['edit-state.json', 'compliance.json'].map(name => path.join(v2DisposedDir, name));
    const stateAtDispose = disposeStateFiles.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
    const stopped = fs.statSync(disposalHeartbeat).size;
    await new Promise(resolve => setTimeout(resolve, 150));
    const stateStable = disposeStateFiles.every((file, index) =>
      (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) === stateAtDispose[index]);
    const editAtDispose = JSON.parse(stateAtDispose[0]);
    const complianceAtDispose = JSON.parse(stateAtDispose[1]);
    helper.check('338. V2 disposal waits for active child cleanup without late follow-up or compliance writes',
      !isAlive(disposalPid) && fs.statSync(disposalHeartbeat).size === stopped && v2.prompts.length === 0 && stateStable
        && editAtDispose.verificationPending === true && editAtDispose.followUpPending === false
        && complianceAtDispose.verifiedEdits === 0 && !Object.hasOwn(complianceAtDispose, 'circuitBreakerTrips')
        && !fs.existsSync(path.join(v2DisposedDir, 'circuit-breaker.json')),
      JSON.stringify({ alive: isAlive(disposalPid), stateStable, editAtDispose, complianceAtDispose, prompts: v2.prompts.length }));
  } finally {
    await v2.teardown();
  }

  helper.finish();
})().catch(error => { console.error(error); process.exit(1); });

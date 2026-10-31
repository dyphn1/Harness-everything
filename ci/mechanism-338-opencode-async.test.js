const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');

(async () => {
  const workspace = helper.tempDir('.mechanism-test-338-async');
  fs.mkdirSync(workspace, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  const prompts = [];
  const client = { session: { prompt: async value => { prompts.push(value.body.parts[0].text); } } };
  const mod = await import(pathToFileURL(path.join(helper.root, 'opencode-plugin/index.mjs')).href);
  const { HarnessEnforcement } = mod;
  const hooks = await HarnessEnforcement({ client, directory: workspace });
  const runner = require('./lib/opencode-verification-loader')(helper.root);
  const configure = scripts => fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'async-fixture', scripts }));
  const node = program => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(program)}`;
  let calls = 0;
  const edit = sessionID => hooks['tool.execute.after']({ tool: 'edit', sessionID, callID: `338-${++calls}`, args: { filePath: 'code.js' } }, {});
  const idle = sessionID => hooks.event({ event: { type: 'session.idle', properties: { sessionID } } });
  const waitFor = async predicate => {
    const deadline = Date.now()+5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('fixture did not become ready');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };

  configure({ test: node('setTimeout(() => {}, 600)') });
  await edit('heartbeat');
  let heartbeats = 0;
  const ticker = setInterval(() => { heartbeats++; }, 20);
  await idle('heartbeat');
  clearInterval(ticker);
  helper.check('338. slow verification leaves the plugin event loop responsive', heartbeats >= 3, `heartbeats=${heartbeats}`);

  configure({ test: node("for(let i=0;i<320;i++)process.stdout.write('x'.repeat(65536)); console.error('AssertionError: large-output-check');process.exitCode=1") });
  await edit('large-output');
  await idle('large-output');
  helper.check('338. output beyond the former 16 MiB cap preserves a real test verdict', /verification failed/.test(prompts.at(-1)) && /large-output-check/.test(prompts.at(-1)), prompts.at(-1));
  helper.check('338. streamed diagnostics stay bounded', prompts.at(-1).length < 2600, `prompt bytes=${prompts.at(-1).length}`);

  configure({ test: node('setTimeout(() => {}, 600)'), lint: node('setTimeout(() => {}, 600)'), build: node("require('fs').writeFileSync('must-not-build.txt','ran')") });
  process.env.HARNESS_VERIFY_TIMEOUT_MS = '1000';
  await edit('total-budget');
  const started = Date.now();
  const previous = prompts.length;
  await idle('total-budget');
  delete process.env.HARNESS_VERIFY_TIMEOUT_MS;
  helper.check('338. all scripts share one verification budget', prompts.length === previous+1 && /timed out/.test(prompts.at(-1)), `duration=${Date.now()-started}; ${prompts.at(-1)}`);
  helper.check('338. an expired sequence never launches later scripts', !fs.existsSync(path.join(workspace, 'must-not-build.txt')));

  const missing = await runner.runVerificationCommand(path.join(workspace, 'missing-cwd'), 'npm test', 2000);
  helper.check('338. spawn ENOENT is an execution error with no verdict', missing.outcome === 'execution_error' && missing.exitCode === null && /ENOENT/.test(missing.error), JSON.stringify(missing));
  const pass = await runner.runVerificationCommand(workspace, node('process.exit(0)'), 2000);
  helper.check('338. actual exit zero is pass', pass.success && pass.outcome === 'pass' && pass.exitCode === 0, JSON.stringify(pass));
  const failed = await runner.runVerificationCommand(workspace, node("console.log('FAIL parser.test.js');console.error('AssertionError: parse alpha');process.exitCode=2"), 2000);
  helper.check('338. nonzero exit preserves stderr marker and stdout suite context', failed.outcome === 'test_failure' && failed.exitCode === 2 && failed.failureMarker === 'FAIL parser.test.js: AssertionError: parse alpha' && /parse alpha/.test(failed.error), JSON.stringify(failed));

  const signature = (out, err, chunks = 10000) => {
    const stdout = runner.createVerificationCapture(), stderr = runner.createVerificationCapture();
    for (let i=0; i<out.length; i+=chunks) stdout.write(out.slice(i, i+chunks));
    for (let i=0; i<err.length; i+=chunks) stderr.write(err.slice(i, i+chunks));
    const a = stdout.finish(), b = stderr.finish();
    const marker = a.unsafeIdentity || b.unsafeIdentity ? null : a.marker
      ? `${a.markerContext ? `${a.markerContext}: ` : ''}${a.marker}`
      : b.marker ? `${b.markerContext || a.context ? `${b.markerContext || a.context}: ` : ''}${b.marker}` : null;
    return runner.buildFailureSignature({ command: 'npm test', outcome: 'test_failure', exitCode: 1,
      failureMarker: marker, evidenceDigest: crypto.createHash('sha256').update(`stdout:${a.digest}\nstderr:${b.digest}`).digest('hex').slice(0,16) });
  };
  const longPrefix = `not ok 1 - ${'same'.repeat(1500)}`;
  helper.check('338. truncated test identities use complete stream digests', signature(`${longPrefix} ALPHA\n`, '') !== signature(`${longPrefix} BETA\n`, ''));
  const observedLong = [];
  for (const name of ['ALPHA', 'BETA']) {
    fs.writeFileSync(path.join(workspace, 'long-marker.js'), `console.log(${JSON.stringify(longPrefix+name)});process.exitCode=1`);
    observedLong.push(await runner.runVerificationCommand(workspace, `${JSON.stringify(process.execPath)} long-marker.js`, 2000));
  }
  helper.check('338. real long-marker child verdicts cannot collide after truncation', observedLong.every(value => value.outcome === 'test_failure' && value.failureMarker === null) && runner.buildFailureSignature(observedLong[0]) !== runner.buildFailureSignature(observedLong[1]));
  helper.check('338. truncated suite contexts cannot merge distinct failures', signature(`FAIL ${longPrefix}ALPHA\n`, 'AssertionError: same assertion\n') !== signature(`FAIL ${longPrefix}BETA\n`, 'AssertionError: same assertion\n'));
  const stableFailures = [];
  for (const banner of ['ALPHA', 'BETA']) {
    fs.writeFileSync(path.join(workspace, 'volatile-banner.js'), `process.stdout.write('${banner}'+'x'.repeat(17*1024*1024));console.error('AssertionError: stable failure');process.exitCode=1`);
    stableFailures.push(await runner.runVerificationCommand(workspace, `${JSON.stringify(process.execPath)} volatile-banner.js`, 3000));
  }
  helper.check('338. huge volatile non-marker banners preserve a later stable failure identity', stableFailures.every(value => value.failureMarker === 'AssertionError: stable failure') && runner.buildFailureSignature(stableFailures[0]) === runner.buildFailureSignature(stableFailures[1]));
  const context = 'FAIL parser.test.js\n  ● Console\n    console.log\n      ● payload\n';
  const stderr = '  ● parser › alpha (1.2ms)\n';
  helper.check('338. chunk boundaries preserve marker and stream context', signature(context, stderr, 1) === signature(context, stderr, 10000) && /FAIL parser.test.js: ● parser › alpha/.test(signature(context, stderr, 1)));
  helper.check('338. markerless whitespace normalization survives chunk boundaries', signature('  progress \n still running   ', '   last  line ', 1) === signature('progress still running', 'last line', 10000));

  // Both shell and nested child remain in the inherited process group.
  fs.writeFileSync(path.join(workspace, 'grandchild.js'), "const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync('heartbeat.txt','x'),20)");
  fs.writeFileSync(path.join(workspace, 'worker.js'), "require('child_process').spawn(process.execPath,['grandchild.js'],{stdio:'inherit'});setInterval(()=>{},1000)");
  const cleanupResult = await runner.runVerificationCommand(workspace, `${JSON.stringify(process.execPath)} worker.js`, 700);
  const heartbeat = path.join(workspace, 'heartbeat.txt');
  const size = fs.existsSync(heartbeat) ? fs.statSync(heartbeat).size : -1;
  await new Promise(resolve => setTimeout(resolve, 200));
  helper.check('338. timeout stops nested SIGTERM-ignoring child output', cleanupResult.outcome === 'timeout' && size > 0 && fs.statSync(heartbeat).size === size, JSON.stringify({ cleanupResult, size }));
  if (process.platform !== 'win32') {
    const externalRunner = require('./lib/opencode-verification-loader')(helper.root, { spawn: (command, options) => {
      const child = require('child_process').spawn(command, options);
      setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 300);
      return child;
    } });
    const signalled = await externalRunner.runVerificationCommand(workspace, `${JSON.stringify(process.execPath)} worker.js`, 3000);
    const afterSignal = fs.statSync(heartbeat).size;
    await new Promise(resolve => setTimeout(resolve, 200));
    helper.check('338. early external signals are execution errors and also clean the group', signalled.outcome === 'execution_error' && signalled.signal === 'SIGTERM' && !signalled.timedOut && fs.statSync(heartbeat).size === afterSignal, JSON.stringify(signalled));
  }

  fs.writeFileSync(path.join(workspace, 'ready.js'), "require('fs').writeFileSync('ready.txt','yes');setInterval(()=>{},1000)");
  configure({ test: `${JSON.stringify(process.execPath)} ready.js` });
  await edit('edited-during-run');
  const beforeConcurrent = prompts.length;
  const active = idle('edited-during-run');
  await waitFor(() => fs.existsSync(path.join(workspace, 'ready.txt')));
  await Promise.all([idle('edited-during-run'), edit('edited-during-run')]);
  await active;
  const real = fs.realpathSync(workspace);
  const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = crypto.createHash('sha1').update(process.platform === 'win32' ? real.toLowerCase() : real).digest('hex').slice(0,12);
  const sessions = path.join(process.env.HARNESS_STATE_HOME, 'workspaces', `${slug}-${hash}`, 'state/sessions');
  const editedState = JSON.parse(fs.readFileSync(path.join(sessions, 'edited-during-run/edit-state.json')));
  helper.check('338. a concurrent edit cancels stale verification without duplicate follow-ups', editedState.verificationPending === true && editedState.editsSinceVerification === 2 && prompts.length === beforeConcurrent, JSON.stringify(editedState));
  configure({ test: node('process.exit(0)') });
  await idle('edited-during-run');
  helper.check('338. a fresh idle verifies the newer edits', JSON.parse(fs.readFileSync(path.join(sessions, 'edited-during-run/edit-state.json'))).verificationPending === false);

  fs.unlinkSync(path.join(workspace, 'ready.txt'));
  configure({ test: `${JSON.stringify(process.execPath)} ready.js` });
  await edit('deleted-during-run');
  const deleting = idle('deleted-during-run');
  await waitFor(() => fs.existsSync(path.join(workspace, 'ready.txt')));
  await hooks.event({ event: { type: 'session.deleted', properties: { sessionID: 'deleted-during-run' } } });
  await deleting;
  helper.check('338. session deletion aborts the runner without resurrecting state', !fs.existsSync(path.join(sessions, 'deleted-during-run')) && prompts.length === beforeConcurrent);

  // The V2 adapter must keep consuming reset/delete events while idle
  // verification is pending, and its disposer must await child cleanup.
  const queue = [], registrations = new Map();
  const dispose = await mod.default.setup({
    location: { directory: workspace },
    tool: { hook: async (name, callback) => { registrations.set(name, callback); } },
    session: { prompt: async value => { prompts.push(value.text); } },
    event: { subscribe: async function* ({ signal }) {
      while (!signal.aborted) {
        if (queue.length) yield queue.shift();
        else await new Promise(resolve => setTimeout(resolve, 5));
      }
    } },
  });
  fs.writeFileSync(path.join(workspace, 'v2.js'), "const fs=require('fs');fs.writeFileSync('v2-ready.txt','yes');setInterval(()=>fs.appendFileSync('v2-heartbeat.txt','x'),20)");
  configure({ test: `${JSON.stringify(process.execPath)} v2.js` });
  const v2Edit = sessionID => registrations.get('execute.after')({ tool: 'edit', sessionID, id: `338-v2-${++calls}`, input: { filePath: 'code.js' } });
  const v2Ready = path.join(workspace, 'v2-ready.txt');
  const v2Heartbeat = path.join(workspace, 'v2-heartbeat.txt');
  for (const type of ['session.deleted', 'session.created']) {
    const sessionID = `v2-${type}`;
    if (fs.existsSync(v2Ready)) fs.unlinkSync(v2Ready);
    await v2Edit(sessionID);
    queue.push({ type: 'session.idle', sessionID });
    await waitFor(() => fs.existsSync(v2Ready) && fs.existsSync(v2Heartbeat));
    queue.push({ type, sessionID });
    await waitFor(() => !fs.existsSync(path.join(sessions, sessionID)));
    await new Promise(resolve => setTimeout(resolve, 250));
    const stopped = fs.statSync(v2Heartbeat).size;
    await new Promise(resolve => setTimeout(resolve, 100));
    helper.check(`338. V2 consumes ${type} during verification and stops its child`, fs.statSync(v2Heartbeat).size === stopped && prompts.length === beforeConcurrent);
  }
  fs.unlinkSync(v2Ready);
  await v2Edit('v2-disposed');
  queue.push({ type: 'session.idle', sessionID: 'v2-disposed' });
  await waitFor(() => fs.existsSync(v2Ready));
  await dispose();
  const stopped = fs.statSync(v2Heartbeat).size;
  await new Promise(resolve => setTimeout(resolve, 150));
  helper.check('338. V2 disposal waits for active child cleanup without a stale follow-up', fs.statSync(v2Heartbeat).size === stopped && prompts.length === beforeConcurrent);
  // A new idle can arrive while an edit-cancelled child is still being reaped.
  // That idle must verify the newer revision after cleanup, rather than vanish.
  fs.unlinkSync(path.join(workspace, 'ready.txt'));
  configure({ test: `${JSON.stringify(process.execPath)} ready.js` });
  await edit('idle-during-cleanup');
  const cancellingIdle = idle('idle-during-cleanup');
  await waitFor(() => fs.existsSync(path.join(workspace, 'ready.txt')));
  await edit('idle-during-cleanup');
  configure({ test: node('process.exit(0)') });
  await Promise.all([cancellingIdle, idle('idle-during-cleanup')]);
  const afterCleanup = JSON.parse(fs.readFileSync(path.join(sessions, 'idle-during-cleanup/edit-state.json')));
  helper.check('338. idle arriving during cancellation verifies the latest edit after cleanup',
    afterCleanup.verificationPending === false && afterCleanup.editsSinceVerification === 0 && prompts.length === beforeConcurrent,
    JSON.stringify(afterCleanup));

  fs.unlinkSync(path.join(workspace, 'ready.txt'));
  configure({ test: `${JSON.stringify(process.execPath)} ready.js` });
  await edit('deleted-while-waiting');
  const runningBeforeDelete = idle('deleted-while-waiting');
  await waitFor(() => fs.existsSync(path.join(workspace, 'ready.txt')));
  await edit('deleted-while-waiting');
  const waitingDuringDelete = idle('deleted-while-waiting');
  await hooks.event({ event: { type: 'session.deleted', properties: { sessionID: 'deleted-while-waiting' } } });
  await Promise.all([runningBeforeDelete, waitingDuringDelete]);
  helper.check('338. deletion invalidates an idle waiting for cancelled-child cleanup',
    !fs.existsSync(path.join(sessions, 'deleted-while-waiting')) && prompts.length === beforeConcurrent);
  helper.finish();
})().catch(error => { console.error(error); process.exit(1); });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');

console.log('\n[39] opencode verification outcomes and reminders with the real plugin...');

(async () => {
  const workspace = helper.tempDir('.mechanism-test-verify-outcomes-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const stateHome = process.env.HARNESS_STATE_HOME;
  const realWorkspace = fs.realpathSync(path.resolve(workspace));
  const slug = path.basename(realWorkspace).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  const sessionsRoot = path.join(stateHome, 'workspaces', `${slug}-${hash}`, 'state', 'sessions');
  const fixtureFile = path.join(workspace, 'fixture.js');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'fixture', version: '0.0.0', scripts: { test: 'node fixture.js' }
  }, null, 2));
  const setFixture = (source) => fs.writeFileSync(fixtureFile, `${source}\n`);

  const promptCalls = [];
  const client = { session: { prompt: async (opts) => { promptCalls.push(opts); return {}; } } };
  const { HarnessEnforcement } = await import(pathToFileURL(path.join(helper.root, 'opencode-plugin', 'index.mjs')).href);
  const hooks = await HarnessEnforcement({ client, directory: workspace });
  let callCounter = 0;
  const sessionID = 'repeated-failures';
  const edit = async (id = sessionID) => {
    await hooks['tool.execute.before']({ tool: 'edit', sessionID: id, callID: `before-${++callCounter}` }, { args: {} });
    await hooks['tool.execute.after'](
      { tool: 'edit', sessionID: id, callID: `after-${callCounter}` },
      { title: '', output: '', metadata: {}, args: { filePath: path.join(workspace, 'code.js') } },
    );
  };
  const idle = async (id = sessionID) => hooks.event({ event: { type: 'session.idle', properties: { sessionID: id } } });
  const stateFile = (id, name) => path.join(sessionsRoot, id, name);
  const lastPrompt = () => promptCalls[promptCalls.length - 1].body.parts[0].text;

  setFixture("console.error('AssertionError [ERR_ASSERTION]: stable fixture failure');process.exit(1);");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let allowed = true;
    try {
      await edit();
    } catch {
      allowed = false;
    }
    if (!allowed) break;
    await idle();
  }
  const failedPrompts = promptCalls.map((call) => call.body.parts[0].text);
  helper.check(
    '39. four identical test failures each produce a reminder and do not block the next edit',
    failedPrompts.length === 4 && failedPrompts.every((text) => /verification failed/i.test(text)
      && !/reflection token|## Goal|forced reflection|retries before/i.test(text)),
    JSON.stringify(failedPrompts),
  );
  helper.check(
    '39. repeated test failures create no recurrence state',
    !fs.existsSync(stateFile(sessionID, 'circuit-breaker.json')),
    stateFile(sessionID, 'circuit-breaker.json'),
  );
  let readAllowed = true;
  try {
    await hooks['tool.execute.before']({ tool: 'read', sessionID, callID: 'read-after-failures' }, { args: {} });
  } catch {
    readAllowed = false;
  }
  helper.check('39. a permitted read remains available after repeated failures', readAllowed);

  const timeoutSession = 'timeout';
  setFixture('setTimeout(() => {}, 3000);');
  process.env.HARNESS_VERIFY_TIMEOUT_MS = '100';
  await edit(timeoutSession);
  await idle(timeoutSession);
  delete process.env.HARNESS_VERIFY_TIMEOUT_MS;
  helper.check(
    '39. a timeout is reported as incomplete verification without reflection or a counter',
    /did not complete/.test(lastPrompt()) && /timed out/.test(lastPrompt())
      && !/reflection token|## Goal|does NOT count|retries before/i.test(lastPrompt())
      && !fs.existsSync(stateFile(timeoutSession, 'circuit-breaker.json')),
    lastPrompt(),
  );

  const recoverSession = 'recover';
  setFixture("console.error('AssertionError [ERR_ASSERTION]: recoverable failure');process.exit(1);");
  await edit(recoverSession);
  await idle(recoverSession);
  const promptsBeforeSuccess = promptCalls.length;
  setFixture('process.exit(0);');
  await edit(recoverSession);
  await idle(recoverSession);
  const recoveredState = JSON.parse(fs.readFileSync(stateFile(recoverSession, 'edit-state.json'), 'utf8'));
  helper.check(
    '39. a passing verification clears pending state without an extra reminder',
    recoveredState.verificationPending === false && recoveredState.editsSinceVerification === 0
      && promptCalls.length === promptsBeforeSuccess
      && !fs.existsSync(stateFile(recoverSession, 'circuit-breaker.json')),
    JSON.stringify(recoveredState),
  );

  helper.finish();
})().catch((err) => {
  console.error('39. verification outcomes test crashed:', err);
  process.exit(1);
});

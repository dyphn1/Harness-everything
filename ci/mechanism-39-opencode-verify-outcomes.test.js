const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helper = require('./test-helper');
const { createV2Driver } = require('./lib/opencode-v2-driver');

console.log('\n[39] opencode verification outcomes and reminders with the real plugin...');

(async () => {
  const d = await createV2Driver({
    scripts: { test: 'node fixture.js' },
  });
  try {
    const realWorkspace = fs.realpathSync.native(path.resolve(d.workspace));
    const slug = path.basename(realWorkspace).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
    const hashInput = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace;
    const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
    const sessionsRoot = path.join(d.stateHome, 'workspaces', `${slug}-${hash}`, 'state', 'sessions');
    const fixtureFile = path.join(d.workspace, 'fixture.js');
    const setFixture = (source) => fs.writeFileSync(fixtureFile, `${source}\n`);

    let callCounter = 0;
    const sessionID = 'repeated-failures';
    const edit = async (id = sessionID) => {
      const callId = `call-${++callCounter}`;
      const event = {
        tool: 'edit',
        sessionID: id,
        agent: 'build',
        messageID: `msg-${callCounter}`,
        id: callId,
        input: { filePath: path.join(d.workspace, 'code.js') },
      };
      await d.toolHook('execute.before')(event);
      await d.toolHook('execute.after')({ ...event, status: 'completed', result: {} });
    };
    const turnEnd = (id = sessionID) => d.emit('session.execution.succeeded', id);
    const stateFile = (id, name) => path.join(sessionsRoot, id, name);
    const lastPrompt = () => d.prompts[d.prompts.length - 1].text;

    setFixture("console.error('AssertionError [ERR_ASSERTION]: stable fixture failure');process.exit(1);");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let allowed = true;
      try {
        await edit();
      } catch {
        allowed = false;
      }
      if (!allowed) break;
      const expectedPrompts = d.prompts.length + 1;
      turnEnd();
      await d.waitFor(() => d.prompts.length >= expectedPrompts, {
        label: `failure reminder #${attempt + 1}`,
      });
    }
    const failedPrompts = d.prompts.map((call) => call.text);
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
      await d.toolHook('execute.before')({
        tool: 'read',
        sessionID,
        agent: 'build',
        messageID: `msg-${++callCounter}`,
        id: 'read-after-failures',
        input: {},
      });
    } catch {
      readAllowed = false;
    }
    helper.check('39. a permitted read remains available after repeated failures', readAllowed);

    const timeoutSession = 'timeout';
    setFixture('setTimeout(() => {}, 3000);');
    process.env.HARNESS_VERIFY_TIMEOUT_MS = '100';
    const promptsBeforeTimeout = d.prompts.length;
    try {
      await edit(timeoutSession);
      turnEnd(timeoutSession);
      await d.waitFor(() => d.prompts.length > promptsBeforeTimeout, {
        label: 'timeout verification reminder',
      });
    } finally {
      delete process.env.HARNESS_VERIFY_TIMEOUT_MS;
    }
    helper.check(
      '39. a timeout is reported as incomplete verification without reflection or a counter',
      /did not complete/.test(lastPrompt()) && /timed out/.test(lastPrompt())
        && !/reflection token|## Goal|does NOT count|retries before/i.test(lastPrompt())
        && !fs.existsSync(stateFile(timeoutSession, 'circuit-breaker.json')),
      lastPrompt(),
    );

    const recoverSession = 'recover';
    setFixture("console.error('AssertionError [ERR_ASSERTION]: recoverable failure');process.exit(1);");
    const promptsBeforeRecoverFail = d.prompts.length;
    await edit(recoverSession);
    turnEnd(recoverSession);
    await d.waitFor(() => d.prompts.length > promptsBeforeRecoverFail, {
      label: 'recoverable failure reminder',
    });
    const promptsBeforeSuccess = d.prompts.length;
    setFixture('process.exit(0);');
    await edit(recoverSession);
    turnEnd(recoverSession);
    await d.waitFor(() => {
      const file = stateFile(recoverSession, 'edit-state.json');
      if (!fs.existsSync(file)) return false;
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      return state.verificationPending === false && state.editsSinceVerification === 0;
    }, { label: 'passing verification clears pending state' });
    await d.settled({ quietMs: 200 });
    const recoveredState = JSON.parse(fs.readFileSync(stateFile(recoverSession, 'edit-state.json'), 'utf8'));
    helper.check(
      '39. a passing verification clears pending state without an extra reminder',
      recoveredState.verificationPending === false && recoveredState.editsSinceVerification === 0
        && d.prompts.length === promptsBeforeSuccess
        && !fs.existsSync(stateFile(recoverSession, 'circuit-breaker.json')),
      JSON.stringify(recoveredState),
    );
  } finally {
    await d.teardown();
  }

  helper.finish();
})().catch((err) => {
  console.error('39. verification outcomes test crashed:', err);
  process.exit(1);
});

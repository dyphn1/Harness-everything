const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const helper = require('./test-helper');

console.log('\n[39] opencode verification outcomes: Rule-of-3 downstream behavior with the real plugin...');

(async () => {
  const workspace = helper.tempDir('.mechanism-test-verify-outcomes-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const stateHome = process.env.HARNESS_STATE_HOME;

  // Mirrors the plugin's getWorkspaceKey(directory) (same derivation as the
  // 2n test) so this harness can read the state files the real hooks write.
  const realWorkspace = fs.realpathSync(path.resolve(workspace));
  const slug = path.basename(realWorkspace).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  const sessionsRoot = path.join(stateHome, 'workspaces', `${slug}-${hash}`, 'state', 'sessions');

  const fixtureFile = path.join(workspace, 'fixture.js');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: 'node fixture.js' } }, null, 2),
  );
  const setFixture = (lines) => fs.writeFileSync(fixtureFile, `${lines.join('\n')}\n`);
  const markerFailure = (name) => [
    "console.log('> harness-everything@0.34.0 test');",
    "console.log('> node self-evolve/scripts/self-regression.js');",
    `console.log('\u2716 ${name} (1.2ms)');`,
    `console.log('AssertionError [ERR_ASSERTION]: ${name} boom');`,
    'process.exit(1);',
  ];

  const promptCalls = [];
  const client = { session: { prompt: async (opts) => { promptCalls.push(opts); return {}; } } };
  const { HarnessEnforcement } = await import(pathToFileURL(path.join(helper.root, 'opencode-plugin', 'index.mjs')).href);
  const hooks = await HarnessEnforcement({ client, directory: workspace });

  const stateFile = (sessionID, name) => path.join(sessionsRoot, sessionID, name);
  const readBreaker = (sessionID) => JSON.parse(fs.readFileSync(stateFile(sessionID, 'circuit-breaker.json'), 'utf8'));
  const readEditState = (sessionID) => JSON.parse(fs.readFileSync(stateFile(sessionID, 'edit-state.json'), 'utf8'));
  let callCounter = 0;
  const edit = async (sessionID) => hooks['tool.execute.after'](
    { tool: 'edit', sessionID, callID: `edit-${(callCounter += 1)}` },
    { title: '', output: '', metadata: {}, args: { filePath: path.join(workspace, 'code.js') } },
  );
  const idle = async (sessionID) => hooks.event({ event: { type: 'session.idle', properties: { sessionID } } });
  const lastPrompt = () => promptCalls[promptCalls.length - 1].body.parts[0].text;

  // --- three timeouts must not band together into a reflection ----------
  const timeoutSession = 'timeouts';
  setFixture(['setTimeout(() => {}, 3000);']);
  process.env.HARNESS_VERIFY_TIMEOUT_MS = '150';
  for (let i = 0; i < 3; i += 1) {
    await edit(timeoutSession);
    await idle(timeoutSession);
  }
  delete process.env.HARNESS_VERIFY_TIMEOUT_MS;
  const timeoutPrompts = promptCalls.slice(0, 3).map((call) => call.body.parts[0].text);
  helper.check(
    '39. three timeouts never write a same-check failure entry',
    !fs.existsSync(stateFile(timeoutSession, 'circuit-breaker.json')),
    'a circuit-breaker file was written for pure timeouts',
  );
  helper.check(
    '39. timeout follow-ups say the run did not complete and is not counted',
    timeoutPrompts.length === 3 &&
      timeoutPrompts.every((text) => /did not complete/.test(text) && /does NOT count toward the repeated-failure reflection/.test(text)) &&
      !timeoutPrompts.some((text) => /reflection token|## Goal/.test(text)),
    timeoutPrompts[0],
  );

  setFixture(markerFailure('real test A'));
  await edit(timeoutSession);
  await idle(timeoutSession);
  let breaker = readBreaker(timeoutSession);
  let entries = Object.values(breaker.failures);
  helper.check(
    '39. a real failing check after three timeouts counts once, with no reflection',
    entries.length === 1 && entries[0].count === 1 && breaker.reflectionPending === false,
    JSON.stringify(breaker),
  );
  helper.check(
    '39. the post-timeout failure prompt offers retries instead of reflection',
    /2 retries before a forced reflection/.test(lastPrompt()),
    lastPrompt(),
  );

  // --- distinct failures sharing a banner stay distinct -----------------
  const distinctSession = 'distinct';
  for (const name of ['alpha', 'beta', 'gamma']) {
    setFixture(markerFailure(name));
    await edit(distinctSession);
    await idle(distinctSession);
  }
  breaker = readBreaker(distinctSession);
  entries = Object.values(breaker.failures);
  helper.check(
    '39. distinct failures behind a common banner stay three separate signatures',
    Object.keys(breaker.failures).length === 3 && entries.every((entry) => entry.count === 1) && breaker.reflectionPending === false,
    JSON.stringify(breaker),
  );

  // --- genuinely identical failures keep the Rule of 3 ------------------
  const identicalSession = 'identical';
  setFixture(markerFailure('stable check'));
  for (let i = 0; i < 3; i += 1) {
    await edit(identicalSession);
    await idle(identicalSession);
  }
  breaker = readBreaker(identicalSession);
  entries = Object.values(breaker.failures);
  helper.check(
    '39. three genuinely identical failures still force the Rule-of-3 reflection',
    Object.keys(breaker.failures).length === 1 && entries[0].count === 3 && breaker.reflectionPending === true,
    JSON.stringify(breaker),
  );
  helper.check(
    '39. the forced reflection names the token and required report sections',
    /reflection token: [A-Za-z0-9]+/.test(lastPrompt()) && /## Goal/.test(lastPrompt()) && /## Decision/.test(lastPrompt()),
    lastPrompt(),
  );

  // --- success after failure clears pending state -----------------------
  const recoverSession = 'recover';
  setFixture(markerFailure('recover check'));
  await edit(recoverSession);
  await idle(recoverSession);
  const promptsBeforeSuccess = promptCalls.length;
  setFixture(['process.exit(0);']);
  await edit(recoverSession);
  await idle(recoverSession);
  const recoveredState = readEditState(recoverSession);
  breaker = readBreaker(recoverSession);
  entries = Object.values(breaker.failures);
  helper.check(
    '39. a passing run after a failure clears pending verification without erasing failure history',
    recoveredState.verificationPending === false &&
      recoveredState.editsSinceVerification === 0 &&
      promptCalls.length === promptsBeforeSuccess &&
      entries[0].count === 1,
    JSON.stringify({ recoveredState, breaker }),
  );

  helper.finish();
})().catch((err) => {
  console.error('39. verification outcomes test crashed:', err);
  process.exit(1);
});

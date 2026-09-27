const helper = require('./test-helper');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildEngineInvocation, buildWorkspace, runFixtureSetup, prepareWorkspace, summarizePairResults } = require('../behavioral-evals/run');

console.log('\n[2j] Behavioral runner argv integrity...');
const prompt = "Add punctuation stripping to slug.js, then run npm test. Do not truncate this request.";
for (const engine of ['opencode', 'claude']) {
  const invocation = buildEngineInvocation(engine, prompt, 'C:/fixture with spaces', 16);
  helper.check(
    `2j. ${engine} receives the complete prompt as one argv value`,
    invocation.args.includes(prompt),
    JSON.stringify(invocation.args)
  );
}

const baseline = buildEngineInvocation('claude', prompt, 'C:/fixture with spaces', 16, 'baseline');
helper.check('2j. Claude baseline excludes user customizations', baseline.args.includes('--safe-mode') && baseline.args.includes('--setting-sources') && baseline.args.includes('project,local'), JSON.stringify(baseline.args));
const treatment = buildEngineInvocation('claude', prompt, 'C:/fixture with spaces', 16, 'treatment');
helper.check('2j. Claude treatment keeps only project/local customizations', treatment.args.includes('--setting-sources') && treatment.args.includes('project,local') && !treatment.args.includes('--safe-mode'), JSON.stringify(treatment.args));
helper.check('2j. Claude emits parseable verbose stream JSON', treatment.args.includes('--output-format') && treatment.args.includes('stream-json') && treatment.args.includes('--verbose') && !treatment.args.includes('json'), JSON.stringify(treatment.args));

let validWorkspace = null;
try {
  validWorkspace = buildWorkspace({
    id: 'fixture-valid',
    fixture: { files: [{ path: 'nested/fixture.txt', content: 'fixture smoke proof' }] },
  });
  helper.check(
    '2j. behavioral workspace builder accepts a valid nested fixture through the public execution contract',
    fs.readFileSync(path.join(validWorkspace, 'nested', 'fixture.txt'), 'utf8') === 'fixture smoke proof\n',
    validWorkspace
  );
} catch (error) {
  helper.check(
    '2j. behavioral workspace builder accepts a valid nested fixture through the public execution contract',
    false,
    error && error.stack ? error.stack : String(error)
  );
} finally {
  if (validWorkspace) fs.rmSync(validWorkspace, { recursive: true, force: true });
}

const traversalTarget = path.join(os.tmpdir(), `harness-behavioral-traversal-${process.pid}-${Date.now()}.txt`);
let traversalError = null;
try {
  buildWorkspace({ id: 'fixture-traversal', fixture: { files: [{ path: `../${path.basename(traversalTarget)}`, content: 'path traversal proof' }] } });
} catch (error) {
  traversalError = error;
}
helper.check(
  '2j. behavioral fixtures reject traversal for the expected boundary reason',
  Boolean(
    traversalError &&
    /path must stay inside the generated workspace/.test(traversalError.message) &&
    !fs.existsSync(traversalTarget)
  ),
  traversalError && traversalError.stack ? traversalError.stack : traversalTarget
);

let setupWorkspace = null;
try {
  setupWorkspace = buildWorkspace({
    id: 'fixture-setup-valid',
    fixture: {
      files: [{ path: 'seed.txt', content: 'seed' }],
      setup: 'behavioral-evals/fixtures/setup/noop.js',
    },
  });
  const setupResult = runFixtureSetup({
    id: 'fixture-setup-valid',
    fixture: { setup: 'behavioral-evals/fixtures/setup/noop.js' },
  }, setupWorkspace);
  helper.check(
    '2j. fixture setup runs via Node in the generated workspace',
    setupResult.status === 'pass' &&
      fs.readFileSync(path.join(setupWorkspace, '.fixture-setup-ok'), 'utf8') === 'ok\n',
    JSON.stringify(setupResult)
  );
} catch (error) {
  helper.check('2j. fixture setup runs via Node in the generated workspace', false, error && error.stack ? error.stack : String(error));
} finally {
  if (setupWorkspace) fs.rmSync(setupWorkspace, { recursive: true, force: true });
}

let failedPreparation = null;
try {
  failedPreparation = prepareWorkspace({
    id: 'fixture-setup-fails',
    fixture: {
      files: [{ path: 'seed.txt', content: 'seed' }],
      setup: 'behavioral-evals/fixtures/setup/fail.js',
    },
  });
} catch (error) {
  failedPreparation = { threw: error && error.stack ? error.stack : String(error) };
}
helper.check(
  '2j. setup failure is classified as fixture-error before any model session',
  Boolean(
    failedPreparation &&
    failedPreparation.ok === false &&
    failedPreparation.outcome === 'fixture-error' &&
    failedPreparation.setup &&
    failedPreparation.setup.status === 'fail' &&
    failedPreparation.setup.exit_code === 17
  ),
  JSON.stringify(failedPreparation)
);
if (failedPreparation && failedPreparation.workspace) {
  fs.rmSync(failedPreparation.workspace, { recursive: true, force: true });
}

let topologyPreparation = null;
try {
  topologyPreparation = prepareWorkspace({
    id: 'worktree-submodule-setup-smoke',
    fixture: {
      files: [{ path: 'README.md', content: 'topology smoke' }],
      setup: 'behavioral-evals/fixtures/setup/worktree-submodule.js',
    },
  });
  const linkedSub = topologyPreparation.ok
    ? path.join(topologyPreparation.workspace, 'super-wt', 'libs', 'sub')
    : null;
  const branchResult = linkedSub
    ? spawnSync('git', ['-C', linkedSub, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true })
    : null;
  const helperResult = topologyPreparation.ok
    ? spawnSync(process.execPath, [
        path.join(topologyPreparation.workspace, '.fixture-tools', 'submodule-reachability.js'),
        '--json', '--root', 'super-wt',
      ], { cwd: topologyPreparation.workspace, encoding: 'utf8', windowsHide: true })
    : null;
  helper.check(
    '2j. worktree/submodule setup creates the real #243 topology before model execution',
    Boolean(
      topologyPreparation.ok &&
      fs.existsSync(path.join(topologyPreparation.workspace, 'super-wt', '.git')) &&
      fs.existsSync(path.join(linkedSub, '.git')) &&
      branchResult && branchResult.status === 0 && branchResult.stdout.trim() === '' &&
      helperResult && helperResult.status === 0
    ),
    JSON.stringify({
      preparation: topologyPreparation,
      branchStatus: branchResult && branchResult.status,
      branch: branchResult && branchResult.stdout,
      helperStatus: helperResult && helperResult.status,
      helperStderr: helperResult && helperResult.stderr,
    })
  );
} catch (error) {
  helper.check(
    '2j. worktree/submodule setup creates the real #243 topology before model execution',
    false,
    error && error.stack ? error.stack : String(error)
  );
} finally {
  if (topologyPreparation && topologyPreparation.workspace) {
    fs.rmSync(topologyPreparation.workspace, { recursive: true, force: true });
  }
}

const fixtureFailureSummary = summarizePairResults([{
  id: 'fixture-error-pair',
  pressure_category: null,
  arms: {
    baseline: { outcome: 'fixture-error', cost: null, tool_call_count: null },
    treatment: { outcome: 'pass', cost: null, tool_call_count: 1 },
  },
}]);
helper.check(
  '2j. fixture errors remain distinct aggregate infrastructure failures',
  fixtureFailureSummary.fixture_failures === 1 &&
    fixtureFailureSummary.session_failures === 0 &&
    fixtureFailureSummary.completed_pairs === 0,
  JSON.stringify(fixtureFailureSummary)
);

helper.finish();

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'scripts', 'dispatch.js');
const fixtureRunner = path.join(__dirname, 'fixtures', '468-dispatch', 'runner.js');
const tempParent = process.env.TMPDIR || os.tmpdir();
const rootReal = fs.realpathSync.native(root);
const tempRelative = path.relative(rootReal, fs.realpathSync.native(path.resolve(tempParent)));
assert.ok(tempRelative === '..' || tempRelative.startsWith(`..${path.sep}`) || path.isAbsolute(tempRelative), 'test TMPDIR must be outside the repository');

function canonicalPath(file) {
  const resolved = fs.realpathSync.native(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertSameCanonicalPath(actual, expected, message) {
  assert.equal(canonicalPath(actual), canonicalPath(expected), message);
}

const fixtureRoot = fs.mkdtempSync(path.join(tempParent, '468-dispatch-p2-'));
const repositoryParent = path.join(fixtureRoot, 'repository parent');
const worktree = path.join(repositoryParent, 'worktree with spaces');
const linkedWorktree = path.join(repositoryParent, 'linked worktree');
const symlinkedParent = path.join(fixtureRoot, 'symlinked parent');
const reports = path.join(fixtureRoot, 'reports with spaces');
const runnerBin = path.join(fixtureRoot, 'runner bin');
const openCodeOnlyBin = path.join(fixtureRoot, 'opencode only bin');
const packet = path.join(worktree, 'packet with spaces.md');
const failures = [];
const passed = [];
let caseNumber = 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function makeRepository() {
  fs.mkdirSync(repositoryParent, { recursive: true });
  fs.mkdirSync(worktree);
  run('git', ['init', '--quiet', worktree]);
  run('git', ['-C', worktree, 'config', 'user.name', 'Dispatch Fixture']);
  run('git', ['-C', worktree, 'config', 'user.email', 'dispatch-fixture@example.invalid']);
  fs.writeFileSync(packet, 'P2 fixture packet\n');
  run('git', ['-C', worktree, 'add', 'packet with spaces.md']);
  run('git', ['-C', worktree, 'commit', '--quiet', '-m', 'fixture']);
  run('git', ['-C', worktree, 'worktree', 'add', '--quiet', '--detach', linkedWorktree, 'HEAD']);
}

function linkNodeExecutable(bin, name) {
  const executable = path.join(bin, process.platform === 'win32' ? `${name}.exe` : name);
  if (process.platform === 'win32') {
    try { fs.linkSync(process.execPath, executable); } catch { fs.copyFileSync(process.execPath, executable); }
  } else fs.symlinkSync(process.execPath, executable);
}

function makeRunnerPath() {
  fs.mkdirSync(runnerBin);
  fs.mkdirSync(openCodeOnlyBin);
  for (const name of ['codex', 'opencode']) linkNodeExecutable(runnerBin, name);
  linkNodeExecutable(openCodeOnlyBin, 'opencode');
  fs.copyFileSync(fixtureRunner, path.join(worktree, 'exec'));
  fs.copyFileSync(fixtureRunner, path.join(worktree, 'run'));
}

function makeCase(label) {
  caseNumber += 1;
  return {
    scratch: path.join(fixtureRoot, `scratch ${caseNumber} ${label}`),
    report: path.join(reports, `report ${caseNumber} ${label}.md`),
    log: path.join(fixtureRoot, `runner events ${caseNumber}.jsonl`),
  };
}

function argsFor(testCase, runner = 'codex', model = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model') {
  return [
    '--runner', runner,
    '--model', model,
    '--packet', packet,
    '--worktree', worktree,
    '--scratch', testCase.scratch,
    '--report', testCase.report,
  ];
}

function cli(args, testCase, config = {}) {
  const env = {
    ...process.env,
    PATH: config.path || runnerBin,
    TMPDIR: testCase.scratch,
    NODE_ENV: 'test',
    DISPATCH_TEST_TIMEOUT_MS: String(config.testTimeoutMs || 750),
    DISPATCH_FIXTURE_LOG: testCase.log,
    DISPATCH_FIXTURE_REPORT_PATH: testCase.report,
    DISPATCH_FIXTURE_READINESS: config.readiness || 'ready',
    DISPATCH_FIXTURE_EXECUTION: config.execution || 'done',
  };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    input: 'parent stdin must not reach the runner\n',
    timeout: config.outerTimeoutMs || 15000,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    for (const event of events(testCase)) {
      try { process.kill(event.pid, 'SIGKILL'); } catch {}
    }
  }
  return result;
}

function jsonResponse(result, exitCode, code) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, exitCode, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1, result.stdout);
  const response = JSON.parse(result.stdout);
  assert.equal(response.code, code);
  assert.equal(response.ok, exitCode === 0);
  return response;
}

function events(testCase) {
  if (!fs.existsSync(testCase.log)) return [];
  return fs.readFileSync(testCase.log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function check(name, body) {
  try {
    body();
    passed.push(name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function assertNoRunner(testCase) {
  assert.deepEqual(events(testCase), []);
}

function assertNoScratchOrReport(testCase) {
  assert.equal(fs.existsSync(testCase.scratch), false);
  assert.equal(fs.existsSync(testCase.report), false);
}

function assertEvent(event, testCase, runner, phase, model = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model') {
  assert.equal(event.runner, runner);
  assert.equal(event.phase, phase);
  assertSameCanonicalPath(event.cwd, worktree, 'child cwd must resolve to the requested worktree');
  assert.equal(event.tmpdir, testCase.scratch);
  assert.equal(event.stdin, '');
  assert.equal(event.stdinIsCharacterDevice, true);
  assert.equal(event.args[event.args.indexOf('-m') + 1], model);
  assert.equal(event.args.at(-1), phase === 'readiness'
    ? 'Reply exactly with READY.'
    : `Execute the packet at ${packet} and ${runner === 'codex' ? 'return the complete report body.' : `write the complete report to ${testCase.report}.`}`);
}

function assertProcessExited(pid) {
  let error;
  try { process.kill(pid, 0); } catch (cause) { error = cause; }
  assert.equal(error?.code, 'ESRCH', `child process ${pid} is still running`);
}

function removeOption(args, option) {
  const index = args.indexOf(option);
  if (index >= 0) args.splice(index, 2);
  return args;
}

function assertNoExecutionAfterReadinessFailure(testCase, runner, response, model = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model') {
  assert.equal(typeof response.code, 'string');
  assert.equal(typeof response.ok, 'boolean');
  assert.equal(response.phase, 'readiness');
  assert.equal(response.runner, runner);
  assert.equal(response.model, model);
  assert.deepEqual(Object.keys(response).sort(), ['code', 'evidence', 'message', 'model', 'ok', 'phase', 'runner'].sort());
  const actualEvents = events(testCase);
  assert.equal(actualEvents.length, 1, 'refusal must make one readiness call and no execution or fallback call');
  assertEvent(actualEvents[0], testCase, runner, 'readiness', model);
  assert.equal(fs.existsSync(testCase.report), false);
  assert.ok(response.evidence?.readinessLog, 'refusal should retain readiness evidence');
  for (const key of ['runLog', 'rawOutput', 'reportWriterLog']) {
    assert.equal(response.evidence[key], undefined, `${key} must not be created before a successful readiness check`);
  }
  const files = fs.readdirSync(testCase.scratch);
  assert.equal(files.some(file => /(?:raw\.txt|run\.log|report-writer\.log)$/.test(file)), false);
}

function assertReadinessRefusal(testCase, runner, response, model = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model') {
  assert.equal(response.message, 'Readiness failed. Keep the available child evidence.');
  assertNoExecutionAfterReadinessFailure(testCase, runner, response, model);
}

function runSuccessAndArgvMatch(runner, requestedModel = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model') {
  const testCase = makeCase(`${runner} success`);
  const model = requestedModel.trim();
  const args = argsFor(testCase, runner, requestedModel);
  const dryRun = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
  assert.equal(dryRun.model, model);
  assert.equal(dryRun.argv[dryRun.argv.indexOf('-m') + 1], model);
  assertSameCanonicalPath(dryRun.cwd, worktree, 'dry-run cwd must resolve to the requested worktree');
  assert.equal(dryRun.argv[0], runner);
  assertNoRunner(testCase);
  assertNoScratchOrReport(testCase);

  const result = jsonResponse(cli([...args, '--json'], testCase), 0, 'DONE');
  assert.equal(result.runner, runner);
  assert.equal(result.model, model);
  assert.equal(fs.existsSync(testCase.scratch), true);
  assert.equal(fs.readFileSync(result.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
  const actualEvents = events(testCase);
  assert.equal(actualEvents.length, 2, 'one readiness and one execution; no retry or fallback');
  for (const event of actualEvents) assertEvent(event, testCase, runner, event.phase, model);
  const observedArgv = [actualEvents[1].runner, ...actualEvents[1].args];
  if (runner === 'codex') {
    const outputIndex = observedArgv.indexOf('-o') + 1;
    assert.ok(outputIndex > 0);
    assert.equal(path.dirname(observedArgv[outputIndex]), testCase.scratch);
    observedArgv[outputIndex] = dryRun.argv[outputIndex];
    assert.match(dryRun.argv[outputIndex], /<run-id>/);
  }
  assert.deepEqual(dryRun.argv, observedArgv);
  assertSameCanonicalPath(dryRun.cwd, actualEvents[1].cwd, 'dry-run and child cwd must identify the same directory');
  if (runner === 'codex') {
    const writerLog = fs.readFileSync(result.evidence.reportWriterLog, 'utf8');
    assert.ok(writerLog.includes(`Wrote ${testCase.report}`));
    assert.ok(writerLog.includes('valid (STATUS: DONE)'));
  } else {
    assert.match(fs.readFileSync(result.evidence.reportWriterLog, 'utf8'), /valid \(STATUS: DONE\)/);
  }
}

function runReportInvalidCase(runner, scenario) {
  const testCase = makeCase(`${runner} ${scenario}`);
  const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { execution: scenario }), 16, 'REPORT_INVALID');
  assert.equal(events(testCase).length, 2, 'no execution retry or runner fallback');
  for (const event of events(testCase)) assert.equal(event.runner, runner);
  assert.equal(fs.existsSync(testCase.report), runner === 'opencode' && scenario !== 'missing-report');
  return response;
}

makeRepository();
makeRunnerPath();
fs.mkdirSync(reports);
fs.mkdirSync(path.join(fixtureRoot, `${path.basename(worktree)}-sibling`));
fs.symlinkSync(repositoryParent, symlinkedParent, process.platform === 'win32' ? 'junction' : 'dir');

try {
  check('HELP human and JSON', () => {
    const testCase = makeCase('help');
    const human = cli(['--help'], testCase);
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /Usage:.*dispatch/);
    assert.equal(human.stderr, '');
    const json = jsonResponse(cli(['--json', '--help'], testCase), 0, 'HELP');
    assert.match(json.message, /--runner <codex\|opencode>/);
    assertNoRunner(testCase);
    assertNoScratchOrReport(testCase);
  });

  for (const args of [['--json', '--bad-option'], ['--bad-option', '--json']]) {
    check(`INVALID_INPUT JSON ordering ${args[0]}`, () => {
      const testCase = makeCase('invalid option');
      const response = jsonResponse(cli(args, testCase), 10, 'INVALID_INPUT');
      assert.equal(response.phase, 'input');
      assertNoRunner(testCase);
      assertNoScratchOrReport(testCase);
    });
  }

  for (const option of ['--runner', '--model', '--packet']) {
    check(`INVALID_INPUT missing ${option}`, () => {
      const testCase = makeCase(`missing ${option}`);
      const response = jsonResponse(cli([...removeOption(argsFor(testCase), option), '--json'], testCase), 10, 'INVALID_INPUT');
      assert.equal(response.phase, 'input');
      assertNoRunner(testCase);
      assertNoScratchOrReport(testCase);
    });
  }

  check('INVALID_INPUT rejects a report path that is already occupied', () => {
    const testCase = makeCase('preexisting report');
    fs.writeFileSync(testCase.report, 'Old report.\nSTATUS: DONE\n');
    jsonResponse(cli([...argsFor(testCase), '--json'], testCase), 10, 'INVALID_INPUT');
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(testCase.scratch), false);
  });

  check('INVALID_INPUT rejects a non-Git worktree', () => {
    const testCase = makeCase('invalid worktree');
    const invalidWorktree = path.join(fixtureRoot, 'invalid worktree');
    fs.mkdirSync(path.join(invalidWorktree, '.git'), { recursive: true });
    const args = argsFor(testCase);
    args[args.indexOf('--worktree') + 1] = invalidWorktree;
    jsonResponse(cli([...args, '--json'], testCase), 10, 'INVALID_INPUT');
    assertNoRunner(testCase);
    assertNoScratchOrReport(testCase);
  });

  check('UNSAFE_SCRATCH refuses a repository descendant', () => {
    const testCase = makeCase('repo scratch');
    const scratch = path.join(worktree, 'scratch');
    const args = argsFor(testCase);
    args[args.indexOf('--scratch') + 1] = scratch;
    jsonResponse(cli([...args, '--json'], testCase), 11, 'UNSAFE_SCRATCH');
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(scratch), false);
    assert.equal(fs.existsSync(testCase.report), false);
  });

  check('UNSAFE_SCRATCH refuses a linked-worktree .git file ancestor', () => {
    const testCase = makeCase('linked worktree scratch');
    assert.equal(fs.statSync(path.join(linkedWorktree, '.git')).isFile(), true);
    const args = argsFor(testCase);
    args[args.indexOf('--scratch') + 1] = path.join(linkedWorktree, 'scratch');
    jsonResponse(cli([...args, '--json'], testCase), 11, 'UNSAFE_SCRATCH');
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(path.join(linkedWorktree, 'scratch')), false);
    assert.equal(fs.existsSync(testCase.report), false);
  });

  check('UNSAFE_SCRATCH resolves a symlinked ancestor before checking Git roots', () => {
    const testCase = makeCase('symlinked ancestor');
    const args = argsFor(testCase);
    args[args.indexOf('--scratch') + 1] = path.join(symlinkedParent, path.basename(worktree), 'scratch');
    jsonResponse(cli([...args, '--json'], testCase), 11, 'UNSAFE_SCRATCH');
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(testCase.report), false);
  });

  check('external sibling-prefix scratch remains outside the worktree', () => {
    const testCase = makeCase('sibling prefix');
    const args = argsFor(testCase);
    const siblingScratch = path.join(fixtureRoot, `${path.basename(worktree)}-sibling`, 'scratch');
    args[args.indexOf('--scratch') + 1] = siblingScratch;
    const response = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assertSameCanonicalPath(response.cwd, worktree);
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(siblingScratch), false);
    assert.equal(fs.existsSync(testCase.report), false);
  });

  check('path.win32 cross-drive control is exercised through the real entry', () => {
    const relative = path.win32.relative('C:\\repo', 'D:\\scratch\\dispatch');
    assert.equal(path.win32.isAbsolute(relative), true);
    assert.equal(path.win32.resolve('C:\\repo', relative), 'D:\\scratch\\dispatch');
    const testCase = makeCase('cross-drive scratch');
    const worktreeRoot = path.win32.parse(canonicalPath(worktree)).root;
    const currentDrive = /^([A-Za-z]:)/.exec(worktreeRoot)?.[1].toUpperCase() || 'C:';
    const otherDrive = currentDrive === 'C:' ? 'D:' : 'C:';
    const crossDriveScratch = `${otherDrive}\\468-dispatch-p2\\scratch`;
    const args = argsFor(testCase);
    args[args.indexOf('--scratch') + 1] = crossDriveScratch;
    const expected = process.platform === 'win32' ? ['0', 'DRY_RUN_OK'] : ['11', 'UNSAFE_SCRATCH'];
    const response = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), Number(expected[0]), expected[1]);
    if (process.platform === 'win32') assertSameCanonicalPath(response.cwd, worktree);
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(crossDriveScratch), false);
    assertNoScratchOrReport(testCase);
  });

  check('cwd oracle accepts the selected linked worktree and rejects a different directory', () => {
    const testCase = makeCase('different cwd control');
    const args = argsFor(testCase);
    args[args.indexOf('--packet') + 1] = 'packet with spaces.md';
    args[args.indexOf('--worktree') + 1] = linkedWorktree;
    const response = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assertSameCanonicalPath(response.cwd, linkedWorktree);
    assert.notEqual(canonicalPath(response.cwd), canonicalPath(worktree));
    assertNoRunner(testCase);
    assertNoScratchOrReport(testCase);
  });

  for (const runner of ['codex', 'opencode']) {
    check(`${runner} real entry succeeds and dry-run argv/cwd match execution`, () => runSuccessAndArgvMatch(runner));
    check(`${runner} reports one trimmed model across dry-run, both runner calls, and run JSON`, () => {
      runSuccessAndArgvMatch(runner, ` ${runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model'} `);
    });

    check(`${runner} supported provider text on successful READY does not refuse`, () => {
      const testCase = makeCase(`${runner} provider text on success`);
      const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, {
        readiness: 'ready-with-provider-rate', execution: 'done-with-quota-prose',
      }), 0, 'DONE');
      assert.match(fs.readFileSync(response.evidence.readinessLog, 'utf8'), /Provider request failed with HTTP 429/);
      const actualEvents = events(testCase);
      assert.equal(actualEvents.length, 2);
      assertEvent(actualEvents[0], testCase, runner, 'readiness');
      assertEvent(actualEvents[1], testCase, runner, 'execution');
    });

    for (const scenario of ['no-ready', 'ready-failed', 'stdout-provider-rate', 'wrong-envelope', 'quoted-provider-rate', 'local-http-429', 'invalid-quota', 'bare-429', 'provider-rate-with-extra-text', 'provider-timeout', 'signal-provider-rate']) {
      check(`${runner} readiness ${scenario} -> NOT_READY`, () => {
        const testCase = makeCase(`${runner} ${scenario}`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: scenario }), 12, 'NOT_READY');
        assertReadinessRefusal(testCase, runner, response);
      });
    }

    check(`${runner} validated padded model is retained in readiness failure JSON`, () => {
      const testCase = makeCase(`${runner} padded model refusal`);
      const model = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model';
      const response = jsonResponse(cli([...argsFor(testCase, runner, ` ${model} `), '--json'], testCase, {
        readiness: 'invalid-quota',
      }), 12, 'NOT_READY');
      assert.equal(response.model, model);
      assertReadinessRefusal(testCase, runner, response, model);
    });

    check(`${runner} readiness timeout -> NOT_READY and child exited`, () => {
      const testCase = makeCase(`${runner} readiness timeout`);
      const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, {
        readiness: 'timeout', testTimeoutMs: 300, outerTimeoutMs: 5000,
      }), 12, 'NOT_READY');
      const actualEvents = events(testCase);
      assertReadinessRefusal(testCase, runner, response);
      assertProcessExited(actualEvents[0].pid);
    });

    for (const { scenario, code, message, cause } of [
      { scenario: 'rate-limited', code: 'RUNNER_RATE_LIMITED', message: 'Reduce concurrency on the affected key or retry later.', cause: 'Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}' },
      { scenario: 'quota-exhausted', code: 'RUNNER_QUOTA', message: 'Select an authorized runner or model with available quota.', cause: 'Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go' },
    ]) {
      const evidence = runner === 'codex' ? ' (fixture-only)' : ' (OpenCode envelope live-traced)';
      check(`${runner}${evidence} ${scenario} -> ${code} without fallback`, () => {
        const testCase = makeCase(`${runner} ${scenario}`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: scenario }), 13, code);
        assert.equal(response.message, message);
        assert.match(fs.readFileSync(response.evidence.readinessLog, 'utf8'), /\u001b\[91m\u001b\[1m/);
        assert.ok(fs.readFileSync(response.evidence.readinessLog, 'utf8').includes(cause));
        assertNoExecutionAfterReadinessFailure(testCase, runner, response);
      });
    }

    check(`${runner} execution failure -> RUN_FAILED with no retry/fallback`, () => {
      const testCase = makeCase(`${runner} run failed`);
      const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { execution: 'exit-failure' }), 15, 'RUN_FAILED');
      const actualEvents = events(testCase);
      assert.equal(actualEvents.length, 2);
      assert.ok(actualEvents.every(event => event.runner === runner));
      assert.equal(fs.existsSync(response.evidence.runLog), true);
      if (runner === 'codex') assert.equal(fs.existsSync(response.evidence.rawOutput), true);
    });

    check(`${runner} execution timeout -> RUN_TIMEOUT and child exited`, () => {
      const testCase = makeCase(`${runner} run timeout`);
      jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, {
        execution: 'timeout', testTimeoutMs: 300, outerTimeoutMs: 5000,
      }), 15, 'RUN_TIMEOUT');
      const actualEvents = events(testCase);
      assert.equal(actualEvents.length, 2);
      assert.ok(actualEvents.every(event => event.runner === runner));
      assertProcessExited(actualEvents[1].pid);
    });

    check(`${runner} valid BLOCKED report -> WORKER_BLOCKED with reason`, () => {
      const testCase = makeCase(`${runner} blocked`);
      const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { execution: 'blocked' }), 17, 'WORKER_BLOCKED');
      assert.match(response.message, /missing evidence/);
      assert.match(fs.readFileSync(testCase.report, 'utf8'), /STATUS: BLOCKED: missing evidence/);
      assert.match(fs.readFileSync(response.evidence.reportWriterLog, 'utf8'), /valid \(STATUS: BLOCKED: missing evidence\)/);
    });

    check(`${runner} report created during readiness is stale and rejected before run`, () => {
      const testCase = makeCase(`${runner} stale report`);
      jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: 'create-stale-report' }), 16, 'REPORT_INVALID');
      const actualEvents = events(testCase);
      assert.equal(actualEvents.length, 1, 'stale report must not be accepted as a fresh run result');
      assert.equal(actualEvents[0].phase, 'readiness');
      assert.equal(fs.readFileSync(testCase.report, 'utf8'), 'Stale report.\nSTATUS: DONE\n');
    });
  }

  check('missing selected Codex executable -> NOT_READY without OpenCode fallback', () => {
    const testCase = makeCase('missing codex executable');
    const response = jsonResponse(cli([...argsFor(testCase, 'codex'), '--json'], testCase, { path: openCodeOnlyBin }), 12, 'NOT_READY');
    assert.equal(response.message, 'Readiness failed. Keep the available child evidence.');
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(testCase.report), false);
  });

  check('Codex raw output with terminal host label is accepted and writer strips label', () => {
    const testCase = makeCase('Codex host label');
    const response = jsonResponse(cli([...argsFor(testCase), '--json'], testCase, { execution: 'raw-label' }), 0, 'DONE');
    assert.equal(fs.readFileSync(testCase.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
    assert.match(fs.readFileSync(response.evidence.reportWriterLog, 'utf8'), /stripped the terminal host label/);
  });

  for (const scenario of ['missing-raw', 'no-status', 'multiple-status', 'bad-label']) {
    check(`Codex ${scenario} -> REPORT_INVALID`, () => runReportInvalidCase('codex', scenario));
  }

  for (const scenario of ['missing-report', 'malformed-report']) {
    check(`OpenCode ${scenario} -> REPORT_INVALID`, () => runReportInvalidCase('opencode', scenario));
  }

  check('INTERNAL_ERROR is one terminal outcome when evidence storage fails', () => {
    const testCase = makeCase('internal error');
    const response = jsonResponse(cli([...argsFor(testCase), '--json'], testCase, { readiness: 'remove-scratch' }), 1, 'INTERNAL_ERROR');
    assert.equal(response.phase, 'application');
    assert.equal(events(testCase).length, 1);
  });

  check('entry usage mentions every option used by the CLI contract', () => {
    const testCase = makeCase('usage options');
    const response = jsonResponse(cli(['--help', '--json'], testCase), 0, 'HELP');
    for (const option of ['--runner', '--model', '--packet', '--worktree', '--scratch', '--report', '--dry-run', '--json', '--help']) {
      assert.ok(response.message.includes(option), `usage is missing ${option}`);
    }
  });
} finally {
  try { run('git', ['-C', worktree, 'worktree', 'remove', '--force', linkedWorktree]); } catch {}
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`RED matrix rows: ${failures.length}/${passed.length + failures.length} failed`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`mechanism-468-dispatch-cli: ${passed.length} P2 matrix rows passed`);
}

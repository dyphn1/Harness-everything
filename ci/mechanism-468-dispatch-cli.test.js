'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
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
const rawOverridePreload = path.join(fixtureRoot, 'raw-override.cjs');
const admissionPreload = path.join(fixtureRoot, 'admission-preload.cjs');
const agyStubScript = path.join(fixtureRoot, 'agy-stub.cjs');
const agyWinPreload = path.join(fixtureRoot, 'agy-win-preload.cjs');
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
  fs.writeFileSync(agyStubScript, `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const pIndex = args.indexOf('-p');
const prompt = pIndex >= 0 ? (args[pIndex + 1] || '') : '';
const phase = prompt === 'Reply with the single word READY' ? 'readiness' : 'execution';
const scenario = process.env['DISPATCH_FIXTURE_' + phase.toUpperCase()] || (phase === 'readiness' ? 'ready' : 'done');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.DISPATCH_FIXTURE_LOG, JSON.stringify({
  runner: 'agy',
  phase,
  scenario,
  args,
  cwd: process.cwd(),
  tmpdir: process.env.TMPDIR,
  stdin: input,
  stdinIsCharacterDevice: fs.fstatSync(0).isCharacterDevice(),
  pid: process.pid,
}) + '\\n');
const quotaLine = '429 RESOURCE_EXHAUSTED: Quota exceeded for model claude-sonnet-5-5-medium. Resets in 2h 15m.\\n';
function hang() { setInterval(() => {}, 1000); }
if (phase === 'readiness') {
  if (scenario === 'timeout') hang();
  else if (scenario === 'ready') process.stdout.write('READY\\n');
  else if (scenario === 'ready-period') process.stdout.write('READY.\\n');
  else if (scenario === 'ready-host-label') process.stdout.write('READY\\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier1","intents":[],"workflow":null,"skills":[]} -->\\n');
  else if (scenario === 'create-stale-report') {
    fs.writeFileSync(process.env.DISPATCH_FIXTURE_REPORT_PATH, 'Stale report.\\nSTATUS: DONE\\n');
    process.stdout.write('READY\\n');
  } else if (scenario === 'ready-failed') {
    process.stdout.write('READY\\n');
    process.exitCode = 1;
  } else if (scenario === 'agy-quota') {
    process.stderr.write('\\u001b[91m' + quotaLine + '\\u001b[0m');
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-generic') {
    process.stderr.write('Error: generic exit 3 failure\\n');
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-bare-429') {
    process.stderr.write('429 Too Many Requests\\n');
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-no-reset') {
    process.stderr.write('429 RESOURCE_EXHAUSTED: Quota exceeded.\\n');
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-quoted') {
    process.stderr.write('Quoted text: ' + quotaLine);
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-stdout') {
    process.stdout.write(quotaLine);
    process.exitCode = 3;
  } else if (scenario === 'agy-exit1-quota') {
    process.stderr.write(quotaLine);
    process.exitCode = 1;
  }
} else {
  if (scenario === 'timeout') {
    process.stdout.write('agy partial output before timeout\\n');
    hang();
  } else if (scenario === 'done') {
    fs.writeFileSync(process.env.DISPATCH_FIXTURE_REPORT_PATH, 'Fixture completed the packet.\\nSTATUS: DONE\\n');
    process.stdout.write('agy fixture child output\\n');
  } else if (scenario === 'blocked') {
    fs.writeFileSync(process.env.DISPATCH_FIXTURE_REPORT_PATH, 'Fixture could not verify the packet.\\nSTATUS: BLOCKED: missing evidence\\n');
    process.stdout.write('agy fixture child output\\n');
  } else if (scenario === 'permission-denied') {
    process.stderr.write('jetski: no output produced — a tool required the "read_file" permission that headless mode cannot prompt for, so it was auto-denied.\\n');
  } else if (scenario === 'agy-quota') {
    process.stderr.write(quotaLine);
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-generic') {
    process.stderr.write('Error: generic exit 3 failure\\n');
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-no-reset') {
    process.stderr.write('429 RESOURCE_EXHAUSTED: Quota exceeded.\\n');
    process.exitCode = 3;
  } else if (scenario === 'agy-exit3-with-report') {
    fs.writeFileSync(process.env.DISPATCH_FIXTURE_REPORT_PATH, 'Fixture completed the packet.\\nSTATUS: DONE\\n');
    process.stderr.write(quotaLine);
    process.exitCode = 3;
  } else if (scenario === 'agy-exit1-quota') {
    process.stderr.write(quotaLine);
    process.exitCode = 1;
  } else if (scenario === 'exit-failure') {
    process.stderr.write('agy execution error\\n');
    process.exitCode = 7;
  }
}
`);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(runnerBin, 'agy.cmd'), '@echo off\r\n');
    fs.writeFileSync(agyWinPreload, `'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const origSpawnSync = cp.spawnSync;
const origSpawn = cp.spawn;
function isAgyFixture(command, options) {
  if (command !== 'agy') return false;
  const pathEnv = (options && options.env && (options.env.PATH || options.env.Path)) || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  return dirs.some(dir => fs.existsSync(path.join(dir, 'agy.cmd')));
}
cp.spawnSync = function (command, args, options) {
  if (isAgyFixture(command, options)) {
    return origSpawnSync.call(this, process.execPath, [${JSON.stringify(agyStubScript)}, ...(args || [])], options);
  }
  return origSpawnSync.call(this, command, args, options);
};
cp.spawn = function (command, args, options) {
  if (isAgyFixture(command, options)) {
    return origSpawn.call(this, process.execPath, [${JSON.stringify(agyStubScript)}, ...(args || [])], options);
  }
  return origSpawn.call(this, command, args, options);
};
`);
  } else {
    const agyBin = path.join(runnerBin, 'agy');
    fs.writeFileSync(agyBin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(agyStubScript)} "$@"\n`);
    fs.chmodSync(agyBin, 0o755);
  }
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

function cliEnv(testCase, config = {}) {
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
  const preloads = [];
  if (process.platform === 'win32') preloads.push(`--require "${agyWinPreload.replace(/\\/g, '/')}"`);
  if (config.rawOverride !== undefined) {
    env.DISPATCH_FIXTURE_RAW_OVERRIDE = config.rawOverride;
    preloads.push(`--require "${rawOverridePreload.replace(/\\/g, '/')}"`);
  }
  if (config.admissionHook) {
    if (config.admissionHook.snapshotFile) env.DISPATCH_FIXTURE_SNAPSHOT_FILE = config.admissionHook.snapshotFile;
    if (config.admissionHook.snapshotDir) env.DISPATCH_FIXTURE_SNAPSHOT_DIR = config.admissionHook.snapshotDir;
    if (config.admissionHook.enteredFile) env.DISPATCH_FIXTURE_ENTERED_FILE = config.admissionHook.enteredFile;
    if (config.admissionHook.gateFile) env.DISPATCH_FIXTURE_GATE_FILE = config.admissionHook.gateFile;
    if (config.admissionHook.epermPid !== undefined) env.DISPATCH_FIXTURE_EPERM_PID = String(config.admissionHook.epermPid);
    preloads.push(`--require "${admissionPreload.replace(/\\/g, '/')}"`);
  }
  if (config.extraEnv) Object.assign(env, config.extraEnv);
  if (preloads.length) env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${preloads.join(' ')}`.trim();
  delete env.HARNESS_SYSTEM_ONE_MODE;
  return env;
}

function cli(args, testCase, config = {}) {
  const env = cliEnv(testCase, config);
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
    ? 'Reply with the single word READY'
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
  const expectedKeys = ['code', 'evidence', 'message', 'model', 'ok', 'phase', 'runner'];
  if (response.effort) expectedKeys.push('effort');
  assert.deepEqual(Object.keys(response).sort(), expectedKeys.sort());
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

function assertReadinessAnswer(runner, response, answer) {
  const output = runner === 'codex' ? response.evidence.readinessOutput : response.evidence.readinessLog;
  const raw = fs.readFileSync(output, 'utf8');
  assert.equal(runner === 'codex' ? raw : raw.split('\n[stderr]\n')[0], answer);
}

function assertEffortArgs(args, effort) {
  const setting = args.indexOf('-c');
  if (effort) {
    assert.ok(setting >= 0);
    assert.equal(args[setting + 1], `model_reasoning_effort="${effort}"`);
  } else {
    assert.equal(setting, -1);
    assert.equal(args.some(arg => arg.startsWith('model_reasoning_effort=')), false);
  }
}

function runSuccessAndArgvMatch(runner, requestedModel = runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model', config = {}) {
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

  const result = jsonResponse(cli([...args, '--json'], testCase, config), 0, 'DONE');
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
fs.writeFileSync(rawOverridePreload, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (
  path.basename(process.argv[1] || '') === 'exec' &&
  process.env.DISPATCH_FIXTURE_RAW_OVERRIDE !== undefined &&
  process.argv.at(-1) !== 'Reply with the single word READY'
) {
  const oIndex = process.argv.indexOf('-o');
  const outputPath = oIndex >= 0 ? process.argv[oIndex + 1] : null;
  const writeFileSync = fs.writeFileSync;
  fs.writeFileSync = function (file, data, ...rest) {
    if (outputPath && file === outputPath) {
      return writeFileSync.call(this, file, process.env.DISPATCH_FIXTURE_RAW_OVERRIDE, ...rest);
    }
    return writeFileSync.call(this, file, data, ...rest);
  };
}
`);
fs.writeFileSync(admissionPreload, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const epermPid = process.env.DISPATCH_FIXTURE_EPERM_PID ? Number(process.env.DISPATCH_FIXTURE_EPERM_PID) : null;
if (Number.isSafeInteger(epermPid)) {
  const origKill = process.kill;
  process.kill = function (pid, signal) {
    if (Number(pid) === epermPid && (signal === 0 || signal === undefined)) {
      const err = new Error('operation not permitted');
      err.code = 'EPERM';
      throw err;
    }
    return origKill.call(this, pid, signal);
  };
}
const scriptBase = path.basename(process.argv[1] || '');
const isRunnerChild = scriptBase === 'exec' || scriptBase === 'run' || scriptBase === 'agy-stub.cjs';
const isReadiness = process.argv.at(-1) === 'Reply with the single word READY' || process.argv.includes('Reply with the single word READY');
if (isRunnerChild && isReadiness) {
  const snapDir = process.env.DISPATCH_FIXTURE_SNAPSHOT_DIR;
  const snapFile = process.env.DISPATCH_FIXTURE_SNAPSHOT_FILE;
  if (snapDir && snapFile && fs.existsSync(snapDir)) {
    const slots = fs.readdirSync(snapDir).sort().map(name => ({
      name,
      content: fs.readFileSync(path.join(snapDir, name), 'utf8'),
    }));
    fs.writeFileSync(snapFile, JSON.stringify({ childPid: process.pid, slots }));
  }
  if (process.env.DISPATCH_FIXTURE_ENTERED_FILE) {
    fs.writeFileSync(process.env.DISPATCH_FIXTURE_ENTERED_FILE, String(process.pid));
  }
  const gateFile = process.env.DISPATCH_FIXTURE_GATE_FILE;
  if (gateFile) {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(gateFile) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 20);
  }
}
`);
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
    assert.match(json.message, /--runner <codex\|opencode\|agy>/);
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

    for (const { scenario, answer } of [
      { scenario: 'ready-period', answer: 'READY.\n' },
      { scenario: 'ready-padded-period', answer: ' \tREADY. \n' },
      // Advisor answer 3: the label object is an opaque wrapper; its fields are not validated here.
      { scenario: 'ready-bad-schema-label', answer: 'READY\n<!-- harness-label {"bad":true} -->\n' },
      { scenario: 'ready-host-label', answer: 'READY\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier1","intents":[],"workflow":"deferred","skills":[]} -->\n' },
    ]) {
      check(`${runner} accepts trimmed ${scenario} through the real entry and validates a fresh report`, () => {
        const testCase = makeCase(`${runner} ${scenario}`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: scenario }), 0, 'DONE');
        assertReadinessAnswer(runner, response, answer);
        assert.equal(fs.readFileSync(response.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
        const actualEvents = events(testCase);
        assert.equal(actualEvents.length, 2, 'one readiness and one execution; no retry or fallback');
        assertEvent(actualEvents[0], testCase, runner, 'readiness');
        assertEvent(actualEvents[1], testCase, runner, 'execution');
      });
    }

    for (const scenario of ['ready-now', 'not-ready', 'ready-two-dots', 'ready-lowercase', 'ready-commentary', 'ready-bad-label', 'ready-label-then-text']) {
      check(`${runner} rejects readiness answer ${scenario}`, () => {
        const testCase = makeCase(`${runner} ${scenario}`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: scenario }), 12, 'NOT_READY');
        assertReadinessRefusal(testCase, runner, response);
      });
    }

    check(`${runner} nonzero readiness refuses even when stdout or raw output says READY.`, () => {
      const testCase = makeCase(`${runner} READY period nonzero`);
      const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: 'ready-period-failed' }), 12, 'NOT_READY');
      assertReadinessAnswer(runner, response, 'READY.\n');
      assertReadinessRefusal(testCase, runner, response);
    });

    check(`${runner} readiness timeout refuses after emitting READY.`, () => {
      const testCase = makeCase(`${runner} READY period timeout`);
      const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, {
        readiness: 'ready-period-timeout', testTimeoutMs: 300, outerTimeoutMs: 5000,
      }), 12, 'NOT_READY');
      assertReadinessAnswer(runner, response, 'READY.\n');
      assertReadinessRefusal(testCase, runner, response);
      assertProcessExited(events(testCase)[0].pid);
    });

    if (process.platform !== 'win32') {
      check(`${runner} signaled readiness refuses even when it emits READY.`, () => {
        const testCase = makeCase(`${runner} READY period signal`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: 'ready-period-signal' }), 12, 'NOT_READY');
        assertReadinessAnswer(runner, response, 'READY.\n');
        assertReadinessRefusal(testCase, runner, response);
        assertProcessExited(events(testCase)[0].pid);
      });
    }

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

    for (const scenario of ['no-ready', 'ready-failed', 'stdout-provider-rate', 'wrong-envelope', 'quoted-provider-rate', 'local-http-429', 'invalid-quota', 'bare-429', 'provider-rate-with-extra-text', 'provider-timeout',
      // Windows has no POSIX signals: a self-SIGTERM reports exit 1 with signal null, so the signal row only exists off win32.
      ...(process.platform === 'win32' ? [] : ['signal-provider-rate'])]) {
      check(`${runner} readiness ${scenario} -> NOT_READY`, () => {
        const testCase = makeCase(`${runner} ${scenario}`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: scenario }), 12, 'NOT_READY');
        assertReadinessRefusal(testCase, runner, response);
      });
    }

    for (const scenario of ['rate-limit-and-quota', 'quota-and-rate-limit']) {
      check(`${runner} readiness ${scenario} -> NOT_READY regardless of diagnostic order`, () => {
        const testCase = makeCase(`${runner} ${scenario}`);
        const response = jsonResponse(cli([...argsFor(testCase, runner), '--json'], testCase, { readiness: scenario }), 12, 'NOT_READY');
        const readinessLog = fs.readFileSync(response.evidence.readinessLog, 'utf8');
        assert.ok(readinessLog.includes('Provider request failed with HTTP 429'));
        assert.ok(readinessLog.includes('Free usage limit reached'));
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

  for (const { label, runner, values } of [
    { label: 'invalid value', values: ['--effort', 'ultra'] },
    { label: 'missing value', values: ['--effort'] },
    { label: 'duplicate value', values: ['--effort', 'low', '--effort', 'high'] },
    { label: 'OpenCode runner', runner: 'opencode', values: ['--effort', 'low'] },
  ]) {
    check(`INVALID_INPUT effort ${label} refuses before spawn or writes`, () => {
      const testCase = makeCase(`invalid effort ${label}`);
      const argsForCase = [...argsFor(testCase, runner || 'codex'), ...values];
      const response = jsonResponse(cli([...argsForCase, '--json'], testCase), 10, 'INVALID_INPUT');
      assert.equal(response.phase, 'input');
      assertNoRunner(testCase);
      assertNoScratchOrReport(testCase);
    });
  }

  for (const effort of ['low', 'medium', 'high', 'xhigh']) {
    check(`Codex --effort ${effort} appears in dry-run JSON and both spawned argv arrays`, () => {
      const testCase = makeCase(`Codex effort ${effort}`);
      const args = [...argsFor(testCase), '--effort', effort];
      const dryRun = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
      assert.equal(dryRun.effort, effort);
      assertEffortArgs(dryRun.argv.slice(1), effort);
      assertNoRunner(testCase);
      assertNoScratchOrReport(testCase);

      const response = jsonResponse(cli([...args, '--json'], testCase), 0, 'DONE');
      assert.equal(response.effort, effort);
      const actualEvents = events(testCase);
      assert.equal(actualEvents.length, 2);
      for (const event of actualEvents) assertEffortArgs(event.args, effort);
      const executionArgv = [actualEvents[1].runner, ...actualEvents[1].args];
      const outputIndex = executionArgv.indexOf('-o') + 1;
      executionArgv[outputIndex] = dryRun.argv[outputIndex];
      assert.deepEqual(dryRun.argv, executionArgv);
      assert.equal(fs.readFileSync(response.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
    });
  }

  check('Codex omitted --effort leaves the default unoverridden and omits JSON effort', () => {
    const testCase = makeCase('Codex default effort');
    const args = argsFor(testCase);
    const dryRun = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assert.equal(dryRun.effort, undefined);
    assertEffortArgs(dryRun.argv.slice(1), undefined);
    const response = jsonResponse(cli([...args, '--json'], testCase), 0, 'DONE');
    assert.equal(response.effort, undefined);
    for (const event of events(testCase)) assertEffortArgs(event.args, undefined);
  });

  check('Codex validated effort remains in JSON when readiness refuses', () => {
    const testCase = makeCase('Codex effort readiness refusal');
    const response = jsonResponse(cli([...argsFor(testCase), '--effort', 'high', '--json'], testCase, { readiness: 'ready-failed' }), 12, 'NOT_READY');
    assert.equal(response.effort, 'high');
    assertReadinessAnswer('codex', response, 'READY\n');
    assertReadinessRefusal(testCase, 'codex', response);
    assertEffortArgs(events(testCase)[0].args, 'high');
  });

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

  check('497 Codex raw output with a blank line before the host label is accepted', () => {
    const testCase = makeCase('Codex host label after blank');
    jsonResponse(cli([...argsFor(testCase), '--json'], testCase, { execution: 'raw-label-blank' }), 0, 'DONE');
    assert.equal(fs.readFileSync(testCase.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
  });

  for (const { label, raw, expectedReport } of [
    {
      label: 'padded DONE spaces',
      raw: 'Fixture completed the packet.\nSTATUS: DONE  \n',
      expectedReport: 'Fixture completed the packet.\nSTATUS: DONE\n',
    },
    {
      label: 'padded DONE tab with blank line and host label',
      raw: 'Fixture completed the packet.\nSTATUS: DONE\t\n\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["fix"],"workflow":"iterative-single","skills":[]} -->\n',
      expectedReport: 'Fixture completed the packet.\nSTATUS: DONE\n',
    },
  ]) {
    check(`441-A Codex ${label} -> DONE with preserved raw bytes and canonical report`, () => {
      const testCase = makeCase(`Codex ${label}`);
      const response = jsonResponse(cli([...argsFor(testCase), '--json'], testCase, { rawOverride: raw }), 0, 'DONE');
      assert.equal(fs.readFileSync(response.evidence.rawOutput, 'utf8'), raw);
      assert.equal(fs.readFileSync(testCase.report, 'utf8'), expectedReport);
    });
  }

  for (const { label, raw, expectedReport } of [
    {
      label: 'padded BLOCKED spaces',
      raw: 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence  \n',
      expectedReport: 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\n',
    },
    {
      label: 'padded BLOCKED tab with host label',
      raw: 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\t \n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["fix"],"workflow":"iterative-single","skills":[]} -->\n',
      expectedReport: 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\n',
    },
  ]) {
    check(`441-A Codex ${label} -> WORKER_BLOCKED with preserved raw bytes and canonical report`, () => {
      const testCase = makeCase(`Codex ${label}`);
      const response = jsonResponse(cli([...argsFor(testCase), '--json'], testCase, { rawOverride: raw }), 17, 'WORKER_BLOCKED');
      assert.equal(response.message, 'worker delivered a valid BLOCKED report: missing evidence');
      assert.equal(fs.readFileSync(response.evidence.rawOutput, 'utf8'), raw);
      assert.equal(fs.readFileSync(testCase.report, 'utf8'), expectedReport);
      assert.match(fs.readFileSync(response.evidence.reportWriterLog, 'utf8'), /valid \(STATUS: BLOCKED: missing evidence\)/);
    });
  }

  for (const { label, raw } of [
    { label: 'leading space DONE', raw: 'Fixture completed the packet.\n STATUS: DONE\n' },
    { label: 'leading space BLOCKED', raw: 'Fixture could not verify the packet.\n STATUS: BLOCKED: missing evidence\n' },
    { label: 'leading space BLOCKED reason', raw: 'Fixture could not verify the packet.\nSTATUS: BLOCKED:  missing evidence\n' },
    { label: 'non-ASCII trailing space DONE', raw: 'Fixture completed the packet.\nSTATUS: DONE\u00a0\n' },
    { label: 'non-ASCII trailing space BLOCKED', raw: 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\u00a0\n' },
    { label: 'nonterminal padded DONE', raw: 'Fixture completed the packet.\nSTATUS: DONE  \nextra line\n' },
    { label: 'duplicate padded DONE', raw: 'Fixture completed the packet.\nSTATUS: DONE  \nSTATUS: DONE\n' },
    { label: 'label without newline after padded STATUS', raw: 'Fixture completed the packet.\nSTATUS: DONE  <!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["fix"],"workflow":"iterative-single","skills":[]} -->\n' },
  ]) {
    check(`441-A Codex refusal control (${label}) -> REPORT_INVALID`, () => {
      const testCase = makeCase(`Codex refusal ${label}`);
      const response = jsonResponse(cli([...argsFor(testCase), '--json'], testCase, { rawOverride: raw }), 16, 'REPORT_INVALID');
      assert.equal(fs.readFileSync(response.evidence.rawOutput, 'utf8'), raw);
      assert.equal(fs.existsSync(testCase.report), false);
    });
  }

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
    for (const option of ['--runner', '--model', '--packet', '--worktree', '--scratch', '--report', '--effort', '--assignment', '--admission-policy', '--dry-run', '--json', '--help']) {
      assert.ok(response.message.includes(option), `usage is missing ${option}`);
    }
  });

  // #466 D-gate: managed C8 structured gate assignment (rows G1-G7).
  const defaultAdmissionDir = path.join(fixtureRoot, 'shared-admission-default');
  const defaultAdmissionPolicy = path.join(fixtureRoot, 'default-admission-policy.json');
  fs.writeFileSync(defaultAdmissionPolicy, JSON.stringify({
    schemaVersion: 1,
    dir: defaultAdmissionDir,
    pools: {
      'codex-pilot': { cap: 2 },
      'opencode-pilot': { cap: 2 },
      'agy-shared': { cap: 2 },
    },
    routes: [
      { runner: 'codex', model: 'fixture/codex-model', pool: 'codex-pilot' },
      { runner: 'opencode', model: 'fixture/opencode-model', pool: 'opencode-pilot' },
      { runner: 'agy', model: 'gemini-4-neon-medium', pool: 'agy-shared' },
    ],
  }));
  function writeAssignment(testCase, value, raw) {
    const file = path.join(fixtureRoot, `assignment ${caseNumber}.json`);
    fs.writeFileSync(file, raw !== undefined ? raw : JSON.stringify(value));
    return file;
  }
  function managedArgs(testCase, assignment, runner = 'codex', admissionPolicy = defaultAdmissionPolicy) {
    return [...argsFor(testCase, runner), '--assignment', assignment, ...(admissionPolicy === null ? [] : ['--admission-policy', admissionPolicy])];
  }
  function assertRefusedBeforeSpawn(testCase) {
    assertNoRunner(testCase);
    assertNoScratchOrReport(testCase);
  }
  const focused = [
    { id: 'node --test ci/mechanism-468-dispatch-cli.test.js', actor: 'worker' },
    { id: 'npm run test:consistency', actor: 'worker' },
  ];

  for (const gate of ['verify:all', 'verify:all --fast']) {
    check(`G1/G2 sandboxed codex worker gate "${gate}" -> GATE_REFUSED before probe/spawn`, () => {
      const testCase = makeCase('gate sandboxed refusal');
      const assignment = writeAssignment(testCase, { schemaVersion: 1, gates: [...focused, { id: gate, actor: 'worker' }] });
      const response = jsonResponse(cli([...managedArgs(testCase, assignment), '--json'], testCase), 18, 'GATE_REFUSED');
      assert.equal(response.phase, 'gate');
      assert.equal(response.evidence, undefined);
      assert.ok(response.message.includes(gate));
      assertRefusedBeforeSpawn(testCase);
      const dry = jsonResponse(cli([...managedArgs(testCase, assignment), '--dry-run', '--json'], testCase), 18, 'GATE_REFUSED');
      assert.equal(dry.phase, 'gate');
      assertRefusedBeforeSpawn(testCase);
    });
    check(`G1/G2 opencode (unsandboxed) worker gate "${gate}" is accepted by the profile`, () => {
      const testCase = makeCase('gate opencode accepted');
      const assignment = writeAssignment(testCase, { schemaVersion: 1, gates: [{ id: gate, actor: 'worker' }] });
      const response = jsonResponse(cli([...managedArgs(testCase, assignment, 'opencode'), '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
      assert.deepEqual(response.gates, { worker: [gate], coordinator: [] });
      assertRefusedBeforeSpawn(testCase);
    });
  }

  for (const [label, value, raw] of [
    ['not JSON', undefined, '{not json'],
    ['array root', [], undefined],
    ['wrong schemaVersion', { schemaVersion: 2, gates: [] }, undefined],
    ['unknown top-level key', { schemaVersion: 1, gates: [], extra: true }, undefined],
    ['missing gates', { schemaVersion: 1 }, undefined],
    ['gates not an array', { schemaVersion: 1, gates: 'verify:all' }, undefined],
    ['gate not an object', { schemaVersion: 1, gates: ['verify:all'] }, undefined],
    ['unknown gate key', { schemaVersion: 1, gates: [{ id: 'npm run test:consistency', actor: 'worker', note: 'x' }] }, undefined],
    ['unknown actor', { schemaVersion: 1, gates: [{ id: 'npm run test:consistency', actor: 'reviewer' }] }, undefined],
    ['duplicate gate id', { schemaVersion: 1, gates: [{ id: 'npm run test:consistency', actor: 'worker' }, { id: 'npm run test:consistency', actor: 'coordinator' }] }, undefined],
  ]) {
    check(`G3 malformed assignment (${label}) -> GATE_ASSIGNMENT_INVALID before spawn`, () => {
      const testCase = makeCase('gate malformed');
      const assignment = writeAssignment(testCase, value, raw);
      const response = jsonResponse(cli([...managedArgs(testCase, assignment), '--json'], testCase), 19, 'GATE_ASSIGNMENT_INVALID');
      assert.equal(response.phase, 'gate');
      assertRefusedBeforeSpawn(testCase);
    });
  }
  check('G3 missing assignment file -> GATE_ASSIGNMENT_INVALID before spawn', () => {
    const testCase = makeCase('gate missing file');
    const response = jsonResponse(cli([...managedArgs(testCase, path.join(fixtureRoot, 'no-such-assignment.json')), '--json'], testCase), 19, 'GATE_ASSIGNMENT_INVALID');
    assert.equal(response.phase, 'gate');
    assertRefusedBeforeSpawn(testCase);
  });

  for (const id of ['npm run verify:all', 'verify:all --slow', 'gh pr checks', 'npm run test:unknown', 'node --test']) {
    check(`G4 unknown gate id "${id}" -> GATE_ASSIGNMENT_INVALID before spawn (either actor)`, () => {
      for (const actor of ['worker', 'coordinator']) {
        const testCase = makeCase('gate unknown id');
        const assignment = writeAssignment(testCase, { schemaVersion: 1, gates: [{ id, actor }] });
        const response = jsonResponse(cli([...managedArgs(testCase, assignment), '--json'], testCase), 19, 'GATE_ASSIGNMENT_INVALID');
        assert.ok(response.message.includes(id));
        assertRefusedBeforeSpawn(testCase);
      }
    });
  }

  for (const gate of ['verify:all', 'verify:all --fast']) {
    check(`G5 coordinator "${gate}" + focused worker checks -> one C8 attempt, checked report, no coordinator gate run`, () => {
      const testCase = makeCase('gate coordinator');
      const assignment = writeAssignment(testCase, { schemaVersion: 1, gates: [...focused, { id: gate, actor: 'coordinator' }] });
      const result = jsonResponse(cli([...managedArgs(testCase, assignment), '--json'], testCase), 0, 'DONE');
      assert.deepEqual(result.gates, { worker: focused.map(item => item.id), coordinator: [gate] });
      assert.equal(fs.readFileSync(result.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
      assert.match(fs.readFileSync(result.evidence.reportWriterLog, 'utf8'), /valid \(STATUS: DONE\)/);
      assert.ok(result.evidence.readinessLog && result.evidence.runLog && result.evidence.rawOutput);
      const actualEvents = events(testCase);
      assert.equal(actualEvents.length, 2, 'one readiness and one execution; the coordinator gate is never run');
      assert.deepEqual(actualEvents.map(event => event.phase), ['readiness', 'execution']);
      for (const event of actualEvents) assert.notEqual(event.runner, 'npm');
    });
  }

  check('G6 managed --dry-run creates no files and spawns no child', () => {
    const testCase = makeCase('gate dry run');
    const assignment = writeAssignment(testCase, { schemaVersion: 1, gates: [...focused, { id: 'verify:all', actor: 'coordinator' }] });
    const response = jsonResponse(cli([...managedArgs(testCase, assignment), '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assert.deepEqual(response.gates, { worker: focused.map(item => item.id), coordinator: ['verify:all'] });
    assert.equal(response.evidence, undefined);
    assertRefusedBeforeSpawn(testCase);
  });

  check('G7 unmanaged invocation carries no gate fields', () => {
    const testCase = makeCase('gate unmanaged');
    const dry = jsonResponse(cli([...argsFor(testCase), '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assert.equal(dry.gates, undefined);
    assertRefusedBeforeSpawn(testCase);
  });

  // #466 D-scratch: managed C8 per-attempt TMPDIR + lifecycle (rows S1-S8).
  // In managed mode --scratch names the canonical external ROOT; each attempt gets attempt-* below it.
  function managedRoot(testCase) {
    fs.mkdirSync(testCase.scratch, { recursive: true });
    return testCase.scratch;
  }
  function attemptDirs(rootDir) {
    return fs.readdirSync(rootDir).filter(name => name.startsWith('attempt-'));
  }
  function managedAssignment(testCase) {
    return writeAssignment(testCase, { schemaVersion: 1, gates: [{ id: 'npm run test:consistency', actor: 'worker' }] });
  }
  function isInside(parent, child) {
    const parentReal = path.join(canonicalPath(path.dirname(parent)), path.basename(parent)); // parent may be removed already
    const rel = path.relative(parentReal, canonicalPath(child));
    return rel !== '' && !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
  }
  function runManaged(testCase, config = {}, runner = 'codex') {
    return cli([...managedArgs(testCase, managedAssignment(testCase), runner), '--json'], testCase, config);
  }

  check('S1 managed attempt -> unique attempt dir under external root; child TMPDIR is that dir', () => {
    const testCase = makeCase('scratch s1');
    const rootDir = managedRoot(testCase);
    const response = jsonResponse(runManaged(testCase), 0, 'DONE');
    const tmpdirs = events(testCase).map(event => event.tmpdir);
    assert.equal(tmpdirs.length, 2);
    assert.equal(tmpdirs[0], tmpdirs[1], 'readiness and execution share the attempt dir');
    assert.notEqual(path.resolve(tmpdirs[0]), path.resolve(rootDir), 'TMPDIR must not be the bare root');
    assert.equal(path.dirname(tmpdirs[0]), path.resolve(rootDir));
    assert.match(path.basename(tmpdirs[0]), /^attempt-/);
    assert.ok(response.evidence.report);
  });

  for (const [label, rootFor] of [
    ['git repo', () => path.join(worktree, 'managed-root')],
    ['linked worktree', () => path.join(linkedWorktree, 'managed-root')],
  ]) {
    check(`S2 managed root inside ${label} -> refused before child start; no directory`, () => {
      const testCase = makeCase('scratch s2');
      testCase.scratch = rootFor();
      const response = jsonResponse(runManaged(testCase), 11, 'UNSAFE_SCRATCH');
      assert.equal(response.phase, 'validation');
      assertNoRunner(testCase);
      assert.equal(fs.existsSync(testCase.scratch), false);
      assert.equal(fs.existsSync(testCase.report), false);
    });
  }

  check('S3 managed root symlink resolving into a repo -> refused before child start', () => {
    const testCase = makeCase('scratch s3');
    const link = path.join(fixtureRoot, `root link ${caseNumber}`);
    fs.symlinkSync(worktree, link, process.platform === 'win32' ? 'junction' : 'dir');
    testCase.scratch = path.join(link, 'managed-root');
    const response = jsonResponse(runManaged(testCase), 11, 'UNSAFE_SCRATCH');
    assert.equal(response.phase, 'validation');
    assertNoRunner(testCase);
    assert.equal(fs.existsSync(path.join(worktree, 'managed-root')), false);
    const direct = makeCase('scratch s3 link root');
    direct.scratch = link;
    jsonResponse(runManaged(direct), 11, 'UNSAFE_SCRATCH');
    assertNoRunner(direct);
  });

  check('S4 two concurrent managed attempts on one root -> distinct attempt dirs', () => {
    const first = makeCase('scratch s4 a');
    const second = makeCase('scratch s4 b');
    second.scratch = first.scratch;
    const rootDir = managedRoot(first);
    const assignment = managedAssignment(first);
    const outputs = [first, second].map((testCase, index) => {
      const file = path.join(fixtureRoot, `s4 out ${caseNumber} ${index}.json`);
      const fd = fs.openSync(file, 'w');
      const child = spawn(process.execPath, [entry, ...managedArgs(testCase, assignment), '--json'], { cwd: root, env: cliEnv(testCase), stdio: ['ignore', fd, fd] });
      return { testCase, file, child, fd };
    });
    const deadline = Date.now() + 20000;
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const done = item => { const text = fs.readFileSync(item.file, 'utf8'); return text.endsWith('\n') ? JSON.parse(text) : null; };
    while (outputs.some(item => !done(item)) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 25);
    for (const item of outputs) { fs.closeSync(item.fd); item.child.kill('SIGKILL'); }
    for (const item of outputs) assert.equal(done(item)?.code, 'DONE', fs.readFileSync(item.file, 'utf8'));
    const dirs = outputs.flatMap(item => events(item.testCase).map(event => event.tmpdir));
    assert.equal(dirs.length, 4);
    assert.equal(new Set(dirs).size, 2, `attempts must not share a TMPDIR: ${dirs.join(', ')}`);
    for (const dir of dirs) assert.equal(path.dirname(dir), path.resolve(rootDir));
  });

  check('S5 checked DONE -> evidence retained at stable paths outside the run dir, then only its own dir removed', () => {
    const testCase = makeCase('scratch s5');
    const rootDir = managedRoot(testCase);
    const sibling = path.join(rootDir, 'attempt-someone-else');
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'keep.txt'), 'another attempt\n');
    const response = jsonResponse(runManaged(testCase), 0, 'DONE');
    const attempt = events(testCase)[0].tmpdir;
    assert.equal(fs.existsSync(attempt), false, 'own attempt dir is removed');
    assert.equal(fs.readFileSync(path.join(sibling, 'keep.txt'), 'utf8'), 'another attempt\n', 'foreign attempt dir is untouched');
    assert.deepEqual(attemptDirs(rootDir), ['attempt-someone-else']);
    for (const key of ['readinessOutput', 'readinessLog', 'rawOutput', 'runLog', 'reportWriterLog', 'report']) {
      assert.ok(response.evidence[key], `evidence.${key} must be reported`);
      assert.ok(fs.existsSync(response.evidence[key]), `evidence.${key} must exist after cleanup`);
      assert.equal(isInside(attempt, response.evidence[key]), false, `evidence.${key} must be outside the removed dir`);
    }
    assert.match(fs.readFileSync(response.evidence.reportWriterLog, 'utf8'), /valid \(STATUS: DONE\)/);
    assert.match(fs.readFileSync(response.evidence.rawOutput, 'utf8'), /STATUS: DONE/);
    assert.equal(fs.readFileSync(response.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
  });

  for (const [label, config, exitCode, code, runner] of [
    ['BLOCKED report', { execution: 'blocked' }, 17, 'WORKER_BLOCKED', 'codex'],
    ['runner failure', { execution: 'exit-failure' }, 15, 'RUN_FAILED', 'codex'],
    ['invalid report', { execution: 'no-status' }, 16, 'REPORT_INVALID', 'codex'],
    ['readiness failure', { readiness: 'ready-failed' }, 12, 'NOT_READY', 'codex'],
    ['opencode BLOCKED report', { execution: 'blocked' }, 17, 'WORKER_BLOCKED', 'opencode'],
  ]) {
    check(`S6 ${label} -> attempt dir and evidence kept`, () => {
      const testCase = makeCase('scratch s6');
      const rootDir = managedRoot(testCase);
      const response = jsonResponse(runManaged(testCase, config, runner), exitCode, code);
      const dirs = attemptDirs(rootDir);
      assert.equal(dirs.length, 1, 'attempt dir is preserved');
      assert.ok(response.evidence.readinessLog, 'evidence reported');
      for (const value of Object.values(response.evidence)) assert.ok(fs.existsSync(value));
      assert.ok(isInside(path.join(rootDir, dirs[0]), response.evidence.readinessLog), 'evidence stays in the kept dir');
    });
  }

  check('S6 evidence-retention failure on a checked DONE -> attempt dir and evidence kept, nonzero exit', () => {
    const testCase = makeCase('scratch s6 retention');
    const rootDir = managedRoot(testCase);
    fs.writeFileSync(path.join(rootDir, 'retained'), 'a file blocks the retention directory\n');
    const response = jsonResponse(runManaged(testCase), 20, 'EVIDENCE_RETENTION_FAILED');
    assert.equal(response.phase, 'retention');
    const dirs = attemptDirs(rootDir);
    assert.equal(dirs.length, 1);
    assert.ok(isInside(path.join(rootDir, dirs[0]), response.evidence.runLog));
    assert.ok(isInside(path.join(rootDir, dirs[0]), response.evidence.rawOutput));
    assert.equal(fs.readFileSync(response.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
  });

  check('S7 managed --dry-run -> no root, no attempt dir, no child', () => {
    const testCase = makeCase('scratch s7');
    const response = jsonResponse(cli([...managedArgs(testCase, managedAssignment(testCase)), '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assert.equal(response.evidence, undefined);
    assertRefusedBeforeSpawn(testCase);
  });

  check('S8 unmanaged DONE is unchanged: TMPDIR is --scratch itself, evidence stays in it, nothing removed', () => {
    const testCase = makeCase('scratch s8');
    const response = jsonResponse(cli([...argsFor(testCase), '--json'], testCase), 0, 'DONE');
    for (const event of events(testCase)) assert.equal(event.tmpdir, testCase.scratch);
    assert.deepEqual(fs.readdirSync(testCase.scratch).filter(name => name.startsWith('attempt-') || name === 'retained'), []);
    for (const key of ['readinessLog', 'rawOutput', 'runLog', 'reportWriterLog']) assert.equal(path.dirname(response.evidence[key]), testCase.scratch);
    const failed = makeCase('scratch s8 failed');
    jsonResponse(cli([...argsFor(failed), '--json'], failed, { execution: 'blocked' }), 17, 'WORKER_BLOCKED');
    assert.equal(fs.existsSync(failed.scratch), true);
  });

  // #466 D-agy: managed C8 agy runner adapter (rows A1-A10).
  const agyWorkDir = path.join(worktree, '.w');
  fs.mkdirSync(agyWorkDir, { recursive: true });
  const agySettings = '{"permissions":{"allow":["command(*)","read_file(*)"]}}';
  function makeAgyCase(label) {
    caseNumber += 1;
    const reportRel = `.w/report-${caseNumber}-${label.replace(/[^A-Za-z0-9_-]+/g, '-')}.md`;
    return {
      scratch: path.join(fixtureRoot, `scratch ${caseNumber} ${label}`),
      report: path.join(worktree, reportRel),
      reportRel,
      packetRel: 'packet with spaces.md',
      log: path.join(fixtureRoot, `runner events ${caseNumber}.jsonl`),
    };
  }
  function agyArgsFor(testCase, model = 'gemini-4-neon-medium') {
    return [
      '--runner', 'agy',
      '--model', model,
      '--packet', testCase.packetRel,
      '--worktree', worktree,
      '--scratch', testCase.scratch,
      '--report', testCase.reportRel,
    ];
  }
  function assertAgyArgv(argv, model, prompt, timeoutSeconds) {
    assert.deepEqual(argv, [
      '-p', prompt,
      '--model', model,
      '--mode', 'accept-edits',
      '--sandbox',
      '--settings', agySettings,
      '--print-timeout', `${timeoutSeconds}s`,
    ]);
  }
  function assertAgyEvent(event, testCase, phase, model = 'gemini-4-neon-medium') {
    assert.equal(event.runner, 'agy');
    assert.equal(event.phase, phase);
    assertSameCanonicalPath(event.cwd, worktree, 'agy child cwd must resolve to the selected clone');
    assert.equal(event.stdin, '');
    assert.equal(event.stdinIsCharacterDevice, true);
    const expectedPrompt = phase === 'readiness'
      ? 'Reply with the single word READY'
      : `Execute the packet at ${testCase.packetRel} and write the complete report to ${testCase.reportRel}. Use only paths relative to the current directory.`;
    assertAgyArgv(event.args, model, expectedPrompt, phase === 'readiness' ? 120 : 2700);
    if (phase === 'execution') {
      assert.equal(expectedPrompt.includes(worktree), false, 'agy prompt must use cwd-relative paths');
    }
  }

  check('A1 agy DONE -> pinned headless argv, cwd = clone, stdin closed, cwd-relative paths, sandbox requested', () => {
    const testCase = makeAgyCase('agy a1');
    const args = agyArgsFor(testCase, 'gemini-4-neon-medium');
    const dryRun = jsonResponse(cli([...args, '--dry-run', '--json'], testCase), 0, 'DRY_RUN_OK');
    assert.equal(dryRun.runner, 'agy');
    assert.equal(dryRun.model, 'gemini-4-neon-medium');
    assert.equal(dryRun.sandbox, 'requested');
    assertSameCanonicalPath(dryRun.cwd, worktree);
    assert.equal(dryRun.argv[0], 'agy');
    const expectedPrompt = `Execute the packet at ${testCase.packetRel} and write the complete report to ${testCase.reportRel}. Use only paths relative to the current directory.`;
    assertAgyArgv(dryRun.argv.slice(1), 'gemini-4-neon-medium', expectedPrompt, 2700);
    assertNoRunner(testCase);
    assertNoScratchOrReport(testCase);

    const assignment = managedAssignment(testCase);
    const response = jsonResponse(cli([...args, '--assignment', assignment, '--admission-policy', defaultAdmissionPolicy, '--json'], testCase, { readiness: 'ready-host-label' }), 0, 'DONE');
    assert.equal(response.runner, 'agy');
    assert.equal(response.model, 'gemini-4-neon-medium');
    assert.equal(response.sandbox, 'requested');
    assert.equal(fs.readFileSync(response.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
    const actualEvents = events(testCase);
    assert.equal(actualEvents.length, 2, 'one readiness and one execution');
    assertAgyEvent(actualEvents[0], testCase, 'readiness', 'gemini-4-neon-medium');
    assertAgyEvent(actualEvents[1], testCase, 'execution', 'gemini-4-neon-medium');
    assert.deepEqual(dryRun.argv, ['agy', ...actualEvents[1].args]);
    assert.ok(fs.existsSync(response.evidence.runLog));
    assert.ok(fs.existsSync(response.evidence.readinessLog));
  });

  check('A1 agy rejects packet or report outside worktree (cwd-relative worker path guard)', () => {
    const testCase = makeAgyCase('agy outside report');
    const outsideReport = path.join(reports, `agy-outside-${caseNumber}.md`);
    const args = agyArgsFor(testCase);
    args[args.indexOf('--report') + 1] = outsideReport;
    const response = jsonResponse(cli([...args, '--json'], testCase), 10, 'INVALID_INPUT');
    assert.equal(response.phase, 'input');
    assert.match(response.message, /must be inside --worktree for agy/);
    assertNoRunner(testCase);
  });

  check('A2 agy valid BLOCKED report -> WORKER_BLOCKED with reason and kept evidence', () => {
    const testCase = makeAgyCase('agy a2');
    const assignment = managedAssignment(testCase);
    const response = jsonResponse(cli([...agyArgsFor(testCase), '--assignment', assignment, '--admission-policy', defaultAdmissionPolicy, '--json'], testCase, { execution: 'blocked' }), 17, 'WORKER_BLOCKED');
    assert.equal(response.runner, 'agy');
    assert.equal(response.sandbox, 'requested');
    assert.match(response.message, /missing evidence/);
    assert.match(fs.readFileSync(testCase.report, 'utf8'), /STATUS: BLOCKED: missing evidence/);
    assert.ok(fs.existsSync(response.evidence.runLog));
  });

  check('A3 agy exit 0 without report (permission-denied log line) -> REPORT_INVALID, log retained', () => {
    const testCase = makeAgyCase('agy a3');
    const response = jsonResponse(cli([...agyArgsFor(testCase), '--json'], testCase, { execution: 'permission-denied' }), 16, 'REPORT_INVALID');
    assert.equal(events(testCase).length, 2);
    assert.equal(fs.existsSync(testCase.report), false);
    assert.ok(response.evidence.runLog && fs.existsSync(response.evidence.runLog));
    assert.match(fs.readFileSync(response.evidence.runLog, 'utf8'), /jetski: no output produced/);
  });

  check('A4 agy stale/pre-existing report -> delivery failure (pre-existing and created-during-readiness)', () => {
    const pre = makeAgyCase('agy a4 pre');
    fs.writeFileSync(pre.report, 'Old report.\nSTATUS: DONE\n');
    jsonResponse(cli([...agyArgsFor(pre), '--json'], pre), 10, 'INVALID_INPUT');
    assertNoRunner(pre);

    const during = makeAgyCase('agy a4 readiness');
    jsonResponse(cli([...agyArgsFor(during), '--json'], during, { readiness: 'create-stale-report' }), 16, 'REPORT_INVALID');
    const actualEvents = events(during);
    assert.equal(actualEvents.length, 1, 'stale report during readiness must block execution');
    assert.equal(actualEvents[0].phase, 'readiness');
  });

  check('A5 agy 429 RESOURCE_EXHAUSTED exit 3 -> RUNNER_QUOTA; other exit-3 shapes are NOT quota', () => {
    const readyQuota = makeAgyCase('agy a5 ready quota');
    const rq = jsonResponse(cli([...agyArgsFor(readyQuota, 'claude-sonnet-5-5-medium'), '--json'], readyQuota, { readiness: 'agy-quota' }), 13, 'RUNNER_QUOTA');
    assert.equal(rq.phase, 'readiness');
    assert.equal(events(readyQuota).length, 1);
    assert.ok(fs.existsSync(rq.evidence.readinessLog));

    const execQuota = makeAgyCase('agy a5 exec quota');
    const eq = jsonResponse(cli([...agyArgsFor(execQuota, 'claude-sonnet-5-5-medium'), '--json'], execQuota, { execution: 'agy-quota' }), 13, 'RUNNER_QUOTA');
    assert.equal(eq.phase, 'execution');
    assert.equal(events(execQuota).length, 2);
    assert.ok(fs.existsSync(eq.evidence.runLog));

    for (const scenario of ['agy-exit3-generic', 'agy-exit3-bare-429', 'agy-exit3-no-reset', 'agy-exit3-quoted', 'agy-exit3-stdout', 'agy-exit1-quota']) {
      const tc = makeAgyCase(`agy a5 ready ${scenario}`);
      const res = jsonResponse(cli([...agyArgsFor(tc, 'claude-sonnet-5-5-medium'), '--json'], tc, { readiness: scenario }), 12, 'NOT_READY');
      assert.equal(res.phase, 'readiness');
      assert.equal(events(tc).length, 1);
    }

    for (const scenario of ['agy-exit3-generic', 'agy-exit3-no-reset', 'agy-exit3-with-report', 'agy-exit1-quota']) {
      const tc = makeAgyCase(`agy a5 exec ${scenario}`);
      const res = jsonResponse(cli([...agyArgsFor(tc, 'claude-sonnet-5-5-medium'), '--json'], tc, { execution: scenario }), 15, 'RUN_FAILED');
      assert.equal(res.phase, 'execution');
      assert.equal(events(tc).length, 2);
    }
  });

  check('A6 agy readiness failure -> NOT_READY, no execution started', () => {
    for (const scenario of ['no-ready', 'ready-failed']) {
      const tc = makeAgyCase(`agy a6 ${scenario}`);
      const res = jsonResponse(cli([...agyArgsFor(tc), '--json'], tc, { readiness: scenario }), 12, 'NOT_READY');
      assert.equal(res.phase, 'readiness');
      assert.equal(events(tc).length, 1, 'no execution after readiness failure');
      assert.ok(res.evidence.readinessLog && fs.existsSync(res.evidence.readinessLog));
      assert.equal(res.evidence.runLog, undefined);
    }
    const missing = makeAgyCase('agy a6 missing bin');
    const res = jsonResponse(cli([...agyArgsFor(missing), '--json'], missing, { path: openCodeOnlyBin }), 12, 'NOT_READY');
    assert.equal(res.phase, 'readiness');
    assertNoRunner(missing);
  });

  check('A7 agy child exceeds bound -> killed, RUN_TIMEOUT, evidence retained', () => {
    const testCase = makeAgyCase('agy a7');
    const response = jsonResponse(cli([...agyArgsFor(testCase), '--json'], testCase, {
      execution: 'timeout', testTimeoutMs: 300, outerTimeoutMs: 5000,
    }), 15, 'RUN_TIMEOUT');
    const actualEvents = events(testCase);
    assert.equal(actualEvents.length, 2);
    assertProcessExited(actualEvents[1].pid);
    assert.ok(response.evidence.runLog && fs.existsSync(response.evidence.runLog));
    assert.ok(response.evidence.readinessLog && fs.existsSync(response.evidence.readinessLog));
  });

  check('A8 agy --effort is refused before spawn or writes', () => {
    const testCase = makeAgyCase('agy a8');
    const response = jsonResponse(cli([...agyArgsFor(testCase), '--effort', 'medium', '--json'], testCase), 10, 'INVALID_INPUT');
    assert.equal(response.phase, 'input');
    assert.match(response.message, /--effort is only supported for codex/);
    assertNoRunner(testCase);
    assertNoScratchOrReport(testCase);
  });

  check('A9 managed agy + worker verify:all -> GATE_REFUSED (conservative sandboxed profile); coordinator verify:all accepted', () => {
    for (const gate of ['verify:all', 'verify:all --fast']) {
      const testCase = makeAgyCase(`agy a9 ${gate}`);
      const assignment = writeAssignment(testCase, { schemaVersion: 1, gates: [...focused, { id: gate, actor: 'worker' }] });
      const res = jsonResponse(cli([...agyArgsFor(testCase), '--assignment', assignment, '--admission-policy', defaultAdmissionPolicy, '--json'], testCase), 18, 'GATE_REFUSED');
      assert.equal(res.phase, 'gate');
      assert.ok(res.message.includes(gate));
      assertRefusedBeforeSpawn(testCase);
      const dry = jsonResponse(cli([...agyArgsFor(testCase), '--assignment', assignment, '--admission-policy', defaultAdmissionPolicy, '--dry-run', '--json'], testCase), 18, 'GATE_REFUSED');
      assert.equal(dry.phase, 'gate');
      assertRefusedBeforeSpawn(testCase);
    }
    const okCase = makeAgyCase('agy a9 coord');
    const okAssignment = writeAssignment(okCase, { schemaVersion: 1, gates: [...focused, { id: 'verify:all', actor: 'coordinator' }] });
    const ok = jsonResponse(cli([...agyArgsFor(okCase), '--assignment', okAssignment, '--admission-policy', defaultAdmissionPolicy, '--json'], okCase), 0, 'DONE');
    assert.deepEqual(ok.gates, { worker: focused.map(item => item.id), coordinator: ['verify:all'] });
  });

  // #466 D-admission: managed C8 per-pool reservation cap (rows R1-R10).
  function writeAdmissionPolicy(value, raw) {
    const file = path.join(fixtureRoot, `admission-policy-${caseNumber}-${Math.random().toString(16).slice(2, 8)}.json`);
    fs.writeFileSync(file, raw !== undefined ? raw : JSON.stringify(value));
    return file;
  }
  function poolSlotFiles(admissionDir, pool) {
    const dir = path.join(admissionDir, pool);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => /^slot-\d+\.json$/.test(name)).sort();
  }
  function deadPid() {
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
    assert.ok(Number.isSafeInteger(exited.pid) && exited.pid > 0);
    assertProcessExited(exited.pid);
    return exited.pid;
  }

  check('R1 managed attempt reserves 1 slot before readiness (with holder+child pid) and releases after DONE', () => {
    const testCase = makeCase('admission r1');
    const admissionDir = path.join(fixtureRoot, `admission-r1-${caseNumber}`);
    const policy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: admissionDir,
      pools: { 'opencode-pilot-key': { cap: 2 } },
      routes: [{ runner: 'opencode', model: 'fixture/opencode-model', pool: 'opencode-pilot-key' }],
    });
    const assignment = managedAssignment(testCase);
    const snapshotFile = path.join(fixtureRoot, `r1-snapshot-${caseNumber}.json`);
    const response = jsonResponse(cli(
      [...managedArgs(testCase, assignment, 'opencode', policy), '--json'],
      testCase,
      { admissionHook: { snapshotDir: path.join(admissionDir, 'opencode-pilot-key'), snapshotFile } },
    ), 0, 'DONE');
    assert.deepEqual(response.admission, { pool: 'opencode-pilot-key', cap: 2, slot: 0 });
    assert.ok(fs.existsSync(snapshotFile), 'readiness child must observe the reserved slot');
    const snap = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    assert.equal(snap.slots.length, 1, 'exactly 1 slot reserved during readiness');
    assert.equal(snap.slots[0].name, 'slot-0.json');
    const slotMeta = JSON.parse(snap.slots[0].content);
    assert.equal(slotMeta.pool, 'opencode-pilot-key');
    assert.equal(slotMeta.slot, 0);
    assert.ok(Number.isSafeInteger(slotMeta.holderPid) && slotMeta.holderPid > 0);
    assert.equal(slotMeta.childPid, snap.childPid, 'slot records live childPid during readiness');
    assert.ok(typeof slotMeta.startedAt === 'string' && slotMeta.startedAt.length > 0);
    assert.deepEqual(poolSlotFiles(admissionDir, 'opencode-pilot-key'), [], 'slot released after child ends');
  });

  check('R2 missing or invalid admission policy or unknown runner+model pool -> refused before spawn', () => {
    const missingFlag = makeCase('admission r2 missing flag');
    const rMissingFlag = jsonResponse(cli([...managedArgs(missingFlag, managedAssignment(missingFlag), 'codex', null), '--json'], missingFlag), 21, 'ADMISSION_POLICY_INVALID');
    assert.equal(rMissingFlag.phase, 'admission');
    assertRefusedBeforeSpawn(missingFlag);

    const missingFile = makeCase('admission r2 missing file');
    const rMissingFile = jsonResponse(cli([...managedArgs(missingFile, managedAssignment(missingFile), 'codex', path.join(fixtureRoot, 'no-policy.json')), '--json'], missingFile), 21, 'ADMISSION_POLICY_INVALID');
    assert.equal(rMissingFile.phase, 'admission');
    assertRefusedBeforeSpawn(missingFile);

    const extDir = path.join(fixtureRoot, `admission-r2-valid-${caseNumber}`);
    const linkToRepo = path.join(fixtureRoot, `admission-r2-link-${caseNumber}`);
    fs.symlinkSync(worktree, linkToRepo, process.platform === 'win32' ? 'junction' : 'dir');
    const badPolicies = [
      ['not json', undefined, '{bad'],
      ['wrong schemaVersion', { schemaVersion: 2, dir: extDir, pools: { p: { cap: 1 } }, routes: [] }, undefined],
      ['unknown top-level key', { schemaVersion: 1, dir: extDir, pools: { p: { cap: 1 } }, routes: [], extra: 1 }, undefined],
      ['relative dir', { schemaVersion: 1, dir: 'relative/admission', pools: { p: { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }] }, undefined],
      ['dir inside git repo', { schemaVersion: 1, dir: path.join(worktree, 'admission'), pools: { p: { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }] }, undefined],
      ['dir inside linked worktree', { schemaVersion: 1, dir: path.join(linkedWorktree, 'admission'), pools: { p: { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }] }, undefined],
      ['dir symlink into repo', { schemaVersion: 1, dir: path.join(linkToRepo, 'admission'), pools: { p: { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }] }, undefined],
      ['cap zero', { schemaVersion: 1, dir: extDir, pools: { p: { cap: 0 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }] }, undefined],
      ['invalid pool id', { schemaVersion: 1, dir: extDir, pools: { '../escape': { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: '../escape' }] }, undefined],
      ['route to unknown pool', { schemaVersion: 1, dir: extDir, pools: { p: { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'missing-pool' }] }, undefined],
      ['duplicate route', { schemaVersion: 1, dir: extDir, pools: { p: { cap: 1 } }, routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }, { runner: 'codex', model: 'fixture/codex-model', pool: 'p' }] }, undefined],
      ['unmapped runner+model', { schemaVersion: 1, dir: extDir, pools: { p: { cap: 2 } }, routes: [{ runner: 'opencode', model: 'fixture/opencode-model', pool: 'p' }] }, undefined],
    ];
    for (const [label, value, raw] of badPolicies) {
      const tc = makeCase(`admission r2 ${label}`);
      const policy = writeAdmissionPolicy(value, raw);
      const res = jsonResponse(cli([...managedArgs(tc, managedAssignment(tc), 'codex', policy), '--json'], tc), 21, 'ADMISSION_POLICY_INVALID');
      assert.equal(res.phase, 'admission', label);
      assertRefusedBeforeSpawn(tc);
    }

    const overlapCase = makeCase('admission r2 scratch overlap');
    const overlapPolicy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: path.join(overlapCase.scratch, 'admission'),
      pools: { p: { cap: 2 } },
      routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'p' }],
    });
    const rOverlap = jsonResponse(cli([...managedArgs(overlapCase, managedAssignment(overlapCase), 'codex', overlapPolicy), '--json'], overlapCase), 21, 'ADMISSION_POLICY_INVALID');
    assert.equal(rOverlap.phase, 'admission');
    assertRefusedBeforeSpawn(overlapCase);

    const unmanagedWithPolicy = makeCase('admission r2 unmanaged flag');
    const rUnmanaged = jsonResponse(cli([...argsFor(unmanagedWithPolicy), '--admission-policy', defaultAdmissionPolicy, '--json'], unmanagedWithPolicy), 10, 'INVALID_INPUT');
    assert.equal(rUnmanaged.phase, 'input');
    assertRefusedBeforeSpawn(unmanagedWithPolicy);
  });

  check('R3 & R4 3 real concurrent processes on cap-2 pool (different model aliases & scratch roots) admit at most 2; excess refused before spawn; independent pool B remains eligible', () => {
    const admissionDir = path.join(fixtureRoot, `admission-r3-${caseNumber}`);
    const policy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: admissionDir,
      pools: {
        'opencode-pilot-key': { cap: 2 },
        'agy-shared-pool': { cap: 1 },
      },
      routes: [
        { runner: 'opencode', model: 'fixture/opencode-alias-a', pool: 'opencode-pilot-key' },
        { runner: 'opencode', model: 'fixture/opencode-alias-b', pool: 'opencode-pilot-key' },
        { runner: 'opencode', model: 'fixture/opencode-alias-c', pool: 'opencode-pilot-key' },
        { runner: 'agy', model: 'gemini-4-neon-medium', pool: 'agy-shared-pool' },
      ],
    });
    const gateFile = path.join(fixtureRoot, `r3-gate-${caseNumber}`);
    const aliases = ['fixture/opencode-alias-a', 'fixture/opencode-alias-b', 'fixture/opencode-alias-c'];
    const runs = aliases.map((model, idx) => {
      const tc = makeCase(`admission r3 ${idx}`);
      const assignment = managedAssignment(tc);
      const outFile = path.join(fixtureRoot, `r3-out-${caseNumber}-${idx}.json`);
      const enteredFile = path.join(fixtureRoot, `r3-entered-${caseNumber}-${idx}`);
      const fd = fs.openSync(outFile, 'w');
      const args = [...argsFor(tc, 'opencode', model), '--assignment', assignment, '--admission-policy', policy, '--json'];
      const child = spawn(process.execPath, [entry, ...args], {
        cwd: root,
        env: cliEnv(tc, { admissionHook: { enteredFile, gateFile } }),
        stdio: ['ignore', fd, fd],
      });
      return { tc, model, outFile, enteredFile, child, fd };
    });
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const readJson = file => {
      const text = fs.readFileSync(file, 'utf8');
      return text.endsWith('\n') ? JSON.parse(text) : null;
    };
    const deadline1 = Date.now() + 15000;
    while (
      (runs.filter(r => fs.existsSync(r.enteredFile)).length < 2 || runs.filter(r => readJson(r.outFile)?.code === 'ADMISSION_CAP_REACHED').length < 1)
      && Date.now() < deadline1
    ) {
      Atomics.wait(wait, 0, 0, 25);
    }
    const admittedWhileHeld = runs.filter(r => fs.existsSync(r.enteredFile));
    const refusedWhileHeld = runs.filter(r => readJson(r.outFile)?.code === 'ADMISSION_CAP_REACHED');
    assert.equal(admittedWhileHeld.length, 2, 'at most 2 concurrent holders admitted on cap-2 pool');
    assert.equal(refusedWhileHeld.length, 1, 'excess 3rd attempt refused immediately while 2 hold slots');
    assert.equal(events(refusedWhileHeld[0].tc).length, 0, 'excess attempt refused before spawn');
    assert.equal(fs.existsSync(refusedWhileHeld[0].tc.scratch), false, 'excess attempt created no scratch dir');
    assert.equal(poolSlotFiles(admissionDir, 'opencode-pilot-key').length, 2, 'pool A holds 2 slots');

    // R4: while pool A is full, independent pool B remains eligible and succeeds.
    const poolBCase = makeAgyCase('admission r4 pool b');
    const poolBRes = jsonResponse(cli(
      [...agyArgsFor(poolBCase, 'gemini-4-neon-medium'), '--assignment', managedAssignment(poolBCase), '--admission-policy', policy, '--json'],
      poolBCase,
    ), 0, 'DONE');
    assert.deepEqual(poolBRes.admission, { pool: 'agy-shared-pool', cap: 1, slot: 0 });
    assert.deepEqual(poolSlotFiles(admissionDir, 'agy-shared-pool'), [], 'pool B slot released after DONE');
    assert.equal(poolSlotFiles(admissionDir, 'opencode-pilot-key').length, 2, 'pool A slots untouched by pool B');

    // Release gate for the 2 admitted pool A holders.
    fs.writeFileSync(gateFile, 'go\n');
    const deadline2 = Date.now() + 15000;
    while (runs.some(r => !readJson(r.outFile)) && Date.now() < deadline2) Atomics.wait(wait, 0, 0, 25);
    for (const r of runs) {
      fs.closeSync(r.fd);
      try { r.child.kill('SIGKILL'); } catch {}
    }
    const results = runs.map(r => readJson(r.outFile));
    assert.equal(results.filter(r => r?.code === 'DONE').length, 2, JSON.stringify(results));
    assert.equal(results.filter(r => r?.code === 'ADMISSION_CAP_REACHED').length, 1, JSON.stringify(results));
    assert.deepEqual(poolSlotFiles(admissionDir, 'opencode-pilot-key'), [], 'all pool A slots released after children end');
  });

  for (const [label, runner, config, exitCode, code] of [
    ['readiness failure', 'codex', { readiness: 'ready-failed' }, 12, 'NOT_READY'],
    ['readiness quota', 'opencode', { readiness: 'quota-exhausted' }, 13, 'RUNNER_QUOTA'],
    ['runner failure', 'codex', { execution: 'exit-failure' }, 15, 'RUN_FAILED'],
    ['runner timeout', 'codex', { execution: 'timeout', testTimeoutMs: 300, outerTimeoutMs: 5000 }, 15, 'RUN_TIMEOUT'],
    ['WORKER_BLOCKED', 'codex', { execution: 'blocked' }, 17, 'WORKER_BLOCKED'],
    ['REPORT_INVALID', 'opencode', { execution: 'missing-report' }, 16, 'REPORT_INVALID'],
  ]) {
    check(`R5 ${label} releases admission slot after child ends`, () => {
      const tc = makeCase(`admission r5 ${label}`);
      const admissionDir = path.join(fixtureRoot, `admission-r5-${caseNumber}`);
      const policy = writeAdmissionPolicy({
        schemaVersion: 1,
        dir: admissionDir,
        pools: { 'pool-r5': { cap: 1 } },
        routes: [{ runner, model: runner === 'codex' ? 'fixture/codex-model' : 'fixture/opencode-model', pool: 'pool-r5' }],
      });
      const res = jsonResponse(cli([...managedArgs(tc, managedAssignment(tc), runner, policy), '--json'], tc, config), exitCode, code);
      assert.equal(res.admission?.pool, 'pool-r5');
      for (const ev of events(tc)) assertProcessExited(ev.pid);
      assert.deepEqual(poolSlotFiles(admissionDir, 'pool-r5'), [], `slot must be released after ${label}`);
    });
  }

  check('R6 stale slot whose holder and child pids are dead -> reclaimed', () => {
    const tc = makeCase('admission r6 stale');
    const admissionDir = path.join(fixtureRoot, `admission-r6-${caseNumber}`);
    const poolDir = path.join(admissionDir, 'pool-r6');
    fs.mkdirSync(poolDir, { recursive: true });
    const deadHolder = deadPid();
    const deadChild = deadPid();
    fs.writeFileSync(path.join(poolDir, 'slot-0.json'), JSON.stringify({
      schemaVersion: 1,
      pool: 'pool-r6',
      slot: 0,
      holderPid: deadHolder,
      childPid: deadChild,
      startedAt: '2026-11-26T00:00:00.000Z',
    }) + '\n');
    const policy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: admissionDir,
      pools: { 'pool-r6': { cap: 1 } },
      routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'pool-r6' }],
    });
    const res = jsonResponse(cli([...managedArgs(tc, managedAssignment(tc), 'codex', policy), '--json'], tc), 0, 'DONE');
    assert.deepEqual(res.admission, { pool: 'pool-r6', cap: 1, slot: 0 });
    assert.deepEqual(poolSlotFiles(admissionDir, 'pool-r6'), [], 'reclaimed slot released after DONE');
  });

  check('R7 live holder pid, dead holder with live child pid, EPERM pid, and corrupt slot -> NOT reclaimed; refused if cap reached', () => {
    const admissionDir = path.join(fixtureRoot, `admission-r7-${caseNumber}`);
    const poolDir = path.join(admissionDir, 'pool-r7');
    fs.mkdirSync(poolDir, { recursive: true });
    const policy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: admissionDir,
      pools: { 'pool-r7': { cap: 1 } },
      routes: [{ runner: 'codex', model: 'fixture/codex-model', pool: 'pool-r7' }],
    });
    const slotFile = path.join(poolDir, 'slot-0.json');

    // (a) live holderPid (this test runner process.pid)
    const liveHolderPayload = JSON.stringify({ schemaVersion: 1, pool: 'pool-r7', slot: 0, holderPid: process.pid, childPid: null, startedAt: '2026-11-26T00:00:00.000Z' }) + '\n';
    fs.writeFileSync(slotFile, liveHolderPayload);
    const tcHolder = makeCase('admission r7 live holder');
    const resHolder = jsonResponse(cli([...managedArgs(tcHolder, managedAssignment(tcHolder), 'codex', policy), '--json'], tcHolder), 22, 'ADMISSION_CAP_REACHED');
    assert.equal(resHolder.phase, 'admission');
    assertRefusedBeforeSpawn(tcHolder);
    assert.equal(fs.readFileSync(slotFile, 'utf8'), liveHolderPayload, 'live holder slot must not be reclaimed');

    // (b) dead holderPid, but live childPid
    const deadHolder = deadPid();
    const liveChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      const liveChildPayload = JSON.stringify({ schemaVersion: 1, pool: 'pool-r7', slot: 0, holderPid: deadHolder, childPid: liveChild.pid, startedAt: '2026-11-26T00:00:00.000Z' }) + '\n';
      fs.writeFileSync(slotFile, liveChildPayload);
      const tcChild = makeCase('admission r7 live child');
      const resChild = jsonResponse(cli([...managedArgs(tcChild, managedAssignment(tcChild), 'codex', policy), '--json'], tcChild), 22, 'ADMISSION_CAP_REACHED');
      assert.equal(resChild.phase, 'admission');
      assertRefusedBeforeSpawn(tcChild);
      assert.equal(fs.readFileSync(slotFile, 'utf8'), liveChildPayload, 'abandoned holder with live child must not be reclaimed');
    } finally {
      liveChild.kill('SIGKILL');
    }

    // (c) EPERM from process.kill(pid, 0) counts as alive
    const fakeEpermPid = 999991;
    const epermPayload = JSON.stringify({ schemaVersion: 1, pool: 'pool-r7', slot: 0, holderPid: fakeEpermPid, childPid: null, startedAt: '2026-11-26T00:00:00.000Z' }) + '\n';
    fs.writeFileSync(slotFile, epermPayload);
    const tcEperm = makeCase('admission r7 eperm');
    const resEperm = jsonResponse(cli(
      [...managedArgs(tcEperm, managedAssignment(tcEperm), 'codex', policy), '--json'],
      tcEperm,
      { admissionHook: { epermPid: fakeEpermPid } },
    ), 22, 'ADMISSION_CAP_REACHED');
    assert.equal(resEperm.phase, 'admission');
    assertRefusedBeforeSpawn(tcEperm);
    assert.equal(fs.readFileSync(slotFile, 'utf8'), epermPayload, 'EPERM slot must count as alive and not be reclaimed');

    // (d) corrupt/incomplete slot file fails closed (not reclaimed)
    fs.writeFileSync(slotFile, '{incomplete');
    const tcCorrupt = makeCase('admission r7 corrupt');
    const resCorrupt = jsonResponse(cli([...managedArgs(tcCorrupt, managedAssignment(tcCorrupt), 'codex', policy), '--json'], tcCorrupt), 22, 'ADMISSION_CAP_REACHED');
    assert.equal(resCorrupt.phase, 'admission');
    assertRefusedBeforeSpawn(tcCorrupt);
    assert.equal(fs.readFileSync(slotFile, 'utf8'), '{incomplete');
  });

  check('R8 managed --dry-run takes no reservation and creates no admission dir', () => {
    const tc = makeCase('admission r8 dry run');
    const admissionDir = path.join(fixtureRoot, `admission-r8-${caseNumber}`);
    const policy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: admissionDir,
      pools: { 'opencode-pilot-key': { cap: 2 } },
      routes: [{ runner: 'opencode', model: 'fixture/opencode-model', pool: 'opencode-pilot-key' }],
    });
    const res = jsonResponse(cli([...managedArgs(tc, managedAssignment(tc), 'opencode', policy), '--dry-run', '--json'], tc), 0, 'DRY_RUN_OK');
    assert.deepEqual(res.admission, { pool: 'opencode-pilot-key', cap: 2 });
    assert.equal(fs.existsSync(admissionDir), false, 'dry-run must not create admission dir or slots');
    assertRefusedBeforeSpawn(tc);
  });

  check('R9 emitted JSON, slot file, and evidence contain no credential values', () => {
    const tc = makeCase('admission r9 no secrets');
    const admissionDir = path.join(fixtureRoot, `admission-r9-${caseNumber}`);
    const policy = writeAdmissionPolicy({
      schemaVersion: 1,
      dir: admissionDir,
      pools: { 'opaque-pilot-pool': { cap: 2 } },
      routes: [{ runner: 'opencode', model: 'fixture/opencode-model', pool: 'opaque-pilot-pool' }],
    });
    const secretA = 'nvapi-SUPER-SECRET-TEST-KEY-98765';
    const secretB = 'sk-OPENAI-SECRET-TEST-KEY-54321';
    const snapshotFile = path.join(fixtureRoot, `r9-snapshot-${caseNumber}.json`);
    const rawResult = cli(
      [...managedArgs(tc, managedAssignment(tc), 'opencode', policy), '--json'],
      tc,
      {
        admissionHook: { snapshotDir: path.join(admissionDir, 'opaque-pilot-pool'), snapshotFile },
        extraEnv: { NVIDIA_API_KEY: secretA, OPENAI_API_KEY: secretB },
      },
    );
    const res = jsonResponse(rawResult, 0, 'DONE');
    const surfaces = [
      rawResult.stdout,
      fs.readFileSync(snapshotFile, 'utf8'),
      ...Object.values(res.evidence).map(file => fs.readFileSync(file, 'utf8')),
    ];
    for (const text of surfaces) {
      assert.equal(text.includes(secretA), false, 'secret A must not appear in emitted JSON/slot/evidence');
      assert.equal(text.includes(secretB), false, 'secret B must not appear in emitted JSON/slot/evidence');
    }
  });

  check('R10 unmanaged rows remain unchanged with no admission fields', () => {
    const tc = makeCase('admission r10 unmanaged');
    const dry = jsonResponse(cli([...argsFor(tc), '--dry-run', '--json'], tc), 0, 'DRY_RUN_OK');
    assert.equal(dry.admission, undefined);
    const done = jsonResponse(cli([...argsFor(tc), '--json'], tc), 0, 'DONE');
    assert.equal(done.admission, undefined);
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

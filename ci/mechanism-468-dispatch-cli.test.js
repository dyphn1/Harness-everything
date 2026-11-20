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
const tempRelative = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(path.resolve(tempParent)));
assert.ok(tempRelative === '..' || tempRelative.startsWith(`..${path.sep}`) || path.isAbsolute(tempRelative), 'test TMPDIR must be outside the repository');
const fixtureRoot = fs.mkdtempSync(path.join(tempParent, '468-dispatch-'));
const worktree = path.join(fixtureRoot, 'worktree');
const linkedWorktree = path.join(fixtureRoot, 'linked-worktree');
const runnerBin = path.join(fixtureRoot, 'bin');
const fixtureLog = path.join(fixtureRoot, 'runner.jsonl');
const packet = path.join(worktree, 'packet.md');
const model = 'fixture/codex-model';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function makeRepository() {
  fs.mkdirSync(worktree);
  run('git', ['init', '--quiet', worktree]);
  run('git', ['-C', worktree, 'config', 'user.name', 'Dispatch Fixture']);
  run('git', ['-C', worktree, 'config', 'user.email', 'dispatch-fixture@example.invalid']);
  fs.writeFileSync(packet, 'P1 fixture packet\n');
  run('git', ['-C', worktree, 'add', 'packet.md']);
  run('git', ['-C', worktree, 'commit', '--quiet', '-m', 'fixture']);
  run('git', ['-C', worktree, 'worktree', 'add', '--quiet', '--detach', linkedWorktree, 'HEAD']);
}

function makeRunnerPath() {
  fs.mkdirSync(runnerBin);
  const executable = path.join(runnerBin, process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (process.platform === 'win32') {
    try { fs.linkSync(process.execPath, executable); } catch { fs.copyFileSync(process.execPath, executable); }
  } else fs.symlinkSync(process.execPath, executable);
  fs.copyFileSync(fixtureRunner, path.join(worktree, 'exec'));
}

makeRepository();
makeRunnerPath();
fs.mkdirSync(path.join(fixtureRoot, 'reports'));

const baseArgs = [
  '--runner', 'codex', '--model', model,
  '--packet', packet, '--worktree', worktree,
  '--scratch', path.join(fixtureRoot, 'run-scratch'),
  '--report', path.join(fixtureRoot, 'reports', 'success.md'),
];

function cli(args, scratch = path.join(fixtureRoot, 'run-scratch'), report = path.join(fixtureRoot, 'reports', 'success.md')) {
  const env = { ...process.env, PATH: runnerBin, TMPDIR: scratch, DISPATCH_FIXTURE_LOG: fixtureLog };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    input: 'parent stdin must not reach the runner\n',
    timeout: 15000,
  });
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

const humanHelp = cli(['--help']);
assert.equal(humanHelp.status, 0, humanHelp.stderr);
assert.match(humanHelp.stdout, /Usage:.*dispatch/);
assert.equal(humanHelp.stderr, '');

const jsonHelp = jsonResponse(cli(['--help', '--json']), 0, 'HELP');
assert.match(jsonHelp.message, /--runner <codex\|opencode>/);

const invalidArgs = baseArgs.filter((value, index, values) => !(value === '--model' || values[index - 1] === '--model'));
const invalid = jsonResponse(cli([...invalidArgs, '--json']), 10, 'INVALID_INPUT');
assert.equal(invalid.phase, 'input');
assert.doesNotMatch(invalid.message, /fixture child output/);
const boundedError = jsonResponse(cli([`--${'x'.repeat(1500)}`, '--json']), 10, 'INVALID_INPUT');
assert.equal(boundedError.message.length, 1000);

const fakeWorktree = path.join(fixtureRoot, 'invalid-worktree');
fs.mkdirSync(path.join(fakeWorktree, '.git'), { recursive: true });
const invalidWorktreeArgs = [...baseArgs];
invalidWorktreeArgs[invalidWorktreeArgs.indexOf('--worktree') + 1] = fakeWorktree;
const invalidWorktree = jsonResponse(cli([...invalidWorktreeArgs, '--dry-run', '--json'], path.join(fixtureRoot, 'invalid-scratch')), 10, 'INVALID_INPUT');
assert.equal(invalidWorktree.phase, 'input');

const dryScratch = path.join(fixtureRoot, 'dry-run-scratch');
const dryReport = path.join(fixtureRoot, 'reports', 'dry-run.md');
const dryRun = jsonResponse(cli([
  '--runner', 'codex', '--model', model, '--packet', packet, '--worktree', worktree,
  '--scratch', dryScratch, '--report', dryReport, '--dry-run', '--json',
], dryScratch, dryReport), 0, 'DRY_RUN_OK');
assert.equal(dryRun.phase, 'dry-run');
assert.equal(fs.existsSync(dryScratch), false);
assert.equal(fs.existsSync(dryReport), false);
assert.equal(fs.existsSync(fixtureLog), false);

assert.equal(fs.statSync(path.join(linkedWorktree, '.git')).isFile(), true);
const unsafe = jsonResponse(cli([
  '--runner', 'codex', '--model', model, '--packet', packet, '--worktree', worktree,
  '--scratch', path.join(linkedWorktree, 'scratch'), '--report', path.join(fixtureRoot, 'reports', 'unsafe.md'), '--json',
], path.join(linkedWorktree, 'scratch'), path.join(fixtureRoot, 'reports', 'unsafe.md')), 11, 'UNSAFE_SCRATCH');
assert.equal(unsafe.phase, 'validation');
assert.equal(fs.existsSync(fixtureLog), false);

const runScratch = path.join(fixtureRoot, 'run-scratch');
const success = jsonResponse(cli([...baseArgs, '--json'], runScratch, baseArgs[baseArgs.indexOf('--report') + 1]), 0, 'DONE');
assert.equal(success.runner, 'codex');
assert.equal(success.model, model);
assert.equal(fs.existsSync(success.evidence.readinessOutput), true);
assert.equal(fs.existsSync(success.evidence.rawOutput), true);
assert.equal(fs.existsSync(success.evidence.runLog), true);
assert.equal(fs.existsSync(success.evidence.readinessLog), true);
assert.equal(fs.readFileSync(success.evidence.report, 'utf8'), 'Fixture completed the packet.\nSTATUS: DONE\n');
assert.match(fs.readFileSync(success.evidence.reportWriterLog, 'utf8'), /Wrote .*success\.md[\s\S]*valid \(STATUS: DONE\)/);

const events = fs.readFileSync(fixtureLog, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(events.length, 2);
for (const event of events) {
  assert.equal(event.cwd, fs.realpathSync(worktree));
  assert.equal(event.tmpdir, runScratch);
  assert.equal(event.stdin, '');
  assert.equal(event.stdinIsCharacterDevice, true);
  assert.equal(event.args[event.args.indexOf('-m') + 1], model);
  assert.equal(event.args[event.args.indexOf('-C') + 1], fs.realpathSync(worktree));
}
assert.equal(events[0].args.at(-1), 'Reply exactly with READY.');
assert.equal(events[1].args.at(-1), `Execute the packet at ${packet} and return the complete report body.`);

run('git', ['-C', worktree, 'worktree', 'remove', '--force', linkedWorktree]);
fs.rmSync(fixtureRoot, { recursive: true, force: true });
console.log('mechanism-468-dispatch-cli: P1 subprocess path passed');

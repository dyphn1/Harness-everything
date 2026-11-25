#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'errors-local.js');
const localErrors = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'local-errors.js'));

let failures = 0;
const sandboxes = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n    ${error.stack.split('\n').slice(0, 5).join('\n    ')}`);
  }
}

function canonicalDir(dir) {
  return fs.realpathSync.native ? fs.realpathSync.native(dir) : fs.realpathSync(dir);
}

function makeSandbox() {
  const dir = canonicalDir(fs.mkdtempSync(path.join(os.tmpdir(), 'local-err-cli-edges-')));
  sandboxes.push(dir);
  const home = path.join(dir, 'home');
  const store = path.join(dir, 'observations');
  const stateHome = path.join(dir, 'state-home');
  const repo = path.join(dir, 'repo');
  for (const p of [home, store, stateHome, repo]) {
    fs.mkdirSync(p, { recursive: true });
  }
  execFileSync('git', ['init', '-q', repo]);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HARNESS_OBSERVATIONS_DIR: store,
    HARNESS_STATE_HOME: stateHome,
  };
  delete env.HARNESS_OBSERVATIONS;
  delete env.HARNESS_SYSTEM_ONE_MODE;
  delete env.HARNESS_WORKSPACE_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CODEX_PROJECT_DIR;
  return { dir, home, store, stateHome, repo, env };
}

function runCli(args, { cwd, env }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

console.log('mechanism-496-local-error-cli-edges:');

test('list and export reject --limit 0 with exit 2 while --limit >= 1 bounds output', () => {
  const s = makeSandbox();
  for (const suffix of ['one', 'two', 'three']) {
    const addRes = runCli([
      'add',
      '--executable', 'git',
      '--subcommand', 'commit',
      '--lesson', `Lesson ${suffix}`,
    ], { cwd: s.repo, env: s.env });
    assert.equal(addRes.status, 0, addRes.stderr);
  }

  for (const subcmd of ['list', 'export']) {
    for (const badLimit of ['0', '00', '-1', 'abc']) {
      const badRes = runCli([subcmd, '--limit', badLimit], { cwd: s.repo, env: s.env });
      assert.equal(
        badRes.status,
        2,
        `expected ${subcmd} --limit ${badLimit} to exit 2, got ${badRes.status} (${badRes.stdout} / ${badRes.stderr})`
      );
      assert.match(badRes.stderr, /invalid --limit/);
    }
  }

  // Positive controls: --limit 1 and --limit 2 return bounded records with exit 0.
  const listOne = runCli(['list', '--limit', '1', '--json'], { cwd: s.repo, env: s.env });
  assert.equal(listOne.status, 0, listOne.stderr);
  const oneItems = JSON.parse(listOne.stdout);
  assert.equal(oneItems.length, 1);
  assert.equal(oneItems[0].lesson, 'Lesson three');

  const exportTwo = runCli(['export', '--limit', '2'], { cwd: s.repo, env: s.env });
  assert.equal(exportTwo.status, 0, exportTwo.stderr);
  const exportedLines = exportTwo.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(exportedLines.length, 2);
  assert.deepEqual(exportedLines.map(r => r.lesson), ['Lesson two', 'Lesson three']);
});

test('deriveSignature hashes redacted lesson so different HOMEs and secrets produce identical signature and provisionalId', () => {
  const s = makeSandbox();
  const homeAlice = path.join(s.dir, 'home-alice');
  const homeBob = path.join(s.dir, 'home-bob');
  const storeAlice = path.join(s.dir, 'obs-alice');
  const storeBob = path.join(s.dir, 'obs-bob');
  for (const p of [homeAlice, homeBob, storeAlice, storeBob]) {
    fs.mkdirSync(p, { recursive: true });
  }

  const envAlice = { ...s.env, HOME: homeAlice, USERPROFILE: homeAlice, HARNESS_OBSERVATIONS_DIR: storeAlice };
  const envBob = { ...s.env, HOME: homeBob, USERPROFILE: homeBob, HARNESS_OBSERVATIONS_DIR: storeBob };

  const addAlice = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', `Avoid ${homeAlice}/foo`,
    '--json',
  ], { cwd: s.repo, env: envAlice });
  assert.equal(addAlice.status, 0, addAlice.stderr);
  const recAlice = JSON.parse(addAlice.stdout).record;

  const addBob = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', `Avoid ${homeBob}/foo`,
    '--json',
  ], { cwd: s.repo, env: envBob });
  assert.equal(addBob.status, 0, addBob.stderr);
  const recBob = JSON.parse(addBob.stdout).record;

  assert.equal(recAlice.lesson, 'Avoid <home>/foo');
  assert.equal(recBob.lesson, 'Avoid <home>/foo');
  assert.equal(recAlice.signature, recBob.signature, 'identical redacted lessons must derive identical signatures across HOMEs');
  assert.equal(recAlice.provisionalId, recBob.provisionalId, 'identical redacted lessons must derive identical provisionalIds');

  // Token and email redaction also collapse before signature derivation.
  const addSecretA = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Never commit alice@example.com or ghp_1234567890abcdefghijklmnopqrstuv',
    '--json',
  ], { cwd: s.repo, env: envAlice });
  assert.equal(addSecretA.status, 0, addSecretA.stderr);

  const addSecretB = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Never commit bob@example.org or ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--json',
  ], { cwd: s.repo, env: envBob });
  assert.equal(addSecretB.status, 0, addSecretB.stderr);

  assert.equal(
    JSON.parse(addSecretA.stdout).record.signature,
    JSON.parse(addSecretB.stdout).record.signature,
    'emails and tokens must redact before signature derivation'
  );

  // Positive control: distinct redacted lessons still derive distinct signatures.
  const addDifferent = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', `Avoid ${homeAlice}/bar`,
    '--json',
  ], { cwd: s.repo, env: envAlice });
  assert.equal(addDifferent.status, 0, addDifferent.stderr);
  const recDifferent = JSON.parse(addDifferent.stdout).record;
  assert.notEqual(recDifferent.signature, recAlice.signature);
  assert.notEqual(recDifferent.provisionalId, recAlice.provisionalId);
});

test('add exits 1 on store I/O error (EISDIR on rename) and exits 2 on store validation errors', () => {
  const s = makeSandbox();
  const storeFile = localErrors.getStorePath({ env: s.env }).file;
  // Create a directory at errors-index.json so fs.renameSync throws EISDIR cross-platform.
  fs.mkdirSync(storeFile, { recursive: true });

  const ioErrRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Valid lesson hitting store I/O failure',
  ], { cwd: s.repo, env: s.env });
  assert.equal(
    ioErrRes.status,
    1,
    `expected EISDIR store I/O error to exit 1, got ${ioErrRes.status} (${ioErrRes.stdout} / ${ioErrRes.stderr})`
  );
  assert.match(ioErrRes.stderr, /^error:/);
  assert.doesNotMatch(ioErrRes.stderr, /^usage error:/);

  // Validation errors from the store still exit 2.
  const validationCases = [
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--issue', 'https://github.com/org/repo/issues/1#ghp_1234567890abcdefghijklmnopqrstuv'],
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--promotion-id', 'not-an-e-id'],
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--destination', 'invalid-dest'],
  ];
  for (const args of validationCases) {
    const valRes = runCli(args, { cwd: s.repo, env: s.env });
    assert.equal(valRes.status, 2, `expected validation error exit 2 for ${JSON.stringify(args)}, got ${valRes.status}`);
    assert.match(valRes.stderr, /^usage error:/);
  }

  // Positive control: clean store succeeds with exit 0.
  fs.rmSync(storeFile, { recursive: true, force: true });
  const okRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Valid lesson on clean store',
  ], { cwd: s.repo, env: s.env });
  assert.equal(okRes.status, 0, okRes.stderr);
});

for (const dir of sandboxes) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');

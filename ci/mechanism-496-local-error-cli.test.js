#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'errors-local.js');
const ERRORS_SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const SOURCE_PATH = path.join(ROOT, 'hooks', 'scripts', 'lib', 'local-error-source.js');
const PACKAGED_SOURCE_PATH = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib', 'local-error-source.js');
const LEDGER_DIR = path.join(ROOT, '.agents', 'harness-everything', 'errors');
const E3_FILE = fs.readdirSync(LEDGER_DIR).find(file => /^E-0003-[a-z0-9-]+\.md$/.test(file));
const E3_TEXT = fs.readFileSync(path.join(LEDGER_DIR, E3_FILE), 'utf8');

const localErrors = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'local-errors.js'));
const { matchLedgerLessons } = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'ledger-match.js'));

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
  const dir = canonicalDir(fs.mkdtempSync(path.join(os.tmpdir(), 'local-err-cli-')));
  sandboxes.push(dir);
  const home = path.join(dir, 'home');
  const store = path.join(dir, 'observations');
  const stateHome = path.join(dir, 'state-home');
  const repoA = path.join(dir, 'repo-a');
  const repoB = path.join(dir, 'repo-b');
  const matcherState = path.join(dir, 'matcher-state');
  for (const p of [home, store, stateHome, repoA, repoB, matcherState]) {
    fs.mkdirSync(p, { recursive: true });
  }
  execFileSync('git', ['init', '-q', repoA]);
  execFileSync('git', ['init', '-q', repoB]);
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
  return { dir, home, store, stateHome, repoA, repoB, matcherState, env };
}

function runCli(args, { cwd, env }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function installRealE3Ledger(repoRoot, env) {
  const targetDir = path.join(repoRoot, '.agents', 'harness-everything', 'errors');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, E3_FILE), E3_TEXT, 'utf8');
  const res = spawnSync(process.execPath, [ERRORS_SYNC, '--root', repoRoot], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(res.status, 0, `errors-sync failed: ${res.stderr}`);
}

function loadProvisionalSource() {
  return require(SOURCE_PATH);
}

console.log('mechanism-496-local-error-cli:');

test('package.json registers errors:local script pointing to scripts/errors-local.js', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['errors:local'], 'node scripts/errors-local.js');
});

test('CLI add valid provisional lesson via flags and list shows it', () => {
  const s = makeSandbox();
  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Keep commit subjects lowercase and under 100 chars.',
    '--cue', 'Commit rejected locally by commitlint.',
    '--issue', 'https://github.com/dyphn1/Harness-everything/issues/496',
    '--destination', 'harness',
    '--json',
  ], { cwd: s.repoA, env: s.env });

  assert.equal(addRes.status, 0, `expected exit 0, got ${addRes.status}: ${addRes.stderr}`);
  const added = JSON.parse(addRes.stdout);
  assert.equal(added.status, 'appended');
  assert.equal(added.record.kind, 'provisional-lesson');
  assert.equal(added.record.destination, 'harness');
  assert.equal(added.record.issueUrl, 'https://github.com/dyphn1/Harness-everything/issues/496');
  assert.deepEqual(added.record.match, {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  });
  assert.match(added.record.provisionalId, /^[a-z0-9][a-z0-9_-]{0,63}$/);
  assert.doesNotMatch(added.record.provisionalId, /^E-/i);

  const listJson = runCli(['list', '--kind', 'provisional-lesson', '--json'], { cwd: s.repoA, env: s.env });
  assert.equal(listJson.status, 0, listJson.stderr);
  const items = JSON.parse(listJson.stdout);
  assert.equal(items.length, 1);
  assert.equal(items[0].provisionalId, added.record.provisionalId);
  assert.equal(items[0].lesson, 'Keep commit subjects lowercase and under 100 chars.');

  const listText = runCli(['list'], { cwd: s.repoA, env: s.env });
  assert.equal(listText.status, 0, listText.stderr);
  assert.ok(listText.stdout.includes(added.record.provisionalId));
  assert.ok(listText.stdout.includes('Keep commit subjects lowercase'));
});

test('CLI add supports --diagnostic for failure rules and --match-json for full rules', () => {
  const s = makeSandbox();
  const diagRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--diagnostic', 'subject-case',
    '--diagnostic', 'header-max-length',
    '--lesson', 'Lowercase subject and keep header <= 100 chars.',
    '--json',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(diagRes.status, 0, diagRes.stderr);
  const diagRec = JSON.parse(diagRes.stdout).record;
  assert.deepEqual(diagRec.match, {
    failures: [{
      tool: 'shell',
      executable: 'git',
      subcommand: 'commit',
      diagnostics: ['subject-case', 'header-max-length'],
    }],
  });

  const matchJson = JSON.stringify({
    actions: [{ tool: 'shell', executable: 'npm', subcommand: 'test' }],
  });
  const jsonRes = runCli([
    'add',
    '--match-json', matchJson,
    '--lesson', 'Isolate HOME and HARNESS_OBSERVATIONS_DIR in tests.',
    '--destination', 'project',
    '--json',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(jsonRes.status, 0, jsonRes.stderr);
  const jsonRec = JSON.parse(jsonRes.stdout).record;
  assert.equal(jsonRec.destination, 'project');
  assert.deepEqual(jsonRec.match, {
    actions: [{ tool: 'shell', executable: 'npm', subcommand: 'test' }],
  });
});

test('CLI add rejects invalid match, invalid destination, and credential URLs with exit 2 and leaves store unchanged', () => {
  const s = makeSandbox();
  const storeFile = localErrors.getStorePath({ env: s.env }).file;

  const badCases = [
    ['add', '--match-json', '{bad json', '--lesson', 'x'],
    ['add', '--match-json', JSON.stringify({ actions: [{ tool: 'shell', executable: 'GIT', subcommand: 'commit' }] }), '--lesson', 'x'],
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--destination', 'invalid-dest'],
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--issue', 'http://github.com/org/repo/issues/1'],
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--issue', 'https://user:pass@github.com/org/repo/issues/1'],
    ['add', '--executable', 'git', '--subcommand', 'commit', '--lesson', 'x', '--issue', 'https://github.com/org/repo/issues/1?token=ghp_1234567890abcdefghijklmnopqrstuv'],
    ['add', '--executable', 'git', '--subcommand', 'commit'],
    ['add', '--lesson', 'missing match rule'],
    ['add', '--match-json', JSON.stringify({ actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }] }), '--executable', 'git', '--subcommand', 'commit', '--lesson', 'ambiguous'],
  ];

  for (const args of badCases) {
    const res = runCli(args, { cwd: s.repoA, env: s.env });
    assert.equal(res.status, 2, `expected exit 2 for ${JSON.stringify(args)}, got ${res.status} (${res.stdout} / ${res.stderr})`);
    assert.equal(fs.existsSync(storeFile), false, `store must remain untouched after invalid args: ${JSON.stringify(args)}`);
  }
});

test('CLI export emits redacted bounded JSONL lines with no raw output or counts', () => {
  const s = makeSandbox();
  const secretToken = 'ghp_1234567890abcdefghijklmnopqrstuv';
  const rawOutput = `Error for alice@example.com in ${s.home}/secret/file.js with ${secretToken}\n${'x'.repeat(5000)}`;
  const occ = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    sessionKey: 'raw-session-1',
    toolUseId: 'raw-tool-1',
    command: `node deploy.js --token ${secretToken}`,
    exitCode: 1,
    output: rawOutput,
  }, { env: s.env });
  assert.equal(occ.status, 'appended');

  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', `Avoid leaking alice@example.com or ${s.home}/keys or ${secretToken}`,
    '--destination', 'project',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(addRes.status, 0, addRes.stderr);

  const expRes = runCli(['export'], { cwd: s.repoA, env: s.env });
  assert.equal(expRes.status, 0, expRes.stderr);
  const lines = expRes.stdout.trim().split('\n');
  assert.equal(lines.length, 2);

  for (const line of lines) {
    assert.ok(!line.includes('alice@example.com'), 'email must be redacted in export');
    assert.ok(!line.includes(s.home), 'HOME path must be redacted in export');
    assert.ok(!line.includes(secretToken), 'token must be redacted in export');
    const obj = JSON.parse(line);
    assert.equal(Object.hasOwn(obj, 'output'), false, 'raw output field must not appear');
    assert.equal(Object.hasOwn(obj, 'rawOutput'), false, 'rawOutput field must not appear');
    assert.equal(Object.hasOwn(obj, 'command'), false, 'raw command field must not appear');
    assert.equal(Object.hasOwn(obj, 'count'), false, 'count must not appear');
    assert.equal(Object.hasOwn(obj, 'counts'), false, 'counts must not appear');
    if (obj.kind === 'occurrence') {
      assert.ok(Buffer.byteLength(obj.outputExcerpt, 'utf8') <= localErrors.LIMITS.maxExcerptBytes);
    }
  }
});

test('provisional source projects only matcher fields and delivers provisional lesson via matchLedgerLessons', () => {
  const s = makeSandbox();
  const { createProvisionalSource } = loadProvisionalSource();

  // Add an occurrence too, to confirm occurrences are never projected as lessons.
  localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'git commit -m "Bad"',
    exitCode: 1,
    output: '✖   subject must be lower-case [subject-case]',
  }, { env: s.env });

  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--signature', 'local-commit-rule',
    '--lesson', 'Use lowercase commit subjects in this repo.',
    '--cue', 'Before running git commit.',
    '--issue', 'https://github.com/dyphn1/Harness-everything/issues/496',
    '--destination', 'project',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(addRes.status, 0, addRes.stderr);

  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repoA });
  const projected = source('workspace:a', { maxCandidates: 32, maxBytes: 65536, maxTextChars: 4096 });
  assert.equal(projected.length, 1);

  const allowedKeys = new Set(['identity', 'signature', 'promotionId', 'match', 'cue', 'lesson']);
  for (const key of Object.keys(projected[0])) {
    assert.ok(allowedKeys.has(key), `unexpected projected key: ${key}`);
  }
  assert.equal(Object.hasOwn(projected[0], 'issueUrl'), false);
  assert.equal(Object.hasOwn(projected[0], 'outputExcerpt'), false);
  assert.equal(Object.hasOwn(projected[0], 'count'), false);
  assert.equal(Object.hasOwn(projected[0], 'counts'), false);

  const matched = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: 'workspace:a',
    sessionIdentity: 'session:1',
    stateDir: path.join(s.matcherState, 's1'),
    event: { phase: 'action', tool: 'shell', command: 'git commit -m "test"', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });

  assert.ok(matched, 'expected matchLedgerLessons to return the provisional lesson');
  assert.ok(matched.text.includes('Provisional local lesson (unreviewed)'), 'must be labelled provisional');
  assert.ok(matched.text.includes('Use lowercase commit subjects in this repo.'));
  assert.ok(!matched.text.includes('https://github.com/dyphn1/Harness-everything/issues/496'), 'issueUrl must stay out of model context');
  assert.equal(matched.ids.length, 1);
  assert.equal(matched.ids[0], projected[0].identity);
});

test('repo lesson retains precedence over provisional lesson for the same rule', () => {
  const s = makeSandbox();
  installRealE3Ledger(s.repoA, s.env);
  const { createProvisionalSource } = loadProvisionalSource();

  // Same signature as E-0003 (commitlint-subject-case-length).
  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--signature', 'commitlint-subject-case-length',
    '--lesson', 'Provisional duplicate that repo E-0003 must supersede.',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(addRes.status, 0, addRes.stderr);

  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repoA });
  const matched = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: 'workspace:a',
    sessionIdentity: 'session:precedence',
    stateDir: path.join(s.matcherState, 'precedence'),
    event: { phase: 'action', tool: 'shell', command: 'git commit -m "feat: ok"', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });

  assert.ok(matched);
  assert.deepEqual(matched.ids, ['E-0003']);
  assert.ok(!matched.text.includes('Provisional duplicate that repo E-0003 must supersede.'));
  assert.ok(!matched.text.includes('Provisional local lesson (unreviewed)'));
});

test('workspace B cannot see workspace A lessons in CLI or provisional source', () => {
  const s = makeSandbox();
  const { createProvisionalSource } = loadProvisionalSource();

  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Secret workspace A workaround.',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(addRes.status, 0, addRes.stderr);

  const listB = runCli(['list', '--json'], { cwd: s.repoB, env: s.env });
  assert.equal(listB.status, 0, listB.stderr);
  assert.deepEqual(JSON.parse(listB.stdout), []);

  const exportB = runCli(['export'], { cwd: s.repoB, env: s.env });
  assert.equal(exportB.status, 0, exportB.stderr);
  assert.equal(exportB.stdout.trim(), '');

  const sourceB = createProvisionalSource({ env: s.env, workspaceRoot: s.repoB });
  assert.deepEqual(sourceB('workspace:b', { maxCandidates: 32, maxBytes: 65536, maxTextChars: 4096 }), []);

  const matchedB = matchLedgerLessons({
    workspaceRoot: s.repoB,
    workspaceIdentity: 'workspace:b',
    sessionIdentity: 'session:b',
    stateDir: path.join(s.matcherState, 'ws-b'),
    event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } },
    provisionalSource: sourceB,
  });
  assert.equal(matchedB, null);
});

test('provisional source reflects newly added lessons on the next hook event', () => {
  const s = makeSandbox();
  const { createProvisionalSource } = loadProvisionalSource();
  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repoA });

  // Before CLI add: nothing matches.
  const before = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: 'workspace:a',
    sessionIdentity: 'session:live',
    stateDir: path.join(s.matcherState, 'live'),
    event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });
  assert.equal(before, null);

  // Add via CLI without recreating source.
  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Added live between hook events.',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(addRes.status, 0, addRes.stderr);

  const after = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: 'workspace:a',
    sessionIdentity: 'session:live',
    stateDir: path.join(s.matcherState, 'live'),
    event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });
  assert.ok(after);
  assert.ok(after.text.includes('Added live between hook events.'));
});

test('unreadable or corrupt store fails open and matcher still serves repo lessons', () => {
  const s = makeSandbox();
  installRealE3Ledger(s.repoA, s.env);
  const { createProvisionalSource } = loadProvisionalSource();

  // Corrupt store: create a directory at the index file path so readFileSync fails cross-platform (EISDIR).
  const storeFile = localErrors.getStorePath({ env: s.env }).file;
  fs.mkdirSync(storeFile, { recursive: true });

  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repoA });
  assert.deepEqual(source('workspace:a', { maxCandidates: 32, maxBytes: 65536, maxTextChars: 4096 }), []);

  const matched = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: 'workspace:a',
    sessionIdentity: 'session:failopen',
    stateDir: path.join(s.matcherState, 'failopen'),
    event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });
  assert.ok(matched, 'matcher must still serve repo lessons when local store is unreadable');
  assert.deepEqual(matched.ids, ['E-0003']);
});

test('packaged local-error-source copy exists and matches canonical behavior', () => {
  const s = makeSandbox();
  const { createProvisionalSource } = require(PACKAGED_SOURCE_PATH);

  const addRes = runCli([
    'add',
    '--executable', 'git',
    '--subcommand', 'commit',
    '--lesson', 'Packaged source check.',
  ], { cwd: s.repoA, env: s.env });
  assert.equal(addRes.status, 0, addRes.stderr);

  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repoA });
  const projected = source('workspace:a', { maxCandidates: 32, maxBytes: 65536, maxTextChars: 4096 });
  assert.equal(projected.length, 1);
  assert.equal(projected[0].lesson, 'Packaged source check.');
});

for (const dir of sandboxes) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');

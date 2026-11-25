#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'errors-local.js');
const localErrors = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'local-errors.js'));
const { createProvisionalSource } = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'local-error-source.js'));
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
  const dir = canonicalDir(fs.mkdtempSync(path.join(os.tmpdir(), 'local-err-review-')));
  sandboxes.push(dir);
  const home = path.join(dir, 'home');
  const store = path.join(dir, 'observations');
  const stateHome = path.join(dir, 'state-home');
  const repo = path.join(dir, 'repo');
  const matcherState = path.join(dir, 'matcher-state');
  for (const p of [home, store, stateHome, repo, matcherState]) {
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
  return { dir, store, repo, matcherState, env };
}

function runCli(args, sandbox) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: sandbox.repo,
    env: sandbox.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function actionMatch() {
  return { actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }] };
}

console.log('mechanism-496-review-fixes:');

test('redacts complete Basic/Bearer authorization values before storage and signature derivation', () => {
  const s = makeSandbox();
  const fixtures = [
    { header: 'Authorization', scheme: 'Basic', credential: 'BASIC_FIXTURE_ALPHA_91' },
    { header: 'aUtHoRiZaTiOn', scheme: 'bAsIc', credential: 'BASIC_FIXTURE_BETA_82' },
    { header: 'Proxy-Authorization', scheme: 'Bearer', credential: 'BEARER_FIXTURE_ALPHA_73' },
    { header: 'pRoXy-aUtHoRiZaTiOn', scheme: 'bEaReR', credential: 'BEARER_FIXTURE_BETA_64' },
  ];
  const credentials = fixtures.map(row => row.credential);

  for (const [index, row] of fixtures.entries()) {
    const res = localErrors.appendOccurrence({
      workspaceRoot: s.repo,
      host: 'claude',
      sessionKey: `auth-session-${index}`,
      toolUseId: `auth-tool-${index}`,
      command: 'node synthetic-check.js',
      exitCode: 1,
      output: `Fatal synthetic diagnostic AUTH_CONTROL\n${row.header}: ${row.scheme} ${row.credential}`,
    }, { env: s.env });
    assert.equal(res.status, 'appended');
    assert.ok(!res.record.outputExcerpt.includes(row.credential), 'stored occurrence excerpt must omit the whole credential');
    assert.ok(res.record.outputExcerpt.includes('Fatal synthetic diagnostic AUTH_CONTROL'), 'diagnostic remains usable');
  }

  const sameFailure = (credential, toolUseId) => localErrors.appendOccurrence({
    workspaceRoot: s.repo,
    host: 'codex',
    sessionKey: 'signature-session',
    toolUseId,
    command: 'node synthetic-check.js',
    exitCode: 1,
    output: `Fatal synthetic diagnostic SIGNATURE_CONTROL\nAuthorization: Basic ${credential}`,
  }, { env: s.env });
  const first = sameFailure('BASIC_SIGNATURE_FIXTURE_11', 'signature-tool-1');
  const second = sameFailure('BASIC_SIGNATURE_FIXTURE_22', 'signature-tool-2');
  assert.equal(first.record.signature, second.record.signature,
    'automatic signatures must ignore only the authorization payload');
  const differentDiagnostic = localErrors.appendOccurrence({
    workspaceRoot: s.repo,
    host: 'codex',
    command: 'node synthetic-check.js',
    exitCode: 1,
    output: 'Fatal synthetic diagnostic DIFFERENT_CONTROL\nAuthorization: Basic BASIC_SIGNATURE_FIXTURE_33',
  }, { env: s.env });
  assert.notEqual(first.record.signature, differentDiagnostic.record.signature,
    'different diagnostics remain distinguishable');

  const lesson = localErrors.addProvisionalLesson({
    workspaceRoot: s.repo,
    destination: 'project',
    signature: 'v1-git-auth-review-control',
    match: actionMatch(),
    lesson: 'Preserve the safe lesson. Authorization: Basic BASIC_LESSON_FIXTURE_54',
    cue: 'Before committing. Proxy-Authorization: Bearer BEARER_CUE_FIXTURE_45',
  }, { env: s.env });
  assert.equal(lesson.status, 'appended');
  credentials.push('BASIC_SIGNATURE_FIXTURE_11', 'BASIC_SIGNATURE_FIXTURE_22', 'BASIC_SIGNATURE_FIXTURE_33',
    'BASIC_LESSON_FIXTURE_54', 'BEARER_CUE_FIXTURE_45');

  const rawIndex = fs.readFileSync(path.join(s.store, 'errors-index.json'), 'utf8');
  for (const credential of credentials) {
    assert.ok(!rawIndex.includes(credential), `raw errors-index.json must omit ${credential}`);
  }

  const listed = runCli(['list', '--json'], s);
  assert.equal(listed.status, 0, listed.stderr);
  const exported = runCli(['export'], s);
  assert.equal(exported.status, 0, exported.stderr);
  for (const output of [listed.stdout, exported.stdout]) {
    for (const credential of credentials) assert.ok(!output.includes(credential), 'CLI output must omit fixture credentials');
    assert.ok(output.includes('Fatal synthetic diagnostic AUTH_CONTROL'), 'CLI retains a safe diagnostic');
    assert.ok(output.includes('Preserve the safe lesson.'), 'CLI retains the safe lesson');
  }

  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repo });
  const matched = matchLedgerLessons({
    workspaceRoot: s.repo,
    workspaceIdentity: lesson.record.workspaceKey,
    sessionIdentity: 'synthetic-session',
    stateDir: s.matcherState,
    event: { phase: 'action', tool: 'shell', command: 'git commit -m "safe"', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });
  assert.ok(matched && matched.text.includes('Preserve the safe lesson.'), 'positive control lesson remains deliverable');
  for (const credential of credentials) assert.ok(!matched.text.includes(credential), 'matched context must omit fixture credentials');
});

test('read-side retention filters before limits, stays read-only, and withholds expired matcher lessons', () => {
  const s = makeSandbox();
  const now = Date.now();
  const retentionMs = localErrors.LIMITS.retentionMs;
  const cutoff = now - retentionMs;
  const workspaceA = localErrors.resolveWorkspaceKey({ workspaceRoot: s.repo }, { env: s.env });
  const otherRepo = path.join(s.dir, 'other-repo');
  fs.mkdirSync(otherRepo);
  execFileSync('git', ['init', '-q', otherRepo]);
  const workspaceB = localErrors.resolveWorkspaceKey({ workspaceRoot: otherRepo }, { env: s.env });

  const occurrence = (id, workspaceKey, createdAt, outputExcerpt) => ({
    schemaVersion: 1,
    kind: 'occurrence',
    provisionalId: id,
    workspaceKey,
    destination: 'unknown',
    createdAt: new Date(createdAt).toISOString(),
    signature: `v1-git-${id}`,
    source: 'tool-failure',
    host: 'claude',
    sessionKey: null,
    toolUseId: null,
    commandClass: 'git',
    exitCode: 1,
    outputExcerpt,
    matchedLedgerIds: [],
  });
  const lesson = (id, workspaceKey, createdAt, text) => ({
    schemaVersion: 1,
    kind: 'provisional-lesson',
    provisionalId: id,
    workspaceKey,
    destination: 'project',
    createdAt: new Date(createdAt).toISOString(),
    signature: `v1-git-${id}`,
    match: actionMatch(),
    lesson: text,
    issueUrl: null,
    promotionId: null,
  });

  const file = path.join(s.store, 'errors-index.json');
  const initialIndex = {
    schemaVersion: 1,
    kind: 'local-error-store',
    records: [
      occurrence('future-occurrence', workspaceA, now + 60_000, 'Fresh future occurrence diagnostic.'),
      occurrence('fresh-occurrence', workspaceA, cutoff + 2, 'Fresh cutoff occurrence diagnostic.'),
      occurrence('expired-occurrence', workspaceA, cutoff - 1, 'Expired occurrence diagnostic.'),
      occurrence('boundary-occurrence', workspaceA, cutoff, 'Boundary occurrence diagnostic.'),
      occurrence('other-workspace-occurrence', workspaceB, now + 60_000, 'Other workspace diagnostic.'),
      lesson('expired-lesson', workspaceA, cutoff - 1, 'Expired matching lesson.'),
      lesson('boundary-lesson', workspaceA, cutoff, 'Boundary matching lesson.'),
      lesson('fresh-cutoff-lesson', workspaceA, cutoff + 2, 'Fresh cutoff matching lesson.'),
      lesson('future-lesson', workspaceA, now + 60_000, 'Fresh matching lesson positive control.'),
    ],
  };
  fs.writeFileSync(file, `${JSON.stringify(initialIndex, null, 2)}\n`, 'utf8');

  const indexBefore = fs.readFileSync(file);
  const storeEntriesBefore = fs.readdirSync(s.store).sort();
  const limited = localErrors.listRecords({
    env: s.env,
    workspaceRoot: s.repo,
    kind: 'occurrence',
    limit: 1,
    now,
    limits: { retentionMs },
  });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].provisionalId, 'fresh-occurrence', 'retention filtering happens before the limit');

  const records = localErrors.listRecords({ env: s.env, workspaceRoot: s.repo, now, limits: { retentionMs } });
  assert.deepEqual(records.map(record => record.provisionalId), [
    'future-occurrence', 'fresh-occurrence', 'fresh-cutoff-lesson', 'future-lesson',
  ]);
  assert.ok(!records.some(record => /expired|boundary|other-workspace/.test(record.provisionalId)));
  assert.deepEqual(fs.readdirSync(s.store).sort(), storeEntriesBefore, 'read must not create a lock or claim in the store');
  assert.equal(fs.existsSync(path.join(s.store, '.index.lock')), false, 'read must not acquire the write lock');
  assert.equal(Buffer.compare(indexBefore, fs.readFileSync(file)), 0, 'read must leave index bytes unchanged');

  const listed = runCli(['list', '--json'], s);
  assert.equal(listed.status, 0, listed.stderr);
  const exported = runCli(['export'], s);
  assert.equal(exported.status, 0, exported.stderr);
  for (const output of [listed.stdout, exported.stdout]) {
    assert.ok(output.includes('future-occurrence'), 'fresh workspace-matching occurrence is listed/exported');
    assert.ok(output.includes('future-lesson'), 'fresh workspace-matching lesson is listed/exported');
    assert.ok(!output.includes('expired-occurrence'));
    assert.ok(!output.includes('boundary-occurrence'));
    assert.ok(!output.includes('expired-lesson'));
    assert.ok(!output.includes('boundary-lesson'));
    assert.ok(!output.includes('other-workspace-occurrence'));
  }

  const source = createProvisionalSource({ env: s.env, workspaceRoot: s.repo });
  const candidates = source(workspaceA);
  assert.deepEqual(candidates.map(candidate => candidate.identity), ['future-lesson'],
    'expired and cutoff-boundary lessons are not offered by the provisional source');
  const matched = matchLedgerLessons({
    workspaceRoot: s.repo,
    workspaceIdentity: workspaceA,
    sessionIdentity: 'retention-session',
    stateDir: s.matcherState,
    event: { phase: 'action', tool: 'shell', command: 'git commit -m "safe"', outcome: { failed: 'unknown' } },
    provisionalSource: source,
  });
  assert.ok(matched && matched.text.includes('Fresh matching lesson positive control.'));
  assert.ok(!matched.text.includes('Expired matching lesson.'));
  assert.ok(!matched.text.includes('Boundary matching lesson.'));
});

for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failure(s)` : '\nAll review-fix checks passed.');
process.exit(failures ? 1 : 0);

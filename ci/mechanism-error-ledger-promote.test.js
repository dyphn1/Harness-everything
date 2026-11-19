#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { render } = require('../scripts/errors-sync');
const { isWithin } = require('../error-ledger-bootstrap/scripts/promote');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'promote.js');
const SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const SCANNER = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'scan.js');
const ERRORS = path.join('.agents', 'harness-everything', 'errors');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'error ledger promote ')));
const HOME = path.join(TMP, 'synthetic-home');
const MEMORY = path.join(HOME, 'private.md');
const MEMORY_BODY = 'PRIVATE MEMORY BODY SENTINEL';

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function git(repo, args, env = {}) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HUSKY: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function createTarget(name = 'target') {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, `${name} `)));
  const errorsDir = path.join(root, ERRORS);
  fs.mkdirSync(errorsDir, { recursive: true });
  write(path.join(errorsDir, 'E-0001-fixture.md'), [
    '---', 'id: E-0001', 'signature: fixture', 'class: test',
    'scope: in', 'status: lesson', '---',
    '## Cue', '', 'A synthetic target record.', '',
    '## Lesson', '', 'Keep the synthetic ledger isolated.', ''
  ].join('\n'));
  fs.writeFileSync(path.join(errorsDir, 'index.jsonl'), render(root));
  write(path.join(root, 'src', 'parser.js'), 'module.exports = value => value;\n');
  write(path.join(root, 'ci', 'parser.test.js'), "require('../src/parser');\n");
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Promotion Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const fixedDate = Date.parse('2024-01-02T03:04:05.000Z');
  function commit(subject, seconds, text) {
    write(path.join(root, 'src', 'parser.js'), text);
    git(root, ['add', '-A']);
    const date = new Date(fixedDate + seconds * 1000).toISOString();
    git(root, ['commit', '-q', '-m', subject], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date
    });
  }
  git(root, ['add', '-A']);
  const seedDate = new Date(fixedDate).toISOString();
  git(root, ['commit', '-q', '-m', 'feat: seed parser fixture'], {
    GIT_AUTHOR_DATE: seedDate,
    GIT_COMMITTER_DATE: seedDate
  });
  commit('fix: preserve parser boundary', 1, 'module.exports = value => value == null ? "" : value;\n');
  commit('fix: handle parser edge case', 2, 'module.exports = value => String(value ?? "");\n');
  return { root, errorsDir };
}

function makeReport(targetRoot) {
  fs.mkdirSync(HOME, { recursive: true });
  write(MEMORY, [
    '---', 'type: feedback', 'title: PRIVATE MEMORY SENTINEL', '---',
    '## Cue', '', 'A local note about src/parser.js.', '',
    '## Lesson', '', `${MEMORY_BODY}`, ''
  ].join('\n'));
  const out = path.join(TMP, `reports-${path.basename(targetRoot)}`);
  const env = { ...process.env, HOME, USERPROFILE: HOME, GIT_CONFIG_NOSYSTEM: '1' };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  const scan = childProcess.spawnSync(process.execPath, [
    SCANNER, '--root', targetRoot, '--out', out, '--memory', MEMORY,
    '--home', HOME, '--hide-ledger', '--json'
  ], { cwd: ROOT, encoding: 'utf8', env });
  assert.ifError(scan.error);
  assert.equal(scan.status, 0, `scanner exit ${scan.status}; stderr: ${scan.stderr}`);
  const payload = JSON.parse(scan.stdout);
  const report = fs.readFileSync(payload.reportJson, 'utf8');
  const reportJson = JSON.parse(report);
  const selected = reportJson.candidates.find(candidate => candidate.sources.some(source => source.type === 'git'));
  const memoryCandidate = reportJson.candidates.find(candidate => candidate.sources.some(source => source.type === 'memory'));
  assert.ok(selected, 'the real scanner report includes the repeated-fix Git candidate');
  assert.ok(memoryCandidate, 'the real scanner report includes the local memory candidate');
  return { reportFile: payload.reportJson, reportJson, selected, memoryCandidate };
}

function approvalFor(targetRoot, reportFile, candidateId, changes = {}) {
  const reportBytes = fs.readFileSync(reportFile);
  return {
    schemaVersion: 1,
    candidateId,
    reportSha256: crypto.createHash('sha256').update(reportBytes).digest('hex'),
    targetRoot,
    approvedBy: 'fixture-owner',
    approvedAt: '2026-11-19T12:00:00.000Z',
    record: {
      signature: 'parser-edge-case',
      class: 'test-coupling',
      title: 'Parser edge case regressed',
      violates: 'The parser preserves the approved token boundary.',
      scope: 'in',
      status: 'lesson',
      sites: ['src/parser.js'],
      sourcesNote: 'Review confirms the parser token boundary regression.'
    },
    ...changes
  };
}

function writeApproval(value, file = path.join(TMP, 'approval.json')) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function invoke(target, report, approval, harness = ROOT) {
  const env = { ...process.env };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  return childProcess.spawnSync(process.execPath, [
    SCRIPT, '--target', target, '--report', report,
    '--approval', approval, '--harness', harness, '--json'
  ], { cwd: ROOT, encoding: 'utf8', env });
}

function resultFor(run, status) {
  assert.ifError(run.error);
  assert.equal(run.status, status, `promote exit ${run.status}; expected ${status}; stderr: ${run.stderr}`);
  assert.equal(run.stderr.trim(), '', 'JSON mode returns its result on stdout');
  return JSON.parse(run.stdout);
}

function snapshot(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => [
    name,
    fs.readFileSync(path.join(directory, name)).toString('base64')
  ]));
}

function seedFixture() {
  const target = createTarget();
  const report = makeReport(target.root);
  const approval = writeApproval(approvalFor(fs.realpathSync.native(target.root), report.reportFile, report.selected.id));
  return { ...target, ...report, report: report.reportFile, approval };
}

function runSync(targetRoot, check = true) {
  return childProcess.spawnSync(process.execPath, [SYNC, ...(check ? ['--check'] : []), '--root', targetRoot], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
  });
}

function makeHarness(name, syncSource) {
  const harness = path.join(TMP, name);
  fs.mkdirSync(path.join(harness, 'scripts'), { recursive: true });
  if (syncSource !== null) write(path.join(harness, 'scripts', 'errors-sync.js'), syncSource);
  return harness;
}

function addFakeYaml(harness) {
  const moduleDir = path.join(harness, 'node_modules', 'js-yaml');
  write(path.join(moduleDir, 'package.json'), JSON.stringify({ name: 'js-yaml', main: 'index.js' }));
  write(path.join(moduleDir, 'index.js'), 'module.exports = {};\n');
}

try {
  // The whole happy path uses the real CLI and target-root sync implementation.
  const success = seedFixture();
  const unselectedApproval = writeApproval(
    approvalFor(fs.realpathSync.native(success.root), success.report, success.memoryCandidate.id),
    path.join(TMP, 'unselected-approval.json')
  );
  assert.equal(JSON.parse(fs.readFileSync(unselectedApproval, 'utf8')).candidateId, success.memoryCandidate.id,
    'the fixture includes a separately approved candidate that is not selected for this promotion');
  const originalReport = fs.readFileSync(success.report);
  const promoted = resultFor(invoke(success.root, success.report, success.approval), 0);
  assert.deepEqual(Object.keys(promoted).sort(), ['file', 'id', 'indexUpdated', 'ok']);
  assert.deepEqual(promoted, {
    ok: true,
    id: 'E-0002',
    file: `${ERRORS}/E-0002-parser-edge-case.md`,
    indexUpdated: true
  });
  const promotedFile = path.join(success.errorsDir, 'E-0002-parser-edge-case.md');
  const record = fs.readFileSync(promotedFile, 'utf8');
  assert.match(record, /\bid: "E-0002"/);
  assert.match(record, /\bsignature: "parser-edge-case"/);
  for (const source of success.selected.sources.filter(item => item.type === 'git')) {
    assert.ok(record.includes(source.sha), `durable commit ${source.sha} is cited in the record`);
  }
  assert.match(record, /repo\/src\/parser\.js/);
  assert.doesNotMatch(record, new RegExp(`PRIVATE MEMORY SENTINEL|${MEMORY_BODY}|home\\/private\\.md|\\/Users\\/|\\/private\\/tmp`),
    'promotion writes approved content and durable sources, never local memory or absolute paths');
  assert.deepEqual(fs.readFileSync(success.report), originalReport, 'promotion never edits the report');
  assert.equal(JSON.parse(fs.readFileSync(success.report, 'utf8')).candidates.length, success.reportJson.candidates.length,
    'approved-but-unselected candidates remain in the report');
  assert.equal(fs.readFileSync(path.join(success.errorsDir, 'index.jsonl'), 'utf8'), render(success.root),
    'the promoted index has byte parity with the canonical renderer');
  assert.equal(runSync(success.root).status, 0, 'errors-sync --root --check accepts the promoted index');

  const successSnapshot = snapshot(success.errorsDir);
  assert.equal(resultFor(invoke(success.root, success.report, success.approval), 2).ok, false,
    'the same approval cannot be promoted twice');
  assert.deepEqual(snapshot(success.errorsDir), successSnapshot, 'a repeat leaves the existing record and index unchanged');

  const locked = seedFixture();
  const lockFile = path.join(locked.errorsDir, '.promote.lock');
  write(lockFile, 'active promotion\n');
  const lockedBefore = snapshot(locked.errorsDir);
  assert.equal(resultFor(invoke(locked.root, locked.report, locked.approval), 2).ok, false,
    'a concurrent or stale promotion lock is refused');
  assert.deepEqual(snapshot(locked.errorsDir), lockedBefore, 'a refused run never removes another promotion lock');

  const missingCandidate = seedFixture();
  const absentApproval = approvalFor(fs.realpathSync.native(missingCandidate.root), missingCandidate.report,
    '11111111111111111111');
  const absentFile = writeApproval(absentApproval);
  const absentBefore = snapshot(missingCandidate.errorsDir);
  assert.equal(resultFor(invoke(missingCandidate.root, missingCandidate.report, absentFile), 2).ok, false,
    'an approval for a missing report candidate is refused');
  assert.deepEqual(snapshot(missingCandidate.errorsDir), absentBefore, 'unknown candidate refusal writes nothing');

  const changedReport = seedFixture();
  fs.appendFileSync(changedReport.report, ' ');
  const changedBefore = snapshot(changedReport.errorsDir);
  assert.equal(resultFor(invoke(changedReport.root, changedReport.report, changedReport.approval), 2).ok, false,
    'a report changed after approval is refused');
  assert.deepEqual(snapshot(changedReport.errorsDir), changedBefore, 'report digest refusal writes nothing');

  const wrongTarget = seedFixture();
  const wrongTargetApproval = writeApproval(approvalFor(path.join(TMP, 'different-target'), wrongTarget.report, wrongTarget.selected.id));
  const wrongTargetBefore = snapshot(wrongTarget.errorsDir);
  assert.equal(resultFor(invoke(wrongTarget.root, wrongTarget.report, wrongTargetApproval), 2).ok, false,
    'approval for a different target root is refused');
  assert.deepEqual(snapshot(wrongTarget.errorsDir), wrongTargetBefore, 'target mismatch writes nothing');

  const symlinkTarget = seedFixture();
  const externalErrors = path.join(TMP, 'external-errors');
  fs.renameSync(symlinkTarget.errorsDir, externalErrors);
  fs.mkdirSync(path.dirname(symlinkTarget.errorsDir), { recursive: true });
  fs.symlinkSync(externalErrors, symlinkTarget.errorsDir, process.platform === 'win32' ? 'junction' : 'dir');
  const externalBefore = snapshot(externalErrors);
  assert.equal(resultFor(invoke(symlinkTarget.root, symlinkTarget.report, symlinkTarget.approval), 2).ok, false,
    'an errors directory that resolves outside the target is refused');
  assert.deepEqual(snapshot(externalErrors), externalBefore, 'symlink escape refusal leaves its target unchanged');

  const missingErrors = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'missing errors ')));
  git(missingErrors, ['init', '-q']);
  const missingApproval = writeApproval(approvalFor(missingErrors, success.report, success.selected.id));
  assert.equal(resultFor(invoke(missingErrors, success.report, missingApproval), 2).ok, false,
    'a target without its existing errors directory is refused');
  assert.equal(fs.existsSync(path.join(missingErrors, '.agents')), false, 'promotion never creates the missing ledger directory');

  const noSync = seedFixture();
  const unavailableHarness = makeHarness('missing-sync-harness', null);
  const noSyncBefore = snapshot(noSync.errorsDir);
  const noSyncResult = resultFor(invoke(noSync.root, noSync.report, noSync.approval, unavailableHarness), 2);
  assert.equal(noSyncResult.ok, false,
    'a Harness checkout without errors-sync.js is refused before writing');
  assert.match(noSyncResult.error, /pass --harness to a trusted Harness checkout/,
    'missing sync tool explains how to recover locally');
  assert.deepEqual(snapshot(noSync.errorsDir), noSyncBefore, 'unavailable sync tool leaves the ledger untouched');

  const noDependency = seedFixture();
  const missingDependencyHarness = makeHarness('missing-dependency-harness', 'process.exit(0);\n');
  const noDependencyBefore = snapshot(noDependency.errorsDir);
  const noDependencyResult = resultFor(invoke(noDependency.root, noDependency.report, noDependency.approval, missingDependencyHarness), 2);
  assert.equal(noDependencyResult.ok, false,
    'a Harness checkout without resolvable js-yaml is refused before writing');
  assert.match(noDependencyResult.error, /install its Node dependencies/,
    'missing dependency explains how to recover locally');
  assert.deepEqual(snapshot(noDependency.errorsDir), noDependencyBefore, 'dependency preflight writes nothing');

  const syncFailure = seedFixture();
  const failingHarness = makeHarness('failing-sync-harness', [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const root = process.argv[process.argv.indexOf('--root') + 1];",
    "fs.writeFileSync(path.join(root, '.agents/harness-everything/errors/index.jsonl'), 'partial\\n');",
    'process.exit(1);', ''
  ].join('\n'));
  addFakeYaml(failingHarness);
  const beforeFailure = snapshot(syncFailure.errorsDir);
  assert.equal(resultFor(invoke(syncFailure.root, syncFailure.report, syncFailure.approval, failingHarness), 1).ok, false,
    'a failed sync is reported as a failure');
  assert.deepEqual(snapshot(syncFailure.errorsDir), beforeFailure,
    'sync failure removes only the new record and restores the prior index bytes');
  assert.equal(runSync(syncFailure.root).status, 0, 'the target index remains current after rollback');

  const win32 = path.win32;
  const outside = win32.relative('C:\\repo', 'D:\\temp\\file.md');
  assert.ok(win32.isAbsolute(outside), 'cross-drive relative paths are absolute on Windows');
  assert.equal(isWithin('C:\\repo', 'D:\\temp\\file.md', win32), false,
    'cross-drive paths must not be mistaken for a leading-dotdot escape');
  assert.equal(isWithin('C:\\repo', 'C:\\repo\\..cache\\lesson.md', win32), true,
    'a child beginning with two dots is not a parent path segment');
  assert.equal(isWithin('C:\\repo', 'C:\\repo2\\lesson.md', win32), false,
    'a sibling with a shared string prefix remains outside');

  console.log('PASS error-ledger promotion is approval-bound, non-overwriting, and recoverable');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

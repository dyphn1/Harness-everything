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
  write(path.join(root, 'src', 'renderer.js'), 'module.exports = value => value;\n');
  write(path.join(root, 'ci', 'parser.test.js'), "require('../src/parser');\n");
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Promotion Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const fixedDate = Date.parse('2024-01-02T03:04:05.000Z');
  function commit(subject, seconds, text, site = 'src/parser.js') {
    write(path.join(root, site), text);
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
  commit('fix: preserve renderer boundary', 3, 'module.exports = value => value == null ? "" : value;\n', 'src/renderer.js');
  commit('fix: handle renderer edge case', 4, 'module.exports = value => String(value ?? "");\n', 'src/renderer.js');
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
  const selected = reportJson.candidates.find(candidate => candidate.sites.includes('src/parser.js') &&
    candidate.sources.some(source => source.type === 'git'));
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

function invoke(target, report, approval, harness = ROOT, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
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

function updateCandidate(fixture, candidateId, update) {
  const report = JSON.parse(fs.readFileSync(fixture.report, 'utf8'));
  const candidate = report.candidates.find(item => item.id === candidateId);
  assert.ok(candidate, `candidate ${candidateId} exists in the fixture report`);
  update(candidate, report);
  write(fixture.report, `${JSON.stringify(report, null, 2)}\n`);
  fixture.reportJson = report;
  return candidate;
}

function approveCandidate(fixture, candidateId, filename) {
  return writeApproval(approvalFor(fs.realpathSync.native(fixture.root), fixture.report, candidateId),
    path.join(TMP, filename));
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

function makeSyncHarness(name, afterWrite, duringRollback = '') {
  const source = [
    "const childProcess = require('node:child_process');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const canonicalSync = ${JSON.stringify(SYNC)};`,
    'module.exports = require(canonicalSync);',
    ...(duringRollback ? [
      'const renderIndex = module.exports.render;',
      'module.exports.render = function (root) {',
      duringRollback,
      '  return renderIndex(root);',
      '};'
    ] : []),
    'if (require.main === module) {',
    '  const args = process.argv.slice(2);',
    "  if (args.includes('--check')) { process.stderr.write('injected final check failure\\n'); process.exit(1); }",
    "  const result = childProcess.spawnSync(process.execPath, [canonicalSync, ...args], { encoding: 'utf8' });",
    '  if (result.stdout) process.stdout.write(result.stdout);',
    '  if (result.stderr) process.stderr.write(result.stderr);',
    '  if (result.status !== 0) process.exit(result.status || 1);',
    afterWrite,
    '}', ''
  ].join('\n');
  const harness = makeHarness(name, source);
  addFakeYaml(harness);
  return harness;
}

try {
  // The whole happy path uses the real CLI and target-root sync implementation.
  const success = seedFixture();
  success.selected = updateCandidate(success, success.selected.id, candidate => {
    candidate.title = 'PRIVATE MEMORY TITLE SENTINEL';
    candidate.sources.push({ type: 'memory', ref: 'PRIVATE MEMORY REF SENTINEL', title: 'PRIVATE MEMORY TITLE SENTINEL' });
  });
  success.approval = approveCandidate(success, success.selected.id, 'success-approval.json');
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
    file: path.posix.join(...ERRORS.split(path.sep), 'E-0002-parser-edge-case.md'),
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
  const approvedRecord = JSON.parse(fs.readFileSync(success.approval, 'utf8')).record;
  assert.ok(record.includes(approvedRecord.title), 'record title comes from the owner-approved payload');
  assert.ok(record.includes(approvedRecord.sourcesNote), 'record lesson comes from the owner-approved payload');
  assert.doesNotMatch(record, /PRIVATE MEMORY SENTINEL|PRIVATE MEMORY REF SENTINEL|PRIVATE MEMORY TITLE SENTINEL/,
    'memory source refs and titles are never promoted');
  assert.doesNotMatch(record, new RegExp(`${MEMORY_BODY}|home\\/private\\.md|\\/Users\\/|\\/private\\/tmp`),
    'promotion writes approved content and durable sources, never local memory or absolute paths');
  assert.deepEqual(fs.readFileSync(success.report), originalReport, 'promotion never edits the report');
  assert.equal(JSON.parse(fs.readFileSync(success.report, 'utf8')).candidates.length, success.reportJson.candidates.length,
    'approved-but-unselected candidates remain in the report');
  assert.equal(fs.readFileSync(path.join(success.errorsDir, 'index.jsonl'), 'utf8'), render(success.root),
    'the promoted index has byte parity with the canonical renderer');
  assert.doesNotMatch(fs.readFileSync(path.join(success.errorsDir, 'index.jsonl'), 'utf8'),
    /PRIVATE MEMORY SENTINEL|PRIVATE MEMORY REF SENTINEL|PRIVATE MEMORY TITLE SENTINEL/,
    'the promoted index contains no memory source refs or titles');
  assert.equal(runSync(success.root).status, 0, 'errors-sync --root --check accepts the promoted index');

  const memoryOnly = seedFixture();
  updateCandidate(memoryOnly, memoryOnly.memoryCandidate.id, candidate => {
    candidate.sites = ['src/parser.js'];
    candidate.sources = [{ type: 'memory', ref: 'PRIVATE MEMORY REF SENTINEL', title: 'PRIVATE MEMORY TITLE SENTINEL' }];
  });
  const memoryApproval = approveCandidate(memoryOnly, memoryOnly.memoryCandidate.id, 'memory-only-approval.json');
  const memoryBefore = snapshot(memoryOnly.errorsDir);
  const memoryResult = resultFor(invoke(memoryOnly.root, memoryOnly.report, memoryApproval), 2);
  assert.equal(memoryResult.ok, false, 'memory-only candidate evidence is refused despite a valid-looking site');
  assert.match(memoryResult.error, /durable source evidence/, 'private-only refusal explains the missing durable evidence');
  assert.deepEqual(snapshot(memoryOnly.errorsDir), memoryBefore, 'private-only refusal writes no E-record or index changes');

  const instructionOnly = seedFixture();
  updateCandidate(instructionOnly, instructionOnly.selected.id, candidate => {
    candidate.sites = ['src/parser.js'];
    candidate.sources = [{ type: 'instruction', ref: 'repo/AGENTS.md', title: 'PRIVATE INSTRUCTION TITLE SENTINEL' }];
  });
  const instructionApproval = approveCandidate(instructionOnly, instructionOnly.selected.id, 'instruction-only-approval.json');
  const instructionBefore = snapshot(instructionOnly.errorsDir);
  const instructionResult = resultFor(invoke(instructionOnly.root, instructionOnly.report, instructionApproval), 2);
  assert.equal(instructionResult.ok, false, 'instruction-only candidate evidence is refused');
  assert.deepEqual(snapshot(instructionOnly.errorsDir), instructionBefore, 'instruction-only refusal writes no E-record');

  const missingSite = seedFixture();
  updateCandidate(missingSite, missingSite.selected.id, candidate => { candidate.sites = ['src/not-present.js']; });
  const missingSiteApproval = approveCandidate(missingSite, missingSite.selected.id, 'missing-site-approval.json');
  const missingSiteBefore = snapshot(missingSite.errorsDir);
  const missingSiteResult = resultFor(invoke(missingSite.root, missingSite.report, missingSiteApproval), 2);
  assert.equal(missingSiteResult.ok, false, 'candidate sites must resolve to existing files in the target repo');
  assert.match(missingSiteResult.error, /existing target-repository file/, 'site refusal identifies the invalid target path');
  assert.deepEqual(snapshot(missingSite.errorsDir), missingSiteBefore, 'unverified site refusal writes no E-record');

  const unverifiedApprovalSite = seedFixture();
  const unverifiedApproval = JSON.parse(fs.readFileSync(unverifiedApprovalSite.approval, 'utf8'));
  unverifiedApproval.record.sites = ['src/not-present.js'];
  const unverifiedApprovalFile = writeApproval(unverifiedApproval, path.join(TMP, 'unverified-approval-site.json'));
  const unverifiedApprovalBefore = snapshot(unverifiedApprovalSite.errorsDir);
  const unverifiedApprovalResult = resultFor(invoke(unverifiedApprovalSite.root, unverifiedApprovalSite.report,
    unverifiedApprovalFile), 2);
  assert.equal(unverifiedApprovalResult.ok, false, 'approved record sites must also exist inside the target repo');
  assert.deepEqual(snapshot(unverifiedApprovalSite.errorsDir), unverifiedApprovalBefore,
    'a nonexistent approved site writes no E-record');

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

  const internalSymlinkErrors = seedFixture();
  const internalErrors = path.join(internalSymlinkErrors.root, '.private-ledger-storage');
  fs.renameSync(internalSymlinkErrors.errorsDir, internalErrors);
  fs.symlinkSync(internalErrors, internalSymlinkErrors.errorsDir, process.platform === 'win32' ? 'junction' : 'dir');
  const internalBefore = snapshot(internalErrors);
  const internalRefused = resultFor(invoke(internalSymlinkErrors.root, internalSymlinkErrors.report,
    internalSymlinkErrors.approval), 1);
  assert.equal(internalRefused.ok, false, 'the canonical sync refuses a symlinked errors directory even when it stays inside the target');
  assert.deepEqual(snapshot(internalErrors), internalBefore, 'rejected symlink target leaves no new E-record or changed index');

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
  const failingHarness = makeSyncHarness('failing-sync-harness', '');
  const beforeFailure = snapshot(syncFailure.errorsDir);
  const syncFailureResult = resultFor(invoke(syncFailure.root, syncFailure.report, syncFailure.approval, failingHarness), 1);
  assert.equal(syncFailureResult.ok, false, 'a failed final check after atomic index replacement is reported as a failure');
  assert.deepEqual(snapshot(syncFailure.errorsDir), beforeFailure,
    `rollback recognizes its own replacement, removes the new record, and restores prior index bytes: ${syncFailureResult.error}`);
  assert.equal(runSync(syncFailure.root).status, 0, 'the target index remains current after rollback');

  const rollbackContention = seedFixture();
  const secondCandidate = rollbackContention.reportJson.candidates.find(candidate =>
    candidate.id !== rollbackContention.selected.id && candidate.sources.some(source => source.type === 'git'));
  assert.ok(secondCandidate, 'the real scanner fixture supplies two distinct durable candidates');
  const approvalB = writeApproval(approvalFor(fs.realpathSync.native(rollbackContention.root),
    rollbackContention.report, secondCandidate.id, {
      record: {
        signature: 'renderer-rollback-contention',
        class: 'test-coupling',
        title: 'Renderer rollback contention',
        violates: 'The renderer promotion waits for rollback recovery.',
        scope: 'in',
        status: 'lesson',
        sites: ['src/renderer.js'],
        sourcesNote: 'The renderer record is independently approved for the rollback contention control.'
      }
    }), path.join(TMP, 'rollback-b-approval.json'));
  const contentionProbeFile = path.join(TMP, 'rollback-contention-probe.json');
  const contentionResultFile = path.join(TMP, 'rollback-contention-result.json');
  write(contentionProbeFile, JSON.stringify({
    args: [SCRIPT, '--target', rollbackContention.root, '--report', rollbackContention.report,
      '--approval', approvalB, '--harness', ROOT, '--json'],
    cwd: ROOT,
    resultFile: contentionResultFile
  }));
  const duringRollback = [
    "  const probe = JSON.parse(fs.readFileSync(process.env.PROMOTION_ROLLBACK_PROBE, 'utf8'));",
    "  const errorsDir = path.join(root, '.agents', 'harness-everything', 'errors');",
    '  const state = () => ({',
    "    records: Object.fromEntries(fs.readdirSync(errorsDir).filter(name => name.startsWith('E-') && name.endsWith('.md')).sort().map(name => [name, fs.readFileSync(path.join(errorsDir, name)).toString('base64')])),",
    "    index: fs.readFileSync(path.join(errorsDir, 'index.jsonl')).toString('base64'),",
    "    lock: fs.existsSync(path.join(errorsDir, '.promote.lock'))",
    '  });',
    '  const before = state();',
    "  const expectedIndex = Buffer.from(renderIndex(root)).toString('base64');",
    "  const attempt = childProcess.spawnSync(process.execPath, probe.args, { cwd: probe.cwd, encoding: 'utf8' });",
    '  const after = state();',
    "  fs.writeFileSync(probe.resultFile, JSON.stringify({ before, after, expectedIndex, attempt: { status: attempt.status, stdout: attempt.stdout, stderr: attempt.stderr, error: attempt.error && attempt.error.message } }));"
  ].join('\n');
  const contentionHarness = makeSyncHarness('rollback-contention-harness', '', duringRollback);
  const beforeContention = snapshot(rollbackContention.errorsDir);
  const rollbackAResult = resultFor(invoke(rollbackContention.root, rollbackContention.report,
    rollbackContention.approval, contentionHarness, { PROMOTION_ROLLBACK_PROBE: contentionProbeFile }), 1);
  assert.equal(rollbackAResult.ok, false, 'A reports its injected final check failure');
  assert.match(rollbackAResult.error, /injected final check failure/);
  const contention = JSON.parse(fs.readFileSync(contentionResultFile, 'utf8'));
  assert.ok(Object.hasOwn(contention.before.records, 'E-0002-parser-edge-case.md'),
    'A published its record before rollback began');
  assert.equal(contention.before.index, contention.expectedIndex,
    'A published the replacement index before rollback began');
  assert.equal(contention.attempt.status, 2, 'B is refused while A is rolling back');
  const refusedB = JSON.parse(contention.attempt.stdout);
  assert.equal(refusedB.ok, false);
  assert.match(refusedB.error, /another promotion is active or a stale \.promote\.lock remains/,
    'B receives the active-lock refusal');
  assert.equal(contention.before.lock, true, 'A still owns the lock before the contention attempt');
  assert.deepEqual(contention.after, contention.before,
    'B leaves the record bytes, index bytes, and active lock unchanged');
  assert.deepEqual(snapshot(rollbackContention.errorsDir), beforeContention,
    'A removes its record and restores the original index after B is refused');
  assert.equal(fs.existsSync(path.join(rollbackContention.errorsDir, '.promote.lock')), false,
    'A releases its lock after rollback completes');
  assert.equal(fs.readdirSync(rollbackContention.errorsDir).some(name =>
    name.startsWith('.index.jsonl.') && name.endsWith('.tmp')), false,
  'rollback leaves no temporary index');
  assert.equal(runSync(rollbackContention.root).status, 0,
    'canonical errors-sync --check passes after A recovery');

  const retryB = resultFor(invoke(rollbackContention.root, rollbackContention.report, approvalB), 0);
  assert.equal(retryB.id, 'E-0002', 'B can promote after A recovery');
  assert.equal(fs.existsSync(path.join(rollbackContention.errorsDir, 'E-0002-renderer-rollback-contention.md')), true,
    'the retry publishes only B approved record');
  assert.equal(fs.existsSync(path.join(rollbackContention.errorsDir, 'E-0002-parser-edge-case.md')), false,
    'A record remains rolled back');
  assert.deepEqual(fs.readdirSync(rollbackContention.errorsDir)
    .filter(name => name.startsWith('E-') && name.endsWith('.md')).sort(),
  ['E-0001-fixture.md', 'E-0002-renderer-rollback-contention.md'],
  'the recovered ledger contains only B approved record');
  assert.equal(fs.readFileSync(path.join(rollbackContention.errorsDir, 'index.jsonl'), 'utf8'),
    render(rollbackContention.root), 'B retry leaves byte parity with the canonical renderer');
  assert.equal(runSync(rollbackContention.root).status, 0,
    'canonical errors-sync --check passes after B retry');

  const unrelatedReplacement = seedFixture();
  const unrelatedHarness = makeSyncHarness('unrelated-sync-harness', [
    "  const root = args[args.indexOf('--root') + 1];",
    "  const index = path.join(root, '.agents/harness-everything/errors/index.jsonl');",
    "  const replacement = `${index}.replacement`;",
    "  fs.writeFileSync(replacement, 'unrelated writer bytes\\n');",
    '  fs.renameSync(replacement, index);'
  ].join('\n'));
  const unrelatedRecord = path.join(unrelatedReplacement.errorsDir, 'E-0002-parser-edge-case.md');
  const unrelatedResult = resultFor(invoke(unrelatedReplacement.root, unrelatedReplacement.report,
    unrelatedReplacement.approval, unrelatedHarness), 1);
  assert.match(unrelatedResult.error, /recovery needed/, 'unowned index replacement reports actionable recovery');
  assert.equal(fs.readFileSync(path.join(unrelatedReplacement.errorsDir, 'index.jsonl'), 'utf8'),
    'unrelated writer bytes\n', 'rollback preserves an unrelated index replacement');
  assert.equal(fs.existsSync(unrelatedRecord), false, 'rollback removes only the owned new E-record');

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

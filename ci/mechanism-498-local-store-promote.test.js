#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const localErrors = require('../hooks/scripts/lib/local-errors');
const { render } = require('../scripts/errors-sync');

const ROOT = path.resolve(__dirname, '..');
const SCANNER = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'scan.js');
const PROMOTER = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'promote.js');
const SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const ERRORS = path.join('.agents', 'harness-everything', 'errors');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-498-promote-')));
const STORE = path.join(TMP, 'store');
const HOME = path.join(TMP, 'home');
const PRIVATE = {
  provisionalId: 'provisional-parser-one',
  lesson: 'PRIVATE_LESSON_SENTINEL',
  cue: 'PRIVATE_CUE_SENTINEL',
  issueUrl: 'https://private.example/PRIVATE_URL_SENTINEL'
};
const WRITER_ENV = isolatedEnv({ HARNESS_OBSERVATIONS_DIR: STORE, HOME, USERPROFILE: HOME });

function isolatedEnv(overrides = {}) {
  const env = { ...process.env, ...overrides, GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR', 'HARNESS_SYSTEM_ONE_MODE']) {
    delete env[name];
  }
  return env;
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function git(root, args, extraEnv = {}) {
  const result = childProcess.spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: isolatedEnv({
      GIT_AUTHOR_NAME: 'Promotion Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Promotion Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      ...extraEnv
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function treeDigest(directory, excludeLock = false) {
  const entries = fs.readdirSync(directory).sort()
    .filter(name => !(excludeLock && name === '.promote.lock'))
    .map(name => [name, hash(fs.readFileSync(path.join(directory, name)))]);
  return hash(JSON.stringify(entries));
}

function createTarget(name) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, `${name}-`)));
  const errorsDir = path.join(root, ERRORS);
  write(path.join(errorsDir, 'E-0001-fixture.md'), [
    '---', 'id: E-0001', 'signature: fixture', 'class: test-coupling',
    'title: Promotion fixture', 'scope: in', 'status: lesson', 'sites: []',
    'violates: Fixture contract', 'mechanism_ref: null', 'episodes: []', '---',
    '', '## Cue', '', 'A synthetic target ledger.', '', '## Lesson', '', 'Keep this fixture isolated.', ''
  ].join('\n'));
  write(path.join(errorsDir, 'index.jsonl'), render(root));
  write(path.join(root, 'README.md'), '# Promotion fixture\n');
  write(path.join(root, 'src', 'parser.js'), 'module.exports = value => value;\n');
  write(path.join(root, 'ci', 'parser.test.js'), "require('../src/parser');\n");
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Promotion Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const epoch = Date.parse('2026-11-25T00:00:00.000Z');
  function commit(subject, seconds, content) {
    write(path.join(root, 'src', 'parser.js'), content);
    git(root, ['add', '-A']);
    const date = new Date(epoch + seconds * 1000).toISOString();
    git(root, ['commit', '-q', '-m', subject], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  git(root, ['add', '-A']);
  const seedDate = new Date(epoch).toISOString();
  git(root, ['commit', '-q', '-m', 'chore: seed promotion fixture'], {
    GIT_AUTHOR_DATE: seedDate, GIT_COMMITTER_DATE: seedDate
  });
  commit('fix: preserve parser boundary', 1, 'module.exports = value => value == null ? "" : value;\n');
  commit('fix: handle parser edge case', 2, 'module.exports = value => String(value ?? "");\n');
  return { root, errorsDir };
}

function scan(target, destination = 'harness') {
  const out = path.join(TMP, `report-${crypto.randomBytes(5).toString('hex')}`);
  fs.mkdirSync(out);
  const result = childProcess.spawnSync(process.execPath, [
    SCANNER, '--root', target.root, '--no-memory', '--hide-ledger',
    '--source', 'local-store', '--destination', destination, '--out', out, '--json'
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: isolatedEnv({ HARNESS_OBSERVATIONS_DIR: STORE, HOME, USERPROFILE: HOME })
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `scanner exit ${result.status}; stderr: ${result.stderr}`);
  const envelope = JSON.parse(result.stdout);
  const reportFile = envelope.reportJson;
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const localSource = report.sources.find(source => source.type === 'local-store');
  const candidate = report.candidates.find(item => item.sources.some(source => source.type === 'local-store'));
  const gitCandidate = report.candidates.find(item => item.sources.some(source => source.type === 'git' || source.type === 'doc'));
  assert.equal(localSource.status, 'used', 'positive control: scanner reads a valid, workspace-bound store row');
  assert.ok(candidate, 'real scanner emits the local lead');
  assert.equal(candidate.signature, 'parser-edge-case');
  assert.ok(gitCandidate, 'real target history supplies a separate repeated-fix candidate');
  return { target, reportFile, report, localSource, candidate, gitCandidate };
}

function addLocalLead(target, destination) {
  const result = localErrors.addProvisionalLesson({
    workspaceRoot: target.root,
    destination,
    provisionalId: PRIVATE.provisionalId,
    signature: 'parser-edge-case',
    match: { actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }] },
    lesson: PRIVATE.lesson,
    cue: PRIVATE.cue,
    issueUrl: PRIVATE.issueUrl
  }, { env: WRITER_ENV });
  assert.ok(['appended', 'duplicate'].includes(result.status), `local-store fixture write failed: ${result.status}`);
  return result.record;
}

function saveReport(fixture) {
  fixture.reportBytes = Buffer.from(`${JSON.stringify(fixture.report, null, 2)}\n`);
  fs.writeFileSync(fixture.reportFile, fixture.reportBytes);
  return fixture.reportBytes;
}

function bindCorroboratingCommit(fixture) {
  const source = fixture.gitCandidate.sources.find(item => ['git', 'doc'].includes(item.type) && /^[a-f0-9]{40}$/i.test(item.sha));
  assert.ok(source, 'positive control: a scanner Git/doc source has a real commit SHA');
  git(fixture.target.root, ['cat-file', '-e', `${source.sha}^{commit}`]);
  fixture.candidate.sites = [...new Set([...fixture.candidate.sites, ...fixture.gitCandidate.sites])].sort();
  fixture.candidate.sources.push(source);
  fixture.candidate.sources.sort((left, right) => `${left.type}:${left.sha || left.ref}`.localeCompare(`${right.type}:${right.sha || right.ref}`));
  fixture.candidate.domain = fixture.candidate.sites[0].split('/')[0];
  fixture.candidate.id = hash(JSON.stringify([
    'error-candidate', fixture.candidate.sites,
    fixture.candidate.sources.map(item => `${item.type}:${item.sha || item.ref}`)
  ])).slice(0, 20);
  saveReport(fixture);
}

function prepared(name, corroborate = true, destination = 'harness') {
  const target = createTarget(name);
  addLocalLead(target, destination);
  const fixture = scan(target, destination);
  fixture.destination = destination;
  if (corroborate) bindCorroboratingCommit(fixture);
  else saveReport(fixture);
  fixture.localRef = fixture.candidate.sources.find(item => item.type === 'local-store').ref;
  return fixture;
}

function approvalFor(fixture, changes = {}) {
  return {
    schemaVersion: 1,
    candidateId: fixture.candidate.id,
    reportSha256: hash(fs.readFileSync(fixture.reportFile)),
    targetRoot: fixture.target.root,
    destination: fixture.destination,
    approvedBy: 'fixture-owner',
    approvedAt: '2026-11-25T12:00:00.000Z',
    record: {
      signature: fixture.candidate.signature,
      class: 'test-coupling',
      title: 'Parser boundary regression',
      violates: 'The parser preserves the approved token boundary.',
      scope: 'in',
      status: 'lesson',
      sites: ['src/parser.js'],
      sourcesNote: 'The repeated target commits corroborate this local lead.'
    },
    ...changes
  };
}

function saveApproval(fixture, approval, name = 'approval.json') {
  const file = path.join(TMP, `${path.basename(fixture.target.root)}-${name}`);
  write(file, `${JSON.stringify(approval, null, 2)}\n`);
  return file;
}

function invoke(fixture, approvalFile, extraEnv = {}) {
  return childProcess.spawnSync(process.execPath, [
    PROMOTER, '--target', fixture.target.root, '--report', fixture.reportFile,
    '--approval', approvalFile, '--harness', ROOT, '--json'
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: isolatedEnv({ HARNESS_OBSERVATIONS_DIR: STORE, HOME, USERPROFILE: HOME, ...extraEnv })
  });
}

function resultFor(run, status, label) {
  assert.ifError(run.error);
  assert.equal(run.status, status, `${label}: promote exited ${run.status}; stderr: ${run.stderr}; stdout: ${run.stdout}`);
  assert.equal(run.stderr.trim(), '', `${label}: JSON result is on stdout`);
  return JSON.parse(run.stdout);
}

function refuse(fixture, approvalFile, label, diagnostic, extraEnv = {}) {
  const before = treeDigest(fixture.target.errorsDir);
  const result = resultFor(invoke(fixture, approvalFile, extraEnv), 2, label);
  assert.equal(result.ok, false, `${label}: refusal result is explicit`);
  assert.match(result.error, diagnostic, `${label}: refusal explains the contract violation`);
  assert.equal(treeDigest(fixture.target.errorsDir), before, `${label}: SHA-256 ledger-tree digest is unchanged`);
  return result;
}

function promoteControl(fixture, approvalFile, label) {
  const reportBefore = fs.readFileSync(fixture.reportFile);
  const before = fs.readdirSync(fixture.target.errorsDir).filter(name => /^E-\d{4}-.*\.md$/.test(name)).sort();
  const result = resultFor(invoke(fixture, approvalFile), 0, `${label} positive control`);
  assert.deepEqual(result, {
    ok: true, id: 'E-0002',
    file: path.posix.join(...ERRORS.split(path.sep), 'E-0002-parser-edge-case.md'),
    indexUpdated: true
  }, `${label}: only one new E-ID is allocated`);
  const after = fs.readdirSync(fixture.target.errorsDir).filter(name => /^E-\d{4}-.*\.md$/.test(name)).sort();
  assert.deepEqual(after, [...before, 'E-0002-parser-edge-case.md'].sort(), `${label}: intended destination ledger gets one record`);
  const record = fs.readFileSync(path.join(fixture.target.errorsDir, 'E-0002-parser-edge-case.md'), 'utf8');
  assert.ok(record.includes(fixture.gitCandidate.sources.find(item => ['git', 'doc'].includes(item.type)).sha),
    `${label}: the corroborating target commit reaches the promoted record`);
  assert.doesNotMatch(record, /p-local-|w-local-|PRIVATE_LESSON_SENTINEL|PRIVATE_CUE_SENTINEL|PRIVATE_URL_SENTINEL|issueUrl|workspaceKey|provisionalId/,
    `${label}: opaque refs and private store fields stay out of committed text`);
  assert.equal(fs.readFileSync(path.join(fixture.target.errorsDir, 'index.jsonl'), 'utf8'), render(fixture.target.root),
    `${label}: destination index matches the canonical renderer`);
  assert.deepEqual(fs.readFileSync(fixture.reportFile), reportBefore, `${label}: promotion leaves approved report bytes unchanged`);
}

function duplicateInjection(fixture, wholeRule = false) {
  const marker = path.join(TMP, `${path.basename(fixture.target.root)}-lock-ledger.sha`);
  const hook = path.join(TMP, `${path.basename(fixture.target.root)}-lock-injection.js`);
  const config = {
    promoteScript: PROMOTER,
    targetRoot: fixture.target.root,
    errorsDir: fixture.target.errorsDir,
    lockPath: path.join(fixture.target.errorsDir, '.promote.lock'),
    recordPath: path.join(fixture.target.errorsDir, `E-0002-${wholeRule ? 'same-rule-other-signature' : 'parser-edge-case'}.md`),
    indexPath: path.join(fixture.target.errorsDir, 'index.jsonl'),
    syncScript: SYNC,
    marker
  };
  const record = [
    '---', 'id: E-0002', `signature: ${wholeRule ? 'same-rule-other-signature' : 'parser-edge-case'}`, 'class: test-coupling',
    'title: Added after local-store scan', 'scope: in', 'status: lesson',
    ...(wholeRule ? ['match:', '  actions:', '    - tool: shell', '      executable: git', '      subcommand: commit'] : []),
    'sites:', '  - src/parser.js', 'violates: Duplicate class control',
    'mechanism_ref: null', 'episodes: []', '---', '', '## Cue', '', 'A duplicate control.',
    '', '## Lesson', '', 'This record was inserted after scan and after lock acquisition.', ''
  ].join('\n');
  const hookText = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const crypto = require('node:crypto');",
    `const config = ${JSON.stringify(config)};`,
    `const record = ${JSON.stringify(record)};`,
    'const originalOpenSync = fs.openSync.bind(fs);',
    'const originalWriteFileSync = fs.writeFileSync.bind(fs);',
    'let injected = false;',
    'fs.openSync = function (file, ...args) {',
    '  const fd = originalOpenSync(file, ...args);',
    '  if (!injected && process.argv[1] === config.promoteScript && path.resolve(String(file)) === config.lockPath) {',
    '    injected = true;',
    "    originalWriteFileSync(config.recordPath, record, { flag: 'wx' });",
    '    const index = require(config.syncScript).render(config.targetRoot);',
    '    originalWriteFileSync(config.indexPath, index);',
    "    const rows = fs.readdirSync(config.errorsDir).filter(name => name !== '.promote.lock').sort().map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(config.errorsDir, name))).digest('hex')]);",
    "    originalWriteFileSync(config.marker, crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'));",
    '  }',
    '  return fd;',
    '};', ''
  ].join('\n');
  write(hook, hookText);
  return { marker, recordPath: config.recordPath, nodeOptions: `--require="${hook}"` };
}

try {
  const positive = prepared('positive-control');
  assert.ok(positive.candidate.sources.some(source => source.type === 'local-store'));
  assert.ok(positive.candidate.sources.some(source => ['git', 'doc'].includes(source.type)),
    'positive control: local ref and real commit are bound to the same approved candidate');
  assert.equal(positive.localSource.destination, 'harness');
  assert.match(positive.localSource.workspaceRef, /^w-local-[a-f0-9]{64}$/);
  const validApproval = saveApproval(positive, approvalFor(positive));
  promoteControl(positive, validApproval, 'same-candidate corroboration');

  const projectDestination = prepared('project-destination', true, 'project');
  assert.equal(projectDestination.localSource.destination, 'project');
  promoteControl(projectDestination, saveApproval(projectDestination, approvalFor(projectDestination)),
    'project destination binding');

  const missingApproval = prepared('missing-approval');
  refuse(missingApproval, path.join(TMP, 'not-created-approval.json'), 'missing approval', /approval cannot be read/);
  promoteControl(missingApproval, saveApproval(missingApproval, approvalFor(missingApproval)), 'missing approval');

  const wrongApproval = prepared('wrong-approval');
  const wrong = approvalFor(wrongApproval);
  wrong.reportSha256 = '0'.repeat(64);
  refuse(wrongApproval, saveApproval(wrongApproval, wrong), 'wrong approval digest', /report SHA-256/);
  promoteControl(wrongApproval, saveApproval(wrongApproval, approvalFor(wrongApproval)), 'wrong approval digest');

  const editedReport = prepared('edited-report');
  const approved = saveApproval(editedReport, approvalFor(editedReport));
  const reportBytes = fs.readFileSync(editedReport.reportFile);
  fs.appendFileSync(editedReport.reportFile, ' ');
  refuse(editedReport, approved, 'edited report', /report SHA-256/);
  fs.writeFileSync(editedReport.reportFile, reportBytes);
  promoteControl(editedReport, approved, 'edited report');

  const wrongWorkspace = prepared('wrong-workspace');
  const boundReport = fs.readFileSync(wrongWorkspace.reportFile);
  wrongWorkspace.localSource.workspaceRef = `w-local-${'0'.repeat(64)}`;
  saveReport(wrongWorkspace);
  const wrongWorkspaceApproval = saveApproval(wrongWorkspace, approvalFor(wrongWorkspace));
  refuse(wrongWorkspace, wrongWorkspaceApproval, 'wrong workspace binding', /workspace.*(?:match|target)|workspace binding/i);
  fs.writeFileSync(wrongWorkspace.reportFile, boundReport);
  wrongWorkspace.report = JSON.parse(boundReport.toString('utf8'));
  wrongWorkspace.localSource = wrongWorkspace.report.sources.find(source => source.type === 'local-store');
  wrongWorkspace.candidate = wrongWorkspace.report.candidates.find(item => item.id === JSON.parse(boundReport.toString('utf8')).candidates.find(candidate => candidate.sources.some(source => source.type === 'local-store')).id);
  promoteControl(wrongWorkspace, saveApproval(wrongWorkspace, approvalFor(wrongWorkspace)), 'wrong workspace binding');

  const wrongDestination = prepared('wrong-destination');
  const projectApproval = saveApproval(wrongDestination, approvalFor(wrongDestination, { destination: 'project' }));
  refuse(wrongDestination, projectApproval, 'wrong destination approval', /destination/);
  promoteControl(wrongDestination, saveApproval(wrongDestination, approvalFor(wrongDestination)), 'wrong destination approval');

  const unknownDestination = prepared('unknown-destination');
  const goodReport = fs.readFileSync(unknownDestination.reportFile);
  unknownDestination.localSource.destination = 'unknown';
  for (const source of unknownDestination.candidate.sources.filter(item => item.type === 'local-store')) source.destination = 'unknown';
  saveReport(unknownDestination);
  const unknownApproval = saveApproval(unknownDestination, approvalFor(unknownDestination, { destination: 'unknown' }));
  refuse(unknownDestination, unknownApproval, 'unknown destination', /destination/);
  fs.writeFileSync(unknownDestination.reportFile, goodReport);
  unknownDestination.report = JSON.parse(goodReport.toString('utf8'));
  unknownDestination.localSource = unknownDestination.report.sources.find(source => source.type === 'local-store');
  unknownDestination.candidate = unknownDestination.report.candidates.find(item => item.sources.some(source => source.type === 'local-store'));
  promoteControl(unknownDestination, saveApproval(unknownDestination, approvalFor(unknownDestination)), 'unknown destination');

  const localOnly = prepared('local-only', false);
  assert.ok(localOnly.gitCandidate, 'negative control: a similar durable Git candidate exists elsewhere in the report');
  assert.ok(!localOnly.candidate.sources.some(source => ['git', 'doc'].includes(source.type)),
    'negative control: the selected local candidate itself has no durable source');
  assert.ok(!fs.readFileSync(localOnly.reportFile, 'utf8').includes(PRIVATE.issueUrl), 'stored issue URL stays private to the store');
  refuse(localOnly, saveApproval(localOnly, approvalFor(localOnly)), 'local-only evidence including issue URL', /durable source evidence/);
  bindCorroboratingCommit(localOnly);
  promoteControl(localOnly, saveApproval(localOnly, approvalFor(localOnly)), 'local-only evidence including issue URL');

  const duplicateAfterScan = prepared('duplicate-after-scan');
  const duplicateApproval = saveApproval(duplicateAfterScan, approvalFor(duplicateAfterScan));
  const injection = duplicateInjection(duplicateAfterScan);
  const raced = resultFor(invoke(duplicateAfterScan, duplicateApproval, { NODE_OPTIONS: injection.nodeOptions }), 2,
    'duplicate added after scan while promotion lock is acquired');
  assert.equal(raced.ok, false);
  assert.match(raced.error, /duplicate class|exact dedupe/i,
    'lock-time recheck identifies the newly added exact class');
  assert.equal(treeDigest(duplicateAfterScan.target.errorsDir, true), fs.readFileSync(injection.marker, 'utf8'),
    'after the concurrent duplicate insertion, the refusal makes zero further ledger writes');
  fs.rmSync(injection.recordPath);
  write(path.join(duplicateAfterScan.target.errorsDir, 'index.jsonl'), render(duplicateAfterScan.target.root));
  promoteControl(duplicateAfterScan, duplicateApproval, 'locked dedupe recheck');

  const wholeRuleDuplicate = prepared('whole-rule-after-scan');
  const wholeRuleApproval = saveApproval(wholeRuleDuplicate, approvalFor(wholeRuleDuplicate));
  const wholeRuleInjection = duplicateInjection(wholeRuleDuplicate, true);
  const wholeRuleResult = resultFor(invoke(wholeRuleDuplicate, wholeRuleApproval,
    { NODE_OPTIONS: wholeRuleInjection.nodeOptions }), 2, 'whole-rule duplicate added after scan under the lock');
  assert.equal(wholeRuleResult.ok, false);
  assert.match(wholeRuleResult.error, /duplicate class|exact dedupe/i,
    'lock-time recheck catches the same exact rule under a different signature');
  assert.equal(treeDigest(wholeRuleDuplicate.target.errorsDir, true), fs.readFileSync(wholeRuleInjection.marker, 'utf8'),
    'whole-rule refusal makes zero further ledger writes after the concurrent insertion');
  fs.rmSync(wholeRuleInjection.recordPath);
  write(path.join(wholeRuleDuplicate.target.errorsDir, 'index.jsonl'), render(wholeRuleDuplicate.target.root));
  promoteControl(wholeRuleDuplicate, wholeRuleApproval, 'locked whole-rule dedupe recheck');

  console.log('PASS local-store promotion binds workspace, destination, corroboration, approval, and locked dedupe');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

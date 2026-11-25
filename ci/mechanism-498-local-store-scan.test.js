'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const localErrors = require('../hooks/scripts/lib/local-errors');

const ROOT = path.resolve(__dirname, '..');
const SCANNER = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'scan.js');
const PACKAGED_SCANNER = path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'error-ledger-bootstrap', 'scripts', 'scan.js');
const ERRORS_SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-498-local-store-')));
const STORE = path.join(TMP, 'store');
const HOME = path.join(TMP, 'home');
const NOW = '2026-11-25T12:34:56.000Z';
const PRIVATE_VALUES = [
  'PRIVATE_EXCERPT_SENTINEL', 'PRIVATE_CUE_SENTINEL', 'PRIVATE_LESSON_SENTINEL',
  'PRIVATE_URL_SENTINEL', 'PRIVATE_PATH_SENTINEL', 'PRIVATE_SESSION_SENTINEL',
  'PRIVATE_TOOL_USE_SENTINEL', 'PRIVATE_READER_ROW_SENTINEL', 'sharedrawid',
  'readerprivateid', 'distinct-lesson-id', 'surviving-lesson-id'
];
const ACTIONS = {
  commit: { actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }] },
  push: { actions: [{ tool: 'shell', executable: 'git', subcommand: 'push' }] },
  pull: { actions: [{ tool: 'shell', executable: 'git', subcommand: 'pull' }] }
};

fs.mkdirSync(HOME, { recursive: true });
const WRITER_ENV = isolatedEnv({ HARNESS_OBSERVATIONS_DIR: STORE, HOME, USERPROFILE: HOME });

function isolatedEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of ['HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR']) delete env[key];
  return env;
}

function runNode(script, args, env = {}) {
  const childEnv = isolatedEnv();
  Object.assign(childEnv, env);
  const result = childProcess.spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.ifError(result.error);
  return result;
}

function git(repo, args, env = {}) {
  const result = childProcess.spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: isolatedEnv({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Local Store Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Local Store Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: NOW,
      GIT_COMMITTER_DATE: NOW,
      ...env
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function makeRepo(name) {
  const repo = path.join(TMP, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  write(path.join(repo, 'README.md'), '# Fixture\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'chore: initialize fixture']);
  return repo;
}

function addLedgerRecord(repo, id, signature, match) {
  const errors = path.join(repo, '.agents', 'harness-everything', 'errors');
  const file = path.join(errors, `${id}-${signature}.md`);
  const matchText = match ? `match:\n${Object.entries(match).map(([phase, rules]) =>
    `  ${phase}:\n${rules.map(rule => `    - tool: ${rule.tool}\n      executable: ${rule.executable}\n      subcommand: ${rule.subcommand}${rule.diagnostics ? `\n      diagnostics: [${rule.diagnostics.join(', ')}]` : ''}`).join('\n')}`).join('\n')}\n` : '';
  write(file, [
    '---', `id: ${id}`, `signature: ${signature}`, 'class: fixture', 'title: Fixture rule',
    'scope: in', 'status: lesson', 'sites: []', 'violates: Fixture', matchText.trimEnd(),
    'episodes: []', '---', '', '## Cue', '', 'Fixture cue.', '', '## Lesson', '', 'Fixture lesson.', ''
  ].filter(Boolean).join('\n'));
}

function finalizeLedger(repo) {
  const result = runNode(ERRORS_SYNC, ['--root', repo]);
  assert.strictEqual(result.status, 0, `errors-sync failed: ${result.stderr}`);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'chore: prepare destination ledger']);
}

function addLesson(workspaceRoot, signature, destination, match = ACTIONS.push, id = 'sharedrawid') {
  const result = localErrors.addProvisionalLesson({
    workspaceRoot,
    destination,
    provisionalId: id,
    signature,
    match,
    lesson: `PRIVATE_LESSON_SENTINEL for ${signature} at /private/PRIVATE_PATH_SENTINEL`,
    cue: 'PRIVATE_CUE_SENTINEL',
    issueUrl: 'https://private.example/PRIVATE_URL_SENTINEL'
  }, { env: WRITER_ENV });
  assert.ok(['appended', 'duplicate'].includes(result.status), `could not create real provisional fixture: ${result.status}`);
  return result.record;
}

function addOccurrence(workspaceRoot, signature, destination, index) {
  const result = localErrors.appendOccurrence({
    workspaceRoot,
    destination,
    signature,
    commandClass: 'test',
    exitCode: 1,
    sessionKey: `PRIVATE_SESSION_SENTINEL-${index}`,
    toolUseId: `PRIVATE_TOOL_USE_SENTINEL-${index}`,
    output: 'PRIVATE_EXCERPT_SENTINEL'
  }, { env: WRITER_ENV });
  assert.strictEqual(result.status, 'appended', `could not create real occurrence fixture: ${result.status}`);
  return result.record;
}

function fileHash(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
  catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
}

function treeHash(directory) {
  if (!fs.existsSync(directory)) return 'missing';
  const entries = [];
  function visit(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) entries.push([path.relative(directory, file), 'symlink']);
      else if (stat.isDirectory()) visit(file);
      else entries.push([path.relative(directory, file), fileHash(file)]);
    }
  }
  visit(directory);
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function scan(repo, destination, storeRoot = STORE, envOverrides = {}) {
  const out = path.join(TMP, `reports-${crypto.randomBytes(5).toString('hex')}`);
  fs.mkdirSync(out);
  const storeFile = path.join(storeRoot, localErrors.INDEX_FILE);
  const ledgerDir = path.join(repo, '.agents', 'harness-everything', 'errors');
  const beforeStore = treeHash(storeRoot);
  const beforeLedger = treeHash(ledgerDir);
  const result = runNode(SCANNER, [
    '--root', repo, '--no-memory', '--source', 'local-store', '--destination', destination,
    '--out', out, '--json'
  ], { HARNESS_OBSERVATIONS_DIR: storeRoot, HOME, USERPROFILE: HOME, ...envOverrides });
  assert.strictEqual(result.status, 0,
    `scanner exit ${result.status}; stderr: ${result.stderr.trim()}; stdout: ${result.stdout.trim()}`);
  assert.strictEqual(result.stderr.trim(), '', 'successful scans do not write stderr');
  const envelope = JSON.parse(result.stdout);
  assert.strictEqual(envelope.ok, true, 'scanner JSON envelope reports success');
  assert.strictEqual(treeHash(storeRoot), beforeStore, 'scan leaves the shared local store bytes unchanged');
  assert.strictEqual(treeHash(ledgerDir), beforeLedger, 'scan leaves destination ledger bytes unchanged');
  const report = JSON.parse(fs.readFileSync(envelope.reportJson, 'utf8'));
  const markdown = fs.readFileSync(envelope.reportMd, 'utf8');
  return { report, markdown, envelope, storeFile };
}

function localSource(report) {
  return report.sources.find(source => source.type === 'local-store');
}

function localCandidates(report) {
  return report.candidates.filter(candidate => candidate.sources.some(source => source.type === 'local-store'));
}

function bySignature(report, signature) {
  return localCandidates(report).find(candidate => candidate.signature === signature);
}

function sourceRefs(candidate) {
  return candidate.sources.filter(source => source.type === 'local-store').map(source => source.ref).sort();
}

function assertPrivate(report, markdown) {
  const output = `${JSON.stringify(report)}\n${markdown}`;
  for (const value of PRIVATE_VALUES) assert.ok(!output.includes(value), `private local value escaped: ${value}`);
}

function incompleteReaderSource() {
  return [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "function called(name) { fs.appendFileSync(process.env.READER_CALL_LOG, name + '\\n'); }",
    'const reader = {',
    '  SCHEMA_VERSION: 1,',
    "  INDEX_FILE: 'errors-index.json',",
    "  INDEX_KIND: 'local-error-store',",
    "  DESTINATIONS: ['harness', 'project', 'unknown'],",
    "  COMMAND_CLASSES: ['git', 'gh', 'test', 'build', 'package', 'shell'],",
    '  LIMITS: { maxIndexBytes: 2 * 1024 * 1024, maxExcerptBytes: 2048, maxLessonChars: 4096, maxCueChars: 4096, maxMatchedLedgerIds: 16 },',
    '  resolveWorkspaceKey(input) { called(\'resolveWorkspaceKey\'); return input.workspaceRoot; },',
    "  getStorePath() { called('getStorePath'); return { file: path.join(process.env.HARNESS_OBSERVATIONS_DIR, 'errors-index.json') }; },",
    "  listRecords() { called('listRecords'); return JSON.parse(fs.readFileSync(process.env.READER_FIXTURE_ROWS, 'utf8')); },",
    '  validateMatch(match) { called(\'validateMatch\'); return match; }',
    '};',
    'delete reader.DESTINATIONS;',
    'module.exports = reader;'
  ].join('\n');
}

const legacy = makeRepo('legacy-target');
const legacyOut = path.join(TMP, 'legacy-reports');
fs.mkdirSync(legacyOut);
const freezeTime = path.join(TMP, 'freeze-time.js');
write(freezeTime, [
  "const NativeDate = Date;",
  "class FrozenDate extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-11-25T12:34:56.000Z'])); } static now() { return NativeDate.parse('2026-11-25T12:34:56.000Z'); } }",
  'global.Date = FrozenDate;'
].join('\n'));
const legacyRun = childProcess.spawnSync(process.execPath, [
  '--require', freezeTime, SCANNER, '--root', legacy, '--no-memory', '--out', legacyOut, '--json'
], { encoding: 'utf8', env: isolatedEnv({ HOME, USERPROFILE: HOME }), stdio: ['ignore', 'pipe', 'pipe'] });
assert.ifError(legacyRun.error);
assert.strictEqual(legacyRun.status, 0, `legacy control scan failed: ${legacyRun.stderr}`);
const legacyEnvelope = JSON.parse(legacyRun.stdout);
const legacyJsonBytes = fs.readFileSync(legacyEnvelope.reportJson, 'utf8');
const legacyMarkdownBytes = fs.readFileSync(legacyEnvelope.reportMd, 'utf8');
assert.strictEqual(legacyJsonBytes, JSON.stringify({
  schemaVersion: 1,
  root: 'legacy-target',
  generatedAt: NOW,
  options: { hideLedger: false, noMemory: true, memory: [], instructions: [], homeOverridden: false },
  sources: [
    { type: 'git', origin: 'history', status: 'used' },
    { type: 'doc', origin: 'history', status: 'missing', reason: 'no repeated Markdown or docs paths found' },
    { type: 'tracker', origin: 'offline', status: 'missing', reason: 'no --tracker file provided' },
    { type: 'memory', origin: 'auto', status: 'disabled', verified: false, reason: 'disabled by --no-memory' },
    { type: 'instruction', origin: 'repository', status: 'disabled', reason: 'disabled by --no-memory' },
    { type: 'instruction', origin: 'global-explicit', status: 'disabled', reason: 'disabled by --no-memory' }
  ],
  candidates: []
}, null, 2) + '\n', 'no-source JSON report remains byte-identical to the legacy contract');
assert.strictEqual(legacyMarkdownBytes, [
  '# Error ledger candidate report', '', '- Schema version: 1', '- Root: `legacy-target`', `- Generated: ${NOW}`,
  '- Candidates: 0', '', '## Options', '', '- hideLedger: false', '- noMemory: true', '- memory: none',
  '- instructions: none', '- homeOverridden: false', '', '## Sources', '',
  '- `git` (history) — **used** — history',
  '- `doc` (history) — **missing** — history — no repeated Markdown or docs paths found',
  '- `tracker` (offline) — **missing** — offline — no --tracker file provided',
  '- `memory` (auto) — **disabled** — auto — disabled by --no-memory — verified: false',
  '- `instruction` (repository) — **disabled** — repository — disabled by --no-memory',
  '- `instruction` (global-explicit) — **disabled** — global-explicit — disabled by --no-memory',
  '', '## Candidates', '', ''
].join('\n'), 'no-source Markdown report remains byte-identical to the legacy contract');

const workspaceA = makeRepo('workspace-a');
const workspaceB = makeRepo('workspace-b');
const workspaceCollision = makeRepo('workspace-collision');
addLedgerRecord(workspaceA, 'E-0001', 'duplicate-lesson', null);
addLedgerRecord(workspaceA, 'E-0002', 'existing-rule', ACTIONS.push);
addLedgerRecord(workspaceA, 'E-0003', 'ambiguous-lesson', null);
addLedgerRecord(workspaceA, 'E-0004', 'other-ambiguous', ACTIONS.pull);
finalizeLedger(workspaceA);
fs.mkdirSync(path.join(workspaceB, '.agents', 'harness-everything', 'errors'), { recursive: true });
finalizeLedger(workspaceB);
fs.mkdirSync(path.join(workspaceCollision, '.agents', 'harness-everything', 'errors'), { recursive: true });
finalizeLedger(workspaceCollision);

const sharedA = addLesson(workspaceA, 'shared-lesson', 'harness', ACTIONS.commit, 'sharedrawid');
const sharedB = addLesson(workspaceB, 'shared-lesson', 'harness', ACTIONS.commit, 'sharedrawid');
assert.strictEqual(sharedA.provisionalId, sharedB.provisionalId, 'positive control: both real writers accepted the same raw provisional ID');
addLesson(workspaceA, 'duplicate-lesson', 'harness', ACTIONS.commit, 'lesson-duplicate');
addLesson(workspaceA, 'rule-lesson', 'harness', ACTIONS.push, 'lesson-rule');
addLesson(workspaceA, 'ambiguous-lesson', 'harness', ACTIONS.pull, 'lesson-ambiguous');
addLesson(workspaceA, 'covered-lesson', 'harness', ACTIONS.commit, 'lesson-covered');
addLesson(workspaceA, 'project-lesson', 'project', ACTIONS.commit, 'lesson-project');
addLesson(workspaceA, 'unknown-lesson', 'unknown', ACTIONS.commit, 'lesson-unknown');
addLesson(workspaceB, 'workspace-b-only', 'harness', ACTIONS.commit, 'lesson-b-only');
addOccurrence(workspaceA, 'occurrence-class', 'harness', 1);
addOccurrence(workspaceA, 'occurrence-class', 'harness', 2);
addOccurrence(workspaceA, 'covered-lesson', 'harness', 3);
addOccurrence(workspaceA, 'project-occurrence', 'project', 4);
addOccurrence(workspaceA, 'unknown-occurrence', 'unknown', 5);
addOccurrence(workspaceB, 'workspace-b-occurrence', 'harness', 6);
const collisionOccurrence = addOccurrence(workspaceCollision, 'collision-occurrence', 'harness', 7);
const collisionRawId = collisionOccurrence.provisionalId;
PRIVATE_VALUES.push(collisionRawId);
const collisionLesson = addLesson(workspaceCollision, 'collision-lesson', 'project', ACTIONS.commit, collisionRawId);
addLesson(workspaceB, 'collision-id-other-workspace', 'harness', ACTIONS.commit, collisionRawId);
const distinctLesson = addLesson(workspaceCollision, 'distinct-lesson-signature', 'harness', ACTIONS.commit, 'distinct-lesson-id');
const distinctOccurrence = addOccurrence(workspaceCollision, 'distinct-occurrence-signature', 'harness', 8);
PRIVATE_VALUES.push(distinctOccurrence.provisionalId);
const survivingLesson = addLesson(workspaceCollision, 'surviving-lesson', 'harness', ACTIONS.commit, 'surviving-lesson-id');

const baselineStore = fs.readFileSync(path.join(STORE, localErrors.INDEX_FILE));
const firstA = scan(workspaceA, 'harness');
const statusA = localSource(firstA.report);
assert.ok(statusA, 'opt-in reports local-store status');
assert.strictEqual(statusA.status, 'used');
assert.strictEqual(statusA.destination, 'harness');
assert.match(statusA.workspaceRef, /^w-local-[a-f0-9]{64}$/);
assert.strictEqual(statusA.counts.destinationMismatch, 2);
assert.strictEqual(statusA.counts.unknownDestination, 2);
assert.strictEqual(statusA.counts.malformed, 0);
assert.strictEqual(localCandidates(firstA.report).length, 6, 'one lead per lesson plus one clustered uncovered occurrence signature');
assert.strictEqual(bySignature(firstA.report, 'occurrence-class').sources.filter(source => source.type === 'local-store').length, 2,
  'occurrences with the same signature form one lead with both opaque refs');
assert.strictEqual(bySignature(firstA.report, 'covered-lesson').sources.filter(source => source.kind === 'occurrence').length, 0,
  'an occurrence cluster covered by a lesson is suppressed');
assert.ok(!bySignature(firstA.report, 'project-lesson'));
assert.ok(!bySignature(firstA.report, 'unknown-lesson'));
assert.ok(!bySignature(firstA.report, 'project-occurrence'));
assert.ok(!bySignature(firstA.report, 'unknown-occurrence'));
assert.strictEqual(bySignature(firstA.report, 'shared-lesson').local.evidenceReadiness, 'needs-evidence');
assert.strictEqual(bySignature(firstA.report, 'shared-lesson').local.dedupe.status, 'none');
assert.strictEqual(bySignature(firstA.report, 'shared-lesson').local.dedupe.newClassEligible, true);
assert.deepStrictEqual(bySignature(firstA.report, 'duplicate-lesson').local.dedupe,
  { status: 'existing', classIds: ['E-0001'], matchedBy: ['signature'], newClassEligible: false });
assert.deepStrictEqual(bySignature(firstA.report, 'rule-lesson').local.dedupe,
  { status: 'existing', classIds: ['E-0002'], matchedBy: ['whole-rule'], newClassEligible: false });
assert.deepStrictEqual(bySignature(firstA.report, 'ambiguous-lesson').local.dedupe,
  { status: 'ambiguous', classIds: ['E-0003', 'E-0004'], matchedBy: ['signature', 'whole-rule'], newClassEligible: false });
assertPrivate(firstA.report, firstA.markdown);
assert.ok(!JSON.stringify(firstA.report).includes(sharedA.workspaceKey), 'raw workspace keys stay private');
assert.ok(firstA.markdown.includes('needs-evidence'), 'Markdown carries evidence readiness');
assert.ok(firstA.markdown.includes('ambiguous'), 'Markdown carries exact dedupe outcome');

const secondA = scan(workspaceA, 'harness');
assert.deepStrictEqual(sourceRefs(bySignature(secondA.report, 'shared-lesson')),
  sourceRefs(bySignature(firstA.report, 'shared-lesson')), 'repeat scan preserves the record ref');
const scanB = scan(workspaceB, 'harness');
assert.strictEqual(localCandidates(scanB.report).length, 4, 'workspace B sees its same-ID row independently from workspace C');
assert.strictEqual(sourceRefs(bySignature(scanB.report, 'shared-lesson')).length, 1);
assert.notDeepStrictEqual(sourceRefs(bySignature(scanB.report, 'shared-lesson')),
  sourceRefs(bySignature(firstA.report, 'shared-lesson')), 'same raw provisional ID has a different ref in another workspace');
assert.ok(!bySignature(scanB.report, 'duplicate-lesson'));
assert.ok(bySignature(scanB.report, 'workspace-b-only'));
assert.ok(bySignature(scanB.report, 'collision-id-other-workspace'), 'a matching raw ID in another workspace remains isolated');

const projectScan = scan(workspaceA, 'project');
assert.strictEqual(localSource(projectScan.report).destination, 'project');
assert.ok(bySignature(projectScan.report, 'project-lesson'));
assert.ok(bySignature(projectScan.report, 'project-occurrence'));
assert.strictEqual(localCandidates(projectScan.report).length, 2, 'project destination includes only project records');

const missingStore = path.join(TMP, 'missing-store');
const missing = scan(workspaceA, 'harness', missingStore);
assert.strictEqual(localSource(missing.report).status, 'missing');
assert.strictEqual(localSource(missing.report).reason, 'index-missing');
assert.strictEqual(localCandidates(missing.report).length, 0);

const emptyStore = path.join(TMP, 'empty-store');
fs.mkdirSync(emptyStore);
write(path.join(emptyStore, localErrors.INDEX_FILE), `${JSON.stringify({
  schemaVersion: localErrors.SCHEMA_VERSION, kind: localErrors.INDEX_KIND, records: []
})}\n`);
const empty = scan(workspaceA, 'harness', emptyStore);
assert.strictEqual(localSource(empty.report).status, 'unverified');
assert.strictEqual(localSource(empty.report).reason, 'empty-reader-result');

const rawStoreFile = path.join(STORE, localErrors.INDEX_FILE);
const validStoreBytes = fs.readFileSync(rawStoreFile);
try {
  fs.writeFileSync(rawStoreFile, '{invalid json');
  const corruptBytes = fs.readFileSync(rawStoreFile);
  const corrupt = scan(workspaceA, 'harness');
  assert.strictEqual(localSource(corrupt.report).status, 'unverified');
  assert.strictEqual(localSource(corrupt.report).reason, 'store-corrupt');
  assert.deepStrictEqual(fs.readFileSync(rawStoreFile), corruptBytes, 'corrupt store fixture bytes remain unchanged by scan');
} finally { fs.writeFileSync(rawStoreFile, validStoreBytes); }

const unreadableStore = path.join(TMP, 'unreadable-store');
fs.mkdirSync(unreadableStore);
fs.mkdirSync(path.join(unreadableStore, localErrors.INDEX_FILE));
const unreadable = scan(workspaceA, 'harness', unreadableStore);
assert.strictEqual(localSource(unreadable.report).status, 'unverified');
assert.strictEqual(localSource(unreadable.report).reason, 'store-unreadable');

const beforeMalformed = fs.readFileSync(rawStoreFile);
try {
  const index = JSON.parse(beforeMalformed.toString('utf8'));
  const row = index.records.find(record => record.workspaceKey === sharedA.workspaceKey && record.kind === 'provisional-lesson');
  assert.ok(row, 'positive control: fixture contains a real writer-generated row');
  row.destination = 'not-a-destination';
  fs.writeFileSync(rawStoreFile, `${JSON.stringify(index)}\n`);
  const malformedBytes = fs.readFileSync(rawStoreFile);
  const malformed = scan(workspaceA, 'harness');
  assert.strictEqual(localSource(malformed.report).status, 'unverified');
  assert.strictEqual(localSource(malformed.report).counts.malformed, 1);
  assert.ok(!JSON.stringify(malformed.report).includes('not-a-destination'));
  assert.deepStrictEqual(fs.readFileSync(rawStoreFile), malformedBytes, 'malformed store bytes remain unchanged by scan');
} finally { fs.writeFileSync(rawStoreFile, beforeMalformed); }

const mismatch = scan(workspaceA, 'harness', STORE, { HARNESS_WORKSPACE_ROOT: workspaceB });
assert.strictEqual(localSource(mismatch.report).status, 'unverified');
assert.strictEqual(localSource(mismatch.report).reason, 'workspace-binding-mismatch');
assert.strictEqual(localCandidates(mismatch.report).length, 0);

const ledgerIndex = path.join(workspaceA, '.agents', 'harness-everything', 'errors', 'index.jsonl');
const validLedgerBytes = fs.readFileSync(ledgerIndex);
try {
  fs.rmSync(ledgerIndex);
  fs.mkdirSync(ledgerIndex);
  const unreadableLedger = scan(workspaceA, 'harness');
  assert.strictEqual(localSource(unreadableLedger.report).ledgerStatus, 'unverified');
  assert.strictEqual(localSource(unreadableLedger.report).ledgerReason, 'ledger-unreadable');
  assert.strictEqual(bySignature(unreadableLedger.report, 'shared-lesson').local.dedupe.status, 'unverified');
  assert.strictEqual(bySignature(unreadableLedger.report, 'shared-lesson').local.dedupe.newClassEligible, false);
} finally {
  fs.rmSync(ledgerIndex, { recursive: true, force: true });
  fs.writeFileSync(ledgerIndex, validLedgerBytes);
}

function failedArgs(args, diagnostic) {
  const result = runNode(SCANNER, ['--root', workspaceA, '--no-memory', ...args, '--json'], {
    HARNESS_OBSERVATIONS_DIR: STORE, HOME, USERPROFILE: HOME
  });
  assert.strictEqual(result.status, 2, `expected CLI argument failure for ${args.join(' ')}`);
  assert.match(result.stderr.trim(), diagnostic);
}
failedArgs(['--source', 'other', '--destination', 'harness'], /unknown source/);
failedArgs(['--source', 'local-store', '--source', 'local-store', '--destination', 'harness'], /duplicate option: --source/);
failedArgs(['--source', 'local-store'], /--destination is required/);
failedArgs(['--source', 'local-store', '--destination', 'unknown'], /invalid --destination/);
failedArgs(['--destination', 'harness'], /--destination requires --source local-store/);

const packagedOut = path.join(TMP, 'packaged-reports');
fs.mkdirSync(packagedOut);
const packaged = runNode(PACKAGED_SCANNER, [
  '--root', workspaceA, '--no-memory', '--source', 'local-store', '--destination', 'harness',
  '--out', packagedOut, '--json'
], { HARNESS_OBSERVATIONS_DIR: STORE, HOME, USERPROFILE: HOME });
assert.strictEqual(packaged.status, 0, `packaged scan must fail safe when the store contract is absent: ${packaged.stderr}`);
const packagedEnvelope = JSON.parse(packaged.stdout);
const packagedReport = JSON.parse(fs.readFileSync(packagedEnvelope.reportJson, 'utf8'));
assert.strictEqual(localSource(packagedReport).status, 'unavailable');
assert.strictEqual(localSource(packagedReport).reason, 'reader-unavailable');
assert.strictEqual(localCandidates(packagedReport).length, 0);

function verifyProvisionalCollision() {
  const originalBytes = fs.readFileSync(rawStoreFile);
  const index = JSON.parse(originalBytes.toString('utf8'));
  const collisionRows = index.records.filter(record =>
    record.workspaceKey === collisionLesson.workspaceKey && record.provisionalId === collisionRawId);
  assert.deepStrictEqual(collisionRows.map(record => record.kind).sort(), ['occurrence', 'provisional-lesson']);
  try {
    for (const records of [index.records, [...index.records].reverse()]) {
      fs.writeFileSync(rawStoreFile, `${JSON.stringify({ ...index, records })}\n`);
      const { report, markdown } = scan(workspaceCollision, 'harness');
      const source = localSource(report);
      assert.deepStrictEqual({
        status: source.status,
        reason: source.reason,
        malformed: source.counts.malformed,
        workspaceRecords: source.counts.workspaceRecords,
        destinationMismatch: source.counts.destinationMismatch,
        candidates: localCandidates(report).map(candidate => candidate.signature).sort()
      }, {
        status: 'unverified',
        reason: 'provisional-id-collision',
        malformed: 2,
        workspaceRecords: 3,
        destinationMismatch: 0,
        candidates: ['distinct-lesson-signature', 'distinct-occurrence-signature', 'surviving-lesson']
      }, 'both cross-kind rows are excluded while unrelated and distinct-ID leads survive');
      assert.notStrictEqual(distinctLesson.provisionalId, distinctOccurrence.provisionalId);
      assert.strictEqual(sourceRefs(bySignature(report, 'distinct-lesson-signature')).length, 1);
      assert.strictEqual(sourceRefs(bySignature(report, 'distinct-occurrence-signature')).length, 1);
      assert.notDeepStrictEqual(
        sourceRefs(bySignature(report, 'distinct-lesson-signature')),
        sourceRefs(bySignature(report, 'distinct-occurrence-signature')),
        'distinct IDs retain distinct opaque refs');
      assert.ok(bySignature(report, 'surviving-lesson'), 'an unrelated lead survives');
      assert.ok(!bySignature(report, 'collision-lesson'));
      assert.ok(!bySignature(report, 'collision-occurrence'));
      assertPrivate(report, markdown);
    }
  } finally { fs.writeFileSync(rawStoreFile, originalBytes); }
}

function verifyIncompleteReaderContract() {
  const fixtureRoot = path.join(TMP, 'incomplete-reader');
  const fixtureScanner = path.join(fixtureRoot, 'error-ledger-bootstrap', 'scripts', 'scan.js');
  write(fixtureScanner, fs.readFileSync(SCANNER, 'utf8'));
  write(path.join(fixtureRoot, 'hooks', 'scripts', 'lib', 'local-errors.js'), incompleteReaderSource());

  const readerRowsFile = path.join(TMP, 'incomplete-reader-rows.json');
  write(readerRowsFile, JSON.stringify([{
    schemaVersion: localErrors.SCHEMA_VERSION,
    kind: 'occurrence',
    workspaceKey: workspaceA,
    provisionalId: 'readerprivateid',
    destination: 'harness',
    signature: 'reader-contract-control',
    createdAt: NOW,
    source: 'tool-failure',
    host: 'unknown',
    commandClass: 'test',
    exitCode: 1,
    sessionKey: null,
    toolUseId: null,
    outputExcerpt: 'PRIVATE_READER_ROW_SENTINEL',
    matchedLedgerIds: []
  }]));
  const readerCallLog = path.join(TMP, 'incomplete-reader-calls.txt');
  const out = path.join(TMP, 'incomplete-reader-reports');
  fs.mkdirSync(out);
  const ledgerDir = path.join(workspaceA, '.agents', 'harness-everything', 'errors');
  const beforeStore = treeHash(STORE);
  const beforeLedger = treeHash(ledgerDir);
  const result = runNode(fixtureScanner, [
    '--root', workspaceA, '--no-memory', '--source', 'local-store', '--destination', 'harness',
    '--out', out, '--json'
  ], {
    HARNESS_OBSERVATIONS_DIR: STORE,
    READER_CALL_LOG: readerCallLog,
    READER_FIXTURE_ROWS: readerRowsFile,
    HOME,
    USERPROFILE: HOME
  });
  assert.strictEqual(result.status, 0,
    `incomplete reader should produce a safe report; exit ${result.status}; stderr: ${result.stderr.trim()}; stdout: ${result.stdout.trim()}`);
  assert.strictEqual(result.stderr.trim(), '');
  const envelope = JSON.parse(result.stdout);
  const report = JSON.parse(fs.readFileSync(envelope.reportJson, 'utf8'));
  const markdown = fs.readFileSync(envelope.reportMd, 'utf8');
  assert.strictEqual(localSource(report).status, 'unavailable');
  assert.strictEqual(localSource(report).reason, 'reader-contract-incomplete');
  assert.strictEqual(localCandidates(report).length, 0);
  assert.ok(!fs.existsSync(readerCallLog), 'incomplete reader is rejected before any reader function is called');
  const otherSources = new Set(report.sources.filter(source => source.type !== 'local-store').map(source => source.type));
  for (const type of ['git', 'doc', 'tracker', 'memory', 'instruction']) {
    assert.ok(otherSources.has(type), `non-local source ${type} remains in the report`);
  }
  assertPrivate(report, markdown);
  assert.strictEqual(treeHash(STORE), beforeStore, 'incomplete reader scan leaves store bytes unchanged');
  assert.strictEqual(treeHash(ledgerDir), beforeLedger, 'incomplete reader scan leaves ledger bytes unchanged');
}

const acceptanceFailures = [];
function runAcceptanceCase(name, test) {
  try { test(); }
  catch (error) { acceptanceFailures.push(`${name}: ${error.message}`); }
}
runAcceptanceCase('F1 cross-kind collision', verifyProvisionalCollision);
runAcceptanceCase('F2 incomplete reader', verifyIncompleteReaderContract);
if (acceptanceFailures.length) {
  process.stderr.write(`Scanner acceptance failures:\n${acceptanceFailures.join('\n')}\n`);
  process.exitCode = 1;
}

assert.deepStrictEqual(fs.readFileSync(rawStoreFile), baselineStore, 'the fixture store is restored byte-for-byte');
if (!acceptanceFailures.length) {
  console.log('Local-store scanner CLI verified: legacy bytes, workspace isolation, collision handling, reader contract, redaction, statuses, dedupe, and packaged fallback.');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temporary fixture cleanup */ }

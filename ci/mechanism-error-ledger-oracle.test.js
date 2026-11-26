'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const localErrors = require('../hooks/scripts/lib/local-errors');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'error-ledger-oracle.js');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-error-ledger-oracle-')));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function makeFixture(name, records, candidates) {
  const root = path.join(TMP, name);
  const ledger = path.join(root, 'errors');
  const report = path.join(root, 'scan-report.json');
  fs.mkdirSync(ledger, { recursive: true });
  for (const record of records) {
    const sites = record.sites.length ? record.sites.map(site => `  - ${JSON.stringify(site)}`).join('\n') : '';
    const frontmatter = [
      '---',
      `id: ${record.id}`,
      ...(record.signature !== undefined ? [`signature: ${JSON.stringify(record.signature)}`] : []),
      ...(record.sites.length ? ['sites:', sites] : ['sites: []']),
      '---'
    ];
    write(path.join(ledger, `${record.id}-fixture.md`), [
      ...frontmatter,
      '', record.lesson || `PRIVATE_RECORD_BODY_${record.id}`, ''
    ].join('\n'));
  }
  write(report, `${JSON.stringify({
    schemaVersion: 1,
    candidates: candidates.map(candidate => ({
      kind: 'error-candidate',
      id: candidate.id,
      title: candidate.title || `PRIVATE_CANDIDATE_TITLE_${candidate.id}`,
      ...(candidate.signature !== undefined ? { signature: candidate.signature } : {}),
      sites: candidate.sites,
      sources: candidate.sources || [{ type: 'memory', title: 'PRIVATE_MEMORY_SOURCE_TITLE' }],
      ...(candidate.local !== undefined ? { local: candidate.local } : {})
    }))
  }, null, 2)}\n`);
  return { root, ledger, report };
}

function snapshot(dir) {
  const entries = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else entries.push([childRelative, crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex')]);
    }
  }
  visit(dir);
  return entries;
}

function run(fixture, options = []) {
  const env = { ...process.env, HOME: TMP, USERPROFILE: TMP };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  const result = childProcess.spawnSync(process.execPath, [
    SCRIPT, '--report', fixture.report, '--ledger', fixture.ledger, ...options
  ], { cwd: ROOT, encoding: 'utf8', env });
  assert.ifError(result.error);
  return result;
}

function jsonResult(result, expectedStatus = 0) {
  assert.strictEqual(result.status, expectedStatus,
    `oracle exit ${result.status}; expected ${expectedStatus}; stderr: ${result.stderr}`);
  if (expectedStatus === 0) assert.strictEqual(result.stderr, '', 'successful oracle runs do not write stderr');
  return expectedStatus === 0 ? JSON.parse(result.stdout) : null;
}

const fixture = makeFixture('main', [
  { id: 'E-0001', sites: ['parser/parser.js (PR #448 branch; not on main at bd986013)'] },
  { id: 'E-0002', sites: ['dir-only'] },
  { id: 'E-0003', sites: ['boundary/a/bc.js'] },
  { id: 'E-0004', sites: ['/private/absolute.js (PR #448)', 'C:\\private\\absolute.js', '../outside.js', 'https://example.invalid/a/path'] },
  { id: 'E-0005', sites: ['shared/file.js'] },
  { id: 'E-0006', sites: ['shared/file.js'] },
  { id: 'E-0007', sites: ['other/never.js'] },
  { id: 'E-0008', sites: ['parent/child.js'] }
], [
  { id: 'candidate-exact', sites: ['./parser\\parser.js'] },
  { id: 'candidate-child', sites: ['dir-only/sub/module.js'] },
  { id: 'candidate-boundary', sites: ['boundary/a/b'] },
  { id: 'candidate-shared', sites: ['shared/file.js'] },
  { id: 'candidate-parent', sites: ['parent'] }
]);

const ledgerBefore = snapshot(fixture.ledger);
const reportBefore = fs.readFileSync(fixture.report);
const result = run(fixture, ['--json']);
const payload = jsonResult(result);

assert.deepStrictEqual(Object.keys(payload).sort(),
  ['counts', 'rates', 'metricNote', 'nonComparable', 'linked', 'unlinked', 'sharedPathHits'].sort());
assert.deepStrictEqual(payload.counts, {
  records: 8,
  comparableRecords: 7,
  linkedRecords: 5,
  candidates: 5,
  unmatchedCandidates: 1
});
assert.deepStrictEqual(payload.rates, { recallAll: 5 / 8, recallComparable: 5 / 7, unmatchedShare: 1 / 5 });
assert.match(payload.metricNote, /path overlap is a proxy and may link distinct lessons/i);
assert.match(payload.metricNote, /recall \(all\) = linked records \/ all records/i);
assert.match(payload.metricNote, /recall \(comparable\) = linked records \/ comparable records/i);
assert.deepStrictEqual(payload.nonComparable, ['E-0004']);
assert.deepStrictEqual(payload.linked, [
  { id: 'E-0001', candidateIds: ['candidate-exact'] },
  { id: 'E-0002', candidateIds: ['candidate-child'] },
  { id: 'E-0005', candidateIds: ['candidate-shared'] },
  { id: 'E-0006', candidateIds: ['candidate-shared'] },
  { id: 'E-0008', candidateIds: ['candidate-parent'] }
]);
assert.deepStrictEqual(payload.unlinked, ['E-0003', 'E-0004', 'E-0007'],
  'a/bc.js does not match the directory a/b at a segment boundary');
assert.deepStrictEqual(payload.sharedPathHits, [{
  site: 'shared/file.js',
  recordIds: ['E-0005', 'E-0006'],
  candidateIds: ['candidate-shared']
}]);
assert.ok(!result.stdout.includes('PRIVATE_RECORD_BODY_') && !result.stdout.includes('PRIVATE_CANDIDATE_TITLE_') &&
  !result.stdout.includes('PRIVATE_MEMORY_SOURCE_TITLE'), 'output contains ids and counts, not record bodies or memory titles');
assert.deepStrictEqual(snapshot(fixture.ledger), ledgerBefore, 'the fixture ledger is byte-identical after a run');
assert.deepStrictEqual(fs.readFileSync(fixture.report), reportBefore, 'the scan report is byte-identical after a run');

const markdown = run(fixture);
assert.strictEqual(markdown.status, 0, `Markdown output failed: ${markdown.stderr}`);
assert.match(markdown.stdout, /^Path overlap is a proxy/i);
assert.match(markdown.stdout, /\n\n\| Metric \| Value \|/);
assert.ok(markdown.stdout.includes('recall (all)') &&
  markdown.stdout.includes('unmatched candidate share (path overlap)'));
assert.match(markdown.stdout, /path overlap is a proxy and may link distinct lessons/i);
assert.match(markdown.stdout, /recall \(all\) = linked records \/ all records/i);
assert.match(markdown.stdout, /recall \(comparable\) = linked records \/ comparable records/i);

const saved = path.join(fixture.root, 'oracle.json');
const savedResult = run(fixture, ['--json', '--out', saved]);
jsonResult(savedResult);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(saved, 'utf8')), payload, '--out saves the JSON output');

const blocked = run(fixture, ['--json', '--out', path.join(fixture.ledger, 'forbidden.json')]);
assert.strictEqual(blocked.status, 2, 'an output path inside the ledger is rejected');
assert.match(blocked.stderr, /inside the ledger directory/);
assert.deepStrictEqual(snapshot(fixture.ledger), ledgerBefore, 'a rejected output path leaves every ledger byte unchanged');
const reportOverwrite = run(fixture, ['--json', '--out', fixture.report]);
assert.strictEqual(reportOverwrite.status, 2, 'the scan report cannot be used as an output path');
assert.deepStrictEqual(fs.readFileSync(fixture.report), reportBefore, 'a rejected output path leaves the scan report unchanged');
const reportHardlink = path.join(fixture.root, 'report-hardlink.json');
try {
  fs.linkSync(fixture.report, reportHardlink);
  const hardlinkOverwrite = run(fixture, ['--json', '--out', reportHardlink]);
  assert.strictEqual(hardlinkOverwrite.status, 2, 'a hard link to the scan report cannot be used as output');
  assert.deepStrictEqual(fs.readFileSync(fixture.report), reportBefore, 'a rejected hard link leaves the scan report unchanged');
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}
const ledgerAlias = path.join(fixture.root, 'errors-alias');
try {
  fs.symlinkSync(fixture.ledger, ledgerAlias, 'dir');
  const aliasOutput = run(fixture, ['--json', '--out', path.join(ledgerAlias, 'forbidden.json')]);
  assert.strictEqual(aliasOutput.status, 2, 'a symlinked path into the ledger is rejected');
  assert.deepStrictEqual(snapshot(fixture.ledger), ledgerBefore, 'a symlinked output cannot write into the ledger');
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}
const danglingAlias = path.join(fixture.root, 'dangling-output');
try {
  fs.symlinkSync(path.join(fixture.ledger, 'new-record.md'), danglingAlias);
  const danglingOutput = run(fixture, ['--json', '--out', danglingAlias]);
  assert.strictEqual(danglingOutput.status, 2, 'a dangling symlink into the ledger is rejected');
  assert.deepStrictEqual(snapshot(fixture.ledger), ledgerBefore, 'a dangling symlink cannot create a ledger file');
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}

const zero = makeFixture('zero-candidates', [
  { id: 'E-0009', sites: ['src/never-linked.js'] }
], []);
const zeroPayload = jsonResult(run(zero, ['--json']));
assert.strictEqual(zeroPayload.rates.unmatchedShare, null, 'unmatched share is null when there are no candidates');
assert.strictEqual(zeroPayload.counts.unmatchedCandidates, 0);
const zeroMarkdown = run(zero);
assert.strictEqual(zeroMarkdown.status, 0, `zero-candidate Markdown output failed: ${zeroMarkdown.stderr}`);
assert.match(zeroMarkdown.stdout, /\| unmatched candidate share \(path overlap\) \| n\/a \|/);

const differentLessons = makeFixture('same-path-different-lessons', [
  { id: 'E-0012', sites: ['shared/ambiguous.js'], lesson: 'Database deadlock handling' }
], [
  { id: 'candidate-different-lesson', sites: ['shared/ambiguous.js'], title: 'CSS formatting only' }
]);
const differentLessonPayload = jsonResult(run(differentLessons, ['--json']));
assert.deepStrictEqual(differentLessonPayload.linked, [
  { id: 'E-0012', candidateIds: ['candidate-different-lesson'] }
], 'same-file candidates link even when their lesson text differs');
assert.strictEqual(differentLessonPayload.rates.unmatchedShare, 0,
  'path overlap alone cannot identify a semantically unrelated candidate');
assert.match(differentLessonPayload.metricNote, /may link distinct lessons/i);

const windows = makeFixture('windows', [
  { id: 'E-0010', sites: ['Src\\Parser.JS'] },
  { id: 'E-0011', sites: ['C:\\repo\\src'] }
], [
  { id: 'candidate-win-case', sites: ['src/parser.js'] },
  { id: 'candidate-other-drive', sites: ['D:/repo/src/file.js'] }
]);
const windowsPayload = jsonResult(run(windows, ['--json', '--platform', 'win32']));
assert.deepStrictEqual(windowsPayload.linked, [
  { id: 'E-0010', candidateIds: ['candidate-win-case'] }
], 'win32 matching ignores case and never treats C: and D: paths as contained');
assert.deepStrictEqual(windowsPayload.nonComparable, ['E-0011']);

// --- I484-labels: opt-in digest-bound labelled evaluation ---

const REPO_SHA = 'd164d2aeab518fb5e90d59b59c0bb868a16d4ce1';
const SCANNER = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'scan.js');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeLabels(file, payload) {
  write(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

// 1. Legacy byte-identity without --labels (exact JSON and Markdown bytes)
const expectedLegacyJson = `${JSON.stringify({
  counts: {
    records: 8,
    comparableRecords: 7,
    linkedRecords: 5,
    candidates: 5,
    unmatchedCandidates: 1
  },
  rates: {
    recallAll: 5 / 8,
    recallComparable: 5 / 7,
    unmatchedShare: 1 / 5
  },
  metricNote: 'Path overlap is a proxy and may link distinct lessons. Both recall rates are path-linked proxies: recall (all) = linked records / all records; recall (comparable) = linked records / comparable records.',
  nonComparable: ['E-0004'],
  linked: [
    { id: 'E-0001', candidateIds: ['candidate-exact'] },
    { id: 'E-0002', candidateIds: ['candidate-child'] },
    { id: 'E-0005', candidateIds: ['candidate-shared'] },
    { id: 'E-0006', candidateIds: ['candidate-shared'] },
    { id: 'E-0008', candidateIds: ['candidate-parent'] }
  ],
  unlinked: ['E-0003', 'E-0004', 'E-0007'],
  sharedPathHits: [{
    site: 'shared/file.js',
    recordIds: ['E-0005', 'E-0006'],
    candidateIds: ['candidate-shared']
  }]
}, null, 2)}\n`;
const expectedLegacyMd = [
  'Path overlap is a proxy and may link distinct lessons. Both recall rates are path-linked proxies: recall (all) = linked records / all records; recall (comparable) = linked records / comparable records.',
  '',
  '| Metric | Value |',
  '| --- | ---: |',
  '| records | 8 |',
  '| comparable records | 7 |',
  '| linked records | 5 |',
  '| candidates | 5 |',
  '| unmatched candidates | 1 |',
  '| recall (all) | 62.5% |',
  '| recall (comparable) | 71.4% |',
  '| unmatched candidate share (path overlap) | 20.0% |',
  ''
].join('\n');
assert.strictEqual(result.stdout, expectedLegacyJson, 'legacy JSON without --labels must remain byte-identical');
assert.strictEqual(markdown.stdout, expectedLegacyMd, 'legacy Markdown without --labels must remain byte-identical');

// 2. Valid --labels with all four outcomes, unlabelled tail, multi-record shared path audit, and privacy sentinel
// On fixture 'main':
// Path-linked pairs: (candidate-exact, E-0001), (candidate-child, E-0002),
//                    (candidate-shared, E-0005), (candidate-shared, E-0006),
//                    (candidate-parent, E-0008)  -> 5 total path pairs
// Labels:
//   candidate-shared   -> true-positive-existing (E-0005): pair E-0005 TRUE, pair E-0006 FALSE
//   candidate-child    -> true-positive-new:               pair E-0002 FALSE
//   candidate-exact    -> false-positive:                  pair E-0001 FALSE
//   candidate-parent   -> uncertain:                       pair E-0008 excluded (uncertainPairs: 1)
//   candidate-boundary -> unlabelled (not path-linked)
// Candidate counts: labelled=4, decided=3, tpE=1, tpN=1, fp=1, uncertain=1, unlabelled=1
// Candidate rates: coverage=4/5, precision=2/3, falsePositiveShare=1/3
// Path pairs: total=5, audited=4, true=1, false=3, uncertain=1, unlabelled=0, falseLinkShare=3/4
const mainLabelsFile = writeLabels(path.join(fixture.root, 'labels.json'), {
  schemaVersion: 1,
  reportSha256: sha256File(fixture.report),
  repoSha: REPO_SHA,
  labels: [
    { candidateId: 'candidate-shared', outcome: 'true-positive-existing', linkedRecordId: 'E-0005', note: 'PRIVATE_LABEL_NOTE_SENTINEL_1' },
    { candidateId: 'candidate-child', outcome: 'true-positive-new', note: 'PRIVATE_LABEL_NOTE_SENTINEL_2' },
    { candidateId: 'candidate-exact', outcome: 'false-positive', note: 'PRIVATE_LABEL_NOTE_SENTINEL_3' },
    { candidateId: 'candidate-parent', outcome: 'uncertain', note: 'PRIVATE_LABEL_NOTE_SENTINEL_4' }
  ]
});
const mainLabelsBefore = fs.readFileSync(mainLabelsFile);
const labelledJsonRun = run(fixture, ['--labels', mainLabelsFile, '--json']);
const labelledPayload = jsonResult(labelledJsonRun);
assert.deepStrictEqual(labelledPayload.labelled, {
  schemaVersion: 1,
  reportSha256: sha256File(fixture.report),
  repoSha: REPO_SHA,
  counts: {
    labelled: 4,
    decided: 3,
    truePositiveExisting: 1,
    truePositiveNew: 1,
    falsePositive: 1,
    uncertain: 1,
    unlabelled: 1
  },
  rates: {
    coverage: 4 / 5,
    precision: 2 / 3,
    falsePositiveShare: 1 / 3,
    falseLinkShare: 3 / 4
  },
  pathLinkAudit: {
    totalPathPairs: 5,
    auditedPairs: 4,
    truePairs: 1,
    falsePairs: 3,
    uncertainPairs: 1,
    unlabelledPairs: 0,
    falseLinkShare: 3 / 4
  }
});
assert.strictEqual(Object.prototype.hasOwnProperty.call(labelledPayload.labelled, 'labels'), false,
  'raw labels array must not appear in JSON output');
assert.ok(!labelledJsonRun.stdout.includes('PRIVATE_LABEL_NOTE_SENTINEL') &&
  !labelledJsonRun.stdout.includes('PRIVATE_RECORD_BODY_') &&
  !labelledJsonRun.stdout.includes('PRIVATE_CANDIDATE_TITLE_') &&
  !labelledJsonRun.stdout.includes('PRIVATE_MEMORY_SOURCE_TITLE'),
'JSON output must not leak label notes, candidate text, record bodies, or memory refs');

const labelledMdRun = run(fixture, ['--labels', mainLabelsFile]);
assert.strictEqual(labelledMdRun.status, 0, `labelled Markdown failed: ${labelledMdRun.stderr}`);
assert.ok(labelledMdRun.stdout.startsWith(expectedLegacyMd), 'labelled Markdown keeps legacy table intact at top');
assert.match(labelledMdRun.stdout, /\| label coverage \| 80\.0% \|/);
assert.match(labelledMdRun.stdout, /\| candidate precision \(decided candidates\) \| 66\.7% \|/);
assert.match(labelledMdRun.stdout, /\| false-positive share among decided candidates \| 33\.3% \|/);
assert.match(labelledMdRun.stdout, /\| audited path pairs \(decided\) \| 4 \|/);
assert.match(labelledMdRun.stdout, /\| path-link false-link share \(audited pairs\) \| 75\.0% \|/);
assert.ok(!labelledMdRun.stdout.includes('PRIVATE_LABEL_NOTE_SENTINEL') &&
  !labelledMdRun.stdout.includes('PRIVATE_RECORD_BODY_') &&
  !labelledMdRun.stdout.includes('PRIVATE_CANDIDATE_TITLE_') &&
  !labelledMdRun.stdout.includes('PRIVATE_MEMORY_SOURCE_TITLE'),
'Markdown output must not leak label notes, candidate text, record bodies, or memory refs');

// 3. Zero-denominator cases: all uncertain, empty labels, zero candidates, and decided-but-unlinked (auditedPairs === 0)
const allUncertainFile = writeLabels(path.join(fixture.root, 'labels-uncertain.json'), {
  schemaVersion: 1,
  reportSha256: sha256File(fixture.report),
  repoSha: REPO_SHA,
  labels: [{ candidateId: 'candidate-exact', outcome: 'uncertain' }]
});
const allUncertainPayload = jsonResult(run(fixture, ['--labels', allUncertainFile, '--json']));
assert.strictEqual(allUncertainPayload.labelled.rates.coverage, 1 / 5);
assert.strictEqual(allUncertainPayload.labelled.rates.precision, null);
assert.strictEqual(allUncertainPayload.labelled.rates.falsePositiveShare, null);
assert.strictEqual(allUncertainPayload.labelled.rates.falseLinkShare, null);
assert.strictEqual(allUncertainPayload.labelled.pathLinkAudit.auditedPairs, 0);
assert.strictEqual(allUncertainPayload.labelled.pathLinkAudit.uncertainPairs, 1);
assert.strictEqual(allUncertainPayload.labelled.pathLinkAudit.unlabelledPairs, 4);
const allUncertainMd = run(fixture, ['--labels', allUncertainFile]);
assert.strictEqual(allUncertainMd.status, 0);
assert.match(allUncertainMd.stdout, /\| candidate precision \(decided candidates\) \| n\/a \|/);
assert.match(allUncertainMd.stdout, /\| false-positive share among decided candidates \| n\/a \|/);
assert.match(allUncertainMd.stdout, /\| path-link false-link share \(audited pairs\) \| n\/a \|/);

const decidedUnlinkedFile = writeLabels(path.join(fixture.root, 'labels-decided-unlinked.json'), {
  schemaVersion: 1,
  reportSha256: sha256File(fixture.report),
  repoSha: REPO_SHA,
  labels: [{ candidateId: 'candidate-boundary', outcome: 'true-positive-new' }]
});
const decidedUnlinkedPayload = jsonResult(run(fixture, ['--labels', decidedUnlinkedFile, '--json']));
assert.strictEqual(decidedUnlinkedPayload.labelled.rates.precision, 1);
assert.strictEqual(decidedUnlinkedPayload.labelled.rates.falsePositiveShare, 0);
assert.strictEqual(decidedUnlinkedPayload.labelled.pathLinkAudit.auditedPairs, 0);
assert.strictEqual(decidedUnlinkedPayload.labelled.rates.falseLinkShare, null,
  'path-pair denominator is separate from candidate denominator');

const zeroLabelsFile = writeLabels(path.join(zero.root, 'labels-empty.json'), {
  schemaVersion: 1,
  reportSha256: sha256File(zero.report),
  repoSha: REPO_SHA,
  labels: []
});
const zeroLabelledPayload = jsonResult(run(zero, ['--labels', zeroLabelsFile, '--json']));
assert.strictEqual(zeroLabelledPayload.labelled.rates.coverage, null);
assert.strictEqual(zeroLabelledPayload.labelled.rates.precision, null);
assert.strictEqual(zeroLabelledPayload.labelled.rates.falsePositiveShare, null);
assert.strictEqual(zeroLabelledPayload.labelled.rates.falseLinkShare, null);
const zeroLabelledMd = run(zero, ['--labels', zeroLabelsFile]);
assert.strictEqual(zeroLabelledMd.status, 0);
assert.match(zeroLabelledMd.stdout, /\| label coverage \| n\/a \|/);

// 4. Strict validation failures (exit 2, zero mutation to pre-existing --out)
const sentinelOut = path.join(fixture.root, 'preexisting-out.json');
write(sentinelOut, '{"sentinel":"unchanged"}\n');
const sentinelBefore = fs.readFileSync(sentinelOut);

const invalidLabelCases = [
  ['wrong schemaVersion', { schemaVersion: 2, reportSha256: sha256File(fixture.report), repoSha: REPO_SHA, labels: [] }, /schemaVersion/],
  ['stale reportSha256', { schemaVersion: 1, reportSha256: '0'.repeat(64), repoSha: REPO_SHA, labels: [] }, /reportSha256/],
  ['missing repoSha', { schemaVersion: 1, reportSha256: sha256File(fixture.report), labels: [] }, /repoSha/],
  ['invalid repoSha', { schemaVersion: 1, reportSha256: sha256File(fixture.report), repoSha: 'not-a-sha', labels: [] }, /repoSha/],
  ['duplicate candidateId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [
      { candidateId: 'candidate-exact', outcome: 'false-positive' },
      { candidateId: 'candidate-exact', outcome: 'false-positive' }
    ]
  }, /duplicate/i],
  ['unknown candidateId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-does-not-exist', outcome: 'false-positive' }]
  }, /unknown.*candidate/i],
  ['invalid outcome enum', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-exact', outcome: 'true-positive' }]
  }, /outcome/i],
  ['true-positive-existing missing linkedRecordId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-exact', outcome: 'true-positive-existing' }]
  }, /linkedRecordId/],
  ['true-positive-existing unknown linkedRecordId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-exact', outcome: 'true-positive-existing', linkedRecordId: 'E-9999' }]
  }, /linkedRecordId/],
  ['true-positive-new with linkedRecordId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-exact', outcome: 'true-positive-new', linkedRecordId: 'E-0001' }]
  }, /linkedRecordId/],
  ['false-positive with null linkedRecordId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-exact', outcome: 'false-positive', linkedRecordId: null }]
  }, /linkedRecordId/],
  ['uncertain with linkedRecordId', {
    schemaVersion: 1,
    reportSha256: sha256File(fixture.report),
    repoSha: REPO_SHA,
    labels: [{ candidateId: 'candidate-exact', outcome: 'uncertain', linkedRecordId: 'E-0001' }]
  }, /linkedRecordId/]
];

for (let i = 0; i < invalidLabelCases.length; i++) {
  const [name, badPayload, expectedError] = invalidLabelCases[i];
  const badFile = writeLabels(path.join(fixture.root, `bad-labels-${i}.json`), badPayload);
  const badRun = run(fixture, ['--labels', badFile, '--json', '--out', sentinelOut]);
  assert.strictEqual(badRun.status, 2, `invalid case "${name}" must exit 2; got ${badRun.status}`);
  assert.match(badRun.stderr, expectedError, `invalid case "${name}" stderr: ${badRun.stderr}`);
  assert.deepStrictEqual(fs.readFileSync(sentinelOut), sentinelBefore,
    `invalid case "${name}" must not mutate --out`);
}

// 5. Protected --out aliases: --labels direct/symlink/hardlink, --report symlink, ledger file symlink/hardlink
const labelsDirectOut = run(fixture, ['--labels', mainLabelsFile, '--json', '--out', mainLabelsFile]);
assert.strictEqual(labelsDirectOut.status, 2, '--out cannot overwrite --labels');
assert.deepStrictEqual(fs.readFileSync(mainLabelsFile), mainLabelsBefore);

const labelsSymlink = path.join(fixture.root, 'labels-symlink.json');
try {
  fs.symlinkSync(mainLabelsFile, labelsSymlink);
  const res = run(fixture, ['--labels', mainLabelsFile, '--json', '--out', labelsSymlink]);
  assert.strictEqual(res.status, 2, 'symlink to --labels cannot be used as --out');
  assert.deepStrictEqual(fs.readFileSync(mainLabelsFile), mainLabelsBefore);
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}

const labelsHardlink = path.join(fixture.root, 'labels-hardlink.json');
try {
  fs.linkSync(mainLabelsFile, labelsHardlink);
  const res = run(fixture, ['--labels', mainLabelsFile, '--json', '--out', labelsHardlink]);
  assert.strictEqual(res.status, 2, 'hardlink to --labels cannot be used as --out');
  assert.deepStrictEqual(fs.readFileSync(mainLabelsFile), mainLabelsBefore);
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}

const reportSymlink = path.join(fixture.root, 'report-symlink.json');
try {
  fs.symlinkSync(fixture.report, reportSymlink);
  const res = run(fixture, ['--labels', mainLabelsFile, '--json', '--out', reportSymlink]);
  assert.strictEqual(res.status, 2, 'symlink to --report cannot be used as --out');
  assert.deepStrictEqual(fs.readFileSync(fixture.report), reportBefore);
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}

const ledgerFileTarget = path.join(fixture.ledger, 'E-0001-fixture.md');
const ledgerFileSymlink = path.join(fixture.root, 'ledger-file-symlink.md');
try {
  fs.symlinkSync(ledgerFileTarget, ledgerFileSymlink);
  const res = run(fixture, ['--labels', mainLabelsFile, '--json', '--out', ledgerFileSymlink]);
  assert.strictEqual(res.status, 2, 'symlink to a ledger file cannot be used as --out');
  assert.deepStrictEqual(snapshot(fixture.ledger), ledgerBefore);
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}

const ledgerFileHardlink = path.join(fixture.root, 'ledger-file-hardlink.md');
try {
  fs.linkSync(ledgerFileTarget, ledgerFileHardlink);
  const res = run(fixture, ['--labels', mainLabelsFile, '--json', '--out', ledgerFileHardlink]);
  assert.strictEqual(res.status, 2, 'hardlink to a ledger file cannot be used as --out');
  assert.deepStrictEqual(snapshot(fixture.ledger), ledgerBefore);
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
}

// 6. Real scanner-shaped fixture through the CLI (scan.js -> oracle) with same-path wrong-record case and no-label control
const scanRoot = path.join(TMP, 'real-scan-fixture');
const scanRepo = path.join(scanRoot, 'repo');
const scanHome = path.join(scanRoot, 'home');
const scanLedger = path.join(scanRoot, 'errors');
fs.mkdirSync(scanRepo, { recursive: true });
fs.mkdirSync(scanHome, { recursive: true });
fs.mkdirSync(scanLedger, { recursive: true });

function gitExec(repo, args, extraEnv = {}) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: scanHome, USERPROFILE: scanHome, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

gitExec(scanRepo, ['init', '-q']);
const commitFiles = (subject, files, offsetSec) => {
  for (const [rel, content] of Object.entries(files)) write(path.join(scanRepo, rel), content);
  gitExec(scanRepo, ['add', '-A']);
  const date = new Date(Date.parse('2025-01-01T00:00:00Z') + offsetSec * 1000).toISOString();
  gitExec(scanRepo, ['commit', '-q', '-m', subject], {
    GIT_AUTHOR_NAME: 'Oracle Fixture',
    GIT_AUTHOR_EMAIL: 'oracle-fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Oracle Fixture',
    GIT_COMMITTER_EMAIL: 'oracle-fixture@example.invalid',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date
  });
};
commitFiles('feat: init synthetic modules', {
  'src/shared.js': 'module.exports = 1;\n',
  'src/exact.js': 'module.exports = 1;\n',
  'src/unmatched.js': 'module.exports = 1;\n'
}, 0);
commitFiles('fix: first bug on shared and exact', {
  'src/shared.js': 'module.exports = 2;\n',
  'src/exact.js': 'module.exports = 2;\n',
  'src/unmatched.js': 'module.exports = 2;\n'
}, 60);
commitFiles('fix: second bug on shared and exact', {
  'src/shared.js': 'module.exports = 3;\n',
  'src/exact.js': 'module.exports = 3;\n',
  'src/unmatched.js': 'module.exports = 3;\n'
}, 120);
const scanRepoSha = gitExec(scanRepo, ['rev-parse', 'HEAD']);

const scanOutDir = path.join(scanRoot, 'scan-out');
const scanOut = childProcess.spawnSync(process.execPath, [
  SCANNER, '--root', scanRepo, '--out', scanOutDir, '--no-memory', '--hide-ledger', '--home', scanHome, '--json'
], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, HOME: scanHome, USERPROFILE: scanHome }
});
assert.ifError(scanOut.error);
assert.strictEqual(scanOut.status, 0, `real scan.js failed: ${scanOut.stderr}`);
const scanSummary = JSON.parse(scanOut.stdout);
assert.strictEqual(scanSummary.ok, true, 'real scan.js must report ok: true');
const scanReportFile = scanSummary.reportJson;
const parsedScanReport = JSON.parse(fs.readFileSync(scanReportFile, 'utf8'));
const sharedCand = parsedScanReport.candidates.find(c => c.sites.includes('src/shared.js'));
const exactCand = parsedScanReport.candidates.find(c => c.sites.includes('src/exact.js'));
const unmatchedCand = parsedScanReport.candidates.find(c => c.sites.includes('src/unmatched.js'));
assert.ok(sharedCand && exactCand && unmatchedCand, 'real scan.js fixture must emit all three synthetic candidates');

write(path.join(scanLedger, 'E-0001-shared.md'), '---\nid: E-0001\nsites:\n  - "src/shared.js"\n---\n\nPRIVATE_SCAN_BODY_1\n');
write(path.join(scanLedger, 'E-0002-other.md'), '---\nid: E-0002\nsites:\n  - "src/other.js"\n---\n\nPRIVATE_SCAN_BODY_2\n');
write(path.join(scanLedger, 'E-0003-exact.md'), '---\nid: E-0003\nsites:\n  - "src/exact.js"\n---\n\nPRIVATE_SCAN_BODY_3\n');

const scanFixture = { root: scanRoot, ledger: scanLedger, report: scanReportFile };
// No-label control
const scanControlJson = run(scanFixture, ['--json']);
const scanControlPayload = jsonResult(scanControlJson);
assert.deepStrictEqual(Object.keys(scanControlPayload).sort(),
  ['counts', 'rates', 'metricNote', 'nonComparable', 'linked', 'unlinked', 'sharedPathHits'].sort());
const scanControlMd = run(scanFixture);
assert.strictEqual(scanControlMd.status, 0);
assert.ok(!scanControlMd.stdout.includes('Labelled Evaluation'));
const scanControlJsonRepeat = run(scanFixture, ['--json']);
assert.strictEqual(scanControlJsonRepeat.stdout, scanControlJson.stdout, 'no-label control JSON is byte-identical');
const scanControlMdRepeat = run(scanFixture);
assert.strictEqual(scanControlMdRepeat.stdout, scanControlMd.stdout, 'no-label control Markdown is byte-identical');

// Labelled run: sharedCand path-links to E-0001, but is actually E-0002 (same-path wrong-record case!)
const scanLabelsFile = writeLabels(path.join(scanRoot, 'scan-labels.json'), {
  schemaVersion: 1,
  reportSha256: sha256File(scanReportFile),
  repoSha: scanRepoSha,
  labels: [
    { candidateId: sharedCand.id, outcome: 'true-positive-existing', linkedRecordId: 'E-0002', note: 'PRIVATE_SCAN_NOTE' },
    { candidateId: exactCand.id, outcome: 'true-positive-existing', linkedRecordId: 'E-0003' },
    { candidateId: unmatchedCand.id, outcome: 'false-positive' }
  ]
});
const scanLabelledJson = run(scanFixture, ['--labels', scanLabelsFile, '--json']);
const scanLabelledPayload = jsonResult(scanLabelledJson);
assert.strictEqual(scanLabelledPayload.labelled.counts.labelled, 3);
assert.strictEqual(scanLabelledPayload.labelled.counts.decided, 3);
assert.strictEqual(scanLabelledPayload.labelled.counts.truePositiveExisting, 2);
assert.strictEqual(scanLabelledPayload.labelled.counts.falsePositive, 1);
assert.strictEqual(scanLabelledPayload.labelled.rates.precision, 2 / 3);
assert.strictEqual(scanLabelledPayload.labelled.rates.falsePositiveShare, 1 / 3);
assert.deepStrictEqual(scanLabelledPayload.labelled.pathLinkAudit, {
  totalPathPairs: 2,
  auditedPairs: 2,
  truePairs: 1,
  falsePairs: 1,
  uncertainPairs: 0,
  unlabelledPairs: 0,
  falseLinkShare: 1 / 2
});
assert.ok(!scanLabelledJson.stdout.includes('PRIVATE_SCAN_NOTE') && !scanLabelledJson.stdout.includes('PRIVATE_SCAN_BODY_'));

// Exact report-byte SHA-256 sensitivity: adding a single trailing newline invalidates reportSha256
const modifiedReportFile = path.join(scanRoot, 'scan-report-whitespace.json');
fs.writeFileSync(modifiedReportFile, `${fs.readFileSync(scanReportFile, 'utf8')}\n`);
const staleReportRun = run({ root: scanRoot, ledger: scanLedger, report: modifiedReportFile }, ['--labels', scanLabelsFile, '--json']);
assert.strictEqual(staleReportRun.status, 2, 'exact report-byte SHA-256 must fail on 1-byte whitespace change');
assert.match(staleReportRun.stderr, /reportSha256/);

// Malformed JSON labels file fails before mutation
const malformedLabelsFile = path.join(fixture.root, 'malformed-labels.json');
write(malformedLabelsFile, '{ not valid json');
const malformedRun = run(fixture, ['--labels', malformedLabelsFile, '--json', '--out', sentinelOut]);
assert.strictEqual(malformedRun.status, 2, 'malformed JSON labels file must exit 2');
assert.deepStrictEqual(fs.readFileSync(sentinelOut), sentinelBefore, 'malformed JSON labels must not mutate --out');

// --- I485-process-oracle: opt-in process measurement view ---

// 1. Conservative site classification (both sides), exact local-store signature linking,
//    ignoring local.dedupe and generic memory signatures, multi-record signature ambiguity,
//    separate path / unique-signature / union coverage and overlap breakdown.
const procFixture = makeFixture('process-view-core', [
  // Path-only (historical concrete path with parenthetical note)
  { id: 'E-0101', signature: 'sig-path-only', sites: ['parser/parser.js (PR #448 branch; not on main)'] },
  // Path-only with space in plausible repository-relative path
  { id: 'E-0102', signature: 'sig-spaced-path', sites: ['docs/my guide.md'] },
  // Unique-signature only (prose-only site -> path non-comparable)
  { id: 'E-0103', signature: 'git-stash-in-active-worker-worktree', sites: ['coordinator base-control testing (git stash / git stash pop)'] },
  // Both path AND unique-signature (overlap)
  { id: 'E-0104', signature: 'both-channels-sig', sites: ['scripts/shared-both.js'] },
  // Prose-only unlinked (even though a candidate carries the exact same prose string!)
  { id: 'E-0105', signature: 'prose-unlinked', sites: ['F4-I2b report', 'Harness workspace boundary guard'] },
  // Glob-only unlinked (even though a candidate carries the exact same glob string!)
  { id: 'E-0106', signature: 'glob-unlinked', sites: ['.agents/harness-everything/errors/E-*.md', 'src/{a,b}.js', 'src/a?.js', 'src/[ab].js'] }, // portability-lint: allow glob site strings in YAML data, not filesystem paths
  // Ambiguous multi-record signature pair (E-0107 and E-0108 share duplicate-sig)
  { id: 'E-0107', signature: 'duplicate-sig', sites: ['coordinator packet construction (D1 packet)'] },
  { id: 'E-0108', signature: 'duplicate-sig', sites: ['shared git stash stack across worktrees'] },
  // Generic memory signature sentinel (must NOT link to memory or local-store generic signature)
  { id: 'E-0109', signature: 'local-memory-lead', sites: ['coordinator briefing of ledger-writing workers'] },
  // Absolute / UNC / traversal / URL -> path non-comparable
  { id: 'E-0110', signature: 'non-path-forms', sites: ['/abs/file.js', 'C:\\repo\\file.js', '\\\\server\\share\\file.js', '//server/share/file.js', '../outside.js', 'a/../b.js', 'https://example.invalid/a.js'] },
  // Shared path hits (E-0111 and E-0112 both use shared/hit.js)
  { id: 'E-0111', signature: 'shared-path-a', sites: ['shared/hit.js'] },
  { id: 'E-0112', signature: 'shared-path-b', sites: ['shared/hit.js'] }
], [
  // Links E-0101 by path
  { id: 'cand-path-exact', sites: ['./parser/parser.js'], sources: [{ type: 'git', sha: 'a'.repeat(40) }] },
  // Links E-0102 by spaced concrete path
  { id: 'cand-spaced-path', sites: ['docs/my guide.md'], sources: [{ type: 'doc', path: 'docs/my guide.md' }] },
  // Links E-0103 by exact local-store signature (pathless)
  {
    id: 'cand-sig-unique',
    signature: 'git-stash-in-active-worker-worktree',
    sites: [],
    sources: [{ type: 'local-store', kind: 'provisional-lesson', ref: 'p-local-1', destination: 'harness', signature: 'git-stash-in-active-worker-worktree' }],
    local: { evidenceReadiness: 'needs-evidence', occurrenceCount: 0, dedupe: { status: 'none', classIds: [], matchedBy: [], newClassEligible: true } }
  },
  // Links E-0104 by path AND cand-sig-both links E-0104 by signature
  { id: 'cand-both-path', sites: ['scripts/shared-both.js'], sources: [{ type: 'git', sha: 'b'.repeat(40) }] },
  {
    id: 'cand-both-sig',
    signature: 'both-channels-sig',
    sites: [],
    sources: [{ type: 'local-store', kind: 'provisional-lesson', ref: 'p-local-2', destination: 'harness', signature: 'both-channels-sig' }]
  },
  // Same prose & glob strings on candidate side -> must NOT link E-0105 or E-0106
  { id: 'cand-prose-glob', sites: ['F4-I2b report', '.agents/harness-everything/errors/E-*.md'], sources: [{ type: 'doc', path: 'docs/notes.md' }] }, // portability-lint: allow glob site string in report JSON, not filesystem path
  // Local-store candidate with ambiguous signature matching E-0107 and E-0108 -> disclosed, 0 unique-link / union credit
  {
    id: 'cand-sig-ambig',
    signature: 'duplicate-sig',
    sites: [],
    sources: [{ type: 'local-store', kind: 'provisional-lesson', ref: 'p-local-3', destination: 'harness', signature: 'duplicate-sig' }]
  },
  // Local-store candidate with DIFFERENT signature but lying local.dedupe claiming E-0105 -> must NOT link!
  {
    id: 'cand-dedupe-lie',
    signature: 'unrelated-local-sig',
    sites: [],
    sources: [{ type: 'local-store', kind: 'provisional-lesson', ref: 'p-local-4', destination: 'harness', signature: 'unrelated-local-sig' }],
    local: { evidenceReadiness: 'needs-evidence', occurrenceCount: 0, dedupe: { status: 'existing', classIds: ['E-0105'], matchedBy: ['whole-rule'], newClassEligible: false } }
  },
  // Generic memory candidate with signature 'local-memory-lead' -> must NOT link E-0109!
  {
    id: 'cand-generic-memory',
    signature: 'local-memory-lead',
    sites: [],
    sources: [{ type: 'memory', ref: 'local/abc123' }]
  },
  // Non-local-store candidate whose signature matches E-0105 -> must NOT link via signature!
  {
    id: 'cand-git-sig',
    signature: 'prose-unlinked',
    sites: [],
    sources: [{ type: 'git', sha: 'c'.repeat(40) }]
  },
  // Shared path hit linking E-0111 and E-0112
  { id: 'cand-shared-hit', sites: ['shared/hit.js'], sources: [{ type: 'git', sha: 'd'.repeat(40) }] }
]);

const procLedgerBefore = snapshot(procFixture.ledger);
const procReportBefore = fs.readFileSync(procFixture.report);
const procJsonRun = run(procFixture, ['--process-view', '--json']);
const procPayload = jsonResult(procJsonRun);

assert.ok(procPayload.processView, '--process-view must add processView object to JSON output');
const pv = procPayload.processView;
// Total records: 12. Path-comparable: E-0101, E-0102, E-0104, E-0111, E-0112 (5).
// Path-non-comparable: E-0103, E-0105, E-0106, E-0107, E-0108, E-0109, E-0110 (7).
assert.deepStrictEqual(pv.pathNonComparable, ['E-0103', 'E-0105', 'E-0106', 'E-0107', 'E-0108', 'E-0109', 'E-0110']);
assert.strictEqual(pv.counts.records, 12);
assert.strictEqual(pv.counts.pathComparableRecords, 5);
assert.strictEqual(pv.counts.pathNonComparableRecords, 7);
assert.strictEqual(pv.counts.pathLinkedRecords, 5);
assert.strictEqual(pv.counts.uniqueSignatureLinkedRecords, 2);
assert.strictEqual(pv.counts.unionLinkedRecords, 6);

assert.deepStrictEqual(pv.coverage.path, {
  linkedRecords: 5,
  pathComparableDenominator: 5,
  allRecordsDenominator: 12,
  ratePathComparable: 5 / 5,
  rateAll: 5 / 12
});
assert.deepStrictEqual(pv.coverage.uniqueSignature, {
  linkedRecords: 2,
  allRecordsDenominator: 12,
  rateAll: 2 / 12
});
assert.deepStrictEqual(pv.coverage.union, {
  linkedRecords: 6,
  allRecordsDenominator: 12,
  rateAll: 6 / 12
});
assert.deepStrictEqual(pv.breakdown.pathOnlyRecords, ['E-0101', 'E-0102', 'E-0111', 'E-0112']);
assert.deepStrictEqual(pv.breakdown.uniqueSignatureOnlyRecords, ['E-0103']);
assert.deepStrictEqual(pv.breakdown.bothPathAndUniqueSignatureRecords, ['E-0104']);
assert.deepStrictEqual(pv.breakdown.unlinkedRecords, ['E-0105', 'E-0106', 'E-0107', 'E-0108', 'E-0109', 'E-0110']);
assert.deepStrictEqual(pv.ambiguousSignatureMatches, [{
  signature: 'duplicate-sig',
  recordIds: ['E-0107', 'E-0108'],
  candidateIds: ['cand-sig-ambig']
}]);
assert.deepStrictEqual(pv.sharedPathHits, [{
  site: 'shared/hit.js',
  recordIds: ['E-0111', 'E-0112'],
  candidateIds: ['cand-shared-hit']
}]);
assert.strictEqual(pv.breakdown.counts.ambiguousSignatureMatches, 1);
assert.strictEqual(pv.breakdown.counts.ambiguousSignatureRecords, 2);
assert.strictEqual(pv.breakdown.counts.ambiguousSignatureCandidates, 1);
assert.match(pv.metricNote, /structural coverage prox/i);
assert.match(pv.metricNote, /non-comparable/i);
assert.ok(!procJsonRun.stdout.includes('PRIVATE_RECORD_BODY_') &&
  !procJsonRun.stdout.includes('PRIVATE_CANDIDATE_TITLE_') &&
  !procJsonRun.stdout.includes('PRIVATE_MEMORY_SOURCE_TITLE'),
'processView JSON must not leak private record bodies, titles, or memory refs');
assert.deepStrictEqual(snapshot(procFixture.ledger), procLedgerBefore, 'process-view leaves ledger byte-identical');
assert.deepStrictEqual(fs.readFileSync(procFixture.report), procReportBefore, 'process-view leaves report byte-identical');

// Markdown output for --process-view
const procMdRun = run(procFixture, ['--process-view']);
assert.strictEqual(procMdRun.status, 0, `process-view Markdown failed: ${procMdRun.stderr}`);
assert.match(procMdRun.stdout, /## Process View/);
assert.match(procMdRun.stdout, /structural coverage prox/i);
assert.match(procMdRun.stdout, /\| path coverage \(path-comparable\) \| 100\.0% \|/);
assert.match(procMdRun.stdout, /\| path coverage \(all records\) \| 41\.7% \|/);
assert.match(procMdRun.stdout, /\| unique-signature coverage \(all records\) \| 16\.7% \|/);
assert.match(procMdRun.stdout, /\| union coverage \(all records\) \| 50\.0% \|/);
assert.match(procMdRun.stdout, /\| ambiguous signature matches \(unresolved\) \| 1 \|/);
assert.ok(!procMdRun.stdout.includes('PRIVATE_RECORD_BODY_') && !procMdRun.stdout.includes('PRIVATE_CANDIDATE_TITLE_'));

// 2. Zero-denominator cases in --process-view:
//    (a) Prose/glob-only ledger -> pathComparableDenominator === 0 -> ratePathComparable === null / n/a
const proseOnlyFixture = makeFixture('process-view-prose-only', [
  { id: 'E-0201', signature: 'prose-only-sig', sites: ['F4-I2b report'] },
  { id: 'E-0202', signature: 'glob-only-sig', sites: ['.agents/harness-everything/errors/E-*.md'] } // portability-lint: allow glob site string in YAML data, not filesystem path
], []);
const proseOnlyJson = jsonResult(run(proseOnlyFixture, ['--process-view', '--json']));
assert.strictEqual(proseOnlyJson.processView.counts.pathComparableRecords, 0);
assert.strictEqual(proseOnlyJson.processView.coverage.path.ratePathComparable, null);
assert.strictEqual(proseOnlyJson.processView.coverage.path.rateAll, 0);
const proseOnlyMd = run(proseOnlyFixture, ['--process-view']);
assert.strictEqual(proseOnlyMd.status, 0);
assert.match(proseOnlyMd.stdout, /\| path coverage \(path-comparable\) \| n\/a \|/);

//    (b) Empty ledger (0 records) -> all rates null / n/a
const emptyLedgerFixture = makeFixture('process-view-empty-ledger', [], []);
const emptyLedgerJson = jsonResult(run(emptyLedgerFixture, ['--process-view', '--json']));
assert.strictEqual(emptyLedgerJson.processView.coverage.path.ratePathComparable, null);
assert.strictEqual(emptyLedgerJson.processView.coverage.path.rateAll, null);
assert.strictEqual(emptyLedgerJson.processView.coverage.uniqueSignature.rateAll, null);
assert.strictEqual(emptyLedgerJson.processView.coverage.union.rateAll, null);
const emptyLedgerMd = run(emptyLedgerFixture, ['--process-view']);
assert.strictEqual(emptyLedgerMd.status, 0);
assert.match(emptyLedgerMd.stdout, /\| union coverage \(all records\) \| n\/a \|/);
assert.match(emptyLedgerMd.stdout, /\| unique-signature coverage \(all records\) \| n\/a \|/);

// 3. Windows platform normalization control under --process-view
const winProcFixture = makeFixture('process-view-windows', [
  { id: 'E-0301', sites: ['Src\\My Parser.JS'] },
  { id: 'E-0302', sites: ['C:\\repo\\src\\file.js', '\\\\server\\share\\file.js'] }
], [
  { id: 'cand-win-space', sites: ['src/my parser.js'], sources: [{ type: 'git', sha: 'e'.repeat(40) }] },
  { id: 'cand-win-drive', sites: ['D:/repo/src/file.js'], sources: [{ type: 'git', sha: 'f'.repeat(40) }] }
]);
const winProcPayload = jsonResult(run(winProcFixture, ['--process-view', '--platform', 'win32', '--json']));
assert.deepStrictEqual(winProcPayload.processView.pathLinked, [{ id: 'E-0301', candidateIds: ['cand-win-space'] }]);
assert.deepStrictEqual(winProcPayload.processView.pathNonComparable, ['E-0302']);

// 4. Preservation control: --process-view off keeps legacy and #484 outputs byte-identical;
//    --process-view + --labels composes without altering #484 labelled results.
const legacyOffCheck = run(fixture, ['--json']);
assert.strictEqual(legacyOffCheck.stdout, expectedLegacyJson, 'legacy JSON unchanged when --process-view is off');
const labelledOffCheck = run(fixture, ['--labels', mainLabelsFile, '--json']);
assert.strictEqual(labelledOffCheck.stdout, labelledJsonRun.stdout, '#484 labelled JSON unchanged when --process-view is off');
const composedRun = jsonResult(run(fixture, ['--labels', mainLabelsFile, '--process-view', '--json']));
assert.deepStrictEqual(composedRun.labelled, labelledPayload.labelled, '--process-view preserves #484 labelled section');
assert.ok(composedRun.processView, 'composed run includes processView');

// 5. Real scanner-to-oracle local-store controls (pathless positive, different-signature negative, same-signature ambiguity)
const lsRoot = path.join(TMP, 'real-local-store-oracle');
const lsRepo = path.join(lsRoot, 'repo');
const lsHome = path.join(lsRoot, 'home');
const lsStore = path.join(lsRoot, 'store');
const lsLedger = path.join(lsRoot, 'errors');
fs.mkdirSync(lsRepo, { recursive: true });
fs.mkdirSync(lsHome, { recursive: true });
fs.mkdirSync(lsStore, { recursive: true });
fs.mkdirSync(lsLedger, { recursive: true });

function gitLs(args, extraEnv = {}) {
  return childProcess.execFileSync('git', ['-C', lsRepo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: lsHome,
      USERPROFILE: lsHome,
      GIT_AUTHOR_NAME: 'Oracle LS Fixture',
      GIT_AUTHOR_EMAIL: 'oracle-ls@example.invalid',
      GIT_COMMITTER_NAME: 'Oracle LS Fixture',
      GIT_COMMITTER_EMAIL: 'oracle-ls@example.invalid',
      GIT_AUTHOR_DATE: '2026-11-25T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-11-25T12:00:00Z',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
gitLs(['init', '-q']);
write(path.join(lsRepo, 'README.md'), '# Synthetic Local Store Fixture\n');
gitLs(['add', '-A']);
gitLs(['commit', '-q', '-m', 'chore: init local-store fixture']);

const lsEnv = { ...process.env, HARNESS_OBSERVATIONS_DIR: lsStore, HOME: lsHome, USERPROFILE: lsHome };
for (const key of ['HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR', 'HARNESS_SYSTEM_ONE_MODE']) delete lsEnv[key];

const addLsLesson = (provisionalId, signature, subcommand) => {
  const res = localErrors.addProvisionalLesson({
    workspaceRoot: lsRepo,
    destination: 'harness',
    provisionalId,
    signature,
    match: { actions: [{ tool: 'shell', executable: 'git', subcommand }] },
    lesson: `PRIVATE_LS_LESSON_${provisionalId}`,
    cue: `PRIVATE_LS_CUE_${provisionalId}`,
    issueUrl: null
  }, { env: lsEnv });
  assert.ok(['appended', 'duplicate'].includes(res.status), `failed to seed local-store lesson ${provisionalId}: ${res.status}`);
};

// Seed three pathless local-store lessons:
//   1) pathless positive: matches E-0034 by exact signature
//   2) different-signature negative: has a different signature from every ledger record
//   3) same-signature ambiguity: matches BOTH E-0091 and E-0092
addLsLesson('prov-positive-1', 'git-stash-in-active-worker-worktree', 'stash');
addLsLesson('prov-negative-1', 'different-signature-negative', 'push');
addLsLesson('prov-ambig-1', 'ambiguous-process-signature', 'pull');

const lsScanOutDir = path.join(lsRoot, 'scan-out');
const lsScan = childProcess.spawnSync(process.execPath, [
  SCANNER, '--root', lsRepo, '--out', lsScanOutDir, '--no-memory', '--hide-ledger',
  '--source', 'local-store', '--destination', 'harness', '--home', lsHome, '--json'
], { cwd: ROOT, encoding: 'utf8', env: lsEnv });
assert.ifError(lsScan.error);
assert.strictEqual(lsScan.status, 0, `real local-store scan.js failed: ${lsScan.stderr}`);
const lsScanSummary = JSON.parse(lsScan.stdout);
assert.strictEqual(lsScanSummary.ok, true);
const lsReportFile = lsScanSummary.reportJson;

// Ledger with prose-only sites: 1 exact match (E-0034), 1 different-signature target (E-0090), 2 ambiguous-signature records (E-0091, E-0092)
write(path.join(lsLedger, 'E-0034-git-stash.md'), [
  '---', 'id: E-0034', 'signature: git-stash-in-active-worker-worktree',
  'sites:', '  - "coordinator base-control testing (git stash / git stash pop in a worker worktree)"',
  '---', '', 'PRIVATE_LS_LEDGER_BODY_34', ''
].join('\n'));
write(path.join(lsLedger, 'E-0090-other-sig.md'), [
  '---', 'id: E-0090', 'signature: expected-other-signature',
  'sites:', '  - "coordinator packet construction"',
  '---', '', 'PRIVATE_LS_LEDGER_BODY_90', ''
].join('\n'));
write(path.join(lsLedger, 'E-0091-ambig-a.md'), [
  '---', 'id: E-0091', 'signature: ambiguous-process-signature',
  'sites:', '  - "shared coordinator workflow"',
  '---', '', 'PRIVATE_LS_LEDGER_BODY_91', ''
].join('\n'));
write(path.join(lsLedger, 'E-0092-ambig-b.md'), [
  '---', 'id: E-0092', 'signature: ambiguous-process-signature',
  'sites:', '  - "another coordinator workflow"',
  '---', '', 'PRIVATE_LS_LEDGER_BODY_92', ''
].join('\n'));

const lsOracleFixture = { root: lsRoot, ledger: lsLedger, report: lsReportFile };
const lsOracleRun = run(lsOracleFixture, ['--process-view', '--json']);
const lsOraclePayload = jsonResult(lsOracleRun);
const lspv = lsOraclePayload.processView;

assert.strictEqual(lspv.counts.records, 4);
assert.strictEqual(lspv.counts.pathComparableRecords, 0);
assert.strictEqual(lspv.coverage.path.ratePathComparable, null);
assert.strictEqual(lspv.coverage.path.rateAll, 0);
assert.strictEqual(lspv.counts.uniqueSignatureLinkedRecords, 1, 'only E-0034 links uniquely via scanner local-store signature');
assert.strictEqual(lspv.uniqueSignatureLinked.length, 1);
assert.strictEqual(lspv.uniqueSignatureLinked[0].id, 'E-0034');
assert.strictEqual(lspv.uniqueSignatureLinked[0].signature, 'git-stash-in-active-worker-worktree');
assert.strictEqual(lspv.counts.unionLinkedRecords, 1);
assert.strictEqual(lspv.coverage.uniqueSignature.rateAll, 1 / 4);
assert.strictEqual(lspv.coverage.union.rateAll, 1 / 4);
assert.deepStrictEqual(lspv.breakdown.unlinkedRecords, ['E-0090', 'E-0091', 'E-0092']);
assert.strictEqual(lspv.ambiguousSignatureMatches.length, 1);
assert.strictEqual(lspv.ambiguousSignatureMatches[0].signature, 'ambiguous-process-signature');
assert.deepStrictEqual(lspv.ambiguousSignatureMatches[0].recordIds, ['E-0091', 'E-0092']);
assert.strictEqual(lspv.ambiguousSignatureMatches[0].candidateIds.length, 1);
assert.ok(!lsOracleRun.stdout.includes('PRIVATE_LS_LESSON_') &&
  !lsOracleRun.stdout.includes('PRIVATE_LS_CUE_') &&
  !lsOracleRun.stdout.includes('PRIVATE_LS_LEDGER_BODY_') &&
  !lsOracleRun.stdout.includes('prov-positive-1'),
'scanner-to-oracle processView must not leak private local-store text or raw provisional IDs');

try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (error) {
  process.stderr.write(`temporary fixture cleanup failed: ${error.message}\n`);
  process.exitCode = 1;
}

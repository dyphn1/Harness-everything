'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
    const sites = record.sites.map(site => `  - ${JSON.stringify(site)}`).join('\n');
    write(path.join(ledger, `${record.id}-fixture.md`), [
      '---', `id: ${record.id}`, 'sites:', sites, '---',
      '', `PRIVATE_RECORD_BODY_${record.id}`, ''
    ].join('\n'));
  }
  write(report, `${JSON.stringify({
    schemaVersion: 1,
    candidates: candidates.map(candidate => ({
      kind: 'error-candidate',
      id: candidate.id,
      title: candidate.title || `PRIVATE_CANDIDATE_TITLE_${candidate.id}`,
      sites: candidate.sites,
      sources: [{ type: 'memory', title: 'PRIVATE_MEMORY_SOURCE_TITLE' }]
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
  ['counts', 'rates', 'nonComparable', 'linked', 'unlinked', 'sharedPathHits'].sort());
assert.deepStrictEqual(payload.counts, {
  records: 8,
  comparableRecords: 7,
  linkedRecords: 5,
  candidates: 5,
  unmatchedCandidates: 1
});
assert.deepStrictEqual(payload.rates, { recallAll: 5 / 8, recallComparable: 5 / 7, noise: 1 / 5 });
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
assert.match(markdown.stdout, /^\| Metric \| Value \|/);
assert.ok(markdown.stdout.includes('recall (all)') && markdown.stdout.includes('noise'));

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
assert.strictEqual(zeroPayload.rates.noise, null, 'noise is undefined when there are no candidates');
assert.strictEqual(zeroPayload.counts.unmatchedCandidates, 0);

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

try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (error) {
  process.stderr.write(`temporary fixture cleanup failed: ${error.message}\n`);
  process.exitCode = 1;
}

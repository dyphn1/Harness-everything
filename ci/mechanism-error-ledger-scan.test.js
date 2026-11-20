'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isWithin } = require('../error-ledger-bootstrap/scripts/scan');

const ROOT = path.resolve(__dirname, '..');
const SCANNER = path.join(ROOT, 'error-ledger-bootstrap', 'scripts', 'scan.js');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-error-ledger-scan-')));
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const FIXED_DATE = '2024-01-02T03:04:05Z';
const VALID_SOURCE_STATUSES = new Set(['used', 'missing', 'disabled', 'unverified']);

function git(repo, args, env = {}) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function write(repo, relative, text) {
  const file = path.join(repo, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commit(repo, subject, files, seconds) {
  for (const [relative, text] of Object.entries(files)) write(repo, relative, text);
  git(repo, ['add', '-A']);
  const date = new Date(Date.parse(FIXED_DATE) + seconds * 1000).toISOString();
  git(repo, ['commit', '-q', '-m', subject], {
    GIT_AUTHOR_NAME: 'Scanner Fixture',
    GIT_AUTHOR_EMAIL: 'scanner@example.invalid',
    GIT_COMMITTER_NAME: 'Scanner Fixture',
    GIT_COMMITTER_EMAIL: 'scanner@example.invalid',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date
  });
}

function run(args, home, preload = null, extraEnv = {}) {
  const nodeArgs = preload ? ['--require', preload] : [];
  const result = childProcess.spawnSync(process.execPath, [...nodeArgs, SCANNER, ...args, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv }
  });
  assert.ifError(result.error);
  return result;
}

function reportFrom(result, expectedStatus = 0) {
  assert.strictEqual(result.status, expectedStatus,
    `scanner exit ${result.status}; expected ${expectedStatus}; stderr: ${result.stderr}`);
  if (expectedStatus === 0) assert.strictEqual(result.stderr.trim(), '', 'successful scans do not write stderr');
  else assert.match(result.stderr.trim(), /^[^\r\n]+$/, 'failures write one stderr line');
  return JSON.parse(result.stdout);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function candidate(report, site, type) {
  return report.candidates.find(item => item.sites.includes(site) && item.sources.some(source => source.type === type));
}

const repo = path.join(TMP, 'PRIVATE_OPERATOR_SENTINEL-PRIVATE_SLUG_SENTINEL', 'synthetic-harness');
const home = path.join(TMP, 'PRIVATE_OPERATOR_SENTINEL-home');
const slug = path.resolve(repo).replace(/[^a-z0-9]/gi, '-');
const autoMemoryDir = path.join(home, '.claude', 'projects', slug, 'memory');
const autoMemory = path.join(autoMemoryDir, 'lesson-PRIVATE_FILENAME_SENTINEL-auto.md');
const explicitMemory = path.join(home, 'notes', 'lesson-PRIVATE_FILENAME_SENTINEL-explicit.md');
const globalInstructions = path.join(home, '.codex', 'AGENTS.md');
const localInstructions = path.join(repo, 'private-inputs', 'PRIVATE_FILENAME_SENTINEL-instructions.md');
const defaultReports = [];

try {
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Scanner Fixture']);
  git(repo, ['config', 'user.email', 'scanner@example.invalid']);
  git(repo, ['config', 'commit.gpgsign', 'false']);

  commit(repo, 'feat: add parser fixtures', {
    'AGENTS.md': '# Local instructions\n\n## Cue\nThe parser loses a token after a boundary.\n\n## Lesson\nKeep the parser boundary regression covered.\n',
    'private-inputs/PRIVATE_FILENAME_SENTINEL-instructions.md': '# Private local instructions\n\n## Lesson\nUse `src/parser.js` as the example.\n',
    'src/parser.js': 'module.exports = value => value;\n',
    'src/single.js': 'module.exports = true;\n',
    'ci/parser.test.js': "const parser = require('../src/parser.js');\nvoid parser;\n",
    'src/__tests__/parser.test.js': "const parser = require('../parser');\nvoid parser;\n",
    'inside-output/.keep': 'existing target directory\n'
  }, 0);
  commit(repo, 'fix: repair parser on empty input', {
    'src/parser.js': 'module.exports = value => value == null ? "" : value;\n'
  }, 1);
  commit(repo, 'fix(parser): preserve token boundaries', {
    'src/parser.js': 'module.exports = value => String(value ?? "").trim();\n'
  }, 2);
  commit(repo, 'fix: handle one-time edge case', {
    'src/single.js': 'module.exports = false;\n'
  }, 3);
  commit(repo, 'fix: mixed ledger change', {
    'src/parser.js': 'module.exports = value => String(value ?? "").trim().toLowerCase();\n',
    '.agents/harness-everything/errors/E-fixture.md': 'NEVER COPY LEDGER BODY INTO A REPORT\n',
    'docs/error-handling/generated.md': 'GENERATED_LEDGER_COPY_SENTINEL updated\n'
  }, 4);
  commit(repo, 'fix: ledger only change', {
    '.agents/harness-everything/errors/E-fixture.md': 'LEDGER_ONLY_SENTINEL\n',
    '.agents/harness-everything/errors/index.jsonl': '{"generated":true}\n',
    'docs/error-handling/generated.md': 'GENERATED_LEDGER_COPY_SENTINEL\n'
  }, 5);
  commit(repo, 'fix: clarify documentation paths', {
    'guide.md': '# Repeated guide\nFirst correction.\n',
    'docs/reference.json': '{"guide":"First correction"}\n',
    'docs/single.md': '# Single guide\nOne correction.\n'
  }, 6);
  commit(repo, 'revert: restore repeated documentation example', {
    'guide.md': '# Repeated guide\nRestored example.\n',
    'docs/reference.json': '{"guide":"Restored example"}\n'
  }, 7);

  writeFile(autoMemory, [
    '---',
    'type: feedback',
    'title: PRIVATE_TITLE_SENTINEL parser lesson',
    '---',
    `Repository: ${path.basename(repo)}`,
    '## Cue',
    'A parser boundary loses the final token. PRIVATE_RAW_TEXT_SENTINEL',
    '## Lesson',
    'Add a regression for `src/parser.js` and inspect `private/PRIVATE_UNCORROBORATED_SENTINEL.js`.',
    ''
  ].join('\n'));
  writeFile(explicitMemory, [
    '---',
    'type: feedback',
    'title: explicit memory parser lesson',
    '---',
    '## Cue',
    'A parser regression reappears after a cleanup.',
    '## Lesson',
    'Keep checking `src/parser.js`.',
    ''
  ].join('\n'));
  const explicitMemoryDir = path.join(home, 'notes', 'directory-lessons');
  writeFile(path.join(explicitMemoryDir, 'lesson-single.md'), [
    '## Cue',
    'A single edge case returned the wrong state.',
    '## Lesson',
    'Review `src/single.js` before changing its behavior.',
    ''
  ].join('\n'));
  writeFile(globalInstructions, '# Global instruction\n\n## Lesson\nGlobal instruction sentinel must be explicitly selected.\n');
  writeFile(path.join(home, '.claude', 'CLAUDE.md'), '# Other global instruction\n\n## Lesson\nOther global instruction sentinel.\n');

  const statusBefore = git(repo, ['status', '--porcelain']);
  assert.strictEqual(statusBefore, '', 'synthetic target starts clean');

  const defaultResult = run(['--root', repo, '--hide-ledger', '--home', home], home);
  const defaultPayload = reportFrom(defaultResult);
  assert.strictEqual(defaultPayload.ok, true);
  const defaultJson = JSON.parse(fs.readFileSync(defaultPayload.reportJson, 'utf8'));
  const defaultMd = fs.readFileSync(defaultPayload.reportMd, 'utf8');
  assert.strictEqual(defaultPayload.counts.candidates, defaultJson.candidates.length);
  defaultReports.push(path.dirname(defaultPayload.reportJson));
  assert.ok(!inside(repo, defaultPayload.reportJson), 'default JSON report is outside the target');
  assert.ok(!inside(repo, defaultPayload.reportMd), 'default Markdown report is outside the target');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(path.dirname(defaultPayload.reportJson)).mode & 0o777, 0o700,
      'default report directory is private');
  }

  assert.deepStrictEqual(Object.keys(defaultJson).sort(),
    ['candidates', 'generatedAt', 'options', 'root', 'schemaVersion', 'sources'].sort());
  assert.strictEqual(defaultJson.schemaVersion, 1);
  assert.strictEqual(defaultJson.root, path.basename(repo));
  assert.ok(!path.isAbsolute(defaultJson.root));
  assert.ok(defaultJson.generatedAt);
  assert.ok(defaultJson.sources.length > 0);
  assert.ok(defaultJson.sources.every(source => VALID_SOURCE_STATUSES.has(source.status)),
    'all source statuses use the public enum');
  assert.deepStrictEqual(new Set(defaultJson.sources.map(source => source.type)),
    new Set(['git', 'doc', 'tracker', 'memory', 'instruction']));
  assert.strictEqual(defaultJson.sources.find(source => source.type === 'doc').status, 'used');
  assert.strictEqual(defaultJson.sources.find(source => source.type === 'tracker').status, 'missing');
  for (const item of defaultJson.candidates) {
    assert.strictEqual(item.kind, 'error-candidate');
    assert.strictEqual(item.status, 'UNVERIFIED');
    assert.ok(item.domain && item.title && item.signature && item.sources.length);
    assert.ok(item.sites.every(site => !path.posix.isAbsolute(site) && !site.includes('\\') && path.posix.normalize(site) === site),
      'candidate sites are portable root-relative paths');
  }

  const parserLead = candidate(defaultJson, 'src/parser.js', 'git');
  assert.ok(parserLead, 'two or more fix commits create a path lead');
  assert.strictEqual(parserLead.kind, 'error-candidate');
  assert.strictEqual(parserLead.status, 'UNVERIFIED');
  assert.strictEqual(parserLead.domain, 'src');
  assert.match(parserLead.id, /^[a-f0-9]+$/);
  assert.strictEqual(parserLead.sources.filter(source => source.type === 'git').length, 3,
    'distinct fix commits, including the stripped mixed commit path, are listed');
  assert.ok(parserLead.sources.every(source => /^[a-f0-9]{40}$/.test(source.sha) && source.subject));
  assert.ok(!candidate(defaultJson, 'src/single.js', 'git'), 'one fix commit does not create a lead');
  const docLead = candidate(defaultJson, 'guide.md', 'doc');
  assert.ok(docLead, 'two fix/revert commits to one Markdown path create a doc candidate');
  assert.strictEqual(docLead.sources.length, 2);
  assert.ok(docLead.sources.every(source => source.type === 'doc' && source.path === 'guide.md' && /^[a-f0-9]{40}$/.test(source.sha)),
    'doc sources identify their path and commit SHA');
  assert.ok(!candidate(defaultJson, 'guide.md', 'git'), 'documentation history stays separate from code path groups');
  const docsTreeLead = candidate(defaultJson, 'docs/reference.json', 'doc');
  assert.ok(docsTreeLead && docsTreeLead.sources.length === 2, 'repeated paths anywhere under docs are documentation candidates');
  assert.ok(!candidate(defaultJson, 'docs/single.md', 'doc'), 'one fix commit to a Markdown path does not create a doc candidate');
  assert.ok(defaultMd.includes(`guide.md — ${docLead.sources[0].sha}`), 'Markdown reports include each doc path and commit SHA');
  assert.ok(!defaultJson.candidates.some(item => JSON.stringify(item).includes('LEDGER_ONLY_SENTINEL')));
  assert.ok(!defaultJson.candidates.some(item => item.sources.some(source => source.subject === 'fix: ledger only change')));
  assert.ok(!defaultJson.candidates.some(item => item.sites.some(site => site.includes('.agents/harness-everything/errors'))));
  assert.ok(!defaultJson.candidates.some(item => item.sites.some(site => site.startsWith('docs/error-handling/'))));
  assert.ok(!defaultJson.candidates.some(item => JSON.stringify(item).includes('GENERATED_LEDGER_COPY_SENTINEL')));

  assert.ok(parserLead.attachments.some(item => item.type === 'test-link' && item.ref === 'ci/parser.test.js'),
    'test provenance attaches separately');
  assert.ok(parserLead.attachments.some(item => item.type === 'test-link' && item.ref === 'src/__tests__/parser.test.js'),
    'relative imports resolve back to the candidate path');
  assert.ok(defaultJson.candidates.some(item => item.sources.some(source => source.type === 'instruction' && source.ref === 'repo/AGENTS.md')),
    'target-repository instruction provenance remains usable');
  assert.ok(!parserLead.sources.some(source => source.type === 'test-link'),
    'test links are not counted as incidents');
  assert.ok(defaultJson.candidates.every(item => item.sources.length > 0));
  assert.ok(defaultMd.includes(parserLead.id) && defaultMd.includes('UNVERIFIED') && defaultMd.includes('src/parser.js'));
  assert.ok(!defaultMd.includes(repo) && !defaultMd.includes(home), 'Markdown contains no absolute fixture paths');
  assert.ok(defaultMd.includes('hideLedger: true') && defaultMd.includes('noMemory: false'));
  assert.ok(!fs.readFileSync(defaultPayload.reportJson, 'utf8').includes(repo));
  assert.ok(!fs.readFileSync(defaultPayload.reportJson, 'utf8').includes(home));

  const autoSource = defaultJson.sources.find(source => source.type === 'memory' && source.origin === 'auto');
  assert.ok(autoSource && autoSource.verified === true && autoSource.reason,
    'auto-discovered memory records why the slug hint was verified');
  const autoMemoryLead = candidate(defaultJson, 'src/parser.js', 'memory');
  assert.ok(autoMemoryLead, 'verified lesson memory creates a lead');
  assert.deepStrictEqual(autoMemoryLead.sites, ['src/parser.js'], 'private memory sites are limited to files in the target repository');
  assert.strictEqual(autoMemoryLead.title, 'Local memory lead', 'private memory uses a neutral generated title');
  assert.strictEqual(autoMemoryLead.status, 'UNVERIFIED');
  assert.ok(defaultMd.includes(`### ${autoMemoryLead.title}`), 'Markdown keeps the neutral private-source title');
  assert.ok(autoMemoryLead.sources.some(source => source.type === 'memory' && /^local\/[a-f0-9]{64}$/.test(source.ref)),
    'memory candidate provenance uses an opaque local ID');
  assert.match(autoSource.ref, /^local\/[a-f0-9]{64}$/);
  assert.match(autoSource.verificationRef, /^local\/[a-f0-9]{64}$/);
  const privateSentinels = /PRIVATE_(?:OPERATOR|SLUG|FILENAME|TITLE|RAW_TEXT|UNCORROBORATED)_SENTINEL/;
  assert.doesNotMatch(JSON.stringify(defaultJson), privateSentinels,
    'JSON excludes private operator, slug, filename, title, raw-text, and uncorroborated-site sentinels');
  assert.doesNotMatch(defaultMd, privateSentinels,
    'Markdown excludes private operator, slug, filename, title, raw-text, and uncorroborated-site sentinels');
  assert.ok(!defaultJson.candidates.some(item => /global instruction sentinel/i.test(JSON.stringify(item))),
    'global instructions are not discovered automatically');

  const noHidePayload = reportFrom(run(['--root', repo, '--home', home], home));
  defaultReports.push(path.dirname(noHidePayload.reportJson));
  const noHideJson = JSON.parse(fs.readFileSync(noHidePayload.reportJson, 'utf8'));
  assert.ok(candidate(noHideJson, '.agents/harness-everything/errors/E-fixture.md', 'doc'),
    'positive control sees the repeated ledger path when --hide-ledger is absent');
  assert.ok(candidate(noHideJson, 'docs/error-handling/generated.md', 'doc'),
    'positive control sees the generated copy path when --hide-ledger is absent');

  const explicitOut = path.join(TMP, 'explicit-reports');
  const explicitArgs = [
    '--root', repo, '--out', explicitOut, '--hide-ledger', '--home', home,
    '--memory', explicitMemory, '--memory', explicitMemoryDir,
    '--instructions', globalInstructions, '--instructions', localInstructions
  ];
  const explicitPayload = reportFrom(run(explicitArgs, home));
  const explicitJson = JSON.parse(fs.readFileSync(explicitPayload.reportJson, 'utf8'));
  assert.ok(candidate(explicitJson, 'src/parser.js', 'memory'), 'explicit memory paths create candidates');
  assert.ok(candidate(explicitJson, 'src/single.js', 'memory'), 'explicit memory directories create candidates');
  assert.ok(explicitJson.options.memory.every(ref => /^local\/[a-f0-9]{64}$/.test(ref)),
    'explicit memory input summaries use opaque local IDs');
  assert.ok(explicitJson.options.instructions.every(ref => /^local\/[a-f0-9]{64}$/.test(ref)),
    'explicit instruction input summaries use opaque local IDs');
  assert.ok(!inside(repo, explicitPayload.reportJson) && !inside(repo, explicitPayload.reportMd),
    'successful explicit output stays outside the target');
  const explicitMemoryRefs = explicitJson.sources
    .filter(source => source.type === 'memory' && source.origin === 'explicit')
    .map(source => source.ref);
  assert.strictEqual(new Set(explicitMemoryRefs).size, explicitMemoryRefs.length,
    'distinct explicit memory inputs retain distinct opaque IDs');
  assert.ok(explicitJson.sources.filter(source => source.type === 'instruction' && source.origin === 'global-explicit')
    .every(source => /^local\/[a-f0-9]{64}$/.test(source.ref)),
  'explicit instruction source status uses opaque local IDs');
  const explicitInstructionCandidates = explicitJson.candidates.filter(item =>
    item.sources.some(source => source.type === 'instruction' && /^local\//.test(source.ref)));
  assert.strictEqual(explicitInstructionCandidates.length, 2, 'both explicit instruction inputs produce local leads');
  assert.ok(explicitInstructionCandidates.every(item => item.title === 'Local instruction lead' &&
    item.sources.every(source => source.type !== 'instruction' || /^local\/[a-f0-9]{64}$/.test(source.ref))),
  'explicit instruction provenance uses opaque local IDs and neutral titles');
  assert.ok(explicitJson.candidates.filter(item => item.sources.some(source => source.type === 'memory'))
    .every(item => item.title === 'Local memory lead'), 'explicit memory candidates use neutral titles');
  assert.ok(!JSON.stringify(explicitJson).includes(home) && !JSON.stringify(explicitJson).includes(repo));
  const explicitMd = fs.readFileSync(explicitPayload.reportMd, 'utf8');
  assert.doesNotMatch(JSON.stringify(explicitJson), privateSentinels,
    'explicit-memory JSON excludes private input sentinels');
  assert.doesNotMatch(explicitMd, privateSentinels,
    'explicit-memory Markdown excludes private input sentinels');
  assert.ok(!explicitMd.includes(home) && !explicitMd.includes(repo));
  assert.ok(!explicitJson.candidates.some(item => /other global instruction sentinel/i.test(JSON.stringify(item))),
    'unselected global instruction files stay ignored');

  const noMemoryOut = path.join(TMP, 'no-memory-reports');
  const noMemoryPayload = reportFrom(run([
    '--root', repo, '--out', noMemoryOut, '--hide-ledger', '--home', home,
    '--memory', explicitMemory, '--instructions', globalInstructions,
    '--instructions', localInstructions, '--no-memory'
  ], home));
  const noMemoryJson = JSON.parse(fs.readFileSync(noMemoryPayload.reportJson, 'utf8'));
  const noMemoryMd = fs.readFileSync(noMemoryPayload.reportMd, 'utf8');
  assert.ok(!noMemoryJson.candidates.some(item => item.sources.some(source => ['memory', 'instruction'].includes(source.type))));
  assert.ok(noMemoryJson.sources.filter(source => ['memory', 'instruction'].includes(source.type))
    .every(source => source.status === 'disabled'), '--no-memory disables memory and all instruction inputs');
  assert.ok(noMemoryJson.options.memory.every(ref => /^local\/[a-f0-9]{64}$/.test(ref)) &&
    noMemoryJson.options.instructions.every(ref => /^local\/[a-f0-9]{64}$/.test(ref)),
  '--no-memory input summaries retain opaque local IDs');
  assert.ok(noMemoryJson.sources.filter(source => ['memory', 'instruction'].includes(source.type) && source.ref)
    .every(source => /^local\/[a-f0-9]{64}$/.test(source.ref)),
  '--no-memory source status retains opaque local IDs');
  assert.doesNotMatch(JSON.stringify(noMemoryJson), privateSentinels, '--no-memory source labels omit private path sentinels');
  assert.doesNotMatch(noMemoryMd, privateSentinels, '--no-memory Markdown omits private path sentinels');

  const trackerFile = path.join(TMP, 'offline-issues.json');
  writeFile(trackerFile, JSON.stringify([
    {
      number: 421,
      title: 'Parser loses token',
      labels: [{ name: 'BUG' }],
      body: 'Regression at src/parser.js; missing/path.js is not in the repository. TRACKER_PRIVATE_BODY_SENTINEL',
      closedAt: null,
      state: 'OPEN'
    },
    {
      number: 422,
      title: 'Add another parser option',
      labels: [{ name: 'enhancement' }],
      body: 'src/parser.js',
      closedAt: null,
      state: 'OPEN'
    },
    {
      number: 423,
      title: 'Fix command documentation',
      labels: [{ name: 'enhancement' }],
      body: 'guide.md',
      closedAt: null,
      state: 'OPEN'
    },
    {
      number: 424,
      title: 'bug: parser issue without a bug label',
      labels: [{ name: 'enhancement' }],
      body: 'src/single.js',
      closedAt: null,
      state: 'OPEN'
    },
    {
      number: 425,
      title: 'Intermittent parser failure',
      labels: [{ name: 'Regression' }],
      body: 'src/parser.js',
      closedAt: null,
      state: 'OPEN'
    },
    {
      number: 426,
      title: 'Flaky parser failure',
      labels: [{ name: 'FlAkE' }],
      body: 'src/parser.js',
      closedAt: null,
      state: 'OPEN'
    }
  ], null, 2));
  const secondTrackerFile = path.join(TMP, 'offline-issues-2.json');
  writeFile(secondTrackerFile, JSON.stringify([{
    number: 427,
    title: 'Another intermittent issue',
    labels: [{ name: 'regression' }],
    body: 'docs/single.md',
    closedAt: null,
    state: 'OPEN'
  }], null, 2));
  const trackerOut = path.join(TMP, 'tracker-reports');
  const trackerPayload = reportFrom(run([
    '--root', repo, '--out', trackerOut, '--hide-ledger', '--home', home,
    '--no-memory', '--tracker', trackerFile, '--tracker', secondTrackerFile
  ], home));
  const trackerJsonText = fs.readFileSync(trackerPayload.reportJson, 'utf8');
  const trackerJson = JSON.parse(trackerJsonText);
  const trackerMd = fs.readFileSync(trackerPayload.reportMd, 'utf8');
  const bugCandidate = candidate(trackerJson, 'src/parser.js', 'tracker');
  assert.ok(bugCandidate, 'a bug-labelled offline issue mentioning an existing path creates a candidate');
  assert.deepStrictEqual(bugCandidate.sites, ['src/parser.js']);
  assert.deepStrictEqual(bugCandidate.sources, [{ type: 'tracker', ref: '#421' }],
    'tracker candidate source exposes only its issue reference');
  assert.ok(candidate(trackerJson, 'guide.md', 'tracker'), 'a fix-prefixed title qualifies without a bug label');
  assert.ok(trackerJson.candidates.some(item => item.sources.some(source => source.type === 'tracker' && source.ref === '#424')),
    'a bug-prefixed title qualifies without a bug label');
  assert.ok(trackerJson.candidates.some(item => item.sources.some(source => source.type === 'tracker' && source.ref === '#425')),
    'regression labels qualify case-insensitively');
  assert.ok(trackerJson.candidates.some(item => item.sources.some(source => source.type === 'tracker' && source.ref === '#426')),
    'flake labels qualify case-insensitively');
  assert.ok(candidate(trackerJson, 'docs/single.md', 'tracker'), 'repeated --tracker options include each offline export');
  assert.strictEqual(trackerJson.sources.filter(source => source.type === 'tracker').length, 2);
  assert.ok(trackerMd.includes('#421'), 'Markdown report includes tracker issue references');
  assert.ok(!trackerJson.candidates.some(item => item.sources.some(source => source.type === 'tracker' && source.ref === '#422')),
    'an unlabelled non-bug issue is ignored');
  assert.strictEqual(trackerJson.sources.find(source => source.type === 'tracker').status, 'used');
  assert.ok(candidate(trackerJson, 'guide.md', 'doc'), '--no-memory leaves docs history enabled');
  assert.ok(!trackerJson.candidates.some(item => item.sources.some(source => ['memory', 'instruction'].includes(source.type))));
  assert.ok(!trackerJsonText.includes('TRACKER_PRIVATE_BODY_SENTINEL') && !trackerMd.includes('TRACKER_PRIVATE_BODY_SENTINEL'),
    'tracker issue bodies never appear in either report');

  const missingTracker = run([
    '--root', repo, '--hide-ledger', '--home', home,
    '--tracker', path.join(TMP, 'missing-issues.json')
  ], home);
  const missingTrackerPayload = reportFrom(missingTracker, 2);
  assert.strictEqual(missingTrackerPayload.ok, false);
  assert.match(missingTrackerPayload.error, /tracker/i);

  const repeatOut = path.join(TMP, 'repeat-reports');
  const repeatPayload = reportFrom(run([
    '--root', repo, '--out', repeatOut, '--hide-ledger', '--home', home
  ], home));
  const repeatJson = JSON.parse(fs.readFileSync(repeatPayload.reportJson, 'utf8'));
  assert.strictEqual(candidate(repeatJson, 'src/parser.js', 'git').id, parserLead.id,
    'candidate id is stable across report runs');
  assert.strictEqual(candidate(repeatJson, 'src/parser.js', 'memory').id, autoMemoryLead.id,
    'private candidate id is stable across report runs');

  writeFile(autoMemory, '---\ntype: feedback\ntitle: unrelated auto memory\n---\n## Cue\nAn unrelated local note.\n## Lesson\nNo repository site is named.\n');
  const unverifiedOut = path.join(TMP, 'unverified-reports');
  const unverifiedPayload = reportFrom(run(['--root', repo, '--out', unverifiedOut, '--hide-ledger', '--home', home], home));
  const unverifiedJson = JSON.parse(fs.readFileSync(unverifiedPayload.reportJson, 'utf8'));
  const unverifiedSource = unverifiedJson.sources.find(source => source.type === 'memory' && source.origin === 'auto');
  assert.strictEqual(unverifiedSource.status, 'unverified');
  assert.strictEqual(unverifiedSource.verified, false);
  assert.ok(unverifiedSource.reason);
  assert.ok(!unverifiedJson.candidates.some(item => item.sources.some(source => source.type === 'memory')),
    'unverified automatic memory is not used');

  const memoryMarker = path.join(path.dirname(autoMemoryDir), 'MEMORY.md');
  writeFile(memoryMarker, '# Memory index\n');
  const markerOut = path.join(TMP, 'memory-marker-reports');
  const markerPayload = reportFrom(run(['--root', repo, '--out', markerOut, '--hide-ledger', '--home', home], home));
  const markerJson = JSON.parse(fs.readFileSync(markerPayload.reportJson, 'utf8'));
  const markerSource = markerJson.sources.find(source => source.type === 'memory' && source.origin === 'auto');
  assert.strictEqual(markerSource.status, 'used');
  assert.strictEqual(markerSource.verified, true);
  assert.match(markerSource.verificationRef, /^local\/[a-f0-9]{64}$/);
  assert.ok(markerSource.reason.includes('memory marker'));
  assert.ok(markerJson.candidates.some(item => item.sources.some(source => source.type === 'memory')),
    'MEMORY.md verifies the hinted directory');
  fs.rmSync(memoryMarker);

  const insideOut = path.join(repo, 'must-not-be-created');
  const insideResult = run(['--root', repo, '--out', insideOut, '--hide-ledger', '--home', home], home);
  const insidePayload = reportFrom(insideResult, 2);
  assert.strictEqual(insidePayload.ok, false);
  assert.match(insidePayload.error, /inside|target|root/i);
  assert.strictEqual(fs.existsSync(insideOut), false, 'direct in-root output refusal writes nothing');

  const symlinkOut = path.join(TMP, 'output-link');
  fs.symlinkSync(path.join(repo, 'inside-output'), symlinkOut, process.platform === 'win32' ? 'junction' : 'dir');
  const symlinkResult = run(['--root', repo, '--out', path.join(symlinkOut, 'child'), '--hide-ledger', '--home', home], home);
  const symlinkPayload = reportFrom(symlinkResult, 2);
  assert.strictEqual(symlinkPayload.ok, false);
  assert.match(symlinkPayload.error, /inside|target|root/i);
  assert.deepStrictEqual(fs.readdirSync(path.join(repo, 'inside-output')), ['.keep'],
    'symlinked in-root output refusal writes nothing');

  const badArgs = reportFrom(run(['--root', repo, '--unknown', 'x', '--home', home], home), 2);
  assert.strictEqual(badArgs.ok, false, 'bad arguments use refusal exit code');

  const fileAsDirectory = path.join(TMP, 'not-a-directory');
  writeFile(fileAsDirectory, 'not a directory\n');
  const internalFailure = reportFrom(run(['--root', repo, '--out', fileAsDirectory, '--home', home], home), 1);
  assert.strictEqual(internalFailure.ok, false, 'internal errors use exit code 1');

  const win32 = path.win32;
  assert.strictEqual(isWithin('C:\\Repo', 'c:\\repo\\src\\file.js', win32), true,
    'Windows containment compares paths case-insensitively');
  assert.strictEqual(isWithin('C:\\Repo', 'D:\\temp\\file.js', win32), false,
    'Windows cross-drive relative paths remain outside');
  assert.strictEqual(isWithin('C:\\Repo', 'C:\\Repo\\..cache\\file.js', win32), true,
    'a child beginning with two dots is still inside');

  assert.strictEqual(git(repo, ['status', '--porcelain']), statusBefore,
    'scanner leaves the target repository unchanged');

  const acceptanceFailures = [];
  const checkAcceptance = (passed, message) => {
    if (!passed) acceptanceFailures.push(message);
  };
  const overflowShim = path.join(TMP, 'git-overflow-preload.js');
  writeFile(overflowShim, [
    "'use strict';",
    "const childProcess = require('node:child_process');",
    "const fs = require('node:fs');",
    'const original = childProcess.execFileSync;',
    'const calls = [];',
    'function save() { fs.writeFileSync(process.env.SCAN_MARKER, JSON.stringify(calls)); }',
    'childProcess.execFileSync = function (file, args, options) {',
    "  const command = file === 'git' ? args[2] : null;",
    "  const call = { command, maxBuffer: options && options.maxBuffer, result: 'ok' };",
    '  if (command === process.env.SCAN_FAIL_COMMAND) {',
    "    call.result = 'failed';",
    '    calls.push(call);',
    '    save();',
    "    const error = new Error('synthetic subprocess failure');",
    "    error.code = process.env.SCAN_FAIL_CODE || 'ENOBUFS';",
    "    error.stdout = Buffer.from('GIT_CAPTURED_OUTPUT_SENTINEL');",
    "    error.stderr = Buffer.from('GIT_CAPTURED_STDERR_SENTINEL');",
    '    throw error;',
    '  }',
    '  const result = original.call(this, file, args, options);',
    '  if (command) { calls.push(call); save(); }',
    '  return result;',
    '};',
    ''
  ].join('\n'));

  for (const scenario of [
    { command: 'log', code: 'ENOBUFS', label: 'log overflow', checkDiagnostic: true },
    { command: 'ls-files', code: 'ENOBUFS', label: 'ls-files overflow', checkDiagnostic: true },
    { command: 'rev-parse', code: 'EIO', label: 'ordinary Git failure', checkDiagnostic: false }
  ]) {
    const output = path.join(TMP, `overflow-${scenario.command}-reports`);
    const marker = path.join(TMP, `overflow-${scenario.command}-calls.json`);
    const result = run([
      '--root', repo, '--out', output, '--hide-ledger', '--no-memory', '--home', home
    ], home, overflowShim, {
      SCAN_FAIL_COMMAND: scenario.command,
      SCAN_FAIL_CODE: scenario.code,
      SCAN_MARKER: marker
    });
    checkAcceptance(result.status !== 0, `${scenario.label}: scanner must exit nonzero`);
    checkAcceptance(!result.stderr.includes('GIT_CAPTURED_') && !result.stdout.includes('GIT_CAPTURED_'),
      `${scenario.label}: captured child output must stay out of diagnostics`);
    checkAcceptance(!fs.existsSync(output), `${scenario.label}: no partial report directory may be created`);

    let failurePayload;
    let calls;
    try {
      failurePayload = JSON.parse(result.stdout);
      calls = JSON.parse(fs.readFileSync(marker, 'utf8'));
    } catch (cause) {
      acceptanceFailures.push(`${scenario.label}: expected failure JSON and subprocess trace (${cause.message})`);
      continue;
    }
    checkAcceptance(failurePayload.ok === false && !failurePayload.reportJson && !failurePayload.reportMd,
      `${scenario.label}: failure must not return a success payload`);
    checkAcceptance(calls.some(call => call.command === scenario.command && call.result === 'failed'),
      `${scenario.label}: injected subprocess failure must reach the real scanner`);
    if (scenario.checkDiagnostic) {
      checkAcceptance(result.stderr.includes(`git ${scenario.command}`) &&
        result.stderr.includes(`${GIT_MAX_BUFFER} bytes`),
      `${scenario.label}: diagnostic must name the Git command and ${GIT_MAX_BUFFER}-byte limit`);
      checkAcceptance(calls.find(call => call.command === scenario.command)?.maxBuffer === GIT_MAX_BUFFER,
        `${scenario.label}: subprocess must receive the configured ${GIT_MAX_BUFFER}-byte limit`);
    } else {
      checkAcceptance(failurePayload.error === 'git rev-parse failed for the target repository',
        'ordinary Git failures must keep the existing diagnostic path');
    }
    if (scenario.command === 'ls-files') {
      checkAcceptance(calls.some(call => call.command === 'log' && call.result === 'ok'),
        'ls-files overflow must occur after history inventory succeeds');
    }
  }

  const largeRepo = path.join(TMP, 'large');
  fs.mkdirSync(largeRepo, { recursive: true });
  git(largeRepo, ['init', '-q']);
  git(largeRepo, ['config', 'user.name', 'Scanner Fixture']);
  git(largeRepo, ['config', 'user.email', 'scanner@example.invalid']);
  git(largeRepo, ['config', 'commit.gpgsign', 'false']);
  const historyFiles = { 'src/repeated.js': 'initial\n' };
  const historyNameSuffix = 'x'.repeat(142);
  for (let i = 0; i < 14000; i++) {
    historyFiles[`history-${String(i).padStart(5, '0')}-${historyNameSuffix}.txt`] = 'history\n';
  }
  commit(largeRepo, 'feat: seed large history', historyFiles, 0);
  commit(largeRepo, 'fix: first repeated change', { 'src/repeated.js': 'first fix\n' }, 1);
  commit(largeRepo, 'fix: second repeated change', { 'src/repeated.js': 'second fix\n' }, 2);
  const history = childProcess.execFileSync('git', [
    '-C', largeRepo, 'log', '-z', '--name-status', '--format=%H%x00%s'
  ], { encoding: 'buffer', maxBuffer: GIT_MAX_BUFFER });
  checkAcceptance(history.length > 2 * 1024 * 1024,
    `large-history fixture must emit more than 2 MiB (measured ${history.length} bytes)`);
  checkAcceptance(history.length < GIT_MAX_BUFFER,
    `large-history fixture must remain below ${GIT_MAX_BUFFER} bytes (measured ${history.length} bytes)`);
  const largeOutput = path.join(TMP, 'large-history-reports');
  const largeResult = run([
    '--root', largeRepo, '--out', largeOutput, '--hide-ledger', '--no-memory', '--home', home
  ], home);
  checkAcceptance(largeResult.status === 0,
    `history larger than 2 MiB must scan successfully; exit=${largeResult.status}, stderr=${largeResult.stderr.trim()}`);
  try {
    const largePayload = JSON.parse(largeResult.stdout);
    checkAcceptance(largePayload.ok === true, 'large-history scan must return a success payload');
    if (largePayload.ok) {
      const largeJson = JSON.parse(fs.readFileSync(largePayload.reportJson, 'utf8'));
      const largeMarkdown = fs.readFileSync(largePayload.reportMd, 'utf8');
      const repeated = candidate(largeJson, 'src/repeated.js', 'git');
      checkAcceptance(largeJson.candidates.length === largePayload.counts.candidates &&
        fs.existsSync(largePayload.reportMd), 'large JSON and Markdown reports must be complete');
      checkAcceptance(Boolean(repeated) && repeated.sources.length === 2,
        'large-history report must retain the repeated-fix candidate and both provenance rows');
      if (repeated) {
        checkAcceptance(repeated.sources.every(source => /^[a-f0-9]{40}$/.test(source.sha) && source.subject),
          'repeated-fix provenance must retain commit SHAs and subjects');
        checkAcceptance(repeated.sources.every(source => largeMarkdown.includes(source.sha)),
          'Markdown report must retain repeated-fix provenance');
      }
    }
  } catch (cause) {
    acceptanceFailures.push(`large-history report must be valid JSON with complete report files (${cause.message})`);
  }
  assert.deepStrictEqual(acceptanceFailures, [], `G3 acceptance failures:\n${acceptanceFailures.join('\n')}`);

  console.log(`Error-ledger scan CLI verified: ${defaultJson.candidates.length} candidates, ${parserLead.sources.length} parser leads; large history ${history.length} bytes.`);
} finally {
  for (const directory of defaultReports) fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
}

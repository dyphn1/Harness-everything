'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-lifecycle.js');
let lifecycle;
try {
  lifecycle = require(modulePath);
} catch (error) {
  helper.check('2ax. lifecycle module is available', false, error.message);
  helper.finish();
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2ax-doc-lifecycle-'));
process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));

console.log('\n[2ax] document lifecycle lint, reference resolution, and index...');

const CONFIG = Object.freeze({
  governed: [
    { path: 'docs/prd/**', role: 'prd' },
    { path: 'docs/adr/**', role: 'adr' },
    { path: 'docs/reference/**', role: 'reference' },
    { path: 'docs/ticket/**', role: 'ticket' },
    { path: 'docs/log/**', role: 'log' },
    { path: 'docs/report/**', role: 'report' }
  ],
  domains: ['GRAPH', 'GRPH', 'IFCE'],
  legacy: ['docs/adr/legacy/**']
});

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.stack ? error.stack : String(error));
  }
}

function workspace(name) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function writeDoc(root, relativePath, frontmatter, body = '') {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = typeof frontmatter === 'string'
    ? frontmatter
    : Object.entries(frontmatter || {}).map(([key, value]) => `${key}: ${yaml(value)}`).join('\n');
  fs.writeFileSync(file, `---\n${header}\n---\n${body}`, 'utf8');
  return file;
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function writeRevisionPrd(root, relativePath, id, body, extra = {}) {
  const frontmatter = {
    id, revision: 1, status: 'effective', drafted_by: 'PRD Draft Author',
    effective_at: '2026-10-17T00:01:00Z', ...extra
  };
  const approval = {
    by: 'Independent PRD Verifier', at: '2026-10-17T00:00:00Z',
    ref: 'https://approvals.example.invalid/2ax', role: 'human', content_digest: ''
  };
  const projection = { ...frontmatter };
  delete projection.status;
  delete projection.effective_at;
  approval.content_digest = `sha256:${crypto.createHash('sha256').update(`${sortedJson(projection)}\n${body}`, 'utf8').digest('hex')}`;
  const values = { ...frontmatter, approval };
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [child, nested] of Object.entries(value)) lines.push(`  ${child}: ${yaml(nested)}`);
    } else lines.push(`${key}: ${yaml(value)}`);
  }
  return writeDoc(root, relativePath, lines.join('\n'), body);
}

function yaml(value) {
  if (Array.isArray(value)) return `[${value.map(item => JSON.stringify(item)).join(', ')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function collect(root, config = CONFIG) {
  return lifecycle.collectDocs(root, config);
}

function lint(root, config = CONFIG, changedPaths) {
  const docs = collect(root, config);
  return lifecycle.lintDocs(docs, config, changedPaths === 'all' ? { all: true } : { changedPaths });
}

function codes(diagnostics) {
  return diagnostics.map(item => item.code);
}

function byCode(diagnostics, code) {
  return diagnostics.filter(item => item.code === code);
}

function roleConfig() {
  return {
    governed: [
      { path: 'docs/prd/**', role: 'prd' },
      { path: 'docs/adr/**', role: 'adr' },
      { path: 'docs/ticket/**', role: 'ticket' },
      { path: 'docs/reference/**', role: 'reference' },
      { path: 'docs/log/**', role: 'log' },
      { path: 'docs/report/**', role: 'report' }
    ],
    domains: ['GRAPH', 'GRPH', 'IFCE'],
    legacy: []
  };
}

function gitAt(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return String(result.stdout || '').trim();
}

function gitBytesAt(root, revision, relativePath) {
  const result = spawnSync('git', ['-C', root, 'show', `${revision}:${relativePath}`], {
    encoding: 'buffer',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
  });
  if (result.status !== 0) throw new Error(`git show ${revision}:${relativePath} failed: ${String(result.stderr || result.stdout)}`);
  return Buffer.from(result.stdout);
}

function legacyHistory(name, {
  frontmatter = { id: 'GRAPH-900', status: 'accepted', aliases: [], supersedes: [] },
  reference = false,
  baseProjectConfig = null,
  baseHostConfig = null
} = {}) {
  const root = workspace(name);
  gitAt(root, ['init', '--quiet']);
  const configPath = path.join(root, 'lifecycle-config.json');
  const projectConfig = baseProjectConfig || { governed: [], domains: CONFIG.domains, legacy: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(projectConfig, null, 2)}\n`, 'utf8');
  const hostManifestPath = path.join(root, '.claude', 'harness-everything', 'manifest.json');
  fs.mkdirSync(path.dirname(hostManifestPath), { recursive: true });
  fs.writeFileSync(hostManifestPath, `${JSON.stringify({ projectDocs: baseHostConfig || {
    governed: [], domains: CONFIG.domains, legacy: ['docs/adr/legacy/**']
  } }, null, 2)}\n`, 'utf8');
  const legacyPath = writeDoc(root, 'docs/adr/legacy/GRAPH-900.md', frontmatter, '# Archived decision\n\nOriginal editorial text.\n');
  if (reference) {
    writeDoc(root, 'docs/adr/current.md', {
      id: 'GRAPH-901', status: 'accepted',
      supersedes: ['legacy:GRAPH-900@docs/adr/legacy/GRAPH-900.md']
    }, 'This decision refers to the archived decision.\n');
  }
  gitAt(root, ['add', '--all']);
  gitAt(root, ['-c', 'user.name=2ax fixture', '-c', 'user.email=2ax@example.invalid', 'commit', '--quiet', '-m', 'trusted legacy base']);
  const base = gitAt(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(configPath, `${JSON.stringify(CONFIG, null, 2)}\n`, 'utf8');
  return { root, base, configPath, legacyPath, legacyRelative: 'docs/adr/legacy/GRAPH-900.md' };
}

function runLegacyLint(root, config, base, mode, changedPath = 'docs/adr/legacy/GRAPH-900.md') {
  const configPath = path.join(root, 'lifecycle-config.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const args = [modulePath, 'lint', '--workspace', root, '--config', configPath];
  if (base) args.push('--base', base);
  if (mode === 'all') args.push('--all');
  else args.push('--changed', changedPath);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (![0, 1].includes(result.status)) throw new Error(`doc-lifecycle exited ${result.status}: ${result.stderr || result.stdout}`);
  return { status: result.status, analysis: JSON.parse(result.stdout) };
}

function legacyModePair(root, config, base, changedPath = 'docs/adr/legacy/GRAPH-900.md') {
  const changed = runLegacyLint(root, config, base, 'changed', changedPath);
  const all = runLegacyLint(root, config, base, 'all', changedPath);
  assert.strictEqual(changed.status, all.status, 'changed/all CLI exit codes must agree');
  assert.deepStrictEqual(changed.analysis.diagnostics, all.analysis.diagnostics, 'changed/all diagnostics must agree');
  assert.deepStrictEqual(changed.analysis.evidence, all.analysis.evidence, 'changed/all evidence must agree');
  return changed.analysis;
}

function legacyAnalysisModePair(root, config, base, configSources, changedPath = 'docs/adr/legacy/GRAPH-900.md') {
  const analyze = mode => lifecycle.analyzeDocs(collect(root, config), config, {
    workspace: root, base, configSources,
    ...(mode === 'all' ? { all: true } : { changedPaths: [changedPath] })
  });
  const changed = analyze('changed');
  const all = analyze('all');
  assert.deepStrictEqual(changed.diagnostics, all.diagnostics, 'changed/all diagnostics must agree');
  assert.deepStrictEqual(changed.evidence, all.evidence, 'changed/all evidence must agree');
  return changed;
}

checkCase('2ax. frontmatter parser supports scalars, inline arrays, and block lists', () => {
  const parsed = lifecycle.parseFrontmatter('---\nid: GRAPH-007\naliases: [GRPH-007, IFCE-002]\nsupersedes:\n  - GRAPH-006\n  - legacy:GRPH-004\n---\n# Body\n');
  assert.strictEqual(parsed.error, null);
  assert.deepStrictEqual(parsed.data, {
    id: 'GRAPH-007',
    aliases: ['GRPH-007', 'IFCE-002'],
    supersedes: ['GRAPH-006', 'legacy:GRPH-004']
  });
  assert.strictEqual(parsed.body, '# Body\n');
  assert.ok(lifecycle.parseFrontmatter('---\nid: [broken\n---\n').error);
  assert.deepStrictEqual(lifecycle.parseFrontmatter('# no frontmatter\n').data, {});
});

checkCase('2ax. frontmatter supports trailing comments and unindented block lists', () => {
  const parsed = lifecycle.parseFrontmatter('---\nid: GRAPH-008 # chosen id\naliases: [GRPH-008] # renamed\nsupersedes:\n- GRAPH-001\n- legacy:GRPH-002\nstatus: proposed\n---\n# Body\n');
  assert.strictEqual(parsed.error, null);
  assert.deepStrictEqual(parsed.data, {
    id: 'GRAPH-008',
    aliases: ['GRPH-008'],
    supersedes: ['GRAPH-001', 'legacy:GRPH-002'],
    status: 'proposed'
  });
  assert.strictEqual(lifecycle.parseFrontmatter('---\nid: "GRAPH-009 # x"\n---\n').data.id, 'GRAPH-009 # x');
  assert.deepStrictEqual(lifecycle.parseFrontmatter('---\naliases: ["a # b", GRPH-002] # trailing\n---\n').data.aliases, ['a # b', 'GRPH-002']);
});

checkCase('2ax. every role accepts its vocabulary and reports missing or invalid status', () => {
  const config = roleConfig();
  const valid = [
    ...['draft', 'approved', 'effective', 'rejected', 'withdrawn'].map((status, index) => [`docs/prd/${index}.md`, { id: `PRD-GRAPH-${String(index + 1).padStart(3, '0')}`, revision: 1, status }]),
    ...['proposed', 'accepted', 'rejected', 'superseded'].map((status, index) => [`docs/adr/${index}.md`, { id: `GRAPH-${String(index + 1).padStart(3, '0')}`, status }]),
    ...['open', 'blocked', 'done', 'withdrawn'].map((status, index) => [`docs/ticket/${index}.md`, { status }]),
    ...['active', 'deprecated'].map((status, index) => [`docs/reference/${index}.md`, { status }]),
    ...['final', 'archived'].map((status, index) => [`docs/log/${index}.md`, { status }]),
    ...['final', 'archived'].map((status, index) => [`docs/report/${index}.md`, { status }])
  ];
  const root = workspace('role-vocabulary');
  for (const [file, fields] of valid) writeDoc(root, file, fields);
  const docs = collect(root, config);
  const diagnostics = lifecycle.lintDocs(docs, config, { all: true });
  assert.ok(!diagnostics.some(item => ['missing-status', 'invalid-status'].includes(item.code)), JSON.stringify(diagnostics));
  const badRoot = workspace('role-status-errors');
  writeDoc(badRoot, 'docs/prd/missing.md', { id: 'PRD-B' });
  writeDoc(badRoot, 'docs/adr/invalid.md', { id: 'GRAPH-002', status: 'active' });
  writeDoc(badRoot, 'docs/ticket/missing.md', { id: 'TICKET-002' });
  const bad = lifecycle.lintDocs(collect(badRoot, config), config, { all: true });
  assert.ok(codes(bad).includes('missing-status'));
  assert.ok(codes(bad).includes('invalid-status'));
});

checkCase('2ax. role mismatch and malformed frontmatter are diagnosed', () => {
  const root = workspace('parse-role');
  writeDoc(root, 'docs/adr/mismatch.md', { id: 'GRAPH-003', role: 'prd', status: 'accepted' });
  writeDoc(root, 'docs/prd/broken.md', 'id: [unterminated\nstatus: active');
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(codes(diagnostics).includes('role-mismatch'));
  assert.ok(codes(diagnostics).includes('malformed-frontmatter'));
});

checkCase('2ax. ADR id is required and validates format and declared domain', () => {
  const root = workspace('adr-id-rules');
  writeDoc(root, 'docs/adr/missing.md', { status: 'proposed' });
  writeDoc(root, 'docs/adr/bad-format.md', { id: 'GRAPH-02', status: 'proposed' });
  writeDoc(root, 'docs/adr/unknown-domain.md', { id: 'UNKN-001', status: 'proposed' });
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(codes(diagnostics).includes('missing-id'));
  assert.ok(codes(diagnostics).includes('invalid-id'));
  assert.ok(codes(diagnostics).includes('unknown-domain'));
});

checkCase('2ax. PRD identity and revision are mandatory and duplicate revision pairs are rejected', () => {
  const root = workspace('duplicate-id');
  writeDoc(root, 'docs/prd/no-id.md', { status: 'draft' });
  writeDoc(root, 'docs/prd/one.md', { id: 'PRD-GRPH-001', revision: 1, status: 'draft' });
  writeDoc(root, 'docs/prd/two.md', { id: 'PRD-GRPH-001', revision: 1, status: 'draft' });
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(byCode(diagnostics, 'invalid-prd-id').some(item => item.path === 'docs/prd/no-id.md'));
  assert.ok(byCode(diagnostics, 'invalid-revision').some(item => item.path === 'docs/prd/no-id.md'));
  const duplicates = byCode(diagnostics, 'duplicate-revision');
  assert.deepStrictEqual(duplicates.map(item => item.path), ['docs/prd/one.md', 'docs/prd/two.md']);
  assert.deepStrictEqual(duplicates.map(item => item.candidates), [['docs/prd/two.md'], ['docs/prd/one.md']]);
});

checkCase('2ax. REQ definitions, aliases, duplicate definitions, and missing REQ references', () => {
  const root = workspace('requirements');
  writeRevisionPrd(root, 'docs/prd/active.md', 'PRD-GRPH-012', [
    '### REQ-GRAPH-012 (aliases: REQ-GRPH-012, REQ-GRPH-099): Render graph',
    '',
    'See REQ-GRPH-012 and REQ-IFCE-404.',
    'Acceptance: graph output remains visible.',
    '```md',
    'REQ-IFCE-405 is only an example in code.',
    '```',
    ''
  ].join('\n'));
  writeRevisionPrd(root, 'docs/prd/duplicate.md', 'PRD-IFCE-012', '### REQ-GRAPH-012: duplicate\n\nAcceptance: duplicate clause.\n');
  const docs = collect(root, CONFIG);
  const found = lifecycle.lintDocs(docs, CONFIG, { all: true });
  const duplicates = byCode(found, 'duplicate-req');
  assert.deepStrictEqual(duplicates.map(item => item.path), ['docs/prd/active.md', 'docs/prd/duplicate.md']);
  assert.deepStrictEqual(duplicates.map(item => item.candidates), [['docs/prd/duplicate.md'], ['docs/prd/active.md']]);
  assert.ok(codes(found).includes('missing-req'));
  assert.ok(!found.some(item => item.id === 'REQ-IFCE-405'));
  assert.strictEqual(lifecycle.resolveRef(docs, 'REQ-GRPH-099').doc.path, 'docs/prd/active.md');
});

checkCase('2ax. fence closers must match delimiter char and length with only trailing whitespace', () => {
  const root = workspace('fence-closers');
  writeRevisionPrd(root, 'docs/prd/fences.md', 'PRD-GRPH-121', [
    '### REQ-GRAPH-121: real',
    'Acceptance: preserve the rendered graph.',
    '',
    '```md',
    'Plain code line mentioning REQ-GRAPH-140 inline.',
    '```text trailing info is content',
    '```',
    '',
    'Prose after the pseudo-closer sees REQ-GRAPH-141.',
    '~~~md',
    'Plain tilde code mentioning REQ-GRAPH-142.',
    '~~~',
    '',
    '````md',
    'Plain code mentioning REQ-GRAPH-143.',
    '```',
    'Plain outside text mentioning REQ-GRAPH-144.',
    '````'
  ].join('\n'));
  const diagnostics = lint(root, CONFIG, 'all');
  const missing = byCode(diagnostics, 'missing-req').map(item => item.id).sort();
  assert.deepStrictEqual(missing, ['REQ-GRAPH-141'], `fence handling is wrong: ${JSON.stringify(missing)}`);
});

checkCase('2ax. document alias collision with another canonical ID or alias is rejected', () => {
  const root = workspace('alias-collisions');
  writeDoc(root, 'docs/adr/one.md', { id: 'GRAPH-010', status: 'accepted', aliases: ['GRPH-010', 'IFCE-009'] });
  writeDoc(root, 'docs/adr/two.md', { id: 'IFCE-010', status: 'proposed', aliases: ['GRPH-010', 'IFCE-009'] });
  writeDoc(root, 'docs/adr/three.md', { id: 'GRPH-010', status: 'rejected' });
  writeDoc(root, 'docs/adr/invalid-alias.md', { id: 'GRAPH-011', status: 'proposed', aliases: ['legacy:GRAPH-010', 7, 'not-an-id'] });
  const diagnostics = lint(root, CONFIG, 'all');
  const canonicalCollision = byCode(diagnostics, 'alias-collision').filter(item => item.id === 'GRPH-010');
  assert.deepStrictEqual(canonicalCollision.map(item => item.path), ['docs/adr/one.md', 'docs/adr/three.md', 'docs/adr/two.md']);
  assert.deepStrictEqual(canonicalCollision.map(item => item.candidates), [
    ['docs/adr/three.md', 'docs/adr/two.md'],
    ['docs/adr/one.md', 'docs/adr/two.md'],
    ['docs/adr/one.md', 'docs/adr/three.md']
  ]);
  const aliasPair = byCode(diagnostics, 'alias-collision').filter(item => item.id === 'IFCE-009');
  assert.deepStrictEqual(aliasPair.map(item => item.path), ['docs/adr/one.md', 'docs/adr/two.md']);
  assert.deepStrictEqual(aliasPair.map(item => item.candidates), [['docs/adr/two.md'], ['docs/adr/one.md']]);
  assert.ok(codes(diagnostics).includes('invalid-alias'));
});

checkCase('2ax. scalar or null aliases produce invalid-alias and the lint/resolution invariant holds', () => {
  const root = workspace('scalar-aliases');
  writeDoc(root, 'docs/adr/valid.md', { id: 'GRAPH-110', status: 'accepted', aliases: ['GRPH-110'] });
  writeDoc(root, 'docs/adr/scalar.md', { id: 'GRAPH-111', status: 'accepted', aliases: 'GRPH-111' });
  writeDoc(root, 'docs/adr/null.md', { id: 'GRAPH-112', status: 'accepted', aliases: null });
  const diagnostics = lint(root, CONFIG, 'all');
  const flagged = byCode(diagnostics, 'invalid-alias').map(item => item.path).sort();
  assert.deepStrictEqual(flagged, ['docs/adr/null.md', 'docs/adr/scalar.md'], JSON.stringify(diagnostics));
  const docs = collect(root, CONFIG);
  const clean = docs.filter(doc => !flagged.includes(doc.path));
  for (const doc of clean) {
    for (const alias of Array.isArray(doc.frontmatter.aliases) ? doc.frontmatter.aliases : []) {
      const resolved = lifecycle.resolveRef(docs, alias);
      assert.ok(resolved.doc && resolved.doc.path === doc.path, `invariant violated: alias ${alias} of ${doc.path} does not resolve to its declaring document`);
    }
  }
});

checkCase('2ax. historical domain rename through alias is identity only, not supersession', () => {
  const root = workspace('domain-rename');
  writeDoc(root, 'docs/adr/renamed.md', { id: 'GRAPH-007', status: 'accepted', aliases: ['GRPH-007'] });
  const docs = collect(root, CONFIG);
  const index = lifecycle.buildIndex(docs, CONFIG);
  assert.strictEqual(lifecycle.resolveRef(docs, 'GRPH-007').doc.path, 'docs/adr/renamed.md');
  assert.ok(!index.includes('superseded by'));
  assert.ok(!index.includes('GRPH-007 →'));
});

checkCase('2ax. legacy globs take precedence over governed overlap and stay schema-exempt', () => {
  const root = workspace('legacy-overlap');
  const bytes = '---\nid: GRAPH-020\nstatus: INVALID\nrole: report\n---\nold bytes\n';
  const file = path.join(root, 'docs/adr/legacy/GRAPH-020.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const docs = collect(root);
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].legacy, true);
  assert.strictEqual(docs[0].role, 'adr');
  assert.deepStrictEqual(lifecycle.lintDocs(docs, CONFIG, { all: true }), []);
});

checkCase('2ax. trusted base legacy frontmatter stays frozen while body-only editorial fixes remain allowed', () => {
  const unchanged = legacyHistory('legacy-frozen-unchanged');
  const unchangedResult = legacyModePair(unchanged.root, CONFIG, unchanged.base);
  assert.strictEqual(unchangedResult.evidence.immutability, 'observed');
  assert.ok(!unchangedResult.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(unchangedResult.diagnostics));

  const editorial = legacyHistory('legacy-frozen-editorial');
  fs.writeFileSync(editorial.legacyPath,
    '---\nid: GRAPH-900\nstatus: accepted\naliases: []\nsupersedes: []\n---\n# Archived decision\n\nCorrected editorial link: [guide](../guide.md).\n', 'utf8');
  const editorialResult = legacyModePair(editorial.root, CONFIG, editorial.base);
  assert.strictEqual(editorialResult.evidence.immutability, 'observed');
  assert.ok(!editorialResult.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(editorialResult.diagnostics));
});

for (const [key, value] of [
  ['id', 'GRAPH-990'],
  ['status', 'rejected'],
  ['supersedes', ['GRAPH-899']],
  ['aliases', ['GRAPH-899']],
  ['historical_note', 'changed normative metadata']
]) {
  checkCase(`2ax. trusted-base legacy ${key} change is rejected at the archive`, () => {
    const fixture = legacyHistory(`legacy-frozen-${key}`);
    const nextFrontmatter = {
      id: 'GRAPH-900', status: 'accepted', aliases: [], supersedes: [], [key]: value
    };
    writeDoc(fixture.root, fixture.legacyRelative, nextFrontmatter, '# Archived decision\n\nOriginal editorial text.\n');
    const result = legacyModePair(fixture.root, CONFIG, fixture.base);
    const finding = result.diagnostics.find(item => item.code === 'legacy-frozen-modified');
    assert.ok(finding, `${key} edit was accepted: ${JSON.stringify(result.diagnostics)}`);
    assert.strictEqual(finding.severity, 'error');
    assert.strictEqual(finding.path, fixture.legacyRelative);
  });
}

checkCase('2ax. trusted-base legacy frontmatter that no longer parses is rejected', () => {
  const malformed = legacyHistory('legacy-frozen-malformed');
  writeDoc(malformed.root, malformed.legacyRelative, 'id: [broken', '# Archived decision\n');
  const malformedResult = legacyModePair(malformed.root, CONFIG, malformed.base);
  assert.ok(malformedResult.diagnostics.some(item => item.code === 'legacy-frozen-modified' && item.severity === 'error'), JSON.stringify(malformedResult.diagnostics));
});

checkCase('2ax. legacy classification from any trusted config source is retained and current reclassification errors', () => {
  const fixture = legacyHistory('legacy-frozen-reclassified');
  const base = legacyModePair(fixture.root, CONFIG, fixture.base);
  assert.ok(!base.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(base.diagnostics));
  const reclassified = legacyModePair(fixture.root, { ...CONFIG, legacy: [] }, fixture.base);
  const finding = reclassified.diagnostics.find(item => item.code === 'legacy-frozen-modified');
  assert.ok(finding, JSON.stringify(reclassified.diagnostics));
  assert.strictEqual(finding.severity, 'error');
  assert.strictEqual(finding.path, fixture.legacyRelative);
});

checkCase('2ax. legacy freeze preserves each source authority and offsets only its own governed overlap', () => {
  const competing = legacyHistory('legacy-frozen-competing-source', {
    baseProjectConfig: {
      governed: [{ path: 'docs/adr/**', role: 'adr' }], domains: CONFIG.domains, legacy: []
    }
  });
  writeDoc(competing.root, competing.legacyRelative,
    { id: 'GRAPH-999', status: 'accepted', aliases: [], supersedes: [] },
    '# Archived decision\n\nChanged metadata under independent governance.\n');
  const competingResult = legacyModePair(competing.root, CONFIG, competing.base);
  assert.ok(!competingResult.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(competingResult.diagnostics));

  const ownOverlap = legacyHistory('legacy-frozen-own-source-overlap', {
    baseProjectConfig: {
      governed: [{ path: 'docs/adr/**', role: 'adr' }], domains: CONFIG.domains,
      legacy: ['docs/adr/legacy/**']
    }
  });
  writeDoc(ownOverlap.root, ownOverlap.legacyRelative,
    { id: 'GRAPH-999', status: 'accepted', aliases: [], supersedes: [] },
    '# Archived decision\n\nChanged metadata where the same source marks legacy.\n');
  const ownOverlapResult = legacyModePair(ownOverlap.root, CONFIG, ownOverlap.base);
  assert.ok(ownOverlapResult.diagnostics.some(item => item.code === 'legacy-frozen-modified' && item.severity === 'error'), JSON.stringify(ownOverlapResult.diagnostics));
});

checkCase('2ax. candidate legacy reclassification uses the same per-source authority rule', () => {
  const fixture = legacyHistory('legacy-frozen-candidate-competing-source');
  const candidateSources = [
    { governed: [{ path: 'docs/adr/**', role: 'adr' }], legacy: [] },
    { governed: [], legacy: ['docs/adr/legacy/**'] }
  ];
  const result = legacyAnalysisModePair(fixture.root, CONFIG, fixture.base, candidateSources);
  const finding = result.diagnostics.find(item => item.code === 'legacy-frozen-modified');
  assert.ok(finding, JSON.stringify(result.diagnostics));
  assert.match(finding.message, /reclassified outside legacy scope/);
});

checkCase('2ax. offline legacy flags and base config sources match Git legacy-freeze diagnostics', () => {
  const fixture = legacyHistory('legacy-frozen-offline-equivalence', {
    frontmatter: 'id: GRAPH-900\nstatus: accepted\naliases: []\nsupersedes: []\ncustom:\n  owner: alice\n  enabled: true'
  });
  const trustedBytes = gitBytesAt(fixture.root, fixture.base, fixture.legacyRelative);
  writeDoc(fixture.root, fixture.legacyRelative,
    'id: GRAPH-900\nstatus: accepted\naliases: []\nsupersedes: []\ncustom:\n  owner: bob\n  enabled: true',
    '# Archived decision\n\nOriginal editorial text.\n');
  const docs = collect(fixture.root, CONFIG);
  const hostSource = { governed: [], domains: CONFIG.domains, legacy: ['docs/adr/legacy/**'] };
  const candidateSources = [CONFIG, hostSource];
  const fromGit = lifecycle.analyzeDocs(docs, CONFIG, {
    workspace: fixture.root, base: fixture.base, configPath: fixture.configPath,
    configSources: candidateSources, all: true
  });
  const fromInventoryFlag = lifecycle.analyzeDocs(docs, CONFIG, {
    workspace: fixture.root,
    baseInventory: [{ path: fixture.legacyRelative, bytes: trustedBytes, id: 'GRAPH-900', status: 'accepted', legacy: true }],
    configSources: candidateSources,
    all: true
  });
  assert.deepStrictEqual(fromInventoryFlag.diagnostics, fromGit.diagnostics, 'preclassified offline legacy inventory matches the Git-base diagnostics');
  assert.deepStrictEqual(fromInventoryFlag.evidence, fromGit.evidence, 'preclassified offline legacy evidence matches Git');

  const fromInventorySources = lifecycle.analyzeDocs(docs, CONFIG, {
    workspace: fixture.root,
    baseInventory: [{ path: fixture.legacyRelative, bytes: trustedBytes, id: 'GRAPH-900', status: 'accepted' }],
    baseConfigSources: [
      { governed: [], domains: CONFIG.domains, legacy: [] },
      hostSource
    ],
    configSources: candidateSources,
    all: true
  });
  assert.deepStrictEqual(fromInventorySources.diagnostics, fromGit.diagnostics, 'per-source offline base config matches Git-base diagnostics');
  assert.deepStrictEqual(fromInventorySources.evidence, fromGit.evidence, 'per-source offline base evidence matches Git');
});

checkCase('2ax. offline inventory without legacy classification reports legacy immutability not observed', () => {
  const fixture = legacyHistory('legacy-frozen-offline-unclassified', {
    frontmatter: 'id: GRAPH-900\nstatus: accepted\naliases: []\nsupersedes: []\ncustom:\n  owner: alice\n  enabled: true'
  });
  const trustedBytes = gitBytesAt(fixture.root, fixture.base, fixture.legacyRelative);
  writeDoc(fixture.root, fixture.legacyRelative,
    'id: GRAPH-900\nstatus: accepted\naliases: []\nsupersedes: []\ncustom:\n  owner: bob\n  enabled: true',
    '# Archived decision\n\nOriginal editorial text.\n');
  const result = lifecycle.analyzeDocs(collect(fixture.root, CONFIG), CONFIG, {
    workspace: fixture.root,
    baseInventory: [{ path: fixture.legacyRelative, bytes: trustedBytes, id: 'GRAPH-900', status: 'accepted' }],
    configSources: [CONFIG],
    all: true
  });
  assert.strictEqual(result.evidence.immutability, 'observed', 'stored-byte revision immutability remains observed');
  assert.strictEqual(result.evidence.legacyImmutability, 'not-observed', 'missing offline base legacy authority is visible');
  assert.ok(!result.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(result.diagnostics));
});

checkCase('2ax. deleted legacy files rely on explicit path refs and are quiet when unreferenced', () => {
  const referenced = legacyHistory('legacy-frozen-deleted-referenced', { reference: true });
  fs.rmSync(referenced.legacyPath);
  const result = legacyModePair(referenced.root, CONFIG, referenced.base, referenced.legacyRelative);
  const refs = result.diagnostics.filter(item => item.code === 'unresolved-ref');
  assert.ok(refs.some(item => item.severity === 'error' && item.path === 'docs/adr/current.md'), JSON.stringify(result.diagnostics));
  assert.ok(!result.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(result.diagnostics));
  const repeated = legacyModePair(referenced.root, CONFIG, referenced.base, referenced.legacyRelative);
  assert.deepStrictEqual(repeated.diagnostics, result.diagnostics, 'deleted archive escalation is deterministic');

  const unreferenced = legacyHistory('legacy-frozen-deleted-unreferenced');
  fs.rmSync(unreferenced.legacyPath);
  const quiet = legacyModePair(unreferenced.root, CONFIG, unreferenced.base, unreferenced.legacyRelative);
  assert.strictEqual(quiet.evidence.immutability, 'observed');
  assert.ok(!quiet.diagnostics.some(item => item.code === 'legacy-frozen-modified' || item.severity === 'error'), JSON.stringify(quiet.diagnostics));
});

checkCase('2ax. no trusted base reports not-observed without claiming legacy immutability', () => {
  const root = workspace('legacy-frozen-no-base');
  writeDoc(root, 'docs/adr/legacy/GRAPH-900.md', { id: 'GRAPH-999', status: 'rejected', aliases: [], supersedes: [] }, '# Edited archive\n');
  const result = legacyModePair(root, CONFIG, null);
  assert.strictEqual(result.evidence.immutability, 'not-observed');
  assert.ok(!result.diagnostics.some(item => item.code === 'legacy-frozen-modified'), JSON.stringify(result.diagnostics));
});

checkCase('2ax. plain prose mention of a legacy-superseded ID still produces the legacy hint', () => {
  const root = workspace('plain-ref-suppression');
  writeDoc(root, 'docs/adr/new.md', { id: 'GRAPH-211', status: 'accepted', supersedes: ['legacy:GRAPH-210'] }, 'See GRAPH-210.');
  writeDoc(root, 'docs/adr/legacy/GRAPH-210.md', { id: 'GRAPH-210', status: 'accepted' });
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(diagnostics.some(item => item.code === 'unresolved-ref' && /use legacy:GRAPH-210/.test(item.message)),
    `plain ref was suppressed by the legacy edge: ${JSON.stringify(diagnostics)}`);
});

checkCase('2ax. plain resolution uses active canonical IDs and aliases, never legacy-only IDs', () => {
  const root = workspace('active-resolution');
  writeDoc(root, 'docs/adr/active.md', { id: 'GRAPH-021', status: 'accepted', aliases: ['GRPH-021'] }, 'See GRAPH-022.');
  writeDoc(root, 'docs/adr/legacy/GRAPH-022.md', { id: 'GRAPH-022', status: 'accepted' });
  const docs = collect(root);
  assert.strictEqual(lifecycle.resolveRef(docs, 'GRAPH-021').doc.path, 'docs/adr/active.md');
  assert.strictEqual(lifecycle.resolveRef(docs, 'GRPH-021').doc.path, 'docs/adr/active.md');
  assert.strictEqual(lifecycle.resolveRef(docs, 'GRAPH-022').error, 'unresolved-ref');
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(diagnostics.some(item => item.code === 'unresolved-ref' && /legacy:/i.test(item.message)));
});

checkCase('2ax. active alias may equal legacy ID while explicit legacy selector remains separate', () => {
  const root = workspace('alias-equals-legacy');
  writeDoc(root, 'docs/adr/active.md', { id: 'GRAPH-023', status: 'accepted', aliases: ['GRPH-023'] });
  writeDoc(root, 'docs/adr/legacy/old.md', { id: 'GRPH-023', status: 'accepted' });
  const docs = collect(root);
  assert.strictEqual(lifecycle.resolveRef(docs, 'GRPH-023').doc.path, 'docs/adr/active.md');
  assert.strictEqual(lifecycle.resolveRef(docs, 'legacy:GRPH-023').doc.path, 'docs/adr/legacy/old.md');
});

checkCase('2ax. duplicate legacy IDs are ambiguous, path selectors are exact, and malformed selectors fail', () => {
  const root = workspace('legacy-selectors');
  writeDoc(root, 'docs/adr/legacy/v1/old.md', { id: 'GRAPH-024', status: 'accepted' });
  writeDoc(root, 'docs/adr/legacy/v2/old.md', { id: 'GRAPH-024', status: 'accepted' });
  const docs = collect(root);
  const ambiguous = lifecycle.resolveRef(docs, 'legacy:GRAPH-024');
  assert.strictEqual(ambiguous.error, 'ambiguous-legacy-ref');
  assert.deepStrictEqual(ambiguous.candidates.map(item => item.path), ['docs/adr/legacy/v1/old.md', 'docs/adr/legacy/v2/old.md']);
  assert.strictEqual(lifecycle.resolveRef(docs, 'legacy:GRAPH-024@docs/adr/legacy/v2/old.md').doc.path, 'docs/adr/legacy/v2/old.md');
  assert.strictEqual(lifecycle.resolveRef(docs, 'legacy:GRAPH-024@docs/adr/legacy/old.md').error, 'unresolved-ref');
  for (const ref of ['legacy:GRAPH-024@/docs/adr/legacy/v1/old.md', 'legacy:GRAPH-024@../outside.md', 'legacy:GRAPH-024@docs\\adr\\legacy\\v1\\old.md', 'legacy:GRAPH-024@C:/archive.md', 'legacy:GRAPH-024@docs/./adr/old.md']) {
    assert.strictEqual(lifecycle.resolveRef(docs, ref).error, 'invalid-ref', ref);
  }
});

checkCase('2ax. legacy-only plain refs and wrong archive discriminators produce unresolved diagnostics', () => {
  const root = workspace('legacy-unresolved');
  writeDoc(root, 'docs/adr/new.md', { id: 'GRAPH-025', status: 'accepted', supersedes: ['GRAPH-026', 'legacy:GRAPH-026@wrong/path.md'] }, 'See GRAPH-026.');
  writeDoc(root, 'docs/adr/legacy/v1/GRAPH-026.md', { status: 'accepted' });
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(diagnostics.some(item => item.code === 'unresolved-ref' && /legacy:/i.test(item.message)));
  assert.ok(diagnostics.some(item => item.code === 'unresolved-ref' && /wrong\/path\.md/.test(item.message)));
});

checkCase('2ax. changed archive selector paths escalate declaring-doc unresolved refs to error', () => {
  const root = workspace('selector-ratchet');
  writeDoc(root, 'docs/adr/new.md', { id: 'GRAPH-201', status: 'accepted', supersedes: ['legacy:GRPH-200@docs/adr/legacy/old.md'] });
  const docs = collect(root, CONFIG);
  const unchanged = lifecycle.lintDocs(docs, CONFIG, { changedPaths: [] });
  const plainRef = byCode(unchanged, 'unresolved-ref');
  assert.ok(plainRef.length >= 1, JSON.stringify(unchanged));
  assert.ok(plainRef.every(item => item.severity === 'warning'), 'no-baseline ID refs stay declaring-doc scoped');
  const escalated = lifecycle.lintDocs(docs, CONFIG, { changedPaths: ['docs/adr/legacy/old.md'] });
  assert.ok(byCode(escalated, 'unresolved-ref').some(item => item.severity === 'error'), JSON.stringify(escalated));
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(CONFIG), 'utf8');
  const cli = spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', configFile, '--changed', 'docs/adr/legacy/old.md'], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 1, `CLI should exit 1: ${cli.stderr}`);
  const output = JSON.parse(cli.stdout);
  assert.ok(output.diagnostics.some(item => item.code === 'unresolved-ref' && item.severity === 'error'));
  assert.strictEqual(output.evidence.immutability, 'not-observed');
});

checkCase('2ax. active-to-active supersession requires the target to be superseded', () => {
  const root = workspace('supersede-status');
  writeDoc(root, 'docs/adr/new.md', { id: 'GRAPH-031', status: 'accepted', supersedes: ['GRAPH-030'] });
  writeDoc(root, 'docs/adr/old.md', { id: 'GRAPH-030', status: 'accepted' });
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(codes(diagnostics).includes('supersede-status-mismatch'));
});

checkCase('2ax. active-to-legacy supersession projects status without changing archive bytes', () => {
  const root = workspace('legacy-projection');
  writeDoc(root, 'docs/adr/new.md', { id: 'GRAPH-041', status: 'accepted', supersedes: ['legacy:GRAPH-040'] });
  const legacyPath = path.join(root, 'docs/adr/legacy/GRAPH-040.md');
  const oldBytes = '---\nid: GRAPH-040\nstatus: accepted\n---\nFrozen legacy text.\n';
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, oldBytes);
  const docs = collect(root);
  assert.deepStrictEqual(lifecycle.lintDocs(docs, CONFIG, { all: true }), []);
  assert.strictEqual(fs.readFileSync(legacyPath, 'utf8'), oldBytes);
  const index = lifecycle.buildIndex(docs, CONFIG);
  assert.match(index, /stored status: accepted/i);
  assert.match(index, /effective status: superseded/i);
  assert.match(index, /GRAPH-041/);
});

checkCase('2ax. pending supersession edges do not require target status or project status', () => {
  const root = workspace('pending-edges');
  writeDoc(root, 'docs/adr/draft.md', { id: 'GRAPH-051', status: 'proposed', supersedes: ['GRAPH-050'] });
  writeDoc(root, 'docs/adr/target.md', { id: 'GRAPH-050', status: 'accepted' });
  const docs = collect(root);
  const diagnostics = lifecycle.lintDocs(docs, CONFIG, { all: true });
  assert.ok(!codes(diagnostics).includes('supersede-status-mismatch'));
  assert.match(lifecycle.buildIndex(docs, CONFIG), /pending/i);
});

checkCase('2ax. self-supersession and multi-document cycles are errors', () => {
  const root = workspace('supersede-cycles');
  writeDoc(root, 'docs/adr/self.md', { id: 'GRAPH-061', status: 'accepted', supersedes: ['GRAPH-061'] });
  writeDoc(root, 'docs/adr/one.md', { id: 'GRAPH-062', status: 'accepted', supersedes: ['GRAPH-063'] });
  writeDoc(root, 'docs/adr/two.md', { id: 'GRAPH-063', status: 'accepted', supersedes: ['GRAPH-062'] });
  const diagnostics = lint(root, CONFIG, 'all');
  assert.ok(byCode(diagnostics, 'supersede-cycle').length >= 2);
});

checkCase('2ax. cycle severity and candidates are scoped to each strongly connected component', () => {
  const root = workspace('cycle-components');
  writeDoc(root, 'docs/adr/a.md', { id: 'GRAPH-301', status: 'accepted', supersedes: ['GRAPH-302'] });
  writeDoc(root, 'docs/adr/b.md', { id: 'GRAPH-302', status: 'accepted', supersedes: ['GRAPH-301'] });
  writeDoc(root, 'docs/adr/c.md', { id: 'GRAPH-303', status: 'accepted', supersedes: ['GRAPH-304'] });
  writeDoc(root, 'docs/adr/d.md', { id: 'GRAPH-304', status: 'accepted', supersedes: ['GRAPH-303'] });
  const docs = collect(root, CONFIG);
  const diagnostics = lifecycle.lintDocs(docs, CONFIG, { changedPaths: ['docs/adr/a.md'] });
  const cycles = byCode(diagnostics, 'supersede-cycle');
  const severityByPath = Object.fromEntries(cycles.map(item => [item.path, item.severity]));
  assert.strictEqual(severityByPath['docs/adr/a.md'], 'error', JSON.stringify(cycles));
  assert.strictEqual(severityByPath['docs/adr/b.md'], 'error', JSON.stringify(cycles));
  assert.strictEqual(severityByPath['docs/adr/c.md'], 'warning', `component C must keep warning severity: ${JSON.stringify(cycles)}`);
  assert.strictEqual(severityByPath['docs/adr/d.md'], 'warning', `component D must keep warning severity: ${JSON.stringify(cycles)}`);
  const messages = new Set(cycles.map(item => item.message));
  assert.ok([...messages].every(message => !/GRAPH-301[\s\S]*GRAPH-303/.test(message)), `messages must not mix components: ${JSON.stringify([...messages])}`);
  for (const item of cycles) {
    const expected = { 'docs/adr/a.md': ['docs/adr/b.md'], 'docs/adr/b.md': ['docs/adr/a.md'], 'docs/adr/c.md': ['docs/adr/d.md'], 'docs/adr/d.md': ['docs/adr/c.md'] }[item.path];
    assert.deepStrictEqual(item.candidates, expected, `candidates for ${item.path}: ${JSON.stringify(item)}`);
  }
});

checkCase('2ax. recorded conflicts remain unresolved until an effective supersession is recorded', () => {
  const root = workspace('recorded-conflict');
  writeRevisionPrd(root, 'docs/prd/a.md', 'PRD-GRPH-071', '', { conflicts_with: ['GRAPH-071'] });
  writeDoc(root, 'docs/adr/b.md', { id: 'GRAPH-071', status: 'accepted' });
  let docs = collect(root);
  assert.ok(codes(lifecycle.lintDocs(docs, CONFIG, { all: true })).includes('recorded-conflict'));
  writeDoc(root, 'docs/adr/b.md', { id: 'GRAPH-071', status: 'superseded' });
  writeRevisionPrd(root, 'docs/prd/a.md', 'PRD-GRPH-071', '', { conflicts_with: ['GRAPH-071'], supersedes: ['GRAPH-071'] });
  docs = collect(root);
  assert.ok(!codes(lifecycle.lintDocs(docs, CONFIG, { all: true })).includes('recorded-conflict'));
});

checkCase('2ax. pre-migration active PRDs cannot resolve refs, declare REQs, or project conflict retirement', () => {
  const root = workspace('active-prd-not-authoritative');
  writeDoc(root, 'docs/prd/living.md', {
    id: 'PRD-GRPH-071', status: 'active', conflicts_with: ['GRAPH-071'], supersedes: ['GRAPH-071']
  }, '### REQ-GRAPH-071: Mutable requirement\n\nAcceptance: old living text.\n');
  writeDoc(root, 'docs/adr/target.md', { id: 'GRAPH-071', status: 'accepted' });
  writeDoc(root, 'docs/report/consumer.md', { id: 'REPORT-071', status: 'final' }, 'See PRD-GRPH-071 and REQ-GRAPH-071.\n');
  const docs = collect(root, CONFIG);
  assert.strictEqual(lifecycle.resolveRef(docs, 'PRD-GRPH-071').error, 'unresolved-ref');
  assert.strictEqual(lifecycle.resolveRef(docs, 'REQ-GRAPH-071').error, 'unresolved-ref');
  const diagnostics = lifecycle.lintDocs(docs, CONFIG, { all: true });
  assert.ok(codes(diagnostics).includes('recorded-conflict'), JSON.stringify(diagnostics));
  assert.ok(byCode(diagnostics, 'missing-req').some(item => item.id === 'REQ-GRAPH-071'), JSON.stringify(diagnostics));
  const index = lifecycle.buildIndex(docs, CONFIG, { all: true });
  const targetRow = index.split('\n').find(line => line.includes('docs/adr/target.md')) || '';
  assert.ok(!targetRow.includes('superseded by: `PRD-GRPH-071`'), `old living PRD cannot project retirement: ${targetRow}`);
});

checkCase('2ax. ratchet suppresses unchanged schema errors and promotes them when changed', () => {
  const root = workspace('ratchet');
  writeDoc(root, 'docs/adr/old.md', { id: 'BAD', status: 'accepted' });
  const unchanged = lifecycle.lintDocs(collect(root), CONFIG, { changedPaths: [] });
  assert.ok(!unchanged.some(item => item.severity === 'error'));
  const changed = lifecycle.lintDocs(collect(root), CONFIG, { changedPaths: ['docs/adr/old.md'] });
  assert.ok(changed.some(item => item.code === 'invalid-id' && item.severity === 'error'));
  assert.ok(!lifecycle.lintDocs(collect(root), CONFIG, {}).some(item => item.code === 'invalid-id'));
});

checkCase('2ax. cross-file integrity uses warnings until one involved path changes', () => {
  const root = workspace('cross-file-ratchet');
  writeDoc(root, 'docs/adr/one.md', { id: 'GRAPH-081', status: 'accepted' });
  writeDoc(root, 'docs/adr/two.md', { id: 'GRAPH-081', status: 'accepted' });
  const docs = collect(root);
  const unchanged = lifecycle.lintDocs(docs, CONFIG, { changedPaths: [] });
  assert.ok(byCode(unchanged, 'duplicate-id').every(item => item.severity === 'warning'));
  const changed = lifecycle.lintDocs(docs, CONFIG, { changedPaths: ['docs/adr/two.md'] });
  assert.ok(byCode(changed, 'duplicate-id').some(item => item.severity === 'error'));
});

checkCase('2ax. index is deterministic, sorted, and includes resolution-affecting warnings', () => {
  const root = workspace('deterministic-index');
  writeDoc(root, 'docs/adr/z.md', { id: 'IFCE-099', status: 'accepted', supersedes: ['missing:ID'] });
  writeDoc(root, 'docs/adr/a.md', { id: 'GRAPH-099', status: 'accepted' });
  const docs = collect(root);
  const first = lifecycle.buildIndex(docs, CONFIG);
  const second = lifecycle.buildIndex(docs, CONFIG);
  assert.strictEqual(first, second);
  assert.ok(first.indexOf('GRAPH-099') < first.indexOf('IFCE-099'));
  assert.match(first, /unresolved-ref/);
  const ordered = lifecycle.lintDocs(docs, CONFIG, { changedPaths: [] });
  assert.deepStrictEqual(ordered, [...ordered].sort((a, b) =>
    a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || String(a.id || '').localeCompare(String(b.id || '')) || a.message.localeCompare(b.message)));
});

checkCase('2ax. index accepts ratchet modes or precomputed diagnostics and preserves warning labels', () => {
  const root = workspace('index-mode');
  writeDoc(root, 'docs/adr/one.md', { id: 'GRAPH-331', status: 'active' });
  writeDoc(root, 'docs/adr/two.md', { id: 'GRAPH-332', status: 'accepted' });
  writeDoc(root, 'docs/adr/three.md', { id: 'GRAPH-332', status: 'accepted' });
  writeDoc(root, 'docs/prd/wrong-role.md', { id: 'PRD-GRPH-330', status: 'active' });
  const docs = collect(root, CONFIG);
  const indexRatchet = lifecycle.buildIndex(docs, CONFIG, { changedPaths: [] });
  assert.ok(!/invalid-status/.test(indexRatchet), `unchanged schema error leaked into ratcheted index: ${indexRatchet}`);
  assert.ok(!/\(error\)/.test(indexRatchet), `ratcheted index must not show errors: ${indexRatchet}`);
  assert.match(indexRatchet, /`duplicate-id` \(warning\)/, `warnings must stay labelled warning: ${indexRatchet}`);
  const ratchetDiags = lifecycle.lintDocs(docs, CONFIG, { changedPaths: [] });
  const fromPrecomputed = lifecycle.buildIndex(docs, CONFIG, { diagnostics: ratchetDiags });
  assert.strictEqual(fromPrecomputed, indexRatchet, 'precomputed diagnostics must reproduce the same index');
  const changed = lifecycle.lintDocs(docs, CONFIG, { changedPaths: ['docs/adr/one.md'] });
  assert.ok(byCode(changed, 'invalid-status').some(item => item.severity === 'error'), JSON.stringify(changed));
  assert.match(lifecycle.buildIndex(docs, CONFIG, { all: true }), /\(error\)/);
});

checkCase('2ax. CLI requires explicit ratchet mode and exits 0 clean / 1 for errors', () => {
  const root = workspace('cli');
  writeDoc(root, 'docs/adr/clean.md', { id: 'GRAPH-101', status: 'accepted' });
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(CONFIG), 'utf8');
  const cli = modulePath;
  const missingMode = spawnSync(process.execPath, [cli, 'lint', '--workspace', root, '--config', configFile], { encoding: 'utf8' });
  assert.notStrictEqual(missingMode.status, 0);
  const clean = spawnSync(process.execPath, [cli, 'lint', '--workspace', root, '--config', configFile, '--changed', 'docs/adr/clean.md'], { encoding: 'utf8' });
  assert.strictEqual(clean.status, 0, clean.stderr);
  assert.deepStrictEqual(JSON.parse(clean.stdout), { diagnostics: [], evidence: { immutability: 'not-observed' } });
  writeDoc(root, 'docs/adr/bad.md', { id: 'GRAPH-2', status: 'accepted' });
  const bad = spawnSync(process.execPath, [cli, 'lint', '--workspace', root, '--config', configFile, '--all'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  const output = JSON.parse(bad.stdout);
  assert.ok(output.diagnostics.some(item => item.code === 'invalid-id'));
  assert.strictEqual(output.evidence.immutability, 'not-observed');
});

checkCase('2ax dogfood. prose resolver receives whole scoped PRD tokens through the CLI', () => {
  const root = workspace('cli-scoped-prose-reference');
  const firstBody = '### REQ-IFCE-001: First requirement\n\nAcceptance: retain the first requirement.\n';
  const secondBody = '### REQ-IFCE-002: Second requirement\n\nAcceptance: retain the second requirement.\n';
  writeRevisionPrd(root, 'docs/prd/interface/r001.md', 'PRD-IFCE-001', firstBody);
  writeRevisionPrd(root, 'docs/prd/interface/r002.md', 'PRD-IFCE-002', secondBody);
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(CONFIG), 'utf8');
  const reportPath = 'docs/report/interface.md';
  const writeReport = body => writeDoc(root, reportPath, { id: 'GRPH-901', status: 'final' }, body);
  const run = () => spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', configFile, '--all'], { cwd: root, encoding: 'utf8' });

  writeReport('See PRD-IFCE-001#REQ-IFCE-002.\n');
  const wrongUnversioned = run();
  assert.strictEqual(wrongUnversioned.status, 1, `foreign unversioned scoped REQ must fail: ${wrongUnversioned.stdout} ${wrongUnversioned.stderr}`);
  assert.ok(JSON.parse(wrongUnversioned.stdout).diagnostics.some(item => item.code === 'unresolved-ref' && item.id === 'PRD-IFCE-001#REQ-IFCE-002'));

  writeReport('See PRD-IFCE-001#REQ-IFCE-001 and PRD-IFCE-001@r1#REQ-IFCE-001.\n');
  const validOwnRequirements = run();
  assert.strictEqual(validOwnRequirements.status, 0, `unversioned and @r1 same-PRD scopes remain valid: ${validOwnRequirements.stdout} ${validOwnRequirements.stderr}`);
  assert.deepStrictEqual(JSON.parse(validOwnRequirements.stdout).diagnostics, []);

  writeReport('See PRD-IFCE-001@r1#REQ-IFCE-002.\n');
  const wrongVersioned = run();
  assert.strictEqual(wrongVersioned.status, 1, `versioned foreign scope remains rejected: ${wrongVersioned.stdout} ${wrongVersioned.stderr}`);
});

checkCase('2ax dogfood. lifecycle CLI validates explicit configs before collecting documents', () => {
  const root = workspace('cli-config-validation');
  writeDoc(root, 'docs/adr/decision.md', { status: 'accepted' }, 'A decision without an ID.\n');
  const configFile = path.join(root, 'config.json');
  const run = config => {
    fs.writeFileSync(configFile, JSON.stringify(config), 'utf8');
    return spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', configFile, '--all'], { cwd: root, encoding: 'utf8' });
  };
  for (const [name, invalidConfig, code] of [
    ['malformed governed', { governed: 'docs/adr/**' }, 'invalid-governed'],
    ['unknown role', { governed: [{ path: 'docs/adr/**', role: 'adrr' }] }, 'invalid-governed-role']
  ]) {
    const result = run(invalidConfig);
    assert.notStrictEqual(result.status, 0, `${name} config must fail before collection: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /invalid project-docs config/i);
    assert.ok(result.stderr.includes(code), `${name} message identifies ${code}: ${result.stderr}`);
  }
  const valid = run({ governed: [{ path: 'docs/adr/**', role: 'adr' }] });
  assert.strictEqual(valid.status, 1, `valid config reaches document schema checks: ${valid.stdout} ${valid.stderr}`);
  assert.ok(JSON.parse(valid.stdout).diagnostics.some(item => item.code === 'missing-id'));
});

checkCase('2ax dogfood. CLI normalizes --changed spellings and rejects paths outside workspace', () => {
  const root = workspace('cli-changed-path-normalization');
  writeDoc(root, 'docs/adr/GRPH-001.md', { id: 'GRPH-001', status: 'accepted' });
  writeDoc(root, 'docs/adr/GRPH-002.md', { id: 'GRPH-002', status: 'accepted', supersedes: ['GRPH-001'] });
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(CONFIG), 'utf8');
  const run = changedPath => spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', configFile, '--changed', changedPath], { cwd: root, encoding: 'utf8' });
  const expectedError = result => {
    assert.strictEqual(result.status, 1, `changed invalid ADR must remain an error: ${result.stdout} ${result.stderr}`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(item => item.code === 'supersede-status-mismatch' && item.severity === 'error'));
  };
  expectedError(run('docs/adr/GRPH-002.md'));
  expectedError(run('./docs/adr/GRPH-002.md'));
  expectedError(run(path.join(root, 'docs/adr/GRPH-002.md')));
  expectedError(run('docs\\adr\\GRPH-002.md'));
  const unrelated = run('docs/adr/unrelated.md');
  assert.strictEqual(unrelated.status, 0, `unrelated changed path keeps cross-file warning severity: ${unrelated.stdout} ${unrelated.stderr}`);
  assert.ok(JSON.parse(unrelated.stdout).diagnostics.some(item => item.code === 'supersede-status-mismatch' && item.severity === 'warning'));
  const outside = run(path.resolve(root, '..', 'outside-workspace.md'));
  assert.strictEqual(outside.status, 2, `outside path is a usage failure: ${outside.stdout} ${outside.stderr}`);
  assert.match(outside.stderr, /outside .*workspace/i);
});

checkCase('2ax dogfood. repeated --changed-path transports one lossless path per occurrence and keeps legacy --changed', () => {
  const root = workspace('cli-changed-path-option');
  writeDoc(root, 'docs/adr/GRPH-001,extra.md', { status: 'accepted' }, 'Comma filename with missing-id changed-only schema.\n');
  writeDoc(root, 'docs/adr/GRPH-003,extra.md', { id: 'GRPH-003', status: 'accepted' });
  writeDoc(root, 'docs/adr/GRPH-101.md', { id: 'GRPH-101', status: 'accepted' });
  writeDoc(root, 'docs/adr/GRPH-102.md', { status: 'accepted' }, 'Legacy CSV control: invalid changed-only schema.\n');
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(CONFIG), 'utf8');
  const cli = extraArgs => {
    const result = spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', configFile, ...extraArgs], { cwd: root, encoding: 'utf8' });
    assert.ifError(result.error);
    return result;
  };
  const commaInvalid = cli(['--changed-path', 'docs/adr/GRPH-001,extra.md']);
  assert.strictEqual(commaInvalid.status, 1, `--changed-path must run the changed-only schema check on the comma filename: ${commaInvalid.stdout} ${commaInvalid.stderr}`);
  assert.ok(JSON.parse(commaInvalid.stdout).diagnostics.some(item => item.code === 'missing-id' && item.severity === 'error'), commaInvalid.stdout);
  writeDoc(root, 'docs/adr/ GRPH-005.md', { status: 'accepted' }, 'Leading-space basename with missing-id changed-only schema.\n');
  const spaceInvalid = cli(['--changed-path', 'docs/adr/ GRPH-005.md']);
  assert.strictEqual(spaceInvalid.status, 1, `--changed-path must pass the leading-space basename through untrimmed: ${spaceInvalid.stdout} ${spaceInvalid.stderr}`);
  assert.ok(JSON.parse(spaceInvalid.stdout).diagnostics.some(item => item.path === 'docs/adr/ GRPH-005.md' && item.code === 'missing-id' && item.severity === 'error'), spaceInvalid.stdout);
  const commaValid = cli(['--changed-path', 'docs/adr/GRPH-003,extra.md']);
  assert.strictEqual(commaValid.status, 0, `a valid comma-named ADR must pass via --changed-path: ${commaValid.stdout} ${commaValid.stderr}`);
  const csvLegacy = cli(['--changed', 'docs/adr/GRPH-101.md,docs/adr/GRPH-102.md']);
  assert.strictEqual(csvLegacy.status, 1, `legacy comma-separated --changed still checks every listed document: ${csvLegacy.stdout} ${csvLegacy.stderr}`);
  assert.ok(JSON.parse(csvLegacy.stdout).diagnostics.some(item => item.path === 'docs/adr/GRPH-102.md' && item.code === 'missing-id'), 'legacy CSV audits both listed paths');
  const combined = cli(['--changed', 'docs/adr/GRPH-101.md', '--changed-path', 'docs/adr/GRPH-001,extra.md']);
  assert.strictEqual(combined.status, 1, `--changed and --changed-path may be combined: ${combined.stdout} ${combined.stderr}`);
  assert.ok(JSON.parse(combined.stdout).diagnostics.some(item => item.path === 'docs/adr/GRPH-001,extra.md' && item.code === 'missing-id'), 'the combined run audits both the CSV entry and the --changed-path entry');
  const outside = cli(['--changed-path', path.resolve(root, '..', 'outside-workspace.md')]);
  assert.strictEqual(outside.status, 2, `--changed-path outside workspace is a usage failure: ${outside.stdout} ${outside.stderr}`);
  assert.match(outside.stderr, /outside .*workspace/i);
  const withAll = cli(['--all', '--changed-path', 'docs/adr/GRPH-003,extra.md']);
  assert.strictEqual(withAll.status, 2, `--changed-path is mutually exclusive with --all: ${withAll.stdout} ${withAll.stderr}`);
  assert.match(withAll.stderr, /choose either/);
  const missingValue = cli(['--changed-path']);
  assert.strictEqual(missingValue.status, 2, `--changed-path requires a value: ${missingValue.stdout} ${missingValue.stderr}`);
  assert.match(missingValue.stderr, /--changed-path requires a value/);
});

checkCase('2ax dogfood. relative --config resolves from --workspace even when CLI cwd differs', () => {
  const root = workspace('cli-relative-config');
  const configFile = path.join(root, '.agents/harness-everything/project-docs.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(CONFIG), 'utf8');
  writeDoc(root, 'docs/adr/clean.md', { id: 'GRPH-991', status: 'accepted' });
  const result = spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', '.agents/harness-everything/project-docs.json', '--all'], { cwd: tempRoot, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `workspace-relative config should load outside the workspace cwd: ${result.stdout} ${result.stderr}`);
  assert.deepStrictEqual(JSON.parse(result.stdout).diagnostics, []);
});

const EXPECTED_SCENARIOS = Object.freeze([
  'active-to-active',
  'active-to-active-mismatch',
  'active-to-legacy',
  'alias-rename',
  'duplicate-legacy',
  'invalid-refs',
  'pending-edge',
  'recorded-conflict'
]);

function runScenarioSet(scenariosRoot) {
  const problems = [];
  if (!fs.existsSync(scenariosRoot)) return [`scenario tree is missing: ${scenariosRoot}`];
  const scenarios = fs.readdirSync(scenariosRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const expectedName of EXPECTED_SCENARIOS) {
    if (!scenarios.includes(expectedName)) problems.push(`missing scenario: ${expectedName}`);
  }
  for (const name of scenarios) {
    if (!EXPECTED_SCENARIOS.includes(name)) { problems.push(`unexpected scenario: ${name}`); continue; }
    const dir = path.join(scenariosRoot, name);
    if (!fs.existsSync(path.join(dir, 'config.json'))) { problems.push(`${name}: missing config.json`); continue; }
    if (!fs.existsSync(path.join(dir, 'expected.json'))) { problems.push(`${name}: missing expected.json`); continue; }
    try {
      const configFile = path.join(dir, 'config.json');
      const expectedFile = path.join(dir, 'expected.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
      const root = path.join(tempRoot, `scenario-${path.basename(scenariosRoot)}-${name}`);
      fs.mkdirSync(root, { recursive: true });
      const copyTree = (from, into) => {
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
          if (entry.name === 'config.json' || entry.name === 'expected.json') continue;
          const source = path.join(from, entry.name);
          const target = path.join(into, entry.name);
          if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copyTree(source, target); }
          else fs.copyFileSync(source, target);
        }
      };
      copyTree(dir, root);
      const docs = collect(root, config);
      const options = expected.all ? { all: true } : { changedPaths: expected.changed || [] };
      const diagnostics = lifecycle.lintDocs(docs, config, options);
      const expectedDiagnostics = expected.diagnostics || [];
      const simplified = diagnostics.map((item, index) => Object.fromEntries(
        Object.keys(expectedDiagnostics[index] || {}).map(key => [key, key === 'path' ? item.path : item[key]])
      ));
      assert.deepStrictEqual(simplified, expectedDiagnostics, `${name}: diagnostics`);
      for (const [ref, want] of Object.entries(expected.resolve || {})) {
        const result = lifecycle.resolveRef(docs, ref);
        assert.strictEqual(result.doc ? result.doc.path : result.error, want, `${name}: resolve ${ref}`);
      }
      const index = lifecycle.buildIndex(docs, config);
      for (const fragment of expected.indexContains || []) assert.ok(index.includes(fragment), `${name}: index should contain ${fragment}`);
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
    }
  }
  return problems;
}

checkCase('2ax. scenario fixtures enforce the full inventory and required files', () => {
  const realRoot = path.join(__dirname, 'fixtures', 'doc-lifecycle', 'scenarios');
  assert.deepStrictEqual(runScenarioSet(realRoot), [], `real scenario tree must run clean: ${JSON.stringify(runScenarioSet(realRoot))}`);
  const names = fs.readdirSync(realRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepStrictEqual(names, [...EXPECTED_SCENARIOS], 'scenario inventory must match the expected set exactly');
  assert.ok(runScenarioSet(path.join(tempRoot, 'no-such-tree')).length >= 1, 'a missing scenario tree must be reported');
  const copied = path.join(tempRoot, 'copied-scenarios');
  fs.mkdirSync(copied, { recursive: true });
  const copyFullTree = (from, into) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(into, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copyFullTree(source, target); }
      else fs.copyFileSync(source, target);
    }
  };
  copyFullTree(realRoot, copied);
  fs.rmSync(path.join(copied, 'active-to-legacy', 'expected.json'));
  assert.ok(runScenarioSet(copied).includes('active-to-legacy: missing expected.json'), JSON.stringify(runScenarioSet(copied)));
  const unexpected = path.join(tempRoot, 'unexpected-scenarios');
  copyFullTree(realRoot, unexpected);
  fs.mkdirSync(path.join(unexpected, 'incomplete'), { recursive: true });
  assert.ok(runScenarioSet(unexpected).includes('unexpected scenario: incomplete'), JSON.stringify(runScenarioSet(unexpected)));
});

helper.finish();

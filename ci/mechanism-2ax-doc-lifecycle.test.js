'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-lifecycle.js');
const governanceGuardPath = path.join(__dirname, '..', 'scripts', 'doc-governance-guard.js');
const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const P2_BASE_SHA = 'b733cadec17542b9ae30aabb50c1ba3481a58d74';
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

function gitRawAt(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'buffer',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout)}`);
  return Buffer.from(result.stdout);
}

function nulFields(bytes) {
  if (bytes.length && bytes[bytes.length - 1] !== 0) throw new Error('Git oracle output is not NUL terminated');
  return bytes.length ? bytes.subarray(0, -1).toString('binary').split('\0').map(value => Buffer.from(value, 'binary')) : [];
}

function parseTreeOracle(bytes) {
  const entries = new Map();
  for (const field of nulFields(bytes)) {
    const tab = field.indexOf(9);
    if (tab < 0) throw new Error('malformed raw Git tree entry');
    const [mode, type, oid] = field.subarray(0, tab).toString('ascii').split(' ');
    const pathBytes = Buffer.from(field.subarray(tab + 1));
    entries.set(pathBytes.toString('base64'), { mode, type, oid, pathBytes });
  }
  return entries;
}

function parseStageOracle(bytes) {
  const entries = new Map();
  for (const field of nulFields(bytes)) {
    const tab = field.indexOf(9);
    if (tab < 0) throw new Error('malformed raw Git index entry');
    const [mode, oid, stage] = field.subarray(0, tab).toString('ascii').split(' ');
    if (stage !== '0') throw new Error(`unmerged Git index stage ${stage}`);
    const pathBytes = Buffer.from(field.subarray(tab + 1));
    entries.set(pathBytes.toString('base64'), { mode, oid, type: mode === '160000' ? 'commit' : 'blob', pathBytes });
  }
  return entries;
}

function parseNameStatusOracle(bytes) {
  const fields = nulFields(bytes);
  const changes = new Map();
  for (let index = 0; index < fields.length;) {
    const statusText = fields[index++].toString('ascii');
    const kind = statusText[0];
    const first = fields[index++];
    if (!first) throw new Error('truncated Git name-status entry');
    if (kind === 'R' || kind === 'C') {
      const second = fields[index++];
      if (!second) throw new Error('truncated Git rename/copy entry');
      changes.set(first.toString('base64'), { pathBytes: first, status: kind === 'R' ? 'renamed-from' : 'copied-from', endpoint: 'source', partner: second, statusText });
      changes.set(second.toString('base64'), { pathBytes: second, status: kind === 'R' ? 'renamed-to' : 'copied-to', endpoint: 'target', partner: first, statusText });
    } else {
      changes.set(first.toString('base64'), {
        pathBytes: first,
        status: kind === 'A' ? 'added' : kind === 'D' ? 'deleted' : kind === 'T' ? 'type-changed' : kind === 'U' ? 'unmerged' : 'modified',
        statusText
      });
    }
  }
  return changes;
}

function parseStatusOracle(bytes) {
  const fields = nulFields(bytes);
  const paths = new Map();
  for (let index = 0; index < fields.length;) {
    const field = fields[index++];
    if (field.length < 4) throw new Error('malformed Git porcelain status entry');
    const status = field.subarray(0, 2).toString('ascii');
    const pathBytes = Buffer.from(field.subarray(3));
    paths.set(pathBytes.toString('base64'), status);
    if (status.includes('R') || status.includes('C')) {
      const partner = fields[index++];
      if (!partner) throw new Error('truncated Git porcelain rename/copy entry');
      paths.set(partner.toString('base64'), status);
    }
  }
  return paths;
}

function isDocumentPath(pathBytes) {
  const name = pathBytes.toString('latin1');
  const lower = name.toLowerCase();
  return /\.(md|mdx|markdown|rst|adoc|txt)$/.test(lower)
    || /(?:^|\/)(?:readme|license|notice|contributing|changelog|code_of_conduct|security)$/.test(lower)
    || /(?:^|\/)(?:readme|changelog)[^/]*$/.test(lower);
}

function inventoryOracle(root, base) {
  const commit = gitAt(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`]);
  const baseEntries = parseTreeOracle(gitRawAt(root, ['ls-tree', '-r', '-z', '--full-tree', commit]));
  const stageEntries = parseStageOracle(gitRawAt(root, ['ls-files', '-z', '--stage']));
  const changes = parseNameStatusOracle(gitRawAt(root, ['diff', '--name-status', '-z', '--find-renames', commit, '--']));
  const statusPaths = parseStatusOracle(gitRawAt(root, ['status', '--porcelain=v1', '-z']));
  const entries = new Map([...baseEntries, ...stageEntries]);
  for (const [key, change] of changes) {
    if (!entries.has(key)) entries.set(key, { pathBytes: change.pathBytes });
    if (change.partner) {
      const partnerKey = change.partner.toString('base64');
      if (!entries.has(partnerKey)) entries.set(partnerKey, { pathBytes: change.partner });
    }
  }
  const documentKeys = new Set([...entries].filter(([, entry]) => isDocumentPath(entry.pathBytes)).map(([key]) => key));
  return { root, commit, baseEntries, stageEntries, changes, statusPaths, entries, documentKeys };
}

function rawWorktreeIdentity(root, pathBytes, stageEntry) {
  const decoded = pathBytes.toString('utf8');
  const absolute = Buffer.from(decoded, 'utf8').equals(pathBytes)
    ? path.join(path.resolve(root), ...decoded.split('/'))
    : process.platform === 'win32' ? null : Buffer.concat([Buffer.from(`${path.resolve(root)}${path.sep}`), pathBytes]);
  if (!absolute) return null;
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stageEntry && stageEntry.mode === '160000' && stat.isDirectory()) {
    return { mode: stageEntry.mode, type: 'commit', oid: stageEntry.oid };
  }
  let mode;
  let bytes;
  if (stat.isSymbolicLink()) {
    mode = '120000';
    bytes = fs.readlinkSync(absolute, { encoding: 'buffer' });
  } else if (stat.isFile()) {
    mode = stat.mode & 0o111 ? '100755' : '100644';
    bytes = fs.readFileSync(absolute);
  } else return null;
  const result = spawnSync('git', ['-C', root, 'hash-object', '--stdin'], {
    input: bytes,
    encoding: 'buffer',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
  });
  if (result.status !== 0) throw new Error(`git hash-object failed: ${String(result.stderr || result.stdout)}`);
  return { mode, type: 'blob', oid: result.stdout.toString('ascii').trim() };
}

function assertInventoryAgainstOracle(report, oracle, expectedDocumentKeys = oracle.documentKeys) {
  assert.strictEqual(report.base.commit, oracle.commit, 'inventory base is the pinned oracle commit');
  const expectedKeys = new Set(expectedDocumentKeys);
  for (const [key, entry] of oracle.entries) {
    const base = oracle.baseEntries.get(key);
    const staged = oracle.stageEntries.get(key);
    const change = oracle.changes.get(key);
    if ((base && ['120000', '160000'].includes(base.mode))
      || (staged && ['120000', '160000'].includes(staged.mode))) expectedKeys.add(key);
    if (change && change.partner && (expectedDocumentKeys.has(key) || expectedDocumentKeys.has(change.partner.toString('base64')))) {
      expectedKeys.add(key);
      expectedKeys.add(change.partner.toString('base64'));
    }
  }
  const records = new Map();
  for (const record of report.records || []) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, 'path'), 'report path is present');
    assert.ok(typeof record.path === 'string' && typeof record.pathEncoding === 'string', 'report has a display path and encoding');
    assert.ok(typeof record.pathBytesBase64 === 'string' && record.pathBytesBase64, 'raw path identity is present');
    assert.ok(!records.has(record.pathBytesBase64), `duplicate report identity ${record.pathBytesBase64}`);
    records.set(record.pathBytesBase64, record);
  }
  assert.deepStrictEqual([...records.keys()].sort(), [...expectedKeys].sort(), 'report identity paths equal raw Git oracle paths');
  for (const key of expectedKeys) {
    const record = records.get(key);
    const base = oracle.baseEntries.get(key) || null;
    const staged = oracle.stageEntries.get(key) || null;
    const change = oracle.changes.get(key) || null;
    const localStatus = oracle.statusPaths.get(key);
    assert.deepStrictEqual(record.base, base ? { mode: base.mode, type: base.type, oid: base.oid } : null, `base identity ${key}`);
    const deleted = change && ['deleted', 'renamed-from'].includes(change.status);
    const current = deleted ? null : change ? rawWorktreeIdentity(oracle.root, recordPathBytes(record), staged) : base ? base : staged;
    if (current) {
      assert.ok(record.current, `current identity is present for ${key}`);
      for (const field of ['mode', 'type', 'oid']) assert.strictEqual(record.current[field], current[field], `current ${field} ${key}`);
      if (staged && (!localStatus || localStatus[1] === ' ')) {
        for (const field of ['mode', 'type', 'oid']) assert.strictEqual(record.current[field], staged[field], `clean worktree matches staged ${field} ${key}`);
      }
    } else if (record.current !== null) {
      throw new Error(`deleted/unavailable current identity should be null for ${key}`);
    } else if (!deleted) {
      assert.ok(typeof record.currentReason === 'string' && record.currentReason, `unavailable identity reason ${key}`);
    }
    const expectedStatus = change ? change.status : base ? 'unchanged' : 'added';
    assert.strictEqual(record.status, expectedStatus, `Git status ${key}`);
    if (change && change.partner) {
      assert.strictEqual(record.rename.endpoint, change.endpoint, `rename endpoint ${key}`);
      assert.strictEqual(record.rename.partnerPathBytesBase64, change.partner.toString('base64'), `rename partner bytes ${key}`);
    } else assert.strictEqual(record.rename, undefined, `no rename metadata ${key}`);
    if (expectedDocumentKeys.has(key)) {
      assert.strictEqual(record.document, true, `identified document ${key}`);
      for (const axis of ['role', 'lifecycle', 'disposition']) {
        assert.ok(Object.prototype.hasOwnProperty.call(record, axis) && typeof record[axis] === 'string' && record[axis], `${axis} axis ${key}`);
      }
      assert.ok(typeof record.reason === 'string' && record.reason, `disposition reason ${key}`);
      assert.strictEqual(record.validation && record.validation.outcome, 'unchecked', `semantic validation stays separate and unchecked ${key}`);
      assert.ok(typeof record.validation.reason === 'string' && record.validation.reason, `validation reason ${key}`);
      if (record.disposition === 'unknown') assert.ok(record.reason, `unknown disposition remains visible with a reason ${key}`);
      if (oracle.statusPaths.has(key)) assert.ok(change || !base, `raw status path is represented by a base-relative change ${key}`);
    }
  }
  assert.deepStrictEqual(report.coverage, {
    identifiedDocumentPaths: expectedDocumentKeys.size,
    explicitDispositionPaths: expectedDocumentKeys.size,
    complete: true,
    claim: 'disposition coverage only; semantic validation was not performed'
  }, 'coverage counts all oracle documents without promoting semantics');
  return records;
}

function recordPathBytes(record) {
  return Buffer.from(record.pathBytesBase64, 'base64');
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
  const repeated = cli(['--changed', 'docs/adr/GRPH-101.md', '--changed', 'docs/adr/GRPH-102.md']);
  assert.strictEqual(repeated.status, 1, `repeated --changed occurrences accumulate instead of overwriting: ${repeated.stdout} ${repeated.stderr}`);
  assert.ok(JSON.parse(repeated.stdout).diagnostics.some(item => item.path === 'docs/adr/GRPH-102.md' && item.code === 'missing-id'), 'both repeated CSV declarations are audited');
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

checkCase('2ax dogfood. --changed-path preserves outer filename whitespace end to end', () => {
  const root = workspace('cli-changed-path-lossless');
  writeDoc(root, ' GRPH-001,extra.md', { status: 'accepted' }, 'Leading-space root filename with missing-id changed-only schema.\n');
  let trailingCreated = true;
  try {
    writeDoc(root, 'docs/adr/GRPH-002,extra.md ', { status: 'accepted' }, 'Trailing-space filename with missing-id changed-only schema.\n');
  } catch (error) {
    trailingCreated = false;
    console.log(`  SKIP trailing-space case: file creation with a trailing space failed on this host (${error.message.split('\n')[0]})`);
  }
  writeDoc(root, 'GRPH-004.md', { id: 'GRPH-004', status: 'accepted' });
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ governed: [{ path: '*.md', role: 'adr' }, { path: 'docs/adr/**', role: 'adr' }], domains: ['GRPH'] }), 'utf8');
  const cli = extraArgs => {
    const result = spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', configFile, ...extraArgs], { cwd: root, encoding: 'utf8' });
    assert.ifError(result.error);
    return result;
  };
  const audit = (result, relativePath, label) => {
    assert.strictEqual(result.status, 1, `${label} must audit the real changed document: ${result.stdout} ${result.stderr}`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(item => item.path === relativePath && item.code === 'missing-id' && item.severity === 'error'), `${label} diagnostics: ${result.stdout}`);
  };
  audit(cli(['--changed-path', ' GRPH-001,extra.md']), ' GRPH-001,extra.md', 'the raw leading-space argument');
  audit(cli(['--changed-path', './ GRPH-001,extra.md']), ' GRPH-001,extra.md', 'the dot-relative leading-space argument');
  if (trailingCreated) audit(cli(['--changed-path', 'docs/adr/GRPH-002,extra.md ']), 'docs/adr/GRPH-002,extra.md ', 'the trailing-space argument');
  const valid = cli(['--changed-path', 'GRPH-004.md']);
  assert.strictEqual(valid.status, 0, `a valid governed document still passes via --changed-path: ${valid.stdout} ${valid.stderr}`);
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

checkCase('2ax. Git document inventory preserves dispositions and base/current identity', () => {
  const root = workspace('git-inventory');
  const write = (relative, bytes = `${relative}\n`) => {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    return absolute;
  };
  const manifestRelative = '.agents/harness-everything/document-inventory.json';
  write(manifestRelative, `${JSON.stringify({
    schemaVersion: 1,
    documentGlobs: ['**/*.md', '**/*.txt'],
    rules: [
      { match: 'docs/reference/**', role: 'reference', lifecycle: 'current', disposition: 'applicable', reason: 'fixture positive control' },
      { match: '**/archive/**', role: 'legacy/archive', lifecycle: 'historical', disposition: 'inventory-only', reason: 'retained historical fixture' },
      { match: '**/generated/**', role: 'generated-view', lifecycle: 'generated', disposition: 'inventory-only', reason: 'generator is not run by inventory' },
      { match: '**/fixtures/**', role: 'fixture', lifecycle: 'retained-test-input', disposition: 'excluded', reason: 'fixture purpose is preserved' },
      { match: '**/vendor/**', role: 'vendor-document', lifecycle: 'external-content', disposition: 'excluded', reason: 'vendor purpose is preserved' }
    ]
  }, null, 2)}\n`);
  for (const relative of [
    'README.md', 'docs/reference/positive.md', 'docs/prd/plan.md', 'docs/adr/decision.md',
    'docs/archive/old.md', 'docs/generated/view.md', 'docs/fixtures/setup.md',
    'benchmarks/results/evidence.md', 'vendor/pkg/README.md', 'skills/sample/SKILL.md',
    'references/source.md', 'templates/example.md', 'nested/deep/unknown.md',
    'docs/delete.md', 'docs/rename-old.md', 'docs/mode.md', ...(process.platform === 'win32' ? [] : ['docs/odd\tline\nname.md'])
  ]) write(relative);
  const symlinks = [];
  const trackedSymlink = path.join(root, 'docs', 'fixtures', 'external.md');
  fs.mkdirSync(path.dirname(trackedSymlink), { recursive: true });
  try {
    fs.symlinkSync(path.join(os.tmpdir(), 'outside-document-not-read.md'), trackedSymlink, process.platform === 'win32' ? 'file' : undefined);
    symlinks.push('docs/fixtures/external.md');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    console.log(`  SKIP 2ax. tracked symlink inventory subcase: symlink creation unavailable (${error.code})`);
  }

  gitAt(root, ['init', '-q']);
  for (const [key, value] of [['user.name', 'Harness Test'], ['user.email', 'harness@example.invalid'], ['commit.gpgsign', 'false'], ['core.filemode', 'false']]) gitAt(root, ['config', key, value]);
  gitAt(root, ['add', '-A']);
  gitAt(root, ['update-index', '--chmod=+x', '--', 'docs/mode.md']);
  gitAt(root, ['commit', '-qm', 'inventory fixture']);
  const gitlinkTarget = gitAt(root, ['rev-parse', 'HEAD']);
  gitAt(root, ['update-index', '--add', '--cacheinfo', `160000,${gitlinkTarget},vendor/submodule`]);
  gitAt(root, ['commit', '-qm', 'add gitlink fixture']);
  const base = gitAt(root, ['rev-parse', 'HEAD']);

  const untrackedSymlink = path.join(root, 'docs', 'fixtures', 'untracked-external.md');
  try {
    fs.symlinkSync(path.join(os.tmpdir(), 'outside-document-not-read.md'), untrackedSymlink, process.platform === 'win32' ? 'file' : undefined);
    symlinks.push('docs/fixtures/untracked-external.md');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    console.log(`  SKIP 2ax. proposed symlink inventory subcase: symlink creation unavailable (${error.code})`);
  }

  fs.rmSync(path.join(root, 'docs', 'delete.md'));
  fs.renameSync(path.join(root, 'docs', 'rename-old.md'), path.join(root, 'docs', 'rename-new.md'));
  write('docs/untracked.md');
  write('docs/staged.md');
  write('local-session/private-notes.md', 'private sentinel: first value\n');
  gitAt(root, ['add', '-A', '--', 'docs/rename-old.md', 'docs/rename-new.md', 'docs/staged.md']);
  write('docs/reference/positive.md', 'modified positive control\n');
  if (process.platform !== 'win32') write('docs/odd\tline\nname.md', 'modified unusual path\n');

  const cli = (script, extraArgs = []) => {
    const result = spawnSync(process.execPath, [script, 'inventory', '--workspace', root, '--manifest', manifestRelative, '--base', base, ...extraArgs], { cwd: tempRoot, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `inventory ${extraArgs.join(' ')}: ${result.stderr}`);
    return { report: JSON.parse(result.stdout), stdout: result.stdout };
  };
  const first = cli(modulePath);
  write('local-session/private-notes.md', 'private sentinel: changed value\n');
  const second = cli(modulePath);
  const report = first.report;
  assert.strictEqual(first.stdout, second.stdout, 'changes to unproposed scratch files do not affect inventory output');
  assert.ok(!first.stdout.includes('local-session/private-notes.md'), 'unproposed local session path is not inventoried');
  assert.ok(!first.stdout.includes('private sentinel'), 'unproposed local session contents do not enter output');
  assert.strictEqual(report.base.commit, base, 'the requested base resolves to a pinned commit');
  assert.strictEqual(report.candidate.kind, 'working-tree', 'the current worktree is not mislabeled as the pinned base');
  assert.ok(report.candidate.sha256, 'the document candidate identity has a digest');
  assert.deepStrictEqual(report.coverage, {
    identifiedDocumentPaths: report.records.filter(item => item.document).length,
    explicitDispositionPaths: report.records.filter(item => item.document && item.reason).length,
    complete: true,
    claim: 'disposition coverage only; semantic validation was not performed'
  });
  assert.ok(report.records.some(item => item.path === 'README.md'), 'root README is inventoried');
  for (const relative of ['docs/prd/plan.md', 'docs/adr/decision.md', 'docs/archive/old.md', 'docs/generated/view.md', 'docs/fixtures/setup.md', 'benchmarks/results/evidence.md', 'vendor/pkg/README.md', 'skills/sample/SKILL.md', 'references/source.md', 'templates/example.md', 'nested/deep/unknown.md']) {
    assert.ok(report.records.some(item => item.path === relative), `nested document is inventoried: ${relative}`);
  }

  const byPath = new Map(report.records.map(item => [item.path, item]));
  const positive = byPath.get('docs/reference/positive.md');
  assert.strictEqual(positive.role, 'reference');
  assert.strictEqual(positive.lifecycle, 'current');
  assert.strictEqual(positive.disposition, 'applicable');
  assert.ok(positive.reason, 'disposition reason is explicit');
  assert.strictEqual(positive.status, 'modified');
  assert.strictEqual(positive.validation.outcome, 'unchecked');
  assert.ok(positive.validation.reason, 'validation outcome has its own reason');
  assert.strictEqual(positive.current.oid, gitAt(root, ['hash-object', 'docs/reference/positive.md']));

  assert.strictEqual(byPath.get('docs/delete.md').status, 'deleted');
  assert.strictEqual(byPath.get('docs/delete.md').current, null);
  assert.strictEqual(byPath.get('docs/delete.md').base.oid, gitAt(root, ['rev-parse', `${base}:docs/delete.md`]));
  assert.strictEqual(byPath.get('docs/rename-old.md').status, 'renamed-from');
  assert.strictEqual(byPath.get('docs/rename-new.md').status, 'renamed-to');
  assert.strictEqual(byPath.get('docs/rename-old.md').rename.partnerPath, 'docs/rename-new.md');
  assert.strictEqual(byPath.get('docs/rename-new.md').rename.partnerPath, 'docs/rename-old.md');
  assert.ok(!byPath.has('docs/untracked.md'), 'unproposed untracked docs are excluded');
  assert.strictEqual(byPath.get('docs/staged.md').status, 'added');
  assert.strictEqual(byPath.get('docs/mode.md').base.mode, '100755', 'Git index executable mode is preserved across hosts');
  assert.strictEqual(byPath.get('docs/mode.md').current.mode, '100755');

  if (process.platform !== 'win32') {
    const unusualPath = 'docs/odd\tline\nname.md';
    const unusual = report.records.find(item => item.pathBytesBase64 === Buffer.from(unusualPath).toString('base64'));
    assert.ok(unusual, 'NUL-delimited Git plumbing preserves tabs and newlines in raw path bytes');
    assert.strictEqual(unusual.status, 'modified');
    assert.strictEqual(unusual.path, unusualPath);
  } else console.log('  SKIP 2ax. tab/newline filename subcase: Windows forbids control characters in filenames');
  assert.strictEqual(byPath.get('nested/deep/unknown.md').disposition, 'unknown');
  assert.ok(byPath.get('nested/deep/unknown.md').reason, 'unknown classification retains a reason');
  if (symlinks.includes('docs/fixtures/external.md')) {
    assert.strictEqual(byPath.get('docs/fixtures/external.md').kind, 'symlink');
    assert.strictEqual(byPath.get('docs/fixtures/external.md').base.mode, '120000');
  }
  const proposed = cli(modulePath, ['--proposed-untracked', 'docs/untracked.md', ...(symlinks.includes('docs/fixtures/untracked-external.md') ? ['--proposed-untracked', 'docs/fixtures/untracked-external.md'] : [])]).report;
  const proposedByPath = new Map(proposed.records.map(item => [item.path, item]));
  assert.strictEqual(proposedByPath.get('docs/untracked.md').status, 'added', 'explicitly proposed untracked document is inventoried');
  if (symlinks.includes('docs/fixtures/untracked-external.md')) {
    assert.strictEqual(proposedByPath.get('docs/fixtures/untracked-external.md').kind, 'symlink');
    assert.strictEqual(proposedByPath.get('docs/fixtures/untracked-external.md').current.mode, '120000');
    assert.strictEqual(proposedByPath.get('docs/fixtures/untracked-external.md').current.oidBasis, 'raw worktree bytes; no Git filters applied');
    const linkOid = spawnSync('git', ['-C', root, 'hash-object', '--stdin'], { encoding: 'utf8', input: fs.readlinkSync(path.join(root, 'docs', 'fixtures', 'untracked-external.md'), { encoding: 'buffer' }) });
    assert.ifError(linkOid.error);
    assert.strictEqual(proposedByPath.get('docs/fixtures/untracked-external.md').current.oid, linkOid.stdout.trim());
  }
  assert.strictEqual(byPath.get('vendor/submodule').kind, 'gitlink');
  assert.strictEqual(byPath.get('vendor/submodule').base.mode, '160000');
  assert.strictEqual(byPath.get('vendor/submodule').base.oid, gitAt(root, ['rev-parse', `${base}:vendor/submodule`]));
  assert.ok(!report.records.some(item => item.path.startsWith('vendor/submodule/')), 'gitlink contents are not recursed');
});

let pinnedBaseAvailable = false;
try { gitAt(REPOSITORY_ROOT, ['cat-file', '-e', `${P2_BASE_SHA}^{commit}`]); pinnedBaseAvailable = true; } catch { /* reported below as unchecked */ }
if (!pinnedBaseAvailable) helper.check('2ax P2. actual repository inventory matches the raw Git oracle at a pinned base', false, `UNCHECKED: pinned baseline ${P2_BASE_SHA} unavailable; required repository ratchet not verified`);
else checkCase('2ax P2. actual repository inventory matches the raw Git oracle at a pinned base', () => {
    const result = spawnSync(process.execPath, [modulePath, 'inventory', '--workspace', REPOSITORY_ROOT, '--manifest', '.agents/harness-everything/document-inventory.json', '--base', P2_BASE_SHA], { cwd: tempRoot, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `actual repository inventory: ${result.stderr}`);
    const report = JSON.parse(result.stdout);
    const oracle = inventoryOracle(REPOSITORY_ROOT, P2_BASE_SHA);
    const records = assertInventoryAgainstOracle(report, oracle);
    assert.ok(records.has(Buffer.from('README.md').toString('base64')), 'actual repository positive control is present');
    assert.ok(records.has(Buffer.from('docs/architecture.md').toString('base64')), 'governed repository path is not dropped');
    console.log(`  P2 repo oracle: ${report.coverage.identifiedDocumentPaths} document paths, ${oracle.changes.size} changed endpoints, ${oracle.stageEntries.size} index entries, ${oracle.statusPaths.size} status paths matched from raw NUL Git commands`);
  });

checkCase('2ax P2. baseline-to-candidate ratchet detects scope and identity drift', () => {
  const root = workspace('baseline-ratchet');
  const manifestPath = '.agents/harness-everything/document-inventory.json';
  const rule = match => ({ match, role: 'reference', lifecycle: 'current', disposition: 'applicable', reason: `fixture rule for ${match}` });
  // This expected policy is separate from the candidate manifest under test.
  const baselineMusts = Object.freeze([
    Object.freeze({ path: 'docs/reference/keep.md', role: 'reference', lifecycle: 'current', disposition: 'applicable' })
  ]);
  const assertBaselineMusts = candidate => {
    const records = new Map(candidate.records.map(item => [item.pathBytesBase64, item]));
    for (const must of baselineMusts) {
      const key = Buffer.from(must.path).toString('base64');
      const record = records.get(key);
      assert.ok(record, `baseline MUST document is missing: ${must.path}`);
      for (const field of ['role', 'lifecycle', 'disposition']) {
        assert.strictEqual(record[field], must[field], `baseline MUST ${must.path} ${field} changed`);
      }
    }
  };
  const baselineManifest = {
    schemaVersion: 1,
    documentGlobs: ['**/*.md'],
    rules: [
      rule('docs/reference/current.md'), rule('docs/reference/keep.md'), rule('docs/reference/deleted.md'),
      rule('docs/reference/rename-old.md'), rule('docs/reference/new.md'), rule('docs/reference/staged.md'),
      rule('docs/reference/working.md'), rule('docs/reference/mode.md')
    ]
  };
  const write = (relative, contents) => {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
    return absolute;
  };
  const writeManifest = value => write(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  writeManifest(baselineManifest);
  for (const relative of [
    'docs/reference/current.md', 'docs/reference/keep.md', 'docs/reference/deleted.md',
    'docs/reference/rename-old.md', 'docs/reference/working.md', 'docs/reference/staged.md',
    'docs/reference/mode.md'
  ]) write(relative, `${relative}\n`);
  gitAt(root, ['init', '-q']);
  for (const [key, value] of [['user.name', 'Harness P2 fixture'], ['user.email', 'harness-p2@example.invalid'], ['commit.gpgsign', 'false'], ['core.filemode', 'false']]) gitAt(root, ['config', key, value]);
  gitAt(root, ['add', '-A']);
  gitAt(root, ['update-index', '--chmod=+x', '--', 'docs/reference/mode.md']);
  gitAt(root, ['commit', '-qm', 'trusted inventory baseline']);
  const base = gitAt(root, ['rev-parse', 'HEAD']);

  fs.rmSync(path.join(root, 'docs/reference/deleted.md'));
  fs.renameSync(path.join(root, 'docs/reference/rename-old.md'), path.join(root, 'docs/reference/rename-new.md'));
  write('docs/reference/new.md', 'new tracked document\n');
  write('docs/reference/staged.md', 'staged tracked document\n');
  write('docs/reference/working.md', 'staged contents\n');
  write('docs/unknown/unclassified.md', 'unknown path remains visible\n');
  const candidateManifest = { ...baselineManifest, rules: baselineManifest.rules.filter(item => item.match !== 'docs/reference/keep.md').concat(rule('docs/reference/rename-new.md')) };
  writeManifest(candidateManifest);
  gitAt(root, ['add', '-A']);
  write('docs/reference/working.md', 'unstaged worktree contents\n');

  const inventory = () => {
    const result = spawnSync(process.execPath, [modulePath, 'inventory', '--workspace', root, '--manifest', manifestPath, '--base', base], { cwd: tempRoot, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `fixture inventory: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  const docPaths = [
    'docs/reference/current.md', 'docs/reference/keep.md', 'docs/reference/deleted.md',
    'docs/reference/rename-old.md', 'docs/reference/rename-new.md', 'docs/reference/new.md',
    'docs/reference/staged.md', 'docs/reference/working.md', 'docs/reference/mode.md',
    'docs/unknown/unclassified.md'
  ];
  const expectedDocs = new Set(docPaths.map(value => Buffer.from(value).toString('base64')));
  const report = inventory();
  assert.throws(() => assertBaselineMusts(report), /baseline MUST docs\/reference\/keep\.md role changed/, 'dropping a baseline MUST rule is a policy scope regression');
  const oracle = inventoryOracle(root, base);
  const records = assertInventoryAgainstOracle(report, oracle, expectedDocs);
  const get = value => records.get(Buffer.from(value).toString('base64'));
  assert.strictEqual(get('docs/reference/current.md').disposition, 'applicable', 'unchanged governed path is a positive control');
  assert.strictEqual(get('docs/reference/new.md').status, 'added', 'new tracked document is visible');
  assert.ok(oracle.stageEntries.has(Buffer.from('docs/reference/staged.md').toString('base64')), 'staged positive control is in the independent index oracle');
  assert.ok(oracle.statusPaths.has(Buffer.from('docs/reference/working.md').toString('base64')), 'unstaged positive control is in porcelain status');
  assert.strictEqual(get('docs/reference/working.md').current.oid, gitAt(root, ['hash-object', 'docs/reference/working.md']), 'working-tree OID is checked independently');
  const stagedWorkingOid = oracle.stageEntries.get(Buffer.from('docs/reference/working.md').toString('base64')).oid;
  const stagedWorkingHash = spawnSync('git', ['-C', root, 'hash-object', '--stdin'], { input: Buffer.from('staged contents\n'), encoding: 'utf8' });
  assert.ifError(stagedWorkingHash.error);
  assert.strictEqual(stagedWorkingOid, stagedWorkingHash.stdout.trim(), 'index OID comes from its staged bytes');
  assert.notStrictEqual(get('docs/reference/working.md').current.oid, stagedWorkingOid, 'worktree OID remains distinct from the staged OID');
  assert.strictEqual(get('docs/reference/mode.md').base.mode, '100755', 'base executable mode is preserved');
  assert.strictEqual(get('docs/reference/deleted.md').status, 'deleted', 'deleted baseline endpoint remains visible');
  assert.strictEqual(get('docs/reference/rename-old.md').rename.endpoint, 'source', 'rename source is visible');
  assert.strictEqual(get('docs/reference/rename-new.md').rename.endpoint, 'target', 'rename target is visible');
  for (const value of ['docs/reference/keep.md', 'docs/unknown/unclassified.md']) {
    assert.strictEqual(get(value).disposition, 'unknown', `unknown or dropped entry remains visible: ${value}`);
    assert.ok(get(value).reason, `unknown or dropped entry keeps a reason: ${value}`);
    assert.strictEqual(get(value).validation.outcome, 'unchecked', `unknown is not semantic PASS: ${value}`);
  }

  const retainedMustManifest = { ...candidateManifest, rules: [rule('docs/reference/keep.md'), ...candidateManifest.rules] };
  writeManifest(retainedMustManifest);
  gitAt(root, ['add', '--', manifestPath]);
  const retainedMustReport = inventory();
  assert.doesNotThrow(() => assertBaselineMusts(retainedMustReport), 'retaining the baseline MUST passes the policy ratchet');
  const retainedByPath = new Map(retainedMustReport.records.map(item => [item.path, item]));
  assert.strictEqual(retainedByPath.get('docs/reference/current.md').disposition, 'applicable', 'unchanged baseline path remains a positive control');
  assert.strictEqual(retainedByPath.get('docs/unknown/unclassified.md').disposition, 'unknown', 'a new unknown path remains visible without shrinking baseline MUSTs');

  const weakenedMustManifest = {
    ...retainedMustManifest,
    rules: retainedMustManifest.rules.map(item => item.match === 'docs/reference/keep.md' ? { ...item, disposition: 'inventory-only' } : item)
  };
  writeManifest(weakenedMustManifest);
  gitAt(root, ['add', '--', manifestPath]);
  const weakenedMustReport = inventory();
  assert.throws(() => assertBaselineMusts(weakenedMustReport), /baseline MUST docs\/reference\/keep\.md disposition changed/, 'weakening a baseline MUST rule is a policy scope regression');

  function getFrom(candidate, relative) {
    return candidate.records.find(item => item.pathBytesBase64 === Buffer.from(relative).toString('base64'));
  }
  const rejects = (mutate, label) => {
    const copy = JSON.parse(JSON.stringify(report));
    mutate(copy);
    assert.throws(() => assertInventoryAgainstOracle(copy, oracle, expectedDocs), undefined, label);
  };
  rejects(copy => { copy.records.pop(); }, 'ratchet rejects an omitted identity');
  rejects(copy => { delete copy.records[0].path; }, 'ratchet rejects a missing report path');
  rejects(copy => { delete getFrom(copy, 'docs/reference/new.md').reason; }, 'ratchet rejects a missing disposition reason');
  rejects(copy => { const item = getFrom(copy, 'docs/reference/new.md'); delete item.lifecycle; delete item.disposition; delete item.validation; }, 'ratchet rejects collapsed axes');
  rejects(copy => { delete getFrom(copy, 'docs/reference/new.md').current.oid; }, 'ratchet rejects missing object identity');

  const narrowed = { ...candidateManifest, documentGlobs: ['**/*.pdf'] };
  writeManifest(narrowed);
  gitAt(root, ['add', '--', manifestPath]);
  write('docs/reference/scope-gap.md', 'candidate path hidden by narrowed globs\n');
  gitAt(root, ['add', '--', 'docs/reference/scope-gap.md']);
  const narrowedReport = inventory();
  const narrowedOracle = inventoryOracle(root, base);
  const scopeDocs = new Set([...expectedDocs, Buffer.from('docs/reference/scope-gap.md').toString('base64')]);
  assert.ok(narrowedOracle.documentKeys.has(Buffer.from('docs/reference/scope-gap.md').toString('base64')));
  assert.strictEqual(narrowedReport.coverage.identifiedDocumentPaths, 0, 'narrowed globs cannot hide the full expected denominator');
  assert.strictEqual(narrowedReport.coverage.complete, true, 'the producer-only zero-document claim is deliberately insufficient');
  assert.throws(() => assertInventoryAgainstOracle(narrowedReport, narrowedOracle, scopeDocs), undefined, 'ratchet rejects a narrowed document glob and visible scope gap');
});

const symlinkProbe = path.join(tempRoot, 'manifest-ancestor-link-probe');
try {
  fs.symlinkSync(tempRoot, symlinkProbe, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmSync(symlinkProbe, { recursive: true, force: true });
  checkCase('2ax. inventory rejects a manifest reached through a workspace symlink ancestor', () => {
    const root = workspace('manifest-ancestor-symlink');
    const manifestRelative = '.agents/harness-everything/document-inventory.json';
    const outside = path.join(tempRoot, 'outside-manifest-ancestor');
    const manifest = { schemaVersion: 1, documentGlobs: ['**/*.md'], rules: [{ match: '**/*.md', role: 'inside-control', lifecycle: 'current', disposition: 'applicable', reason: 'inside manifest' }] };
    const write = (target, content) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
    write(path.join(root, manifestRelative), `${JSON.stringify(manifest)}\n`);
    write(path.join(root, 'docs', 'tracked.md'), 'tracked\n');
    const externalManifest = { ...manifest, rules: [{ ...manifest.rules[0], role: 'external-sentinel-secret', reason: 'must never be read' }] };
    write(path.join(outside, 'harness-everything', 'document-inventory.json'), `${JSON.stringify(externalManifest)}\n`);
    gitAt(root, ['init', '-q']);
    for (const [key, value] of [['user.name', 'Harness Test'], ['user.email', 'harness@example.invalid']]) gitAt(root, ['config', key, value]);
    gitAt(root, ['add', '-A']);
    gitAt(root, ['commit', '-qm', 'manifest symlink fixture']);
    const base = gitAt(root, ['rev-parse', 'HEAD']);
    const run = () => spawnSync(process.execPath, [modulePath, 'inventory', '--workspace', root, '--manifest', manifestRelative, '--base', base], { cwd: tempRoot, encoding: 'utf8' });
    const inside = run();
    assert.strictEqual(inside.status, 0, inside.stderr);
    assert.strictEqual(JSON.parse(inside.stdout).records.find(item => item.path === 'docs/tracked.md').role, 'inside-control');
    fs.rmSync(path.join(root, '.agents'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
    const escaped = run();
    assert.strictEqual(escaped.status, 2, 'manifest reached through an ancestor symlink fails closed');
    assert.match(escaped.stderr, /symbolic link|symlink/i);
    assert.ok(!escaped.stdout.includes('external-sentinel-secret'), 'external manifest contents are not accepted');
  });
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  console.log(`SKIP 2ax. manifest ancestor symlink guard: symlink creation unavailable (${error.code})`);
}

checkCase('2ax. frozen Git-object guard with bootstrap and tamper controls', () => {
  const trustedPaths = [
    'scripts/doc-governance-guard.js',
    'ci/mechanism-2ax-doc-lifecycle.test.js',
    'ci/mechanism-325-f1-doc-check.test.js',
    'harness-everything/scripts/doc-check.js',
    'harness-everything/scripts/doc-lifecycle.js',
    'harness-everything/scripts/project-docs-resolver.js',
    'plugins/harness-everything/skills/harness-everything/scripts/doc-check.js',
    'plugins/harness-everything/skills/harness-everything/scripts/doc-lifecycle.js',
    'plugins/harness-everything/skills/harness-everything/scripts/project-docs-resolver.js',
    '.agents/harness-everything/project-docs.json',
    '.agents/harness-everything/document-inventory.json',
    '.github/workflows/ci.yml',
    'package.json',
    'self-evolve/scripts/self-regression.js',
    'ci/mechanism-test.js',
    'ci/mutation-check.js',
    'ci/lib/isolated-test-process.js',
    'ci/test-helper.js',
    'scripts/verify-all.js'
  ];
  const frozenGuard = fs.readFileSync(governanceGuardPath);
  const frozenTest = fs.readFileSync(__filename);
  const frozenGuardPath = path.join(tempRoot, 'frozen-doc-governance-guard.js');
  const frozenTestPath = path.join(tempRoot, 'frozen-2ax-test.js');
  fs.writeFileSync(frozenGuardPath, frozenGuard);
  fs.writeFileSync(frozenTestPath, frozenTest);
  assert.ok(fs.readFileSync(frozenGuardPath).equals(frozenGuard), 'trusted verifier bytes are frozen before fixture mutations');
  assert.ok(fs.readFileSync(frozenTestPath).equals(frozenTest), 'trusted test/oracle bytes are frozen before fixture mutations');

  function fixtureGit(root, args, input) {
    const result = spawnSync('git', ['-C', root, ...args], {
      encoding: 'buffer',
      input,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' }
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `git ${args.join(' ')}: ${Buffer.from(result.stderr || '').toString('utf8')}`);
    return Buffer.from(result.stdout || '');
  }

  function writeRelative(root, relativePath, bytes) {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }

  function commitFixture(root, message, executablePath) {
    fixtureGit(root, ['add', '-A']);
    if (executablePath) fixtureGit(root, ['update-index', '--chmod=+x', '--', executablePath]);
    fixtureGit(root, ['commit', '--quiet', '-m', message]);
    return fixtureGit(root, ['rev-parse', 'HEAD']).toString('ascii').trim();
  }

  function createFixture(name = 'governance-guard-git') {
    const root = workspace(name);
    fs.mkdirSync(path.join(root, '.fixture-hooks'), { recursive: true });
    fixtureGit(root, ['init', '--quiet']);
    fixtureGit(root, ['config', 'user.name', 'Harness Guard Test']);
    fixtureGit(root, ['config', 'user.email', 'guard@example.invalid']);
    fixtureGit(root, ['config', 'core.hooksPath', path.join(root, '.fixture-hooks')]);
    for (const relativePath of trustedPaths) {
      const bytes = relativePath === 'scripts/doc-governance-guard.js' ? frozenGuard
        : relativePath === 'ci/mechanism-2ax-doc-lifecycle.test.js' ? frozenTest
          : fs.readFileSync(path.join(REPOSITORY_ROOT, ...relativePath.split('/')));
      writeRelative(root, relativePath, bytes);
    }
    const copyScenarioTree = (from, into) => {
      fs.mkdirSync(into, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        const target = path.join(into, entry.name);
        if (entry.isDirectory()) copyScenarioTree(source, target);
        else fs.copyFileSync(source, target);
      }
    };
    copyScenarioTree(
      path.join(REPOSITORY_ROOT, 'ci/fixtures/doc-lifecycle/scenarios'),
      path.join(root, 'ci/fixtures/doc-lifecycle/scenarios')
    );
    const policy = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, '.agents/harness-everything/project-docs.json'), 'utf8'));
    for (const record of [...policy.governed, ...policy.derived]) writeRelative(root, record.path, `baseline ${record.path}\n`);
    writeRelative(root, 'docs/ordinary.md', 'baseline ordinary document\n');
    return { root, base: commitFixture(root, 'fixture baseline') };
  }

  function resetFixture(fixture) {
    fixtureGit(fixture.root, ['reset', '--hard', fixture.base]);
    fixtureGit(fixture.root, ['clean', '-fd']);
  }

  function runFrozenGuard(fixture, base, candidate, extraArgs = []) {
    const args = [frozenGuardPath, '--repo', fixture.root, '--base', base, ...extraArgs];
    if (candidate) args.push('--candidate', candidate);
    const result = spawnSync(process.execPath, args, { cwd: tempRoot, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    assert.ok(result.stdout, result.stderr || 'guard returned no JSON');
    return { status: result.status, report: JSON.parse(result.stdout), stderr: result.stderr };
  }

  const fixture = createFixture();
  const ordinaryPath = path.join(fixture.root, 'docs', 'ordinary.md');
  fs.writeFileSync(ordinaryPath, 'ordinary document edit\n');
  // Git for Windows rejects LF paths even when they are added directly to the index.
  const newlinePath = 'docs/new\nunknown.md';
  const linkOid = fixtureGit(fixture.root, ['hash-object', '-w', '--stdin'], Buffer.from('../outside-target.md\n')).toString('ascii').trim();
  fixtureGit(fixture.root, ['add', '-A']);
  if (process.platform !== 'win32') {
    const newlineOid = fixtureGit(fixture.root, ['hash-object', '-w', '--stdin'], Buffer.from('new document\n')).toString('ascii').trim();
    fixtureGit(fixture.root, ['update-index', '--add', '--cacheinfo', `100644,${newlineOid},${newlinePath}`]);
  }
  fixtureGit(fixture.root, ['update-index', '--add', '--cacheinfo', `120000,${linkOid},docs/link.md`]);
  fixtureGit(fixture.root, ['update-index', '--add', '--cacheinfo', `160000,${fixture.base},docs/submodule.md`]);
  fixtureGit(fixture.root, ['commit', '--quiet', '-m', 'ordinary document edits']);
  const positiveCandidate = fixtureGit(fixture.root, ['rev-parse', 'HEAD']).toString('ascii').trim();
  const positive = runFrozenGuard(fixture, fixture.base, positiveCandidate);
  assert.strictEqual(positive.status, 0, positive.stderr);
  assert.strictEqual(positive.report.verdict, 'PASS', 'ordinary document edits remain permitted');
  assert.strictEqual(positive.report.inputs.base.commit, fixture.base, 'base SHA is exact in JSON');
  assert.strictEqual(positive.report.inputs.candidate.commit, positiveCandidate, 'candidate SHA is exact in JSON');
  assert.strictEqual(positive.report.verifier.sha256, crypto.createHash('sha256').update(frozenGuard).digest('hex'));
  assert.strictEqual(positive.report.verifier.matchesBaseObject, true, 'running verifier bytes match the baseline guard blob');
  assert.deepStrictEqual(positive.report.trustSurface.paths.slice(0, trustedPaths.length).map(item => item.path), trustedPaths, 'fixed trust surface is explicit');
  const scenarioExpectedPath = 'ci/fixtures/doc-lifecycle/scenarios/active-to-active/expected.json';
  const scenarioOracle = positive.report.trustSurface.paths.find(item => item.path === scenarioExpectedPath);
  assert.ok(scenarioOracle, 'tracked scenario oracle is part of the baseline trust surface');
  assert.deepStrictEqual(scenarioOracle.base, scenarioOracle.candidate, 'unchanged oracle identity is a positive control');
  const newDocs = new Map(positive.report.newDocuments.map(item => [item.path, item]));
  const specialDocumentPaths = [...(process.platform === 'win32' ? [] : [newlinePath]), 'docs/link.md', 'docs/submodule.md'];
  for (const relativePath of specialDocumentPaths) {
    const record = newDocs.get(relativePath);
    assert.ok(record, `new document is inventoried even with a special path or Git mode: ${relativePath}`);
    assert.strictEqual(record.role, 'unknown');
    assert.strictEqual(record.disposition, 'unknown');
    assert.strictEqual(record.validation, 'unchecked');
  }
  assert.strictEqual(newDocs.get('docs/link.md').mode, '120000', 'symlink mode is retained without following the target');
  assert.strictEqual(newDocs.get('docs/submodule.md').mode, '160000', 'gitlink mode is retained without recursing');
  assert.strictEqual(newDocs.get('docs/submodule.md').type, 'commit');

  const scenarioExpectedFile = path.join(fixture.root, ...scenarioExpectedPath.split('/'));
  for (const mutation of ['content', 'delete', 'mode', 'add']) {
    resetFixture(fixture);
    if (mutation === 'content') {
      const expected = JSON.parse(fs.readFileSync(scenarioExpectedFile, 'utf8'));
      delete expected.resolve['docs/adr/GRPH-002.md'];
      fs.writeFileSync(scenarioExpectedFile, `${JSON.stringify(expected, null, 2)}\n`);
    } else if (mutation === 'delete') {
      fixtureGit(fixture.root, ['rm', '--quiet', '--', scenarioExpectedPath]);
    } else if (mutation === 'add') {
      writeRelative(fixture.root, 'ci/fixtures/doc-lifecycle/scenarios/new/expected.json', '{}\n');
    }
    const candidate = commitFixture(fixture.root, `mutate scenario oracle ${mutation}`, mutation === 'mode' ? scenarioExpectedPath : undefined);
    const result = runFrozenGuard(fixture, fixture.base, candidate);
    assert.strictEqual(result.status, 2, `scenario fixture ${mutation} requires review: ${result.stderr}`);
    assert.strictEqual(result.report.verdict, 'REVIEW_REQUIRED');
    const item = result.report.trustSurface.changed.find(entry => entry.path === (mutation === 'add'
      ? 'ci/fixtures/doc-lifecycle/scenarios/new/expected.json'
      : scenarioExpectedPath));
    assert.ok(item, `scenario fixture ${mutation} identity change is reported`);
    if (mutation === 'delete') assert.strictEqual(item.candidate, null, 'deleted oracle retains its baseline identity');
    if (mutation === 'add') assert.strictEqual(item.base, null, 'new oracle has no baseline identity');
    if (mutation === 'content') assert.notStrictEqual(item.base.oid, item.candidate.oid, 'oracle content change is reported by blob OID');
    if (mutation === 'mode') assert.notStrictEqual(item.base.mode, item.candidate.mode, 'oracle mode change is reported');
  }

  const unchanged = runFrozenGuard(fixture, fixture.base, fixture.base);
  assert.strictEqual(unchanged.status, 0, 'an unchanged tree passes');
  assert.strictEqual(unchanged.report.verdict, 'PASS');

  const rawIdentity = entry => ({ mode: entry.mode, type: entry.type, oid: entry.oid });
  const configuredIdentity = (commit, relativePath) => {
    const tree = parseTreeOracle(fixtureGit(fixture.root, ['ls-tree', '-r', '-z', '--full-tree', commit]));
    return rawIdentity(tree.get(Buffer.from(relativePath).toString('base64')));
  };
  resetFixture(fixture);
  writeRelative(fixture.root, 'docs/architecture.md', 'changed governed document content\n');
  const revisedGovernedCandidate = commitFixture(fixture.root, 'revise governed document');
  const revisedGoverned = runFrozenGuard(fixture, fixture.base, revisedGovernedCandidate);
  const fixtureStatusBeforeRepeat = fixtureGit(fixture.root, ['status', '--porcelain']);
  const revisedGovernedRepeat = runFrozenGuard(fixture, fixture.base, revisedGovernedCandidate);
  const fixtureStatusAfterRepeat = fixtureGit(fixture.root, ['status', '--porcelain']);
  assert.deepStrictEqual(revisedGovernedRepeat, revisedGoverned, 'identical Git inputs produce an identical report');
  assert.deepStrictEqual(fixtureStatusAfterRepeat, fixtureStatusBeforeRepeat, 'guard execution does not mutate the fixture repository');
  assert.strictEqual(revisedGoverned.status, 0, 'regular governed content revision passes');
  assert.strictEqual(revisedGoverned.report.verdict, 'PASS');
  const revisedEntry = revisedGoverned.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/architecture.md');
  assert.strictEqual(revisedEntry.state, 'revised', 'governed content revision is informational');
  assert.deepStrictEqual(revisedEntry.base, configuredIdentity(fixture.base, 'docs/architecture.md'));
  assert.deepStrictEqual(revisedEntry.candidate, configuredIdentity(revisedGovernedCandidate, 'docs/architecture.md'));
  assert.match(revisedEntry.reason, /not semantically validated by the guard/i);
  assert.ok(revisedGoverned.report.limits.some(limit => /content revisions.*not semantically validated by the guard/i.test(limit)));
  assert.strictEqual(revisedGoverned.report.policyPreservation.configuredPaths.state, 'pass');
  assert.deepStrictEqual(revisedGoverned.report.policyPreservation.configuredPaths.missingOrChanged, []);

  resetFixture(fixture);
  writeRelative(fixture.root, 'docs/governed-index.md', 'changed derived output\n');
  const derivedCandidate = commitFixture(fixture.root, 'change derived document');
  const derivedChange = runFrozenGuard(fixture, fixture.base, derivedCandidate);
  assert.strictEqual(derivedChange.status, 2, 'derived content change still requires review');
  assert.strictEqual(derivedChange.report.verdict, 'REVIEW_REQUIRED');
  const derivedEntry = derivedChange.report.policyPreservation.configuredPaths.missingOrChanged.find(item => item.path === 'docs/governed-index.md');
  assert.ok(derivedEntry, 'derived content change remains in review-required paths');
  assert.strictEqual(derivedEntry.state, 'review_required');
  assert.deepStrictEqual(derivedEntry.base, configuredIdentity(fixture.base, 'docs/governed-index.md'));
  assert.deepStrictEqual(derivedEntry.candidate, configuredIdentity(derivedCandidate, 'docs/governed-index.md'));

  const globPatterns = [
    'docs/adr/*.md',
    'empty/*.md',
    'corpus/one*.md', // portability-lint: allow glob pattern string, never created as a file
    'corpus/*.md',
    'deep/**/*.md',
    'repeat/**/repeat/*.md',
    'literal.v1/**/*.md'
  ];
  const corpusPaths = [
    'docs/adr/one.md', 'docs/adr/two.md', 'generated/view.md', 'generated/nested/view.md',
    'corpus/one.md', 'corpus/many-a.md', 'corpus/many-b.md',
    'deep/zero.md', 'deep/a/b.md',
    'repeat/repeat/first.md', 'repeat/a/repeat/second.md',
    'literal.v1/top.md', 'literal.v1/sub/nested.md', 'literalXv1/no.md'
  ];
  const globFixture = createFixture('governance-guard-glob-git');
  resetFixture(globFixture);
  const globPolicy = {
    governed: globPatterns.map(pattern => ({ path: pattern, role: 'reference' })),
    derived: [{ path: 'generated/**/*.md', generator: 'build' }]
  };
  writeRelative(globFixture.root, '.agents/harness-everything/project-docs.json', `${JSON.stringify(globPolicy, null, 2)}\n`);
  for (const relativePath of corpusPaths) writeRelative(globFixture.root, relativePath, `baseline ${relativePath}\n`);
  globFixture.base = commitFixture(globFixture.root, 'glob policy baseline');

  const globAccepted = runFrozenGuard(globFixture, globFixture.base, globFixture.base);
  assert.strictEqual(globAccepted.report.verdict, 'PASS', globAccepted.report.errors[0]?.message);
  const globSummaries = globAccepted.report.policyPreservation.configuredPaths.patterns;
  assert.ok(globSummaries, 'glob records report their base and candidate member counts');
  assert.strictEqual(globAccepted.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/one.md').state, 'pass', 'unchanged glob members pass');
  assert.deepStrictEqual(runFrozenGuard(globFixture, globFixture.base, globFixture.base), globAccepted, 'glob reports are deterministic for identical Git inputs');
  const lifecycleSource = fs.readFileSync(modulePath, 'utf8');
  const lifecycleMatcherSource = lifecycleSource.match(/function globToRegExp\(glob\) \{[\s\S]*?\n\}/);
  assert.ok(lifecycleMatcherSource, 'doc-lifecycle globToRegExp remains available for the consistency check');
  const lifecycleGlobToRegExp = new Function(`${lifecycleMatcherSource[0]}\nreturn globToRegExp;`)();
  for (const pattern of globPatterns) {
    const expected = corpusPaths.filter(relativePath => lifecycleGlobToRegExp(pattern).test(relativePath)).length;
    const summary = globSummaries.find(item => item.kind === 'governed' && item.path === pattern);
    assert.ok(summary, `glob summary exists for ${pattern}`);
    assert.strictEqual(summary.baseMembers, expected, `guard matcher agrees with doc-lifecycle for ${pattern}`);
    assert.strictEqual(summary.candidateMembers, expected, `candidate matcher agrees with doc-lifecycle for ${pattern}`);
    const expectedPaths = corpusPaths.filter(relativePath => lifecycleGlobToRegExp(pattern).test(relativePath)).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const actualPaths = globAccepted.report.policyPreservation.configuredPaths.paths
      .filter(item => item.kind === 'governed' && item.pattern === pattern).map(item => item.path);
    assert.deepStrictEqual(actualPaths, expectedPaths, `guard matcher returns the same members as doc-lifecycle for ${pattern}`);
  }
  assert.strictEqual(globSummaries.find(item => item.path === 'empty/*.md').baseMembers, 0, 'an empty glob is legal and reports zero members');

  resetFixture(globFixture);
  writeRelative(globFixture.root, 'docs/adr/one.md', 'revised governed glob member\n');
  const globRevisionCandidate = commitFixture(globFixture.root, 'revise glob member');
  const globRevision = runFrozenGuard(globFixture, globFixture.base, globRevisionCandidate);
  assert.strictEqual(globRevision.status, 0, 'a regular governed glob member revision passes');
  const globRevisionEntry = globRevision.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/one.md');
  assert.strictEqual(globRevisionEntry.state, 'revised');

  resetFixture(globFixture);
  writeRelative(globFixture.root, 'docs/adr/new.md', 'new governed glob member\n');
  const globAdditionCandidate = commitFixture(globFixture.root, 'add glob member');
  const globAddition = runFrozenGuard(globFixture, globFixture.base, globAdditionCandidate);
  assert.strictEqual(globAddition.status, 2, 'a new glob member requires review');
  assert.strictEqual(globAddition.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/new.md').state, 'review_required');

  resetFixture(globFixture);
  fixtureGit(globFixture.root, ['rm', '--quiet', '--', 'docs/adr/two.md']);
  const globDeletionCandidate = commitFixture(globFixture.root, 'delete glob member');
  const globDeletion = runFrozenGuard(globFixture, globFixture.base, globDeletionCandidate);
  assert.strictEqual(globDeletion.status, 2, 'a deleted glob member requires review');
  assert.strictEqual(globDeletion.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/two.md').candidate, null);

  resetFixture(globFixture);
  fixtureGit(globFixture.root, ['mv', '--', 'docs/adr/one.md', 'docs/adr/renamed.md']);
  const globRenameCandidate = commitFixture(globFixture.root, 'rename glob member');
  const globRename = runFrozenGuard(globFixture, globFixture.base, globRenameCandidate);
  const globRenamePaths = globRename.report.policyPreservation.configuredPaths.paths;
  assert.strictEqual(globRename.status, 2, 'a rename within a glob requires review');
  assert.strictEqual(globRenamePaths.find(item => item.path === 'docs/adr/one.md').candidate, null, 'rename retains the old endpoint');
  assert.strictEqual(globRenamePaths.find(item => item.path === 'docs/adr/renamed.md').base, null, 'rename retains the new endpoint');

  for (const mutation of ['mode', 'symlink', 'gitlink']) {
    resetFixture(globFixture);
    if (mutation === 'mode') {
      const candidate = commitFixture(globFixture.root, 'change glob member mode', 'docs/adr/one.md');
      const result = runFrozenGuard(globFixture, globFixture.base, candidate);
      assert.strictEqual(result.status, 2, 'a glob member mode change requires review');
      assert.strictEqual(result.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/one.md').state, 'review_required');
      continue;
    }
    fs.rmSync(path.join(globFixture.root, 'docs', 'adr', 'one.md'));
    if (mutation === 'symlink') {
      const oid = fixtureGit(globFixture.root, ['hash-object', '-w', '--stdin'], Buffer.from('../outside-target.md\n')).toString('ascii').trim();
      fixtureGit(globFixture.root, ['add', '-A']);
      fixtureGit(globFixture.root, ['update-index', '--add', '--cacheinfo', `120000,${oid},docs/adr/one.md`]);
    } else {
      fixtureGit(globFixture.root, ['add', '-A']);
      fixtureGit(globFixture.root, ['update-index', '--add', '--cacheinfo', `160000,${globFixture.base},docs/adr/one.md`]);
    }
    fixtureGit(globFixture.root, ['commit', '--quiet', '-m', `replace glob member with ${mutation}`]);
    const candidate = fixtureGit(globFixture.root, ['rev-parse', 'HEAD']).toString('ascii').trim();
    const result = runFrozenGuard(globFixture, globFixture.base, candidate);
    assert.strictEqual(result.status, 2, `a glob member ${mutation} requires review`);
    assert.strictEqual(result.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/one.md').state, 'review_required');
  }

  resetFixture(globFixture);
  writeRelative(globFixture.root, 'generated/view.md', 'changed derived glob output\n');
  const derivedGlobCandidate = commitFixture(globFixture.root, 'change derived glob member');
  const derivedGlob = runFrozenGuard(globFixture, globFixture.base, derivedGlobCandidate);
  assert.strictEqual(derivedGlob.status, 2, 'a derived glob member content change requires review');
  assert.strictEqual(derivedGlob.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'generated/view.md').state, 'review_required');

  if (process.platform !== 'win32') {
    resetFixture(globFixture);
    const unusualPath = 'docs/adr/new\nfile.md';
    const oid = fixtureGit(globFixture.root, ['hash-object', '-w', '--stdin'], Buffer.from('unusual glob member\n')).toString('ascii').trim();
    fixtureGit(globFixture.root, ['update-index', '--add', '--cacheinfo', `100644,${oid},${unusualPath}`]);
    fixtureGit(globFixture.root, ['commit', '--quiet', '-m', 'add unusual glob member']);
    const unusualCandidate = fixtureGit(globFixture.root, ['rev-parse', 'HEAD']).toString('ascii').trim();
    const unusual = runFrozenGuard(globFixture, globFixture.base, unusualCandidate);
    assert.strictEqual(unusual.status, 2, 'a glob matches paths containing unusual LF bytes');
    assert.strictEqual(unusual.report.policyPreservation.configuredPaths.paths.find(item => item.path === unusualPath).state, 'review_required');
  }

  if (process.platform !== 'win32') {
    // Known divergence: doc-lifecycle.js still excludes line terminators in glob segments.
    const newlineGlobFixture = createFixture('governance-guard-newline-glob-git');
    resetFixture(newlineGlobFixture);
    writeRelative(newlineGlobFixture.root, '.agents/harness-everything/project-docs.json', `${JSON.stringify({
      governed: [{ path: 'docs/**/*.md', role: 'reference' }],
      derived: []
    }, null, 2)}\n`);
    writeRelative(newlineGlobFixture.root, 'docs/anchor.md', 'baseline direct child\n');
    writeRelative(newlineGlobFixture.root, 'docs/a\nb/file.md', 'baseline newline directory member\n');
    writeRelative(newlineGlobFixture.root, 'docs/a/b/file.md', 'baseline regular directory member\n');
    newlineGlobFixture.base = commitFixture(newlineGlobFixture.root, 'newline glob policy baseline');

    fixtureGit(newlineGlobFixture.root, ['rm', '--quiet', '--', 'docs/a\nb/file.md']);
    const newlineDeletionCandidate = commitFixture(newlineGlobFixture.root, 'delete newline directory member');
    const newlineDeletion = runFrozenGuard(newlineGlobFixture, newlineGlobFixture.base, newlineDeletionCandidate);

    resetFixture(newlineGlobFixture);
    writeRelative(newlineGlobFixture.root, 'docs/a\nb/new.md', 'new newline directory member\n');
    const newlineAdditionCandidate = commitFixture(newlineGlobFixture.root, 'add newline directory member');
    const newlineAddition = runFrozenGuard(newlineGlobFixture, newlineGlobFixture.base, newlineAdditionCandidate);

    resetFixture(newlineGlobFixture);
    fixtureGit(newlineGlobFixture.root, ['rm', '--quiet', '--', 'docs/a/b/file.md']);
    const regularDeletionCandidate = commitFixture(newlineGlobFixture.root, 'delete regular directory member');
    const regularDeletion = runFrozenGuard(newlineGlobFixture, newlineGlobFixture.base, regularDeletionCandidate);

    assert.deepStrictEqual({
      newlineDirectoryDeletion: newlineDeletion.status,
      newlineDirectoryAddition: newlineAddition.status,
      regularDirectoryDeletion: regularDeletion.status
    }, {
      newlineDirectoryDeletion: 2,
      newlineDirectoryAddition: 2,
      regularDirectoryDeletion: 2
    }, 'newline-directory deletions and additions require review; regular-directory deletion is the positive control');
  }

  resetFixture(globFixture);
  const narrowedPolicy = JSON.parse(fs.readFileSync(path.join(globFixture.root, '.agents/harness-everything/project-docs.json'), 'utf8'));
  narrowedPolicy.governed[0].path = 'docs/adr/one.md';
  writeRelative(globFixture.root, '.agents/harness-everything/project-docs.json', `${JSON.stringify(narrowedPolicy, null, 2)}\n`);
  fixtureGit(globFixture.root, ['rm', '--quiet', '--', 'docs/adr/two.md']);
  const narrowedCandidate = commitFixture(globFixture.root, 'narrow governed glob');
  const narrowed = runFrozenGuard(globFixture, globFixture.base, narrowedCandidate);
  assert.strictEqual(narrowed.status, 2, 'candidate policy cannot narrow base glob coverage');
  assert.strictEqual(narrowed.report.policyPreservation.governed.state, 'review_required', 'candidate glob changes remain policy review');
  assert.strictEqual(narrowed.report.policyPreservation.configuredPaths.paths.find(item => item.path === 'docs/adr/two.md').candidate, null);

  for (const unsupported of ['docs/adr/*.md?', 'docs/adr/[a].md', 'docs/adr/{a}.md', '/docs/adr/*.md', 'docs/../*.md']) {
    resetFixture(globFixture);
    const invalidPolicy = JSON.parse(fs.readFileSync(path.join(globFixture.root, '.agents/harness-everything/project-docs.json'), 'utf8'));
    invalidPolicy.governed.push({ path: unsupported, role: 'reference' });
    writeRelative(globFixture.root, '.agents/harness-everything/project-docs.json', `${JSON.stringify(invalidPolicy, null, 2)}\n`);
    const invalidCandidate = commitFixture(globFixture.root, `unsupported pattern ${unsupported}`);
    const invalid = runFrozenGuard(globFixture, globFixture.base, invalidCandidate);
    assert.strictEqual(invalid.status, 1, `unsupported glob syntax fails closed: ${unsupported}`);
    assert.strictEqual(invalid.report.verdict, 'FAIL');
  }

  for (const mutation of ['rename', 'mode', 'symlink']) {
    resetFixture(fixture);
    const relativePath = 'docs/architecture.md';
    if (mutation === 'rename') {
      fixtureGit(fixture.root, ['mv', '--', relativePath, 'docs/renamed-architecture.md']);
    } else if (mutation === 'symlink') {
      fs.rmSync(path.join(fixture.root, ...relativePath.split('/')));
      const oid = fixtureGit(fixture.root, ['hash-object', '-w', '--stdin'], Buffer.from('../outside-target.md\n')).toString('ascii').trim();
      fixtureGit(fixture.root, ['add', '-A']);
      fixtureGit(fixture.root, ['update-index', '--add', '--cacheinfo', `120000,${oid},${relativePath}`]);
      fixtureGit(fixture.root, ['commit', '--quiet', '-m', 'replace governed document with symlink']);
    }
    const candidate = mutation === 'symlink'
      ? fixtureGit(fixture.root, ['rev-parse', 'HEAD']).toString('ascii').trim()
      : commitFixture(fixture.root, `${mutation} governed document`, mutation === 'mode' ? relativePath : undefined);
    const result = runFrozenGuard(fixture, fixture.base, candidate);
    assert.strictEqual(result.status, 2, `${mutation} of a governed entry requires review`);
    assert.strictEqual(result.report.verdict, 'REVIEW_REQUIRED');
    const item = result.report.policyPreservation.configuredPaths.missingOrChanged.find(entry => entry.path === relativePath);
    assert.ok(item, `${mutation} is reported for the original configured path`);
    assert.strictEqual(item.state, 'review_required');
    assert.deepStrictEqual(item.base, configuredIdentity(fixture.base, relativePath));
    if (mutation === 'rename') assert.strictEqual(item.candidate, null);
    if (mutation === 'mode') assert.notStrictEqual(item.base.mode, item.candidate.mode);
    if (mutation === 'symlink') assert.strictEqual(item.candidate.mode, '120000');
  }

  resetFixture(fixture);
  fixtureGit(fixture.root, ['rm', '--quiet', '--', 'docs/architecture.md']);
  const deletedGovernedCandidate = commitFixture(fixture.root, 'delete configured document');
  const deletedGoverned = runFrozenGuard(fixture, fixture.base, deletedGovernedCandidate);
  assert.strictEqual(deletedGoverned.status, 2);
  assert.strictEqual(deletedGoverned.report.verdict, 'REVIEW_REQUIRED');
  assert.ok(deletedGoverned.report.policyPreservation.configuredPaths.missingOrChanged.some(item => item.path === 'docs/architecture.md'));

  resetFixture(fixture);
  const registeredPolicy = JSON.parse(fs.readFileSync(path.join(fixture.root, '.agents/harness-everything/project-docs.json'), 'utf8'));
  registeredPolicy.governed.push({ path: 'docs/new-governed.md', role: 'reference' });
  writeRelative(fixture.root, '.agents/harness-everything/project-docs.json', `${JSON.stringify(registeredPolicy, null, 2)}\n`);
  writeRelative(fixture.root, 'docs/new-governed.md', 'newly registered governed member\n');
  const registrationCandidate = commitFixture(fixture.root, 'register governed document');
  const registration = runFrozenGuard(fixture, fixture.base, registrationCandidate);
  assert.strictEqual(registration.status, 2, 'new-member registration requires review');
  assert.strictEqual(registration.report.verdict, 'REVIEW_REQUIRED');
  assert.ok(registration.report.policyPreservation.governed.added.some(item => item.path === 'docs/new-governed.md'));

  for (const relativePath of trustedPaths) {
    resetFixture(fixture);
    if (relativePath === '.agents/harness-everything/project-docs.json') {
      const configPath = path.join(fixture.root, ...relativePath.split('/'));
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.governed.pop();
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    } else if (relativePath === '.agents/harness-everything/document-inventory.json') {
      const configPath = path.join(fixture.root, ...relativePath.split('/'));
      fs.appendFileSync(configPath, '\n');
    } else if (relativePath === 'scripts/doc-governance-guard.js') {
      writeRelative(fixture.root, relativePath, 'process.exit(0);\n');
    } else if (relativePath === 'ci/mechanism-2ax-doc-lifecycle.test.js' || relativePath === '.github/workflows/ci.yml') {
      fixtureGit(fixture.root, ['rm', '--quiet', '--', relativePath]);
    } else {
      const filePath = path.join(fixture.root, ...relativePath.split('/'));
      fs.appendFileSync(filePath, '\n// candidate mutation\n');
    }
    if (relativePath === 'scripts/doc-governance-guard.js') {
      writeRelative(fixture.root, '.harness-review-approval.json', '{"approved":true,"candidate":"self"}\n');
    }
    const candidate = commitFixture(fixture.root, `mutate ${relativePath}`);
    const result = runFrozenGuard(fixture, fixture.base, candidate);
    assert.strictEqual(result.status, 2, `${relativePath} mutation must require review: ${result.stderr}`);
    assert.strictEqual(result.report.verdict, 'REVIEW_REQUIRED', `${relativePath} cannot self-approve`);
    assert.ok(result.report.trustSurface.changed.some(item => item.path === relativePath), `${relativePath} identity change is reported`);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.report, 'approval'), 'candidate approval material is not an input');
    if (relativePath === '.agents/harness-everything/project-docs.json') {
      assert.ok(result.report.policyPreservation.governed.missingOrChanged.length, 'removed baseline governed record remains visible');
    }
  }

  for (const relativePath of ['.agents/harness-everything/project-docs.json', '.agents/harness-everything/document-inventory.json']) {
    resetFixture(fixture);
    writeRelative(fixture.root, relativePath, '{malformed\n');
    const malformedCandidate = commitFixture(fixture.root, `malformed candidate ${relativePath}`);
    const malformed = runFrozenGuard(fixture, fixture.base, malformedCandidate);
    assert.strictEqual(malformed.status, 1);
    assert.strictEqual(malformed.report.verdict, 'FAIL');
    assert.match(malformed.report.errors[0].message, /malformed JSON/i);
  }

  resetFixture(fixture);
  fs.writeFileSync(path.join(fixture.root, '.agents/harness-everything/project-docs.json'), '{malformed\n');
  const malformedBase = commitFixture(fixture.root, 'malformed baseline policy');
  fs.writeFileSync(ordinaryPath, 'candidate follows malformed baseline\n');
  const afterMalformedBase = commitFixture(fixture.root, 'candidate after malformed baseline');
  const malformedBaseline = runFrozenGuard(fixture, malformedBase, afterMalformedBase);
  assert.strictEqual(malformedBaseline.status, 1);
  assert.strictEqual(malformedBaseline.report.verdict, 'FAIL');

  resetFixture(fixture);
  fixtureGit(fixture.root, ['rm', '--quiet', '--', 'scripts/doc-governance-guard.js']);
  const noGuardBase = commitFixture(fixture.root, 'baseline predates verifier');
  fs.writeFileSync(ordinaryPath, 'candidate without baseline verifier\n');
  const noGuardCandidate = commitFixture(fixture.root, 'candidate before verifier bootstrap');
  const bootstrap = runFrozenGuard(fixture, noGuardBase, noGuardCandidate);
  assert.strictEqual(bootstrap.status, 3);
  assert.strictEqual(bootstrap.report.verdict, 'BOOTSTRAP_UNCHECKED');
  assert.strictEqual(bootstrap.report.verifier.matchesBaseObject, false);

  const missingCandidate = runFrozenGuard(fixture, fixture.base, null);
  assert.strictEqual(missingCandidate.status, 1);
  assert.strictEqual(missingCandidate.report.verdict, 'FAIL');
  const missingCommit = runFrozenGuard(fixture, fixture.base, '0'.repeat(40));
  assert.notStrictEqual(missingCommit.status, 0);
  assert.notStrictEqual(missingCommit.report.verdict, 'PASS');

  checkCase('2ax. CI workflow keeps the base-owned guard in a failing standalone job', () => {
    const workflowPath = path.join(REPOSITORY_ROOT, '.github/workflows/ci.yml');
    const workflow = require('js-yaml').load(fs.readFileSync(workflowPath, 'utf8'));
    const job = workflow.jobs['doc-governance'];
    assert.ok(job, 'standalone doc-governance job exists');
    assert.strictEqual(job['runs-on'], 'ubuntu-latest');
    assert.notStrictEqual(job['continue-on-error'], true, 'the job does not mask guard failures');
    assert.ok(job.steps.some(step => step.uses === 'actions/checkout@v7' && step.with['fetch-depth'] === 0), 'job fetches base Git objects');
    assert.ok(job.steps.some(step => step.uses === 'actions/setup-node@v7' && step.with['node-version'] === 24), 'job provides Node 24');
    const guardStep = job.steps.find(step => step.name === 'Run base-owned document governance guard');
    assert.ok(guardStep, 'standalone job owns the guard step');
    assert.notStrictEqual(guardStep['continue-on-error'], true, 'the guard step propagates nonzero exits');
    assert.ok(!workflow.jobs['self-regression'].steps.some(step => step.name === guardStep.name), 'self-regression no longer runs the guard');
    const command = String(guardStep.run || '').trimEnd();
    const inline = command.match(/^node -e '([\s\S]*)'$/);
    assert.ok(inline, 'guard step remains a directly executable Node script');

    function simulate(event, base, candidate) {
      const summaryPath = path.join(tempRoot, `guard-summary-${process.pid}-${Math.random().toString(16).slice(2)}.md`);
      const result = spawnSync(process.execPath, ['-e', inline[1]], {
        cwd: fixture.root,
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          HARNESS_GUARD_EVENT: event,
          HARNESS_GUARD_BASE_SHA: base || '',
          HARNESS_GUARD_CANDIDATE_SHA: candidate || '',
          GITHUB_SHA: 'checkout-control',
          GITHUB_STEP_SUMMARY: summaryPath
        }
      });
      const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '';
      fs.rmSync(summaryPath, { force: true });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout, summary };
    }

    const uncheckedEvent = simulate('push');
    assert.strictEqual(uncheckedEvent.status, 0);
    assert.match(uncheckedEvent.output, /UNCHECKED/);
    const bootstrapEvent = simulate('pull_request', noGuardBase, noGuardCandidate);
    assert.strictEqual(bootstrapEvent.status, 0, 'missing base verifier remains bootstrap-warning only');
    assert.match(bootstrapEvent.output, /BOOTSTRAP_UNCHECKED/);
    assert.match(bootstrapEvent.summary, /BOOTSTRAP_UNCHECKED/);
    const passEvent = simulate('pull_request', fixture.base, fixture.base);
    assert.strictEqual(passEvent.status, 0);
    assert.match(passEvent.output, /"verdict": "PASS"/);

    resetFixture(fixture);
    writeRelative(fixture.root, 'docs/governed-index.md', 'changed derived output for CI simulation\n');
    const reviewCandidate = commitFixture(fixture.root, 'simulate guard review failure');
    const reviewEvent = simulate('pull_request', fixture.base, reviewCandidate);
    assert.strictEqual(reviewEvent.status, 2, 'REVIEW_REQUIRED stays a failing workflow job');
    assert.match(reviewEvent.output, /"verdict": "REVIEW_REQUIRED"/);

    for (const exitCode of [1, 3]) {
      resetFixture(fixture);
      writeRelative(fixture.root, 'scripts/doc-governance-guard.js', `process.exit(${exitCode});\n`);
      const base = commitFixture(fixture.root, `simulate base guard exit ${exitCode}`);
      const result = simulate('pull_request', base, base);
      assert.strictEqual(result.status, exitCode, `the standalone job propagates guard exit ${exitCode}`);
    }
  });
});

helper.finish();

'use strict';

// testProfile: "integration"
// D6.9 contract source: docs/document-lifecycle.md, section "Contract-style
// PRD revisions". API assumptions kept here are explicit and guarded by
// assertions so a missing API is reported as expected RED, never as TypeError.
// `storedBytes` is the pure-API byte input used by these fixtures; Git-backed
// tests exercise collected file bytes separately. diffRevisions' JSON shape
// and changed.reviewRequired are INFERRED from the D6.9 owner fixture review.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-lifecycle.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'doc-lifecycle', 'prd-revisions');
const CONFIG = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'config.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2ay revisions-測試-'));
const gitGlobalConfig = path.join(tempRoot, 'empty global git config');
const gitHooksDir = path.join(tempRoot, 'empty hooks');
const gitTemplateDir = path.join(tempRoot, 'empty templates');
const gitAttributesFile = path.join(tempRoot, 'empty attributes');
fs.writeFileSync(gitGlobalConfig, '', 'utf8');
fs.writeFileSync(gitAttributesFile, '', 'utf8');
fs.mkdirSync(gitHooksDir, { recursive: true });
fs.mkdirSync(gitTemplateDir, { recursive: true });

function gitEnvironment() {
  const env = { ...process.env };
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_SYSTEM;
  env.GIT_CONFIG_GLOBAL = gitGlobalConfig;
  env.GIT_CONFIG_NOSYSTEM = '1';
  for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[key];
  for (const key of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  return env;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Independent oracle from the D6.9 digest contract: SHA-256 of sorted-key
// JSON(frontmatter minus status/effective_at/approval), LF, then stored body;
// artifact digest is SHA-256 over the complete stored file bytes.
function approvalContentDigest(frontmatter, body) {
  const projected = Object.fromEntries(Object.entries(frontmatter)
    .filter(([key]) => !['status', 'effective_at', 'approval'].includes(key)));
  return sha256(Buffer.concat([Buffer.from(`${sortedJson(projected)}\n`, 'utf8'), Buffer.from(body, 'utf8')]));
}

let lifecycle;
try {
  lifecycle = require(modulePath);
} catch (error) {
  helper.check('2ay. D6.9 lifecycle module is available', false, error.message);
  helper.finish();
}

process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));
console.log('\n[2ay] D6.9 contract-style PRD revisions (RED fixtures)...');

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.stack ? error.stack : String(error));
  }
}

function scalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(item => scalar(item)).join(', ')}]`;
  throw new TypeError(`unsupported fixture scalar: ${typeof value}`);
}

function fieldLines(key, value, indent = 0) {
  const prefix = ' '.repeat(indent);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return [`${prefix}${key}:`, ...Object.entries(value).flatMap(([child, nested]) => fieldLines(child, nested, indent + 2))];
  }
  return [`${prefix}${key}: ${scalar(value)}`];
}

function yaml(frontmatter) {
  return Object.entries(frontmatter).flatMap(([key, value]) => fieldLines(key, value)).join('\n');
}

function renderSource(frontmatter, body = '', eol = '\n') {
  return `---\n${yaml(frontmatter)}\n---\n${body}`.replace(/\n/g, eol);
}

function writeDoc(root, relativePath, frontmatter, body = '', eol = '\n') {
  const absolute = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, renderSource(frontmatter, body, eol), 'utf8');
  return absolute;
}

function parseGeneratedSource(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(match, 'generated fixture keeps opening and closing frontmatter delimiters');
  const data = {};
  let nested = null;
  const parseValue = value => {
    const token = value.trim();
    if (token.startsWith('"') || token.startsWith('[')) return JSON.parse(token);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    return token;
  };
  for (const line of match[1].split(/\r?\n/)) {
    const child = line.match(/^  ([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/);
    if (child) {
      assert.ok(nested, `nested field has a declared parent: ${line}`);
      nested[child[1]] = parseValue(child[2] || '');
      continue;
    }
    const field = line.match(/^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/);
    assert.ok(field, `generated frontmatter field parses: ${line}`);
    const value = field[2] || '';
    if (!value) {
      data[field[1]] = {};
      nested = data[field[1]];
    } else {
      data[field[1]] = parseValue(value);
      nested = null;
    }
  }
  return { data, body: match[2] };
}

function docObject(relativePath, frontmatter, body = '') {
  const storedBytes = Buffer.from(renderSource(frontmatter, body), 'utf8');
  const doc = {
    path: relativePath,
    role: relativePath.startsWith('docs/prd/') ? 'prd' : 'report',
    legacy: relativePath.includes('/legacy/'),
    frontmatter: { ...frontmatter },
    body,
    error: null
  };
  Object.defineProperty(doc, 'storedBytes', { value: storedBytes, enumerable: false, writable: true });
  return doc;
}

function pin(id, revision, requirement) {
  return `${id}@r${revision}${requirement ? `#${requirement}` : ''}`;
}

function revisionDoc(options, priorDoc) {
  const {
    id = 'PRD-GRPH-001',
    revision,
    status = 'draft',
    body = '# Contract\n\nComplete acceptance snapshot.\n',
    relativePath = `docs/prd/sample/r${String(revision).padStart(3, '0')}.md`,
    previousRevision,
    previousDigest,
    draftedBy = 'Alex Drafting Agent',
    ...extra
  } = options;
  const frontmatter = { id, revision, status, drafted_by: draftedBy, ...extra };
  if (previousRevision !== undefined) frontmatter.previous_revision = previousRevision;
  if (previousDigest !== undefined) frontmatter.previous_digest = previousDigest;
  else if (previousRevision !== undefined && priorDoc) frontmatter.previous_digest = sha256(priorDoc.storedBytes);
  if (status === 'effective') frontmatter.effective_at = frontmatter.effective_at || '2026-10-17T00:01:00Z';
  if (status === 'approved' || status === 'effective') {
    frontmatter.approval = {
      by: 'Independent cold verifier',
      at: '2026-10-17T00:00:00Z',
      ref: 'https://approvals.example.invalid/prd-review/001',
      role: 'human',
      content_digest: ''
    };
    frontmatter.approval.content_digest = approvalContentDigest(frontmatter, body);
  }
  return docObject(relativePath, frontmatter, body);
}

function reviseFixture(doc, changes, { rebindApproval = true } = {}) {
  const frontmatter = { ...doc.frontmatter, ...changes };
  const approval = changes.approval || doc.frontmatter.approval;
  if (approval) {
    frontmatter.approval = { ...approval };
    if (rebindApproval) frontmatter.approval.content_digest = approvalContentDigest(frontmatter, doc.body);
  }
  return docObject(doc.path, frontmatter, doc.body);
}

function lintDocs(docs, options = { all: true }) {
  return analyzeDocs(docs, options).diagnostics;
}

function analyzeDocs(docs, options = { all: true }) {
  assert.strictEqual(typeof lifecycle.analyzeDocs, 'function', 'D6.9 exports analyzeDocs(docs, config, opts)');
  return lifecycle.analyzeDocs(docs, CONFIG, options);
}

function assertEnvelope(result, disposition) {
  assert.ok(result && typeof result === 'object' && !Array.isArray(result), 'analysis is an object envelope');
  assert.ok(Array.isArray(result.diagnostics), 'analysis.diagnostics is an array');
  assert.ok(result.evidence && typeof result.evidence === 'object', 'analysis.evidence is present');
  assert.strictEqual(result.evidence.immutability, disposition);
  const roundTrip = JSON.parse(JSON.stringify(result));
  assert.strictEqual(roundTrip.evidence.immutability, disposition, 'JSON serialization preserves evidence disposition');
  return result;
}

function codes(diagnostics) {
  return diagnostics.map(item => item.code);
}

function matching(diagnostics, code) {
  return diagnostics.filter(item => item.code === code);
}

function expectCode(diagnostics, code, detail = '') {
  assert.ok(matching(diagnostics, code).length > 0, `${code} expected${detail ? `: ${detail}` : ''}; got ${JSON.stringify(diagnostics)}`);
  return matching(diagnostics, code);
}

function expectOnlyCodes(diagnostics, expected) {
  const actual = [...new Set(diagnostics.map(item => item.code))].sort();
  assert.deepStrictEqual(actual, [...expected].sort(), `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
}

function forbidCode(diagnostics, code) {
  assert.strictEqual(matching(diagnostics, code).length, 0, `${code} unexpected: ${JSON.stringify(diagnostics)}`);
}

function revisionIds(body) {
  return [...body.matchAll(/^### (REQ-[A-Z0-9-]+)(?: \([^)]*\))?:/gm)].map(match => match[1]).sort();
}

function fixtureBody(name) {
  return fs.readFileSync(path.join(fixtureRoot, 'ten-reqs', name), 'utf8');
}

function git(root, args, input) {
  return execFileSync('git', [
    '-c', `core.hooksPath=${gitHooksDir}`,
    '-c', `core.attributesFile=${gitAttributesFile}`,
    '-c', 'core.safecrlf=false',
    '-c', 'commit.gpgsign=false',
    ...args
  ], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: gitEnvironment()
  }).trim();
}

function gitBytes(root, args, input) {
  return execFileSync('git', [
    '-c', `core.hooksPath=${gitHooksDir}`,
    '-c', `core.attributesFile=${gitAttributesFile}`,
    '-c', 'commit.gpgsign=false',
    ...args
  ], { cwd: root, encoding: 'buffer', input, env: gitEnvironment() });
}

function gitRepo(name, autocrlf = 'false') {
  const root = path.join(tempRoot, `repo with spaces – 臺灣 ${name}`);
  fs.mkdirSync(root, { recursive: true });
  git(root, ['-c', `init.templateDir=${gitTemplateDir}`, 'init', '--quiet']);
  git(root, ['config', 'core.autocrlf', autocrlf]);
  git(root, ['config', 'core.attributesFile', gitAttributesFile]);
  git(root, ['config', 'core.safecrlf', 'false']);
  git(root, ['config', 'core.hooksPath', gitHooksDir]);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'user.name', 'D6.9 Test']);
  git(root, ['config', 'user.email', 'd69-tests@example.invalid']);
  fs.writeFileSync(path.join(root, '.gitattributes'), `*.md text eol=${autocrlf === 'true' ? 'crlf' : 'lf'}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'lifecycle-config.json'), JSON.stringify(CONFIG, null, 2), 'utf8');
  return root;
}

function commitAll(root, message) {
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function baseLint(root, baseRevision) {
  const configPath = path.join(root, 'lifecycle-config.json');
  const result = spawnSync(process.execPath, [
    modulePath,
    'lint',
    '--workspace', root,
    '--config', configPath,
    '--all',
    '--base',
    baseRevision
  ], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  assert.ifError(result.error);
  assert.ok([0, 1].includes(result.status), `--base CLI must return a behavior result, not argument/setup failure (status ${result.status}; stderr: ${result.stderr}; stdout: ${result.stdout})`);
  const output = JSON.parse(result.stdout);
  assert.ok(output && Array.isArray(output.diagnostics) && output.evidence, `CLI JSON must be an analysis envelope: ${result.stdout}`);
  return output;
}

function inventoryAt(root, baseRevision) {
  const paths = gitBytes(root, ['ls-tree', '-r', '--name-only', '-z', '--full-tree', baseRevision])
    .toString('utf8').split('\0').filter(Boolean);
  return paths.map(relativePath => {
    let bytes;
    try { bytes = gitBytes(root, ['show', `${baseRevision}:${relativePath}`]); } catch { return null; }
    const parsed = lifecycle.parseFrontmatter(bytes.toString('utf8'));
    if (parsed.error || !parsed.data || typeof parsed.data.id !== 'string') return null;
    return {
      id: parsed.data.id,
      revision: parsed.data.revision,
      path: relativePath,
      status: parsed.data.status,
      bytes
    };
  }).filter(Boolean);
}

function seedRevisionRepo(name, status, autocrlf = 'false', beforeCommit) {
  const root = gitRepo(name, autocrlf);
  const body = '# Immutable baseline\n\nAcceptance: preserve this exact contract.\n';
  const seed = revisionDoc({ id: 'PRD-GRPH-001', revision: 1, status, body, relativePath: 'docs/prd/sample/r001.md' });
  const doc = reviseFixture(seed, {
    approval: seed.frontmatter.approval
      ? { ...seed.frontmatter.approval, ref: 'docs/approvals/prd-review.md' }
      : undefined
  });
  const digest = sha256(doc.storedBytes);
  const file = path.join(root, 'docs/prd/sample/r001.md');
  writeDoc(root, 'docs/prd/sample/r001.md', doc.frontmatter, body);
  writeDoc(root, 'docs/approvals/prd-review.md', { id: 'APPROVAL-001', status: 'final' }, '# Independent review record\n');
  if (typeof beforeCommit === 'function') beforeCommit(root, digest);
  return { root, body, digest, base: commitAll(root, `${status} PRD baseline`) };
}

function seedEffectiveRepo(name, autocrlf = 'false', beforeCommit) {
  return seedRevisionRepo(name, 'effective', autocrlf, beforeCommit);
}

function seedApprovedRepo(name, autocrlf = 'false') {
  return seedRevisionRepo(name, 'approved', autocrlf);
}

function mutateRevision(root, fields, body, relativePath = 'docs/prd/sample/r001.md') {
  const file = path.join(root, ...relativePath.split('/'));
  const originalSource = fs.readFileSync(file, 'utf8');
  let source = originalSource;
  const firstLine = source.indexOf('\n') + 1;
  const delimiter = source.slice(firstLine).match(/\r?\n---[ \t]*\r?\n/);
  const closing = delimiter ? firstLine + delimiter.index : -1;
  assert.notStrictEqual(closing, -1, 'test fixture must contain a closing frontmatter delimiter');
  let header = source.slice(firstLine, closing);
  for (const [key, value] of Object.entries(fields)) {
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    if (pattern.test(header)) header = header.replace(pattern, `${key}: ${scalar(value)}`);
    else header += `${header ? '\n' : ''}${key}: ${scalar(value)}`;
  }
  const originalBody = source.slice(closing + delimiter[0].length);
  const nextBody = body === undefined ? originalBody : body;
  source = `---\n${header}\n---\n${nextBody}`;
  fs.writeFileSync(file, source, 'utf8');
  const parsed = parseGeneratedSource(source);
  assert.strictEqual(parsed.body, nextBody, 'mutation must preserve or replace exactly the requested body');
  const before = parseGeneratedSource(originalSource);
  for (const [key, value] of Object.entries(fields)) assert.deepStrictEqual(parsed.data[key], value, `mutated ${key} field`);
  for (const [key, value] of Object.entries(before.data)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) assert.deepStrictEqual(parsed.data[key], value, `unrequested ${key} field remains unchanged`);
  }
  return file;
}

function diffRevisions(docs, refA, refB) {
  assert.strictEqual(typeof lifecycle.diffRevisions, 'function', 'D6.9 exports diffRevisions(docs, refA, refB)');
  return lifecycle.diffRevisions(docs, refA, refB);
}

function assertResolve(docs, ref, expected) {
  assert.strictEqual(typeof lifecycle.resolveRef, 'function', 'D6.9 reference resolver is exported');
  const result = lifecycle.resolveRef(docs, ref);
  assert.ok(result && result.doc, `${ref} should resolve; got ${JSON.stringify(result)}`);
  if (expected.path) assert.strictEqual(result.doc.path, expected.path, `${ref} path`);
  if (expected.revision !== undefined) assert.strictEqual(result.revision, expected.revision, `${ref} revision`);
  if (expected.status !== undefined) assert.strictEqual(result.status, expected.status, `${ref} status`);
  if (expected.digest) {
    const sourceDoc = docs.find(item => item.path === result.doc.path);
    assert.ok(sourceDoc && Buffer.isBuffer(sourceDoc.storedBytes), `${ref} fixture includes complete stored artifact bytes`);
    const wanted = expected.digest === true ? sha256(sourceDoc.storedBytes) : expected.digest;
    assert.strictEqual(result.digest, wanted, `${ref} independently computed artifact digest`);
  }
  if (expected.requirement) assert.strictEqual(result.requirement && result.requirement.id, expected.requirement, `${ref} requirement`);
  if (expected.provenance) assert.ok(result.provenance, `${ref} returns revision provenance`);
  return result;
}

checkCase('2ay digest oracle matches fixed approval-projection and complete-artifact vectors', () => {
  const doc = revisionDoc({ revision: 1, status: 'effective' });
  assert.strictEqual(doc.frontmatter.approval.content_digest, 'sha256:67adaca2af0a1c3e946fc21dfc6902aa87664745ad663972f0b0ba88ece33946', 'projection hash is independently pinned');
  assert.strictEqual(sha256(doc.storedBytes), 'sha256:be4d183e4a6e4ffd786202de1d2e7a733fc0e308db395c437bfeba28a2092ec1', 'complete stored-file hash is independently pinned');
  assert.notStrictEqual(doc.frontmatter.approval.content_digest, sha256(doc.storedBytes), 'approval and artifact identities remain distinct');
});

checkCase('2ay golden valid chain is clean and one-rule digest mutations are discriminating', () => {
  const first = revisionDoc({ revision: 1, status: 'effective', body: fixtureBody('r001.body.md') });
  const second = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1, body: fixtureBody('r002-one-replaced.body.md') }, first);
  const golden = assertEnvelope(analyzeDocs([first, second]), 'not-observed');
  assert.deepStrictEqual(golden.diagnostics, [], 'independently valid linked revisions produce no structural diagnostics');

  const wrongArtifactLink = reviseFixture(second, {
    previous_digest: sha256(Buffer.from('not the parent artifact', 'utf8'))
  });
  expectOnlyCodes(lintDocs([first, wrongArtifactLink]), ['revision-digest-mismatch']);

  const wrongApproval = reviseFixture(second, {}, { rebindApproval: false });
  wrongApproval.frontmatter.approval.content_digest = sha256(Buffer.from('not the approved projection', 'utf8'));
  wrongApproval.storedBytes = Buffer.from(renderSource(wrongApproval.frontmatter, wrongApproval.body), 'utf8');
  expectOnlyCodes(lintDocs([first, wrongApproval]), ['approval-content-mismatch']);
});

checkCase('2ay approval requires a complete independent reviewer record and a resolvable evidence ref', () => {
  const first = revisionDoc({ revision: 1, status: 'effective' });
  const approved = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1 }, first);
  for (const field of ['by', 'at', 'ref', 'content_digest', 'role']) {
    const incompleteFm = { ...approved.frontmatter, approval: { ...approved.frontmatter.approval } };
    delete incompleteFm.approval[field];
    const incomplete = docObject(approved.path, incompleteFm, approved.body);
    expectCode(lintDocs([first, incomplete]), 'approval-missing', `approval.${field}`);
  }

  const selfApproved = reviseFixture(approved, {
    approval: { ...approved.frontmatter.approval, by: approved.frontmatter.drafted_by }
  });
  expectOnlyCodes(lintDocs([first, selfApproved]), ['approval-not-independent']);

  const root = gitRepo('approval-evidence-ref');
  const approvedSeed = revisionDoc({ revision: 1, status: 'approved', relativePath: 'docs/prd/sample/r001.md' });
  const approvedOnDisk = reviseFixture(approvedSeed, {
    approval: { ...approvedSeed.frontmatter.approval, ref: 'docs/approvals/prd-review.md' }
  });
  writeDoc(root, approvedOnDisk.path, approvedOnDisk.frontmatter, approvedOnDisk.body);
  writeDoc(root, approvedOnDisk.frontmatter.approval.ref, { id: 'APPROVAL-001', status: 'final' }, '# Review record\n');
  const validRecord = analyzeDocs(lifecycle.collectDocs(root, CONFIG), { all: true });
  assert.deepStrictEqual(validRecord.diagnostics.filter(item => item.severity === 'error'), [], 'an in-repo approval ref resolves offline');
  fs.unlinkSync(path.join(root, ...approvedOnDisk.frontmatter.approval.ref.split('/')));
  const missingRecord = analyzeDocs(lifecycle.collectDocs(root, CONFIG), { all: true });
  assert.ok(missingRecord.diagnostics.some(item => item.severity === 'error'), 'a missing in-repo approval record is not accepted as evidence');
});

// Owner case 1 — compare against a trusted --base commit, not only a
// self-consistent previous_digest. Each mutation starts from a clean repo.
checkCase('2ay case 1. effective revision body edit is rejected against --base', () => {
  const { root, base } = seedEffectiveRepo('immutable-edit');
  mutateRevision(root, {}, '# Edited baseline\n\nAcceptance: silently changed.\n');
  expectCode(baseLint(root, base).diagnostics, 'immutable-revision-modified');
});

checkCase('2ay case 1. status downgrade cannot make a base-effective revision mutable', () => {
  const { root, base } = seedEffectiveRepo('immutable-status');
  mutateRevision(root, { status: 'draft' });
  expectCode(baseLint(root, base).diagnostics, 'immutable-revision-modified');
});

checkCase('2ay case 1. deleting a base-effective revision is rejected', () => {
  const { root, base } = seedEffectiveRepo('immutable-delete');
  fs.unlinkSync(path.join(root, 'docs/prd/sample/r001.md'));
  expectCode(baseLint(root, base).diagnostics, 'immutable-revision-deleted');
});

checkCase('2ay case 1. moving a base-effective revision outside governed scope is rejected', () => {
  const { root, base } = seedEffectiveRepo('immutable-move');
  const source = path.join(root, 'docs/prd/sample/r001.md');
  const target = path.join(root, 'docs/archive/r001.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
  const diagnostics = baseLint(root, base).diagnostics;
  assert.ok(
    diagnostics.some(item => ['immutable-revision-modified', 'immutable-revision-deleted'].includes(item.code)),
    `move should retain immutable provenance: ${JSON.stringify(diagnostics)}`
  );
});

checkCase('2ay case 1. co-editing the parent and previous_digest still fails the trusted-base comparison', () => {
  const { root, base } = seedEffectiveRepo('immutable-coedit', 'false', (repoRoot, parentDigest) => {
    writeDoc(repoRoot, 'docs/prd/sample/r002.md', {
      id: 'PRD-GRPH-001', revision: 2, previous_revision: 1,
      previous_digest: parentDigest, status: 'draft'
    }, '# Child revision\n\nAcceptance: follow the current parent.\n');
  });
  const parentFile = path.join(root, 'docs/prd/sample/r001.md');
  const parentSource = fs.readFileSync(parentFile, 'utf8');
  const closing = parentSource.indexOf('\n---\n', parentSource.indexOf('\n') + 1);
  const parentBody = parentSource.slice(closing + 5);
  const changedBody = `${parentBody}\nA coordinated parent edit.\n`;
  mutateRevision(root, {}, changedBody);
  const childFile = path.join(root, 'docs/prd/sample/r002.md');
  const candidate = lifecycle.collectDocs(root, CONFIG);
  const editedParentDigest = sha256(Buffer.from(fs.readFileSync(parentFile, 'utf8'), 'utf8'));
  const childSource = fs.readFileSync(childFile, 'utf8').replace(/^previous_digest:.*$/m, `previous_digest: ${JSON.stringify(editedParentDigest)}`);
  fs.writeFileSync(childFile, childSource, 'utf8');
  expectCode(baseLint(root, base).diagnostics, 'immutable-revision-modified');
});

checkCase('2ay case 1. absent trusted baseline is explicitly not-observed, never a pass', () => {
  const onlyRevision = revisionDoc({ revision: 1, status: 'effective' });
  const result = assertEnvelope(analyzeDocs([onlyRevision], { all: true }), 'not-observed');
  assert.deepStrictEqual(result.diagnostics, [], 'a well-formed effective snapshot can be structurally valid without a baseline');
  const projected = lifecycle.lintDocs([onlyRevision], CONFIG, { all: true });
  assert.ok(Array.isArray(projected), 'lintDocs remains the diagnostics-only compatibility projection');
  assert.deepStrictEqual(projected, result.diagnostics);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(projected, 'evidence'), false, 'callers obtain evidence from analyzeDocs, not hidden array metadata');
});

checkCase('2ay case 1. supplied stored-byte inventory is equivalent to a trusted Git base', () => {
  const effective = revisionDoc({ revision: 1, status: 'effective' });
  // INFERRED inventory option shape: the contract requires an offline snapshot
  // inventory but does not prescribe its JS representation.
  const inventory = [{
    id: effective.frontmatter.id,
    revision: effective.frontmatter.revision,
    path: effective.path,
    status: effective.frontmatter.status,
    bytes: effective.storedBytes
  }];
  const fromInventory = assertEnvelope(analyzeDocs([effective], { all: true, baseInventory: inventory }), 'observed');
  assert.deepStrictEqual(fromInventory.diagnostics, []);

  const root = gitRepo('inventory-equivalence');
  writeDoc(root, effective.path, effective.frontmatter, effective.body);
  const base = commitAll(root, 'inventory equivalence baseline');
  const fromGit = baseLint(root, base);
  assert.strictEqual(fromGit.evidence.immutability, 'observed');
  assert.deepStrictEqual(fromInventory.diagnostics, fromGit.diagnostics, 'offline byte inventory and Git blob base produce equal diagnostics');
});

checkCase('2ay case 1. CLI emits not-observed evidence without a trusted baseline', () => {
  const root = gitRepo('cli-no-base-evidence');
  const effective = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  writeDoc(root, effective.path, effective.frontmatter, effective.body);
  commitAll(root, 'valid unbaselined effective snapshot');
  const result = spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', path.join(root, 'lifecycle-config.json'), '--all'], {
    cwd: tempRoot, encoding: 'utf8', env: gitEnvironment()
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `not-observed is evidence, not an error diagnostic: ${result.stderr} ${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.evidence && output.evidence.immutability, 'not-observed');
  assert.deepStrictEqual(output.diagnostics, []);
});

checkCase('2ay case 1. missing trusted history is unavailable and is never fetched', () => {
  const remote = path.join(tempRoot, 'remote with spaces – 臺灣.git');
  fs.mkdirSync(remote, { recursive: true });
  git(remote, ['-c', `init.templateDir=${gitTemplateDir}`, 'init', '--bare', '--quiet']);
  const publisher = gitRepo('unavailable-base-publisher');
  writeDoc(publisher, 'README.md', { id: 'IGNORED' }, 'Remote-only commit.\n');
  const remoteOnly = commitAll(publisher, 'remote-only history');
  git(publisher, ['remote', 'add', 'origin', remote]);
  git(publisher, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

  const { root } = seedEffectiveRepo('unavailable-base-candidate');
  git(root, ['remote', 'add', 'origin', remote]);
  const result = spawnSync(process.execPath, [modulePath, 'lint', '--workspace', root, '--config', path.join(root, 'lifecycle-config.json'), '--all', '--base', 'refs/remotes/origin/main'], {
    cwd: tempRoot, encoding: 'utf8', env: gitEnvironment()
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `unavailable evidence alone does not fail lint: ${result.stderr} ${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.evidence && output.evidence.immutability, 'unavailable');
  const remoteTrackingRef = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  assert.strictEqual(remoteTrackingRef.status, 1, `checker must not fetch a missing base ref; remote contains ${remoteOnly}`);
});

checkCase('2ay case 1. candidate config exclusion cannot bypass immutable base inventory', () => {
  const { root, base } = seedEffectiveRepo('config-exclusion-bypass');
  mutateRevision(root, {}, '# Changed while excluded from current config.\n');
  fs.writeFileSync(path.join(root, 'lifecycle-config.json'), JSON.stringify({ governed: [], domains: ['GRPH', 'IFCE'], legacy: [] }, null, 2), 'utf8');
  expectCode(baseLint(root, base).diagnostics, 'immutable-revision-modified');
});

// Owner case 2 — drafts remain editable but never displace the current
// effective revision; rejected drafts are never selectable.
checkCase('2ay case 2. a complete draft stays provisional while the previous effective revision remains current', () => {
  const first = revisionDoc({ revision: 1, status: 'effective', body: fixtureBody('r001.body.md') });
  const second = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: fixtureBody('r002-one-replaced.body.md') }, first);
  const docs = [first, second];
  assertResolve(docs, 'PRD-GRPH-001', { path: first.path, revision: 1, status: 'effective' });
  assertResolve(docs, pin('PRD-GRPH-001', 2), { path: second.path, revision: 2, status: 'draft', digest: true });
});

checkCase('2ay case 2. rejected revisions never become current', () => {
  const first = revisionDoc({ revision: 1, status: 'effective' });
  const rejected = revisionDoc({ revision: 2, status: 'rejected', previousRevision: 1 }, first);
  assertResolve([first, rejected], 'PRD-GRPH-001', { path: first.path, revision: 1, status: 'effective' });
});

checkCase('2ay case 2. withdrawn revisions and pre-activation snapshots never become current', () => {
  const draftBase = revisionDoc({ revision: 1, status: 'draft' });
  const withdrawn = revisionDoc({ revision: 2, status: 'withdrawn', previousRevision: 1 }, draftBase);
  const docs = [draftBase, withdrawn];
  const current = lifecycle.resolveRef(docs, 'PRD-GRPH-001');
  assert.ok(!current.doc, `zero-effective state is explicit and has no current: ${JSON.stringify(current)}`);

  const effective = revisionDoc({ revision: 1, status: 'effective' });
  const withdrawnChild = revisionDoc({ revision: 2, status: 'withdrawn', previousRevision: 1 }, effective);
  const onlyEffective = lifecycle.resolveRef([effective, withdrawnChild], 'PRD-GRPH-001');
  assert.strictEqual(onlyEffective.doc && onlyEffective.doc.path, effective.path, 'withdrawn child cannot displace the current effective revision');
});

checkCase('2ay case 2. draft-local snapshot validation still reports an empty acceptance block', () => {
  const first = revisionDoc({ revision: 1, status: 'effective', body: fixtureBody('r001.body.md') });
  const incomplete = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: fixtureBody('r002-incomplete.body.md') }, first);
  expectCode(lintDocs([first, incomplete]), 'incomplete-snapshot');
});

checkCase('2ay fix. a draft revision declares its own REQs without producing missing-req references', () => {
  const draft = revisionDoc({
    revision: 1,
    status: 'draft',
    body: '### REQ-GRPH-055: Draft-local behavior\n\nAcceptance: keep this declaration visible to reviewers.\n'
  });
  const diagnostics = lintDocs([draft]);
  forbidCode(diagnostics, 'missing-req');
  forbidCode(diagnostics, 'unresolved-ref');
});

// Owner case 3 — approval is content-bound; activation is a separate,
// allowlisted transition and a stale parent cannot be activated.
checkCase('2ay case 3. approval alone does not change the current effective revision', () => {
  const first = revisionDoc({ revision: 1, status: 'effective' });
  const approved = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1 }, first);
  assertResolve([first, approved], 'PRD-GRPH-001', { path: first.path, revision: 1, status: 'effective' });
  assertResolve([first, approved], pin('PRD-GRPH-001', 2), { path: approved.path, revision: 2, status: 'approved', digest: true });
});

checkCase('2ay case 3. approved-to-effective activation changes only allowlisted fields against a trusted Git base', () => {
  const root = gitRepo('approved-to-effective-activation');
  const first = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  const second = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1, relativePath: 'docs/prd/sample/r002.md' }, first);
  writeDoc(root, first.path, first.frontmatter, first.body);
  writeDoc(root, second.path, second.frontmatter, second.body);
  writeDoc(root, 'docs/approvals/prd-review.md', { id: 'APPROVAL-001', status: 'final' }, '# Independent review record\n');
  const base = commitAll(root, 'effective r1 and approved r2');
  const r1BlobBefore = git(root, ['rev-parse', `${base}:${first.path}`]);
  mutateRevision(root, { status: 'effective', effective_at: '2026-10-17T00:02:00Z' }, undefined, second.path);
  const output = baseLint(root, base);
  assert.strictEqual(output.evidence.immutability, 'observed');
  assert.deepStrictEqual(output.diagnostics.filter(item => item.severity === 'error'), [], `valid activation must lint cleanly: ${JSON.stringify(output)}`);
  const r1BlobAfter = git(root, ['hash-object', `--path=${first.path}`, first.path]);
  assert.strictEqual(r1BlobAfter, r1BlobBefore, 'the previous effective artifact retains the same Git blob identity');
  const current = lifecycle.resolveRef(lifecycle.collectDocs(root, CONFIG), 'PRD-GRPH-001');
  assert.strictEqual(current.doc && current.doc.path, second.path, 'the new effective revision becomes the unique current');
  assert.strictEqual(current.revision, 2);
  assert.strictEqual(current.status, 'effective');
  assert.strictEqual(current.digest, sha256(fs.readFileSync(path.join(root, ...second.path.split('/')))), 'resolver reports complete candidate artifact bytes');
});

checkCase('2ay case 3. missing approval is diagnosed independently from digest mismatch', () => {
  const missing = revisionDoc({ revision: 1, status: 'effective', approval: undefined });
  delete missing.frontmatter.approval;
  missing.storedBytes = Buffer.from(renderSource(missing.frontmatter, missing.body), 'utf8');
  expectOnlyCodes(lintDocs([missing]), ['approval-missing']);
});

checkCase('2ay case 3. content changes between approval and activation violate the activation field allowlist', () => {
  const { root, base } = seedApprovedRepo('activation-allowlist');
  mutateRevision(root, { status: 'effective', effective_at: '2026-10-17T00:02:00Z' }, '# Changed while activating\n\nAcceptance: this was not approved.\n');
  const diagnostics = baseLint(root, base).diagnostics;
  expectCode(diagnostics, 'invalid-transition');
  expectCode(diagnostics, 'approval-content-mismatch');
});

checkCase('2ay case 3. metadata-only approved-to-effective changes violate the activation allowlist', () => {
  const root = gitRepo('activation-metadata-only-change');
  const first = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  const second = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1, release_channel: 'stable', relativePath: 'docs/prd/sample/r002.md' }, first);
  writeDoc(root, first.path, first.frontmatter, first.body);
  writeDoc(root, second.path, second.frontmatter, second.body);
  writeDoc(root, 'docs/approvals/prd-review.md', { id: 'APPROVAL-001', status: 'final' }, '# Independent review record\n');
  const base = commitAll(root, 'r1 effective and r2 approved');
  mutateRevision(root, { status: 'effective', effective_at: '2026-10-17T00:02:00Z', release_channel: 'beta' }, undefined, second.path);
  const diagnostics = baseLint(root, base).diagnostics;
  expectCode(diagnostics, 'invalid-transition');
  expectCode(diagnostics, 'approval-content-mismatch');
});

checkCase('2ay case 3. replacing approval evidence and rebinding its digest cannot authorize an unapproved metadata edit', () => {
  const root = gitRepo('activation-forged-approval');
  const first = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  const second = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1, release_channel: 'stable', relativePath: 'docs/prd/sample/r002.md' }, first);
  writeDoc(root, first.path, first.frontmatter, first.body);
  writeDoc(root, second.path, second.frontmatter, second.body);
  writeDoc(root, 'docs/approvals/prd-review.md', { id: 'APPROVAL-001', status: 'final' }, '# Independent review record\n');
  const base = commitAll(root, 'r1 effective and r2 approved');
  const candidate = { ...second.frontmatter, status: 'effective', effective_at: '2026-10-17T00:02:00Z', release_channel: 'beta' };
  candidate.approval = { ...second.frontmatter.approval, by: 'Replacement Reviewer' };
  candidate.approval.content_digest = approvalContentDigest(candidate, second.body);
  writeDoc(root, second.path, candidate, second.body);
  const diagnostics = baseLint(root, base).diagnostics;
  expectOnlyCodes(diagnostics.filter(item => ['invalid-transition', 'approval-content-mismatch'].includes(item.code)), ['invalid-transition']);
});

checkCase('2ay case 3. approved draft based on a stale current revision cannot activate from trusted base', () => {
  const root = gitRepo('stale-draft-base');
  const first = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  const current = revisionDoc({ revision: 3, status: 'effective', previousRevision: 1, relativePath: 'docs/prd/sample/r003.md' }, first);
  const staleApproved = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1, relativePath: 'docs/prd/sample/r002.md' }, first);
  for (const doc of [first, current, staleApproved]) writeDoc(root, doc.path, doc.frontmatter, doc.body);
  writeDoc(root, 'docs/approvals/prd-review.md', { id: 'APPROVAL-001', status: 'final' }, '# Independent review record\n');
  const base = commitAll(root, 'current r3 and approved stale r2');
  const baseCurrent = lifecycle.resolveRef(lifecycle.collectDocs(root, CONFIG), 'PRD-GRPH-001');
  assert.strictEqual(baseCurrent.doc && baseCurrent.doc.path, current.path, 'valid base selects r3 while r2 is only approved');
  mutateRevision(root, { status: 'effective', effective_at: '2026-10-17T00:02:00Z' }, undefined, staleApproved.path);
  const result = baseLint(root, base);
  const stale = expectCode(result.diagnostics, 'stale-draft-base');
  assert.ok(stale.some(item => item.path === staleApproved.path && item.id === 'PRD-GRPH-001'), 'stale activation is anchored to its declaring revision');
  expectCode(result.diagnostics, 'revision-fork');
  const invalidCurrent = lifecycle.resolveRef(lifecycle.collectDocs(root, CONFIG), 'PRD-GRPH-001');
  assert.ok(!invalidCurrent.doc, `invalid candidate graph has no current; resolver must not choose a sibling: ${JSON.stringify(invalidCurrent)}`);
});

// Owner case 4 — complete snapshots preserve nine REQs, explicitly replace
// one, and reject dropped/incomplete or malformed replacement declarations.
checkCase('2ay case 4. activated ten-REQ revision preserves, replaces, and resolves requirement continuity', () => {
  const parentBody = fixtureBody('r001.body.md');
  const childBody = fixtureBody('r002-one-replaced.body.md');
  const parentIds = revisionIds(parentBody);
  const childIds = revisionIds(childBody);
  assert.strictEqual(parentIds.length, 10);
  assert.strictEqual(childIds.length, 10);
  assert.deepStrictEqual(childIds.filter(id => parentIds.includes(id)), parentIds.slice(0, 9));
  const parent = revisionDoc({ revision: 1, status: 'effective', body: parentBody });
  const child = revisionDoc({ revision: 2, status: 'effective', previousRevision: 1, body: childBody }, parent);
  assert.deepStrictEqual(analyzeDocs([parent, child]).diagnostics.filter(item => item.severity === 'error'), [], 'the complete replacement chain is structurally valid');
  const diff = diffRevisions([parent, child], pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  assert.deepStrictEqual(diff.requirements.kept, parentIds.slice(0, 9));
  assert.deepStrictEqual(diff.requirements.replaced, [{ from: 'REQ-GRPH-019', to: 'REQ-GRPH-020' }]);
  assert.deepStrictEqual(diff.requirements.changed, []);
  assert.deepStrictEqual(diff.requirements.removed, []);
  assert.deepStrictEqual(diff.requirements.added, []);
  assert.ok(!JSON.stringify(diff).includes('supersedes'), 'REQ replacement must not become whole-PRD supersession');
  for (const id of parentIds.slice(0, 9)) {
    const resolved = lifecycle.resolveRef([parent, child], id);
    assert.strictEqual(resolved.doc && resolved.doc.path, child.path, `${id} plain ref resolves in the current revision`);
    assert.strictEqual(resolved.requirement && resolved.requirement.id, id);
  }
  const pinnedReplaced = lifecycle.resolveRef([parent, child], pin('PRD-GRPH-001', 1, 'REQ-GRPH-019'));
  assert.strictEqual(pinnedReplaced.doc && pinnedReplaced.doc.path, parent.path, 'revision-pinned replaced REQ remains addressable historically');
  assert.strictEqual(pinnedReplaced.requirement && pinnedReplaced.requirement.id, 'REQ-GRPH-019');
  const plainReplaced = lifecycle.resolveRef([parent, child], 'REQ-GRPH-019');
  assert.ok(!plainReplaced.doc, `plain ref to replaced REQ does not auto-follow: ${JSON.stringify(plainReplaced)}`);
  assert.match(plainReplaced.message || '', /REQ-GRPH-020|replac/i, 'unresolved plain ref carries a historical replacement hint');
});

checkCase('2ay case 4. a missing parent REQ is req-dropped unless removed_reqs accounts for it', () => {
  const parent = revisionDoc({ revision: 1, status: 'draft', body: fixtureBody('r001.body.md') });
  const dropped = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: fixtureBody('r002-dropped.body.md') }, parent);
  expectCode(lintDocs([parent, dropped]), 'req-dropped');
  const removed = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, removed_reqs: ['REQ-GRPH-019'], body: fixtureBody('r002-dropped.body.md') }, parent);
  forbidCode(lintDocs([parent, removed]), 'req-dropped');
  const removalDiff = diffRevisions([parent, removed], pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  assert.deepStrictEqual(removalDiff.requirements.kept, ['REQ-GRPH-010', 'REQ-GRPH-011', 'REQ-GRPH-012', 'REQ-GRPH-013', 'REQ-GRPH-014', 'REQ-GRPH-015', 'REQ-GRPH-016', 'REQ-GRPH-017', 'REQ-GRPH-018']);
  assert.deepStrictEqual(removalDiff.requirements.removed, ['REQ-GRPH-019']);
  assert.deepStrictEqual(removalDiff.requirements.added, []);
  assert.deepStrictEqual(removalDiff.requirements.changed, []);
  assert.deepStrictEqual(removalDiff.requirements.replaced, []);
});

checkCase('2ay case 4. each REQ block requires non-empty acceptance content', () => {
  const parent = revisionDoc({ revision: 1, status: 'draft', body: fixtureBody('r001.body.md') });
  const child = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: fixtureBody('r002-incomplete.body.md') }, parent);
  expectCode(lintDocs([parent, child]), 'incomplete-snapshot');
});

checkCase('2ay case 4. replacement grammar supports split and merge edges', () => {
  const parentBody = fixtureBody('r001.body.md');
  const splitBody = `${parentBody.replace(/### REQ-GRPH-019:[\s\S]*$/, '')}### REQ-GRPH-020 (replaces: REQ-GRPH-019): Error category\n\nAcceptance: classify each failure.\n\n### REQ-GRPH-021 (replaces: REQ-GRPH-019): Recovery action\n\nAcceptance: provide a recovery action.\n`;
  const parent = revisionDoc({ revision: 1, status: 'draft', body: parentBody });
  const child = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: splitBody }, parent);
  const diagnostics = lintDocs([parent, child]);
  assert.deepStrictEqual(diagnostics.filter(item => item.severity === 'error'), [], 'valid split snapshot has no structural errors');
  const diff = diffRevisions([parent, child], pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  assert.deepStrictEqual(diff.requirements.kept, ['REQ-GRPH-010', 'REQ-GRPH-011', 'REQ-GRPH-012', 'REQ-GRPH-013', 'REQ-GRPH-014', 'REQ-GRPH-015', 'REQ-GRPH-016', 'REQ-GRPH-017', 'REQ-GRPH-018']);
  assert.deepStrictEqual(diff.requirements.replaced, [
    { from: 'REQ-GRPH-019', to: 'REQ-GRPH-020' },
    { from: 'REQ-GRPH-019', to: 'REQ-GRPH-021' }
  ]);
  assert.deepStrictEqual(diff.requirements.changed, []);
  assert.deepStrictEqual(diff.requirements.removed, []);
  assert.deepStrictEqual(diff.requirements.added, []);

  const mergeBody = `${parentBody.replace(/### REQ-GRPH-018:[\s\S]*$/, '')}### REQ-GRPH-020 (replaces: REQ-GRPH-018, REQ-GRPH-019): Combined export\n\nAcceptance: preserve export and recovery behavior.\n`;
  const merge = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: mergeBody }, parent);
  assert.deepStrictEqual(lintDocs([parent, merge]).filter(item => item.severity === 'error'), [], 'valid merge snapshot has no structural errors');
  const merged = diffRevisions([parent, merge], pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  assert.deepStrictEqual(merged.requirements.kept, ['REQ-GRPH-010', 'REQ-GRPH-011', 'REQ-GRPH-012', 'REQ-GRPH-013', 'REQ-GRPH-014', 'REQ-GRPH-015', 'REQ-GRPH-016', 'REQ-GRPH-017']);
  assert.deepStrictEqual(merged.requirements.replaced, [
    { from: 'REQ-GRPH-018', to: 'REQ-GRPH-020' },
    { from: 'REQ-GRPH-019', to: 'REQ-GRPH-020' }
  ]);
  assert.deepStrictEqual(merged.requirements.changed, []);
  assert.deepStrictEqual(merged.requirements.removed, []);
  assert.deepStrictEqual(merged.requirements.added, []);
});

checkCase('2ay case 4. replacement cannot also claim the replaced REQ as an alias', () => {
  const parent = revisionDoc({ revision: 1, status: 'draft', body: fixtureBody('r001.body.md') });
  const child = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: fixtureBody('r002-overlap.body.md') }, parent);
  expectCode(lintDocs([parent, child]), 'replacement-alias-overlap');
});

checkCase('2ay case 4. duplicate REQs within one revision and across distinct current PRDs are anchored on every involved document', () => {
  const duplicateWithinOne = revisionDoc({
    revision: 1,
    status: 'draft',
    body: `${fixtureBody('r001.body.md')}\n### REQ-GRPH-010: Duplicate in same snapshot\n\nAcceptance: expose duplicate identity.\n`
  });
  const withinDiagnostics = lintDocs([duplicateWithinOne]);
  const within = expectCode(withinDiagnostics, 'duplicate-req');
  assert.ok(within.some(item => item.path === duplicateWithinOne.path && item.id === 'REQ-GRPH-010'), 'same-revision duplicate points at its PRD');

  const graph = revisionDoc({ id: 'PRD-GRPH-001', revision: 1, status: 'effective', body: '### REQ-GRPH-099: Shared current requirement\n\nAcceptance: one owner.\n' });
  const interfaceDoc = revisionDoc({ id: 'PRD-IFCE-001', revision: 1, status: 'effective', relativePath: 'docs/prd/interface/r001.md', body: '### REQ-GRPH-099: Shared current requirement\n\nAcceptance: conflicting owner.\n' });
  const cross = expectCode(lintDocs([graph, interfaceDoc]), 'duplicate-req');
  assert.deepStrictEqual(cross.map(item => item.path), [graph.path, interfaceDoc.path].sort());
  const candidatesByPath = Object.fromEntries(cross.map(item => [item.path, item.candidates]));
  assert.deepStrictEqual(candidatesByPath[graph.path], [interfaceDoc.path]);
  assert.deepStrictEqual(candidatesByPath[interfaceDoc.path], [graph.path]);
  assert.ok(cross.every(item => item.id === 'REQ-GRPH-099'), 'each document diagnostic identifies the colliding REQ');
});

checkCase('2ay case 4. repeated REQ identity across revisions of one logical PRD is valid history', () => {
  const first = revisionDoc({ revision: 1, status: 'effective', body: fixtureBody('r001.body.md') });
  const second = revisionDoc({ revision: 2, status: 'effective', previousRevision: 1, body: fixtureBody('r001.body.md') }, first);
  const diagnostics = lintDocs([first, second]);
  forbidCode(diagnostics, 'duplicate-req');
  forbidCode(diagnostics, 'duplicate-id');
  forbidCode(diagnostics, 'alias-collision');
});

checkCase('2ay case 4. cross-PRD alias collision is emitted on every involved document with counterpart candidates', () => {
  const first = revisionDoc({ id: 'PRD-GRPH-001', revision: 1, status: 'effective', aliases: ['PRD-IFCE-002'] });
  const second = revisionDoc({ id: 'PRD-IFCE-002', revision: 1, status: 'effective', relativePath: 'docs/prd/interface/r001.md' });
  const collisions = expectCode(lintDocs([first, second]), 'alias-collision');
  assert.deepStrictEqual(collisions.map(item => item.path), [first.path, second.path].sort());
  const candidatesByPath = Object.fromEntries(collisions.map(item => [item.path, item.candidates]));
  assert.deepStrictEqual(candidatesByPath[first.path], [second.path]);
  assert.deepStrictEqual(candidatesByPath[second.path], [first.path]);
  assert.ok(collisions.every(item => item.id === 'PRD-IFCE-002'), 'each collision diagnostic identifies the conflicting name');
});

checkCase('2ay case 4. replacement cycles across valid parent revisions are diagnosed', () => {
  const firstBody = '### REQ-GRPH-010: Original A\n\nAcceptance: preserve A.\n\n### REQ-GRPH-011: Stable\n\nAcceptance: preserve stable.\n';
  const secondBody = '### REQ-GRPH-011: Stable\n\nAcceptance: preserve stable.\n\n### REQ-GRPH-020 (replaces: REQ-GRPH-010): Replacement B\n\nAcceptance: replace A.\n';
  const thirdBody = '### REQ-GRPH-011: Stable\n\nAcceptance: preserve stable.\n\n### REQ-GRPH-010 (replaces: REQ-GRPH-020): Reused A\n\nAcceptance: form a replacement cycle.\n';
  const first = revisionDoc({ revision: 1, status: 'draft', body: firstBody });
  const second = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: secondBody }, first);
  const third = revisionDoc({ revision: 3, status: 'draft', previousRevision: 2, body: thirdBody }, second);
  expectCode(lintDocs([first, second, third]), 'replacement-cycle');
});

checkCase('2ay case 4. duplicate, unknown, malformed, and empty clauses fail independently', () => {
  const parent = revisionDoc({ revision: 1, status: 'draft', body: fixtureBody('r001.body.md') });
  const invalidBodies = [
    `${fixtureBody('r001.body.md')}\n### REQ-GRPH-020 (replaces: REQ-GRPH-019; replaces: REQ-GRPH-018): Duplicate clause\n\nAcceptance: reject duplicate clauses.\n`,
    `${fixtureBody('r001.body.md')}\n### REQ-GRPH-020 (mystery: yes): Unknown clause\n\nAcceptance: reject unknown clauses.\n`,
    `${fixtureBody('r001.body.md')}\n### REQ-GRPH-020 (replaces REQ-GRPH-019): Malformed clause\n\nAcceptance: reject malformed clauses.\n`,
    `${fixtureBody('r001.body.md')}\n### REQ-GRPH-020 (replaces: ): Empty clause\n\nAcceptance: reject empty clauses.\n`
  ];
  for (const [index, body] of invalidBodies.entries()) {
    const child = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body, relativePath: `docs/prd/sample/invalid-clause-${index}.md` }, parent);
    expectOnlyCodes(lintDocs([parent, child]), ['invalid-req-clause']);
  }
});

checkCase('2ay case 4. changed normative text under a stable REQ ID requires review classification', () => {
  const firstBody = fixtureBody('r001.body.md');
  const revisedBody = firstBody.replace('Acceptance: every declared vertex is drawn.', 'Acceptance: hidden vertices are always drawn.');
  const first = revisionDoc({ revision: 1, status: 'effective', body: firstBody });
  const second = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: revisedBody }, first);
  const diff = diffRevisions([first, second], pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  const changed = diff.requirements.changed.find(item => item.id === 'REQ-GRPH-010');
  assert.ok(changed, 'the same ID with changed normative acceptance must be visible in the diff');
  assert.strictEqual(changed.reviewRequired, true, 'ID continuity is structural evidence, not semantic approval');
  assert.deepStrictEqual(diff.requirements.kept, ['REQ-GRPH-011', 'REQ-GRPH-012', 'REQ-GRPH-013', 'REQ-GRPH-014', 'REQ-GRPH-015', 'REQ-GRPH-016', 'REQ-GRPH-017', 'REQ-GRPH-018', 'REQ-GRPH-019']);
  assert.deepStrictEqual(diff.requirements.changed.map(item => item.id), ['REQ-GRPH-010']);
  assert.deepStrictEqual(diff.requirements.added, []);
  assert.deepStrictEqual(diff.requirements.removed, []);
  assert.deepStrictEqual(diff.requirements.replaced, []);
});

// Owner case 5 — graph validation must finish before current selection.
checkCase('2ay case 5. duplicate logical revision pairs are diagnosed', () => {
  const one = revisionDoc({ revision: 1, status: 'draft', relativePath: 'docs/prd/sample/a.md' });
  const two = revisionDoc({ revision: 1, status: 'draft', relativePath: 'docs/prd/sample/b.md' });
  expectCode(lintDocs([one, two]), 'duplicate-revision');
  const invalidCurrent = lifecycle.resolveRef([one, two], 'PRD-GRPH-001');
  assert.ok(!invalidCurrent.doc, 'duplicate revision identity prevents arbitrary current selection');
});

checkCase('2ay case 5. missing and cross-logical parents are diagnosed', () => {
  const missing = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1 });
  expectCode(lintDocs([missing]), 'missing-parent');
  assert.ok(!lifecycle.resolveRef([missing], 'PRD-GRPH-001').doc, 'missing parent leaves current undefined');
  const otherRoot = revisionDoc({ id: 'PRD-IFCE-001', revision: 1, status: 'draft' });
  const wrongParent = revisionDoc({ id: 'PRD-GRPH-001', revision: 2, status: 'draft', previousRevision: 1 });
  expectCode(lintDocs([otherRoot, wrongParent]), 'missing-parent');
  assert.ok(!lifecycle.resolveRef([otherRoot, wrongParent], 'PRD-GRPH-001').doc, 'cross-logical parent cannot supply a current chain');
});

checkCase('2ay case 5. multiple baselines and revision cycles are diagnosed', () => {
  const baselineOne = revisionDoc({ revision: 1, status: 'draft', relativePath: 'docs/prd/sample/r001.md' });
  const baselineTwo = revisionDoc({ revision: 2, status: 'draft', relativePath: 'docs/prd/sample/r002.md' });
  expectCode(lintDocs([baselineOne, baselineTwo]), 'multiple-baselines');
  assert.ok(!lifecycle.resolveRef([baselineOne, baselineTwo], 'PRD-GRPH-001').doc, 'multiple baselines prevent current selection');
  const cycleOne = revisionDoc({ revision: 1, status: 'draft', previousRevision: 2, relativePath: 'docs/prd/sample/cycle-1.md' });
  const cycleTwo = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, relativePath: 'docs/prd/sample/cycle-2.md' });
  expectCode(lintDocs([cycleOne, cycleTwo]), 'revision-cycle');
  assert.ok(!lifecycle.resolveRef([cycleOne, cycleTwo], 'PRD-GRPH-001').doc, 'cyclic graph prevents current selection');
});

checkCase('2ay case 5. parent revision must be lower and an invalid effective chain has no current', () => {
  const later = revisionDoc({ revision: 2, status: 'effective' });
  const lowerChild = revisionDoc({ revision: 1, status: 'effective', previousRevision: 2, relativePath: 'docs/prd/sample/r001-child.md' }, later);
  expectCode(lintDocs([later, lowerChild]), 'missing-parent');
  assert.ok(!lifecycle.resolveRef([later, lowerChild], 'PRD-GRPH-001').doc, 'decreasing parent edge does not pick either effective node');
});

checkCase('2ay case 5. effective sibling revisions form a diagnosed fork, with no arbitrary current', () => {
  const first = revisionDoc({ revision: 1, status: 'effective' });
  const left = revisionDoc({ revision: 2, status: 'effective', previousRevision: 1, relativePath: 'docs/prd/sample/left.md' }, first);
  const right = revisionDoc({ revision: 3, status: 'effective', previousRevision: 1, relativePath: 'docs/prd/sample/right.md' }, first);
  const diagnostics = lintDocs([first, left, right]);
  expectCode(diagnostics, 'revision-fork');
  const current = lifecycle.resolveRef([first, left, right], 'PRD-GRPH-001');
  assert.ok(!current.doc, `invalid graph must not choose a current revision: ${JSON.stringify(current)}`);
});

checkCase('2ay case 5. zero, leading-zero, fractional, and string revisions are invalid', () => {
  const docs = [
    revisionDoc({ revision: 0, status: 'draft', relativePath: 'docs/prd/sample/zero.md' }),
    revisionDoc({ revision: '01', status: 'draft', relativePath: 'docs/prd/sample/leading-zero.md' }),
    revisionDoc({ revision: 1.5, status: 'draft', relativePath: 'docs/prd/sample/fraction.md' }),
    revisionDoc({ revision: '2', status: 'draft', relativePath: 'docs/prd/sample/string.md' })
  ];
  assert.ok(matching(lintDocs(docs), 'invalid-revision').length >= 4);
});

// Owner case 6 — namespace-first, whole-token reference parsing. Legacy path
// selectors retain @ and # literally.
checkCase('2ay case 6. current, revision-pinned, and pinned-REQ references resolve to exact provenance', () => {
  const firstBody = '### REQ-GRPH-012 (aliases: REQ-GRAPH-012): Stable requirement\n\nAcceptance: preserve the behavior.\n';
  const secondBody = '### REQ-GRPH-012 (aliases: REQ-GRAPH-012, REQ-GRPH-099): Stable requirement\n\nAcceptance: preserve the behavior.\n';
  const first = revisionDoc({ revision: 1, status: 'effective', aliases: ['PRD-GRPH-009'], body: firstBody });
  const second = revisionDoc({ revision: 2, status: 'effective', previousRevision: 1, aliases: ['PRD-GRPH-009'], body: secondBody }, first);
  const docs = [first, second];
  assertResolve(docs, 'PRD-GRPH-001', { path: second.path, revision: 2, status: 'effective', digest: true, provenance: true });
  assertResolve(docs, pin('PRD-GRPH-001', 1), { path: first.path, revision: 1, status: 'effective', digest: true, provenance: true });
  assertResolve(docs, pin('PRD-GRPH-001', 1, 'REQ-GRAPH-012'), { path: first.path, revision: 1, status: 'effective', requirement: 'REQ-GRPH-012', digest: true, provenance: true });
  assertResolve(docs, pin('PRD-GRPH-001', 2, 'REQ-GRPH-099'), { path: second.path, revision: 2, status: 'effective', requirement: 'REQ-GRPH-012', digest: true, provenance: true });
  const historicalAlias = lifecycle.resolveRef(docs, pin('PRD-GRPH-001', 1, 'REQ-GRPH-099'));
  assert.ok(!historicalAlias.doc, 'an alias declared only in r2 does not resolve as of r1');
  const diagnostics = lintDocs(docs);
  forbidCode(diagnostics, 'alias-collision');
  forbidCode(diagnostics, 'duplicate-req');
});

checkCase('2ay case 6. draft pins are provisional and malformed suffixes never resolve their valid prefix', () => {
  const first = revisionDoc({ revision: 1, status: 'effective' });
  const draft = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, });
  const docs = [first, draft];
  assertResolve(docs, pin('PRD-GRPH-001', 2), { path: draft.path, revision: 2, status: 'draft' });
  for (const ref of ['PRD-GRPH-001@r2junk', 'PRD-GRPH-001@r02', 'PRD-GRPH-001@r2#REQ-GRPH-012suffix']) {
    const result = lifecycle.resolveRef(docs, ref);
    assert.ok(!result.doc, `${ref} must not fall through to a valid prefix: ${JSON.stringify(result)}`);
    assert.ok(['invalid-ref', 'unresolved-ref'].includes(result.error), `${ref} error category: ${JSON.stringify(result)}`);
  }
});

checkCase('2ay case 6. legacy selectors preserve a path containing @ and #', () => {
  const legacy = docObject('docs/adr/legacy/GRAPH-009@old#record.md', { id: 'GRAPH-009', status: 'accepted' }, '# Frozen legacy record\n');
  legacy.legacy = true;
  const result = lifecycle.resolveRef([legacy], 'legacy:GRAPH-009@docs/adr/legacy/GRAPH-009@old#record.md');
  assert.strictEqual(result.doc && result.doc.path, legacy.path);
});

// Owner case 7 — cross-PRD supersedes is an external retirement projection:
// source and target artifacts stay unchanged, and splits/merges are addressable.
checkCase('2ay case 7. cross-PRD retirement records exact pinned targets without mutating them', () => {
  const oldGraph = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/graph/r001.md' });
  const oldInterface = revisionDoc({ id: 'PRD-IFCE-001', revision: 1, status: 'effective', relativePath: 'docs/prd/interface/r001.md' });
  const newPlatform = revisionDoc({ id: 'PRD-GRPH-002', revision: 1, status: 'effective', relativePath: 'docs/prd/platform/r001.md', supersedes: ['PRD-GRPH-001@r1', 'PRD-IFCE-001@r1'] });
  const graphSplit = revisionDoc({ id: 'PRD-GRPH-003', revision: 1, status: 'effective', relativePath: 'docs/prd/graph-next/r001.md', supersedes: ['PRD-GRPH-001@r1'] });
  const root = path.join(tempRoot, 'retirement source target files');
  fs.mkdirSync(root, { recursive: true });
  for (const doc of [oldGraph, oldInterface, newPlatform, graphSplit]) writeDoc(root, doc.path, doc.frontmatter, doc.body);
  const before = new Map([oldGraph, oldInterface, newPlatform, graphSplit].map(doc => [doc.path, fs.readFileSync(path.join(root, ...doc.path.split('/')))]));
  const docs = lifecycle.collectDocs(root, CONFIG);
  const analysis = analyzeDocs(docs);
  assert.deepStrictEqual(analysis.diagnostics.filter(item => item.severity === 'error'), [], `cross-PRD revision retirement is valid: ${JSON.stringify(analysis.diagnostics)}`);
  const index = lifecycle.buildIndex(docs, CONFIG);
  const graphLine = index.split('\n').find(line => line.includes(oldGraph.path)) || '';
  const interfaceLine = index.split('\n').find(line => line.includes(oldInterface.path)) || '';
  assert.ok(graphLine.includes('PRD-GRPH-002') && graphLine.includes('PRD-GRPH-003'), `split successors for the exact retired graph revision are listed: ${graphLine}`);
  assert.ok(interfaceLine.includes('PRD-GRPH-002'), `merge successor for the exact retired interface revision is listed: ${interfaceLine}`);
  const declaredEdges = [
    ['PRD-GRPH-002', 'PRD-GRPH-001@r1'],
    ['PRD-GRPH-002', 'PRD-IFCE-001@r1'],
    ['PRD-GRPH-003', 'PRD-GRPH-001@r1']
  ];
  for (const [source, target] of declaredEdges) {
    const sourceDoc = docs.find(doc => doc.frontmatter.id === source);
    assert.ok(sourceDoc.frontmatter.supersedes.includes(target), `${source} stores exact edge to ${target}`);
    assert.ok(index.includes(source) && index.includes(target), `index preserves exact edge endpoints ${source} -> ${target}`);
  }
  assertResolve(docs, 'PRD-GRPH-001', { path: oldGraph.path, revision: 1, status: 'effective', digest: true });
  for (const [relative, bytes] of before) {
    assert.deepStrictEqual(fs.readFileSync(path.join(root, ...relative.split('/'))), bytes, `lint/index left stored target/source bytes unchanged for ${relative}`);
  }
});

// Owner case 8 — explicit migration, portable byte identity, deterministic
// index/diff independent of input order, and package parity.
function prepareMigrationRepo(name) {
  const root = gitRepo(name);
  const livingBody = '# Existing living contract\n\nAcceptance: preserve existing users.\n';
  const livingPath = writeDoc(root, 'docs/prd/living.md', { id: 'PRD-GRPH-001', status: 'active' }, livingBody);
  const legacyPath = writeDoc(root, 'docs/prd/legacy/PRD-GRPH-009.md', { id: 'PRD-GRPH-009', status: 'active' }, '# Frozen imported record\n');
  const beforeLegacy = fs.readFileSync(legacyPath);
  const oldRevision = commitAll(root, 'pre-migration living PRD');
  const oldBlob = gitBytes(root, ['show', `${oldRevision}:docs/prd/living.md`]);
  const migratedFromDigest = sha256(oldBlob);
  const approvedSeed = revisionDoc({
    id: 'PRD-GRPH-001', revision: 1, status: 'effective', draftedBy: 'Legacy Contract Owner',
    migrated_from_digest: migratedFromDigest,
    migration_record: 'docs/migrations/prd-graph-001.json',
    relativePath: 'docs/prd/living.md', body: livingBody
  });
  const migrated = reviseFixture(approvedSeed, {
    approval: { ...approvedSeed.frontmatter.approval, ref: 'docs/approvals/prd-migration-review.md' }
  });
  writeDoc(root, 'docs/prd/living.md', migrated.frontmatter, livingBody);
  writeDoc(root, migrated.frontmatter.approval.ref, { id: 'APPROVAL-MIGRATION-001', status: 'final' }, '# Baseline migration review\n');
  const migrationRecordPath = path.join(root, 'docs/migrations/prd-graph-001.json');
  fs.mkdirSync(path.dirname(migrationRecordPath), { recursive: true });
  const migrationRecord = {
    record: 'prd-baseline-migration', id: 'PRD-GRPH-001', revision: 1,
    source: 'docs/prd/living.md', migrated_from_digest: migratedFromDigest,
    approved_by: 'Independent cold verifier'
  };
  fs.writeFileSync(migrationRecordPath, JSON.stringify(migrationRecord, null, 2) + '\n', 'utf8');
  const migrationCommit = commitAll(root, 'metadata-only PRD baseline adoption');
  return { root, livingPath, livingBody, legacyPath, beforeLegacy, oldRevision, oldBlob, migratedFromDigest, migrationRecordPath, migrationRecord, migrationCommit };
}

checkCase('2ay case 8. baseline adoption binds prior stored bytes to a recorded metadata-only migration', () => {
  const state = prepareMigrationRepo('baseline-migration-valid');
  const result = baseLint(state.root, state.oldRevision);
  assert.strictEqual(result.evidence.immutability, 'observed');
  assert.deepStrictEqual(result.diagnostics.filter(item => item.severity === 'error'), [], `valid baseline adoption is accepted: ${JSON.stringify(result.diagnostics)}`);
  assert.strictEqual(sha256(state.oldBlob), state.migratedFromDigest, 'migration digest names the old Git blob bytes');
  assert.strictEqual(fs.readFileSync(state.livingPath, 'utf8').includes(state.livingBody), true, 'baseline migration preserves the exact body bytes');
  assert.deepStrictEqual(fs.readFileSync(state.legacyPath), state.beforeLegacy, 'legacy contract remains byte-identical');
  const record = JSON.parse(fs.readFileSync(state.migrationRecordPath, 'utf8'));
  assert.deepStrictEqual(record, state.migrationRecord, 'migration record is present and binds the old digest');

  const migratedDoc = lifecycle.collectDocs(state.root, CONFIG).find(doc => doc.path === 'docs/prd/living.md');
  assert.strictEqual(migratedDoc.frontmatter.revision, 1);
  assert.strictEqual(migratedDoc.frontmatter.migrated_from_digest, state.migratedFromDigest);
  const migratedSource = lifecycle.parseFrontmatter(fs.readFileSync(state.livingPath, 'utf8'));
  assert.strictEqual(migratedSource.body, state.livingBody, 'migration changes metadata only');
});

checkCase('2ay case 8. missing or mismatched migration records and digests are rejected', () => {
  const missing = prepareMigrationRepo('baseline-migration-missing-record');
  fs.unlinkSync(missing.migrationRecordPath);
  const missingResult = baseLint(missing.root, missing.oldRevision);
  assert.ok(missingResult.diagnostics.some(item => item.severity === 'error'), 'missing migration record is an error');

  const wrongRecord = prepareMigrationRepo('baseline-migration-wrong-record');
  const alteredRecord = { ...wrongRecord.migrationRecord, migrated_from_digest: sha256(Buffer.from('wrong prior artifact', 'utf8')) };
  fs.writeFileSync(wrongRecord.migrationRecordPath, JSON.stringify(alteredRecord, null, 2) + '\n', 'utf8');
  const wrongRecordResult = baseLint(wrongRecord.root, wrongRecord.oldRevision);
  assert.ok(wrongRecordResult.diagnostics.some(item => item.severity === 'error'), 'record digest must agree with the old stored artifact');

  const wrongSourceDigest = prepareMigrationRepo('baseline-migration-wrong-source-digest');
  const current = lifecycle.collectDocs(wrongSourceDigest.root, CONFIG).find(doc => doc.path === 'docs/prd/living.md');
  const changed = reviseFixture(current, { migrated_from_digest: sha256(Buffer.from('forged prior artifact', 'utf8')) });
  writeDoc(wrongSourceDigest.root, changed.path, changed.frontmatter, changed.body);
  const changedRecord = { ...wrongSourceDigest.migrationRecord, migrated_from_digest: changed.frontmatter.migrated_from_digest };
  fs.writeFileSync(wrongSourceDigest.migrationRecordPath, JSON.stringify(changedRecord, null, 2) + '\n', 'utf8');
  const wrongSourceResult = baseLint(wrongSourceDigest.root, wrongSourceDigest.oldRevision);
  assert.ok(wrongSourceResult.diagnostics.some(item => item.severity === 'error'), 'matching forged metadata cannot replace the actual old-blob digest');
});

checkCase('2ay fix. trusted base ID-only refs escalate when the old target path is changed', () => {
  const target = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  const source = docObject('docs/reports/consumer.md', { id: 'REPORT-001', status: 'final' }, 'See PRD-GRPH-001 for the contract.\n');
  const withoutBase = analyzeDocs([source], { changedPaths: [target.path] });
  assert.ok(withoutBase.diagnostics.some(item => item.code === 'unresolved-ref' && item.severity === 'warning'), 'without a trusted ID-to-path baseline, the unchanged source remains a warning');
  const withBase = analyzeDocs([source], {
    changedPaths: [target.path],
    baseInventory: [{
      id: target.frontmatter.id,
      revision: target.frontmatter.revision,
      path: target.path,
      status: target.frontmatter.status,
      bytes: target.storedBytes
    }]
  });
  assert.ok(withBase.diagnostics.some(item => item.code === 'unresolved-ref' && item.severity === 'error'), 'the trusted base maps the ID to its changed/deleted former path');
});

checkCase('2ay case 8. migration metadata cannot exempt later content edits from effective immutability', () => {
  const state = prepareMigrationRepo('baseline-migration-later-edit');
  mutateRevision(state.root, {}, `${state.livingBody}\nA later edit with migration metadata still present.\n`, 'docs/prd/living.md');
  const current = lifecycle.collectDocs(state.root, CONFIG).find(doc => doc.path === 'docs/prd/living.md');
  const parsed = lifecycle.parseFrontmatter(fs.readFileSync(state.livingPath, 'utf8'));
  const edited = reviseFixture({ ...current, body: parsed.body }, {});
  writeDoc(state.root, edited.path, edited.frontmatter, edited.body);
  expectCode(baseLint(state.root, state.migrationCommit).diagnostics, 'immutable-revision-modified');
});

checkCase('2ay case 8. identical trees yield byte-identical index and revision diff in reversed order', () => {
  const first = revisionDoc({ revision: 1, status: 'effective', body: fixtureBody('r001.body.md') });
  const second = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, body: fixtureBody('r002-one-replaced.body.md') }, first);
  const docs = [first, second];
  const forwardIndex = lifecycle.buildIndex(docs, CONFIG);
  const reverseIndex = lifecycle.buildIndex([...docs].reverse(), CONFIG);
  assert.strictEqual(forwardIndex, reverseIndex, 'index bytes must not depend on collection order');
  const forwardDiff = diffRevisions(docs, pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  const reverseDiff = diffRevisions([...docs].reverse(), pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2));
  assert.strictEqual(JSON.stringify(forwardDiff), JSON.stringify(reverseDiff), 'diff bytes must not depend on collection order');
});

checkCase('2ay case 8. CRLF working copy retains LF Git-blob identity for a trusted baseline', () => {
  const { root, base } = seedEffectiveRepo('crlf-blob-identity', 'true');
  const file = path.join(root, 'docs/prd/sample/r001.md');
  const source = fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(file, source, 'utf8');
  assert.ok(root.includes('spaces') && root.includes('臺灣'), 'Git fixture path includes spaces and non-ASCII characters');
  const blob = gitBytes(root, ['show', `${base}:docs/prd/sample/r001.md`]);
  assert.ok(!blob.includes(0x0d), 'committed repository blob uses LF bytes');
  assert.ok(fs.readFileSync(file, 'utf8').includes('\r\n'), 'working copy uses CRLF bytes');
  const expectedBlobId = git(root, ['rev-parse', `${base}:docs/prd/sample/r001.md`]);
  const normalizedWorkingBlobId = git(root, ['hash-object', `--path=docs/prd/sample/r001.md`, 'docs/prd/sample/r001.md']);
  assert.strictEqual(normalizedWorkingBlobId, expectedBlobId, 'expected and actual Git blob identities match after EOL normalization');
  const result = spawnSync(process.execPath, [
    modulePath, 'lint', '--workspace', root,
    '--config', path.join(root, 'lifecycle-config.json'), '--all', '--base', base
  ], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `line-ending conversion must not change immutable identity: ${result.stderr} ${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.evidence.immutability, 'observed');
  assert.deepStrictEqual(output.diagnostics.filter(item => item.severity === 'error'), [], 'same Git blob identity is an unchanged effective artifact');

  const changed = fs.readFileSync(file, 'utf8').replace('Acceptance: preserve this exact contract.', 'Acceptance: this contract has changed.');
  fs.writeFileSync(file, changed, 'utf8');
  const changedBlobId = git(root, ['hash-object', '--path=docs/prd/sample/r001.md', 'docs/prd/sample/r001.md']);
  assert.notStrictEqual(changedBlobId, expectedBlobId, 'real content mutation changes the normalized Git blob');
  expectCode(baseLint(root, base).diagnostics, 'immutable-revision-modified');
});

checkCase('2ay case 8. isolated source, Claude, and Codex package trees agree on file-backed D6.9 behavior', () => {
  const packagedRoot = path.join(__dirname, '..', 'plugins', 'harness-everything', 'skills', 'harness-everything');
  const sourceSkillRoot = path.dirname(path.dirname(modulePath));
  assert.ok(fs.existsSync(path.join(packagedRoot, 'scripts', 'doc-lifecycle.js')), 'Codex package lifecycle runtime exists');
  const claudeCopyRoot = path.join(tempRoot, 'isolated Claude plugin', 'harness-everything');
  const codexCopyRoot = path.join(tempRoot, 'isolated Codex plugin', 'harness-everything');
  fs.cpSync(sourceSkillRoot, claudeCopyRoot, { recursive: true });
  fs.cpSync(packagedRoot, codexCopyRoot, { recursive: true });

  const packageFixtureRoot = path.join(fixtureRoot, 'packaged');
  const expected = JSON.parse(fs.readFileSync(path.join(packageFixtureRoot, 'expected.json'), 'utf8'));
  const validRoot = path.join(packageFixtureRoot, 'valid');
  const invalidRoot = path.join(packageFixtureRoot, 'invalid-fork');
  const r1Bytes = fs.readFileSync(path.join(validRoot, 'docs/prd/graph/r001.md'));
  const r2Bytes = fs.readFileSync(path.join(validRoot, 'docs/prd/graph/r002.md'));
  assert.strictEqual(sha256(r1Bytes), expected.valid.r001ArtifactDigest, 'static r1 fixture bytes match independent golden artifact hash');
  assert.strictEqual(sha256(r2Bytes), expected.valid.r002ArtifactDigest, 'static r2 fixture bytes match independent golden artifact hash');
  const body1 = '### REQ-GRPH-010 (aliases: REQ-GRPH-100): Initial requirement\n\nAcceptance: resolve the original alias.\n\n### REQ-GRPH-011: Stable requirement\n\nAcceptance: preserve the stable behavior.\n';
  const body2 = '### REQ-GRPH-010 (aliases: REQ-GRPH-100, REQ-GRPH-101): Initial requirement\n\nAcceptance: resolve the original alias.\n\n### REQ-GRPH-011: Stable requirement\n\nAcceptance: preserve the stable behavior.\n\n### REQ-GRPH-012: Added requirement\n\nAcceptance: include the new behavior.\n';
  const expectedR1Approval = approvalContentDigest({ id: 'PRD-GRPH-001', revision: 1, status: 'effective', drafted_by: 'Alice Example', effective_at: '2026-10-17T00:01:00Z', approval: {} }, body1);
  const expectedR2Approval = approvalContentDigest({ id: 'PRD-GRPH-001', revision: 2, status: 'effective', drafted_by: 'Alice Example', previous_revision: 1, previous_digest: expected.valid.r001ArtifactDigest, effective_at: '2026-10-17T00:02:00Z', approval: {} }, body2);
  assert.strictEqual(expected.valid.r001ApprovalDigest, expectedR1Approval, 'static r1 approval digest matches the independent projection oracle');
  assert.strictEqual(expected.valid.r002ApprovalDigest, expectedR2Approval, 'static r2 approval digest matches the independent projection oracle');
  assert.ok(r1Bytes.toString('utf8').includes(expected.valid.r001ApprovalDigest));
  assert.ok(r2Bytes.toString('utf8').includes(expected.valid.r002ApprovalDigest));

  const inspectScript = `
    const fs = require('fs');
    const lifecycle = require(process.argv[1]);
    const fixtureRoot = process.argv[2];
    const config = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const missing = ['collectDocs', 'analyzeDocs', 'lintDocs', 'resolveRef', 'buildIndex', 'diffRevisions'].filter(name => typeof lifecycle[name] !== 'function');
    if (missing.length) { process.stdout.write(JSON.stringify({ missing })); process.exit(0); }
    try {
      const validDocs = lifecycle.collectDocs(fixtureRoot + '/valid', config);
      const valid = lifecycle.analyzeDocs(validDocs, config, { all: true });
      const current = lifecycle.resolveRef(validDocs, 'PRD-GRPH-001');
      const pinned = lifecycle.resolveRef(validDocs, 'PRD-GRPH-001@r1#REQ-GRPH-100');
      const introducedAlias = lifecycle.resolveRef(validDocs, 'PRD-GRPH-001@r2#REQ-GRPH-101');
      const oldAliasAtR2 = lifecycle.resolveRef(validDocs, 'PRD-GRPH-001@r1#REQ-GRPH-101');
      const index = lifecycle.buildIndex(validDocs, config);
      const diff = lifecycle.diffRevisions(validDocs, 'PRD-GRPH-001@r1', 'PRD-GRPH-001@r2');
      const reverseIndex = lifecycle.buildIndex([...validDocs].reverse(), config);
      const reverseDiff = lifecycle.diffRevisions([...validDocs].reverse(), 'PRD-GRPH-001@r1', 'PRD-GRPH-001@r2');
      const invalidDocs = lifecycle.collectDocs(fixtureRoot + '/invalid-fork', config);
      const invalid = lifecycle.analyzeDocs(invalidDocs, config, { all: true });
      const invalidCurrent = lifecycle.resolveRef(invalidDocs, 'PRD-GRPH-001');
      process.stdout.write(JSON.stringify({
        valid: { diagnostics: valid.diagnostics, evidence: valid.evidence, projectedDiagnostics: lifecycle.lintDocs(validDocs, config, { all: true }), current: { path: current.doc && current.doc.path, revision: current.revision, status: current.status, digest: current.digest, provenance: current.provenance }, pinned: { path: pinned.doc && pinned.doc.path, revision: pinned.revision, status: pinned.status, digest: pinned.digest, requirement: pinned.requirement, provenance: pinned.provenance }, introducedAlias: { path: introducedAlias.doc && introducedAlias.doc.path, requirement: introducedAlias.requirement }, oldAliasAtR2: { error: oldAliasAtR2.error }, index, diff, reverseIndex, reverseDiff },
        invalid: { diagnostics: invalid.diagnostics, evidence: invalid.evidence, current: { path: invalidCurrent.doc && invalidCurrent.doc.path, error: invalidCurrent.error } }
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ runtimeError: error && error.name || 'Error', message: String(error && error.message || error) }));
    }
  `;
  const configPath = path.join(packageFixtureRoot, 'config.json');
  const runtimes = [
    ['source', modulePath],
    ['Claude isolated package', path.join(claudeCopyRoot, 'scripts', 'doc-lifecycle.js')],
    ['Codex isolated package', path.join(codexCopyRoot, 'scripts', 'doc-lifecycle.js')]
  ];
  const results = [];
  for (const [name, runtimePath] of runtimes) {
    const repeated = [];
    for (let run = 0; run < 2; run++) {
      const child = spawnSync(process.execPath, ['-e', inspectScript, runtimePath, packageFixtureRoot, configPath], {
        cwd: tempRoot, encoding: 'utf8', env: gitEnvironment()
      });
      assert.ifError(child.error);
      assert.strictEqual(child.status, 0, `${name} process exit: ${child.stderr}`);
      const output = JSON.parse(child.stdout);
      assert.deepStrictEqual(output.missing || [], [], `${name} exports the complete D6.9 surface`);
      assert.strictEqual(output.runtimeError, undefined, `${name} executes without runtime/setup errors: ${JSON.stringify(output)}`);
      repeated.push({ output, bytes: child.stdout });
    }
    assert.strictEqual(repeated[0].bytes, repeated[1].bytes, `${name} repeated clean runs are byte-deterministic`);
    results.push(repeated[0].output);
  }
  assert.strictEqual(JSON.stringify(results[0]), JSON.stringify(results[1]), 'source and Claude package serialized output bytes agree');
  assert.strictEqual(JSON.stringify(results[0]), JSON.stringify(results[2]), 'source and Codex package serialized output bytes agree');

  const valid = results[0].valid;
  assert.deepStrictEqual(valid.diagnostics, [], 'file-backed valid chain is clean');
  assert.deepStrictEqual(valid.projectedDiagnostics, valid.diagnostics, 'lintDocs remains the diagnostics-only projection');
  assert.strictEqual(valid.evidence.immutability, 'not-observed');
  assert.strictEqual(valid.current.path, 'docs/prd/graph/r002.md');
  assert.strictEqual(valid.current.revision, 2);
  assert.strictEqual(valid.current.status, 'effective');
  assert.strictEqual(valid.current.digest, expected.valid.r002ArtifactDigest);
  assert.ok(valid.current.provenance, 'current resolution exposes its revision provenance');
  assert.strictEqual(valid.pinned.path, 'docs/prd/graph/r001.md');
  assert.strictEqual(valid.pinned.revision, 1);
  assert.strictEqual(valid.pinned.status, 'effective');
  assert.strictEqual(valid.pinned.digest, expected.valid.r001ArtifactDigest);
  assert.strictEqual(valid.pinned.requirement.id, 'REQ-GRPH-010');
  assert.ok(valid.pinned.provenance, 'pinned resolution exposes its revision provenance');
  assert.strictEqual(valid.introducedAlias.path, 'docs/prd/graph/r002.md');
  assert.strictEqual(valid.introducedAlias.requirement.id, 'REQ-GRPH-010');
  assert.ok(valid.oldAliasAtR2.error, 'r2-only alias never resolves in historical r1');
  assert.ok(valid.index.includes('docs/prd/graph/r001.md') && valid.index.includes('docs/prd/graph/r002.md'), 'index contains both real revision files');
  assert.deepStrictEqual(valid.diff.requirements.kept, ['REQ-GRPH-010', 'REQ-GRPH-011']);
  assert.deepStrictEqual(valid.diff.requirements.added, ['REQ-GRPH-012']);
  assert.deepStrictEqual(valid.diff.requirements.changed, []);
  assert.deepStrictEqual(valid.diff.requirements.removed, []);
  assert.deepStrictEqual(valid.diff.requirements.replaced, []);
  assert.strictEqual(valid.index, valid.reverseIndex, 'index output is deterministic under reversed history input');
  assert.strictEqual(JSON.stringify(valid.diff), JSON.stringify(valid.reverseDiff), 'diff output is deterministic under reversed history input');
  assert.ok(results[0].invalid.diagnostics.some(item => item.code === 'revision-fork'), 'packaged diagnostic fixture produces its specified fork finding');
  assert.strictEqual(results[0].invalid.current.path, null, 'forked graph has no arbitrary current revision');
});

// Codex review fix round 1 — close parity, authorization, continuity and
// attribution gaps while keeping each regression independently observable.
checkCase('2ay fix1. offline inventory matches Git for activation transition diagnostics', () => {
  const root = gitRepo('inventory-transition-parity');
  const first = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/sample/r001.md' });
  const second = revisionDoc({ revision: 2, status: 'approved', previousRevision: 1, release_channel: 'stable', relativePath: 'docs/prd/sample/r002.md' }, first);
  writeDoc(root, first.path, first.frontmatter, first.body);
  writeDoc(root, second.path, second.frontmatter, second.body);
  const base = commitAll(root, 'effective and approved baseline');
  const forgedActivation = reviseFixture(second, {
    status: 'effective', effective_at: '2026-10-17T00:02:00Z', release_channel: 'beta'
  });
  writeDoc(root, forgedActivation.path, forgedActivation.frontmatter, forgedActivation.body);

  const fromGit = baseLint(root, base);
  const fromInventory = analyzeDocs(lifecycle.collectDocs(root, CONFIG), {
    workspace: root,
    baseInventory: inventoryAt(root, base)
  });
  expectCode(fromGit.diagnostics, 'invalid-transition');
  assert.deepStrictEqual(fromInventory.diagnostics, fromGit.diagnostics, 'stored-byte inventory parses to the same transition model as the Git base');
});

checkCase('2ay fix1. offline inventory matches Git for migration diagnostics', () => {
  const state = prepareMigrationRepo('inventory-migration-parity');
  const altered = { ...state.migrationRecord, migrated_from_digest: sha256(Buffer.from('forged migration source', 'utf8')) };
  fs.writeFileSync(state.migrationRecordPath, JSON.stringify(altered, null, 2) + '\n', 'utf8');

  const fromGit = baseLint(state.root, state.oldRevision);
  const fromInventory = analyzeDocs(lifecycle.collectDocs(state.root, CONFIG), {
    workspace: state.root,
    baseInventory: inventoryAt(state.root, state.oldRevision)
  });
  expectCode(fromGit.diagnostics, 'migration-record-mismatch');
  assert.deepStrictEqual(fromInventory.diagnostics, fromGit.diagnostics, 'inventory bytes provide the migration source without reopening Git');

  const detachedDocs = lifecycle.collectDocs(state.root, CONFIG).map(doc => {
    const detached = { ...doc };
    Object.defineProperty(detached, 'storedBytes', { value: doc.storedBytes, enumerable: false });
    return detached;
  });
  expectCode(analyzeDocs(detachedDocs, { baseInventory: inventoryAt(state.root, state.oldRevision) }).diagnostics, 'migration-record-missing', 'pure API mode reports that current migration evidence cannot be checked');
});

checkCase('2ay fix1. draft, approved and rejected cross-PRD retirement edges stay pending', () => {
  for (const [index, status] of ['draft', 'approved', 'rejected'].entries()) {
    const target = revisionDoc({ revision: 1, status: 'effective', relativePath: `docs/prd/target-${index}/r001.md` });
    const targetPin = `${target.frontmatter.id}@r1`;
    const source = revisionDoc({
      id: `PRD-IFCE-00${index + 1}`, revision: 1, status,
      relativePath: `docs/prd/source-${index}/r001.md`,
      supersedes: [targetPin], conflicts_with: [targetPin]
    });
    const docs = [target, source];
    const diagnostics = analyzeDocs(docs).diagnostics;
    expectCode(diagnostics, 'recorded-conflict', `${status} source is not eligible to resolve the recorded conflict`);
    const indexText = lifecycle.buildIndex(docs, CONFIG, { all: true });
    const sourceLine = indexText.split('\n').find(line => line.includes(source.path)) || '';
    const targetLine = indexText.split('\n').find(line => line.includes(target.path)) || '';
    assert.ok(sourceLine.includes('pending supersedes: `' + targetPin + '`'), `${status} source edge is rendered as pending: ${sourceLine}`);
    assert.ok(!targetLine.includes('superseded by:'), `${status} source does not retire the target: ${targetLine}`);
  }

  const target = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/invalid-source-target/r001.md' });
  const targetPin = `${target.frontmatter.id}@r1`;
  const invalidEffective = revisionDoc({
    id: 'PRD-IFCE-009', revision: 1, status: 'effective',
    relativePath: 'docs/prd/invalid-source/r001.md',
    supersedes: [targetPin], conflicts_with: [targetPin]
  });
  invalidEffective.frontmatter.approval.content_digest = sha256(Buffer.from('invalid effective source', 'utf8'));
  const docs = [target, invalidEffective];
  expectCode(analyzeDocs(docs).diagnostics, 'recorded-conflict', 'an invalid effective revision cannot resolve the conflict');
  const indexText = lifecycle.buildIndex(docs, CONFIG, { all: true });
  const sourceLine = indexText.split('\n').find(line => line.includes(invalidEffective.path)) || '';
  assert.ok(sourceLine.includes('pending supersedes:'), 'an invalid effective revision edge stays pending in the index');
});

checkCase('2ay fix1. approved snapshots reject metadata, body and approval edits until returned to draft', () => {
  for (const [name, change] of [
    ['metadata', (doc, fm, body) => { fm.release_channel = 'beta'; }],
    ['body', (doc, fm, body) => { body = `${body}\nUnapproved addition.\n`; return body; }],
    ['approval', (doc, fm) => { fm.approval = { ...fm.approval, by: 'Replacement Reviewer' }; }]
  ]) {
    const { root, base } = seedApprovedRepo(`approved-freeze-${name}`);
    const original = lifecycle.collectDocs(root, CONFIG).find(doc => doc.path === 'docs/prd/sample/r001.md');
    const frontmatter = { ...original.frontmatter, approval: { ...original.frontmatter.approval } };
    const body = change(original, frontmatter, original.body) || original.body;
    frontmatter.approval.content_digest = approvalContentDigest(frontmatter, body);
    writeDoc(root, original.path, frontmatter, body);
    expectCode(baseLint(root, base).diagnostics, 'invalid-transition', `${name} edit while still approved`);
  }

  const { root, base } = seedApprovedRepo('approved-freeze-return-to-draft');
  const original = lifecycle.collectDocs(root, CONFIG).find(doc => doc.path === 'docs/prd/sample/r001.md');
  writeDoc(root, original.path, { ...original.frontmatter, status: 'draft' }, `${original.body}\nDraft edit.\n`);
  forbidCode(baseLint(root, base).diagnostics, 'invalid-transition');
});

checkCase('2ay fix1. removed REQ IDs cannot return with a different meaning', () => {
  const firstBody = '### REQ-GRPH-010: Original behavior\n\nAcceptance: keep the original behavior.\n\n### REQ-GRPH-011: Stable behavior\n\nAcceptance: keep stable behavior.\n';
  const secondBody = '### REQ-GRPH-011: Stable behavior\n\nAcceptance: keep stable behavior.\n';
  const thirdBody = '### REQ-GRPH-010: Unrelated behavior\n\nAcceptance: introduce an unrelated behavior under the retired identity.\n\n### REQ-GRPH-011: Stable behavior\n\nAcceptance: keep stable behavior.\n';
  const first = revisionDoc({ revision: 1, status: 'draft', body: firstBody });
  const second = revisionDoc({ revision: 2, status: 'draft', previousRevision: 1, removed_reqs: ['REQ-GRPH-010'], body: secondBody }, first);
  const third = revisionDoc({ revision: 3, status: 'draft', previousRevision: 2, body: thirdBody }, second);
  expectCode(lintDocs([first, second, third]), 'invalid-req-clause', 'tombstoned ID cannot be reused for changed acceptance');
});

checkCase('2ay fix1. replaces targets resolve through historical aliases and reject missing or ambiguous names', () => {
  const parentByAlias = revisionDoc({
    revision: 1, status: 'draft',
    body: '### REQ-GRPH-010 (aliases: REQ-GRPH-100): Original behavior\n\nAcceptance: keep the original behavior.\n'
  });
  const childByAlias = revisionDoc({
    revision: 2, status: 'draft', previousRevision: 1,
    body: '### REQ-GRPH-020 (replaces: REQ-GRPH-100): Replacement behavior\n\nAcceptance: replace the original behavior.\n'
  }, parentByAlias);
  forbidCode(lintDocs([parentByAlias, childByAlias]), 'req-dropped');
  forbidCode(lintDocs([parentByAlias, childByAlias]), 'invalid-req-clause');
  assert.deepStrictEqual(
    diffRevisions([parentByAlias, childByAlias], pin('PRD-GRPH-001', 1), pin('PRD-GRPH-001', 2)).requirements.replaced,
    [{ from: 'REQ-GRPH-010', to: 'REQ-GRPH-020' }],
    'diff resolves a historical alias to its canonical replaced REQ'
  );

  const parent = revisionDoc({ revision: 1, status: 'draft', body: fixtureBody('r001.body.md') });
  const phantom = revisionDoc({
    revision: 2, status: 'draft', previousRevision: 1,
    body: `${fixtureBody('r001.body.md')}\n### REQ-GRPH-020 (replaces: REQ-GRPH-999): Phantom target\n\nAcceptance: reject nonexistent predecessor references.\n`
  }, parent);
  expectCode(lintDocs([parent, phantom]), 'invalid-req-clause', 'replacement target is absent from history');

  const ambiguousParent = revisionDoc({
    revision: 1, status: 'draft',
    body: '### REQ-GRPH-010 (aliases: REQ-GRPH-090): First behavior\n\nAcceptance: keep first behavior.\n\n### REQ-GRPH-011 (aliases: REQ-GRPH-090): Second behavior\n\nAcceptance: keep second behavior.\n'
  });
  const ambiguousChild = revisionDoc({
    revision: 2, status: 'draft', previousRevision: 1,
    body: '### REQ-GRPH-020 (replaces: REQ-GRPH-090): Ambiguous replacement\n\nAcceptance: reject an ambiguous alias.\n'
  }, ambiguousParent);
  expectCode(lintDocs([ambiguousParent, ambiguousChild]), 'invalid-req-clause', 'ambiguous historical alias is not selected arbitrarily');
});

checkCase('2ay fix1. approved and effective revisions require drafted_by and ordered timezone timestamps', () => {
  const missingAuthor = revisionDoc({ revision: 1, status: 'approved' });
  const missingAuthorFm = { ...missingAuthor.frontmatter };
  delete missingAuthorFm.drafted_by;
  missingAuthorFm.approval = { ...missingAuthorFm.approval };
  missingAuthorFm.approval.content_digest = approvalContentDigest(missingAuthorFm, missingAuthor.body);
  expectCode(lintDocs([docObject(missingAuthor.path, missingAuthorFm, missingAuthor.body)]), 'approval-missing', 'drafted_by is required');

  const badApprovalTime = revisionDoc({ revision: 1, status: 'effective', effective_at: '2026-10-17T00:01:00Z' });
  badApprovalTime.frontmatter.approval.at = '2026-10-17T00:00:00';
  expectCode(lintDocs([docObject(badApprovalTime.path, badApprovalTime.frontmatter, badApprovalTime.body)]), 'invalid-transition', 'approval timestamp requires an ISO 8601 timezone');

  const invertedTime = revisionDoc({ revision: 1, status: 'effective', effective_at: '2026-10-17T00:01:00Z' });
  invertedTime.frontmatter.approval.at = '2026-10-17T00:02:00Z';
  expectCode(lintDocs([docObject(invertedTime.path, invertedTime.frontmatter, invertedTime.body)]), 'invalid-transition', 'effective_at cannot precede approval.at');
});

// Codex review fix round 2 — aliases, byte acquisition, trusted identity
// ratcheting, index state and bounded Git process use.
checkCase('2ay fix2. PRD aliases preserve logical identity across a domain rename and inherited pinned lookup', () => {
  const first = revisionDoc({
    id: 'PRD-GRPH-001', revision: 1, status: 'effective', aliases: ['PRD-GRPH-009'],
    relativePath: 'docs/prd/graph/r001.md'
  });
  const renamed = revisionDoc({
    id: 'PRD-IFCE-002', revision: 2, status: 'effective', previousRevision: 1,
    aliases: ['PRD-GRPH-001'], relativePath: 'docs/prd/interface/r002.md'
  }, first);
  const docs = [first, renamed];
  forbidCode(lintDocs(docs), 'invalid-alias');
  forbidCode(lintDocs(docs), 'missing-parent');
  forbidCode(lintDocs(docs), 'multiple-baselines');
  assert.strictEqual(lifecycle.resolveRef(docs, 'PRD-GRPH-001').doc.path, renamed.path, 'the historical canonical spelling resolves the current renamed PRD');
  assert.strictEqual(lifecycle.resolveRef(docs, 'PRD-IFCE-002').doc.path, renamed.path, 'the new canonical spelling resolves the current PRD');
  assert.strictEqual(lifecycle.resolveRef(docs, 'PRD-GRPH-001@r1').doc.path, first.path, 'the old canonical spelling remains pinned to its historical snapshot');
  assert.strictEqual(lifecycle.resolveRef(docs, 'PRD-GRPH-009@r2').doc.path, renamed.path, 'an inherited alias resolves against the requested later snapshot');
  assert.ok(!lifecycle.resolveRef(docs, 'PRD-IFCE-002@r1').doc, 'a future canonical spelling is not retroactively valid at r1');

  const unrelated = revisionDoc({ id: 'PRD-IFCE-003', revision: 1, status: 'effective', aliases: ['PRD-GRPH-009'], relativePath: 'docs/prd/other/r001.md' });
  const collision = expectCode(lintDocs([first, unrelated]), 'alias-collision');
  assert.deepStrictEqual(collision.map(item => item.path), [first.path, unrelated.path].sort());
});

checkCase('2ay fix2. Unicode paths use Git stored-byte semantics across text, eol and autocrlf settings', () => {
  const cases = [
    { autocrlf: 'false', attributes: '*.md text eol=lf\n' },
    { autocrlf: 'false', attributes: '*.md text eol=crlf\n' },
    { autocrlf: 'true', attributes: '*.md text\n' },
    { autocrlf: 'input', attributes: '*.md text=auto\n' }
  ];
  const relativePath = 'docs/prd/契約: "signed" [v1].md';
  for (const [index, variant] of cases.entries()) {
    const root = gitRepo(`unicode-stored-bytes-${index}`, variant.autocrlf);
    fs.writeFileSync(path.join(root, '.gitattributes'), variant.attributes, 'utf8');
    const seed = revisionDoc({ revision: 1, status: 'effective', relativePath });
    writeDoc(root, relativePath, seed.frontmatter, seed.body);
    const base = commitAll(root, `unicode stored bytes ${index}`);
    const working = fs.readFileSync(path.join(root, ...relativePath.split('/'))).toString('utf8');
    fs.writeFileSync(path.join(root, ...relativePath.split('/')), working.replace(/\r?\n/g, '\r\n'), 'utf8');
    const hashObject = git(root, ['hash-object', '--path', relativePath, relativePath]);
    const baselineBlob = git(root, ['rev-parse', `${base}:${relativePath}`]);
    assert.strictEqual(hashObject, baselineBlob, `Git independently normalizes ${relativePath} under ${JSON.stringify(variant)}`);
    const result = baseLint(root, base);
    forbidCode(result.diagnostics, 'approval-content-mismatch');
    forbidCode(result.diagnostics, 'immutable-revision-modified');
  }

  const supplied = revisionDoc({ revision: 1, status: 'effective', relativePath });
  supplied.storedBytes = Buffer.from(supplied.storedBytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
  const direct = lifecycle.resolveRef([supplied], 'PRD-GRPH-001@r1');
  assert.strictEqual(direct.digest, sha256(supplied.storedBytes), 'pure API storedBytes are already stored bytes and are not normalized as a checkout');
});

checkCase('2ay fix2. trusted base IDs include bare legacy, document aliases, REQ IDs and REQ aliases', () => {
  const legacy = docObject('docs/adr/legacy/GRPH-001.md', { id: 'GRPH-001', status: 'accepted' }, '# Archived decision\n');
  legacy.legacy = true;
  const owner = revisionDoc({
    revision: 1, status: 'effective', aliases: ['PRD-GRPH-009'],
    body: '### REQ-GRPH-010 (aliases: REQ-GRPH-100): Stable behavior\n\nAcceptance: preserve the existing behavior.\n'
  });
  const report = docObject('docs/reports/untouched.md', { id: 'REPORT-001', status: 'final' }, [
    'Reference archived `legacy:GRPH-001`.',
    'The renamed plan is `PRD-GRPH-009`.',
    'The requirement identity is `REQ-GRPH-100`.'
  ].join('\n'));
  const baseInventory = [legacy, owner].map(doc => ({
    id: doc.frontmatter.id,
    revision: doc.frontmatter.revision,
    path: doc.path,
    status: doc.frontmatter.status,
    bytes: doc.storedBytes
  }));
  const analysis = analyzeDocs([report], {
    baseInventory,
    changedPaths: [legacy.path, owner.path]
  });
  for (const ref of ['legacy:GRPH-001', 'PRD-GRPH-009', 'REQ-GRPH-100']) {
    const item = analysis.diagnostics.find(diagnostic => diagnostic.id === ref);
    assert.ok(item, `missing-reference diagnostic exists for ${ref}: ${JSON.stringify(analysis.diagnostics)}`);
    assert.strictEqual(item.severity, 'error', `${ref} is escalated through its trusted base owner path`);
    assert.strictEqual(item.path, report.path, 'the diagnostic remains attached to the untouched declaring document');
  }
});

checkCase('2ay fix2. index exposes exact current, historical, pending, invalid and pre-activation PRD state', () => {
  const first = revisionDoc({ revision: 1, status: 'effective', relativePath: 'docs/prd/graph/r001.md' });
  const current = revisionDoc({ revision: 2, status: 'effective', previousRevision: 1, relativePath: 'docs/prd/graph/r002.md' }, first);
  const pending = revisionDoc({ revision: 3, status: 'draft', previousRevision: 2, relativePath: 'docs/prd/graph/r003.md' }, current);
  const preActivation = revisionDoc({ id: 'PRD-IFCE-010', revision: 1, status: 'draft', relativePath: 'docs/prd/pre-activation/r001.md' });
  const invalidBase = revisionDoc({ id: 'PRD-IFCE-011', revision: 1, status: 'effective', relativePath: 'docs/prd/fork/r001.md' });
  const invalidLeft = revisionDoc({ id: 'PRD-IFCE-011', revision: 2, status: 'effective', previousRevision: 1, relativePath: 'docs/prd/fork/r002.md' }, invalidBase);
  const invalidRight = revisionDoc({ id: 'PRD-IFCE-011', revision: 3, status: 'effective', previousRevision: 1, relativePath: 'docs/prd/fork/r003.md' }, invalidBase);
  const retiring = revisionDoc({ id: 'PRD-IFCE-020', revision: 1, status: 'effective', relativePath: 'docs/prd/retiring/r001.md', supersedes: ['PRD-GRPH-001@r2'] });
  const docs = [first, current, pending, preActivation, invalidBase, invalidLeft, invalidRight, retiring];
  const index = lifecycle.buildIndex(docs, CONFIG, { all: true });
  const expected = [
    `- \`PRD-GRPH-001\` — state: valid; current: \`PRD-GRPH-001@r2\` (\`${current.path}\`; digest: \`${sha256(current.storedBytes)}\`); history: \`PRD-GRPH-001@r1\` -> \`PRD-GRPH-001@r2\`; pending: \`PRD-GRPH-001@r3\` (draft)`,
    '- `PRD-IFCE-010` — state: pre-activation; current: none; history: none; pending: `PRD-IFCE-010@r1` (draft)',
    '- `PRD-IFCE-011` — state: invalid; current: none; history: `PRD-IFCE-011@r1` -> `PRD-IFCE-011@r2`; `PRD-IFCE-011@r1` -> `PRD-IFCE-011@r3`; pending: none',
    `- \`PRD-IFCE-020\` — state: valid; current: \`PRD-IFCE-020@r1\` (\`${retiring.path}\`; digest: \`${sha256(retiring.storedBytes)}\`); history: \`PRD-IFCE-020@r1\`; pending: none`
  ].join('\n');
  const section = index.split('## PRD revision chains\n\n')[1]?.split('\n\n## Legacy documents')[0];
  assert.strictEqual(section, expected, 'index publishes exact logical PRD identity, current digest, history and non-current state');
  const oldRow = index.split('\n').find(line => line.includes(first.path)) || '';
  assert.ok(oldRow.includes('stored status: effective; derived state: historical'), `stored and derived state remain distinct: ${oldRow}`);
  const newRow = index.split('\n').find(line => line.includes(current.path)) || '';
  assert.ok(newRow.includes('stored status: effective; derived state: current'), `current revision state is explicit: ${newRow}`);
  const targetRow = index.split('\n').find(line => line.includes(current.path)) || '';
  assert.ok(targetRow.includes('retirement provenance: `PRD-IFCE-020@r1` -> `PRD-GRPH-001@r2`'), `retirement keeps exact source and target pins: ${targetRow}`);
});

checkCase('2ay fix2. trusted base config retains effective identities outside current governed paths', () => {
  const root = gitRepo('base-configured-outside-current-scope');
  const oldConfig = { ...CONFIG, governed: [{ path: 'specifications/prd/**', role: 'prd' }], legacy: [] };
  fs.writeFileSync(path.join(root, 'lifecycle-config.json'), JSON.stringify(oldConfig, null, 2), 'utf8');
  const effective = revisionDoc({ revision: 1, status: 'effective', relativePath: 'specifications/prd/living.md' });
  writeDoc(root, effective.path, effective.frontmatter, effective.body);
  const base = commitAll(root, 'base config governs external PRD path');
  writeDoc(root, effective.path, effective.frontmatter, `${effective.body}\nUnapproved change.\n`);
  const currentConfig = { ...oldConfig, governed: [] };
  fs.writeFileSync(path.join(root, 'lifecycle-config.json'), JSON.stringify(currentConfig, null, 2), 'utf8');
  const result = lifecycle.analyzeDocs([], currentConfig, { workspace: root, base, all: true });
  assert.strictEqual(result.evidence.immutability, 'observed', `base config and effective identity are available: ${JSON.stringify(result)}`);
  expectCode(result.diagnostics, 'immutable-revision-modified', 'base config path remains part of the trusted identity inventory after candidate exclusion');
});

checkCase('2ay fix2. base tree loading uses a bounded small number of Git processes with unrelated files', () => {
  const root = gitRepo('base-process-count');
  for (let index = 0; index < 40; index++) {
    const source = path.join(root, 'src', `unrelated-${String(index).padStart(2, '0')}.txt`);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, `unrelated source ${index}\n`, 'utf8');
  }
  const base = commitAll(root, 'many unrelated files');
  const script = `
    const childProcess = require('child_process');
    const original = childProcess.execFileSync;
    let gitCalls = 0;
    childProcess.execFileSync = function(command, args, options) {
      if (command === 'git') gitCalls++;
      return original.call(this, command, args, options);
    };
    const lifecycle = require(process.argv[1]);
    const config = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
    const result = lifecycle.analyzeDocs([], config, { workspace: process.argv[2], base: process.argv[4], all: true });
    process.stdout.write(JSON.stringify({ gitCalls, evidence: result.evidence }));
  `;
  const child = spawnSync(process.execPath, ['-e', script, modulePath, root, path.join(root, 'lifecycle-config.json'), base], {
    cwd: root,
    encoding: 'utf8',
    env: gitEnvironment()
  });
  assert.ifError(child.error);
  assert.strictEqual(child.status, 0, `instrumented analysis exits cleanly: ${child.stderr}`);
  const output = JSON.parse(child.stdout);
  assert.strictEqual(output.evidence.immutability, 'observed');
  assert.strictEqual(output.gitCalls, 3, `40 unrelated files require only rev-parse, ls-tree and one config-object batch (observed ${output.gitCalls})`);
});

// Codex review fix round 3 — union historical config sources and Git's
// autocrlf binary decision.
checkCase('2ay fix3 P1. historical host-manifest governance protects excluded effective PRDs', () => {
  const root = gitRepo('historical-host-governance');
  const externalPath = 'specifications/contracts/r1.md';
  const historicalConfig = {
    governed: [{ path: 'specifications/contracts/**', role: 'prd' }],
    legacy: []
  };
  const hostManifest = path.join(root, '.claude', 'harness-everything', 'manifest.json');
  fs.mkdirSync(path.dirname(hostManifest), { recursive: true });
  fs.writeFileSync(hostManifest, JSON.stringify({ projectDocs: historicalConfig }, null, 2), 'utf8');
  const effective = revisionDoc({ revision: 1, status: 'effective', relativePath: externalPath });
  writeDoc(root, externalPath, effective.frontmatter, effective.body);
  const base = commitAll(root, 'host manifest governs external effective PRD');

  writeDoc(root, externalPath, effective.frontmatter, `${effective.body}\nUnapproved historical change.\n`);
  fs.rmSync(hostManifest);
  const currentConfig = { ...CONFIG, governed: [] };
  const result = lifecycle.analyzeDocs([], currentConfig, { workspace: root, base, all: true });
  assert.strictEqual(result.evidence.immutability, 'observed', 'the trusted base remains available after host config removal');
  expectCode(result.diagnostics, 'immutable-revision-modified', 'base host projectDocs scope remains protected when current governed paths are empty');
});

checkCase('2ay fix3 P1. the base copy of an explicit nonstandard --config path retains its governance', () => {
  const root = gitRepo('historical-explicit-config-path');
  const relativeConfigPath = 'settings/release-docs.json';
  const configPath = path.join(root, ...relativeConfigPath.split('/'));
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ governed: [{ path: 'specifications/contracts/**', role: 'prd' }], legacy: [] }, null, 2), 'utf8');
  const relativePath = 'specifications/contracts/r1.md';
  const effective = revisionDoc({ revision: 1, status: 'effective', relativePath });
  writeDoc(root, relativePath, effective.frontmatter, effective.body);
  const base = commitAll(root, 'explicit config governs external effective PRD');

  writeDoc(root, relativePath, effective.frontmatter, `${effective.body}\nUnapproved config-scoped change.\n`);
  fs.writeFileSync(configPath, JSON.stringify({ governed: [], legacy: [] }, null, 2), 'utf8');
  const result = spawnSync(process.execPath, [
    modulePath, 'lint', '--workspace', root, '--config', configPath, '--all', '--base', base
  ], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  assert.ifError(result.error);
  assert.ok([0, 1].includes(result.status), `explicit config CLI completes analysis (status ${result.status}; stderr: ${result.stderr})`);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.evidence.immutability, 'observed', 'the trusted base is read with the explicit config path provenance');
  expectCode(output.diagnostics, 'immutable-revision-modified', 'base copy of the nonstandard explicit config keeps its historical PRD glob active');
});

function assertAutocrlfBinaryIdentity(autocrlf) {
  const root = gitRepo(`autocrlf-binary-${autocrlf}`, autocrlf);
  fs.writeFileSync(path.join(root, '.gitattributes'), '', 'utf8');
  const relativePath = 'docs/prd/sample/binary-effective.md';
  const body = '# Binary-safe immutable contract\r\n\r\nAcceptance: preserve this byte.\0\r\n';
  const effective = revisionDoc({ revision: 1, status: 'effective', relativePath, body });
  writeDoc(root, relativePath, effective.frontmatter, body);
  const workingBytes = fs.readFileSync(path.join(root, ...relativePath.split('/')));
  const base = commitAll(root, `NUL binary PRD with autocrlf ${autocrlf}`);
  const storedBytes = gitBytes(root, ['show', `${base}:${relativePath}`]);
  const baseBlob = git(root, ['rev-parse', `${base}:${relativePath}`]);
  const independentlyHashedBlob = git(root, ['hash-object', `--path=${relativePath}`, relativePath]);
  assert.deepStrictEqual(storedBytes, workingBytes, `Git stores NUL-containing bytes unchanged with core.autocrlf=${autocrlf}`);
  assert.strictEqual(independentlyHashedBlob, baseBlob, `Git's own path hash confirms the blob identity under core.autocrlf=${autocrlf}`);

  const result = baseLint(root, base);
  forbidCode(result.diagnostics, 'approval-content-mismatch', `unchanged binary body retains its bound digest with core.autocrlf=${autocrlf}`);
  forbidCode(result.diagnostics, 'immutable-revision-modified', `unchanged binary body retains its effective identity with core.autocrlf=${autocrlf}`);
}

checkCase('2ay fix3 P2. autocrlf=true preserves NUL-containing binary bodies byte-for-byte without attributes', () => {
  assertAutocrlfBinaryIdentity('true');
});

checkCase('2ay fix3 P2. autocrlf=input preserves NUL-containing binary bodies byte-for-byte without attributes', () => {
  assertAutocrlfBinaryIdentity('input');
});

helper.finish();

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { spawnSync } = require('child_process');

const GUARD_PATH = 'scripts/doc-governance-guard.js';
const TRUST_SURFACE_PATHS = [
  GUARD_PATH,
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
const TRUST_SURFACE_PREFIXES = ['ci/fixtures/doc-lifecycle/scenarios/'];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' }
  });
  if (result.error) throw new Error(`git ${args[0]} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr || result.stdout || '').toString('utf8').trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return Buffer.from(result.stdout || '');
}

function resolveCommit(repo, input, label) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input || '')) throw new Error(`${label} must be a full Git commit SHA`);
  const output = git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${input}^{commit}`]).toString('ascii').trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(output) || output.toLowerCase() !== input.toLowerCase()) {
    throw new Error(`${label} did not resolve to the supplied full commit SHA`);
  }
  return output.toLowerCase();
}

function splitNul(bytes, label) {
  if (!bytes.length) return [];
  if (bytes[bytes.length - 1] !== 0) throw new Error(`${label} is not NUL terminated`);
  const fields = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0) {
      fields.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  return fields;
}

function parseTree(bytes) {
  const entries = new Map();
  for (const field of splitNul(bytes, 'git ls-tree output')) {
    const tab = field.indexOf(9);
    if (tab < 0) throw new Error('malformed raw Git tree entry');
    const [mode, type, oid] = field.subarray(0, tab).toString('ascii').split(' ');
    const pathBytes = Buffer.from(field.subarray(tab + 1));
    if (!/^[0-7]{6}$/.test(mode || '') || !['blob', 'tree', 'commit'].includes(type) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(oid || '') || !pathBytes.length) {
      throw new Error('malformed raw Git tree identity');
    }
    const key = pathBytes.toString('base64');
    if (entries.has(key)) throw new Error('duplicate raw Git tree path');
    entries.set(key, { mode, type, oid: oid.toLowerCase(), pathBytes });
  }
  return entries;
}

function tree(repo, commit) {
  return parseTree(git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit]));
}

function regularBlob(entry) {
  return Boolean(entry && entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755'));
}

function readJson(repo, entries, relativePath, label) {
  const entry = entries.get(Buffer.from(relativePath, 'utf8').toString('base64'));
  if (!regularBlob(entry)) throw new Error(`${label} is missing or is not a regular Git blob: ${relativePath}`);
  const bytes = git(repo, ['cat-file', 'blob', entry.oid]);
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) throw new Error(`${label} is not valid UTF-8: ${relativePath}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is malformed JSON: ${relativePath} (${error.message})`);
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateProjectDocs(value, label) {
  if (!isRecord(value) || !Array.isArray(value.governed) || !Array.isArray(value.derived)) {
    throw new Error(`${label} must contain governed and derived arrays`);
  }
  const seen = new Set();
  for (const [kind, records, field] of [['governed', value.governed, 'role'], ['derived', value.derived, 'generator']]) {
    for (const record of records) {
      if (!isRecord(record) || typeof record.path !== 'string' || !record.path || typeof record[field] !== 'string' || !record[field]) {
        throw new Error(`${label} has a malformed ${kind} record`);
      }
      if (record.path.startsWith('/') || record.path.split('/').includes('..') || /[*?\[\]]/.test(record.path)) {
        // shortcut: the baseline registry uses exact Git paths; glob support needs a Git-aware matcher before adoption.
        throw new Error(`${label} has a non-exact governed or derived path: ${record.path}`);
      }
      const key = `${kind}:${record.path}`;
      if (seen.has(key)) throw new Error(`${label} has duplicate ${kind} path: ${record.path}`);
      seen.add(key);
    }
  }
  return value;
}

function validateInventory(value, label) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.documentGlobs) || !Array.isArray(value.rules)) {
    throw new Error(`${label} must contain schemaVersion 1, documentGlobs, and rules`);
  }
  if (!value.documentGlobs.every(item => typeof item === 'string' && item.length)) throw new Error(`${label} has a malformed documentGlobs entry`);
  for (const rule of value.rules) {
    if (!isRecord(rule) || ['match', 'role', 'lifecycle', 'disposition', 'reason'].some(key => typeof rule[key] !== 'string' || !rule[key])) {
      throw new Error(`${label} has a malformed rule`);
    }
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function policyChanges(base, candidate, kind) {
  const byPath = new Map(candidate[kind].map(record => [record.path, record]));
  const basePaths = new Set(base[kind].map(record => record.path));
  const missingOrChanged = base[kind].filter(record => stable(byPath.get(record.path)) !== stable(record)).map(record => ({
    path: record.path,
    base: record,
    candidate: byPath.get(record.path) || null
  }));
  const added = candidate[kind].filter(record => !basePaths.has(record.path));
  return { state: missingOrChanged.length || added.length ? 'review_required' : 'pass', preserved: base[kind].length - missingOrChanged.length, missingOrChanged, added };
}

function pathKey(relativePath) {
  return Buffer.from(relativePath, 'utf8').toString('base64');
}

function pathText(pathBytes) {
  const value = pathBytes.toString('utf8');
  return Buffer.from(value, 'utf8').equals(pathBytes) ? value : null;
}

function identity(entry) {
  return entry ? { mode: entry.mode, type: entry.type, oid: entry.oid } : null;
}

function sameIdentity(left, right) {
  return stable(identity(left)) === stable(identity(right));
}

function trustSurfacePaths(baseTree, candidateTree) {
  const fixed = TRUST_SURFACE_PATHS.map(relativePath => ({ key: pathKey(relativePath), path: relativePath }));
  const fixedKeys = new Set(fixed.map(item => item.key));
  const fixtureEntries = new Map();
  for (const sourceTree of [baseTree, candidateTree]) {
    for (const [key, entry] of sourceTree) {
      if (fixedKeys.has(key) || !TRUST_SURFACE_PREFIXES.some(prefix => entry.pathBytes.subarray(0, Buffer.byteLength(prefix)).equals(Buffer.from(prefix)))) continue;
      fixtureEntries.set(key, pathText(entry.pathBytes));
    }
  }
  const fixtures = [...fixtureEntries]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left, 'base64'), Buffer.from(right, 'base64')))
    .map(([key, path]) => ({ key, path }));
  return [...fixed, ...fixtures];
}

function documentPath(pathBytes) {
  const lower = pathBytes.toString('latin1').toLowerCase();
  return /\.(?:md|mdx|markdown|rst|adoc|txt)$/.test(lower)
    || /(?:^|\/)(?:readme|license|notice|contributing|changelog|code_of_conduct|security)$/.test(lower)
    || /(?:^|\/)(?:readme|changelog)[^/]*$/.test(lower);
}

function unknownNewDocuments(baseTree, candidateTree) {
  const result = [];
  for (const [key, entry] of candidateTree) {
    if (baseTree.has(key) || !documentPath(entry.pathBytes)) continue;
    result.push({
      path: pathText(entry.pathBytes),
      pathBase64: key,
      ...identity(entry),
      role: 'unknown',
      disposition: 'unknown',
      validation: 'unchecked',
      reason: 'New document has no baseline governed/derived record; candidate policy cannot approve it.'
    });
  }
  return result.sort((left, right) => left.pathBase64.localeCompare(right.pathBase64));
}

function checkConfiguredPaths(baseTree, candidateTree, config) {
  const details = [];
  for (const kind of ['governed', 'derived']) {
    for (const record of config[kind]) {
      const key = pathKey(record.path);
      const before = baseTree.get(key);
      const after = candidateTree.get(key);
      if (!regularBlob(before)) throw new Error(`baseline ${kind} path is missing or not a regular file: ${record.path}`);
      const identityPreserved = regularBlob(after) && before.mode === after.mode && before.oid === after.oid;
      details.push({ kind, path: record.path, state: identityPreserved ? 'pass' : 'review_required', base: identity(before), candidate: identity(after) });
    }
  }
  const failures = details.filter(item => item.state !== 'pass');
  return { state: failures.length ? 'review_required' : 'pass', paths: details, missingOrChanged: failures };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!['--repo', '--base', '--candidate'].includes(name) || values[name]) throw new Error(`unexpected or repeated argument: ${name}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${name}`);
    values[name] = value;
  }
  for (const name of ['--repo', '--base', '--candidate']) if (!values[name]) throw new Error(`required argument missing: ${name}`);
  return { repo: values['--repo'], baseInput: values['--base'], candidateInput: values['--candidate'] };
}

function run(argv) {
  let verifierBytes = Buffer.alloc(0);
  try { verifierBytes = fs.readFileSync(__filename); } catch (_) {}
  const report = {
    schema: 'harness.doc-governance-guard.v1',
    verdict: 'FAIL',
    inputs: { repo: null, base: { input: null, commit: null }, candidate: { input: null, commit: null } },
    verifier: {
      path: GUARD_PATH,
      sha256: sha256(verifierBytes),
      provenance: 'unverified',
      baseObject: null,
      matchesBaseObject: false
    },
    policyPreservation: { state: 'unchecked', governed: null, derived: null, configuredPaths: null },
    trustSurface: { state: 'unchecked', paths: [], changed: [] },
    newDocuments: [],
    reviewAuthority: 'External reviewer only; candidate-controlled approval files or reports are never read.',
    limits: [
      'Candidate-owned CI is not independent enforcement; bootstrap remains unchecked until an external reviewer binds frozen guard bytes to final exact SHAs.',
      'Document semantics and derived-view parity are not validated; configured documents are required to keep their baseline Git identities.'
    ],
    errors: []
  };
  let bootstrapUnchecked = false;
  try {
    const args = parseArgs(argv);
    report.inputs.repo = args.repo;
    report.inputs.base.input = args.baseInput;
    report.inputs.candidate.input = args.candidateInput;
    const repo = args.repo;
    const base = resolveCommit(repo, args.baseInput, '--base');
    const candidate = resolveCommit(repo, args.candidateInput, '--candidate');
    report.inputs.base.commit = base;
    report.inputs.candidate.commit = candidate;
    const baseTree = tree(repo, base);
    const candidateTree = tree(repo, candidate);

    const baseGuard = baseTree.get(pathKey(GUARD_PATH));
    if (regularBlob(baseGuard)) {
      const bytes = git(repo, ['cat-file', 'blob', baseGuard.oid]);
      report.verifier.baseObject = identity(baseGuard);
      report.verifier.matchesBaseObject = bytes.equals(verifierBytes);
    }
    report.verifier.provenance = report.verifier.matchesBaseObject ? 'exact bytes match baseline Git object' : 'baseline verifier object unavailable or differs';
    if (!report.verifier.matchesBaseObject) bootstrapUnchecked = true;

    const baseProject = validateProjectDocs(readJson(repo, baseTree, '.agents/harness-everything/project-docs.json', 'baseline project-docs policy'), 'baseline project-docs policy');
    const candidateProject = validateProjectDocs(readJson(repo, candidateTree, '.agents/harness-everything/project-docs.json', 'candidate project-docs policy'), 'candidate project-docs policy');
    validateInventory(readJson(repo, baseTree, '.agents/harness-everything/document-inventory.json', 'baseline document inventory'), 'baseline document inventory');
    validateInventory(readJson(repo, candidateTree, '.agents/harness-everything/document-inventory.json', 'candidate document inventory'), 'candidate document inventory');

    report.policyPreservation.governed = policyChanges(baseProject, candidateProject, 'governed');
    report.policyPreservation.derived = policyChanges(baseProject, candidateProject, 'derived');
    report.policyPreservation.configuredPaths = checkConfiguredPaths(baseTree, candidateTree, baseProject);
    report.policyPreservation.state = [report.policyPreservation.governed, report.policyPreservation.derived, report.policyPreservation.configuredPaths]
      .some(item => item.state !== 'pass') ? 'review_required' : 'pass';

    report.trustSurface.paths = trustSurfacePaths(baseTree, candidateTree).map(({ key, path }) => {
      const before = baseTree.get(key);
      const after = candidateTree.get(key);
      return { path, ...(path === null ? { pathBase64: key } : {}), base: identity(before), candidate: identity(after), changed: !sameIdentity(before, after) };
    });
    report.trustSurface.changed = report.trustSurface.paths.filter(item => item.changed);
    report.trustSurface.state = report.trustSurface.changed.length ? 'review_required' : 'pass';
    report.newDocuments = unknownNewDocuments(baseTree, candidateTree);

    const reviewRequired = report.policyPreservation.state === 'review_required' || report.trustSurface.state === 'review_required';
    report.verdict = bootstrapUnchecked ? 'BOOTSTRAP_UNCHECKED' : reviewRequired ? 'REVIEW_REQUIRED' : 'PASS';
  } catch (error) {
    report.errors.push({ message: error.message || String(error) });
    report.verdict = bootstrapUnchecked ? 'BOOTSTRAP_UNCHECKED' : 'FAIL';
  }
  return report;
}

function exitCode(verdict) {
  return verdict === 'PASS' ? 0 : verdict === 'REVIEW_REQUIRED' ? 2 : verdict === 'BOOTSTRAP_UNCHECKED' ? 3 : 1;
}

const report = run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = exitCode(report.verdict);

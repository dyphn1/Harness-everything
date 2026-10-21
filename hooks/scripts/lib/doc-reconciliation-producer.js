'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _internals: U } = require('./doc-reconciliation-core');
const { scanWorkspaceFiles } = U.runtimeModule('doc-lifecycle.js');
const { resolveDocsConfigCaptured } = U.runtimeModule('project-docs-resolver.js');
const { deriveDocFacts, deriveDocObligations } = U.runtimeModule('doc-obligations.js');

const MAX_FILES = 10000;
const MAX_BYTES = 64 * 1024 * 1024;
const POSIX_MODES = process.platform !== 'win32';
function fail(code) { throw new Error(code); }
// The JS realpath keeps Windows 8.3 spellings (RUNNER~1) while Git reports the long name, so
// directory identity uses native resolution and is case-insensitive on Windows (as workflow-isolation).
function canonicalPath(value) { return fs.realpathSync.native(path.resolve(value)); }
function samePath(a, b) {
  const left = canonicalPath(a);
  const right = canonicalPath(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function git(root, args, options = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try {
    return execFileSync('git', ['-C', root, ...args], { env, timeout: 10000, maxBuffer: MAX_BYTES, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  } catch { fail('baseline-unavailable'); }
}
function fileRecord(relative, mode, storedBytes, presence = 'present') {
  return { path: relative, presence, type: presence === 'present' ? 'file' : '', mode,
    storedBytes: Buffer.from(storedBytes), digest: U.sha(storedBytes) };
}
function validatePaths(records) {
  const names = new Set();
  for (const item of records) {
    const name = item.path;
    if (!name || name.includes('\\') || name.includes('\ufffd') || name.startsWith('/')
      || name.split('/').some(segment => !segment || segment === '..' || segment === '.')) fail('inventory-unsupported');
    const folded = name.normalize('NFC').toLowerCase();
    if (names.has(folded)) fail('inventory-unsupported');
    names.add(folded);
  }
}
function captureBaseline(root, pin) {
  if (!U.record(pin) || !/^[a-f0-9]{40,64}$/.test(pin.commit || '') || !U.text(pin.root)
    || !samePath(pin.root, root)) fail('baseline-unavailable');
  const actualRoot = git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (!samePath(actualRoot, root)) fail('baseline-unavailable');
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${pin.commit}^{commit}`]).toString('utf8').trim();
  const treeRef = git(root, ['rev-parse', '--verify', '--end-of-options', `${commit}^{tree}`]).toString('utf8').trim();
  const entries = git(root, ['ls-tree', '-r', '-z', '--full-tree', treeRef]).toString('utf8').split('\0').filter(Boolean);
  if (entries.length > MAX_FILES) fail('inventory-unsupported');
  const records = [];
  let total = 0;
  for (const entry of entries) {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/s);
    if (!match) fail('inventory-unsupported');
    const storedBytes = git(root, ['cat-file', 'blob', match[2]]);
    total += storedBytes.length;
    if (total > MAX_BYTES) fail('inventory-unsupported');
    records.push(fileRecord(match[3], match[1], storedBytes));
  }
  validatePaths(records);
  return { commit, treeRef, records };
}
function captureCandidate(root, baseline) {
  const raw = [];
  let total = 0;
  let visited = 0;
  function walk(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => U.compare(a.name, b.name));
    for (const entry of entries) {
      if (!prefix && entry.name === '.git') continue;
      if (++visited > MAX_FILES) fail('inventory-unsupported');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) {
        // Windows stats carry no POSIX permission bits (directories report 0o666); an unreadable
        // path there makes readdir/readFile throw instead.
        if (POSIX_MODES && (!(stat.mode & 0o444) || !(stat.mode & 0o111))) fail('inventory-incomplete');
        walk(absolute, relative);
        continue;
      }
      if (!stat.isFile()) fail('inventory-unsupported');
      // Unreadable files must remain unavailable even when the process has elevated read access.
      if (POSIX_MODES && !(stat.mode & 0o444)) fail('inventory-incomplete');
      const bytes = fs.readFileSync(absolute);
      total += bytes.length;
      if (raw.length >= MAX_FILES || total > MAX_BYTES) fail('inventory-unsupported');
      raw.push({ path: relative, raw: bytes, mode: stat.mode & 0o111 ? '100755' : '100644' });
    }
  }
  walk(root, '');
  validatePaths(raw);
  // Refuse filters/encodings that the existing stored-byte reader does not model.
  if (raw.length) {
    const attrs = git(root, ['check-attr', '-z', '--stdin', 'filter', 'working-tree-encoding', 'ident'], { input: Buffer.from(raw.map(r => r.path).join('\0') + '\0') }).toString('utf8').split('\0');
    for (let i = 0; i + 2 < attrs.length; i += 3) {
      if (!['unspecified', 'unset'].includes(attrs[i + 2])) fail('inventory-unsupported');
    }
  }
  // Lifecycle owns text/eol/autocrlf conversion. A completeness walk above detects its skipped paths.
  const stored = new Map(scanWorkspaceFiles(root).map(item => [item.path, item.bytes]));
  const records = raw.map(item => {
    const converted = stored.get(item.path);
    if (!converted) fail('inventory-unsupported');
    // An unexplained non-CR difference means the two readers observed different bytes.
    if (!item.raw.includes(13) && !item.raw.equals(converted)) fail('snapshot-changed');
    return fileRecord(item.path, item.mode, converted);
  });
  for (const item of baseline.records) if (!stored.has(item.path)) records.push(fileRecord(item.path, '', Buffer.alloc(0), 'deleted'));
  return records;
}
const progressKeys = new Set(['status', 'state', 'evidence', 'loaded', 'loadedAt', 'updatedAt', 'createdAt', 'completedAt', 'timestamp', 'report', 'reports']);
function planSemantics(value) {
  if (Array.isArray(value)) return value.map(planSemantics);
  if (!U.record(value)) return value;
  return Object.fromEntries(Object.keys(value).filter(key => !progressKeys.has(key)).map(key => [key, planSemantics(value[key])]));
}
function contextFor(input, provider) {
  if (!provider || typeof provider.resolveContext !== 'function') fail('origin-unavailable');
  const response = provider.resolveContext({ workspaceRoot: input.workspaceRoot, workflowId: input.workflow.workflowId, sessionId: input.workflow.sessionId });
  if (response?.status !== 'accepted') fail(response?.status === 'rejected' ? 'origin-untrusted' : 'origin-unavailable');
  const c = response.context;
  if (!U.record(c) || !U.text(response.originRef) || !U.text(c.workspaceId) || !U.text(c.baselineReference)
    || !U.text(c.principals?.author) || !Array.isArray(c.principals?.executors) || !c.principals.executors.every(U.text)) fail('origin-untrusted');
  for (const key of ['sessionId', 'workflowId', 'workflowRevision']) if (c[key] !== input.workflow[key]) fail('identity-mismatch');
  if (c.taskId !== input.task.taskId || U.stable(c.activeHost) !== U.stable(input.activeHost)) fail('identity-mismatch');
  if (c.workspaceRoot && !samePath(c.workspaceRoot, input.workspaceRoot)) fail('identity-mismatch');
  if (c.baseline && (c.baseline.commit !== input.baseline.commit || c.baseline.root !== input.baseline.root)) fail('baseline-unavailable');
  return U.clone({ ...c, workspaceRoot: canonicalPath(input.workspaceRoot), originRef: response.originRef });
}
function filesOf(records) {
  return Object.fromEntries(records.filter(r => r.presence === 'present').map(r => [r.path, new TextDecoder('utf-8', { fatal: true }).decode(r.storedBytes)]));
}
function produceDocSnapshot(input, dependencies = {}) {
  const originProvider = dependencies?.originProvider;
  try {
    if (!U.record(input) || !U.text(input.workspaceRoot) || !U.record(input.workflow) || !U.record(input.task)
      || !U.text(input.task.taskId) || !Array.isArray(input.task.requirements) || !U.record(input.scope)
      || !Number.isInteger(input.workflow.workflowRevision) || input.workflow.workflowRevision < 0) fail('invalid-input');
    if ((input.prdRoot === undefined ? 'docs/prd/' : input.prdRoot) !== 'docs/prd/' || (input.scope.prdRoot && input.scope.prdRoot !== 'docs/prd/')) fail('unsupported-prd-root');
    const root = canonicalPath(input.workspaceRoot);
    const detached = U.clone(input);
    const originContext = contextFor(detached, originProvider);
    const baseline = captureBaseline(root, detached.baseline);
    const config = resolveDocsConfigCaptured(root, { activeHost: detached.activeHost });
    if (!['project', 'host'].includes(config.resolution.status) || config.capture.sources.some(s => s.presence === 'unreadable')) fail('config-unavailable');
    const coverage = { kind: 'whole-project', excluded: ['.git'], scope: planSemantics(detached.scope) };
    const candidate = { records: captureCandidate(root, baseline), coverage };
    // Same owned config bytes must be the bytes covered by the working-tree capture.
    for (const source of config.capture.sources) {
      const file = candidate.records.find(r => r.path === source.path && r.presence === 'present');
      if (source.presence === 'present' ? !file || !U.bytes(source.bytes).equals(file.storedBytes) : Boolean(file)) fail('snapshot-changed');
    }
    config.digest = U.configDigest(config);
    baseline.digest = U.snapshotDigest('baseline', baseline, coverage, baseline.records);
    candidate.digest = U.snapshotDigest('candidate', baseline, coverage, candidate.records);
    const taskSemantics = { task: planSemantics(detached.task), scope: planSemantics(detached.scope), workflow: planSemantics(detached.workflow), coverage, configDigest: config.digest, prdRoot: 'docs/prd/' };
    const identity = { workspaceId: originContext.workspaceId, sessionId: originContext.sessionId, workflowId: originContext.workflowId,
      workflowRevision: originContext.workflowRevision, taskId: originContext.taskId, taskScopeDigest: U.structuredDigest('doc-task-scope-v1', taskSemantics),
      baselineDigest: baseline.digest, candidateDigest: candidate.digest, configDigest: config.digest, prdRoot: 'docs/prd/' };
    const derived = deriveDocFacts({ base: { files: filesOf(baseline.records) }, candidate: { files: filesOf(candidate.records) }, config: config.resolution.config });
    if (!derived.facts?.inputKnown) fail('inventory-incomplete');
    const facts = derived.facts;
    const obligations = deriveDocObligations(facts);
    const derivationReasons = Object.fromEntries(obligations.map(o => [o.id, { applicability: o.applicability, reason: `captured facts derive ${o.capability}: ${o.applicability}`, factRefs: ['facts', ...(o.scope?.paths || []).map(p => `inventory:${p}`)] }]));
    const again = captureCandidate(root, baseline);
    const configAgain = resolveDocsConfigCaptured(root, { activeHost: detached.activeHost });
    let finalContext;
    try { finalContext = contextFor(detached, originProvider); }
    catch { fail('snapshot-changed'); }
    if (U.snapshotDigest('candidate', baseline, coverage, again) !== candidate.digest || U.configDigest(configAgain) !== config.digest
      || U.stable(originContext) !== U.stable(finalContext)) fail('snapshot-changed');
    return { state: 'ready', snapshot: { identity, baseline, candidate, config, originContext, taskSemantics, facts, obligations, derivationReasons }, diagnostics: [] };
  } catch (error) {
    const codes = ['invalid-input', 'baseline-unavailable', 'inventory-incomplete', 'inventory-unsupported', 'snapshot-changed', 'config-unavailable', 'unsupported-prd-root', 'identity-mismatch', 'origin-unavailable', 'origin-untrusted'];
    const code = codes.includes(error.message) ? error.message : 'inventory-unsupported';
    return { state: 'unavailable', snapshot: null, diagnostics: [U.diagnostic(code)] };
  }
}
module.exports = { produceDocSnapshot };

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _internals: U } = require('./doc-reconciliation-core');
const { convertWorkspaceFiles } = U.runtimeModule('doc-lifecycle.js');
const { resolveDocsConfigCaptured, validateDocsConfig } = U.runtimeModule('project-docs-resolver.js');
const { deriveDocFacts, deriveDocObligations } = U.runtimeModule('doc-obligations.js');

const MAX_FILES = 10000;
const MAX_BYTES = 64 * 1024 * 1024;
const POSIX_MODES = process.platform !== 'win32';
const PROJECT_CONFIG_PATH = '.agents/harness-everything/project-docs.json';
const SUPPORTED_ARTIFACT_ROOTS = new Set(['node_modules', '.husky/_']);
const POLICY_VERSION = 'dependency-artifact-scope/1';
function fail(code, reasonCode) { throw Object.assign(new Error(code), reasonCode ? { reasonCode } : {}); }
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

function pathUnderRoot(relative, root) {
  const candidate = String(relative).replace(/\\/g, '/').normalize('NFC').toLowerCase();
  const expected = root.normalize('NFC').toLowerCase();
  return candidate === expected || candidate.startsWith(`${expected}/`);
}
function rootMention(value, root) {
  const normalized = String(value).replace(/\\/g, '/').normalize('NFC').toLowerCase();
  const needle = root.normalize('NFC').toLowerCase();
  let offset = 0;
  while ((offset = normalized.indexOf(needle, offset)) >= 0) {
    const before = offset === 0 || !/[a-z0-9_.-]/.test(normalized[offset - 1]);
    const after = offset + needle.length;
    const boundary = after === normalized.length || /[/*?\s"'`:#),;\]]/.test(normalized[after]);
    if (before && boundary) return true;
    offset++;
  }
  return false;
}
function globSegmentMatches(pattern, segment) {
  const escaped = pattern.split('*').map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(segment);
}
function selectorMayIntersectRoot(selector, root) {
  if (typeof selector !== 'string' || !selector.trim()) return true;
  const normalized = selector.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return true;
  const pattern = normalized.split('/');
  const target = root.split('/');
  let states = new Set([0]);
  const closure = values => {
    const expanded = new Set(values);
    let changed = true;
    while (changed) {
      changed = false;
      for (const index of expanded) {
        if (pattern[index] === '**' && !expanded.has(index + 1)) {
          expanded.add(index + 1);
          changed = true;
        }
      }
    }
    return expanded;
  };
  states = closure(states);
  for (const segment of target) {
    const next = new Set();
    for (const index of states) {
      if (index >= pattern.length) continue;
      if (pattern[index] === '**') next.add(index);
      else if (globSegmentMatches(pattern[index], segment)) next.add(index + 1);
    }
    states = closure(next);
    if (!states.size) return false;
  }
  return states.size > 0;
}
function valueMayIntersectRoots(value, roots) {
  if (typeof value === 'string') return roots.some(root => rootMention(value, root)
    || ((value.includes('/') || /[*?]/.test(value)) && selectorMayIntersectRoot(value, root)));
  if (Array.isArray(value)) return value.some(item => valueMayIntersectRoots(item, roots));
  if (U.record(value)) return Object.entries(value).some(([key, item]) => valueMayIntersectRoots(key, roots)
    || valueMayIntersectRoots(item, roots));
  return false;
}
function projectConfigFromBytes(bytes) {
  try {
    const config = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return { config, valid: validateDocsConfig(config).valid };
  } catch { return { config: null, valid: false }; }
}
function baselineProjectConfig(baseline) {
  const source = baseline.records.find(item => item.path === PROJECT_CONFIG_PATH && item.presence === 'present');
  return source ? { source, ...projectConfigFromBytes(source.storedBytes) } : { source: null, config: null, valid: false };
}
function capturedProjectConfig(config) {
  const source = config.capture.sources.find(item => item.path === PROJECT_CONFIG_PATH);
  return source && source.presence === 'present'
    ? { source, ...projectConfigFromBytes(source.bytes) }
    : { source: source || null, config: null, valid: false };
}
function dependencyRoots(config) {
  return U.record(config) && U.record(config.inventory)
    && Object.prototype.hasOwnProperty.call(config.inventory, 'dependencyArtifactRoots')
    ? config.inventory.dependencyArtifactRoots : undefined;
}
function sameRootField(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return U.stable([...left].sort()) === U.stable([...right].sort());
}
function validateExcludedRoots(workspaceRoot, roots) {
  const workspace = canonicalPath(workspaceRoot);
  const states = [];
  for (const root of roots) {
    let parent = workspace;
    let presence = 'present-directory';
    for (const component of root.split('/')) {
      let entries;
      try { entries = fs.readdirSync(parent, { withFileTypes: true }); }
      catch { fail('inventory-incomplete', 'dependency-root-parent-unreadable'); }
      const aliases = entries.filter(entry => entry.name.normalize('NFC').toLowerCase() === component.normalize('NFC').toLowerCase());
      if (aliases.length > 1 || aliases.some(entry => entry.name !== component)) fail('inventory-unsupported', 'dependency-root-alias');
      const current = path.join(parent, component);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) {
        if (error.code === 'ENOENT') { presence = 'absent'; break; }
        fail('inventory-incomplete', 'dependency-root-unreadable');
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('inventory-unsupported', 'dependency-root-not-plain-directory');
      let real;
      try { real = fs.realpathSync.native(current); }
      catch { fail('inventory-incomplete', 'dependency-root-unreadable'); }
      const within = process.platform === 'win32'
        ? real.toLowerCase().startsWith(`${workspace.toLowerCase()}${path.sep}`)
        : real.startsWith(`${workspace}${path.sep}`);
      if (!within) fail('inventory-unsupported', 'dependency-root-outside-workspace');
      parent = current;
    }
    states.push({ path: root, presence });
  }
  return states;
}
function guardedPolicy(root, baseline, capturedConfig, input) {
  const base = baselineProjectConfig(baseline);
  const current = capturedProjectConfig(capturedConfig);
  const baselineRoots = base.valid ? dependencyRoots(base.config) : undefined;
  const candidateRoots = current.valid ? dependencyRoots(current.config) : undefined;
  if (current.valid && candidateRoots !== undefined && (!base.valid || !sameRootField(baselineRoots, candidateRoots))) {
    fail('inventory-unsupported', 'dependency-artifact-policy-changed-or-unpinned');
  }
  if (!base.valid || baselineRoots === undefined || baselineRoots.length === 0) return null;
  if (!current.valid || !sameRootField(baselineRoots, candidateRoots)) fail('inventory-unsupported', 'dependency-artifact-policy-changed-or-unpinned');
  const roots = [...baselineRoots].sort();
  const indexed = git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (baseline.records.some(item => roots.some(value => pathUnderRoot(item.path, value)))) fail('inventory-unsupported', 'baseline-path-overlap');
  if (indexed.some(item => roots.some(value => pathUnderRoot(item, value)))) fail('inventory-unsupported', 'index-path-overlap');
  if (capturedConfig.capture.sources.some(item => roots.some(value => pathUnderRoot(item.path, value)))) {
    fail('inventory-unsupported', 'config-source-overlap');
  }
  const configs = [base.config, capturedConfig.resolution.config];
  if (configs.some(config => {
    if (!U.record(config)) return false;
    const selectors = Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'inventory'));
    return valueMayIntersectRoots(selectors, roots);
  })) fail('inventory-unsupported', 'config-selector-overlap');
  if (valueMayIntersectRoots({ task: input.task, scope: input.scope }, roots)) {
    fail('inventory-unsupported', 'task-input-overlap');
  }
  return {
    roots,
    baselineCommit: baseline.commit,
    storedBytesDigest: U.sha(base.source.storedBytes),
    guardOutcomes: [
      { guard: 'baseline-paths', state: 'clear', reason: 'No baseline path intersects an approved root.' },
      { guard: 'index-paths', state: 'clear', reason: 'No current index path intersects an approved root.' },
      { guard: 'config-sources', state: 'clear', reason: 'No baseline or current config source intersects an approved root.' },
      { guard: 'config-selectors', state: 'clear', reason: 'Baseline and current config declarations are disjoint from approved roots.' },
      { guard: 'task-inputs', state: 'clear', reason: 'No explicit task or requirement input intersects an approved root.' }
    ]
  };
}
function captureCandidate(root, baseline, excludedRoots = []) {
  const excludedRootStates = excludedRoots.length ? validateExcludedRoots(root, excludedRoots) : [];
  const raw = [];
  let total = 0;
  let visited = 0;
  function walk(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => U.compare(a.name, b.name));
    for (const entry of entries) {
      if (!prefix && entry.name === '.git') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excludedRoots.includes(relative)) continue;
      if (++visited > MAX_FILES) fail('inventory-unsupported');
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
  const stored = new Map(convertWorkspaceFiles(root, raw.map(item => ({ path: item.path, bytes: item.raw })))
    .map(item => [item.path, item.bytes]));
  const records = raw.map(item => {
    const converted = stored.get(item.path);
    if (!converted) fail('inventory-unsupported');
    // An unexplained non-CR difference means the two readers observed different bytes.
    if (!item.raw.includes(13) && !item.raw.equals(converted)) fail('snapshot-changed');
    return fileRecord(item.path, item.mode, converted);
  });
  for (const item of baseline.records) if (!stored.has(item.path)) records.push(fileRecord(item.path, '', Buffer.alloc(0), 'deleted'));
  return { records, excludedRootStates };
}
const progressKeys = new Set(['status', 'state', 'evidence', 'loaded', 'loadedAt', 'updatedAt', 'createdAt', 'completedAt', 'timestamp', 'report', 'reports']);
// Progress fields are excluded only at their defined record locations (top-level task/workflow, each
// requirement, each requirement binding). Nested objects keep every key: a nested `status`/`state` there
// is semantic and must change taskScopeDigest (PR #353 review P2).
function withoutProgress(value, keys = progressKeys) {
  if (!U.record(value)) return U.clone(value);
  return Object.fromEntries(Object.keys(value).filter(key => !keys.has(key)).map(key => [key, U.clone(value[key])]));
}
// A binding's `report`/`reports` object configures the binding; only its load/status records are progress.
const bindingProgressKeys = new Set([...progressKeys].filter(key => key !== 'report' && key !== 'reports'));
function taskSemantics(task) {
  const semantic = withoutProgress(task);
  if (Array.isArray(task?.requirements)) {
    semantic.requirements = task.requirements.map(requirement => {
      const item = withoutProgress(requirement);
      if (U.record(requirement) && Array.isArray(requirement.bindings)) item.bindings = requirement.bindings.map(binding => withoutProgress(binding, bindingProgressKeys));
      return item;
    });
  }
  return semantic;
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
  // The provider must bind the concrete workflow-start pin; a bare reference cannot authorize a
  // re-anchored baseline (PR #353 review P1).
  if (!U.record(c.baseline) || !U.text(c.baseline.commit) || !U.text(c.baseline.root)
    || !U.record(input.baseline) || c.baseline.commit !== input.baseline.commit || !samePath(c.baseline.root, input.baseline.root)) fail('baseline-unavailable');
  const root = canonicalPath(input.workspaceRoot);
  return U.clone({ ...c, baseline: { ...c.baseline, root }, workspaceRoot: root, originRef: response.originRef });
}
function filesOf(records, config) {
  // The inventory is whole-project: binary records keep their stored bytes in the identity framing and are
  // omitted from semantic derivation unless the derive contract can observe them (PR #353 review P2).
  return U.deriveFiles(records, config);
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
    const policy = guardedPolicy(root, baseline, config, detached);
    const firstCapture = captureCandidate(root, baseline, policy?.roots || []);
    const coverage = policy ? {
      kind: 'project-with-dependency-artifact-exclusions',
      policyVersion: POLICY_VERSION,
      policySource: { path: PROJECT_CONFIG_PATH, baselineCommit: policy.baselineCommit, storedBytesDigest: policy.storedBytesDigest },
      dependencyArtifactRoots: policy.roots,
      excluded: ['.git', ...policy.roots],
      excludedRootStates: firstCapture.excludedRootStates,
      guardOutcomes: [...policy.guardOutcomes,
        { guard: 'excluded-root-types', state: 'clear', reason: 'Each approved root is an in-workspace directory or absent.', roots: firstCapture.excludedRootStates }],
      scope: U.clone(detached.scope)
    } : { kind: 'whole-project', excluded: ['.git'], scope: U.clone(detached.scope) };
    const candidate = { records: firstCapture.records, coverage };
    // Same owned config bytes must be the bytes covered by the working-tree capture.
    for (const source of config.capture.sources) {
      const file = candidate.records.find(r => r.path === source.path && r.presence === 'present');
      if (source.presence === 'present' ? !file || !U.bytes(source.bytes).equals(file.storedBytes) : Boolean(file)) fail('snapshot-changed');
    }
    config.digest = U.configDigest(config);
    baseline.digest = U.snapshotDigest('baseline', baseline, coverage, baseline.records);
    candidate.digest = U.snapshotDigest('candidate', baseline, coverage, candidate.records);
    const planIdentity = { task: taskSemantics(detached.task), scope: U.clone(detached.scope), workflow: withoutProgress(detached.workflow), coverage, configDigest: config.digest, prdRoot: 'docs/prd/' };
    const identity = { workspaceId: originContext.workspaceId, sessionId: originContext.sessionId, workflowId: originContext.workflowId,
      workflowRevision: originContext.workflowRevision, taskId: originContext.taskId, taskScopeDigest: U.structuredDigest('doc-task-scope-v1', planIdentity),
      baselineDigest: baseline.digest, candidateDigest: candidate.digest, configDigest: config.digest, prdRoot: 'docs/prd/' };
    const derived = deriveDocFacts({ base: { files: filesOf(baseline.records, config.resolution.config) },
      candidate: { files: filesOf(candidate.records, config.resolution.config) }, config: config.resolution.config });
    if (!derived.facts?.inputKnown) fail('inventory-incomplete');
    const facts = derived.facts;
    const obligations = deriveDocObligations(facts);
    const derivationReasons = Object.fromEntries(obligations.map(o => [o.id, { applicability: o.applicability, reason: `captured facts derive ${o.capability}: ${o.applicability}`, factRefs: ['facts', ...(o.scope?.paths || []).map(p => `inventory:${p}`)] }]));
    const again = captureCandidate(root, baseline, policy?.roots || []);
    const configAgain = resolveDocsConfigCaptured(root, { activeHost: detached.activeHost });
    const policyAgain = guardedPolicy(root, baseline, configAgain, detached);
    let finalContext;
    try { finalContext = contextFor(detached, originProvider); }
    catch { fail('snapshot-changed'); }
    if (U.snapshotDigest('candidate', baseline, coverage, again.records) !== candidate.digest
      || U.stable(again.excludedRootStates) !== U.stable(firstCapture.excludedRootStates)
      || U.stable(policyAgain) !== U.stable(policy) || U.configDigest(configAgain) !== config.digest
      || U.stable(originContext) !== U.stable(finalContext)) fail('snapshot-changed');
    return { state: 'ready', snapshot: { identity, baseline, candidate, config, originContext, taskSemantics: planIdentity, facts, obligations, derivationReasons }, diagnostics: [] };
  } catch (error) {
    const codes = ['invalid-input', 'baseline-unavailable', 'inventory-incomplete', 'inventory-unsupported', 'snapshot-changed', 'config-unavailable', 'unsupported-prd-root', 'identity-mismatch', 'origin-unavailable', 'origin-untrusted'];
    const code = codes.includes(error.message) ? error.message : 'inventory-unsupported';
    return { state: 'unavailable', snapshot: null, diagnostics: [U.diagnostic(code, error.reasonCode ? { reasonCode: error.reasonCode } : {})] };
  }
}
module.exports = { produceDocSnapshot };

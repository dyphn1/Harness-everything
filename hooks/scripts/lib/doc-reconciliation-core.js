'use strict';

const crypto = require('crypto');

// Both layouts are shipped by plugin:sync. Resolve modules at import, never during a decision.
function runtimeModule(name) {
  try { return require('../../../harness-everything/scripts/' + name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.startsWith("Cannot find module '../../../harness-everything/scripts/" + name + "'")) throw error;
    return require('../../../skills/harness-everything/scripts/' + name);
  }
}
const { checkDocObligations } = runtimeModule('doc-evidence.js');
const { deriveDocFacts, deriveDocObligations } = runtimeModule('doc-obligations.js');
const text = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const bytes = value => Buffer.isBuffer(value) ? Buffer.from(value)
  : value && value.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data)
    : (() => { throw new Error('inventory-unsupported'); })();
function canonical(value) {
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: [...value] };
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]));
}
const stable = value => JSON.stringify(canonical(value));
const clone = value => JSON.parse(stable(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const frame = value => { const b = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); return Buffer.concat([Buffer.from(b.length + ':'), b]); };
const hashFrames = values => sha(Buffer.concat(values.map(frame)));
const structuredDigest = (domain, value) => hashFrames([domain, stable(value)]);
const identityFields = ['workspaceId', 'sessionId', 'workflowId', 'workflowRevision', 'taskId', 'taskScopeDigest', 'baselineDigest', 'candidateDigest', 'configDigest', 'prdRoot'];
const validIdentity = id => record(id) && ['workspaceId', 'sessionId', 'workflowId', 'taskId'].every(key => text(id[key]))
  && Number.isInteger(id.workflowRevision) && id.workflowRevision >= 0 && id.prdRoot === 'docs/prd/'
  && ['taskScopeDigest', 'baselineDigest', 'candidateDigest', 'configDigest'].every(key => /^[a-f0-9]{64}$/.test(id[key] || ''));
const sameIdentity = (a, b) => validIdentity(a) && validIdentity(b) && identityFields.every(key => a[key] === b[key]);
const diagnostic = (code, context = {}) => ({ code, message: code.replace(/-/g, ' '), ...context });
const pathCompare = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
const codedError = code => Object.assign(new Error(code), { code });
// The derive contract (doc-obligations.js) decides applicability from governed/legacy documents, derived
// outputs and code/REQ-test paths. Records outside them cannot affect document obligations.
// shortcut: mirrors derive path rules, update them together until a shared classifier is exposed.
const CODE_EXTENSION = /\.(?:c|cc|cpp|h|hpp|m|mm|go|rs|java|kt|swift|js|jsx|mjs|cjs|ts|tsx|py|rb|php|sh|ps1|sql)$/i;
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|(?:^|\/)[^/]*(?:\.test|\.spec)\.[^/]+$/i;
// Glob semantics of the derive contract: '**' crosses directories, '*' stays inside one segment.
function globToRegExp(glob) {
  const source = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  let pattern = '^';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '*' && source[index + 1] === '*') {
      if (source[index + 2] === '/') { pattern += '(?:.*/)?'; index += 2; }
      else { pattern += '.*'; index += 1; }
    } else if (char === '*') pattern += '[^/]*';
    else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${pattern}$`);
}
// Semantic relevance of a path under the derive contract; null means the path cannot change applicability.
function semanticRelevance(path, config) {
  const governed = Array.isArray(config && config.governed) ? config.governed : [];
  const legacy = Array.isArray(config && config.legacy) ? config.legacy : [];
  const derived = Array.isArray(config && config.derived) ? config.derived : [];
  const matches = globs => globs.some(glob => typeof glob === 'string' && globToRegExp(glob).test(path));
  if (governed.some(entry => entry && typeof entry.path === 'string' && matches([entry.path]))) return 'document';
  if (matches(legacy)) return 'document';
  if (derived.some(entry => entry && typeof entry.path === 'string'
    && (matches([entry.path]) || matches([entry.source, ...(Array.isArray(entry.sources) ? entry.sources : [])])))) return 'derived';
  if (CODE_EXTENSION.test(path)) return 'code';
  if (TEST_PATH.test(path)) return 'test';
  return null;
}
// The derive contract reads the frontmatter of every captured file, so a record that opens a frontmatter
// block is observed by it even when the record's bytes cannot be decoded. Match TextDecoder's BOM handling.
function opensFrontmatter(stored) {
  return stored.subarray(0, 11).toString('utf8').replace(/^\uFEFF/, '').split('\n')[0].replace(/\r$/, '') === '---';
}
// A whole-project inventory keeps every stored byte in the identity framing. Semantic derivation converts only
// records it can decode; a record the derive contract can observe (governed/derived/code/test path or a
// frontmatter document) fails closed instead of being silently dropped.
function deriveFiles(records, config, options = {}) {
  const files = {};
  for (const item of records || []) {
    if (!record(item) || item.presence !== 'present') continue;
    // The unchanged derive API uses ordinary object maps, whose __proto__ setter drops this path.
    if (item.path === '__proto__') throw codedError('inventory-unsupported');
    const stored = bytes(item.storedBytes);
    if (options.strict && (item.digest !== sha(stored) || item.type !== 'file' || !['100644', '100755'].includes(item.mode))) {
      throw codedError('invalid-input');
    }
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(stored); }
    catch {
      if (semanticRelevance(item.path, config) || opensFrontmatter(stored)) throw codedError('inventory-unsupported');
      continue;
    }
    files[item.path] = content;
  }
  return files;
}
const identityTupleFields = ['workspaceId', 'sessionId', 'workflowId', 'workflowRevision', 'taskId'];
// The captured origin context is the snapshot's only origin-correlated identity: every field it carries must be
// the identity the snapshot claims, the captured plan must agree with both, and the captured host must be the
// host the captured config was selected for (PR #353 review P1).
function originBound(snapshot) {
  const context = snapshot.originContext;
  const id = snapshot.identity;
  if (!record(context) || !validIdentity(id)) return false;
  for (const key of identityTupleFields) if (context[key] !== id[key]) return false;
  const plan = snapshot.taskSemantics;
  if (!record(plan) || !record(plan.workflow) || !record(plan.task)) return false;
  if (plan.workflow.workflowId !== id.workflowId || plan.workflow.workflowRevision !== id.workflowRevision
    || plan.workflow.sessionId !== id.sessionId || plan.task.taskId !== id.taskId) return false;
  if (plan.prdRoot !== id.prdRoot || plan.configDigest !== id.configDigest) return false;
  const captured = context.activeHost === undefined || context.activeHost === null ? null : context.activeHost;
  const selected = snapshot.config && snapshot.config.capture ? snapshot.config.capture.activeHost : null;
  const chosen = selected === undefined || selected === null ? null : selected;
  if (captured === null && chosen === null) return true;
  return stable(captured) === stable(chosen);
}
// The captured config bytes must be the bytes the captured inventory holds for the same path; otherwise the
// config digest binds a parsed value that the whole-project capture contradicts (the producer's own rule).
function configBytesBound(snapshot) {
  const sources = snapshot.config && snapshot.config.capture ? snapshot.config.capture.sources : null;
  if (!Array.isArray(sources)) return false;
  const records = Array.isArray(snapshot.candidate.records) ? snapshot.candidate.records : [];
  for (const source of sources) {
    const file = records.find(item => item && item.path === source.path && item.presence === 'present');
    if (source.presence === 'present' ? !file || !bytes(source.bytes).equals(bytes(file.storedBytes)) : Boolean(file)) return false;
  }
  return true;
}
function snapshotDigest(kind, baseline, coverage, records) {
  const fields = ['doc-snapshot-v1', kind, baseline.commit, baseline.treeRef, structuredDigest('doc-coverage-v1', coverage), String(records.length)];
  for (const item of [...records].sort(pathCompare)) fields.push(item.path, item.presence, item.type, item.mode, bytes(item.storedBytes));
  return hashFrames(fields);
}
function configDigest(config) {
  const sources = [...config.capture.sources].sort(pathCompare);
  const fields = ['doc-config-v1', stable({ activeHost: config.capture.activeHost, selectionInputs: config.capture.selectionInputs, resolution: config.resolution }), String(sources.length)];
  for (const source of sources) fields.push(source.path, source.presence, bytes(source.bytes));
  return hashFrames(fields);
}
function validateSnapshot(snapshot) {
  const errors = [];
  try {
    if (!validIdentity(snapshot.identity) || !record(snapshot.facts) || !Array.isArray(snapshot.obligations)) throw new Error('invalid-input');
    // Roots are canonicalized at capture; keep reconciliation detached and free of filesystem reads.
    const context = snapshot.originContext;
    if (!record(context) || !record(context.baseline) || !text(context.workspaceRoot)
      || context.baseline.commit !== snapshot.baseline.commit || context.baseline.root !== context.workspaceRoot) {
      errors.push(diagnostic('baseline-unavailable'));
    }
    // The captured origin identity, the captured plan and the selected host must be the identity the snapshot
    // claims; otherwise the provider half and the event half of the trust contract stay disconnected.
    if (!originBound(snapshot)) errors.push(diagnostic('identity-mismatch'));
    if (snapshotDigest('baseline', snapshot.baseline, snapshot.candidate.coverage, snapshot.baseline.records) !== snapshot.identity.baselineDigest
      || snapshotDigest('candidate', snapshot.baseline, snapshot.candidate.coverage, snapshot.candidate.records) !== snapshot.identity.candidateDigest
      || snapshot.baseline.digest !== snapshot.identity.baselineDigest || snapshot.candidate.digest !== snapshot.identity.candidateDigest) errors.push(diagnostic('identity-mismatch'));
    if (configDigest(snapshot.config) !== snapshot.identity.configDigest || snapshot.config.digest !== snapshot.identity.configDigest) errors.push(diagnostic('config-capture-mismatch'));
    if (!configBytesBound(snapshot)) errors.push(diagnostic('config-capture-mismatch'));
    if (structuredDigest('doc-task-scope-v1', snapshot.taskSemantics) !== snapshot.identity.taskScopeDigest) errors.push(diagnostic('identity-mismatch'));
    const config = snapshot.config.resolution.config;
    const derived = deriveDocFacts({ base: { files: deriveFiles(snapshot.baseline.records, config, { strict: true }) },
      candidate: { files: deriveFiles(snapshot.candidate.records, config, { strict: true }) }, config });
    if (stable(derived.facts) !== stable(snapshot.facts)
      || stable(deriveDocObligations(derived.facts)) !== stable(snapshot.obligations)) errors.push(diagnostic('identity-mismatch'));
    for (const obligation of snapshot.obligations) {
      const reason = snapshot.derivationReasons && snapshot.derivationReasons[obligation.id];
      if (obligation.strength === 'MUST' && obligation.applicability === 'N/A'
        && (!reason || reason.applicability !== 'N/A' || !text(reason.reason) || !Array.isArray(reason.factRefs) || !reason.factRefs.length)) {
        errors.push(diagnostic('na-reason-missing', { obligationId: obligation.id }));
      }
    }
  } catch (error) {
    const code = error && ['invalid-input', 'inventory-incomplete', 'inventory-unsupported'].includes(error.message)
      ? error.message : 'invalid-input';
    errors.push(diagnostic(code));
  }
  return errors;
}

function reconcileDocResults(input = {}) {
  const { snapshot, accepted, checkerOutput, mode = 'verification' } = record(input) ? input : {};
  const diagnostics = [];
  const unsatisfied = [];
  const results = Array.isArray(checkerOutput && checkerOutput.results) ? checkerOutput.results : [];
  const base = { decision: 'unresolved', eligible: false, expectedMustIds: [], checkedMustIds: [], results, unsatisfied, diagnostics };
  if (!record(snapshot) || !record(accepted) || !record(checkerOutput) || !Array.isArray(checkerOutput.results)
    || !results.every(record) || !Array.isArray(checkerOutput.diagnostics) || !checkerOutput.diagnostics.every(record)
    || !['verification', 'review'].includes(mode)
    || !['ready', 'unresolved', 'unavailable'].includes(accepted.state)
    || !Array.isArray(accepted.diagnostics) || !accepted.diagnostics.every(record)
    || !Array.isArray(accepted.rejected) || !accepted.rejected.every(record) || !record(accepted.acceptedIndex)) {
    diagnostics.push(diagnostic('invalid-input'));
    return base;
  }
  diagnostics.push(...validateSnapshot(snapshot));
  if (!Array.isArray(snapshot.obligations) || !snapshot.obligations.every(o => record(o) && record(o.scope) && Array.isArray(o.scope.paths))) return base;
  const expected = snapshot.obligations.filter(o => o.strength === 'MUST' && o.applicability !== 'N/A');
  base.expectedMustIds = expected.map(o => o.id).sort(compare);
  const selected = mode === 'review' ? expected.filter(o => o.capability === 'quality-review') : expected;
  base.checkedMustIds = selected.map(o => o.id).sort(compare);
  const fail = (code, obligationId, state = 'pending') => {
    diagnostics.push(diagnostic(code, obligationId ? { obligationId } : {}));
    if (obligationId) unsatisfied.push({ obligationId, state, reasonCode: code });
  };
  if (diagnostics.length) return base;
  const capturedArtifacts = Object.fromEntries(snapshot.candidate.records.filter(r => r.presence === 'present').map(r => [r.path, { digest: r.digest }]));
  const capturedBaseline = { digest: snapshot.identity.baselineDigest,
    artifacts: Object.fromEntries(snapshot.baseline.records.filter(r => r.presence === 'present').map(r => [r.path, { digest: r.digest }])) };
  if (stable(accepted.checkerInputs?.artifacts) !== stable(capturedArtifacts)
    || stable(accepted.checkerInputs?.baseline) !== stable(capturedBaseline)
    || stable(accepted.checkerInputs?.obligations) !== stable(snapshot.obligations)) fail('artifact-mismatch');
  if (!sameIdentity(snapshot.identity, accepted.identity) || stable(snapshot.originContext) !== stable(accepted.originContext)) fail('identity-mismatch');
  if (snapshot.identity.configDigest !== accepted.identity?.configDigest) fail('config-capture-mismatch');
  for (const item of [...(accepted.diagnostics || []), ...(accepted.rejected || [])]) {
    diagnostics.push(item);
    // Only rejected evidence for a checked expected MUST, or a global origin/identity fault, gates credit;
    // a rejected SHOULD or N/A event stays a visible diagnostic (PR #353 review P2).
    if (!item.obligationId || selected.some(o => o.id === item.obligationId)) {
      unsatisfied.push({ obligationId: item.obligationId || 'origin', state: item.code === 'origin-unavailable' ? 'unavailable' : 'pending', reasonCode: item.code });
    }
  }
  if (accepted.state === 'unavailable') fail('origin-unavailable');
  if (checkerOutput?.unavailable) fail('checker-unavailable');
  const known = new Set(snapshot.obligations.map(o => o.id));
  for (const result of results) if (!known.has(result.obligationId)) fail('result-misattributed', result.obligationId);
  for (const obligation of selected) {
    const id = obligation.id;
    if (obligation.applicability === 'unknown') { fail('unknown-applicability', id, 'unknown'); continue; }
    const matches = results.filter(r => r.obligationId === id);
    if (matches.length !== 1) { fail(matches.length ? 'result-duplicate' : 'result-missing', id); continue; }
    const result = matches[0];
    if (result.observation !== 'observed' || result.outcome !== 'pass') {
      const hasAccepted = Object.values(accepted.acceptedIndex || {}).some(item => item.obligationId === id);
      fail(hasAccepted ? 'result-not-pass' : 'result-missing', id);
      continue;
    }
    const artifactDigest = obligation.scope.paths.length
      ? obligation.scope.paths.map(p => `${p}=${capturedArtifacts[p]?.digest || 'missing'}`).join('|')
      : snapshot.identity.baselineDigest;
    if (result.baseDigest !== snapshot.identity.baselineDigest || result.artifactDigest !== artifactDigest) fail('result-misattributed', id);
    if (!Array.isArray(result.recordRefs) || !result.recordRefs.length) { fail('result-untrusted', id); continue; }
    for (const ref of result.recordRefs) {
      const item = accepted.acceptedIndex?.[ref];
      if (!item || item.obligationId !== id || !sameIdentity(item.identity, snapshot.identity)
        || !text(item.originRef) || stable(item.paths) !== stable(obligation.scope.paths)
        || item.artifactBinding !== snapshot.identity.candidateDigest) fail('result-untrusted', id);
    }
  }
  // Validation failures must never be hidden by a cached report or a passing result subset.
  // Global faults and diagnostics for a checked expected MUST block; SHOULD/N/A diagnostics stay visible only.
  const blocking = diagnostics.filter(item => !item.obligationId || selected.some(o => o.id === item.obligationId));
  // Checker diagnostics stay visible; eligibility is decided from the expected MUST set above.
  // In particular, later verifier diagnostics cannot stall an independent review.
  if (Array.isArray(checkerOutput.diagnostics)) diagnostics.push(...checkerOutput.diagnostics);
  if (blocking.length || unsatisfied.length) {
    if (blocking.some(d => ['origin-unavailable', 'checker-unavailable'].includes(d.code))) base.decision = 'unavailable';
    return base;
  }
  if (!selected.length) { base.decision = 'legacy'; diagnostics.push(diagnostic('no-document-musts')); return base; }
  base.decision = 'eligible';
  base.eligible = true;
  return base;
}

function checkAcceptedDocEvidence(input = {}) {
  const { snapshot, accepted, mode = 'verification' } = record(input) ? input : {};
  let checkerOutput;
  try {
    if (!accepted?.checkerInputs || !snapshot) throw new Error('invalid-input');
    checkerOutput = checkDocObligations({ ...accepted.checkerInputs, obligations: snapshot.obligations });
  } catch { checkerOutput = { results: [], diagnostics: [], unavailable: true }; }
  return reconcileDocResults({ snapshot, accepted, checkerOutput, mode });
}

module.exports = { checkAcceptedDocEvidence, reconcileDocResults,
  _internals: { runtimeModule, text, record, bytes, stable, clone, sha, structuredDigest, snapshotDigest, configDigest, sameIdentity, diagnostic, validateSnapshot, compare, deriveFiles, semanticRelevance, originBound, configBytesBound } };

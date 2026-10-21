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
    if (snapshotDigest('baseline', snapshot.baseline, snapshot.candidate.coverage, snapshot.baseline.records) !== snapshot.identity.baselineDigest
      || snapshotDigest('candidate', snapshot.baseline, snapshot.candidate.coverage, snapshot.candidate.records) !== snapshot.identity.candidateDigest
      || snapshot.baseline.digest !== snapshot.identity.baselineDigest || snapshot.candidate.digest !== snapshot.identity.candidateDigest) errors.push(diagnostic('identity-mismatch'));
    if (configDigest(snapshot.config) !== snapshot.identity.configDigest || snapshot.config.digest !== snapshot.identity.configDigest) errors.push(diagnostic('config-capture-mismatch'));
    if (structuredDigest('doc-task-scope-v1', snapshot.taskSemantics) !== snapshot.identity.taskScopeDigest) errors.push(diagnostic('identity-mismatch'));
    const filesOf = records => Object.fromEntries(records.filter(item => item.presence === 'present').map(item => {
      const stored = bytes(item.storedBytes);
      if (item.digest !== sha(stored) || item.type !== 'file' || !['100644', '100755'].includes(item.mode)) throw new Error('invalid-input');
      return [item.path, new TextDecoder('utf-8', { fatal: true }).decode(stored)];
    }));
    const derived = deriveDocFacts({ base: { files: filesOf(snapshot.baseline.records) },
      candidate: { files: filesOf(snapshot.candidate.records) }, config: snapshot.config.resolution.config });
    if (stable(derived.facts) !== stable(snapshot.facts)
      || stable(deriveDocObligations(derived.facts)) !== stable(snapshot.obligations)) errors.push(diagnostic('identity-mismatch'));
    for (const obligation of snapshot.obligations) {
      const reason = snapshot.derivationReasons && snapshot.derivationReasons[obligation.id];
      if (obligation.strength === 'MUST' && obligation.applicability === 'N/A'
        && (!reason || reason.applicability !== 'N/A' || !text(reason.reason) || !Array.isArray(reason.factRefs) || !reason.factRefs.length)) {
        errors.push(diagnostic('na-reason-missing', { obligationId: obligation.id }));
      }
    }
  } catch { errors.push(diagnostic('invalid-input')); }
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
  _internals: { runtimeModule, text, record, bytes, stable, clone, sha, structuredDigest, snapshotDigest, configDigest, sameIdentity, diagnostic, validateSnapshot, compare } };

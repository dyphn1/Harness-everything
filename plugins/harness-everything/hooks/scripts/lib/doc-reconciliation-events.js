'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _internals: U } = require('./doc-reconciliation-core');

// Directory identity as in the producer: native realpath (Windows 8.3 names), case-insensitive on Windows.
function samePath(a, b) {
  try {
    const left = fs.realpathSync.native(path.resolve(a));
    const right = fs.realpathSync.native(path.resolve(b));
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  } catch { return false; }
}

function artifactsFor(records) {
  return Object.fromEntries(records.filter(item => item.presence === 'present').map(item => [item.path, { digest: item.digest }]));
}
function prdDigest(artifacts) {
  return U.sha(JSON.stringify(Object.keys(artifacts).filter(p => p.startsWith('docs/prd/')).sort().map(p => [p, artifacts[p].digest])));
}

function git(root, args, binary = false) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return execFileSync('git', ['-C', root, ...args], { env, encoding: binary ? null : 'utf8',
    timeout: 10000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function shaBytes(value) { return U.sha(Buffer.from(value)); }

function outlineEventValid({ event, snapshot, paths, artifacts, baselineArtifacts } = {}) {
  let stage = 'envelope';
  try {
    const evidence = event?.outlineEvidence;
    const root = snapshot.originContext.workspaceRoot;
    const baseline = snapshot.originContext.baseline;
    if (snapshot.originContext.activeHost !== 'claude-code' || !U.record(evidence)
      || evidence.schema !== 'harness.outline-confirmation.v1' || evidence.state !== 'validated'
      || evidence.baselineCommit !== baseline?.commit || evidence.taskId !== snapshot.identity.taskId
      || !/^[0-9a-f]{40,64}$/.test(String(evidence.outlineCommit || ''))
      || !/^[0-9a-f]{40,64}$/.test(String(evidence.draftCommit || ''))
      || !/^[0-9a-f]{40,64}$/.test(String(evidence.mergedCommit || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.handoffDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.reviewCaptureDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.reviewDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.seamDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.dispatchInputDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.writerLeaseDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.inventoryPinDigest || ''))
      || !/^[0-9a-f]{64}$/.test(String(evidence.inventoryArtifactDigest || ''))
      || !Array.isArray(evidence.targetPaths) || U.stable(evidence.targetPaths) !== U.stable(paths)
      || !U.record(evidence.outlineArtifactDigests) || !U.record(evidence.draftArtifactDigests)
      || !U.record(evidence.outlineBlobOids) || !U.record(evidence.draftBlobOids)
      || U.stable(Object.keys(evidence.outlineArtifactDigests).sort()) !== U.stable(paths)
      || U.stable(Object.keys(evidence.draftArtifactDigests).sort()) !== U.stable(paths)
      || U.stable(Object.keys(evidence.outlineBlobOids).sort()) !== U.stable(paths)
      || U.stable(Object.keys(evidence.draftBlobOids).sort()) !== U.stable(paths)
      || !U.record(event.draftArtifactDigests) || U.stable(Object.keys(event.draftArtifactDigests).sort()) !== U.stable(paths)
      || U.stable(event.draftArtifactDigests) !== U.stable(evidence.draftArtifactDigests)
      || !U.record(event.reviewedArtifactDigests)
      || !paths.every(p => /^[0-9a-f]{64}$/.test(String(evidence.outlineArtifactDigests[p] || ''))
        && /^[0-9a-f]{64}$/.test(String(evidence.draftArtifactDigests[p] || ''))
        && /^[0-9a-f]{40,64}$/.test(String(evidence.outlineBlobOids[p] || ''))
        && /^[0-9a-f]{40,64}$/.test(String(evidence.draftBlobOids[p] || ''))
        && artifacts[p]?.digest === evidence.draftArtifactDigests[p])
      || !/^[0-9a-f]{40,64}$/.test(String(evidence.baselineCommit || ''))
      || !/^[0-9a-f]{40,64}$/.test(String(evidence.outlineTree || ''))
      || !/^[0-9a-f]{40,64}$/.test(String(evidence.draftTree || ''))
      || !U.text(evidence.coordinatorPrincipal) || !U.text(evidence.reviewerPrincipal) || !U.text(evidence.workerPrincipal)
      || evidence.reviewerPrincipal === evidence.coordinatorPrincipal || evidence.reviewerPrincipal === evidence.workerPrincipal
      || evidence.ancestry !== 'strict-descendant' || evidence.outlineCommit === evidence.draftCommit) return stage;

    stage = 'reviewed-object-binding';
    const pinPath = Object.keys(event.reviewedArtifactDigests).filter(p => p.startsWith('doc-reconciliation/outline-confirmation/inventory/'));
    if (pinPath.length !== 1 || event.reviewedArtifactDigests[pinPath[0]] !== evidence.inventoryArtifactDigest
      || Object.keys(event.reviewedArtifactDigests).length !== paths.length + 1
      || !paths.every(p => event.reviewedArtifactDigests[p] === evidence.outlineArtifactDigests[p])) return stage;

    stage = 'current-commit-binding';
    const head = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    const tree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']).trim();
    if (head !== evidence.mergedCommit || tree !== evidence.draftTree) return stage;
    const verified = commit => git(root, ['rev-parse', '--verify', `${commit}^{commit}`]).trim() === commit;
    if (![evidence.baselineCommit, evidence.outlineCommit, evidence.draftCommit, evidence.mergedCommit].every(verified)) return 'git-object-missing';
    if (evidence.baselineCommit === evidence.outlineCommit) return 'B-to-O-ancestry';
    stage = 'B-to-O-ancestry';
    try { git(root, ['merge-base', '--is-ancestor', evidence.baselineCommit, evidence.outlineCommit]); }
    catch { return stage; }
    stage = 'O-to-D-ancestry';
    try { git(root, ['merge-base', '--is-ancestor', evidence.outlineCommit, evidence.draftCommit]); }
    catch { return stage; }
    stage = 'merge-correspondence';
    if (evidence.mergeCorrespondence === null) {
      if (evidence.draftCommit !== evidence.mergedCommit) return stage;
    } else {
      const merge = evidence.mergeCorrespondence;
      if (!U.record(merge) || !['accepted', 'changed'].includes(merge.state)
        || merge.draftCommit !== evidence.draftCommit || merge.mergedCommit !== evidence.mergedCommit
        || U.stable(merge.targetPaths) !== U.stable(paths) || !U.record(merge.targetBlobs)) return stage;
      for (const p of paths) {
        const draftOid = git(root, ['rev-parse', `${evidence.draftCommit}:${p}`]).trim();
        const mergedOid = git(root, ['rev-parse', `${evidence.mergedCommit}:${p}`]).trim();
        if (merge.targetBlobs[p]?.draft !== draftOid || merge.targetBlobs[p]?.merged !== mergedOid
          || (merge.state === 'accepted' && draftOid !== mergedOid)
          || (merge.state === 'changed' && draftOid === mergedOid)) return stage;
      }
    }
    stage = 'target-object-binding';
    for (const p of paths) {
      const atBase = git(root, ['ls-tree', '-r', '--name-only', evidence.baselineCommit, '--', p]).trim().split('\n').filter(Boolean);
      if (atBase.includes(p)) return 'target-existed-at-B';
      if (git(root, ['rev-parse', `${evidence.outlineCommit}:${p}`]).trim() !== evidence.outlineBlobOids[p]
        || git(root, ['rev-parse', `${evidence.mergedCommit}:${p}`]).trim() !== evidence.draftBlobOids[p]) return stage;
      const outlineBytes = git(root, ['show', `${evidence.outlineCommit}:${p}`], true);
      const draftBytes = git(root, ['show', `${evidence.mergedCommit}:${p}`], true);
      if (shaBytes(outlineBytes) !== evidence.outlineArtifactDigests[p]
        || shaBytes(draftBytes) !== evidence.draftArtifactDigests[p]
        || shaBytes(draftBytes) !== artifacts[p]?.digest) return 'candidate-artifact-binding';
    }
    return true;
  } catch { return 'git-verification-failed'; }
}

function acceptDocEvents(input = {}, dependencies = {}) {
  const { snapshot, eventRefs } = U.record(input) ? input : {};
  const originProvider = dependencies?.originProvider;
  const diagnostics = [];
  const rejected = [];
  const acceptedIndex = Object.create(null);
  const empty = { state: 'unavailable', checkerInputs: null, acceptedIndex, rejected, diagnostics };
  try {
    if (!snapshot || !Array.isArray(eventRefs) || !eventRefs.every(U.text)) {
      diagnostics.push(U.diagnostic('invalid-input'));
      return empty;
    }
    diagnostics.push(...U.validateSnapshot(snapshot));
    if (diagnostics.length) return { ...empty, state: 'unresolved' };
    const artifacts = artifactsFor(snapshot.candidate.records);
    const baselineArtifacts = artifactsFor(snapshot.baseline.records);
    const checkerInputs = { obligations: U.clone(snapshot.obligations), artifacts,
      baseline: { digest: snapshot.identity.baselineDigest, artifacts: baselineArtifacts }, executionRecords: [], reviewRecords: [] };
    const out = { state: 'ready', identity: U.clone(snapshot.identity), originContext: U.clone(snapshot.originContext), checkerInputs, acceptedIndex, rejected, diagnostics };
    if (!originProvider || typeof originProvider.resolveEvent !== 'function' || typeof originProvider.resolveContext !== 'function') {
      diagnostics.push(U.diagnostic('origin-unavailable'));
      out.state = 'unavailable';
      return out;
    }
    const contextResponse = originProvider.resolveContext({ workspaceRoot: snapshot.originContext.workspaceRoot, workflowId: snapshot.identity.workflowId, sessionId: snapshot.identity.sessionId });
    if (contextResponse?.status !== 'accepted' || !U.text(contextResponse.originRef)) {
      diagnostics.push(U.diagnostic(contextResponse?.status === 'rejected' ? 'origin-untrusted' : 'origin-unavailable'));
      out.state = 'unavailable';
      return out;
    }
    if (contextResponse.originRef !== snapshot.originContext.originRef) diagnostics.push(U.diagnostic('identity-mismatch'));
    const context = contextResponse.context;
    for (const key of ['workspaceId', 'sessionId', 'workflowId', 'workflowRevision', 'taskId', 'principals', 'activeHost', 'baselineReference']) {
      if (U.stable(context?.[key]) !== U.stable(snapshot.originContext[key])) diagnostics.push(U.diagnostic('identity-mismatch'));
    }
    // The concrete workflow-start pin and worktree bound at capture must still be what the provider issues;
    // a different pin under the same baselineReference is not the captured baseline (PR #353 review P1).
    const pin = snapshot.originContext.baseline;
    if (!U.record(context?.baseline) || !U.record(pin) || context.baseline.commit !== pin.commit
      || !U.text(context.baseline.root) || !samePath(context.baseline.root, pin.root)) diagnostics.push(U.diagnostic('baseline-unavailable'));
    if (context?.workspaceRoot !== undefined && !(U.text(context.workspaceRoot) && samePath(context.workspaceRoot, snapshot.originContext.workspaceRoot))) {
      diagnostics.push(U.diagnostic('identity-mismatch'));
    }
    const seenIds = new Set();
    const seenCapabilities = new Set();
    for (const reference of eventRefs) {
      let response;
      try { response = originProvider.resolveEvent({ reference, identity: U.clone(snapshot.identity) }); }
      catch { response = { status: 'unavailable' }; }
      if (response?.status !== 'accepted') {
        const supplied = Array.isArray(response?.diagnostics) ? response.diagnostics : [];
        rejected.push(...(supplied.length ? U.clone(supplied) : [U.diagnostic(response?.status === 'rejected' ? 'origin-untrusted' : 'origin-unavailable', { reference })]));
        continue;
      }
      const event = U.clone(response.event);
      const obligation = snapshot.obligations.find(o => o.capability === event?.capability);
      const obligationId = obligation?.id;
      const problems = [];
      const reject = code => problems.push(U.diagnostic(code, { reference, ...(obligationId ? { obligationId } : {}) }));
      if (!U.record(event) || !['eventId', 'producerId', 'originRef', 'principalId', 'provenance', 'capability'].every(k => U.text(event[k]))
        || !U.text(response.originRef) || event.originRef !== response.originRef || !['execution', 'verification', 'review'].includes(event.kind)) reject('event-invalid');
      if (!U.sameIdentity(event?.identity, snapshot.identity)) {
        reject('identity-mismatch');
        if (event?.identity?.configDigest !== snapshot.identity.configDigest) reject('config-capture-mismatch');
      }
      if (!obligation) reject('capability-mismatch');
      if (seenIds.has(event?.eventId)) reject('event-duplicate');
      if (seenCapabilities.has(event?.capability)) reject('event-conflict');
      seenIds.add(event?.eventId);
      seenCapabilities.add(event?.capability);
      const paths = obligation?.scope?.paths || [];
      if (!Array.isArray(event?.paths) || U.stable([...event.paths].sort()) !== U.stable([...paths].sort())) reject('scope-mismatch');
      const outlineCapability = event?.capability === 'outline-confirmation';
      const digests = event?.kind === 'review' ? event.reviewedArtifactDigests : event?.artifactDigests;
      if (outlineCapability) {
        const outlineValidation = outlineEventValid({ event, snapshot, paths, artifacts, baselineArtifacts });
        if (outlineValidation !== true) reject(`outline-${outlineValidation || 'evidence-invalid'}`);
      } else if (!U.record(digests)) reject('artifact-mismatch');
      else {
        for (const p of paths) {
          if (artifacts[p] && digests[p] !== artifacts[p].digest) reject('artifact-mismatch');
          if (!artifacts[p] && (!baselineArtifacts[p] || event.baselineArtifacts?.[p] !== baselineArtifacts[p].digest || Object.hasOwn(digests, p))) reject('artifact-mismatch');
        }
        // Supplied extra digests must also describe this capture, never another tree.
        for (const p of Object.keys(digests)) if (!artifacts[p] || digests[p] !== artifacts[p].digest) reject('artifact-mismatch');
      }
      if (event?.capability === 'conflict-check') {
        const binding = event.corpusBinding;
        const identity = snapshot.identity;
        const expectedPaths = U.runtimeModule('doc-lifecycle.js').documentCorpusPaths(
          snapshot.candidate.records, snapshot.config.resolution.config
        );
        if (!U.record(binding) || binding.complete !== true || !Array.isArray(binding.paths)
          || U.stable(binding.paths) !== U.stable(expectedPaths) || !U.record(binding.digests)
          || U.stable(Object.keys(binding.digests).sort()) !== U.stable(expectedPaths)
          || !expectedPaths.every(p => artifacts[p] && binding.digests[p] === artifacts[p].digest)) reject('corpus-mismatch');
        if (binding?.baselineDigest !== identity.baselineDigest || binding?.candidateDigest !== identity.candidateDigest
          || binding?.configIdentityDigest !== identity.configDigest
          || binding?.baseCommit !== snapshot.originContext.baseline.commit) reject('snapshot-changed');
        const configSource = snapshot.config.capture.sources.find(source => source.path === binding?.config?.path);
        if (!configSource || configSource.presence !== 'present'
          || U.sha(U.bytes(configSource.bytes)) !== binding?.config?.digest) reject('config-capture-mismatch');
      }
      if (event?.kind === 'review') {
        if (event.verdict !== 'approve' || !U.text(event.summary)) reject('event-invalid');
        const principals = context?.principals;
        const independent = principals && [principals.author, ...(principals.executors || [])];
        if (!independent || independent.includes(event.principalId) || !Array.isArray(event.independentOf)
          || !independent.every(p => event.independentOf.includes(p))) reject('review-not-independent');
      } else {
        if (!U.text(event?.command) || !Array.isArray(event?.argv) || !event.argv.length || !event.argv.every(U.text)
          || !U.text(event.cwd) || !Number.isInteger(event.exitCode) || event.exitCode !== 0 || event.signal !== null
          || !U.text(event.toolCorrelationId) || response.correlation?.toolCorrelationId !== event.toolCorrelationId
          || !U.text(event.resultRef)) reject('event-invalid');
        if (!U.sameIdentity(event?.startIdentity, snapshot.identity) || !U.sameIdentity(event?.endIdentity, snapshot.identity)) reject('snapshot-changed');
        // Provider acceptance covers command semantics; the adapter additionally rejects command/argv substitution.
        if (Array.isArray(event?.argv) && event.command !== event.argv.join(' ')) reject('capability-mismatch');
        if (!context?.principals?.executors?.includes(event?.principalId)) reject('origin-untrusted');
      }
      if (problems.length) { rejected.push(...problems); continue; }
      const adapted = { id: reference, obligationId,
        kind: outlineCapability ? 'outline-confirmation' : event.kind === 'review' ? 'review' : 'execution',
        paths: [...paths], provenance: event.provenance, baseDigest: snapshot.identity.baselineDigest,
        artifactDigests: U.clone(outlineCapability ? event.draftArtifactDigests : digests),
        ...(event.baselineArtifacts ? { baselineArtifacts: U.clone(event.baselineArtifacts) } : {}) };
      if (outlineCapability) Object.assign(adapted, { outlineEvidence: U.clone(event.outlineEvidence) });
      else if (event.kind === 'review') Object.assign(adapted, { verdict: event.verdict, summary: event.summary });
      else Object.assign(adapted, { command: event.command, exitCode: event.exitCode });
      if (event.capability === 'conflict-check') {
        adapted.candidatePrdSet = { digest: prdDigest(artifacts), complete: true, paths: Object.keys(artifacts).filter(p => p.startsWith('docs/prd/')).sort() };
      }
      (event.kind === 'review' ? checkerInputs.reviewRecords : checkerInputs.executionRecords).push(adapted);
      acceptedIndex[reference] = { reference, eventId: event.eventId, obligationId, capability: event.capability,
        paths: [...paths], identity: U.clone(event.identity), originRef: response.originRef, artifactBinding: snapshot.identity.candidateDigest,
        artifactDigests: U.clone(outlineCapability ? event.draftArtifactDigests : digests),
        ...(outlineCapability ? { reviewedArtifactDigests: U.clone(event.reviewedArtifactDigests) } : {}), event };
    }
    if (diagnostics.length || rejected.length) out.state = 'unresolved';
    return out;
  } catch {
    diagnostics.push(U.diagnostic('invalid-input'));
    return empty;
  }
}
module.exports = { acceptDocEvents };

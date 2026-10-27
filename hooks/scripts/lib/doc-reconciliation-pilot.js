'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { atomicWriteJson } = require('./fable-contracts');
const { canonical, key } = require('./workflow-isolation');

const enabled = () => process.env.HARNESS_DOC_RECONCILIATION_PILOT === '1';
const text = value => typeof value === 'string' && value.trim().length > 0;

function git(root, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try {
    return execFileSync('git', ['-C', root, ...args], {
      env, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw new Error('baseline-unavailable', { cause });
  }
}

function runtimeModule(name) {
  for (const relative of ['../../../harness-everything/scripts', '../../../skills/harness-everything/scripts']) {
    const file = path.resolve(__dirname, relative, name + '.js');
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error('document runtime unavailable');
}

// Only capture at plan/start. A later credit assessment must never advance the baseline to HEAD.
function captureBaseline(context) {
  if (!enabled()) return;
  try {
    if (!context.workflow.docReconciliationBaseline) {
      const root = canonical(git(context.root, ['rev-parse', '--show-toplevel']).trim());
      const commit = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
      const tree = git(root, ['rev-parse', '--verify', `${commit}^{tree}`]).trim();
      context.workflow.docReconciliationBaseline = { root, commit, tree };
    } else if (!context.workflow.docReconciliationBaseline.tree) {
      const pin = context.workflow.docReconciliationBaseline;
      pin.tree = git(pin.root, ['rev-parse', '--verify', `${pin.commit}^{tree}`]).trim();
    }
    if (!context.workflow.docReconciliationTask) {
      const plan = context.workflow.pendingPlan || context.workflow.workflowPlan;
      const loaded = plan && runtimeModule('workflow-obligations').loadObligationSet(context, plan);
      const requirementIds = loaded?.set?.requirements?.map(item => item.id);
      if (Array.isArray(requirementIds) && requirementIds.length && requirementIds.every(id => typeof id === 'string' && id)) {
        const baseline = context.workflow.docReconciliationBaseline;
        const resolver = runtimeModule('project-docs-resolver');
        const configSources = configSourcePaths(resolver).map(relative => {
          const bytes = bytesAtBaseline(baseline.root, baseline.commit, relative);
          return [relative, bytes === null ? null : crypto.createHash('sha256').update(bytes).digest('hex')];
        });
        const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
        const workspaceId = 'ws-' + hash({ workspaceRoot: canonical(baseline.root) });
        context.workflow.docReconciliationTask = {
          schema: 'harness.doc-reconciliation-task-pin.v1',
          taskId: `task-${requirementIds.join('+')}`, requirementIds,
          requirementDigest: hash(requirementIds), sessionId: context.sessionId,
          workflowId: context.workflow.workflowId, workspaceId,
          baselineCommit: baseline.commit, baselineRoot: baseline.root,
          configDigest: hash(configSources),
        };
      }
    }
  } catch {
    // Absence is intentionally retained; credit assessment will fail closed.
  }
}

// PR #351 review P1 (config authority): derivation runs on the current config, so a candidate
// config edit could de-scope a baseline-governed path. Every resolver-selectable config source —
// `.agents/harness-everything/project-docs.json` and each host `<home>/harness-everything/manifest.json`
// for the resolver's PLATFORM_HOMES — is byte-compared at the recorded baseline commit and in the
// working tree. An edit, an addition or a removal all fail closed before derivation; absence of a
// source on either side is allowed and only a difference is fatal.
const PROJECT_DOCS_CONFIG_RELPATH = '.agents/harness-everything/project-docs.json';

function configSourcePaths(resolver) {
  return [
    PROJECT_DOCS_CONFIG_RELPATH,
    ...(resolver.PLATFORM_HOMES || []).map(home => `${home}/harness-everything/manifest.json`),
  ];
}

function bytesAtBaseline(root, commit, relative) {
  const listed = git(root, ['ls-tree', '-r', '--name-only', '-z', commit, '--', relative]);
  if (!listed.split('\0').includes(relative)) return null; // absent at the baseline is allowed
  return git(root, ['show', `${commit}:${relative}`]); // other Git failures stay baseline-unavailable
}

function bytesInTree(root, relative) {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null; // absent in the working tree is allowed
    throw error;
  }
}

function assertConfigScopeUnchanged(root, baseline, resolver) {
  for (const relative of configSourcePaths(resolver)) {
    if (bytesAtBaseline(root, baseline.commit, relative) !== bytesInTree(root, relative)) {
      throw new Error('config-scope-changed');
    }
  }
}

function collect(context) {
  const baseline = context.workflow.docReconciliationBaseline;
  if (!baseline) throw new Error('baseline-unavailable');
  const root = canonical(git(context.root, ['rev-parse', '--show-toplevel']).trim());
  if (!text(baseline.root) || key(root) !== key(baseline.root)
    || !/^[0-9a-f]{40,64}$/.test(baseline.commit)) throw new Error('baseline-unavailable');
  const resolver = runtimeModule('project-docs-resolver');
  const resolved = resolver.resolveDocsConfig(root);
  if (!['project', 'host'].includes(resolved.status)) throw new Error('config-unavailable');
  assertConfigScopeUnchanged(root, baseline, resolver);
  const { readGitBaseInventory, scanWorkspaceFiles } = runtimeModule('doc-lifecycle');
  // Broaden artifact discovery only, never the config passed to obligation derivation. Code/REQ-test
  // facts require baseline bytes outside governed document globs as well.
  const base = readGitBaseInventory(root, baseline.commit, { governed: [{ path: '**/*', role: 'reference' }] });
  const basePaths = git(root, ['ls-tree', '-r', '--name-only', '-z', baseline.commit]).split('\0').filter(Boolean);
  if (!base.available) throw new Error('baseline-unavailable');
  if (base.files.length !== basePaths.length) throw new Error('scope-unavailable');
  const paths = [...new Set(git(root, ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  const existing = paths.filter(relative => {
    try {
      if (!fs.lstatSync(path.join(root, relative)).isFile()) throw new Error('scope-unavailable');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false; // tracked deletion
      throw error;
    }
  });
  const candidate = scanWorkspaceFiles(root, { paths: existing });
  if (candidate.length !== existing.length) throw new Error('scope-unavailable');
  const snapshots = files => ({ files: Object.fromEntries(files.map(item => [item.path, item.bytes.toString('utf8')])) });
  const { deriveDocFacts, deriveDocObligations } = runtimeModule('doc-obligations');
  const { facts } = deriveDocFacts({ base: snapshots(base.files), candidate: snapshots(candidate), config: resolved.config, inventory: { complete: true } });
  return deriveDocObligations(facts).filter(item => item.strength === 'MUST' && item.applicability !== 'N/A');
}

// S2b credit chain (F4): produce the snapshot, accept the origin-provider events, and check them against the expected
// MUSTs. Credit only when the core marks the evidence eligible. Production has no qualification, so it stays withheld.
function creditChain(context, set, dependencies = {}) {
  const hostId = activeHostFor(context);
  const providerModule = require('./doc-reconciliation-provider');
  const captureView = hostId === 'opencode' ? providerModule.readOpencodeCaptureView(context.sessionDir)
    : hostId === 'claude-code' ? providerModule.readCaptureView(context.sessionDir)
      : { records: [], tampered: false };
  if (captureView.tampered) {
    return { eligible: false, outlineEvidence: { outcome: 'none', observation: 'unresolved', reason: 'journal-tampered' },
      diagnostics: [{ code: 'journal-tampered', message: 'the capture journal no longer matches its immutable event records' }] };
  }
  if (!['claude-code', 'opencode'].includes(hostId)) {
    return { eligible: false, outlineEvidence: { outcome: 'none', observation: 'unresolved', reason: 'unsupported-host' },
      diagnostics: [{ code: 'unsupported-host', message: `no document origin provider is registered for ${String(hostId)}` }] };
  }
  const { produceDocSnapshot } = require('./doc-reconciliation-producer');
  const { acceptDocEvents } = require('./doc-reconciliation-events');
  const { checkAcceptedDocEvidence } = require('./doc-reconciliation-core');
  const baseline = context.workflow.docReconciliationBaseline;
  const requirements = Array.isArray(set?.requirements) ? set.requirements : [];
  const requirementIds = requirements.map(item => item.id);
  const derivedTaskId = `task-${requirementIds.join('+') || 'none'}`;
  const taskBinding = context.workflow.docReconciliationTask || null;
  const taskId = taskBinding?.taskId || derivedTaskId;
  if (taskBinding && (taskBinding.taskId !== derivedTaskId || taskBinding.workflowId !== context.workflow.workflowId
    || taskBinding.sessionId !== context.sessionId || taskBinding.baselineCommit !== baseline?.commit
    || !text(taskBinding.baselineRoot) || !text(baseline?.root)
    || key(taskBinding.baselineRoot) !== key(baseline.root)
    || taskBinding.requirementDigest !== crypto.createHash('sha256').update(JSON.stringify(requirementIds)).digest('hex')) ) {
    return { eligible: false, outlineEvidence: { outcome: 'none', observation: 'unresolved', reason: 'task-binding-mismatch' },
      diagnostics: [{ code: 'task-binding-mismatch', message: 'the requirement set or original B differs from the task pin' }] };
  }
  const sessionId = context.sessionId;
  const { createClaudeOriginProvider, createOpencodeOriginProvider, journalExecutors } = providerModule;
  const captures = captureView.records;
  const principals = hostId === 'opencode'
    ? { author: sessionId, executors: [sessionId] }
    : { author: sessionId, executors: journalExecutors(captures, sessionId) };
  const createOriginProvider = hostId === 'opencode' ? createOpencodeOriginProvider : createClaudeOriginProvider;
  const providerInput = {
    hostId,
    sessionId,
    workspaceRoot: context.root,
    workflowId: context.workflow.workflowId,
    workflowRevision: context.workflow.revision,
    taskId,
    sessionDir: context.sessionDir,
    taskBinding,
    principals,
    baseline,
    captures,
  };
  const originProvider = dependencies.originProvider || createOriginProvider(providerInput);
  const produced = produceDocSnapshot({
    workspaceRoot: context.root,
    baseline,
    workflow: { workflowId: context.workflow.workflowId, sessionId, workflowRevision: context.workflow.revision },
    task: { taskId, requirements },
    scope: { prdRoot: 'docs/prd/' },
    activeHost: hostId,
    prdRoot: 'docs/prd/',
  }, { originProvider });
  if (produced.state !== 'ready' || !produced.snapshot) return {
    eligible: false,
    outlineEvidence: { outcome: 'none', observation: 'unresolved', reason: produced.diagnostics?.[0]?.code || 'snapshot-unavailable' },
    diagnostics: produced.diagnostics || [],
    unsatisfied: [],
  };
  const eventRefs = captureReferences(context);
  const accepted = acceptDocEvents({ snapshot: produced.snapshot, eventRefs }, { originProvider });
  const checked = checkAcceptedDocEvidence({ snapshot: produced.snapshot, accepted, mode: 'verification' });
  // Credit covers only the expected MUSTs that were both accepted and satisfied (passing, observed). N/A never counts.
  const passing = new Set((checked.results || []).filter(r => r.observation === 'observed' && r.outcome === 'pass').map(r => r.obligationId));
  const expected = new Set(checked.checkedMustIds || []);
  const satisfied = produced.snapshot.obligations.filter(o => o.strength === 'MUST' && o.applicability !== 'N/A' && expected.has(o.id) && passing.has(o.id));
  const outlineObligation = produced.snapshot.obligations.find(item => item.capability === 'outline-confirmation');
  const outlineResult = outlineObligation && (checked.results || []).find(item => item.obligationId === outlineObligation.id);
  const outlineRefs = Object.entries(accepted.acceptedIndex || {}).filter(([, item]) => item.capability === 'outline-confirmation').map(([ref]) => ref);
  const outlineEvidence = {
    status: outlineResult?.observation === 'observed' && outlineResult?.outcome === 'pass' ? 'pass' : 'unresolved',
    outcome: outlineResult?.outcome || 'none',
    observation: outlineResult?.observation || 'unresolved',
    recordRefs: outlineResult?.recordRefs || [],
    acceptedRefs: outlineRefs,
    diagnostics: [...(accepted.diagnostics || []), ...(accepted.rejected || []), ...(checked.diagnostics || [])]
      .filter(item => !item?.obligationId || item.obligationId === outlineObligation?.id),
  };
  return {
    eligible: checked.eligible === true,
    capabilities: checked.eligible === true ? [...new Set(satisfied.map(o => o.capability))] : [],
    satisfiedObligationIds: satisfied.map(o => o.id),
    unsatisfied: checked.unsatisfied || [],
    acceptedRefs: Object.keys(accepted.acceptedIndex || {}),
    outlineEvidence,
    diagnostics: [...(accepted.diagnostics || []), ...(checked.diagnostics || [])],
    rejected: accepted.rejected || [],
  };
}

// Report diagnostics are objects with the obligation they concern (F12); a global fault has obligationId null.
function diagnosticOf(item) {
  if (item && typeof item === 'object') return { ...item, code: item.code || 'unknown', obligationId: item.obligationId ?? null };
  return { code: String(item), obligationId: null };
}

// Review-mode refusal (F4 I2a): with the pilot ON in a supported (non-Fable) workflow, a review step PASS needs an
// independent quality-review record. The provider's own independence rules decide it: a host agent_id that differs from
// the author session, an explicit approve verdict, a non-empty summary and the bound final-artifact digest.
function reviewRequired(set) {
  return enabled() && set?.stepBindingsEnabled === true && !String(set?.strategy || '').startsWith('fable-');
}

// The review step is independent of credit qualification: the step records host-observed independence, while document
// credit itself still needs the validated qualification (assess).
function independentReviewAccepted(context) {
  if (activeHostFor(context) !== 'claude-code') return false;
  const { reviewRecordIndependent, journalExecutors } = require('./doc-reconciliation-provider');
  const view = require('./doc-reconciliation-provider').readCaptureView(context.sessionDir);
  if (view.tampered) return false;
  const captures = view.records;
  const principals = { author: context.sessionId, executors: journalExecutors(captures, context.sessionId) };
  const pin = context.workflow.docReconciliationBaseline;
  return captures.some(item => recordOf(item) && item.session_id === context.sessionId
    && recordOf(item.observedIdentity) && item.observedIdentity.workflowId === context.workflow.workflowId
    && item.observedIdentity.workflowRevision === context.workflow.revision
    && (!pin || (recordOf(item.observedIdentity.baselinePin) && item.observedIdentity.baselinePin.commit === pin.commit))
    && reviewRecordIndependent(item, captures, principals));
}

function recordOf(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function activeHostFor(context) {
  return context.activeHost === undefined || context.activeHost === null ? 'claude-code' : context.activeHost;
}

// The session capture records are the only host-event source. A missing journal means no events; a journal that no longer
// equals its immutable event files is tampered and yields no events, so the chain withholds.
function readCaptures(context) {
  const provider = require('./doc-reconciliation-provider');
  const hostId = activeHostFor(context);
  if (hostId === 'opencode') return provider.readOpencodeCaptureView(context.sessionDir).records;
  if (hostId === 'claude-code') return provider.readCaptureView(context.sessionDir).records;
  return [];
}

// Only explicit PostToolUse doc-check candidates are offered; ordinary Edit or Agent results are not (R3-01).
const docCheckCandidate = item => item.event === 'PostToolUse'
  && require('./doc-reconciliation-provider').resolveDocCheckInvocation(item.command, item.cwd).kind !== 'not-candidate';

function outlineReviewCaptureRefs(sessionDir, taskId) {
  const refs = new Set();
  if (!text(taskId)) return refs;
  const attempts = path.join(sessionDir, 'doc-reconciliation', 'outline-confirmation', taskId, 'attempts');
  try {
    for (const entry of fs.readdirSync(attempts, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const handoff = JSON.parse(fs.readFileSync(path.join(attempts, entry.name, 'handoff.json'), 'utf8'));
        if (handoff.taskId === taskId && typeof handoff.reviewCaptureRef === 'string') refs.add(handoff.reviewCaptureRef);
      } catch { /* malformed handoff cannot add review credit */ }
    }
  } catch { /* no attempts yet */ }
  return refs;
}

function outlineDispatchReferences(captures, taskId, sessionDir) {
  if (!text(taskId)) return [];
  const candidates = (Array.isArray(captures) ? captures : []).filter(item => recordOf(item)
    && item.event === 'PreToolUse' && ['Task', 'Agent'].includes(item.tool_name)
    && text(item.ref) && item.outlineDispatch?.taskId === taskId && text(item.outlineDispatch.attemptId));
  if (!candidates.length) return [];
  if (text(sessionDir)) {
    const provider = require('./doc-reconciliation-provider');
    const attemptIds = [...new Set(candidates.map(item => item.outlineDispatch.attemptId))];
    const resolved = attemptIds.map(attemptId => ({ attemptId,
      attempt: provider._internals.resolveOutlineAttempt({ sessionDir, taskId, attemptId }) }));
    const current = resolved.filter(item => item.attempt.state === 'accepted');
    if (current.length === 1) {
      const dispatches = candidates.filter(item => item.outlineDispatch.attemptId === current[0].attemptId);
      return dispatches.length ? [`${dispatches[0].ref}#outline-confirmation`] : [];
    }
    if (current.length > 1 || attemptIds.length > 1) return [];
  }
  const tuples = [...new Set(candidates.map(item => `${item.outlineDispatch.attemptId}\0${item.tool_use_id || ''}\0${item.outlineDispatch.dispatchInputDigest || ''}`))];
  if (tuples.length > 1 && !candidates.some(item => item.outlineDispatch.state === 'unresolved')) return [];
  return [`${candidates[0].ref}#outline-confirmation`];
}

function captureReferences(context) {
  const captures = readCaptures(context);
  if (activeHostFor(context) === 'opencode') {
    return captures.filter(item => typeof item?.call_id === 'string' && item.call_id.trim())
      .flatMap(item => ['doc-lint', 'link-check'].map(capability => `${item.call_id}#${capability}`));
  }
  const candidates = captures
    .filter(item => item && typeof item.ref === 'string' && (item.event === 'SubagentStop' || docCheckCandidate(item)))
    .filter(item => item.event !== 'SubagentStop');
  const taskId = context.workflow.docReconciliationTask?.taskId;
  const outlineReviews = outlineReviewCaptureRefs(context.sessionDir, taskId);
  const reviews = captures.filter(item => item && typeof item.ref === 'string' && item.event === 'SubagentStop'
    && !outlineReviews.has(item.ref));
  const references = [];
  for (const [index, capability] of ['doc-lint', 'link-check'].entries()) {
    const ordered = index ? candidates.slice(1).concat(candidates.slice(0, 1)) : candidates;
    references.push(...ordered.map(item => `${item.ref}#${capability}`));
  }
  const provider = require('./doc-reconciliation-provider');
  references.push(...candidates.filter(item => provider.resolveDocCheckInvocation(item.command, item.cwd).conflictAssessment === true)
    .map(item => `${item.ref}#conflict-check`));
  references.push(...outlineDispatchReferences(captures, taskId, context.sessionDir));
  // The adapter accepts one event per capability; rotating candidate order lets separate valid runs fill each capability.
  return [...references, ...reviews.map(item => `${item.ref}#quality-review`)];
}

// R3-02: verification recorded before an installed-runtime change is withdrawn once the live doc-check leaves the pin.
// Capture time sees the pristine runtime, so only assessment can catch a later change. Scoped to sessions that ran a doc-check.
function withdrawChangedRuntimeVerification(context) {
  try {
    const provider = require('./doc-reconciliation-provider');
    const installed = provider.installedDocCheck();
    if (!installed || provider.fileDigest(installed) === provider.SHIPPED_DOC_CHECK_DIGEST) return;
    if (!readCaptures(context).some(item => {
      if (!item || item.event !== 'PostToolUse') return false;
      const invocation = provider.resolveDocCheckInvocation(item.command, item.cwd);
      return invocation.kind === 'accepted' || invocation.reason === 'implementation-pin-mismatch';
    })) return;
    const file = path.join(context.sessionDir, 'handoff-state.json');
    const handoff = JSON.parse(fs.readFileSync(file, 'utf8'));
    const genericAt = handoff.lastGenericVerifyAt;
    const hasGeneric = typeof genericAt === 'number' && Number.isFinite(genericAt);
    const hasDoc = typeof handoff.lastDocVerifyAt === 'number' && Number.isFinite(handoff.lastDocVerifyAt);
    if (!hasGeneric && !hasDoc && handoff.lastVerifyAt === undefined) return;
    delete handoff.lastDocVerifyAt;
    delete handoff.lastDocVerifyExitCode;
    if (hasGeneric) {
      handoff.lastVerifyAt = genericAt;
      if (Object.prototype.hasOwnProperty.call(handoff, 'lastGenericVerifyExitCode')) {
        handoff.lastVerifyExitCode = handoff.lastGenericVerifyExitCode;
      } else {
        delete handoff.lastVerifyExitCode;
      }
    } else {
      // Older aggregate-only state has unknown ownership; do not preserve it as unaffected evidence.
      delete handoff.lastVerifyAt;
      delete handoff.lastVerifyExitCode;
    }
    atomicWriteJson(file, handoff);
  } catch { /* fail-open: no handoff state yet, or nothing to withdraw */ }
}

// Assessment is deliberately negative-credit only in S1. Unsupported topologies never enter
// generic step reconciliation, and failures (including report persistence) never escape to Stop.
function assess(context, set, dependencies = {}) {
  if (!enabled()) return { withhold: false };
  withdrawChangedRuntimeVerification(context);
  const report = {
    schemaVersion: 1, reportOrigin: 'runtime', pilotStatus: 'unavailable', pilotCredit: false,
    identity: null, expectedMustIds: [], results: [], unsatisfied: [], diagnostics: [],
    outlineEvidence: { status: 'unresolved', outcome: 'none', observation: 'unresolved', acceptedRefs: [], recordRefs: [], diagnostics: [] },
  };
  const supported = set?.stepBindingsEnabled === true && !String(context.workflow.strategy || '').startsWith('fable-');
  let withhold = false;
  if (!supported) report.diagnostics.push('unsupported-workflow');
  else {
    try {
      const musts = collect(context);
      withhold = musts.length > 0;
      report.pilotStatus = 'unresolved';
      report.expectedMustIds = musts.map(item => item.id);
      report.unsatisfied = musts.map(item => ({
        obligationId: item.id, state: item.applicability === 'unknown' ? 'unknown' : 'pending',
        reasonCode: item.applicability === 'unknown' ? 'unknown-applicability' : 'producer-unavailable',
      }));
      if (!withhold) report.diagnostics.push('trusted-non-document-scope');
      const hasOutlineCapture = captureReferences(context).some(reference => reference.endsWith('#outline-confirmation'));
      if (withhold || hasOutlineCapture) {
        let chain;
        try { chain = creditChain(context, set, dependencies); }
        catch (error) { chain = { eligible: false, outlineEvidence: { status: 'unresolved', outcome: 'none',
          observation: 'unresolved', reason: 'collector-unavailable', acceptedRefs: [], recordRefs: [], diagnostics: [] },
          diagnostics: [{ code: 'collector-unavailable', message: String(error.message) }] }; }
        report.outlineEvidence = chain.outlineEvidence || report.outlineEvidence;
        report.acceptedRefs = chain.acceptedRefs || [];
        report.diagnostics.push(...(chain.diagnostics || []));
        if (withhold) {
        // The unsatisfied list is rewritten from the chain: a MUST that the chain did not satisfy stays listed (F3).
        const satisfied = new Set(chain.satisfiedObligationIds || []);
        report.unsatisfied = [
          ...musts.filter(item => !satisfied.has(item.id)).map(item => ({
            obligationId: item.id, state: item.applicability === 'unknown' ? 'unknown' : 'pending',
            reasonCode: item.applicability === 'unknown' ? 'unknown-applicability' : 'producer-unavailable',
          })),
          ...(chain.unsatisfied || []),
        ];
        report.creditedCapabilities = chain.eligible === true ? chain.capabilities : [];
        // Credit needs an empty unsatisfied list across both sources and at least one satisfied capability.
        withhold = !(chain.eligible === true && report.unsatisfied.length === 0 && report.creditedCapabilities.length > 0);
        report.pilotCredit = !withhold;
        report.pilotStatus = report.pilotCredit ? 'credited' : 'unresolved';
        }
      }
    } catch (error) {
      withhold = true;
      const reason = ['baseline-unavailable', 'config-unavailable', 'scope-unavailable', 'config-scope-changed'].includes(error.message)
        ? error.message : 'collector-unavailable';
      report.diagnostics.push(reason);
      report.unsatisfied.push({ obligationId: 'doc-change:scope', state: 'unavailable', reasonCode: reason });
    }
  }
  report.diagnostics = report.diagnostics.map(diagnosticOf);
  try { atomicWriteJson(path.join(context.sessionDir, 'doc-reconciliation-pilot.json'), report); }
  catch {
    if (supported) withhold = true;
    console.error('[Workflow Reminder] Document pilot report unavailable; no document verification credit.');
  }
  return { withhold, report };
}

module.exports = { enabled, captureBaseline, assess, reviewRequired, independentReviewAccepted,
  _internals: { captureReferences, outlineDispatchReferences, outlineReviewCaptureRefs } };

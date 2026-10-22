'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { atomicWriteJson } = require('./fable-contracts');

const enabled = () => process.env.HARNESS_DOC_RECONCILIATION_PILOT === '1';

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
  if (!enabled() || context.workflow.docReconciliationBaseline) return;
  try {
    const root = git(context.root, ['rev-parse', '--show-toplevel']).trim();
    const commit = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    context.workflow.docReconciliationBaseline = { root, commit };
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
  const root = git(context.root, ['rev-parse', '--show-toplevel']).trim();
  if (root !== baseline.root || !/^[0-9a-f]{40,64}$/.test(baseline.commit)) throw new Error('baseline-unavailable');
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
  if (require('./doc-reconciliation-provider').readCaptureView(context.sessionDir).tampered) {
    return { eligible: false, diagnostics: [{ code: 'journal-tampered', message: 'the capture journal no longer matches its immutable event records' }] };
  }
  const { produceDocSnapshot } = require('./doc-reconciliation-producer');
  const { acceptDocEvents } = require('./doc-reconciliation-events');
  const { checkAcceptedDocEvidence } = require('./doc-reconciliation-core');
  const baseline = context.workflow.docReconciliationBaseline;
  const requirements = Array.isArray(set?.requirements) ? set.requirements : [];
  const taskId = `task-${requirements.map(item => item.id).join('+') || 'none'}`;
  const sessionId = context.sessionId;
  const { createClaudeOriginProvider, journalExecutors } = require('./doc-reconciliation-provider');
  const captures = readCaptures(context);
  const originProvider = dependencies.originProvider || createClaudeOriginProvider({
    hostId: 'claude-code',
    sessionId,
    workspaceRoot: context.root,
    workflowId: context.workflow.workflowId,
    workflowRevision: context.workflow.revision,
    taskId,
    principals: { author: sessionId, executors: journalExecutors(captures, sessionId) },
    baseline,
    captures,
  });
  const produced = produceDocSnapshot({
    workspaceRoot: context.root,
    baseline,
    workflow: { workflowId: context.workflow.workflowId, sessionId, workflowRevision: context.workflow.revision },
    task: { taskId, requirements },
    scope: { prdRoot: 'docs/prd/' },
    activeHost: 'claude-code',
    prdRoot: 'docs/prd/',
  }, { originProvider });
  if (produced.state !== 'ready' || !produced.snapshot) return { eligible: false, diagnostics: produced.diagnostics, unsatisfied: [] };
  const eventRefs = captureReferences(context);
  const accepted = acceptDocEvents({ snapshot: produced.snapshot, eventRefs }, { originProvider });
  const checked = checkAcceptedDocEvidence({ snapshot: produced.snapshot, accepted, mode: 'verification' });
  // Credit covers only the expected MUSTs that were both accepted and satisfied (passing, observed). N/A never counts.
  const passing = new Set((checked.results || []).filter(r => r.observation === 'observed' && r.outcome === 'pass').map(r => r.obligationId));
  const expected = new Set(checked.checkedMustIds || []);
  const satisfied = produced.snapshot.obligations.filter(o => o.strength === 'MUST' && o.applicability !== 'N/A' && expected.has(o.id) && passing.has(o.id));
  return {
    eligible: checked.eligible === true,
    capabilities: checked.eligible === true ? [...new Set(satisfied.map(o => o.capability))] : [],
    satisfiedObligationIds: satisfied.map(o => o.id),
    unsatisfied: checked.unsatisfied || [],
    acceptedRefs: Object.keys(accepted.acceptedIndex || {}),
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

// The session capture records are the only host-event source. A missing journal means no events; a journal that no longer
// equals its immutable event files is tampered and yields no events, so the chain withholds.
function readCaptures(context) {
  return require('./doc-reconciliation-provider').readCaptureView(context.sessionDir).records;
}

function captureReferences(context) {
  return readCaptures(context)
    .filter(item => item && (item.event === 'PostToolUse' || item.event === 'SubagentStop') && typeof item.ref === 'string')
    .flatMap(item => (item.event === 'SubagentStop' ? ['quality-review'] : ['doc-lint', 'link-check'])
      .map(capability => `${item.ref}#${capability}`));
}

// Assessment is deliberately negative-credit only in S1. Unsupported topologies never enter
// generic step reconciliation, and failures (including report persistence) never escape to Stop.
function assess(context, set, dependencies = {}) {
  if (!enabled()) return { withhold: false };
  const report = {
    schemaVersion: 1, reportOrigin: 'runtime', pilotStatus: 'unavailable', pilotCredit: false,
    identity: null, expectedMustIds: [], results: [], unsatisfied: [], diagnostics: [],
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
      if (withhold) {
        let chain;
        try { chain = creditChain(context, set, dependencies); }
        catch (error) { chain = { eligible: false, diagnostics: [{ code: 'collector-unavailable', message: String(error.message) }] }; }
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
        report.acceptedRefs = chain.acceptedRefs || [];
        report.diagnostics.push(...(chain.diagnostics || []));
        // Credit needs an empty unsatisfied list across both sources and at least one satisfied capability.
        withhold = !(chain.eligible === true && report.unsatisfied.length === 0 && report.creditedCapabilities.length > 0);
        report.pilotCredit = !withhold;
        report.pilotStatus = report.pilotCredit ? 'credited' : 'unresolved';
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

module.exports = { enabled, captureBaseline, assess, reviewRequired, independentReviewAccepted };

#!/usr/bin/env node
'use strict';

// #325 Phase 3b S2a RED suite: producer snapshot identity, captured config, baseline pinning, ignored scope and framing.
//
// Every assertion runs on both legs (canonical hooks/scripts/lib and the packaged copy) against real temporary Git
// repositories built by the shared harness. Missing modules or exports are FAIL with a module-missing or export-missing
// reason; the harness never crashes. Expected obligations come from the unchanged derive API. Everything else is
// hand-derived from docs/doc-workflow-reconciliation.md (S2a). INFRA (fixture or harness faults) is distinct from FAIL.
// Exit 1 means at least one assertion FAILED; exit 2 means an infrastructure fault.

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./fixtures/doc-obligations/reconciliation-s2a/harness.js');

const PRODUCER = 'doc-reconciliation-producer.js';
const EVENTS = 'doc-reconciliation-events.js';
const DERIVE = 'doc-obligations.js';
const RESOLVER = 'project-docs-resolver.js';
const REQ_PRODUCER = { where: 'lib', file: PRODUCER, exports: ['produceDocSnapshot'] };
const REQ_EVENTS = { where: 'lib', file: EVENTS, exports: ['acceptDocEvents'] };
const REQ_DERIVE = { where: 'scripts', file: DERIVE, exports: ['deriveDocFacts', 'deriveDocObligations'] };
const REQ_RESOLVER = { where: 'scripts', file: RESOLVER, exports: ['resolveDocsConfig', 'resolveDocsConfigCaptured'] };
const { VECTORS } = H;
const HEX64 = /^[0-9a-f]{64}$/;

const runner = H.createRunner('S2a producer');

function produce(mods, repo, overrides = {}, origin = null) {
  const o = origin || new H.FakeOrigin({ context: H.fakeContext(overrides.context, repo) });
  return { result: mods[PRODUCER].produceDocSnapshot(H.producerInput(repo, overrides), { originProvider: o }), origin: o };
}

function readyOrThrow(produced, label) {
  if (produced.state !== 'ready' || !produced.snapshot) {
    throw new Error(`${label}: state ${produced.state} with codes ${JSON.stringify(H.codesOf(produced))}`);
  }
  return produced.snapshot;
}

function recordAt(snapshot, side, rel) {
  const records = snapshot[side] && snapshot[side].records;
  if (Array.isArray(records)) return records.find(record => record && record.path === rel) || null;
  if (records && typeof records === 'object') return records[rel] || null;
  return null;
}

function withRepo(files, fn) {
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    return fn(repo);
  } finally {
    H.removeRepo(repo.root);
  }
}

function normativeFiles() {
  return H.vectorFiles('normative');
}

// ---- Snapshot contract: required fields, identity types and equalities, derivation reasons -----------------------

runner.run('snapshot:required-fields-present', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'normative capture');
  for (const field of ['identity', 'baseline', 'candidate', 'config', 'originContext', 'taskSemantics', 'facts', 'obligations', 'derivationReasons']) {
    if (snapshot[field] === undefined) throw new Error(`snapshot lacks required field ${field}`);
  }
  for (const field of ['commit', 'treeRef', 'records', 'digest']) {
    if (snapshot.baseline[field] === undefined) throw new Error(`baseline lacks ${field}`);
  }
  for (const field of ['records', 'coverage', 'digest']) {
    if (snapshot.candidate[field] === undefined) throw new Error(`candidate lacks ${field}`);
  }
  for (const field of ['resolution', 'capture', 'digest']) {
    if (snapshot.config[field] === undefined) throw new Error(`config lacks ${field}`);
  }
}));

runner.run('snapshot:identity-tuple-types-and-digest-equalities', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'normative capture');
  const id = snapshot.identity;
  for (const field of ['workspaceId', 'sessionId', 'workflowId', 'taskId']) {
    if (typeof id[field] !== 'string' || !id[field].trim()) throw new Error(`identity.${field} must be a nonempty string`);
  }
  if (!Number.isInteger(id.workflowRevision) || id.workflowRevision < 0) throw new Error('identity.workflowRevision must be a nonnegative integer');
  for (const field of ['taskScopeDigest', 'baselineDigest', 'candidateDigest', 'configDigest']) {
    if (!HEX64.test(id[field] || '')) throw new Error(`identity.${field} must be lowercase SHA256 hex`);
  }
  H.sameStable(id.prdRoot, 'docs/prd/', 'identity.prdRoot');
  H.sameStable(snapshot.baseline.digest, id.baselineDigest, 'baseline.digest equals identity.baselineDigest');
  H.sameStable(snapshot.candidate.digest, id.candidateDigest, 'candidate.digest equals identity.candidateDigest');
  H.sameStable(snapshot.config.digest, id.configDigest, 'config.digest equals identity.configDigest');
}));

runner.run('snapshot:obligations-equal-unchanged-derive-api-on-captured-bytes', [REQ_PRODUCER, REQ_DERIVE], (mods) => withRepo(normativeFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'normative capture');
  const files = normativeFiles();
  const facts = mods[DERIVE].deriveDocFacts({ base: { files: files.base }, candidate: { files: files.candidate }, config: H.DERIVE_CONFIG });
  const obligations = mods[DERIVE].deriveDocObligations(facts.facts);
  H.sameStable(snapshot.obligations, obligations, 'snapshot.obligations');
}));

runner.run('snapshot:derivation-reasons-cover-every-obligation', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'normative capture');
  for (const obligation of snapshot.obligations) {
    const reason = snapshot.derivationReasons[obligation.id];
    if (!reason) throw new Error(`no derivationReasons entry for ${obligation.id}`);
    H.sameStable(reason.applicability, obligation.applicability, `${obligation.id} applicability`);
    if (typeof reason.reason !== 'string' || !reason.reason.trim()) throw new Error(`${obligation.id} lacks a nonempty reason`);
    if (!Array.isArray(reason.factRefs) || reason.factRefs.length === 0) throw new Error(`${obligation.id} lacks factRefs`);
  }
}));

// ---- A04: docs/prd/ is the only supported root -------------------------------------------------------------------

runner.run('A04:docs-prd-root-positive-produces-ready-snapshot', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'docs/prd/ root');
  H.sameStable(snapshot.identity.prdRoot, 'docs/prd/', 'identity.prdRoot');
}));

runner.run('A04:custom-prd-root-unavailable-with-no-fallback', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const { result } = produce(mods, repo, { top: { prdRoot: 'docs/other/' } });
  if (result.snapshot) throw new Error('a custom PRD root must not yield a snapshot, even with otherwise identical inputs');
  H.expectCodes(H.codesOf(result), ['unsupported-prd-root'], 'custom PRD root');
}));

// ---- A05: whole-candidate identity, deletion and rename endpoints, tombstones --------------------------------------

runner.run('A05:whole-candidate-identity-is-not-the-prd-set-digest', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'normative capture');
  if (!HEX64.test(snapshot.identity.candidateDigest)) throw new Error('candidateDigest must be lowercase SHA256 hex');
  if (snapshot.identity.candidateDigest === H.prdSetDigest(repo.root)) {
    throw new Error('candidateDigest must cover the whole candidate, not only the PRD-set envelope');
  }
}));

const renameFiles = () => ({
  base: { 'docs/prd/a.md': 'rename me\n' },
  candidate: { 'docs/prd/a.md': null, 'docs/prd/b.md': 'rename me\n' }
});

runner.run('A05:deletion-and-rename-endpoints-are-both-bound', [REQ_PRODUCER], mods => withRepo(renameFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'rename capture');
  const source = recordAt(snapshot, 'candidate', 'docs/prd/a.md');
  const destination = recordAt(snapshot, 'candidate', 'docs/prd/b.md');
  if (!source || source.presence !== 'deleted') throw new Error('deleted source endpoint must be a deleted tombstone');
  if (!destination || destination.presence !== 'present') throw new Error('rename destination must be a present record');
  const baseSource = recordAt(snapshot, 'baseline', 'docs/prd/a.md');
  if (!baseSource || baseSource.presence !== 'present') throw new Error('baseline must retain the source endpoint');
}));

runner.run('A05:deleted-tombstones-omitted-from-checker-artifacts', [REQ_PRODUCER, REQ_EVENTS], mods => withRepo(renameFiles(), repo => {
  const snapshot = readyOrThrow(produce(mods, repo).result, 'rename capture');
  const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
  const accepted = mods[EVENTS].acceptDocEvents({ snapshot, eventRefs: [] }, { originProvider: origin });
  const artifacts = accepted.checkerInputs && accepted.checkerInputs.artifacts;
  if (!artifacts || typeof artifacts !== 'object') throw new Error('checkerInputs.artifacts is missing');
  if (Object.prototype.hasOwnProperty.call(artifacts, 'docs/prd/a.md')) throw new Error('a deleted tombstone must not appear as a candidate artifact');
  if (!Object.prototype.hasOwnProperty.call(artifacts, 'docs/prd/b.md')) throw new Error('the rename destination must appear as a candidate artifact');
  const baselineArtifacts = accepted.checkerInputs.baseline && accepted.checkerInputs.baseline.artifacts;
  if (!baselineArtifacts || !Object.prototype.hasOwnProperty.call(baselineArtifacts, 'docs/prd/a.md')) {
    throw new Error('the baseline artifact for the deleted source must be retained');
  }
}));

runner.run('A05:deleted-path-differs-from-empty-file-in-candidate-digest', [REQ_PRODUCER], mods => {
  const deleted = withRepo(renameFiles(), repo => readyOrThrow(produce(mods, repo).result, 'deleted').identity.candidateDigest);
  const emptyFile = withRepo({ base: { 'docs/prd/a.md': 'rename me\n' }, candidate: { 'docs/prd/a.md': '', 'docs/prd/b.md': 'rename me\n' } },
    repo => readyOrThrow(produce(mods, repo).result, 'empty').identity.candidateDigest);
  if (deleted === emptyFile) throw new Error('a deletion and an empty file must produce different candidate identities');
});

runner.run('framing:path-boundary-concatenation-does-not-collide', [REQ_PRODUCER], mods => {
  const first = withRepo({ base: { 'docs/prd/x.md': 'seed\n', 'docs/prd/y.md': 'seed\n' }, candidate: { 'docs/prd/x.md': 'ab', 'docs/prd/y.md': 'c' } },
    repo => readyOrThrow(produce(mods, repo).result, 'split one').identity.candidateDigest);
  const second = withRepo({ base: { 'docs/prd/x.md': 'seed\n', 'docs/prd/y.md': 'seed\n' }, candidate: { 'docs/prd/x.md': 'a', 'docs/prd/y.md': 'bc' } },
    repo => readyOrThrow(produce(mods, repo).result, 'split two').identity.candidateDigest);
  if (first === second) throw new Error('path-boundary concatenation collision in candidateDigest');
});

runner.run('framing:mode-drift-changes-candidate-digest', [REQ_PRODUCER], mods => {
  if (process.platform === 'win32') throw new H.UncheckedError('win32: no POSIX execute bit (core.fileMode=false), mode drift is not observable');
  const plain = withRepo(normativeFiles(), repo => readyOrThrow(produce(mods, repo).result, 'plain').identity.candidateDigest);
  const drifted = withRepo(normativeFiles(), repo => {
    fs.chmodSync(path.join(repo.root, 'docs/prd/graph.md'), 0o755);
    return readyOrThrow(produce(mods, repo).result, 'mode drift').identity.candidateDigest;
  });
  if (plain === drifted) throw new Error('a mode change (100644 to 100755) must change candidateDigest');
});

// ---- A09: pinned baseline after a fixture commit; rename endpoints stable across captures -------------------------

runner.run('A09:pinned-baseline-remains-after-fixture-commit', [REQ_PRODUCER, REQ_DERIVE], mods => {
  const files = normativeFiles();
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    const first = readyOrThrow(produce(mods, repo).result, 'capture before commit');
    H.git(repo.root, ['add', '-A']);
    H.git(repo.root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'documentation change']);
    const afterCommit = readyOrThrow(produce(mods, repo, {}).result, 'pinned capture after commit');
    H.sameStable(afterCommit.baseline.commit, repo.commit, 'pinned baseline commit');
    H.sameStable(afterCommit.identity.baselineDigest, first.identity.baselineDigest, 'baselineDigest after commit');
    H.sameStable(afterCommit.obligations.filter(item => item.strength === 'MUST' && item.applicability !== 'N/A').map(item => item.id).sort(),
      [...VECTORS.vectors.normative.expectedMustIds].sort(), 'governed MUSTs after the commit');
  } finally {
    H.removeRepo(repo.root);
  }
});

// A09 oracle fix (PR #353 review P1): the previous form accepted the HEAD-anchored capture and only asserted a
// different digest — but a different digest cannot establish that the captured baseline is the authorized
// workflow-start commit, so this oracle encoded the bug it was meant to guard. The authorized pin is the
// provider's start pin (the workflow-start baselineReference, unchanged since workflow start): a capture whose
// input baseline is re-anchored to the moved HEAD must be baseline-unavailable, never a snapshot.
runner.run('A09:head-anchored-capture-has-a-different-baseline-identity', [REQ_PRODUCER], mods => {
  const files = normativeFiles();
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    H.git(repo.root, ['add', '-A']);
    H.git(repo.root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'documentation change']);
    const head = H.git(repo.root, ['rev-parse', 'HEAD']).trim();
    const moved = mods[PRODUCER].produceDocSnapshot({ ...H.producerInput(repo), baseline: { root: repo.root, commit: head } },
      { originProvider: new H.FakeOrigin({ context: H.fakeContext({}, repo) }) });
    if (moved.snapshot) throw new Error('a HEAD-anchored input baseline must not capture: the authorized pin is the provider start pin, not the moving HEAD');
    H.expectCodes(H.codesOf(moved), ['baseline-unavailable'], 'HEAD-anchored input against the workflow-start pin');
  } finally {
    H.removeRepo(repo.root);
  }
});

runner.run('A09:rename-endpoints-stable-across-repeated-captures', [REQ_PRODUCER], mods => withRepo(renameFiles(), repo => {
  const first = readyOrThrow(produce(mods, repo).result, 'first rename capture');
  const second = readyOrThrow(produce(mods, repo).result, 'second rename capture');
  H.sameStable(second.identity, first.identity, 'identity across repeated rename captures');
}));

// ---- R2d P1: provider baseline pinning (PR #353 review) ------------------------------------------------------------

runner.run('R2d-P1:reference-only-provider-context-is-baseline-unavailable', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  // doc-workflow-reconciliation.md: the provider context MUST carry the concrete pinned `baseline: { commit, root }`;
  // a bare baselineReference is not enough, so a reference-only context cannot authorize any capture.
  const origin = new H.FakeOrigin({ context: H.fakeContext() });
  const { result } = produce(mods, repo, {}, origin);
  if (result.snapshot) throw new Error('a provider context without a concrete pinned baseline must not yield a snapshot');
  H.expectCodes(H.codesOf(result), ['baseline-unavailable'], 'reference-only provider context');
}));

runner.run('R2d-P1:input-baseline-re-anchored-to-moved-head-is-never-ready', [REQ_PRODUCER], mods => {
  const files = normativeFiles();
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    H.git(repo.root, ['add', '-A']);
    H.git(repo.root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'documentation change']);
    const head = H.git(repo.root, ['rev-parse', 'HEAD']).trim();
    // The provider's start pin stays where the workflow started (the start baselineReference above); the input
    // baseline is re-anchored to the moved HEAD. The authorized workflow-start pin never follows HEAD.
    const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) }); // pinned at the original start commit
    const { result } = produce(mods, repo, { top: { baseline: { root: repo.root, commit: head } } }, origin);
    if (result.snapshot) throw new Error('an input baseline re-anchored to a moved HEAD must never yield a ready snapshot');
    H.expectCodes(H.codesOf(result), ['baseline-unavailable'], 're-anchored input baseline');
  } finally {
    H.removeRepo(repo.root);
  }
});

runner.run('R2d-P1:input-baseline-equal-to-the-provider-pin-stays-ready-after-head-moved', [REQ_PRODUCER], mods => {
  // Control: the provider context concretely pins the workflow-start baseline and the input baseline equals that
  // pin even though HEAD moved; this capture stays ready.
  const files = normativeFiles();
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    H.git(repo.root, ['add', '-A']);
    H.git(repo.root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'documentation change']);
    const origin = new H.FakeOrigin({ context: H.fakeContext({ baseline: { root: repo.root, commit: repo.commit } }) });
    const { result } = produce(mods, repo, {}, origin);
    readyOrThrow(result, 'equal-pin capture after HEAD moved');
  } finally {
    H.removeRepo(repo.root);
  }
});

// ---- R2d P2a: nested semantic task/scope changes must change the task-scope digest (PR #353 review P2) --------------

runner.run('R2d-P2a:nested-scope-policy-status-is-a-semantic-change', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  // Progress-key stripping is location-bound: it applies to the per-step/per-binding progress records, never to
  // every nested object with the same key name. A nested scope policy flag is semantic and always re-hashes.
  const strict = readyOrThrow(produce(mods, repo, { top: { scope: { prdRoot: 'docs/prd/', policy: { status: 'strict' } } } }).result, 'strict scope capture');
  const relaxed = readyOrThrow(produce(mods, repo, { top: { scope: { prdRoot: 'docs/prd/', policy: { status: 'relaxed' } } } }).result, 'relaxed scope capture');
  if (strict.identity.taskScopeDigest === relaxed.identity.taskScopeDigest) {
    throw new Error('a nested scope policy change (policy.status) must change taskScopeDigest');
  }
}));

runner.run('R2d-P2a:nested-requirement-and-binding-semantics-change-the-digest', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  // Nested objects inside requirement/binding definitions carry semantics; only the per-step/per-binding progress
  // record locations above them (requirement.status/evidence, binding status records) stay progress-exempt
  // (the A14 status-only control keeps passing).
  const base = H.clone(VECTORS.fixedTask.requirements);
  const gateA = H.clone(base); gateA[0].gate = { state: 'blocked-on-review' };
  const gateB = H.clone(base); gateB[0].gate = { state: 'clear' };
  const first = readyOrThrow(produce(mods, repo, { task: { requirements: gateA } }).result, 'requirement gate capture');
  const second = readyOrThrow(produce(mods, repo, { task: { requirements: gateB } }).result, 'other requirement gate capture');
  if (first.identity.taskScopeDigest === second.identity.taskScopeDigest) {
    throw new Error('a nested requirement semantic (gate.state) must change taskScopeDigest');
  }
  const bindingA = H.clone(base); bindingA[1].bindings = [{ id: 'verification-loop', report: { kind: 'summary' } }];
  const bindingB = H.clone(base); bindingB[1].bindings = [{ id: 'verification-loop', report: { kind: 'detailed' } }];
  const third = readyOrThrow(produce(mods, repo, { task: { requirements: bindingA } }).result, 'binding report capture');
  const fourth = readyOrThrow(produce(mods, repo, { task: { requirements: bindingB } }).result, 'other binding report capture');
  if (third.identity.taskScopeDigest === fourth.identity.taskScopeDigest) {
    throw new Error('a nested binding semantic (report.kind) must change taskScopeDigest');
  }
}));

// ---- A10: Git failure and normal capture ------------------------------------------------------------------------

runner.run('A10:missing-baseline-commit-yields-baseline-unavailable', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const { result } = produce(mods, repo, { top: { baseline: { root: repo.root, commit: '0'.repeat(40) } } });
  if (result.snapshot) throw new Error('a missing baseline commit must not yield a snapshot');
  H.expectCodes(H.codesOf(result), ['baseline-unavailable'], 'missing baseline commit');
}));

runner.run('A10:non-repository-baseline-root-yields-baseline-unavailable', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-s2a-not-a-repo-'));
  try {
    const { result } = produce(mods, repo, { top: { baseline: { root: outside, commit: repo.commit } } });
    if (result.snapshot) throw new Error('a non-repository baseline root must not yield a snapshot');
    H.expectCodes(H.codesOf(result), ['baseline-unavailable'], 'non-repository baseline root');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}));

runner.run('A10:normal-git-capture-succeeds', [REQ_PRODUCER], mods => withRepo(normativeFiles(), repo => {
  readyOrThrow(produce(mods, repo).result, 'normal Git capture');
}));

// ---- A11: ignored paths (F4): included faithfully or unavailable, never silently absent --------------------------

const IGNORE_BASE = { '.gitignore': 'docs/prd/private/\n' };

runner.run('A11:ignored-governed-path-included-or-unavailable-never-silent', [REQ_PRODUCER], mods => withRepo({
  base: { ...normativeFiles().base, ...IGNORE_BASE },
  candidate: { ...normativeFiles().candidate, 'docs/prd/private/new.md': 'ignored governed PRD\n' }
}, repo => {
  const { result } = produce(mods, repo);
  if (result.state === 'ready' && result.snapshot) {
    const record = recordAt(result.snapshot, 'candidate', 'docs/prd/private/new.md');
    if (!record || record.presence !== 'present') throw new Error('an ignored governed path must be included when capture is ready');
    return;
  }
  H.expectCodes(H.codesOf(result), ['inventory-incomplete', 'inventory-unsupported'], 'ignored governed path without faithful inventory');
}));

runner.run('A11:index-removed-ignored-file-included-or-unavailable', [REQ_PRODUCER], mods => {
  const files = { base: { ...normativeFiles().base, ...IGNORE_BASE, 'docs/prd/tracked.md': 'tracked then ignored\n' }, candidate: { ...normativeFiles().candidate } };
  withRepo(files, repo => {
    fs.appendFileSync(path.join(repo.root, '.gitignore'), 'docs/prd/tracked.md\n');
    H.git(repo.root, ['add', '-A']);
    H.git(repo.root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'ignore tracked path']);
    H.git(repo.root, ['rm', '--cached', '-q', 'docs/prd/tracked.md']);
    const { result } = produce(mods, repo);
    if (result.state === 'ready' && result.snapshot) {
      const record = recordAt(result.snapshot, 'candidate', 'docs/prd/tracked.md');
      if (!record || record.presence !== 'present') throw new Error('a file removed from the index but still present must not be silently absent');
      return;
    }
    H.expectCodes(H.codesOf(result), ['inventory-incomplete', 'inventory-unsupported'], 'index-removed ignored file without faithful inventory');
  });
});

runner.run('A11:ignored-irrelevant-control-has-no-new-must-and-a-justified-exclusion', [REQ_PRODUCER], mods => withRepo({
  base: { ...normativeFiles().base, '.gitignore': 'tmp/\n' },
  candidate: { ...normativeFiles().candidate, 'tmp/notes.log': 'scratch output\n' }
}, repo => {
  const { result } = produce(mods, repo);
  const snapshot = readyOrThrow(result, 'ignored irrelevant control');
  H.sameStable(snapshot.obligations.filter(item => item.strength === 'MUST' && item.applicability !== 'N/A').map(item => item.id).sort(),
    [...VECTORS.vectors.normative.expectedMustIds].sort(), 'MUST set with an ignored irrelevant file');
  const present = recordAt(snapshot, 'candidate', 'tmp/notes.log');
  const justified = (snapshot.diagnostics || []).some(item => /ignored/i.test(String(item.message || item.code || '')));
  if (!(present && present.presence === 'present') && !justified) {
    throw new Error('an ignored irrelevant file must be included or excluded with a justified diagnostic');
  }
}));

// ---- A03: captured config seam (resolver) and producer behaviour on config bytes ----------------------------------

const HOST_MANIFEST = '.claude/harness-everything/manifest.json';

runner.run('A03:captured-resolution-equals-existing-resolver-project-config', [REQ_RESOLVER], mods => withRepo(normativeFiles(), repo => {
  const captured = mods[RESOLVER].resolveDocsConfigCaptured(repo.root, { activeHost: 'claude' });
  const existing = mods[RESOLVER].resolveDocsConfig(repo.root, { activeHost: 'claude' });
  H.sameStable(captured.resolution, existing, 'captured resolution equals the existing resolver result');
}));

runner.run('A03:project-overrides-host-positive-equals-existing-resolver', [REQ_RESOLVER], mods => {
  const host = { ...normativeFiles().base, [HOST_MANIFEST]: JSON.stringify({ projectDocs: { governed: [{ path: 'docs/host/**', role: 'reference' }] } }, null, 2) + '\n' };
  withRepo({ base: host, candidate: {} }, repo => {
    const captured = mods[RESOLVER].resolveDocsConfigCaptured(repo.root, { activeHost: 'claude' });
    const existing = mods[RESOLVER].resolveDocsConfig(repo.root, { activeHost: 'claude' });
    H.sameStable(captured.resolution, existing, 'project-overrides-host resolution');
  });
});

runner.run('A03:equal-host-positive-equals-existing-resolver', [REQ_RESOLVER], mods => {
  const host = { ...normativeFiles().base, [HOST_MANIFEST]: JSON.stringify({ projectDocs: H.DERIVE_CONFIG }, null, 2) + '\n' };
  withRepo({ base: host, candidate: {} }, repo => {
    const captured = mods[RESOLVER].resolveDocsConfigCaptured(repo.root, { activeHost: 'claude' });
    const existing = mods[RESOLVER].resolveDocsConfig(repo.root, { activeHost: 'claude' });
    H.sameStable(captured.resolution, existing, 'equal-host resolution');
  });
});

runner.run('A03:capture-binds-exact-config-bytes-and-selection', [REQ_RESOLVER], mods => withRepo(normativeFiles(), repo => {
  const captured = mods[RESOLVER].resolveDocsConfigCaptured(repo.root, { activeHost: 'claude' });
  const bytes = fs.readFileSync(path.join(repo.root, H.CONFIG_REL));
  const digest = H.sha256(bytes);
  if (!JSON.stringify(captured.capture && captured.capture.sources).includes(digest)) {
    throw new Error('the capture must carry the SHA256 of the exact config bytes that were parsed');
  }
  if (!captured.capture || !Array.isArray(captured.capture.selectionInputs)) throw new Error('capture.selectionInputs must be an array');
}));

runner.run('A03:absent-project-config-yields-config-unavailable', [REQ_PRODUCER], mods => {
  const files = normativeFiles();
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    H.git(repo.root, ['rm', '-q', H.CONFIG_REL]);
    H.git(repo.root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'remove config']);
    const { result } = produce(mods, repo);
    if (result.snapshot) throw new Error('an absent project config must not yield a usable producer identity');
    H.expectCodes(H.codesOf(result), ['config-unavailable'], 'absent project config');
  } finally {
    H.removeRepo(repo.root);
  }
});

// ---- Purity: producer capture writes nothing and spawns only Git; no network -----------------------------------------

runner.run('purity:producer-capture-writes-nothing-spawns-only-git', [REQ_PRODUCER], (mods, leg) => withRepo(normativeFiles(), repo => {
  const abs = path.join(leg.lib, PRODUCER);
  const log = H.recordingIo(rec => {
    const fresh = H.freshModule(abs);
    fresh.produceDocSnapshot(H.producerInput(repo), { originProvider: new H.FakeOrigin({ context: H.fakeContext({}, repo) }) });
    return rec;
  });
  H.sameStable(log.writes, [], 'file writes during capture');
  H.sameStable(log.spawns.filter(command => command !== 'git'), [], 'spawned commands other than git');
  H.sameStable(log.net, [], 'network connects during capture');
}));

// ---- PR #353 review P2: a whole-project inventory that contains binary records ------------------------------
//
// The inventory is whole-project, so a normal tracked binary asset must not make the capture unusable. Its
// stored bytes stay in the identity framing; only semantic derivation needs decoded text.

runner.run('R3-P2:unchanged-binary-asset-captures-without-changing-applicability', [REQ_PRODUCER], mods => {
  const files = normativeFiles();
  const repo = H.makeRepo(files.base, { 'assets/logo.png': H.BINARY_BYTES });
  try {
    H.writeFiles(repo.root, files.candidate);
    const snapshot = readyOrThrow(produce(mods, repo).result, 'capture with an unchanged binary asset');
    const record = recordAt(snapshot, 'candidate', 'assets/logo.png');
    if (!record || record.presence !== 'present') throw new Error('the binary asset must stay in the candidate inventory');
    H.sameStable(record.digest, H.sha256(H.BINARY_BYTES), 'binary record digest of its stored bytes');
    H.sameStable(snapshot.obligations.filter(item => item.strength === 'MUST' && item.applicability !== 'N/A').map(item => item.id).sort(),
      [...VECTORS.vectors.normative.expectedMustIds].sort(), 'MUST set with an unchanged binary asset');
  } finally { H.removeRepo(repo.root); }
});

runner.run('R3-P2:changed-binary-asset-changes-the-candidate-digest-without-changing-applicability', [REQ_PRODUCER], mods => {
  const files = normativeFiles();
  const repo = H.makeRepo(files.base, { 'assets/logo.png': H.BINARY_BYTES });
  try {
    H.writeFiles(repo.root, files.candidate);
    const first = readyOrThrow(produce(mods, repo).result, 'capture with an unchanged binary asset');
    H.writeBinary(repo.root, { 'assets/logo.png': H.BINARY_BYTES_CHANGED });
    const second = readyOrThrow(produce(mods, repo).result, 'capture with a changed binary asset');
    if (first.identity.candidateDigest === second.identity.candidateDigest) {
      throw new Error('a changed binary asset must change the candidateDigest');
    }
    H.sameStable(second.obligations.filter(item => item.strength === 'MUST' && item.applicability !== 'N/A').map(item => item.id).sort(),
      [...VECTORS.vectors.normative.expectedMustIds].sort(), 'MUST set with a changed binary asset');
  } finally { H.removeRepo(repo.root); }
});

for (const [label, rel] of [['governed-document', 'docs/prd/binary.md'], ['derived-output', 'docs/roadmap/index.md'],
  ['code-input', 'src/app.js'], ['test-input', 'tests/app.test.js']]) {
  runner.run(`R3-P2:undecodable-${label}-record-fails-closed`, [REQ_PRODUCER], mods => {
    const files = normativeFiles();
    const repo = H.makeRepo(files.base);
    try {
      H.writeFiles(repo.root, files.candidate);
      H.writeBinary(repo.root, { [rel]: H.BINARY_BYTES });
      const { result } = produce(mods, repo);
      if (result.snapshot) throw new Error(`an undecodable ${label} must not yield a snapshot`);
      H.expectCodes(H.codesOf(result), ['inventory-unsupported'], `undecodable ${label}`);
    } finally { H.removeRepo(repo.root); }
  });
}

// TextDecoder removes a leading UTF-8 BOM; relevance detection must see the same frontmatter.
for (const prefix of ['', '\uFEFF']) {
  runner.run(`R3-P2:undecodable-frontmatter-${prefix ? 'bom' : 'plain'}-fails-closed`, [REQ_PRODUCER], mods => {
    const files = normativeFiles();
    const repo = H.makeRepo(files.base);
    try {
      H.writeFiles(repo.root, files.candidate);
      H.writeBinary(repo.root, { 'assets/role.dat': Buffer.concat([
        Buffer.from(`${prefix}---\nrole: prd\n---\n`), H.BINARY_BYTES
      ]) });
      const { result } = produce(mods, repo);
      if (result.snapshot) throw new Error('undecodable frontmatter must not disappear from semantic inputs');
      H.expectCodes(H.codesOf(result), ['inventory-unsupported'], 'undecodable frontmatter');
    } finally { H.removeRepo(repo.root); }
  });
}

const counts = runner.summary();
if (counts.INFRA > 0) {
  console.error('S2a producer suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (counts.FAIL > 0) {
  console.error('S2a producer suite: assertion FAIL present (expected on the RED base; GREEN must clear every FAIL).');
  process.exitCode = 1;
} else {
  console.log('S2a producer suite: all assertions PASS.');
}

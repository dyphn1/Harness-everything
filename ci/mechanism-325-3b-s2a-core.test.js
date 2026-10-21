#!/usr/bin/env node
'use strict';

// #325 Phase 3b S2a RED suite: producer snapshot -> accepted events -> expected-set reconciliation core.
//
// Every assertion runs on both legs (canonical hooks/scripts/lib and the packaged copy). Missing modules and missing
// exports are FAIL with a module-missing or export-missing reason; the harness never crashes. Positive vectors and
// single-field flips use explicitly fake origin providers (test fixtures, not production attestation). Expected MUST
// sets and regression pins come from the existing unchanged derive/checker APIs; every other expectation is hand-derived
// from docs/doc-workflow-reconciliation.md (S2a). INFRA (fixture repository or harness faults) is distinct from FAIL.
// Exit 1 means at least one assertion FAILED; exit 2 means an infrastructure fault.

const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const net = require('net');
const H = require('./fixtures/doc-obligations/reconciliation-s2a/harness.js');

const REQ_PRODUCER = { where: 'lib', file: 'doc-reconciliation-producer.js', exports: ['produceDocSnapshot'] };
const REQ_EVENTS = { where: 'lib', file: 'doc-reconciliation-events.js', exports: ['acceptDocEvents'] };
const REQ_CORE = { where: 'lib', file: 'doc-reconciliation-core.js', exports: ['checkAcceptedDocEvidence', 'reconcileDocResults'] };
const REQ_DERIVE = { where: 'scripts', file: 'doc-obligations.js', exports: ['deriveDocFacts', 'deriveDocObligations'] };
const REQ_CHECKER = { where: 'scripts', file: 'doc-evidence.js', exports: ['checkDocObligations'] };
const PRODUCER = 'doc-reconciliation-producer.js';
const EVENTS = 'doc-reconciliation-events.js';
const CORE = 'doc-reconciliation-core.js';
const DERIVE = 'doc-obligations.js';
const CHECKER = 'doc-evidence.js';
const ALL_NEW = [REQ_PRODUCER, REQ_EVENTS, REQ_CORE];
const { VECTORS, PRINCIPALS, ZERO_DIGEST } = H;

const runner = H.createRunner('S2a core');
const sorted = list => [...list].sort();

// Runs the complete positive flow for one vector in a fresh repository: produce -> accept -> decide.
function withVector(key, fn, options = {}) {
  const files = H.vectorFiles(key);
  const repo = H.makeRepo(files.base);
  try {
    H.writeFiles(repo.root, files.candidate);
    fn(repo);
  } finally {
    H.removeRepo(repo.root);
  }
}

function flow(mods, repo, key, options = {}) {
  const P = mods[PRODUCER];
  const E = mods[EVENTS];
  const C = mods[CORE];
  const vec = VECTORS.vectors[key];
  const origin = new H.FakeOrigin({ context: H.fakeContext(options.context, repo), mode: options.mode || 'accept' });
  const produced = P.produceDocSnapshot(H.producerInput(repo, options.producer), { originProvider: origin });
  if (produced.state !== 'ready' || !produced.snapshot) {
    return { produced, origin, codes: H.codesOf(produced) };
  }
  const snapshot = produced.snapshot;
  const events = options.events || H.buildEvents(snapshot, repo, vec);
  for (const [ref, event] of Object.entries(events)) {
    if (!event.__notIssued) origin.issueEvent(ref, event);
  }
  const eventRefs = Object.keys(events);
  const accepted = E.acceptDocEvents({ snapshot, eventRefs }, { originProvider: origin });
  const decision = C.checkAcceptedDocEvidence({ snapshot, accepted, mode: options.mode === 'review' ? 'review' : 'verification' });
  return { produced, origin, snapshot, events, accepted, decision, codes: H.codesOf(produced, accepted, decision) };
}

function requireEligible(result, label) {
  if (!result.decision) throw new Error(`${label}: no decision (producer ${result.produced.state}: ${result.codes.join(',') || 'no codes'})`);
  if (result.decision.decision !== 'eligible' || result.decision.eligible !== true) {
    throw new Error(`${label}: decision ${result.decision.decision} with codes ${JSON.stringify(result.codes)}`);
  }
}

// ---- A01: complete positive vectors and the review-not-forced control --------------------------------------------

runner.run('A01:normative-complete-vector-eligible-with-exact-expected-set', ALL_NEW, mods => withVector('normative', repo => {
  const vec = VECTORS.vectors.normative;
  const r = flow(mods, repo, 'normative');
  requireEligible(r, 'normative vector');
  H.sameStable(sorted(r.decision.expectedMustIds), sorted(vec.expectedMustIds), 'expectedMustIds (derived by the unchanged derive API)');
  H.sameStable(sorted(r.decision.checkedMustIds), sorted(vec.expectedMustIds), 'checkedMustIds (verification mode checks the full set)');
  H.sameStable(r.decision.unsatisfied || [], [], 'unsatisfied');
}));

runner.run('A01:normative-checker-results-unchanged-from-direct-checker-call', [...ALL_NEW, REQ_CHECKER], (mods) => withVector('normative', repo => {
  const r = flow(mods, repo, 'normative');
  requireEligible(r, 'normative vector');
  const direct = mods[CHECKER].checkDocObligations(r.accepted.checkerInputs);
  H.sameStable(r.decision.results, direct.results, 'results retained unchanged from checkDocObligations(checkerInputs)');
}));

runner.run('A01:nonnormative-positive-is-eligible-and-review-not-forced', ALL_NEW, mods => withVector('nonnormative', repo => {
  const vec = VECTORS.vectors.nonnormative;
  const r = flow(mods, repo, 'nonnormative');
  requireEligible(r, 'nonnormative vector');
  H.sameStable(sorted(r.decision.expectedMustIds), sorted(vec.expectedMustIds), 'expectedMustIds without quality-review or conflict-check');
}));

// ---- A02: task substitution, narrowed scope, changed requirements/bindings and workflow revision -----------------

runner.run('A02:same-bytes-same-task-positive-control', ALL_NEW, mods => withVector('normative', repo => {
  const first = flow(mods, repo, 'normative');
  requireEligible(first, 'first capture');
  const second = flow(mods, repo, 'normative');
  requireEligible(second, 'second capture with the same task');
  H.sameStable(second.snapshot.identity, first.snapshot.identity, 'identity of an unchanged repository and task');
}));

// ---- A03: captured config binding (the resolver seam is exercised through the producer) ------------------------

runner.run('A03:parse-A-then-replace-with-B-same-value-rejected', [...ALL_NEW], mods => withVector('normative', repo => {
  const first = flow(mods, repo, 'normative');
  requireEligible(first, 'config A');
  const configFile = path.join(repo.root, H.CONFIG_REL);
  fs.writeFileSync(configFile, JSON.stringify(H.DERIVE_CONFIG, null, 4) + '\n', 'utf8');
  const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
  const produced = mods[PRODUCER].produceDocSnapshot(H.producerInput(repo), { originProvider: origin });
  if (!produced.snapshot) throw new Error(`second capture not ready: ${H.codesOf(produced).join(',')}`);
  if (produced.snapshot.identity.configDigest === first.snapshot.identity.configDigest) {
    throw new Error('equal parsed config with different bytes must produce a different configDigest');
  }
  const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot: produced.snapshot, accepted: first.accepted, mode: 'verification' });
  if (decision.eligible) throw new Error('evidence bound to config A must not be eligible against config B');
  H.expectCodes(H.codesOf(decision), ['config-capture-mismatch', 'identity-mismatch'], 'config A evidence under config B');
}));

runner.run('A03:active-host-selection-change-rejected', ALL_NEW, mods => withVector('normative', repo => {
  const first = flow(mods, repo, 'normative');
  requireEligible(first, 'host A');
  const origin = new H.FakeOrigin({ context: H.fakeContext({ activeHost: { hostId: 'other-host' } }, repo) });
  const produced = mods[PRODUCER].produceDocSnapshot(H.producerInput(repo, { top: { activeHost: { hostId: 'other-host' } } }), { originProvider: origin });
  if (!produced.snapshot) throw new Error(`host B capture not ready: ${H.codesOf(produced).join(',')}`);
  const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot: produced.snapshot, accepted: first.accepted, mode: 'verification' });
  if (decision.eligible) throw new Error('evidence bound to host A must not be eligible under host B');
  H.expectCodes(H.codesOf(decision), ['config-capture-mismatch', 'identity-mismatch'], 'host A evidence under host B');
}));

// ---- A06: independent review progression; self and unknown provenance rejected without prose matching ------------

runner.run('A06:independent-review-eligible-in-review-mode-before-any-verifier', ALL_NEW, mods => withVector('normative', repo => {
  const full = H.buildEvents(flow(mods, repo, 'normative').snapshot, repo, VECTORS.vectors.normative);
  const reviewOnly = Object.fromEntries(Object.entries(full).filter(([, event]) => event.kind === 'review'));
  const r = flow(mods, repo, 'normative', { mode: 'review', events: reviewOnly });
  if (!r.decision) throw new Error(`review mode produced no decision: ${r.codes.join(',')}`);
  if (r.decision.decision !== 'eligible') throw new Error(`review mode decision ${r.decision.decision}`);
  H.sameStable(sorted(r.decision.checkedMustIds), ['doc-change:quality-review'], 'checkedMustIds in review mode (current quality-review MUST)');
  H.sameStable(sorted(r.decision.expectedMustIds), sorted(VECTORS.vectors.normative.expectedMustIds), 'expectedMustIds keeps the full set');
}));

runner.run('A06:verification-stays-unresolved-with-review-only-evidence', ALL_NEW, mods => withVector('normative', repo => {
  const full = H.buildEvents(flow(mods, repo, 'normative').snapshot, repo, VECTORS.vectors.normative);
  const reviewOnly = Object.fromEntries(Object.entries(full).filter(([, event]) => event.kind === 'review'));
  const r = flow(mods, repo, 'normative', { events: reviewOnly });
  if (!r.decision) throw new Error(`no decision: ${r.codes.join(',')}`);
  if (r.decision.eligible) throw new Error('verification must not be eligible without execution evidence');
  H.expectCodes(H.codesOf(r.decision), ['result-missing'], 'missing execution evidence');
}));

runner.run('A06:later-accepted-execution-makes-verification-retry-eligible', ALL_NEW, mods => withVector('normative', repo => {
  const full = H.buildEvents(flow(mods, repo, 'normative').snapshot, repo, VECTORS.vectors.normative);
  const reviewOnly = Object.fromEntries(Object.entries(full).filter(([, event]) => event.kind === 'review'));
  const before = flow(mods, repo, 'normative', { events: reviewOnly });
  if (!before.decision || before.decision.eligible) throw new Error('review-only verification must stay unresolved before the retry');
  const retry = flow(mods, repo, 'normative', { events: full });
  requireEligible(retry, 'later accepted execution with the same review tuple');
}));

runner.run('A06:self-review-rejected-even-when-summary-claims-independence', ALL_NEW, mods => withVector('normative', repo => {
  const snapshot = flow(mods, repo, 'normative').snapshot;
  const events = H.buildEvents(snapshot, repo, VECTORS.vectors.normative);
  for (const event of Object.values(events)) {
    if (event.kind === 'review') {
      event.principalId = PRINCIPALS.author;
      event.summary = 'independently reviewed by a different principal: approve';
    }
  }
  const r = flow(mods, repo, 'normative', { events });
  if (r.decision && r.decision.eligible) throw new Error('self-review must not be eligible');
  H.expectCodes(r.codes, ['review-not-independent'], 'self-review with independence prose');
}));

runner.run('A06:unknown-independent-provenance-rejected', ALL_NEW, mods => withVector('normative', repo => {
  const snapshot = flow(mods, repo, 'normative').snapshot;
  const events = H.buildEvents(snapshot, repo, VECTORS.vectors.normative);
  for (const event of Object.values(events)) if (event.kind === 'review') event.independentOf = [];
  const r = flow(mods, repo, 'normative', { events });
  if (r.decision && r.decision.eligible) throw new Error('review with unknown independence must not be eligible');
  H.expectCodes(r.codes, ['review-not-independent'], 'review without independentOf provenance');
}));

// ---- A07: expected set is derived; omitted, subset and authored-step variants ----------------------------------

runner.run('A07:with-and-without-authored-doc-change-derive-the-same-musts', ALL_NEW, mods => withVector('normative', repo => {
  const withDocStep = flow(mods, repo, 'normative');
  requireEligible(withDocStep, 'with authored doc-change');
  const withoutDocStep = flow(mods, repo, 'normative', { producer: { task: { requirements: VECTORS.fixedTask.requirements.slice(1) } } });
  if (!withoutDocStep.decision) throw new Error(`without authored doc step produced no decision: ${withoutDocStep.codes.join(',')}`);
  H.sameStable(sorted(withoutDocStep.decision.expectedMustIds), sorted(withDocStep.decision.expectedMustIds), 'expectedMustIds with and without the authored doc step');
}));

for (const [id, omit] of [
  ['omit-one-result-quality-review', ref => ref.startsWith('ref-quality-review')],
  ['omit-all-results', () => true],
  ['subset-results-only-lint-and-link', ref => !ref.startsWith('ref-doc-lint') && !ref.startsWith('ref-link-check')]
]) {
  runner.run(`A07:${id}-loses-eligibility-even-when-returned-results-pass`, ALL_NEW, mods => withVector('normative', repo => {
    const full = H.buildEvents(flow(mods, repo, 'normative').snapshot, repo, VECTORS.vectors.normative);
    const kept = Object.fromEntries(Object.entries(full).filter(([ref]) => !omit(ref)));
    const r = flow(mods, repo, 'normative', { events: kept });
    if (r.decision && r.decision.eligible) throw new Error('an omitted MUST must not be eligible');
    H.expectCodes(r.codes, ['result-missing'], id);
  }));
}

// ---- A08: legacy snapshot, then governed scope with old tuple and old results --------------------------------------

runner.run('A08:previously-nondocument-snapshot-is-legacy-never-verified', ALL_NEW, mods => withVector('nondocument', repo => {
  const r = flow(mods, repo, 'nondocument');
  if (!r.decision) throw new Error(`legacy case produced no decision: ${r.codes.join(',')}`);
  H.sameStable(r.decision.decision, 'legacy', 'decision');
  if (r.decision.eligible !== false) throw new Error('legacy must never be eligible for verified credit');
  H.expectCodes(H.codesOf(r.decision), ['no-document-musts'], 'legacy diagnostic');
}));

runner.run('A08:new-governed-scope-rejects-old-legacy-tuple-and-produces-current-musts', ALL_NEW, mods => withVector('nondocument', repo => {
  const legacy = flow(mods, repo, 'nondocument');
  const oldIdentity = H.clone(legacy.snapshot.identity);
  // A08's own candidate: the revised asset from the nondocument run plus the new normative PRD.
  H.writeFiles(repo.root, { 'docs/prd/graph.md': VECTORS.vectors.a08.files.candidate['docs/prd/graph.md'] });
  const governed = flow(mods, repo, 'a08', { events: {} });
  if (!governed.snapshot) throw new Error(`governed capture not ready: ${governed.codes.join(',')}`);
  H.sameStable(sorted(governed.decision.expectedMustIds || []), sorted(VECTORS.vectors.a08.expectedMustIds), 'current MUSTs for the A08 snapshot');
  const events = H.buildEvents(governed.snapshot, repo, VECTORS.vectors.a08);
  for (const event of Object.values(events)) event.identity = H.clone(oldIdentity);
  const replay = flow(mods, repo, 'a08', { events });
  if (replay.decision && replay.decision.eligible) throw new Error('old legacy tuple must not satisfy governed MUSTs');
  H.expectCodes(replay.codes, ['identity-mismatch'], 'legacy tuple against governed snapshot');
}));

// ---- A12: origin provenance -------------------------------------------------------------------------------------

runner.run('A12:copied-journal-without-current-acceptance-rejected', ALL_NEW, mods => withVector('normative', repo => {
  const snapshot = flow(mods, repo, 'normative').snapshot;
  const events = H.buildEvents(snapshot, repo, VECTORS.vectors.normative);
  const execRef = Object.keys(events).find(ref => events[ref].kind === 'execution');
  events[execRef].trusted = true;
  events[execRef].originRef = 'copied-from-another-session';
  events['copied-journal-ref'] = { ...events[execRef] };
  delete events[execRef];
  events['copied-journal-ref'].__notIssued = true;
  const r = flow(mods, repo, 'normative', { events });
  if (r.decision && r.decision.eligible) throw new Error('copied journal must not be eligible');
  H.expectCodes(r.codes, ['origin-untrusted'], 'copied journal with forged trusted flag');
}));

runner.run('A12:missing-origin-yields-origin-unavailable', ALL_NEW, mods => withVector('normative', repo => {
  const r = flow(mods, repo, 'normative', { mode: 'missing' });
  if (r.decision && r.decision.eligible) throw new Error('missing origin must not be eligible');
  H.expectCodes(r.codes, ['origin-unavailable'], 'missing origin');
}));

runner.run('A12:expired-origin-yields-origin-unavailable', ALL_NEW, mods => withVector('normative', repo => {
  const r = flow(mods, repo, 'normative', { mode: 'expired' });
  if (r.decision && r.decision.eligible) throw new Error('expired origin must not be eligible');
  H.expectCodes(r.codes, ['origin-unavailable'], 'expired origin');
}));

// ---- A13: applicability matrix ----------------------------------------------------------------------------------

runner.run('A13:unknown-must-stays-unresolved', ALL_NEW, mods => withVector('code-only', repo => {
  const r = flow(mods, repo, 'code-only', { events: {} });
  if (!r.decision) throw new Error(`no decision: ${r.codes.join(',')}`);
  if (r.decision.eligible) throw new Error('an unknown MUST must not be eligible');
  H.expectCodes(H.codesOf(r.decision), ['unknown-applicability'], 'unknown MUST');
  if (r.decision.decision !== 'unresolved') throw new Error(`decision ${r.decision.decision} where unresolved is required`);
}));

runner.run('A13:na-without-trusted-derivation-reason-is-unresolved', ALL_NEW, mods => withVector('normative', repo => {
  const first = flow(mods, repo, 'normative');
  const tampered = H.clone(first.snapshot);
  if (!tampered.derivationReasons || !tampered.derivationReasons['doc-change:derived-regenerate']) {
    throw new Error('the snapshot lacks derivationReasons for the N/A MUST doc-change:derived-regenerate');
  }
  tampered.derivationReasons['doc-change:derived-regenerate'].reason = '';
  const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
  for (const [ref, event] of Object.entries(first.events)) origin.issueEvent(ref, event);
  const accepted = mods[EVENTS].acceptDocEvents({ snapshot: tampered, eventRefs: Object.keys(first.events) }, { originProvider: origin });
  const r = mods[CORE].checkAcceptedDocEvidence({ snapshot: tampered, accepted, mode: 'verification' });
  if (r.eligible) throw new Error('N/A without a trusted derivation reason must not be eligible');
  H.expectCodes(H.codesOf(r, accepted), ['na-reason-missing'], 'N/A without reason');
}));

runner.run('A13:should-outcome-never-gates-a-complete-normative-vector', ALL_NEW, mods => withVector('normative', repo => {
  const r = flow(mods, repo, 'normative');
  requireEligible(r, 'normative with SHOULD reminders present');
  const gating = H.codesOf(r.decision).filter(code => /should/i.test(code));
  H.sameStable(gating, [], 'SHOULD-related codes that gate');
}));

// ---- R2d P2b: rejected SHOULD / N/A evidence must gate nothing (PR #353 review P2) --------------------------------

runner.run('R2d-P2b:rejected-should-never-gates-a-complete-must-set', ALL_NEW, mods => withVector('normative', repo => {
  const base = flow(mods, repo, 'normative');
  requireEligible(base, 'complete normative base vector');
  const snapshot = base.snapshot;
  const should = snapshot.obligations.find(o => o.capability === 'prose-reminder');
  if (!should || should.strength !== 'SHOULD') throw new Error('the normative snapshot lacks the prose-reminder SHOULD obligation');
  const events = base.events;
  // A deliberately invalid event for the SHOULD capability: rejected, but with its obligationId kept visible.
  const smoke = { ...H.clone(events['ref-doc-lint']), eventId: 'evt-prose-reminder-smoke',
    capability: 'prose-reminder', paths: [...(should.scope?.paths || [])], exitCode: 1 };
  base.origin.issueEvent('ref-prose-reminder-smoke', smoke);
  const accepted2 = mods[EVENTS].acceptDocEvents({ snapshot, eventRefs: [...Object.keys(events), 'ref-prose-reminder-smoke'] },
    { originProvider: base.origin });
  if (!accepted2.rejected.find(item => item.code === 'event-invalid' && item.obligationId === should.id)) {
    throw new Error(`the rejected SHOULD event must keep its obligationId visible: ${JSON.stringify(accepted2.rejected)}`);
  }
  const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot, accepted: accepted2, mode: 'verification' });
  if (decision.decision !== 'eligible' || decision.eligible !== true) {
    throw new Error(`a rejected SHOULD (prose-reminder) must not gate a complete MUST set: decision ${decision.decision} with codes ${JSON.stringify(H.codesOf(accepted2, decision))}`);
  }
  if (decision.unsatisfied.some(item => item.obligationId === should.id)) {
    throw new Error('the rejected SHOULD produced an unsatisfied entry');
  }
}));

runner.run('R2d-P2b:rejected-na-obligation-event-never-gates-a-complete-must-set', ALL_NEW, mods => withVector('normative', repo => {
  const base = flow(mods, repo, 'normative');
  requireEligible(base, 'complete normative base vector');
  const snapshot = base.snapshot;
  const na = snapshot.obligations.find(o => o.id === 'doc-change:derived-regenerate');
  if (!na || na.strength !== 'MUST' || na.applicability !== 'N/A') throw new Error('the normative snapshot lacks the derived-regenerate N/A MUST');
  const events = base.events;
  const smoke = { ...H.clone(events['ref-doc-lint']), eventId: 'evt-derived-regenerate-smoke',
    capability: na.capability, paths: [...(na.scope?.paths || [])], exitCode: 1 };
  base.origin.issueEvent('ref-derived-regenerate-smoke', smoke);
  const accepted2 = mods[EVENTS].acceptDocEvents({ snapshot, eventRefs: [...Object.keys(events), 'ref-derived-regenerate-smoke'] },
    { originProvider: base.origin });
  if (!accepted2.rejected.find(item => item.code === 'event-invalid' && item.obligationId === na.id)) {
    throw new Error(`the rejected N/A event must keep its obligationId visible: ${JSON.stringify(accepted2.rejected)}`);
  }
  const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot, accepted: accepted2, mode: 'verification' });
  if (decision.decision !== 'eligible' || decision.eligible !== true) {
    throw new Error(`a rejected N/A obligation event must not gate a complete MUST set: decision ${decision.decision} with codes ${JSON.stringify(H.codesOf(accepted2, decision))}`);
  }
  if (decision.unsatisfied.some(item => item.obligationId === na.id)) {
    throw new Error('the rejected N/A event produced an unsatisfied entry');
  }
}));

runner.run('R2d-P2b:rejected-applicable-must-still-blocks-eligibility', ALL_NEW, mods => withVector('normative', repo => {
  // Control: a rejected event for an expected applicable MUST keeps gating (now and after the P2 fix).
  const base = flow(mods, repo, 'normative');
  requireEligible(base, 'complete normative base vector');
  const events = base.events;
  const key = Object.keys(events['ref-doc-lint'].artifactDigests)[0];
  events['ref-doc-lint'].artifactDigests[key] = H.ZERO_DIGEST;
  const r = flow(mods, repo, 'normative', { events });
  if (r.decision && r.decision.eligible) throw new Error('a rejected applicable MUST event must still block eligibility');
  H.expectCodes(r.codes, ['artifact-mismatch'], 'rejected applicable MUST event');
}));

// ---- PR #353 third pass: the event-acceptance boundary revalidates the concrete start pin ------------------------

function acceptAfterContextChange(mods, repo, change) {
  const base = flow(mods, repo, 'normative');
  requireEligible(base, 'complete normative base vector');
  change(base.origin.context);
  const accepted = mods[EVENTS].acceptDocEvents({ snapshot: base.snapshot, eventRefs: Object.keys(base.events) }, { originProvider: base.origin });
  const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot: base.snapshot, accepted, mode: 'verification' });
  return { accepted, decision };
}

runner.run('R2e-P1:changed-provider-pin-commit-rejected-at-event-acceptance', ALL_NEW, mods => withVector('normative', repo => {
  // Same baselineReference, originRef, session, task and workflow; only the concrete pin commit changes.
  const { accepted, decision } = acceptAfterContextChange(mods, repo, context => { context.baseline = { ...context.baseline, commit: 'b'.repeat(40) }; });
  if (decision.eligible) throw new Error('a provider pin changed after capture must not leave prior events eligible');
  H.expectCodes(H.codesOf(accepted, decision), ['identity-mismatch', 'baseline-unavailable'], 'changed provider pin commit');
}));

runner.run('R2e-P1:changed-provider-pin-root-rejected-at-event-acceptance', ALL_NEW, mods => withVector('normative', repo => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-s2a-other-root-'));
  try {
    const { accepted, decision } = acceptAfterContextChange(mods, repo, context => { context.baseline = { ...context.baseline, root: other }; });
    if (decision.eligible) throw new Error('a provider pin root changed after capture must not leave prior events eligible');
    H.expectCodes(H.codesOf(accepted, decision), ['identity-mismatch', 'baseline-unavailable'], 'changed provider pin root');
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
}));

runner.run('R2e-P1:unchanged-provider-context-stays-eligible-control', ALL_NEW, mods => withVector('normative', repo => {
  const { decision } = acceptAfterContextChange(mods, repo, () => {});
  if (!decision.eligible) throw new Error(`an unchanged provider context must stay eligible: ${JSON.stringify(decision.unsatisfied)}`);
}));

// ---- A14: stable captures, capture boundary and status-only progress --------------------------------------------

runner.run('A14:unchanged-repository-captures-identically', ALL_NEW, mods => withVector('normative', repo => {
  const first = flow(mods, repo, 'normative');
  const second = flow(mods, repo, 'normative');
  H.sameStable(second.snapshot && second.snapshot.identity, first.snapshot && first.snapshot.identity, 'identity across two captures');
  H.sameStable(second.snapshot && second.snapshot.obligations, first.snapshot && first.snapshot.obligations, 'obligations across two captures');
}));

runner.run('A14:context-advancing-during-capture-rejected-as-snapshot-changed', ALL_NEW, mods => withVector('normative', repo => {
  const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
  origin.contextAt = call => (call > 1 ? H.fakeContext({ taskId: 'task-s2a-002' }, repo) : H.fakeContext({}, repo));
  const produced = mods[PRODUCER].produceDocSnapshot(H.producerInput(repo), { originProvider: origin });
  if (produced.snapshot) throw new Error('a context that advances during capture must not yield a usable snapshot');
  H.expectCodes(H.codesOf(produced), ['snapshot-changed'], 'before/after context disagreement');
}));

runner.run('A14:status-only-workflow-progress-does-not-stale-the-task-scope', ALL_NEW, mods => withVector('normative', repo => {
  const before = flow(mods, repo, 'normative');
  const progressed = H.clone(VECTORS.fixedTask);
  for (const requirement of progressed.requirements) {
    requirement.status = 'pass';
    requirement.evidence = 'progress note';
    requirement.updatedAt = '2026-02-01T00:00:00Z';
  }
  const after = flow(mods, repo, 'normative', { producer: { task: { requirements: progressed.requirements } } });
  if (!after.snapshot) throw new Error(`progressed capture not ready: ${after.codes.join(',')}`);
  H.sameStable(after.snapshot.identity.taskScopeDigest, before.snapshot.identity.taskScopeDigest, 'taskScopeDigest with status-only progress');
  H.sameStable(after.snapshot.identity.candidateDigest, before.snapshot.identity.candidateDigest, 'candidateDigest with status-only progress');
}));

// ---- Single-field flips from one eligible vector -----------------------------------------------------------------

function mutateEvents(mutator, events, ctx) {
  const refs = Object.keys(events);
  const execRef = refs.find(ref => events[ref].kind === 'execution' && events[ref].capability === 'doc-lint');
  const reviewRef = refs.find(ref => events[ref].kind === 'review');
  const firstExec = () => events[execRef];
  const firstReview = () => events[reviewRef];
  if (mutator.startsWith('identityField:')) {
    const field = mutator.slice('identityField:'.length);
    for (const event of Object.values(events)) {
      const value = event.identity[field];
      if (field === 'workflowRevision') event.identity[field] = value + 1;
      else if (field === 'prdRoot') event.identity[field] = 'docs/other/';
      else event.identity[field] = `${value}-mutated`;
    }
    return events;
  }
  switch (mutator) {
    case 'prdSetDigestAsCandidate':
      for (const event of Object.values(events)) event.identity.candidateDigest = H.prdSetDigest(ctx.repo.root);
      return events;
    case 'reviewerIsAuthor': firstReview().principalId = PRINCIPALS.author; return events;
    case 'reviewerIsExecutor': firstReview().principalId = PRINCIPALS.executor; return events;
    case 'independentOfMissing': firstReview().independentOf = []; return events;
    case 'exitNull': firstExec().exitCode = null; return events;
    case 'exitString': firstExec().exitCode = '0'; return events;
    case 'exitNonzero': firstExec().exitCode = 1; return events;
    case 'signalSet': firstExec().signal = 'SIGTERM'; return events;
    case 'capabilityUnrelated': firstExec().command = 'npm test'; return events;
    case 'pathsNarrowed': firstExec().paths = []; return events;
    case 'artifactDigestWrong': {
      const key = Object.keys(firstExec().artifactDigests)[0];
      firstExec().artifactDigests[key] = ZERO_DIGEST;
      return events;
    }
    case 'verdictReject': firstReview().verdict = 'reject'; return events;
    case 'summaryEmpty': firstReview().summary = ''; return events;
    case 'eventDuplicated': events['ref-duplicate'] = { ...firstExec() }; return events;
    case 'eventConflicting': events['ref-conflict'] = { ...firstExec(), eventId: 'evt-doc-lint-conflict', exitCode: 1 }; return events;
    case 'providerStale': firstReview().providerStatus = 'stale'; return events;
    case 'journalCopied': {
      const copy = { ...firstExec(), originRef: 'copied-from-another-session', trusted: true };
      delete events[execRef];
      events['copied-journal-ref'] = { ...copy, __notIssued: true };
      return events;
    }
    case 'omitOneMust': {
      for (const ref of refs) if (events[ref].capability === 'quality-review') delete events[ref];
      return events;
    }
    default:
      throw new H.InfraError(`unknown event mutator ${mutator}`);
  }
}

function applyRecapture(mutator, repo, state) {
  switch (mutator) {
    case 'recapture:taskId':
      state.producer = { task: { taskId: 'task-s2a-002' } };
      state.context = { taskId: 'task-s2a-002' };
      return;
    case 'recapture:requirementsNarrowed':
      state.producer = { task: { requirements: [VECTORS.fixedTask.requirements[0]] } };
      return;
    case 'recapture:acceptanceChanged': {
      const requirements = H.clone(VECTORS.fixedTask.requirements);
      requirements[0].acceptance = `${requirements[0].acceptance} (changed)`;
      state.producer = { task: { requirements } };
      return;
    }
    case 'recapture:bindingChanged': {
      const requirements = H.clone(VECTORS.fixedTask.requirements);
      requirements[1].bindings = [];
      state.producer = { task: { requirements } };
      return;
    }
    case 'recapture:workflowRevision':
      state.producer = { workflow: { workflowRevision: VECTORS.fixedWorkflow.workflowRevision + 1 } };
      state.context = { workflowRevision: VECTORS.fixedWorkflow.workflowRevision + 1 };
      return;
    case 'recapture:configBytesReformatted':
      fs.writeFileSync(path.join(repo.root, H.CONFIG_REL), JSON.stringify(H.DERIVE_CONFIG, null, 4) + '\n', 'utf8');
      return;
    case 'recapture:activeHostChanged':
      state.producer = { top: { activeHost: { hostId: 'other-host' } } };
      state.context = { activeHost: { hostId: 'other-host' } };
      return;
    case 'recapture:otherTreeBytes':
      fs.writeFileSync(path.join(repo.root, 'docs/prd/graph.md'), H.readTree(path.join(H.ROOT, 'ci/fixtures/doc-obligations/derive/docs-only/candidate'))['docs/reference/guide.md'], 'utf8');
      return;
    case 'recapture:emptyFileDeleted':
      fs.rmSync(path.join(repo.root, 'assets/extra.txt'), { force: true });
      return;
    case 'recapture:modeDrift':
      if (process.platform === 'win32') throw new H.UncheckedError('win32: no POSIX execute bit (core.fileMode=false), mode drift is not observable');
      fs.chmodSync(path.join(repo.root, 'docs/prd/graph.md'), 0o755);
      return;
    default:
      throw new H.InfraError(`unknown recapture mutator ${mutator}`);
  }
}

for (const flip of VECTORS.flips) {
  runner.run(`flip:${flip.id}`, ALL_NEW, mods => {
    const setup = flip.setup === 'emptyExtra' ? 'emptyExtra' : null;
    const files = H.vectorFiles('normative');
    if (setup === 'emptyExtra') {
      files.base['assets/extra.txt'] = 'extra asset with content\n';
      files.candidate['assets/extra.txt'] = '';
    }
    const repo = H.makeRepo(files.base);
    try {
      H.writeFiles(repo.root, files.candidate);
      const requireBase = (result, label) => requireEligible(result, label);
      if (flip.kind === 'event' || flip.kind === 'core') {
        const base = flow(mods, repo, 'normative');
        requireBase(base, 'eligible base vector');
        if (flip.kind === 'core') {
          const dup = base.decision.results.concat([base.decision.results[0]]);
          const r = mods[CORE].reconcileDocResults({ snapshot: base.snapshot, accepted: base.accepted, checkerOutput: { results: dup, diagnostics: [] }, mode: 'verification' });
          if (r.eligible) throw new Error('a duplicated checker result must not be eligible');
          H.expectCodes(H.codesOf(r), flip.expect, flip.id);
          return;
        }
        const events = H.buildEvents(base.snapshot, repo, VECTORS.vectors.normative);
        const mutated = mutateEvents(flip.mutator, events, { repo });
        const r = flow(mods, repo, 'normative', { events: mutated });
        if (r.decision && r.decision.eligible) throw new Error(`flip ${flip.id} remained eligible`);
        H.expectCodes(r.codes, flip.expect, flip.id);
        return;
      }
      if (flip.kind === 'origin') {
        const r = flow(mods, repo, 'normative', { mode: flip.mutator === 'originMissing' ? 'missing' : 'expired' });
        if (r.decision && r.decision.eligible) throw new Error(`flip ${flip.id} remained eligible`);
        H.expectCodes(r.codes, flip.expect, flip.id);
        return;
      }
      if (flip.kind === 'recapture') {
        const base = flow(mods, repo, 'normative');
        requireBase(base, 'eligible base vector');
        const oldEvents = base.events;
        const state = {};
        applyRecapture(flip.mutator, repo, state);
        const origin = base.origin;
        if (state.context) origin.context = { ...origin.context, ...state.context };
        const producerInputs = H.producerInput(repo, state.producer || {});
        const produced = mods[PRODUCER].produceDocSnapshot(producerInputs, { originProvider: origin });
        if (!produced.snapshot) { H.expectCodes(H.codesOf(produced), flip.expect, flip.id); return; }
        const accepted = mods[EVENTS].acceptDocEvents({ snapshot: produced.snapshot, eventRefs: Object.keys(oldEvents) }, { originProvider: origin });
        const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot: produced.snapshot, accepted, mode: 'verification' });
        if (decision.eligible) throw new Error(`flip ${flip.id} remained eligible after the producer re-captured`);
        H.expectCodes(H.codesOf(accepted, decision), flip.expect, flip.id);
        return;
      }
      throw new H.InfraError(`unknown flip kind ${flip.kind}`);
    } finally {
      H.removeRepo(repo.root);
    }
  });
}

// ---- Regression: the existing derive and checker APIs are unchanged on the fixed vectors ------------------------

for (const key of ['normative', 'nonnormative', 'code-only', 'nondocument']) {
  const pin = VECTORS.pins[key];
  runner.run(`regression:derive-and-checker-pins-${key}`, [REQ_DERIVE, REQ_CHECKER], (mods) => {
    const files = H.vectorFiles(key);
    const facts = mods[DERIVE].deriveDocFacts({ base: { files: files.base }, candidate: { files: files.candidate }, config: H.DERIVE_CONFIG });
    const obligations = mods[DERIVE].deriveDocObligations(facts.facts);
    const checker = mods[CHECKER].checkDocObligations({ obligations, artifacts: {}, baseline: {}, executionRecords: [], reviewRecords: [] });
    H.sameStable(H.sha256(H.stable(facts)), pin.deriveFactsSha256, 'deriveDocFacts output digest');
    H.sameStable(H.sha256(H.stable(obligations)), pin.deriveObligationsSha256, 'deriveDocObligations output digest');
    H.sameStable(H.sha256(H.stable(checker)), pin.checkerResultsSha256, 'checkDocObligations output digest');
  });
}

runner.run('regression:exported-signatures-unchanged', [REQ_DERIVE, REQ_CHECKER], (mods) => {
  H.sameStable(Object.keys(mods[DERIVE]).sort(), ['deriveDocFacts', 'deriveDocObligations'], 'doc-obligations exports');
  H.sameStable(Object.keys(mods[CHECKER]).sort(), ['checkDocObligations'], 'doc-evidence exports');
});

// ---- Purity: the core evaluation performs no file, process or network activity -----------------------------------

runner.run('purity:core-decisions-perform-no-io', ALL_NEW, (mods, leg) => withVector('normative', repo => {
  const r = flow(mods, repo, 'normative');
  requireEligible(r, 'purity base vector');
  const abs = path.join(leg.lib, CORE);
  const log = H.recordingIo(rec => {
    const core = H.freshModule(abs);
    core.checkAcceptedDocEvidence({ snapshot: r.snapshot, accepted: r.accepted, mode: 'verification' });
    core.checkAcceptedDocEvidence({ snapshot: r.snapshot, accepted: r.accepted, mode: 'review' });
    return rec;
  });
  H.sameStable(log.writes, [], 'file writes during core evaluation');
  H.sameStable(log.spawns, [], 'spawned commands during core evaluation');
  H.sameStable(log.net, [], 'network connects during core evaluation');
}));

// ---- Parity: the new modules are byte-identical across canonical and packaged copies ------------------------------

for (const file of [PRODUCER, EVENTS, CORE]) {
  runner.pair(`parity:${file}-byte-identical`, [{ where: 'lib', file }], () => {
    const source = H.sha256(fs.readFileSync(path.join(H.LEGS[0].lib, file)));
    const packaged = H.sha256(fs.readFileSync(path.join(H.LEGS[1].lib, file)));
    H.sameStable(source, packaged, `${file} sha256 (source vs packaged)`);
  });
}

runner.run('resolver:captured-export-and-copies-synchronized', [{ where: 'scripts', file: 'project-docs-resolver.js', exports: ['resolveDocsConfigCaptured'] }], (mods, leg) => {
  if (leg.name !== 'source') return;
  const canonical = H.sha256(fs.readFileSync(path.join(H.ROOT, 'harness-everything', 'scripts', 'project-docs-resolver.js')));
  for (const copy of ['to-spec/scripts/project-docs-resolver.js', 'multi-agent-workspace/scripts/project-docs-resolver.js']) {
    H.sameStable(H.sha256(fs.readFileSync(path.join(H.ROOT, copy))), canonical, `${copy} matches the canonical resolver`);
  }
});

const counts = runner.summary();
if (counts.INFRA > 0) {
  console.error('S2a core suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (counts.FAIL > 0) {
  console.error('S2a core suite: assertion FAIL present (expected on the RED base; GREEN must clear every FAIL).');
  process.exitCode = 1;
} else {
  console.log('S2a core suite: all assertions PASS.');
}

#!/usr/bin/env node
'use strict';

// #325 Phase 3b I2 (R2c-2): S2b wiring RED suite - real CLI/Stop surfaces, source AND packaged legs.
//
// Contract under test (docs/doc-workflow-reconciliation.md, S2b subsections "Workflow credit, review
// progression and freshness", "Exact S2b RED handoff and registry retirement", "Carry-over
// dispositions and non-vacuity" + A2 report section 4 strict rows + carryover.md N1-N4):
//
// 1. Positive credit path (gated). With declared test-origin capture records and the simulated
//    qualifying live-capture artifact (the doc's test injection is the explicitly fake qualification
//    object via dependency injection, never an environment switch or a caller trusted flag), a
//    doc-governed typed plan earns verification credit and Stop `satisfied` only when the current
//    chain produceDocSnapshot -> acceptDocEvents -> checkAcceptedDocEvidence credits every expected
//    applicable MUST. Without the live-capture/qualification artifact the S1 withholding stays.
// 2. Review progression. A self-authored review PASS is refused (exit 2) and Stop reports
//    step:req-review:pending; an independent host review is accepted before any verifier record; the
//    first verification attempt stays refused and a later verification retry with valid evidence
//    completes (P02e/P03/P05 progression consolidated in the wiring corpus).
// 3. A2 section 4 strict rows: task-scope substitution, omitted authored step/results, an old typed
//    PASS gaining governed scope, F3 commit+rename freshness, F5 git-failure diagnostics, F6
//    genuinely active Fable branch.
// 4. Carry-over N1-N4 dispositions: only acceptDocEvents output feeds the core (a caller-fabricated
//    accepted object never persists credit), producer final-context failures stay snapshot-changed,
//    candidate-side failures stay fail-closed no-credit, and mixed-invalid batches are rejected
//    conservatively and recover on a fresh retry.
// 5. Controls: OFF early-return plus legacy byte-equivalence (frozen golden), the committed P06/P07u/
//    P02d/P07-fable-staged control rows replay unchanged, both Stop surfaces exit 0, and pilot-only
//    behavior stays gated on an actual ON + supported host decision.
// 6. Registry retirement mapping. Every strict assertion name says which of the ten pending-red.json
//    registry entries it supersedes; the report table maps RED assertions to them.
//
// Declared test-origin seam (binding for GREEN): the wiring boundary threads the R2c-1 provider into
// the decision seam by a declared options field (options.originProvider) plus the explicitly fake
// qualification object `{ source: 'fake-test-fixture', faked: true, ... }`; a caller-fabricated
// accepted object must never be an alternative input surface (N1). Host events reach the runtime only as
// hookDeliver/hostRun actions in the corpus, which drive the real hook entries (F4-T1b replaced the
// declarative input.hostEvents). Production never reads prep-host-events and has no fixture trust switch.
// RETIRED assertions (F4-T1b) name the F4 case and entry that carry their live RED (see Part D).
//
// Statuses follow the mechanism-suite convention: CONTROL assertions must pass today and stay true at
// GREEN; RED assertions fail today for the stated missing-implementation reason and must pass at
// GREEN; INFRA (exit 2) means a harness crash - never qualified as RED. The suite exits 0 only when
// the plan matches exactly: every CONTROL passed and every RED failed for its registered reason.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const WIRING_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'wiring');
const PREP_CORPUS_FILE = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-prep', 'cases.json');
const LEGS = [
  { id: 'source', lib: path.join(ROOT, 'hooks', 'scripts', 'lib') },
  { id: 'packaged', lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib') },
];

const SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';

// Cells of the committed S1/S2 control corpus replayed unchanged (read-only) as preserved controls.
const COMMITTED_CONTROL_IDS = ['P06', 'P07u', 'P02d', 'P07-fable-staged'];

// Modes per wiring corpus case. `off` replays without the switch, `on` replays with it exactly 1.
const WIRING_MODES = {
  'W-off-legacy': ['off'],
  'W-credit-freshness': ['on'],
  'W-review-progression': ['on'],
  'W-ctrl-nondoc-on': ['on'],
  'W-strict-oldpass-governed': ['on'],
  'W-strict-f3-pin': ['on'],
  'W-strict-f5-gitdiag': ['off', 'on'],
};

// The plan: every replay-based assertion with its required status and, for RED, the stated
// missing-implementation reason and the registry entries it supersedes (packet item 6).
const RED_MISSING_WIRING = 'missing-implementation: the S2b wiring (host-origin provider chain through the workflow credit boundary) is not implemented; the S1 fail-closed refusal persists';
const PLAN = {
  'P06': { kind: 'committed' },
  'P07u': { kind: 'committed' },
  'P02d': { kind: 'committed' },
  'P07-fable-staged': { kind: 'committed' },
  'W-off-legacy': { kind: 'wiring', byMode: {
    off: [
      { id: 'w-off.route-exit', path: ['actions', 'route', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.start-exit', path: ['actions', 'start', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.review-pass-exit', path: ['actions', 'review-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.verify-bind-exit', path: ['actions', 'verify-bind', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL', note: 'legacy byte-equivalence behavior pin' },
      { id: 'w-off.stop-unresolved', path: ['actions', 'stop', 'state', 'workflow', 'unresolved'], operator: 'equals', expected: [], status: 'CONTROL' },
      { id: 'w-off.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-off.stop-generic-satisfied', path: ['actions', 'stop-generic', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL' },
      { id: 'w-off.pilot-null', path: ['pilot'], operator: 'equals', expected: null, status: 'CONTROL' },
      { id: 'w-off.pilot-report-origin', path: ['pilotReportOrigin'], operator: 'equals', expected: 'harness', status: 'CONTROL' },
      { id: 'w-off.no-baseline-captured', path: ['actions', 'stop', 'state', 'workflow', 'docReconciliationBaseline'], operator: 'absent', status: 'CONTROL', note: 'OFF early-return captures nothing' },
    ],
  } },
  'W-credit-freshness': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-credit.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL', note: 'authored doc-change advance keeps its existing allowance' },
      { id: 'w-credit.review-pass-exit', path: ['actions', 'review-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL', note: 'a declared independent review recipe is review-accepted' },
      // RETIRED (F4-T1b triage): the PRD-scope verification needs conflict-check, which F4 never credits, so it cannot go
      // GREEN in this scope. The body-only edit carries the same credit RED through real entries.
      { id: 'w-credit.verify-first-exit', path: ['actions', 'verify-first', 'exitCode'], operator: 'equals', expected: 0, status: 'RETIRED', supersededBy: { case: 'F4-POS-body-edit', entry: 'pos.verify-pass' }, supersedes: ['P05.on.stop-on-2-withheld'] },
      { id: 'w-credit.stop-on1-state', path: ['actions', 'stop-on-1', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'RETIRED', supersededBy: { case: 'F4-POS-body-edit', entry: 'pos.stop-satisfied' }, supersedes: ['P05.on.stop-on-3-withheld'] },
      { id: 'w-credit.stop-on1-exit', path: ['actions', 'stop-on-1', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL', note: 'both Stop surfaces exit 0 while withheld, too' },
      { id: 'w-credit.stop-on2-no-stale', path: ['actions', 'stop-on-2', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL', note: 'candidate mutation withholds stale credit' },
      { id: 'w-credit.stop-on2-exit', path: ['actions', 'stop-on-2', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-credit.stop-off-after-on', path: ['actions', 'stop-off', 'state', 'workflow', 'state'], operator: 'equals', expected: 'running', status: 'CONTROL', note: 'OFF stop reveals no pilot and stays withheld' },
      { id: 'w-credit.stop-on3-no-stale', path: ['actions', 'stop-on-3', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL', note: 'ON-OFF-ON sequence never re-credits stale content' },
      { id: 'w-credit.stop-on3-exit', path: ['actions', 'stop-on-3', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
    ],
  } },
  'W-review-progression': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-review.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-review.review-self-exit', path: ['actions', 'review-self', 'exitCode'], operator: 'equals', expected: 2, status: 'RED', reason: 'missing-implementation: review-mode refusals do not exist; a self-authored review PASS is still accepted (S1 recorded gap: self-review-pass-accepted)', supersedes: ['P02e.on.review-pass-exit'] },
      { id: 'w-review.stop-mid-state', path: ['actions', 'stop-mid', 'state', 'workflow', 'state'], operator: 'equals', expected: 'running', status: 'CONTROL' },
      { id: 'w-review.stop-mid-reviews-pending', path: ['actions', 'stop-mid', 'state', 'workflow', 'unresolved'], operator: 'includes', expected: 'step:req-review:pending', status: 'RED', reason: 'missing-implementation: the refused review step is not left pending; Stop reports the verifier tokens instead', supersedes: ['P02e.on.stop-reports'] },
      { id: 'w-review.review-retry-exit', path: ['actions', 'review-retry', 'exitCode'], operator: 'equals', expected: 0, status: 'RED', reason: 'missing-implementation: the self-authored review PASS is accepted and advances the workflow, so the independent retry is refused as not the active step; once review-self is refused (its own RED) the step stays active and the delivered independent review is accepted', note: 'a refused review keeps its step active, so the declared independent review retry is accepted before any verifier record' },
      { id: 'w-review.verify-bind-exit', path: ['actions', 'verify-bind', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-review.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 2, status: 'CONTROL', note: 'the first verification attempt stays refused (review-only evidence lacks execution records)' },
      // RETIRED (F4-T1b triage): verification and completion on the PRD scope need conflict-check, never credited under F4.
      { id: 'w-review.verify-retry-exit', path: ['actions', 'verify-retry', 'exitCode'], operator: 'equals', expected: 0, status: 'RETIRED', supersededBy: { case: 'F4-POS-body-edit', entry: 'pos.verify-pass' }, supersedes: ['P03.on.verify-retry-exit'] },
      { id: 'w-review.stop-state', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'RETIRED', supersededBy: { case: 'F4-POS-body-edit', entry: 'pos.stop-satisfied' }, note: 'completion follows the valid retry (same gap family as P05) without a superseded registry entry' },
      { id: 'w-review.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-review.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
    ],
  } },
  'W-ctrl-nondoc-on': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-nondoc.route-exit', path: ['actions', 'route', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.start-exit', path: ['actions', 'start', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.direct-execute-exit', path: ['actions', 'direct-execute', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.code-pass-exit', path: ['actions', 'code-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL', note: 'a complete non-document decision keeps its legacy satisfied state under ON' },
      { id: 'w-nondoc.stop-unresolved', path: ['actions', 'stop', 'state', 'workflow', 'unresolved'], operator: 'equals', expected: [], status: 'CONTROL' },
      { id: 'w-nondoc.stop-generic-satisfied', path: ['actions', 'stop-generic', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL' },
      { id: 'w-nondoc.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-nondoc.pilot-credit-false', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: false, status: 'CONTROL', note: 'no fabricated verified document credit' },
      { id: 'w-nondoc.pilot-non-document-scope', path: ['pilot', 'diagnostics'], operator: 'includes', expected: 'trusted-non-document-scope', status: 'CONTROL' },
    ],
  } },
  'W-strict-oldpass-governed': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-oldpass.stop-satisfied-state', path: ['actions', 'stop-satisfied', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL', note: 'the genuinely non-document decision reaches satisfied first' },
      { id: 'w-oldpass.add-governed-exit', path: ['actions', 'add-governed-adr', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-oldpass.stop-recheck-exit', path: ['actions', 'stop-recheck', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-oldpass.stop-recheck-revoked', path: ['actions', 'stop-recheck', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL', note: 'governed scope appearing mid-workflow revokes completion credit' },
      { id: 'w-oldpass.stop-recheck-verify-pending', path: ['actions', 'stop-recheck', 'state', 'workflow', 'unresolved'], operator: 'includes', expected: 'step:req-verify:pending', status: 'CONTROL' },
      { id: 'w-oldpass.pilot-credit-false', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: false, status: 'CONTROL' },
      { id: 'w-oldpass.derive-appears', path: ['pilot', 'expectedMustIds'], operator: 'notEquals', expected: [], status: 'CONTROL', note: 'the newly governed content is derived and visible; the wiring credit for it is the W-credit case' },
    ],
  } },
  'W-strict-f3-pin': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-f3.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f3.review-pass-exit', path: ['actions', 'review-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f3.verify-pass-refused', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 2, status: 'CONTROL', note: 'rename endpoints without execution evidence stay refused until the wired chain (W-credit) lands' },
      { id: 'w-f3.commit-mid-exit', path: ['actions', 'commit-mid', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f3.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f3.stop-not-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL' },
      { id: 'w-f3.derive-pinned-scope', path: ['pilot', 'expectedMustIds'], operator: 'notEquals', expected: [], status: 'CONTROL', note: 'scope keeps deriving from the pinned baseline and rename endpoints after the mid-workflow commit' },
    ],
  } },
  'W-strict-f5-gitdiag': { kind: 'wiring', byMode: {
    off: [
      { id: 'w-f5.off.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f5.off.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL', note: 'legacy path completes without git reads' },
      { id: 'w-f5.off.pilot-null', path: ['pilot'], operator: 'equals', expected: null, status: 'CONTROL' },
      { id: 'w-f5.off.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'CONTROL' },
    ],
    on: [
      { id: 'w-f5.on.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f5.on.verify-pass-refused', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 2, status: 'CONTROL', note: 'the assessment is refused, never crashed, when git itself is broken' },
      { id: 'w-f5.on.git-diagnosed', path: ['pilot', 'diagnostics'], operator: 'includes', expected: 'baseline-unavailable', status: 'CONTROL', note: 'F5: git failure produces the baseline-unavailable diagnostic surface' },
      { id: 'w-f5.on.pilot-credit-false', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: false, status: 'CONTROL' },
      { id: 'w-f5.on.stop-exit-0', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
      { id: 'w-f5.on.stop-not-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL' },
    ],
  } },
};

// Retired wiring assertions (F4-T1b triage): each names the F4 case and entry that carries its live RED.
const retiredEntries = [];
// In-process assertions retired by F4-T1b, with the F4 case and entry that carry their live RED.
const IN_PROCESS_SUPERSEDED = {
  'ip-wiring.credit-granted': { case: 'F4-POS-body-edit', entry: 'pos.pilot-credit' },
  'ip-wiring.step-accepted': { case: 'F4-POS-body-edit', entry: 'pos.verify-pass' },
};
const F4_CASES_FILE = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');
const F4_SUITE_FILE = path.join(__dirname, 'mechanism-325-f4-projections.test.js');
let passCount = 0;
let failedCount = 0;
let infraCount = 0;
let redCount = 0;
const evidence = [];

function record(status, id, detail) {
  const detailText = detail ? ` - ${detail}` : '';
  evidence.push({ id, status, detail: detailText.trim() });
  if (status === 'PASS') { passCount += 1; console.log(`   PASS ${id}${detailText ? ` - ${detail}` : ''}`); }
  else if (status === 'RED') { redCount += 1; console.log(`   RED  ${id}${detailText ? ` - ${detail}` : ''}`); }
  else if (status === 'FAIL') { failedCount += 1; console.log(`   FAIL ${id}${detailText ? ` - ${detail}` : ''}`); }
  else { infraCount += 1; console.log(`   INFRA ${id}${detailText ? ` - ${detail}` : ''}`); }
}

// ---- Part A: replay surfaces (both legs) --------------------------------------------------------

function replayWiringCorpus() {
  console.log('\n== Part A1: wiring corpus replays through the real CLI/Stop entry points ==');
  const corpus = fx.readCaseCorpus(path.join(WIRING_DIR, 'cases.json'));
  for (const item of corpus.cases) {
    for (const distribution of ['source', 'packaged']) {
      const plan = PLAN[item.id];
      for (const mode of WIRING_MODES[item.id] || ['off', 'on']) {
        let root = null;
        try {
          root = fx.replayCase(item, distribution, mode === 'off' ? {} : { pilot: '1' });
        } catch (error) {
          record('INFRA', `${item.id}.${mode}@${distribution}`, `replay crash: ${error.message}`);
          continue;
        }
        const faults = fx.infrastructureFaults(item, root, mode);
        if (faults.length) { record('INFRA', `${item.id}.${mode}@${distribution}`, faults.map(f => `${f.actionId}: ${f.message}`).join('; ')); continue; }
        const results = fx.evaluateAll(root, (plan.byMode[mode] || []).map(entry => ({ id: entry.id, path: entry.path, operator: entry.operator, expected: entry.expected })));
        results.forEach((result, index) => {
          const entry = plan.byMode[mode][index];
          if (entry.status === 'RETIRED') {
            // Not evaluated here: its behaviour is a live RED in the F4 corpus (see the retirement integrity check).
            retiredEntries.push({ id: `${entry.id}@${distribution}`, supersededBy: entry.supersededBy });
          } else if (entry.status === 'CONTROL') {
            record(result.pass ? 'PASS' : 'FAIL', `${entry.id}@${distribution}`, result.pass ? '' : `expected ${JSON.stringify(entry.expected)} at ${entry.path.join('.')}, got ${JSON.stringify(result.actual)}`);
          } else if (result.pass) {
            record('FAIL', `${entry.id}@${distribution}`, `RED assertion unexpectedly passed now (expected to fail for the stated missing-implementation reason)`);
          } else {
            record('RED', `${entry.id}@${distribution}`, `${entry.reason || (entry.supersedes ? `supersedes ${entry.supersedes.join(', ')}` : 'wiring progression contract')}: actual ${JSON.stringify(result.actual).slice(0, 120)}`);
          }
        });
        partACustomChecks(item, root, distribution);
      }
    }
  }
}

// Deterministic post-checks the replay engine cannot express (pin values inside the replay only).
function partACustomChecks(item, root, distribution) {
  if (item.id === 'W-strict-f3-pin') {
    const start = root.actions.start.state.workflow.docReconciliationBaseline;
    const stop = root.actions.stop.state.workflow.docReconciliationBaseline;
    const pinned = Boolean(start) && Boolean(stop) && JSON.stringify(start) === JSON.stringify(stop);
    record(pinned ? 'PASS' : 'FAIL', `w-f3.baseline-pinned@${distribution}`, pinned ? '' : `baseline at start ${JSON.stringify(start)} vs stop ${JSON.stringify(stop)}`);
  }
  if (item.id === 'W-strict-oldpass-governed') {
    const requirements = (root.actions['stop-recheck'].state.obligations || {}).requirements || [];
    const retained = requirements.some(step => step.id === 'req-code' && step.status === 'pass');
    record(retained ? 'PASS' : 'FAIL', `w-oldpass.history-retained@${distribution}`, retained ? '' : 'the earlier non-document PASS history was not retained after the governed scope appeared');
  }
}

function replayCommittedControls() {
  console.log('\n== Part A2: committed control corpus rows replay unchanged ==');
  const corpus = fx.readCaseCorpus(PREP_CORPUS_FILE);
  for (const id of COMMITTED_CONTROL_IDS) {
    const item = corpus.cases.find(k => k.id === id);
    if (!item) { record('INFRA', `${id}`, 'committed control case missing from the prep corpus'); continue; }
    for (const distribution of ['source', 'packaged']) {
      for (const mode of ['off', 'on']) {
        let root = null;
        try {
          root = fx.replayCase(item, distribution, mode === 'off' ? {} : { pilot: '1' });
        } catch (error) {
          record('INFRA', `${id}.${mode}@${distribution}`, `replay crash: ${error.message}`);
          continue;
        }
        const faults = fx.infrastructureFaults(item, root, mode);
        if (faults.length) { record('INFRA', `${id}.${mode}@${distribution}`, faults.map(f => `${f.actionId}: ${f.message}`).join('; ')); continue; }
        const assertions = (item.expectations && item.expectations[mode]) || [];
        const results = fx.evaluateAll(root, assertions);
        results.forEach(result => {
          record(result.pass ? 'PASS' : 'FAIL', `${id}.${result.id}@${distribution}`, result.pass ? '' : `expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual).slice(0, 160)}`);
        });
      }
    }
  }
}

// ---- Part B: OFF legacy byte-equivalence against the frozen golden -------------------------------

function legacyGolden() {
  console.log('\n== Part B: OFF legacy byte-equivalence (frozen golden) ==');
  let golden = null;
  try {
    golden = JSON.parse(fs.readFileSync(path.join(WIRING_DIR, 'legacy-off-golden.json'), 'utf8'));
  } catch (error) {
    record('INFRA', 'w-golden.load', `golden unreadable: ${error.message}`);
    return;
  }
  const corpus = fx.readCaseCorpus(path.join(WIRING_DIR, 'cases.json'));
  const item = corpus.cases.find(k => k.id === 'W-off-legacy');
  for (const distribution of ['source', 'packaged']) {
    let root = null;
    try {
      root = fx.replayCase(item, distribution, {});
    } catch (error) {
      record('INFRA', `w-golden.replay@${distribution}`, `replay crash: ${error.message}`);
      continue;
    }
    const actual = { workflow: fx.normalize((root.actions.stop.state || {}).workflow), obligations: fx.normalize((root.actions.stop.state || {}).obligations) };
    const expected = golden[distribution];
    const same = JSON.stringify(actual.workflow) === JSON.stringify(expected.workflow)
      && JSON.stringify(actual.obligations) === JSON.stringify(expected.obligations);
    record(same ? 'PASS' : 'FAIL', `w-golden.byte-equivalence@${distribution}`, same ? '' : 'the OFF replay diverged from the frozen legacy golden');
    record(root.actions['stop-generic'].exitCode === golden[distribution].stopGeneric.exitCode ? 'PASS' : 'FAIL', `w-golden.stop-generic-exit@${distribution}`);
  }
}

// ---- Part C: in-process chain and wiring seam (per leg) ------------------------------------------

function clearLegCache(lib) {
  const cached = new Map();
  for (const key of Object.keys(require.cache)) {
    if (key === lib || key.startsWith(lib + path.sep)) { cached.set(key, require.cache[key]); delete require.cache[key]; }
  }
  return cached;
}

function restoreLegCache(lib, cached) {
  for (const key of Object.keys(require.cache)) {
    if (key === lib || key.startsWith(lib + path.sep)) delete require.cache[key];
  }
  for (const [key, value] of cached) require.cache[key] = value;
}

const GOVERNED_ADR_CONFIG = JSON.stringify({ governed: [{ path: 'docs/adr/**', role: 'adr' }], domains: ['GRPH'] }, null, 2) + '\n';
const ADR_BASE = '# GRPH-001 Checkout retry\n\nStatus: accepted\n\nCheckout MUST retry once.\n';
const ADR_CANDIDATE = '# GRPH-001 Checkout retry\n\nStatus: accepted\n\nCheckout MUST retry twice.\n';
const REQUIREMENTS = JSON.stringify([
  { id: 'req-docs', stepType: 'doc-change', summary: 'Update the ADR text', acceptance: 'normative ADR text is reviewed' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the ADR change', acceptance: 'objective doc checks are recorded' },
]);

function git(cwd, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_AUTHOR_DATE = '2026-04-01T12:00:00Z';
  env.GIT_COMMITTER_DATE = '2026-04-01T12:00:00Z';
  return execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeFile(dir, relative, content) {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

// Builds one in-process scenario workspace: governed ADR diff, provisioned contract, pinned baseline.
function seedInProcessScenario(leg, dir, modules) {
  const { obligations, pilot } = modules;
  const plan = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
  const sessionDir = path.join(dir, 'session');
  fs.mkdirSync(sessionDir, { recursive: true });
  writeFile(dir, '.agents/harness-everything/project-docs.json', GOVERNED_ADR_CONFIG);
  writeFile(dir, 'docs/adr/GRPH-001.md', ADR_BASE);
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=harness-wiring', '-c', 'user.email=harness-wiring@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
  writeFile(dir, 'docs/adr/GRPH-001.md', ADR_CANDIDATE);
  const context = {
    sessionId: `s2b-wiring-${leg.id}`,
    sessionDir,
    root: dir,
    workflow: {
      workflowId: `wf-s2b-wiring-${leg.id}`,
      revision: 1,
      state: 'pending',
      strategy: 'iterative-single',
      workflowPlan: plan,
    },
  };
  obligations.initializePlanningContract(context, plan);
  obligations.recordPlanning(context, REQUIREMENTS, plan, 'iterative-single', 'two dependent requirements fit a bounded documentation loop');
  obligations.materializeExecutionObligations(context, plan);
  const loaded = obligations.loadObligationSet(context, plan);
  if (!loaded.set) throw new Error(`[${leg.id}] obligation contract seeding failed: ${loaded.error}`);
  pilot.captureBaseline(context);
  return { context, plan, set: loaded.set };
}

function countingProxy(inner) {
  return {
    contextCalls: 0,
    eventCalls: 0,
    resolveContext(request) { this.contextCalls += 1; return inner.resolveContext(request); },
    resolveEvent(request) { this.eventCalls += 1; return inner.resolveEvent(request); },
  };
}

function buildProvider(leg, modules, captureOverrides = {}) {
  const providerModule = modules.provider;
  return providerModule.createClaudeOriginProvider({
    hostId: 'claude-code',
    sessionId: `s2b-wiring-${leg.id}`,
    // The workflow-start pin is supplied by the caller at construction, as S2a contextFor requires.
    ...(captureOverrides.baseline ? { baseline: captureOverrides.baseline } : {}),
    workspaceRoot: captureOverrides.workspaceRoot || '/tmp/nothing',
    taskId: `task-s2b-wiring-${leg.id}`,
    workflowId: `wf-s2b-wiring-${leg.id}`,
    workflowRevision: 1,
    principals: { author: `s2b-wiring-${leg.id}`, executors: [] },
    captures: captureOverrides.captures || [],
    // The doc's ONLY test-injection mechanism: the explicitly fake qualification via DI.
    qualification: { source: 'fake-test-fixture', faked: true, ref: `wiring-${leg.id}`, toolUseIdPopulated: true, agentIdPopulated: true },
  });
}

function inProcessPart() {
  console.log('\n== Part C: in-process chain and wiring seam (per leg) ==');
  const pilotSwitch = process.env[SWITCH];
  for (const leg of LEGS) {
    // git reports the realpath of the toplevel (macOS: /private/var, not /var), and the producer compares against the
    // baseline root it is given, so the fixture root is canonicalised the same way the runtime records it (retro 3.4).
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `harness-s2bwiring-${leg.id}-`)));
    const cache = clearLegCache(leg.lib);
    try {
      process.env[SWITCH] = '1';
      const modules = {
        obligations: require(path.join(leg.lib, 'workflow-obligations.js')),
        pilot: require(path.join(leg.lib, 'doc-reconciliation-pilot.js')),
        producer: require(path.join(leg.lib, 'doc-reconciliation-producer.js')),
        events: require(path.join(leg.lib, 'doc-reconciliation-events.js')),
        core: require(path.join(leg.lib, 'doc-reconciliation-core.js')),
        provider: require(path.join(leg.lib, 'doc-reconciliation-provider.js')),
      };
      const seeded = seedInProcessScenario(leg, dir, modules);
      // -- Real Claude provider (faked qualification) drives the producer chain now already (S2a+provider
      //    modules are real); the wiring itself is the missing piece.
      const pin = { root: dir, commit: git(dir, ['rev-parse', 'HEAD']).trim() };
      const qualified = buildProvider(leg, modules, { workspaceRoot: dir, baseline: pin });
      let produceState = null;
      let produceDiag = '';
      try {
        const produced = modules.producer.produceDocSnapshot({
          workspaceRoot: dir,
          baseline: { root: dir, commit: git(dir, ['rev-parse', 'HEAD']).trim() },
          workflow: { workflowId: seeded.context.workflow.workflowId, workflowRevision: 1, sessionId: seeded.context.sessionId },
          task: { taskId: `task-s2b-wiring-${leg.id}`, requirements: JSON.parse(REQUIREMENTS) },
          scope: { prdRoot: 'docs/prd/' },
          activeHost: 'claude-code',
        }, { originProvider: qualified });
        produceState = produced.state;
        produceDiag = (produced.diagnostics || []).map(d => d.code).join(',');
      } catch (error) {
        record('INFRA', `ip-wiring.produce@${leg.id}`, error.message);
      }
      // RED: the production provider's resolved context carries only baselineReference, not the concrete workflow-start
      // pin that S2a contextFor requires (A3 section 1, source-traced), so produceDocSnapshot refuses with
      // baseline-unavailable. A ready snapshot here would be an unexpected pass.
      const producedReady = produceState === 'ready';
      record(producedReady ? 'FAIL' : 'RED', `ip-wiring.produce-ready@${leg.id}`, producedReady ? 'RED assertion unexpectedly passed now' : `missing-implementation: the provider does not bind the caller-supplied workflow-start pin (state ${produceState || 'none'}${produceDiag ? `, ${produceDiag}` : ''}); S2a contextFor refuses with baseline-unavailable`);
      // -- Wiring RED: the decision boundary must consume the declared DI provider chain.
      const proxy = countingProxy(qualified);
      let result = null;
      try {
        result = modules.pilot.assess(seeded.context, seeded.set, { originProvider: proxy });
      } catch (error) {
        record('INFRA', `ip-wiring.assess@${leg.id}`, `assess threw: ${error.message}`);
      }
      result = result || {};
      record(proxy.contextCalls >= 1 ? 'PASS' : 'RED', `ip-wiring.provider-chain-invoked@${leg.id}`, proxy.contextCalls >= 1 ? '' : 'the credit boundary never invoked the declared origin provider (assess ignores the wiring seam)');
      const expectedCredit = !result.withhold;
      // RETIRED (F4-T1b): this in-process chain delivers no host events, and its ADR edit is outside the first positive scope.
      if (expectedCredit) record('FAIL', `ip-wiring.credit-granted@${leg.id}`, 'RED assertion unexpectedly passed now');
      else retiredEntries.push({ id: `ip-wiring.credit-granted@${leg.id}`, supersededBy: IN_PROCESS_SUPERSEDED['ip-wiring.credit-granted'] });
      // -- N1 carry-over: a caller-fabricated accepted object must never become credit at the boundary.
      const proxyN1 = countingProxy(qualified);
      let resultN1 = null;
      try {
        resultN1 = modules.pilot.assess(seeded.context, seeded.set, { originProvider: proxyN1, injectedAccepted: { state: 'resolved', acceptedIndex: { forged: { artifactDigests: {} } }, diagnostics: [], rejected: [], checkerInputs: {} } });
      } catch (error) {
        record('INFRA', `ip-n1.assess@${leg.id}`, `assess threw: ${error.message}`);
      }
      resultN1 = resultN1 || {};
      record(resultN1.withhold ? 'PASS' : 'FAIL', `ip-n1.forged-accepted-not-credited@${leg.id}`, resultN1.withhold ? '' : 'a caller-fabricated accepted object leaked past the boundary');
      // -- Wiring RED: the step boundary consumes the same declared seam. The authored step and the
      //    verification binding are resolved first, so the refusal is exactly the pilot verification
      //    refusal that the wired chain must replace.
      try {
        modules.obligations.updateStep(seeded.context, 'req-docs', 'pass', { evidence: 'ADR text updated' });
      } catch (error) {
        record('INFRA', `ip-wiring.authored-pass@${leg.id}`, error.message);
      }
      try {
        modules.obligations.updateBinding(seeded.context, 'req-verify', 'verification-loop', 'loaded', { evidence: 'verification loop skill located' });
      } catch (error) {
        record('INFRA', `ip-wiring.binding@${leg.id}`, error.message);
      }
      let caught = null;
      try {
        modules.obligations.updateStep(seeded.context, 'req-verify', 'pass', { evidence: 'objective doc checks with current host-origin reconciliation', originProvider: proxy });
      } catch (error) {
        caught = error;
      }
      // RETIRED (F4-T1b): with no delivered evidence this step can only be refused, so it is covered by the F4 live RED.
      if (caught) retiredEntries.push({ id: `ip-wiring.step-accepted@${leg.id}`, supersededBy: IN_PROCESS_SUPERSEDED['ip-wiring.step-accepted'] });
      else record('FAIL', `ip-wiring.step-accepted@${leg.id}`, 'RED assertion unexpectedly passed now');
      inProcessChainProbes(leg, modules);
    } catch (error) {
      record('INFRA', `ip-scenario@${leg.id}`, error.message);
    } finally {
      if (pilotSwitch === undefined) delete process.env[SWITCH]; else process.env[SWITCH] = pilotSwitch;
      restoreLegCache(leg.lib, cache);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// S2a-preserved chain semantics over the real provider/adapter/core modules (carry-over N2/N3/N4 and
// the A2 strict rows that the wiring must not weaken). Each keeps its current behavior at RED and at
// GREEN; GREEN only changes who feeds them.
function inProcessChainProbes(leg, modules) {
  const H = require(path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2a', 'harness.js'));
  const repo = H.makeRepo(H.vectorFiles('normative').base);
  repo.root = fs.realpathSync(repo.root); // same canonical root the runtime records (see inProcessPart)
  try {
    H.writeFiles(repo.root, H.vectorFiles('normative').candidate);
    const vec = H.VECTORS.vectors.normative;
    // The fake origin binds the workflow-start pin, as the S2a producer suite does (contextFor requires it).
    const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
    const produced = modules.producer.produceDocSnapshot(H.producerInput(repo), { originProvider: origin });
    if (!produced.snapshot) { record('INFRA', `ip-chain.produce@${leg.id}`, H.codesOf(produced).join(',')); return; }
    const snapshot = produced.snapshot;
    record('PASS', `ip-chain.produce-ready@${leg.id}`, H.codesOf(produced).join(','));
    const events = H.buildEvents(snapshot, repo, vec);
    for (const [ref, event] of Object.entries(events)) origin.issueEvent(ref, event);
    const refs = Object.keys(events);
    const accepted = modules.events.acceptDocEvents({ snapshot, eventRefs: refs }, { originProvider: origin });
    record(accepted.state === 'ready' && Object.keys(accepted.acceptedIndex).length === refs.length ? 'PASS' : 'FAIL', `ip-chain.accepted-full@${leg.id}`, `state ${accepted.state}, index ${Object.keys(accepted.acceptedIndex).length}/${refs.length}`);
    const decision = modules.core.checkAcceptedDocEvidence({ snapshot, accepted, mode: 'verification' });
    record(decision.eligible === true ? 'PASS' : 'FAIL', `ip-chain.credit-full@${leg.id}`, H.codesOf(decision).join(',') || 'eligible');
    const subsetRefs = refs.filter(ref => events[ref].kind === 'review').concat(refs.filter(ref => events[ref].kind === 'execution').slice(0, 1));
    const acceptedSubset = modules.events.acceptDocEvents({ snapshot, eventRefs: subsetRefs }, { originProvider: origin });
    const decisionSubset = modules.core.checkAcceptedDocEvidence({ snapshot, accepted: acceptedSubset, mode: 'verification' });
    record(decisionSubset.eligible === false ? 'PASS' : 'FAIL', `ip-chain.subset-not-credited@${leg.id}`, H.codesOf(decisionSubset).join(','));
    // N4: a mixed batch is rejected conservatively and a fresh retry recovers.
    const mixedEvents = H.buildEvents(snapshot, repo, vec);
    const mixedRefs = refs.filter(ref => events[ref].kind === 'review');
    for (const [ref, event] of Object.entries(mixedEvents)) {
      if (event.kind !== 'execution') continue;
      event.artifactDigests = Object.fromEntries(Object.entries(event.artifactDigests).map(([p]) => [p, 'sha256:' + '0'.repeat(64)]));
      origin.issueEvent(`bad-${ref}`, event);
      mixedRefs.push(`bad-${ref}`);
    }
    const acceptedMixed = modules.events.acceptDocEvents({ snapshot, eventRefs: mixedRefs }, { originProvider: origin });
    const mixedRejected = (acceptedMixed.rejected || []).length >= 1 && acceptedMixed.state === 'unresolved';
    record(mixedRejected ? 'PASS' : 'FAIL', `ip-chain.mixed-batch-rejected@${leg.id}`, `state ${acceptedMixed.state}, rejected ${acceptedMixed.rejected.length}`);
    const acceptedRetry = modules.events.acceptDocEvents({ snapshot, eventRefs: refs }, { originProvider: origin });
    record(acceptedRetry.state === 'ready' && Object.keys(acceptedRetry.acceptedIndex).length === refs.length ? 'PASS' : 'FAIL', `ip-chain.fresh-retry-recovers@${leg.id}`);
    // N2: a final-context provider outage stays snapshot-changed.
    let calls = 0;
    const flaky = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
    flaky.resolveContext = function () {
      calls += 1;
      if (calls >= 2) throw new Error('transient final-context outage');
      return { status: 'accepted', context: H.clone(H.fakeContext({}, repo)), originRef: 'fake-origin:context' };
    };
    const producedFlaky = modules.producer.produceDocSnapshot(H.producerInput(repo), { originProvider: flaky });
    record(producedFlaky.state === 'unavailable' && H.codesOf(producedFlaky).includes('snapshot-changed') ? 'PASS' : 'FAIL', `ip-chain.final-outage-labeled@${leg.id}`, H.codesOf(producedFlaky).join(','));
    // N3: a candidate-side git attribute failure stays fail-closed with no credit.
    const guardedRepo = { root: path.join(fs.realpathSync(os.tmpdir()), `harness-s2battr-${leg.id}`), commit: null };
    fs.rmSync(guardedRepo.root, { recursive: true, force: true });
    H.writeFiles(guardedRepo.root, Object.assign({ '.gitattributes': '*.bin filter=metal\n' }, H.vectorFiles('normative').base));
    try {
      git(guardedRepo.root, ['init', '-q']);
      git(guardedRepo.root, ['add', '-A']);
      git(guardedRepo.root, ['-c', 'user.name=harness-wiring', '-c', 'user.email=harness-wiring@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
      guardedRepo.commit = git(guardedRepo.root, ['rev-parse', 'HEAD']).trim();
      H.writeFiles(guardedRepo.root, Object.assign({ '.gitattributes': '*.bin filter=metal\n' }, H.vectorFiles('normative').candidate, { 'assets/model.bin': 'BINARY-PLACEHOLDER' }));
      const producedGuarded = modules.producer.produceDocSnapshot(H.producerInput({ root: guardedRepo.root, commit: guardedRepo.commit }), { originProvider: origin });
      record(producedGuarded.state === 'unavailable' ? 'PASS' : 'FAIL', `ip-chain.candidate-failure-fail-closed@${leg.id}`, H.codesOf(producedGuarded).join(',') || 'unavailable');
    } finally {
      H.removeRepo(guardedRepo.root);
    }
  } finally {
    H.removeRepo(repo.root);
  }
}

// ---- Report -------------------------------------------------------------------------------------

// Every retired assertion must name an F4 case that exists and an entry the F4 suite really defines (CONTROL), so a
// retirement can never point at nothing.
function retirementIntegrity() {
  console.log('\n== Part D: retired wiring assertions map to live F4 REDs ==');
  const f4Ids = new Set(fx.readCaseCorpus(F4_CASES_FILE).cases.map(item => item.id));
  const f4Source = fs.readFileSync(F4_SUITE_FILE, 'utf8');
  const retired = [];
  for (const entry of Object.values(PLAN)) {
    for (const list of Object.values(entry.byMode || {})) {
      for (const assertion of list) if (assertion.status === 'RETIRED') retired.push({ id: assertion.id, supersededBy: assertion.supersededBy });
    }
  }
  for (const [id, supersededBy] of Object.entries(IN_PROCESS_SUPERSEDED)) retired.push({ id, supersededBy });
  for (const item of retired) {
    const { case: caseId, entry } = item.supersededBy;
    const ok = f4Ids.has(caseId) && f4Source.includes(`id: '${entry}'`);
    record(ok ? 'PASS' : 'FAIL', `retired.${item.id}->${caseId}:${entry}`, ok ? '' : 'superseding F4 case or entry is missing');
  }
  console.log(`retired assertions (superseded, each mapped to a live F4 RED): ${retired.length}`);
}

function main() {
  const started = Date.now();
  replayCommittedControls();
  replayWiringCorpus();
  legacyGolden();
  inProcessPart();
  retirementIntegrity();
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n== S2b wiring RED evidence ==');
  console.log(`controls passed: ${passCount}`);
  console.log(`RED assertions confirmed: ${redCount}`);
  console.log(`unexpected failures: ${failedCount}`);
  console.log(`infrastructure faults: ${infraCount}`);
  console.log(`duration: ${duration}s`);
  const supersedes = [];
  for (const entry of Object.values(PLAN)) {
    for (const list of Object.values(entry.byMode || {})) {
      for (const assertion of list) {
        if (assertion.supersedes) supersedes.push({ id: assertion.id, supersedes: assertion.supersedes });
      }
    }
  }
  for (const item of supersedes) console.log(`supersedes: ${item.id} -> ${item.supersedes.join(', ')}`);
  // Strict by default: a remaining RED is a failure, so the discovered suite cannot pass while the
  // wiring is unimplemented. `--expect-red` qualifies the RED plan instead (RED stage only).
  const expectRed = process.argv.includes('--expect-red');
  if (!expectRed) {
    if (infraCount === 0 && failedCount === 0 && redCount === 0) {
      console.log('\nSTATUS: GREEN (all assertions passed)');
      return 0;
    }
    console.log(`STATUS: NOT-GREEN (red ${redCount}, unexpected ${failedCount}, infra ${infraCount})`);
    return 1;
  }
  if (infraCount === 0 && failedCount === 0) {
    console.log('\nSTATUS: RED-PLAN-MATCHED (all controls passed, all RED assertions failed for their stated missing-implementation reasons)');
    return 0;
  }
  console.log('STATUS: RED-PLAN-MISMATCH');
  return 1;
}

process.exitCode = main();

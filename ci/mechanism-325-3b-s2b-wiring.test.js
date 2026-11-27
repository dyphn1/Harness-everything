#!/usr/bin/env node
'use strict';

// #325 Phase 3b S2b retained workflow controls, replayed through real source and packaged entry points.
// The live E1 credit/review rows, in-process pilot chain, and supersession gate were retired. This suite keeps
// the complete OFF golden, ordinary non-document workflow, retained strict-row controls, and committed controls.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const WIRING_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'wiring');
const PREP_CORPUS_FILE = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-prep', 'cases.json');
const LEGS = [
  { id: 'source', lib: path.join(ROOT, 'hooks', 'scripts', 'lib') },
  { id: 'packaged', lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib') },
];

// Applicable rows from the committed S1/S2 control corpus remain unchanged apart from the E1-only Fable pilot status.
const COMMITTED_CONTROL_IDS = ['P06', 'P07u', 'P02d', 'P07-fable-staged'];

const WIRING_MODES = {
  'W-off-legacy': ['off'],
  'W-ctrl-nondoc-on': ['on'],
  'W-strict-oldpass-governed': ['on'],
  'W-strict-f3-pin': ['on'],
  'W-strict-f5-gitdiag': ['off', 'on'],
};

const PLAN = {
  P06: { kind: 'committed' },
  P07u: { kind: 'committed' },
  P02d: { kind: 'committed' },
  'P07-fable-staged': { kind: 'committed' },
  'W-off-legacy': { kind: 'wiring', byMode: {
    off: [
      { id: 'w-off.route-exit', path: ['actions', 'route', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.start-exit', path: ['actions', 'start', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.review-pass-exit', path: ['actions', 'review-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.verify-bind-exit', path: ['actions', 'verify-bind', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-off.stop-unresolved', path: ['actions', 'stop', 'state', 'workflow', 'unresolved'], operator: 'equals', expected: [] },
      { id: 'w-off.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-off.stop-generic-satisfied', path: ['actions', 'stop-generic', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-off.pilot-null', path: ['pilot'], operator: 'equals', expected: null },
      { id: 'w-off.pilot-report-origin', path: ['pilotReportOrigin'], operator: 'equals', expected: 'harness' },
      { id: 'w-off.no-baseline-captured', path: ['actions', 'stop', 'state', 'workflow', 'docReconciliationBaseline'], operator: 'absent' },
    ],
  } },
  'W-ctrl-nondoc-on': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-nondoc.route-exit', path: ['actions', 'route', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-nondoc.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-nondoc.start-exit', path: ['actions', 'start', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-nondoc.direct-execute-exit', path: ['actions', 'direct-execute', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-nondoc.code-pass-exit', path: ['actions', 'code-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-nondoc.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-nondoc.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-nondoc.stop-unresolved', path: ['actions', 'stop', 'state', 'workflow', 'unresolved'], operator: 'equals', expected: [] },
      { id: 'w-nondoc.stop-generic-satisfied', path: ['actions', 'stop-generic', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-nondoc.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0 },
    ],
  } },
  'W-strict-oldpass-governed': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-oldpass.stop-satisfied-state', path: ['actions', 'stop-satisfied', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-oldpass.add-governed-exit', path: ['actions', 'add-governed-adr', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-oldpass.stop-recheck-exit', path: ['actions', 'stop-recheck', 'exitCode'], operator: 'equals', expected: 0 },
    ],
  } },
  'W-strict-f3-pin': { kind: 'wiring', byMode: {
    on: [
      { id: 'w-f3.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.review-pass-exit', path: ['actions', 'review-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.commit-mid-exit', path: ['actions', 'commit-mid', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0 },
    ],
  } },
  'W-strict-f5-gitdiag': { kind: 'wiring', byMode: {
    off: [
      { id: 'w-f5.off.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f5.off.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f5.off.pilot-null', path: ['pilot'], operator: 'equals', expected: null },
      { id: 'w-f5.off.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
    ],
    on: [
      { id: 'w-f5.on.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f5.on.stop-exit-0', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0 },
    ],
  } },
};

let passCount = 0;
let failedCount = 0;
let infraCount = 0;

function record(status, id, detail) {
  const detailText = detail ? ` - ${detail}` : '';
  if (status === 'PASS') { passCount += 1; console.log(`   PASS ${id}${detailText}`); }
  else if (status === 'FAIL') { failedCount += 1; console.log(`   FAIL ${id}${detailText}`); }
  else { infraCount += 1; console.log(`   INFRA ${id}${detailText}`); }
}

// ---- Part A: replay surfaces (both legs) --------------------------------------------------------

function replayWiringCorpus() {
  console.log('\n== Part A1: wiring corpus replays through the real CLI/Stop entry points ==');
  const corpus = fx.readCaseCorpus(path.join(WIRING_DIR, 'cases.json'));
  for (const item of corpus.cases) {
    for (const distribution of ['source', 'packaged']) {
      const plan = PLAN[item.id];
      if (!plan) { record('INFRA', `${item.id}@${distribution}`, 'wiring case has no retained-control plan'); continue; }
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
          record(result.pass ? 'PASS' : 'FAIL', `${entry.id}@${distribution}`, result.pass ? '' : `expected ${JSON.stringify(entry.expected)} at ${entry.path.join('.')}, got ${JSON.stringify(result.actual)}`);
        });
        partACustomChecks(item, root, distribution);
      }
    }
  }
}

// Deterministic post-checks the replay engine cannot express (pin values inside the replay only).
function partACustomChecks(item, root, distribution) {
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
        // The committed Fable pilot-status assertion is E1-only; keep its workflow and Stop controls.
        const assertions = ((item.expectations && item.expectations[mode]) || []).filter(assertion =>
          !(id === 'P07-fable-staged' && mode === 'on' && assertion.id === 'pilot-status-unavailable'));
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

function scrubTextPathControls() {
  const roots = { repo: '/private/tmp/harness', tmp: ['/private/tmp'] };
  const macosSkill = fx.scrubText('/private/tmp/harness/plugins/harness-everything/skills/verification-loop/SKILL.md', roots);
  const unrelatedPath = fx.scrubText('/private/tmp/unrelated/verification-loop/SKILL.md', roots);
  const ordinaryTmp = fx.scrubText('/tmp/unrelated/workflow-run.json', roots);
  record(macosSkill === '<skill:verification-loop>' ? 'PASS' : 'FAIL', 'w-scrub.macos-private-tmp-skill', macosSkill === '<skill:verification-loop>' ? '' : `expected <skill:verification-loop>, got ${macosSkill}`);
  record(unrelatedPath === '<tmp>' ? 'PASS' : 'FAIL', 'w-scrub.unrelated-private-tmp', unrelatedPath === '<tmp>' ? '' : `expected <tmp>, got ${unrelatedPath}`);
  record(ordinaryTmp === '<tmp>' ? 'PASS' : 'FAIL', 'w-scrub.ordinary-tmp', ordinaryTmp === '<tmp>' ? '' : `expected <tmp>, got ${ordinaryTmp}`);
}

function main() {
  const started = Date.now();
  scrubTextPathControls();
  replayCommittedControls();
  replayWiringCorpus();
  legacyGolden();
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n== S2b retained wiring controls ==');
  console.log(`controls passed: ${passCount}`);
  console.log(`unexpected failures: ${failedCount}`);
  console.log(`infrastructure faults: ${infraCount}`);
  console.log(`duration: ${duration}s`);
  if (infraCount === 0 && failedCount === 0) {
    console.log('\nSTATUS: GREEN (all retained controls passed)');
    return 0;
  }
  console.log(`STATUS: NOT-GREEN (unexpected ${failedCount}, infra ${infraCount})`);
  return 1;
}

process.exitCode = main();

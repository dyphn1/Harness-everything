#!/usr/bin/env node
'use strict';

// Issue #553 T2-W: surviving CLI, hook, and Stop workflow replay controls across source and packaged legs.
//
// Migrated from ci/mechanism-325-3b-s1.test.js and ci/mechanism-325-3b-s2b-wiring.test.js onto surviving
// fixtures under ci/fixtures/workflow-contract/. Every case replays through real source and packaged
// entry points (kernel-router, workflow-disposition, workflow-stop-gate, stop-gate, state-persist)
// with zero dependency on E1 reconciliation runtime modules.

const fs = require('fs');
const path = require('path');
const fx = require('./lib/doc-reconciliation-prep-fixtures');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'workflow-contract');
const WORKFLOW_CORPUS_FILE = path.join(FIXTURE_DIR, 'cases.json');
const WIRING_CORPUS_FILE = path.join(FIXTURE_DIR, 'wiring-cases.json');
const LEGACY_GOLDEN_FILE = path.join(FIXTURE_DIR, 'legacy-off-golden.json');

const LEGS = ['source', 'packaged'];
const S1_MODES = ['off', 'on'];
const ALLOWED_OPERATORS = new Set(['equals', 'notEquals', 'includes', 'absent']);
const S1_KINDS = new Set(['control', 'additional']);
const REQUIRED_CASE_FIELDS = ['id', 'family', 'description', 'topology', 'requirements', 'input', 'actions', 'expectations'];

const WIRING_MODES = {
  'W-off-legacy': ['off'],
  'W-ctrl-nondoc-on': ['on'],
  'W-strict-oldpass-governed': ['off'],
  'W-strict-f3-pin': ['off'],
  'W-strict-f5-gitdiag': ['off'],
};

const WIRING_PLAN = {
  'W-off-legacy': {
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
  },
  'W-ctrl-nondoc-on': {
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
  },
  'W-strict-oldpass-governed': {
    off: [
      { id: 'w-oldpass.stop-satisfied-state', path: ['actions', 'stop-satisfied', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-oldpass.add-governed-exit', path: ['actions', 'add-governed-adr', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-oldpass.stop-recheck-exit', path: ['actions', 'stop-recheck', 'exitCode'], operator: 'equals', expected: 0 },
    ],
  },
  'W-strict-f3-pin': {
    off: [
      { id: 'w-f3.doc-pass-exit', path: ['actions', 'doc-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.review-pass-exit', path: ['actions', 'review-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.commit-mid-exit', path: ['actions', 'commit-mid', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f3.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
      { id: 'w-f3.stop-unresolved', path: ['actions', 'stop', 'state', 'workflow', 'unresolved'], operator: 'equals', expected: [] },
    ],
  },
  'W-strict-f5-gitdiag': {
    off: [
      { id: 'w-f5.off.plan-exit', path: ['actions', 'plan', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f5.off.verify-pass-exit', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0 },
      { id: 'w-f5.off.pilot-null', path: ['pilot'], operator: 'equals', expected: null },
      { id: 'w-f5.off.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied' },
    ],
  },
};

let passed = 0;
let failed = 0;
let infra = 0;
const failures = [];
const infrastructure = [];

const show = value => (value === undefined ? 'undefined' : JSON.stringify(value));

function reasonFor(assertion, actual) {
  const last = assertion.path[assertion.path.length - 1];
  const label = ({
    exitCode: 'exit',
    state: 'state',
    unresolved: 'unresolved',
    pilotStatus: 'pilot status',
    pilotReportOrigin: 'pilot origin',
    pilot: 'pilot',
  })[last]
    || (assertion.path.includes('obligations') && last === 'status' ? 'obligation status' : null)
    || (assertion.path.includes('requirements') && last === 'status' ? 'step status' : null)
    || assertion.path.slice(-2).join('.');
  const absent = actual && typeof actual === 'object' && actual.kind === 'absent';
  if (assertion.operator === 'includes') {
    return absent ? `${label} absent where ${show(assertion.expected)} desired`
      : `${label} ${show(actual)} lacks ${show(assertion.expected)}`;
  }
  if (assertion.operator === 'notEquals') return `${label} ${show(actual)} where a value other than ${show(assertion.expected)} desired`;
  if (assertion.operator === 'absent') return `${label} present where absent desired`;
  if (absent) return `${label} absent where ${show(assertion.expected)} desired`;
  return `${label} ${show(actual)} where ${show(assertion.expected)} desired`;
}

function record(status, id, detail) {
  if (status === 'PASS') passed += 1;
  else if (status === 'FAIL') { failed += 1; failures.push(id); }
  else { infra += 1; infrastructure.push(id); }
  console.log(`  ${status} ${id}${detail ? ` — ${detail}` : ''}`);
}

function comparable(root) {
  const entries = Object.entries(root.actions).map(([id, action]) => [id, {
    exitCode: action.exitCode,
    signal: action.signal,
    stdout: action.json === null ? action.stdout : null,
    json: action.json,
    stderr: action.stderr,
    state: action.state,
  }]);
  return fx.normalize(Object.fromEntries([...entries, ['$final', root.state]]));
}

function checkInventory(corpus) {
  const problems = [];
  const caseIds = corpus.cases.map(item => item.id);
  if (new Set(caseIds).size !== caseIds.length) problems.push('case ids are not unique');
  for (const item of corpus.cases) {
    for (const field of REQUIRED_CASE_FIELDS) {
      if (item[field] === undefined) problems.push(`${item.id} lacks ${field}`);
    }
    const actionIds = item.actions.map(action => action.id);
    if (new Set(actionIds).size !== actionIds.length) problems.push(`${item.id} action ids are not unique`);
    for (const action of item.actions) {
      if (!fx.ALL_OPS.has(action.op)) problems.push(`${item.id}.${action.id} op ${action.op} is not allowed`);
      for (const mode of S1_MODES) {
        try { fx.exitPolicy(action, mode); } catch (error) { problems.push(error.message); }
      }
    }
    for (const mode of S1_MODES) {
      const ids = item.expectations[mode].map(assertion => assertion.id);
      if (new Set(ids).size !== ids.length) problems.push(`${item.id}.${mode} assertion ids are not unique`);
      for (const assertion of item.expectations[mode]) {
        if (!ALLOWED_OPERATORS.has(assertion.operator)) problems.push(`${item.id}.${assertion.id} operator ${assertion.operator}`);
        if (!Array.isArray(assertion.path) || assertion.path.length === 0) problems.push(`${item.id}.${assertion.id} has no path`);
        if (!S1_KINDS.has(assertion.s1Kind)) problems.push(`${item.id}.${assertion.id} lacks a valid s1Kind`);
      }
    }
  }
  if (problems.length) record('FAIL', 'inventory: workflow-contract corpus rows are well formed', problems.join('; '));
  else record('PASS', 'inventory: workflow-contract corpus rows are well formed');
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

function replayWorkflowCorpus(corpus) {
  console.log('\n== Part 1: workflow-contract CLI/Stop controls (both legs, parity) ==');
  for (const item of corpus.cases) {
    for (const mode of S1_MODES) {
      const roots = {};
      for (const leg of LEGS) {
        let root;
        try {
          root = fx.scrubReplay(fx.replayCase(item, leg, mode === 'on' ? { pilot: '1' } : undefined));
        } catch (error) {
          record('INFRA', `${item.id}.${mode} [${leg}]`, `replay failed: ${error.message.split('\n')[0]}`);
          continue;
        }
        roots[leg] = root;
        const faults = fx.infrastructureFaults(item, root, mode);
        if (faults.length) {
          record('INFRA', `${item.id}.${mode} [${leg}]`, faults.map(f => `${f.actionId}: ${f.message}`).join('; '));
          continue;
        }
        for (const assertion of item.expectations[mode]) {
          const result = fx.evaluateAssertion(root, assertion);
          const id = `${item.id}.${mode}.${assertion.id} [${leg}]`;
          const tag = `(${assertion.s1Kind})`;
          if (result.pass) record('PASS', id, tag);
          else record('FAIL', id, `${tag} ${reasonFor(assertion, result.actual)}`);
        }
      }
      if (roots.source && roots.packaged && !fx.infrastructureFaults(item, roots.source, mode).length
        && !fx.infrastructureFaults(item, roots.packaged, mode).length) {
        const same = JSON.stringify(comparable(roots.source)) === JSON.stringify(comparable(roots.packaged));
        record(same ? 'PASS' : 'FAIL', `${item.id}.${mode}.parity [source=packaged]`, same ? '(control)' : '(control) source and packaged legs disagree');
      }
    }
  }
}

function wiringCustomChecks(item, root, leg) {
  if (item.id === 'W-strict-oldpass-governed') {
    const requirements = (root.actions['stop-recheck'].state.obligations || {}).requirements || [];
    const retained = requirements.some(step => step.id === 'req-code' && step.status === 'pass');
    record(retained ? 'PASS' : 'FAIL', `w-oldpass.history-retained@${leg}`, retained ? '' : 'earlier non-document PASS history was not retained after post-satisfaction edit');
  }
}

function replayWiringCorpus(wiringCorpus) {
  console.log('\n== Part 2: wiring workflow controls (both legs, parity) ==');
  let offLegacyRoots = null;
  for (const item of wiringCorpus.cases) {
    const planByMode = WIRING_PLAN[item.id];
    if (!planByMode) {
      record('INFRA', item.id, 'wiring case has no retained-control plan');
      continue;
    }
    for (const mode of WIRING_MODES[item.id] || ['off']) {
      const roots = {};
      for (const leg of LEGS) {
        let root;
        try {
          root = fx.replayCase(item, leg, mode === 'off' ? {} : { pilot: '1' });
        } catch (error) {
          record('INFRA', `${item.id}.${mode}@${leg}`, `replay crash: ${error.message}`);
          continue;
        }
        roots[leg] = root;
        const faults = fx.infrastructureFaults(item, root, mode);
        if (faults.length) {
          record('INFRA', `${item.id}.${mode}@${leg}`, faults.map(f => `${f.actionId}: ${f.message}`).join('; '));
          continue;
        }
        const assertions = planByMode[mode] || [];
        const results = fx.evaluateAll(root, assertions);
        results.forEach((result, index) => {
          const entry = assertions[index];
          record(result.pass ? 'PASS' : 'FAIL', `${entry.id}@${leg}`, result.pass ? '' : `expected ${JSON.stringify(entry.expected)} at ${entry.path.join('.')}, got ${JSON.stringify(result.actual)}`);
        });
        wiringCustomChecks(item, root, leg);
      }
      if (roots.source && roots.packaged && !fx.infrastructureFaults(item, roots.source, mode).length
        && !fx.infrastructureFaults(item, roots.packaged, mode).length) {
        const same = JSON.stringify(comparable(fx.scrubReplay(roots.source))) === JSON.stringify(comparable(fx.scrubReplay(roots.packaged)));
        record(same ? 'PASS' : 'FAIL', `${item.id}.${mode}.parity [source=packaged]`, same ? '(control)' : '(control) source and packaged legs disagree');
      }
      if (item.id === 'W-off-legacy' && mode === 'off') offLegacyRoots = roots;
    }
  }
  return offLegacyRoots;
}

function verifyLegacyGolden(offLegacyRoots) {
  console.log('\n== Part 3: W-off-legacy two-leg byte-equivalence (frozen golden) ==');
  let golden;
  try {
    golden = JSON.parse(fs.readFileSync(LEGACY_GOLDEN_FILE, 'utf8'));
  } catch (error) {
    record('INFRA', 'w-golden.load', `golden unreadable: ${error.message}`);
    return;
  }
  for (const leg of LEGS) {
    const root = offLegacyRoots && offLegacyRoots[leg];
    if (!root) {
      record('INFRA', `w-golden.replay@${leg}`, 'W-off-legacy replay result unavailable');
      continue;
    }
    const actual = {
      workflow: fx.normalize((root.actions.stop.state || {}).workflow),
      obligations: fx.normalize((root.actions.stop.state || {}).obligations),
    };
    const expected = golden[leg];
    const same = JSON.stringify(actual.workflow) === JSON.stringify(expected.workflow)
      && JSON.stringify(actual.obligations) === JSON.stringify(expected.obligations);
    record(same ? 'PASS' : 'FAIL', `w-golden.byte-equivalence@${leg}`, same ? '' : 'OFF replay diverged from the frozen legacy golden');
    record(root.actions['stop-generic'].exitCode === expected.stopGeneric.exitCode ? 'PASS' : 'FAIL', `w-golden.stop-generic-exit@${leg}`);
  }
}

console.log('=== Issue #553 T2-W: workflow-contract replay suite ===');
const workflowCorpus = fx.readCaseCorpus(WORKFLOW_CORPUS_FILE);
const wiringCorpus = fx.readCaseCorpus(WIRING_CORPUS_FILE);

checkInventory(workflowCorpus);
scrubTextPathControls();
replayWorkflowCorpus(workflowCorpus);
const offLegacyRoots = replayWiringCorpus(wiringCorpus);
verifyLegacyGolden(offLegacyRoots);

console.log(`\nWorkflow replay summary: ${passed} PASS, ${failed} FAIL, ${infra} INFRA across ${workflowCorpus.cases.length} S1 + ${wiringCorpus.cases.length} wiring cases`);
if (failures.length) console.log(`FAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}`);
if (infrastructure.length) console.log(`INFRASTRUCTURE (${infrastructure.length}):\n  ${infrastructure.join('\n  ')}`);

if (infra > 0) {
  console.error('Workflow replay suite: infrastructure faults present.');
  process.exitCode = 2;
} else if (failed > 0) {
  console.error('Workflow replay suite: assertion FAIL present.');
  process.exitCode = 1;
} else {
  console.log('Workflow replay suite: all assertions PASS.');
}

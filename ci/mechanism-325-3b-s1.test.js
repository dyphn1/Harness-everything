#!/usr/bin/env node
'use strict';

// #325 Phase 3b S1 strict suite: switch, trusted scope and fail-closed no-credit gate (RED).
//
// Every assertion in reconciliation-s1/cases.json is a strict S1 contract assertion, run against the real CLI, hook and
// Stop entry points on both legs (source and packaged) and both modes (OFF and ON with the switch set to exactly "1").
// Each assertion is tagged s1Kind:
//   retired    one of the 26 S1 retire IDs in docs/doc-workflow-reconciliation.md; expected to FAIL on the current base
//   control    behaviour that must PASS now and after GREEN (P06, P07u, P02d, OFF legacy, Stop exit 0, switch values)
//   additional a named S1 contract case beyond the retire table (governed scope, direct aggregate, OFF-seeded, ON->OFF->ON)
// This suite grants no pilot credit and never consults the prep registry: a FAIL here is a real gap, not a qualified one.
// Infrastructure faults (spawn error, deadline, output bound, exit outside the declared policy, malformed output) are
// reported as INFRA and are distinct from assertion FAIL. Exit 1 means at least one assertion FAILED; exit 2 means
// infrastructure. The suite cannot pass until GREEN lands; that is the RED contract.

const path = require('path');
const fx = require('./lib/doc-reconciliation-prep-fixtures');

const CORPUS_FILE = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s1', 'cases.json');
const corpus = fx.readCaseCorpus(CORPUS_FILE);
const LEGS = ['source', 'packaged'];
const MODES = ['off', 'on'];
const ALLOWED_OPERATORS = new Set(['equals', 'notEquals', 'includes', 'absent']);
const S1_KINDS = new Set(['retired', 'control', 'additional']);
const REQUIRED_CASE_FIELDS = ['id', 'family', 'description', 'topology', 'requirements', 'input', 'actions', 'expectations'];

// The doc's "S1 retire" table: 26 IDs × 2 legs, by case. Any drift between this list and the corpus is a failure.
const RETIRED_BY_CASE = {
  P01: ['verify-exit-refused', 'verify-obligation-pending', 'stop-unsatisfied', 'stop-reports-verification'],
  P04: ['direct-execute-refused', 'direct-verify-refused', 'verify-obligation-pending'],
  P02a: ['verify-pass-exit', 'stop-state', 'stop-reports'],
  P02b: ['verify-pass-exit', 'stop-state', 'stop-reports'],
  P02c: ['verify-pass-exit', 'stop-state', 'stop-reports'],
  P02g: ['verify-pass-exit', 'stop-state', 'stop-reports'],
  P02f: ['verify-pass-exit', 'stop-state', 'stop-reports'],
  P03: ['verify-pass-exit'],
  'P07-fable-staged': ['pilot-status-unavailable'],
  'P07-fable-parallel': ['pilot-status-unavailable'],
  'P07-fable-multi-agent-workspace': ['pilot-status-unavailable']
};
const RETIRED_COUNT = Object.values(RETIRED_BY_CASE).reduce((total, ids) => total + ids.length, 0);

let passed = 0;
let failed = 0;
let infra = 0;
const failures = [];
const infrastructure = [];

const show = value => (value === undefined ? 'undefined' : JSON.stringify(value));

// The reason a FAIL names, in the terms the doc uses: "exit 0 where 2 desired", "state satisfied where running desired".
function reasonFor(assertion, actual) {
  const last = assertion.path[assertion.path.length - 1];
  const label = ({ exitCode: 'exit', state: 'state', unresolved: 'unresolved', pilotStatus: 'pilot status',
    pilotReportOrigin: 'pilot origin', pilot: 'pilot' })[last]
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

// Parity between the two legs for one replay, mirroring the prep runner's comparable() view.
function comparable(root) {
  const entries = Object.entries(root.actions).map(([id, action]) => [id, {
    exitCode: action.exitCode,
    signal: action.signal,
    stdout: action.json === null ? action.stdout : null,
    json: action.json,
    stderr: action.stderr,
    state: action.state
  }]);
  return fx.normalize(Object.fromEntries([...entries, ['$final', root.state]]));
}

console.log('=== #325 3b S1: strict switch, trusted scope and fail-closed no-credit suite (RED) ===');

// ---- Inventory: the corpus is well formed and marks exactly the doc's retire table -----------------------------
{
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
      for (const mode of MODES) {
        try { fx.exitPolicy(action, mode); } catch (error) { problems.push(error.message); }
      }
    }
    for (const mode of MODES) {
      const ids = item.expectations[mode].map(assertion => assertion.id);
      if (new Set(ids).size !== ids.length) problems.push(`${item.id}.${mode} assertion ids are not unique`);
      for (const assertion of item.expectations[mode]) {
        if (!ALLOWED_OPERATORS.has(assertion.operator)) problems.push(`${item.id}.${assertion.id} operator ${assertion.operator}`);
        if (!Array.isArray(assertion.path) || assertion.path.length === 0) problems.push(`${item.id}.${assertion.id} has no path`);
        if (!S1_KINDS.has(assertion.s1Kind)) problems.push(`${item.id}.${assertion.id} lacks a valid s1Kind`);
      }
    }
  }
  const retired = [];
  for (const item of corpus.cases) {
    for (const assertion of item.expectations.on) {
      if (assertion.s1Kind === 'retired') retired.push(`${item.id}:${assertion.id}`);
    }
  }
  const expected = Object.entries(RETIRED_BY_CASE).flatMap(([caseId, ids]) => ids.map(id => `${caseId}:${id}`));
  const missing = expected.filter(entry => !retired.includes(entry));
  const extra = retired.filter(entry => !expected.includes(entry));
  if (missing.length || extra.length) problems.push(`retired set differs from the doc table: missing ${show(missing)} extra ${show(extra)}`);
  if (expected.length !== RETIRED_COUNT || RETIRED_COUNT !== 26) problems.push(`the doc table names ${RETIRED_COUNT} IDs, not 26`);
  if (problems.length) record('FAIL', 'inventory: corpus is well formed and marks the 26 S1 retire IDs', problems.join('; '));
  else record('PASS', `inventory: corpus is well formed and marks the ${RETIRED_COUNT} S1 retire IDs`);
}

// ---- Replays: every case, both legs, both modes ----------------------------------------------------------------
for (const item of corpus.cases) {
  for (const mode of MODES) {
    const roots = {};
    for (const leg of LEGS) {
      let root;
      try {
        root = fx.scrubReplay(fx.replayCase(item, leg, mode === 'on' ? { pilot: '1' } : undefined));
      } catch (error) {
        infrastructure.push(`${item.id}.${mode} [${leg}]`);
        infra += 1;
        console.log(`  INFRA ${item.id}.${mode} [${leg}] — replay failed: ${error.message.split('\n')[0]}`);
        continue;
      }
      roots[leg] = root;
      const faults = fx.infrastructureFaults(item, root, mode);
      if (faults.length) {
        infra += 1;
        infrastructure.push(`${item.id}.${mode} [${leg}]`);
        for (const fault of faults) console.log(`  INFRA ${item.id}.${mode} [${leg}] ${fault.actionId}: ${fault.message}`);
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
      const id = `${item.id}.${mode}.parity [source=packaged]`;
      if (same) record('PASS', id, '(control)');
      else record('FAIL', id, '(control) source and packaged legs disagree');
    }
  }
}

// ---- Summary -----------------------------------------------------------------------------------------------------
console.log(`\nS1 strict summary: ${passed} PASS, ${failed} FAIL, ${infra} INFRA across ${corpus.cases.length} cases (pilotCredit: false)`);
if (failures.length) console.log(`FAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}`);
if (infrastructure.length) console.log(`INFRASTRUCTURE (${infrastructure.length}):\n  ${infrastructure.join('\n  ')}`);

if (infra > 0) {
  console.error('S1 suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (failed > 0) {
  console.error('S1 suite: assertion FAIL present (expected on the RED base; GREEN must clear every FAIL).');
  process.exitCode = 1;
} else {
  console.log('S1 suite: all assertions PASS.');
}

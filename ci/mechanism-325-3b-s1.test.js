#!/usr/bin/env node
'use strict';

// #325 Phase 3b S1 workflow controls across source/package and legacy switch values.
//
// Retained assertions in reconciliation-s1/cases.json run through the real CLI, hook and Stop entry points on both legs
// (source and packaged) and both modes (OFF and ON with the legacy switch set to "1"). E1-only pilot decisions are
// retired; remaining assertions cover ordinary workflow behavior and controls that remain meaningful after unhooking.
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
const S1_KINDS = new Set(['control', 'additional']);
const REQUIRED_CASE_FIELDS = ['id', 'family', 'description', 'topology', 'requirements', 'input', 'actions', 'expectations'];

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

console.log('=== #325 3b S1: retained workflow controls ===');

// ---- Inventory: retained corpus rows are well formed ----------------------------------------------------------
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
  if (problems.length) record('FAIL', 'inventory: retained corpus rows are well formed', problems.join('; '));
  else record('PASS', 'inventory: retained corpus rows are well formed');
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
  console.error('S1 suite: retained assertion FAIL present.');
  process.exitCode = 1;
} else {
  console.log('S1 suite: all assertions PASS.');
}

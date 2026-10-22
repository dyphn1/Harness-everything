#!/usr/bin/env node
'use strict';

// #325 Phase 3b F4-T4: permanent trust-boundary cases from the F4-R reviewer report (F4-R-report.md).
//
// Each case is one of the reviewer's executed probes, turned into a permanent check and run through the real hook,
// workflow and Stop entries (source and packaged legs). Each check states the outcome the contract requires. A check
// that fails at the current HEAD is RED and names the F4-R finding it covers. F4-W5 closes those findings; when it
// lands, each RED becomes a strict CONTROL in the same change (the rule used in F4-T2 and F4-T3).
//
// Staged trees: every replay runs from a scratch copy of the leg, which carries the committed qualification export and
// its sibling sanitized capture (the shipped export), so the production gate is open exactly as it is for users.
//
// Interface used here, to be matched by F4-W5: a review verdict may bind the artifacts it reviewed with one line per
// path, `Reviewed: <repo-relative path> sha256:<hex>`, in the final review artifact (the SubagentStop message). F4-R
// finding F6 needs such a binding; the packet does not define its syntax, so it is defined here.
//
// Statuses: CONTROL passes now and at GREEN. RED fails now for its finding. FAIL is an unexpected result, including a
// RED that already passes. INFRA is a harness fault. Strict by default; `--expect-red` exits 0 only when the RED plan
// matches.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const { stage, EXPORT_FILE, SIBLING_CAPTURE } = require(path.join(__dirname, 'lib', 'doc-reconciliation-staged-tree'));
const F4_CASES = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');
const LEGS = ['source', 'packaged'];
const LEG_LIB = {
  source: path.join(ROOT, 'hooks', 'scripts', 'lib'),
  packaged: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib'),
};

const POS_CASE = fx.readCaseCorpus(F4_CASES).cases.find(item => item.id === 'F4-POS-body-edit');
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const LINT_COMMAND = 'node harness-everything/scripts/doc-check.js check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md';
const FM = '---\nrole: reference\nstatus: active\n---\n\n';
const BASE_A = FM + 'The checkout retries once. See [b](b.md).\n';
const CAND_NORMATIVE = FM + 'The checkout MUST retry twice. See [b](b.md).\n';
const REQUIREMENTS = [
  { id: 'req-docs', stepType: 'doc-change', summary: 'Correct the checkout retry rule', acceptance: 'the governed reference body is reviewed' },
  { id: 'req-review', stepType: 'review', summary: 'Review the change', acceptance: 'an independent host review approves it' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'objective doc checks are recorded' },
];
const REVIEW_ROUTE = { id: 'route', op: 'route', payload: { prompt: 'Update docs/a.md, review it independently, and verify it.' } };

// Copies the committed qualification export and its sibling capture into a staged tree (the shipped export).
function useShippedExport(staged) {
  const lib = LEG_LIB[staged.leg];
  fs.copyFileSync(path.join(lib, EXPORT_FILE), staged.exportFile);
  fs.copyFileSync(path.join(lib, SIBLING_CAPTURE), staged.captureFile);
}

// The committed export must already bind the retained bytes (the probe depends on it being the shipped one).
function shippedExportPresent() {
  return LEGS.every(leg => fs.existsSync(path.join(LEG_LIB[leg], EXPORT_FILE)) && fs.existsSync(path.join(LEG_LIB[leg], SIBLING_CAPTURE)));
}

let passCount = 0;
let redCount = 0;
let failCount = 0;
let infraCount = 0;

function record(status, id, detail) {
  const suffix = detail ? ` - ${detail}` : '';
  if (status === 'PASS') passCount += 1;
  else if (status === 'RED') redCount += 1;
  else if (status === 'FAIL') failCount += 1;
  else infraCount += 1;
  console.log(`   ${status.padEnd(5)} ${id}${suffix}`);
}

// Each check is { id, status: 'CONTROL'|'RED', reason, test(root) -> { pass, actual } }.
function runChecks(label, root, checks) {
  for (const check of checks) {
    const id = `${label}.${check.id}`;
    let result;
    try {
      result = check.test(root);
    } catch (error) {
      record('INFRA', id, `check threw: ${error.message}`);
      continue;
    }
    if (check.status === 'CONTROL') {
      record(result.pass ? 'PASS' : 'FAIL', id, result.pass ? '' : `got ${JSON.stringify(result.actual).slice(0, 180)}`);
    } else if (result.pass) {
      record('FAIL', id, 'RED check unexpectedly passed now (the finding is already fixed: retire it to CONTROL)');
    } else {
      record('RED', id, `${check.reason}; actual ${JSON.stringify(result.actual).slice(0, 160)}`);
    }
  }
}

function replay(caseDef, dist, options) {
  const item = clone(caseDef);
  const root = fx.replayCase(item, dist, options);
  const faults = fx.infrastructureFaults(item, root, options.pilot === undefined ? 'off' : 'on');
  if (faults.length) throw new Error(faults.map(fault => `${fault.actionId}: ${fault.message}`).join('; '));
  return root;
}

const pilotOf = root => root.pilot || {};
// An accepted event carries its capability in its ref (`<ref>#<capability>`). Listing a capability is not accepting it.
const acceptedCapabilityOf = root => (pilotOf(root).acceptedRefs || []).map(ref => String(ref).split('#').pop());
const creditedOf = root => [...(pilotOf(root).creditedCapabilities || [])].sort();
const diagnosticsOf = root => pilotOf(root).diagnostics || [];

// ---- R1 and R2: the registered command must be this plugin's own doc-check, byte for byte (F4-R F1, F9) --------------

function partR1R2(leg) {
  console.log(`\n== R1/R2 (${leg}): a self-authored or tampered doc-check earns nothing ==`);
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f4t4-fake-'));
  const fakeScript = path.join(fakeRoot, 'harness-everything', 'scripts', 'doc-check.js');
  const report = {
    schema: 'harness.doc-check.check.v1',
    command: 'harness.doc-check.check.v1',
    lint: { exit: 0, evidence: {}, diagnostics: [] },
    links: { checked: 1, broken: [] },
    coverage: { unsupported: [] },
    reminders: [],
    capabilities: {
      'doc-lint': { state: 'pass', checkedPaths: ['docs/a.md'], skipped: [] },
      'link-check': { state: 'pass', checkedPaths: ['docs/a.md'], skipped: [] },
    },
  };
  const stdout = JSON.stringify(report, null, 2) + '\n';
  fs.mkdirSync(path.dirname(fakeScript), { recursive: true });
  fs.writeFileSync(fakeScript, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\n`, 'utf8');
  const fakeCommand = `node ${fakeScript} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md`;
  const fakeCase = clone(POS_CASE);
  fakeCase.id = 'F4T4-R1-fake-impl';
  fakeCase.actions = fakeCase.actions.filter(action => action.id !== 'lint-run' && action.id !== 'post-lint')
    .flatMap(action => (action.id === 'verify-pass'
      ? [{ id: 'post-fake', op: 'hookDeliver', payload: { event: 'PostToolUse', command: fakeCommand, toolUseId: 'toolu_f4t4_fake_01', response: { stdout, stderr: '', interrupted: false } } }, action]
      : [action]));
  const staged = stage(leg);
  try {
    useShippedExport(staged);
    const root = replay(fakeCase, staged.dist, { pilot: '1' });
    const before = root.actions['doc-pass'].state.handoff || {};
    const after = root.actions['post-fake'].state.handoff || {};
    runChecks(`R1.fake-impl@${leg}`, root, [
      { id: 'no-credit', status: 'RED', reason: 'F4-R F1: a self-authored doc-check earns document credit (the path shape alone is matched)', test: () => ({ pass: pilotOf(root).pilotCredit === false, actual: pilotOf(root).pilotCredit }) },
      { id: 'no-capability-accepted', status: 'RED', reason: 'F4-R F1: capability events accepted from the self-authored implementation', test: () => ({ pass: (pilotOf(root).acceptedRefs || []).length === 0, actual: pilotOf(root).acceptedRefs }) },
      { id: 'lastVerifyAt-unchanged', status: 'RED', reason: 'F4-R F9: a non-registered path sets lastVerifyAt', test: () => ({ pass: before.lastVerifyAt === after.lastVerifyAt, actual: { before: before.lastVerifyAt, after: after.lastVerifyAt } }) },
    ]);
  } finally {
    staged.cleanup();
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }

  const tamperedCase = clone(POS_CASE);
  const tampered = stage(leg);
  try {
    useShippedExport(tampered);
    const script = leg === 'source'
      ? path.join(tampered.root, 'harness-everything', 'scripts', 'doc-check.js')
      : path.join(tampered.root, 'plugin', 'skills', 'harness-everything', 'scripts', 'doc-check.js');
    fs.appendFileSync(script, '\n// tampered by the F4-T4 digest case\n', 'utf8');
    const root = replay(tamperedCase, tampered.dist, { pilot: '1' });
    runChecks(`R2.tampered-script@${leg}`, root, [
      { id: 'no-credit', status: 'RED', reason: 'F4-R F1: the registered check is not bound to the shipped implementation digest', test: () => ({ pass: pilotOf(root).pilotCredit === false, actual: pilotOf(root).pilotCredit }) },
    ]);
  } finally {
    tampered.cleanup();
  }
}

// ---- R3 to R5: the report states exactly what was credited, and why nothing else is (F4-R F2, F3, F12) ------------

function partR3R5(leg) {
  console.log(`\n== R3/R4/R5 (${leg}): credit and diagnostics are exact ==`);
  const staged = stage(leg);
  try {
    useShippedExport(staged);
    const root = replay(POS_CASE, staged.dist, { pilot: '1' });
    runChecks(`R3-R5.positive@${leg}`, root, [
      { id: 'R3.credited-exactly-lint-and-links', status: 'RED', reason: 'F4-R F2: the report lists capabilities that were never accepted or that are N/A', test: () => ({ pass: JSON.stringify(creditedOf(root)) === JSON.stringify(['doc-lint', 'link-check']), actual: creditedOf(root) }) },
      { id: 'R4.no-unsatisfied-when-credited', status: 'RED', reason: 'F4-R F3: pilotCredit is true while the report still lists unsatisfied obligations', test: () => ({ pass: (pilotOf(root).unsatisfied || []).length === 0, actual: pilotOf(root).unsatisfied }) },
      { id: 'R5.diagnostics-carry-obligationId', status: 'RED', reason: 'F4-R F12: diagnostics keep only the code and drop the obligation', test: () => ({ pass: diagnosticsOf(root).every(item => item && typeof item === 'object' && typeof item.obligationId === 'string'), actual: diagnosticsOf(root) }) },
    ]);
  } finally {
    staged.cleanup();
  }
}

// ---- R6 and R7: review independence and the correlated surface (F4-R F4, F5) ------------------------------------------

const VERDICT_APPROVE = 'Review verdict: approve\nSummary: The sentence is corrected and the link resolves.';

function reviewRoot(leg, extraActions, label) {
  const item = clone(POS_CASE);
  item.id = label;
  item.requirements = clone(REQUIREMENTS);
  item.actions = [
    { id: 'route', op: 'route', payload: { prompt: 'Update docs/a.md, review it independently, and verify it.' } },
    { id: 'plan', op: 'plan', payload: { requirements: '$requirements', strategy: 'iterative-single', evidence: 'bounded documentation loop' } },
    { id: 'start', op: 'start', payload: {} },
    { id: 'doc-pass', op: 'step', payload: { stepId: 'req-docs', disposition: 'pass', evidence: 'sentence corrected' } },
    ...extraActions,
    { id: 'verify-bind', op: 'binding', payload: { stepId: 'req-verify', bindingId: 'verification-loop', disposition: 'loaded', evidence: 'verification loop skill located' } },
    { id: 'stop', op: 'stop' },
    { id: 'stop-generic', op: 'stopGeneric' },
  ];
  return item;
}

function partR6R7(leg) {
  console.log(`\n== R6/R7 (${leg}): an executor or an unlabelled surface cannot approve the review ==`);
  // R6: the reviewer is the same subagent that ran the work (the Agent result carries its id).
  const executorStaged = stage(leg);
  try {
    useShippedExport(executorStaged);
    const item = reviewRoot(leg, [
      { id: 'agent-post', op: 'hookDeliver', payload: { event: 'PostToolUse', command: LINT_COMMAND, toolUseId: 'toolu_f4t4_agent', response: { stdout: '{}', stderr: '', interrupted: false, agentId: 'agent-9' } } },
      { id: 'sub-stop', op: 'hookDeliver', payload: { event: 'SubagentStop', agentId: 'agent-9', agentType: 'doc-reviewer', lastAssistantMessage: VERDICT_APPROVE } },
      { id: 'review-pass', op: 'step', payload: { stepId: 'req-review', disposition: 'pass', evidence: 'reviewer approved' }, expectExit: { on: [0, 2] } },
    ], 'F4T4-R6-executor');
    const root = replay(item, executorStaged.dist, { pilot: '1' });
    runChecks(`R6.reviewer-is-executor@${leg}`, root, [
      { id: 'review-refused', status: 'RED', reason: 'F4-R F4: the reviewer agent_id equals an executor of this task and the review is approved', test: () => ({ pass: root.actions['review-pass'].exitCode === 2, actual: root.actions['review-pass'].exitCode }) },
    ]);
  } finally {
    executorStaged.cleanup();
  }

  // R7: a SubagentStop with no Agent or Task result surface at all.
  const surfaceStaged = stage(leg);
  try {
    useShippedExport(surfaceStaged);
    const item = reviewRoot(leg, [
      { id: 'sub-stop', op: 'hookDeliver', payload: { event: 'SubagentStop', agentId: 'agent-9', agentType: 'doc-reviewer', lastAssistantMessage: VERDICT_APPROVE } },
      { id: 'review-pass', op: 'step', payload: { stepId: 'req-review', disposition: 'pass', evidence: 'reviewer approved' }, expectExit: { on: [0, 2] } },
    ], 'F4T4-R7-no-surface');
    const root = replay(item, surfaceStaged.dist, { pilot: '1' });
    runChecks(`R7.no-agent-surface@${leg}`, root, [
      { id: 'not-approved', status: 'RED', reason: 'F4-R F5: a review is approved with no correlated Agent/Task result surface', test: () => ({ pass: root.actions['review-pass'].exitCode === 2, actual: root.actions['review-pass'].exitCode }) },
    ]);
  } finally {
    surfaceStaged.cleanup();
  }
}

// ---- R8 and R9: an independent review bound to the current candidate, and a stale binding (F4-R F6) ------------------

function partR8R9(leg) {
  console.log(`\n== R8/R9 (${leg}): an independent review bound to the candidate is credited; a stale binding is not ==`);
  const candidateDigest = sha256(CAND_NORMATIVE);
  const staleDigest = sha256(BASE_A);
  const normativeCase = (label, digest) => {
    const item = reviewRoot(leg, [
      { id: 'lint-run', op: 'hostRun', payload: { command: 'doc-check', args: ['check', '--workspace', '.', '--config', '.agents/harness-everything/project-docs.json', '--changed-path', 'docs/a.md'] } },
      { id: 'post-lint', op: 'hookDeliver', payload: { event: 'PostToolUse', command: LINT_COMMAND, toolUseId: 'toolu_f4t4_check_r8', fromRun: 'lint-run' } },
      { id: 'sub-stop', op: 'hookDeliver', payload: { event: 'SubagentStop', agentId: 'agent-7', agentType: 'doc-reviewer', lastAssistantMessage: `${VERDICT_APPROVE}\nReviewed: docs/a.md sha256:${digest}` } },
      { id: 'review-pass', op: 'step', payload: { stepId: 'req-review', disposition: 'pass', evidence: 'independent reviewer approved' } },
      { id: 'verify-pass', op: 'step', payload: { stepId: 'req-verify', disposition: 'pass', evidence: 'objective doc checks recorded' }, expectExit: { on: [0, 2] } },
    ], label);
    item.actions = item.actions.map(action => (action.id === 'doc-pass'
      ? { ...action, payload: { ...action.payload, evidence: 'normative sentence corrected' } }
      : action));
    return item;
  };
  // The normative edit goes to the candidate tree; the base is the committed one.
  const candidateFiles = { 'docs/a.md': CAND_NORMATIVE };
  for (const [label, digest, expectCredit] of [['F4T4-R8-bound', candidateDigest, true], ['F4T4-R9-stale', staleDigest, false]]) {
    const staged = stage(leg);
    try {
      useShippedExport(staged);
      const item = normativeCase(label, digest);
      item.input = { ...clone(POS_CASE.input), candidateFiles };
      const root = replay(item, staged.dist, { pilot: '1' });
      // Non-vacuity: the independent review really reached the chain, so a missing acceptance is the finding, not a broken set-up.
      const reviewCapture = (root.actions['sub-stop'].state.capture || { records: [] }).records.find(record => record.event === 'SubagentStop') || {};
      const setup = [
        { id: 'review-captured', status: 'CONTROL', reason: '', test: () => ({ pass: reviewCapture.reviewVerdict === 'approve' && reviewCapture.agent_id === 'agent-7', actual: { verdict: reviewCapture.reviewVerdict, agent: reviewCapture.agent_id } }) },
        { id: 'review-step-passes', status: 'CONTROL', reason: '', test: () => ({ pass: root.actions['review-pass'].exitCode === 0, actual: root.actions['review-pass'].exitCode }) },
      ];
      const checks = setup.concat(expectCredit
        ? [
          { id: 'R8.quality-review-accepted', status: 'RED', reason: 'F4-R F6: the reviewed digests are never bound, so an applicable quality-review is never accepted and can never be satisfied', test: () => ({ pass: acceptedCapabilityOf(root).includes('quality-review') && pilotOf(root).pilotCredit === true, actual: { accepted: acceptedCapabilityOf(root), pilotCredit: pilotOf(root).pilotCredit } }) },
        ]
        : [
          { id: 'R9.quality-review-not-accepted', status: 'CONTROL', reason: '', test: () => ({ pass: !acceptedCapabilityOf(root).includes('quality-review'), actual: acceptedCapabilityOf(root) }) },
          { id: 'R9.artifact-mismatch-reported', status: 'RED', reason: 'F4-R F6: a stale reviewed digest is not reported as artifact-mismatch', test: () => ({ pass: diagnosticsOf(root).some(item => item && item.code === 'artifact-mismatch'), actual: diagnosticsOf(root).map(item => (item && item.code) || item) }) },
        ]);
      runChecks(`${label}@${leg}`, root, checks);
    } finally {
      staged.cleanup();
    }
  }
}

function main() {
  if (!shippedExportPresent()) {
    console.log('INFRA: the committed qualification export is missing from a leg; the trust-boundary cases need it');
    return 2;
  }
  for (const leg of LEGS) {
    partR1R2(leg);
    partR3R5(leg);
    partR6R7(leg);
    partR8R9(leg);
  }
  console.log('\n== F4-T4 trust-boundary evidence ==');
  console.log(`controls and passing checks: ${passCount}`);
  console.log(`RED checks confirmed: ${redCount}`);
  console.log(`unexpected failures: ${failCount}`);
  console.log(`infrastructure faults: ${infraCount}`);
  const expectRed = process.argv.includes('--expect-red');
  if (infraCount > 0) return 2;
  if (!expectRed) {
    if (failCount === 0 && redCount === 0) {
      console.log('\nSTATUS: GREEN (all trust-boundary checks passed)');
      return 0;
    }
    console.log(`\nSTATUS: NOT-GREEN (red ${redCount}, unexpected ${failCount})`);
    return 1;
  }
  if (failCount === 0) {
    console.log('\nSTATUS: RED-PLAN-MATCHED (all controls passed, all RED checks failed for their F4-R findings)');
    return 0;
  }
  console.log('\nSTATUS: RED-PLAN-MISMATCH');
  return 1;
}

process.exitCode = main();

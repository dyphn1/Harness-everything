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
// Interface (F4-W5): a review verdict binds the artifacts it reviewed with one line per path,
// `Reviewed artifact: <repo-relative path> sha256:<hex>`, in the final review artifact (the SubagentStop message).
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
// {{DOC_CHECK}} resolves per leg to the installed doc-check path, so a positive run is one the host would really run.
const LINT_COMMAND = 'node {{DOC_CHECK}} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md';
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
      { id: 'no-credit', status: 'CONTROL', reason: 'F4-R F1: a self-authored doc-check earns document credit (the path shape alone is matched)', test: () => ({ pass: pilotOf(root).pilotCredit === false, actual: pilotOf(root).pilotCredit }) },
      { id: 'no-capability-accepted', status: 'CONTROL', reason: 'F4-R F1: capability events accepted from the self-authored implementation', test: () => ({ pass: (pilotOf(root).acceptedRefs || []).length === 0, actual: pilotOf(root).acceptedRefs }) },
      { id: 'lastVerifyAt-unchanged', status: 'CONTROL', reason: 'F4-R F9: a non-registered path sets lastVerifyAt', test: () => ({ pass: before.lastVerifyAt === after.lastVerifyAt, actual: { before: before.lastVerifyAt, after: after.lastVerifyAt } }) },
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
      // Open (G0, F4-A3): SHIPPED_DOC_CHECK_DIGEST is absent, so a script changed before the run is observed, digested and credited.
      { id: 'no-credit', status: 'RED', reason: 'G0 (F4-A3): the shipped doc-check is not pinned (SHIPPED_DOC_CHECK_DIGEST absent), so a script changed before the run earns credit', test: () => ({ pass: pilotOf(root).pilotCredit === false, actual: pilotOf(root).pilotCredit }) },
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
      { id: 'R3.credited-exactly-lint-and-links', status: 'CONTROL', reason: 'F4-R F2: the report lists capabilities that were never accepted or that are N/A', test: () => ({ pass: JSON.stringify(creditedOf(root)) === JSON.stringify(['doc-lint', 'link-check']), actual: creditedOf(root) }) },
      { id: 'R4.no-unsatisfied-when-credited', status: 'CONTROL', reason: 'F4-R F3: pilotCredit is true while the report still lists unsatisfied obligations', test: () => ({ pass: (pilotOf(root).unsatisfied || []).length === 0, actual: pilotOf(root).unsatisfied }) },
      { id: 'R5.diagnostics-carry-obligationId', status: 'CONTROL', reason: 'F4-R F12: diagnostics keep only the code and drop the obligation', test: () => ({ pass: diagnosticsOf(root).every(item => item && typeof item === 'object' && typeof item.obligationId === 'string'), actual: diagnosticsOf(root) }) },
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
    // Exit 2 is the honest outcome while the review is refused: verification cannot complete ahead of an unapproved review.
    { id: 'verify-bind', op: 'binding', payload: { stepId: 'req-verify', bindingId: 'verification-loop', disposition: 'loaded', evidence: 'verification loop skill located' }, expectExit: { on: [0, 2] } },
    { id: 'stop', op: 'stop' },
    { id: 'stop-generic', op: 'stopGeneric' },
  ];
  return item;
}

// The Agent launch's correlated PostToolUse: the result surface that names the reviewer (F5). Its tool is not evidence.
const agentSurface = (id, agentId) => ({ id, op: 'hookDeliver', payload: { event: 'PostToolUse', toolName: 'Agent', command: 'agent-launch', toolUseId: `toolu_f4t4_${id}`, response: { stdout: '', stderr: '', interrupted: false, agentId } } });
const subStop = (agentId, message) => ({ id: 'sub-stop', op: 'hookDeliver', payload: { event: 'SubagentStop', agentId, agentType: 'doc-reviewer', lastAssistantMessage: message } });
const reviewPass = () => ({ id: 'review-pass', op: 'step', payload: { stepId: 'req-review', disposition: 'pass', evidence: 'reviewer approved' }, expectExit: { on: [0, 2] } });
// Approves and binds the reviewed artifact, so the only variable in each case is the one under test.
const BOUND_APPROVE = `${VERDICT_APPROVE}\nReviewed artifact: docs/a.md sha256:${sha256(CAND_NORMATIVE)}`;
const LINT_RUN = { id: 'lint-run', op: 'hostRun', payload: { command: 'doc-check', args: ['check', '--workspace', '.', '--config', '.agents/harness-everything/project-docs.json', '--changed-path', 'docs/a.md'] } };
const lintBy = agentId => ({ id: 'post-lint', op: 'hookDeliver', payload: { event: 'PostToolUse', command: LINT_COMMAND, toolUseId: 'toolu_f4t4_lint_r6', fromRun: 'lint-run', agentId } });

function partR6R7(leg) {
  console.log(`\n== R6/R7 (${leg}): an executor or an unlabelled surface cannot approve the review ==`);
  // Each case runs one review. `runs` are the reviewer's own tool calls; the review then has its Agent surface and verdict.
  const reviewCase = (label, runs, agentId) => {
    const staged = stage(leg);
    try {
      useShippedExport(staged);
      const item = reviewRoot(leg, [...runs, agentSurface('agent-result', agentId), subStop(agentId, BOUND_APPROVE), reviewPass()], label);
      return replay(item, staged.dist, { pilot: '1' });
    } finally {
      staged.cleanup();
    }
  };
  const approved = root => root.actions['review-pass'].exitCode === 0;
  const refused = root => root.actions['review-pass'].exitCode === 2;

  // R6: the reviewer ran a registered doc-check, so the reviewer is an executor and cannot approve (F4-R F4).
  const registeredRun = { id: 'agent-post', op: 'hookDeliver', payload: { event: 'PostToolUse', command: LINT_COMMAND, toolUseId: 'toolu_f4t4_agent', response: { stdout: '{}', stderr: '', interrupted: false, agentId: 'agent-9' } } };
  const plainRun = { ...registeredRun, id: 'agent-post', payload: { ...registeredRun.payload, command: 'npm test', toolUseId: 'toolu_f4t4_plain' } };
  const root6 = reviewCase('F4T4-R6-executor', [registeredRun], 'agent-9');
  const root6Plain = reviewCase('F4T4-R6-plain-control', [plainRun], 'agent-9');
  // The same executor rule with the registered run as real evidence: the reviewer's own doc-check run is refused.
  const rootEvidence = reviewCase('F4T4-R6-evidence', [LINT_RUN, lintBy('agent-9')], 'agent-9');
  const rootEvidenceOther = reviewCase('F4T4-R6-evidence-other-control', [LINT_RUN, lintBy('agent-other')], 'agent-9');
  runChecks('R6.reviewer-is-executor@' + leg, root6, [
    { id: 'registered-run-refused', status: 'CONTROL', reason: 'F4-R F4: the reviewer agent_id equals an executor of this task and the review is approved', test: () => ({ pass: refused(root6), actual: root6.actions['review-pass'].exitCode }) },
  ]);
  runChecks('R6.plain-tool-use-control@' + leg, root6Plain, [
    { id: 'plain-tool-use-approved', status: 'CONTROL', reason: 'a reviewer whose tool use is not registered doc-check evidence stays independent', test: () => ({ pass: approved(root6Plain), actual: root6Plain.actions['review-pass'].exitCode }) },
  ]);
  runChecks('R6.evidence-run-refused@' + leg, rootEvidence, [
    { id: 'reviewer-own-evidence-refused', status: 'CONTROL', reason: 'F4-R F4: a reviewer whose own registered doc-check run is evidence is an executor', test: () => ({ pass: refused(rootEvidence), actual: rootEvidence.actions['review-pass'].exitCode }) },
  ]);
  runChecks('R6.evidence-run-other-control@' + leg, rootEvidenceOther, [
    { id: 'other-agent-evidence-approved', status: 'CONTROL', reason: 'the same run by another agent leaves the reviewer independent', test: () => ({ pass: approved(rootEvidenceOther), actual: rootEvidenceOther.actions['review-pass'].exitCode }) },
  ]);

  // R7: a SubagentStop with no Agent or Task result surface at all is not an approval (F4-R F5).
  const noSurface = (() => {
    const staged = stage(leg);
    try {
      useShippedExport(staged);
      return replay(reviewRoot(leg, [subStop('agent-9', BOUND_APPROVE), reviewPass()], 'F4T4-R7-no-surface'), staged.dist, { pilot: '1' });
    } finally {
      staged.cleanup();
    }
  })();
  runChecks(`R7.no-agent-surface@${leg}`, noSurface, [
    { id: 'not-approved', status: 'CONTROL', reason: 'F4-R F5: a review is approved with no correlated Agent/Task result surface', test: () => ({ pass: refused(noSurface), actual: noSurface.actions['review-pass'].exitCode }) },
  ]);
}

// ---- R8 and R9: an independent review bound to the current candidate, and a stale binding (F4-R F6) ------------------

function partR8R9(leg) {
  console.log(`\n== R8/R9 (${leg}): an independent review bound to the candidate is credited; a stale binding is not ==`);
  // Quality-review is a normative-change obligation, and only prd and adr documents carry normative changes (a requirement
  // acceptance edit is one). A reference body is never normative, so these cases govern docs/a.md as a draft prd.
  const PRD = acceptance => `---\nrole: prd\nid: PRD-GRPH-001\nrevision: 1\nstatus: draft\n---\n\n### REQ-GRPH-010: Checkout retry\n\nAcceptance: the checkout retries ${acceptance}.\n`;
  const PRD_BASE = PRD('once');
  const PRD_CAND = PRD('twice');
  const PRD_CONFIG = JSON.stringify({ governed: [{ path: 'docs/a.md', role: 'prd' }], domains: ['GRPH'] }, null, 2) + '\n';
  const candidateDigest = sha256(PRD_CAND);
  const staleDigest = sha256(PRD_BASE);
  const normativeCase = (label, digest) => {
    const item = reviewRoot(leg, [
      LINT_RUN,
      { id: 'post-lint', op: 'hookDeliver', payload: { event: 'PostToolUse', command: LINT_COMMAND, toolUseId: 'toolu_f4t4_check_r8', fromRun: 'lint-run' } },
      agentSurface('agent-result', 'agent-7'),
      subStop('agent-7', `${VERDICT_APPROVE}\nReviewed artifact: docs/a.md sha256:${digest}`),
      { id: 'review-pass', op: 'step', payload: { stepId: 'req-review', disposition: 'pass', evidence: 'independent reviewer approved' } },
      { id: 'verify-pass', op: 'step', payload: { stepId: 'req-verify', disposition: 'pass', evidence: 'objective doc checks recorded' }, expectExit: { on: [0, 2] } },
    ], label);
    item.actions = item.actions.map(action => (action.id === 'doc-pass'
      ? { ...action, payload: { ...action.payload, evidence: 'normative sentence corrected' } }
      : action));
    return item;
  };
  // The normative edit goes to the candidate tree; the base is the committed one.
  const candidateFiles = { 'docs/a.md': PRD_CAND };
  const baseFiles = { ...clone(POS_CASE.input.baseFiles), 'docs/a.md': PRD_BASE, '.agents/harness-everything/project-docs.json': PRD_CONFIG };
  for (const [label, digest, expectCredit] of [['F4T4-R8-bound', candidateDigest, true], ['F4T4-R9-stale', staleDigest, false]]) {
    const staged = stage(leg);
    try {
      useShippedExport(staged);
      const item = normativeCase(label, digest);
      item.input = { baseFiles, candidateFiles };
      const root = replay(item, staged.dist, { pilot: '1' });
      // Non-vacuity: the independent review really reached the chain, so a missing acceptance is the finding, not a broken set-up.
      const reviewCapture = (root.actions['sub-stop'].state.capture || { records: [] }).records.find(record => record.event === 'SubagentStop') || {};
      const setup = [
        { id: 'review-captured', status: 'CONTROL', reason: '', test: () => ({ pass: reviewCapture.reviewVerdict === 'approve' && reviewCapture.agent_id === 'agent-7', actual: { verdict: reviewCapture.reviewVerdict, agent: reviewCapture.agent_id } }) },
        { id: 'review-step-passes', status: 'CONTROL', reason: '', test: () => ({ pass: root.actions['review-pass'].exitCode === 0, actual: root.actions['review-pass'].exitCode }) },
      ];
      const checks = setup.concat(expectCredit
        ? [
          // Closed by F4-W7 (G1-G3): the review reaches the credit chain, and quality-review is accepted. conflict-check has no
          // producer, so pilotCredit stays false by design; this check claims quality-review only.
          { id: 'R8.quality-review-accepted', status: 'CONTROL', reason: 'F4-R F6: a bound independent review is accepted as quality-review (the review enters the credit chain)', test: () => ({ pass: acceptedCapabilityOf(root).includes('quality-review'), actual: { accepted: acceptedCapabilityOf(root) } }) },
        ]
        : [
          { id: 'R9.quality-review-not-accepted', status: 'CONTROL', reason: '', test: () => ({ pass: !acceptedCapabilityOf(root).includes('quality-review'), actual: acceptedCapabilityOf(root) }) },
          // Closed by F4-W7 (G1-G3): the stale review reaches the events adapter, which reports artifact-mismatch.
          { id: 'R9.artifact-mismatch-reported', status: 'CONTROL', reason: 'F4-R F6: a stale reviewed digest is reported as artifact-mismatch (the review enters the credit chain)', test: () => ({ pass: diagnosticsOf(root).some(item => item && item.code === 'artifact-mismatch'), actual: diagnosticsOf(root).map(item => (item && item.code) || item) }) },
        ]);
      runChecks(`${label}@${leg}`, root, checks);
    } finally {
      staged.cleanup();
    }
  }
}

// ---- M2 (F4-T6): the doc-check file changes between capture and assessment --------------------------------------------
// Capture records the installed doc-check digest; assessment recomputes it. A change after capture must withhold credit
// with `implementation-digest-mismatch`. The control is the same flow with no change, and it must still be credited.

const M2_EDIT = { id: 'edit-check', op: 'editDocCheck', payload: { append: '\n// edited after capture (F4-T6 M2)\n' } };

// The provider's verdict on the captured record, from the staged leg's own provider module (the pilot drops rejections from
// its report, so the rejection code is read here). The staged tree must still exist.
function providerVerdict(staged, record) {
  const provider = require(path.join(staged.libDir, 'doc-reconciliation-provider.js'));
  const identity = record.observedIdentity;
  const origin = provider.createClaudeOriginProvider({
    hostId: 'claude-code',
    sessionId: record.session_id,
    workspaceRoot: record.cwd,
    workflowId: identity.workflowId,
    workflowRevision: identity.workflowRevision,
    taskId: 'task-f4t6-m2',
    principals: { author: record.session_id, executors: [] },
    baseline: identity.baselinePin,
    captures: [record],
  });
  return origin.resolveEvent({ reference: `${record.ref}#doc-lint`, identity: null });
}

function partM2(leg) {
  console.log(`\n== M2 (${leg}): the installed doc-check changed after capture earns nothing ==`);
  const cases = [['F4T6-M2-control', false], ['F4T6-M2-edited', true]];
  for (const [label, edited] of cases) {
    const staged = stage(leg);
    try {
      useShippedExport(staged);
      const item = clone(POS_CASE);
      item.id = label;
      item.actions = item.actions
        .flatMap(action => (action.id === 'post-lint' && edited ? [action, M2_EDIT] : [action]))
        .map(action => (action.id === 'verify-pass' ? { ...action, expectExit: { on: [0, 2] } } : action));
      const root = replay(item, staged.dist, { pilot: '1' });
      const record = ((root.actions['post-lint'].state.capture || { records: [] }).records || []).find(r => r.event === 'PostToolUse' && r.ref);
      const verdict = record ? providerVerdict(staged, record) : { status: 'missing-record', diagnostics: [] };
      const codes = (verdict.diagnostics || []).map(item => item && item.code);
      if (edited) {
        runChecks(`${label}@${leg}`, root, [
          { id: 'no-credit', status: 'CONTROL', reason: 'F4-R M2: a doc-check changed after capture must earn no document credit', test: () => ({ pass: pilotOf(root).pilotCredit === false && !creditedOf(root).includes('doc-lint'), actual: creditedOf(root) }) },
          { id: 'refused-implementation-digest-mismatch', status: 'CONTROL', reason: 'F4-R M2: assessment refuses the capture with implementation-digest-mismatch', test: () => ({ pass: verdict.status !== 'accepted' && codes.includes('implementation-digest-mismatch'), actual: { status: verdict.status, codes } }) },
        ]);
      } else {
        runChecks(`${label}@${leg}`, root, [
          { id: 'credited-lint-and-links', status: 'CONTROL', reason: 'the unchanged doc-check keeps its credit (the paired control for M2)', test: () => ({ pass: JSON.stringify(creditedOf(root)) === JSON.stringify(['doc-lint', 'link-check']), actual: creditedOf(root) }) },
          { id: 'accepted-unchanged-check', status: 'CONTROL', reason: 'the provider accepts the same record when nothing changed', test: () => ({ pass: verdict.status === 'accepted', actual: { status: verdict.status, codes } }) },
        ]);
      }
    } finally {
      staged.cleanup();
    }
  }
}

// ---- G0 (F4-T7): the shipped doc-check is pinned by canonical digest (F4-A3) ------------------------------------------
// The provider must export SHIPPED_DOC_CHECK_DIGEST: the canonical SHA-256 (UTF-8, CRLF normalised to LF) of the shipped
// harness-everything/scripts/doc-check.js. Until that pin exists, the pin REDs fail for that reason alone, and a script
// changed before its run is still credited. F4-W8 implements the pin; this part asserts it and must not be relaxed.

const SOURCE_DOC_CHECK = path.join(ROOT, 'harness-everything', 'scripts', 'doc-check.js');
const PACKAGED_DOC_CHECK = path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'doc-check.js');
const canonicalDigest = file => sha256(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
const bytesDigest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const EXPECTED_PIN = canonicalDigest(SOURCE_DOC_CHECK);
const pinOf = leg => require(path.join(LEG_LIB[leg], 'doc-reconciliation-provider.js')).SHIPPED_DOC_CHECK_DIGEST;
const rePinHint = leg => `set SHIPPED_DOC_CHECK_DIGEST = '${EXPECTED_PIN}' in ${path.relative(ROOT, path.join(LEG_LIB[leg], 'doc-reconciliation-provider.js'))}`;
const shippedDocCheck = leg => (leg === 'source' ? SOURCE_DOC_CHECK : PACKAGED_DOC_CHECK);

// Replays the positive case against a staged copy of the leg, after an optional change to its installed doc-check.
function g0Replay(leg, mutate) {
  const staged = stage(leg);
  try {
    useShippedExport(staged);
    if (mutate) mutate(staged.dist.docCheck);
    return replay(clone(POS_CASE), staged.dist, { pilot: '1' });
  } finally {
    staged.cleanup();
  }
}

function partG0() {
  console.log('\n== G0 (both legs): the shipped doc-check is pinned by canonical digest (F4-A3) ==');
  for (const leg of LEGS) {
    const pin = pinOf(leg);
    const pinned = pin === undefined ? null : pin;
    runChecks(`G0.pin@${leg}`, undefined, [
      { id: 'pin-matches-shipped-script', status: 'RED', reason: 'G0 (F4-A3): SHIPPED_DOC_CHECK_DIGEST is absent from the provider, so the shipped doc-check is not pinned', test: () => ({ pass: pin === EXPECTED_PIN, actual: { pin: pinned, expected: EXPECTED_PIN, rePin: rePinHint(leg) } }) },
    ]);
    const staged = stage(leg);
    try {
      useShippedExport(staged);
      runChecks(`G0.install@${leg}`, undefined, [
        { id: 'staged-install-is-shipped', status: 'CONTROL', reason: '', test: () => ({ pass: bytesDigest(staged.dist.docCheck) === bytesDigest(shippedDocCheck(leg)), actual: staged.dist.docCheck }) },
      ]);
    } finally {
      staged.cleanup();
    }
  }
  runChecks('G0.legs@source', undefined, [
    { id: 'pins-agree-across-legs', status: 'RED', reason: 'G0 (F4-A3): the source and packaged providers must carry the same pin (both absent now)', test: () => ({ pass: typeof pinOf('source') === 'string' && pinOf('source') === pinOf('packaged'), actual: { source: pinOf('source') === undefined ? null : pinOf('source'), packaged: pinOf('packaged') === undefined ? null : pinOf('packaged') } }) },
  ]);

  for (const leg of LEGS) {
    const shippedRoot = g0Replay(leg, null);
    const crlfRoot = g0Replay(leg, file => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'), 'utf8'));
    const oneByteRoot = g0Replay(leg, file => fs.appendFileSync(file, '\n', 'utf8'));
    runChecks(`G0.positive@${leg}`, undefined, [
      { id: 'shipped-script-credited', status: 'CONTROL', reason: '', test: () => ({ pass: JSON.stringify(creditedOf(shippedRoot)) === JSON.stringify(['doc-lint', 'link-check']), actual: creditedOf(shippedRoot) }) },
      { id: 'crlf-copy-credited', status: 'CONTROL', reason: 'a CRLF copy of the shipped script has the same canonical digest, so it stays accepted once pinned', test: () => ({ pass: JSON.stringify(creditedOf(crlfRoot)) === JSON.stringify(['doc-lint', 'link-check']), actual: creditedOf(crlfRoot) }) },
    ]);
    runChecks(`G0.one-byte@${leg}`, undefined, [
      { id: 'one-byte-change-refused', status: 'RED', reason: 'G0 (F4-A3): a one-byte change to the shipped doc-check before its run is still credited (no pin)', test: () => ({ pass: pilotOf(oneByteRoot).pilotCredit === false && !creditedOf(oneByteRoot).includes('doc-lint'), actual: creditedOf(oneByteRoot) }) },
    ]);
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
    partM2(leg);
  }
  partG0();
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

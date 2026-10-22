#!/usr/bin/env node
'use strict';

// #325 Phase 3b F4-T1: satisfiable strict RED for credited reconciliation (hook replay transport).
//
// Contract: docs/doc-workflow-reconciliation.md, section "F4: credited reconciliation (Claude-only, pilot ON)".
// Design: .worktrees/packets/feat-path/A3-advisor-report.md sections 2, 3 and 6.
//
// Transport under test. Host events reach the runtime only through the real entries: the doc-check entry runs
// through hostRun, and each raw payload goes to the real hooks/scripts/state-persist.js through hookDeliver. Replays
// that are ON run every child with the CI-only qualification preloader (`node --require`). It is not packaged and no
// production switch reads it. Production replays set no preloader, so the live gate stays unmet.
//
// Statuses, as in the S2b mechanism suites:
//   CONTROL  must pass now and stay true at GREEN (transport, refusal, OFF legacy, exit codes, non-vacuity).
//   RED      must fail now for the stated missing-implementation reason and pass at GREEN.
//   FAIL     an unexpected failure, or a RED assertion that passed already (the RED is not real).
//   INFRA    a harness crash, a child fault or a fixture fault. Never counted as RED.
// Strict by default: any RED or FAIL exits 1. `--expect-red` exits 0 only when every CONTROL passes and every RED
// fails for its stated reason. It is a separate stage and does not weaken the default.
//
// The `creditedCapabilities` report field is named here by the test. The contract requires per-capability credit in
// the report but does not name it; the GREEN schema must match or amend this name in the same change.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const PRELOAD = path.join(__dirname, 'lib', 'doc-reconciliation-qualification-preload.js');
const F4_CASES = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');
const CAPTURE_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'capture');
const LIVE_REL = path.join('benchmarks', 'results', 'live-host', 'claude-325-3b-s2b');

const LEGS = [
  { id: 'source', scripts: path.join(ROOT, 'hooks', 'scripts'), lib: path.join(ROOT, 'hooks', 'scripts', 'lib') },
  {
    id: 'packaged',
    scripts: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts'),
    lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib'),
  },
];

// The fake qualification is the explicit DI object the S2b provider already accepts. Nothing else opens the gate.
const FAKE_DI = { source: 'fake-test-fixture', faked: true, ref: 'f4-t1-di', toolUseIdPopulated: true, agentIdPopulated: true };
const CASE = id => fx.readCaseCorpus(F4_CASES).cases.find(item => item.id === id);
const LINT_COMMAND = 'node harness-everything/scripts/doc-check.js check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md';
const FAKE_COMMAND = 'node scripts/fake-check.js check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md';

const RED_IMPLEMENTATION = 'missing-implementation: the origin provider is not wired into the workflow credit boundary; pilot.assess reads no host events, so S1 withholds every document credit';
const RED_CAPABILITY = 'missing-implementation: the runtime report carries no per-capability credit and no doc-lint/link-check projection exists (A3 section 3)';
const RED_VERIFY = 'missing-implementation: S1 refuses every document verification step (document verification pending: S1 grants no document credit)';

// Journal reads inside a replay: the capture journal is the only host-event record the hooks write.
const journal = (action, index, key) => ['actions', action, 'state', 'capture', 'records', index, key];

// Plan entries: CONTROL asserts behaviour that must hold now and at GREEN, RED asserts the stated missing piece.
const PLAN = {
  'F4-POS-body-edit@on': [
    { id: 'pos.run-exit', path: ['actions', 'lint-run', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
    { id: 'pos.journal-event', path: journal('post-lint', 0, 'event'), operator: 'equals', expected: 'PostToolUse', status: 'CONTROL', note: 'the real hook journals the delivered host event' },
    { id: 'pos.journal-command', path: journal('post-lint', 0, 'command'), operator: 'equals', expected: LINT_COMMAND, status: 'CONTROL' },
    { id: 'pos.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
    { id: 'pos.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
    { id: 'pos.verify-pass', path: ['actions', 'verify-pass', 'exitCode'], operator: 'equals', expected: 0, status: 'RED', reason: RED_VERIFY, note: 'a body-only edit with current lint and link evidence passes verification' },
    { id: 'pos.pilot-credit', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: true, status: 'RED', reason: RED_IMPLEMENTATION },
    { id: 'pos.lint-credited', path: ['pilot', 'creditedCapabilities'], operator: 'includes', expected: 'doc-lint', status: 'RED', reason: RED_CAPABILITY },
    { id: 'pos.link-credited', path: ['pilot', 'creditedCapabilities'], operator: 'includes', expected: 'link-check', status: 'RED', reason: RED_CAPABILITY },
    { id: 'pos.stop-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'equals', expected: 'satisfied', status: 'RED', reason: RED_IMPLEMENTATION },
  ],
  // Production: no preloader, so the gate stays unmet. Transport still journals, and nothing may be credited.
  'F4-POS-body-edit@production': [
    { id: 'prod.journal-event', path: journal('post-lint', 0, 'event'), operator: 'equals', expected: 'PostToolUse', status: 'CONTROL' },
    { id: 'prod.pilot-credit-false', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: false, status: 'CONTROL', note: 'no preloader in production mode: no credit' },
    { id: 'prod.stop-not-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL' },
    { id: 'prod.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
  ],
  // OFF: legacy behaviour, with no pilot capture, assessment or report writes.
  'F4-POS-body-edit@off': [
    { id: 'off.pilot-null', path: ['pilot'], operator: 'equals', expected: null, status: 'CONTROL' },
    { id: 'off.no-journal', path: ['actions', 'post-lint', 'state', 'capture'], operator: 'absent', status: 'CONTROL', note: 'OFF writes no pilot capture' },
    { id: 'off.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
    { id: 'off.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
  ],
};

// Negatives: each must withhold, and each must show its triggering event really arrived (non-vacuity control).
// The paired positive above is the RED that proves credit is reachable, so these cannot pass by construction.
const NEGATIVE = (caseId, delivered) => [
  { id: 'neg.pilot-credit-false', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: false, status: 'CONTROL' },
  { id: 'neg.stop-not-satisfied', path: ['actions', 'stop', 'state', 'workflow', 'state'], operator: 'notEquals', expected: 'satisfied', status: 'CONTROL' },
  { id: 'neg.stop-exit', path: ['actions', 'stop', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
  { id: 'neg.stop-generic-exit', path: ['actions', 'stop-generic', 'exitCode'], operator: 'equals', expected: 0, status: 'CONTROL' },
  ...(delivered ? [{ id: 'neg.non-vacuity', ...delivered, status: 'CONTROL', note: `${caseId}: the triggering event reached the real hook` }] : []),
];
const PLAN_NEGATIVE = {
  'F4-NEG-echo-pass': NEGATIVE('F4-NEG-echo-pass', { path: journal('post-echo', 0, 'command'), operator: 'equals', expected: 'echo PASS' }),
  'F4-NEG-unregistered-stdout': NEGATIVE('F4-NEG-unregistered-stdout', { path: journal('post-fake', 0, 'command'), operator: 'equals', expected: FAKE_COMMAND }),
  // The contract requires the no-domains gap to be reported, so it cannot be silently full coverage (F1 reports it here).
  'F4-NEG-no-domains': NEGATIVE('F4-NEG-no-domains', { path: ['actions', 'lint-run', 'json', 'coverage', 'unsupported'], operator: 'notEquals', expected: [] }),
  'F4-NEG-later-failure': NEGATIVE('F4-NEG-later-failure', { path: journal('post-fail', 1, 'event'), operator: 'equals', expected: 'PostToolUseFailure' }),
  'F4-NEG-duplicate-tool-id': NEGATIVE('F4-NEG-duplicate-tool-id', { path: journal('post-dup', 1, 'tool_use_id'), operator: 'equals', expected: 'toolu_f4_check_01' }),
  'F4-NEG-interrupted': NEGATIVE('F4-NEG-interrupted', { path: journal('post-interrupted', 0, 'interrupted'), operator: 'equals', expected: true }),
  // The other-session record is journaled under its own session directory, so it never enters this workflow's journal.
  'F4-NEG-other-session': NEGATIVE('F4-NEG-other-session', { path: ['actions', 'post-other', 'state', 'capture'], operator: 'absent' }),
  'F4-NEG-zero-events': NEGATIVE('F4-NEG-zero-events', { path: ['actions', 'verify-pass', 'state', 'capture'], operator: 'absent' }),
  'F4-NEG-source-change': NEGATIVE('F4-NEG-source-change', { path: journal('post-lint', 0, 'event'), operator: 'equals', expected: 'PostToolUse' }),
  'F4-NEG-edited-payload': NEGATIVE('F4-NEG-edited-payload', { path: ['actions', 'edit-journal', 'state', 'capture', 'records', 0, 'responseDigest'], operator: 'equals', expected: 'f'.repeat(64) }),
  'F4-NEG-self-reported-pass': [
    { id: 'neg.bare-pass-refused', path: ['actions', 'verify-bare', 'exitCode'], operator: 'equals', expected: 2, status: 'CONTROL', note: 'a bare PASS string is refused' },
    ...NEGATIVE('F4-NEG-self-reported-pass'),
  ],
  // Path-scoped coverage (coordinator gap 1). Each path an observed check does not cover, or reports as unusable,
  // earns no link or lint credit. The observed check's own JSON must show the defect (non-vacuity).
  'F4-NEG-partial-path': NEGATIVE('F4-NEG-partial-path', { path: ['actions', 'lint-run', 'json', 'links', 'checked'], operator: 'equals', expected: 1 }),
  'F4-NEG-unsupported-link': NEGATIVE('F4-NEG-unsupported-link', { path: ['actions', 'lint-run', 'json', 'coverage', 'unsupported'], operator: 'notEquals', expected: [] }),
  'F4-NEG-not-governed': NEGATIVE('F4-NEG-not-governed', { path: ['actions', 'lint-run', 'json', 'coverage', 'unsupported', 0, 'reason'], operator: 'equals', expected: 'not governed' }),
  'F4-NEG-not-on-disk': NEGATIVE('F4-NEG-not-on-disk', { path: ['actions', 'lint-run', 'json', 'coverage', 'unsupported', 0, 'reason'], operator: 'equals', expected: 'not on disk' }),
};

// Reminder non-credit (coordinator gap 2). The same valid edit with and without the F2 prose-share reminder: credit must
// match, and the reminder must appear in no credit field. Both carry the positive's RED for credit.
const PLAN_REMINDER = {
  'F4-REM-prose-share-present': [
    { id: 'rem-present.reminder-observed', path: ['actions', 'lint-run', 'json', 'reminders', 0, 'code'], operator: 'equals', expected: 'prose-share', status: 'CONTROL', note: 'the reminder is really present in the observed check' },
    { id: 'rem-present.pilot-credit', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: true, status: 'RED', reason: RED_IMPLEMENTATION },
  ],
  'F4-REM-prose-share-absent': [
    { id: 'rem-absent.no-reminder', path: ['actions', 'lint-run', 'json', 'reminders'], operator: 'equals', expected: [], status: 'CONTROL', note: 'the reminder is really absent in the observed check' },
    { id: 'rem-absent.pilot-credit', path: ['pilot', 'pilotCredit'], operator: 'equals', expected: true, status: 'RED', reason: RED_IMPLEMENTATION },
  ],
};

let passCount = 0;
let failCount = 0;
let redCount = 0;
let infraCount = 0;

function record(status, id, detail) {
  const suffix = detail ? ` - ${detail}` : '';
  if (status === 'PASS') passCount += 1;
  else if (status === 'RED') redCount += 1;
  else if (status === 'FAIL') failCount += 1;
  else infraCount += 1;
  console.log(`   ${status.padEnd(5)} ${id}${suffix}`);
}

// Runs one replay and checks its plan. Child faults are INFRA, and a RED that passes is a FAIL.
function checkReplay(caseId, distribution, mode, options, plan) {
  const label = `${caseId}@${mode}`;
  const item = CASE(caseId);
  let root;
  try {
    root = fx.replayCase(item, distribution, options);
  } catch (error) {
    record('INFRA', `${label}@${distribution}`, `replay crash: ${error.message}`);
    return;
  }
  const faults = fx.infrastructureFaults(item, root, options.pilot === undefined ? 'off' : 'on');
  if (faults.length) {
    record('INFRA', `${label}@${distribution}`, faults.map(fault => `${fault.actionId}: ${fault.message}`).join('; '));
    return;
  }
  const results = fx.evaluateAll(root, plan.map(entry => ({ id: entry.id, path: entry.path, operator: entry.operator, expected: entry.expected })));
  plan.forEach((entry, index) => {
    const result = results[index];
    const id = `${label}.${entry.id}@${distribution}`;
    if (entry.status === 'CONTROL') {
      const detail = result.pass ? '' : `expected ${JSON.stringify(result.expected)} at ${entry.path.join('.')}, got ${JSON.stringify(result.actual).slice(0, 160)}`;
      record(result.pass ? 'PASS' : 'FAIL', id, detail);
    } else if (result.pass) {
      record('FAIL', id, 'RED assertion unexpectedly passed now (expected to fail for its stated missing-implementation reason)');
    } else {
      record('RED', id, `${entry.reason}; actual ${JSON.stringify(result.actual).slice(0, 120)}`);
    }
  });
  return root;
}

// Reminder non-credit across the two replays: identical credit, and no pilot report field names the reminder.
function reminderNonCredit(withReminder, withoutReminder, distribution) {
  const creditOf = root => JSON.stringify([root.pilot && root.pilot.pilotCredit, root.pilot && root.pilot.creditedCapabilities]);
  const same = creditOf(withReminder) === creditOf(withoutReminder);
  record(same ? 'PASS' : 'FAIL', `rem.identical-credit@${distribution}`, same ? '' : `credit differs: ${creditOf(withReminder)} vs ${creditOf(withoutReminder)}`);
  const named = JSON.stringify(withReminder.pilot || null).includes('prose-share');
  record(named ? 'FAIL' : 'PASS', `rem.not-in-credit-field@${distribution}`, named ? 'the reminder name appears in the pilot report' : '');
}

// ---- Part A: replays through the real hook and CLI entries, both legs ---------------------------------------

function partA() {
  console.log('\n== Part A: F4 replay through the real entries (ON with preloader, production, OFF) ==');
  for (const distribution of LEGS.map(leg => leg.id)) {
    checkReplay('F4-POS-body-edit', distribution, 'on', { pilot: '1', preload: true }, PLAN['F4-POS-body-edit@on']);
    checkReplay('F4-POS-body-edit', distribution, 'production', { pilot: '1' }, PLAN['F4-POS-body-edit@production']);
    checkReplay('F4-POS-body-edit', distribution, 'off', {}, PLAN['F4-POS-body-edit@off']);
    for (const caseId of Object.keys(PLAN_NEGATIVE)) {
      checkReplay(caseId, distribution, 'on', { pilot: '1', preload: true }, PLAN_NEGATIVE[caseId]);
    }
    const withReminder = checkReplay('F4-REM-prose-share-present', distribution, 'on', { pilot: '1', preload: true }, PLAN_REMINDER['F4-REM-prose-share-present']);
    const withoutReminder = checkReplay('F4-REM-prose-share-absent', distribution, 'on', { pilot: '1', preload: true }, PLAN_REMINDER['F4-REM-prose-share-absent']);
    if (withReminder && withoutReminder) reminderNonCredit(withReminder, withoutReminder, distribution);
  }
}

// ---- Part B: provider-level negatives, which the replay cannot reach because the provider is not wired ----------

function providerFor(leg, input) {
  return require(path.join(leg.lib, 'doc-reconciliation-provider.js')).createClaudeOriginProvider(input);
}

function captureOf(name, edit) {
  const payload = JSON.parse(fs.readFileSync(path.join(CAPTURE_DIR, name), 'utf8'));
  if (edit) edit(payload);
  return payload;
}

function partB() {
  console.log('\n== Part B: provider negatives and live-gate boundary (per leg) ==');
  for (const leg of LEGS) {
    const builder = require(path.join(leg.lib, 'doc-reconciliation-provider.js')).buildCaptureRecord;

    // A SubagentStop whose final message says REJECT must not close a review as approve (A3 section 3).
    {
      const payload = captureOf('payload-subagent-stop.json', p => { p.last_assistant_message = 'REJECT: the document is incorrect.'; });
      const record = builder(payload, 'SubagentStop', ROOT);
      record.ref = 'f4-rev';
      const provider = providerFor(leg, { hostId: 'claude-code', sessionId: payload.session_id, workspaceRoot: ROOT, taskId: 'f4-task', workflowId: 'f4-wf', workflowRevision: 1, principals: { author: 'f4-author-session', executors: [] }, captures: [record], qualification: FAKE_DI });
      const response = provider.resolveEvent({ reference: 'f4-rev', identity: null });
      const approved = response.status === 'accepted' && response.event && response.event.verdict === 'approve';
      redWhen(approved, `F4-PROV-reject-not-approved@${leg.id}`, `${RED_REJECT}; a REJECT final message was accepted with verdict approve`);
    }

    // Absent `interrupted` is unknown, not false, so the success mapping must not credit it (A3 section 1).
    {
      const payload = captureOf('payload-post-tool-use-success.json', p => { delete p.tool_response.interrupted; });
      const record = builder(payload, 'PostToolUse', ROOT);
      record.ref = 'f4-exec';
      const provider = providerFor(leg, { hostId: 'claude-code', sessionId: payload.session_id, workspaceRoot: ROOT, taskId: 'f4-task', workflowId: 'f4-wf', workflowRevision: 1, principals: { author: 'f4-author-session', executors: [] }, captures: [record], qualification: FAKE_DI });
      const response = provider.resolveEvent({ reference: 'f4-exec', identity: null });
      redWhen(response.status === 'accepted', `F4-PROV-interrupted-absent-not-credited@${leg.id}`, `${RED_INTERRUPTED}; the absent field was credited as success`);
    }

    // A non-empty garbage file in the retained live directory is not qualification (A3 section 4, size-only acceptance).
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-live-'));
      try {
        const copy = path.join(tmp, 'hooks', 'scripts', 'lib');
        fs.mkdirSync(copy, { recursive: true });
        fs.copyFileSync(path.join(leg.lib, 'doc-reconciliation-provider.js'), path.join(copy, 'doc-reconciliation-provider.js'));
        const live = path.join(tmp, LIVE_REL);
        fs.mkdirSync(live, { recursive: true });
        fs.writeFileSync(path.join(live, 'README.md'), 'garbage\n');
        fs.writeFileSync(path.join(live, 'capture.sanitized.jsonl'), 'garbage\n');
        const isolated = require(path.join(copy, 'doc-reconciliation-provider.js')).createClaudeOriginProvider({ hostId: 'claude-code', sessionId: 'f4-sess', workspaceRoot: tmp });
        const context = isolated.resolveContext({});
        redWhen(context.status === 'accepted', `F4-LIVE-garbage-withholds@${leg.id}`, `${RED_LIVE_GATE}; non-empty garbage opened the gate`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }

    // The preloader boundary: with it, only the qualification changes. Without it, the production gate stays unmet.
    partBPreloadBoundary(leg);
  }
}

// A provider-level RED. `violated` is the current failure, which is the expected RED. A requirement that already holds
// makes the RED unreal, so it is a FAIL.
function redWhen(violated, id, reason) {
  if (violated) record('RED', id, reason);
  else record('FAIL', id, 'RED assertion unexpectedly passed now (the requirement already holds)');
}

const RED_REJECT = 'missing-implementation: a quality-review verdict is hard-coded to approve and no structured verdict is parsed; SubagentStop alone must never approve (A3 section 3)';
const RED_INTERRUPTED = 'missing-implementation: buildCaptureRecord coerces an absent interrupted field to false, so unknown outcome becomes success; absence must stay unknown (A3 section 1)';
const RED_LIVE_GATE = 'missing-implementation: the retained live gate accepts any non-empty file, size-only acceptance; qualification must validate payloads (A3 section 4)';

function partBPreloadBoundary(leg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-preload-'));
  try {
    const entry = path.join(tmp, 'entry');
    fs.mkdirSync(path.join(entry, 'lib'), { recursive: true });
    fs.copyFileSync(path.join(leg.lib, 'doc-reconciliation-provider.js'), path.join(entry, 'lib', 'doc-reconciliation-provider.js'));
    const probe = path.join(entry, 'probe.js');
    fs.writeFileSync(probe, [
      "const provider = require('./lib/doc-reconciliation-provider.js');",
      'const captures = JSON.parse(process.env.F4_PROBE_CAPTURES || \'[]\');',
      "const origin = provider.createClaudeOriginProvider({ hostId: 'claude-code', sessionId: 'f4-sess', workspaceRoot: process.cwd(), taskId: 'f4-task', workflowId: 'f4-wf', workflowRevision: 1, principals: { author: 'f4-author', executors: [] }, captures });",
      "const context = origin.resolveContext({});",
      "const event = origin.resolveEvent({ reference: 'f4-exec', identity: null });",
      "process.stdout.write(JSON.stringify({ context: context.status, event: event.status }));",
    ].join('\n') + '\n');
    const capture = { ref: 'f4-exec', event: 'PostToolUse', command: LINT_COMMAND, cwd: tmp, tool_use_id: 'toolu_f4_probe', session_id: 'f4-sess', interrupted: false, responseDigest: 'a'.repeat(64), responseRef: 'host-payload/PostToolUse/f4' };
    const run = (args, captureList) => {
      const result = spawnSync(process.execPath, args, { cwd: entry, encoding: 'utf8', env: { ...process.env, F4_PROBE_CAPTURES: JSON.stringify(captureList) }, timeout: 10000 });
      if (result.status !== 0) throw new Error(`probe exited ${result.status}: ${String(result.stderr).slice(0, 200)}`);
      return JSON.parse(result.stdout);
    };
    const withPreload = run(['--require', PRELOAD, probe], [capture]);
    record(withPreload.context === 'accepted' && withPreload.event === 'accepted' ? 'PASS' : 'FAIL', `C-PRELOAD-SUPPLIES-QUALIFICATION@${leg.id}`, withPreload.context === 'accepted' && withPreload.event === 'accepted' ? '' : JSON.stringify(withPreload));
    const emptyWithPreload = run(['--require', PRELOAD, probe], []);
    record(emptyWithPreload.event === 'unavailable' ? 'PASS' : 'FAIL', `C-PRELOAD-FABRICATES-NO-EVENT@${leg.id}`, emptyWithPreload.event === 'unavailable' ? '' : JSON.stringify(emptyWithPreload));
    const production = run([probe], [capture]);
    record(production.context === 'unavailable' ? 'PASS' : 'FAIL', `C-PRODUCTION-GATE-UNMET-WITHOUT-PRELOAD@${leg.id}`, production.context === 'unavailable' ? '' : JSON.stringify(production));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- Part C: preloader is test-only and not packaged or read by production code -------------------------------

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function partC() {
  console.log('\n== Part C: preloader is test-only (not packaged, no production reader) ==');
  const packaged = listFiles(path.join(ROOT, 'plugins'));
  const notPackaged = !packaged.some(file => path.basename(file).includes('qualification-preload'));
  record(notPackaged ? 'PASS' : 'FAIL', 'C-PRELOAD-NOT-PACKAGED', notPackaged ? '' : 'a preloader copy exists under plugins/');
  const readers = [...listFiles(path.join(ROOT, 'hooks')), ...listFiles(path.join(ROOT, 'harness-everything', 'scripts'))]
    .filter(file => fs.readFileSync(file, 'utf8').includes('qualification-preload'));
  record(readers.length === 0 ? 'PASS' : 'FAIL', 'C-PRELOAD-NO-PRODUCTION-READER', readers.length === 0 ? '' : `production files reference the preloader: ${readers.map(file => path.relative(ROOT, file)).join(', ')}`);
}

function main() {
  partA();
  partB();
  partC();
  console.log('\n== F4 RED evidence ==');
  console.log(`controls and passing checks: ${passCount}`);
  console.log(`RED assertions confirmed: ${redCount}`);
  console.log(`unexpected failures: ${failCount}`);
  console.log(`infrastructure faults: ${infraCount}`);
  const expectRed = process.argv.includes('--expect-red');
  if (!expectRed) {
    if (failCount === 0 && infraCount === 0 && redCount === 0) {
      console.log('\nSTATUS: GREEN (all assertions passed)');
      return 0;
    }
    console.log(`\nSTATUS: NOT-GREEN (red ${redCount}, unexpected ${failCount}, infra ${infraCount})`);
    return 1;
  }
  if (failCount === 0 && infraCount === 0) {
    console.log('\nSTATUS: RED-PLAN-MATCHED (all controls passed, all RED assertions failed for their stated reasons)');
    return 0;
  }
  console.log('\nSTATUS: RED-PLAN-MISMATCH');
  return 1;
}

process.exitCode = main();

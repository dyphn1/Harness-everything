#!/usr/bin/env node
'use strict';

// Retained workflow and Stop invariants after the E1 pilot was unhooked.
//
// One cell per (site × invariant) where the Z1 gap matrix gives a verdict. Each cell is owned by exactly one site and
// runs its own replay variants through the real hook, workflow and Stop entries (source and packaged legs), so a failure
// at one site cannot mask another. A cell is CONTROL when the invariant holds today and RED when it does not; a RED must
// fail for its stated invariant, never for an infrastructure fault. SKIP is reserved for the case-variant probe on a
// case-sensitive filesystem and is always reported.
//
// Modes:
//   (default)       run the matrix; exit 1 while any RED exists. Every RED is an actual failure, never a frozen expectation.
//   --json          print a machine-readable summary.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fx = require(path.join(__dirname, 'lib', 'doc-reconciliation-prep-fixtures'));
const { stage, EXPORT_FILE, SIBLING_CAPTURE } = require(path.join(__dirname, 'lib', 'doc-reconciliation-staged-tree'));
const replayHelper = require(path.join(__dirname, 'lib', 'doc-reconciliation-replay'));

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'corpus');
const CASES = path.join(__dirname, 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');
const LEGS = ['source', 'packaged'];
const POS_CASE = fx.readCaseCorpus(CASES).cases.find(item => item.id === 'F4-POS-body-edit');
const REQUIREMENTS = [
  { id: 'req-docs', stepType: 'doc-change', summary: 'Correct the checkout retry rule', acceptance: 'the governed reference body is reviewed' },
  { id: 'req-review', stepType: 'review', summary: 'Review the change', acceptance: 'an independent host review approves it' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'objective doc checks are recorded' },
];
const REVIEWER = 'agent-f4t12-reviewer';
const CANDIDATE = POS_CASE.input.candidateFiles['docs/a.md'];
const LINT_ARGS = ['check', '--workspace', '.', '--config', '.agents/harness-everything/project-docs.json', '--changed-path', 'docs/a.md'];
const LINT_TEXT = 'node {{DOC_CHECK}} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md';
const TOOL = (command, toolUseId, extra = {}) => ({ event: 'PostToolUse', toolName: 'Bash', command, toolUseId, success: true, ...extra });
const NPM_TEST = { id: 'npm-test', event: 'PostToolUse', toolName: 'Bash', command: 'npm test', toolUseId: 'tool-npm', success: true, checkpointAfter: 'generic' };
const EDIT = { id: 'edit-check', op: 'editDocCheck', payload: { append: '\n// F4-T12 matrix: one-byte change to the installed doc-check\n' } };
const VERIFY_BIND = { id: 'verify-bind', op: 'binding', payload: { stepId: 'req-verify', bindingId: 'verification-loop', disposition: 'loaded', evidence: 'verification loop skill located' }, expectExit: { on: [0, 2] } };
const REVIEW_PASS = { id: 'review-pass', op: 'step', payload: { stepId: 'req-review', disposition: 'pass', evidence: 'independent reviewer approved' }, expectExit: { on: [0, 2] } };
const VERIFY_PASS = { id: 'verify-pass', op: 'step', payload: { stepId: 'req-verify', disposition: 'pass', evidence: 'objective doc check recorded' }, expectExit: { on: [0, 2] } };
const OBSERVE = { id: 'observe-state', op: 'observeStateTree' };
const STOP = [{ id: 'stop', op: 'stop' }, { id: 'stop-generic', op: 'stopGeneric' }];
const APPROVE = `Review verdict: approve\nSummary: The governed document is consistent.\nReviewed artifact: docs/a.md sha256:${sha(CANDIDATE)}`;
const FAKE_REPORT = JSON.stringify({ schema: 'harness.doc-check.check.v1', command: 'harness.doc-check.check.v1', lint: { exit: 0, evidence: {}, diagnostics: [] }, links: { checked: 1, broken: [] }, coverage: { unsupported: [] }, reminders: [], capabilities: { 'doc-lint': { state: 'pass', checkedPaths: ['docs/a.md'], skipped: [] }, 'link-check': { state: 'pass', checkedPaths: ['docs/a.md'], skipped: [] } } }, null, 2) + '\n';

function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
const clone = value => JSON.parse(JSON.stringify(value));
// Content digests of the state files the observer parses, and the capture journal. An in-place change is a change even when
// the path list is the same, so S1-I2 compares these as well as the paths.
const STATE_KEYS = ['workflow', 'obligations', 'handoff', 'capture'];
const digestOf = value => sha(JSON.stringify(value ?? null));
const stateDigests = state => Object.fromEntries(STATE_KEYS.map(key => [key, digestOf(state[key])]));
// Paths added, and digests changed, between two observations of one state tree.
const hookDelta = (before, after) => ({
  added: after.stateFiles.filter(file => !before.stateFiles.includes(file)),
  changed: Object.keys(before.digests).filter(key => before.digests[key] !== after.digests[key]),
});
const streamFile = id => JSON.parse(fs.readFileSync(path.join(CORPUS, `${id}.json`), 'utf8'));

// Host probes. The case-variant check runs only where a case-variant spelling of the installed file resolves to it.
function caseVariantOf(file) { return path.join(path.dirname(file), path.basename(file).toUpperCase()); }
function caseVariantProbe(installed) {
  const variant = caseVariantOf(installed);
  if (!fs.existsSync(variant)) return { available: false, reason: 'the case-variant spelling does not resolve on this filesystem (case-sensitive host)' };
  try {
    return fs.realpathSync.native(variant) === fs.realpathSync.native(installed)
      ? { available: true, command: `node ${variant} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md` }
      : { available: false, reason: 'the case-variant spelling does not resolve to the installed file' };
  } catch (_) { return { available: false, reason: 'the case-variant spelling could not be resolved' }; }
}

// A byte-identical copy of the installed doc-check outside the install, with a valid-looking report: only the realpath
// decision (I1) can refuse it, because the pin accepts identical bytes.
const OUTSIDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'f4t12-outside-'));
const OUTSIDE_COPY = path.join(OUTSIDE_DIR, 'harness-everything', 'scripts', 'doc-check.js');
fs.mkdirSync(path.dirname(OUTSIDE_COPY), { recursive: true });
fs.copyFileSync(fx.DISTRIBUTIONS.source.docCheck, OUTSIDE_COPY);

function tracePreloader(file, trace) {
  fs.writeFileSync(file, `const M=require('module'), fs=require('fs'); const old=M._load; M._load=function(id,p,m){const x=old.apply(this,arguments);if(typeof id==='string'&&/(doc-reconciliation|state-persist|workflow-disposition|stop-gate)/.test(id))fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({module:id,requester:m&&m.filename})+'\\n');return x};\n`);
}

// A variant is a transformation of a stream's events and of the action sequence around them.
const VARIANTS = {
  base: {},
  'candidates-only': { only: event => /doc-check/.test(event.command || '') && !/npm test/.test(event.command || '') },
  'pre-edit': { preEdit: true },
  'post-edit': { postEdit: true },
  review: { review: true },
  'review-pre-edit': { review: true, preEdit: true },
  'review-post-edit': { review: true, postEdit: true },
  executor: { review: true, executor: true },
  'quoted-only': { only: event => !/"/.test(event.command || '') || event.id === 'event-02' },
  'copy-only': { only: () => false, copyOutside: true },
  'case-only': { only: () => false, caseVariant: true },
  'direct-only': { only: event => event.id === 'event-01' },
  drift: { driftEdit: true },
  'no-post-check': { noPostCheck: true },
  'drift-no-post-check': { driftEdit: true, noPostCheck: true },
  'base-snapshot': { snapshot: true },
};

function eventAction(event, index) {
  const id = `ev-${String(index + 1).padStart(2, '0')}`;
  const actions = [];
  if (event.runArgs) actions.push({ id: `${id}-run`, op: 'hostRun', payload: { command: 'doc-check', args: event.runArgs } });
  const payload = { event: event.event };
  if (event.toolName) payload.toolName = event.toolName;
  if (event.command !== undefined) payload.command = event.command;
  if (event.toolUseId) payload.toolUseId = event.toolUseId;
  if (event.runArgs && event.event === 'PostToolUse') payload.fromRun = `${id}-run`;
  if (event.event === 'PostToolUse') payload.response = { stdout: event.runArgs ? 'doc-check completed' : 'completed', stderr: '', interrupted: false };
  if (event.event === 'PostToolUseFailure') { payload.error = 'stable fixture failure'; payload.isInterrupt = false; }
  if (event.event === 'SubagentStart' || event.event === 'SubagentStop') { payload.agentId = event.agentId || `agent-${index + 1}`; payload.agentType = 'reviewer'; }
  if (event.event === 'SubagentStop') payload.lastAssistantMessage = event.lastAssistantMessage || 'APPROVE: reviewed the governed document.';
  actions.push({ id, op: 'hookDeliver', payload });
  return actions;
}

const isCandidate = event => /doc-check/.test(event.command || '') || Boolean(event.runArgs);

// Builds the definition for one (stream, variant) pair. The stream's events are the corpus data, unchanged.
function definitionFor(label, streamEvents, variant, installed) {
  const spec = VARIANTS[variant];
  const events = clone(streamEvents).filter(event => (spec.only ? spec.only(event) : true));
  const review = Boolean(spec.review);
  const actions = [
    { id: 'route', op: 'route', payload: { prompt: 'Update docs/a.md, review it independently, and verify it.' } },
    { id: 'plan', op: 'plan', payload: { requirements: '$requirements', strategy: 'iterative-single', evidence: 'bounded documentation loop' } },
    { id: 'start', op: 'start', payload: {} },
    { id: 'doc-pass', op: 'step', payload: { stepId: 'req-docs', disposition: 'pass', evidence: 'sentence corrected' } },
  ];
  if (!review) actions.push(clone(VERIFY_BIND));
  if (spec.snapshot) actions.push({ id: 'observe-pre', op: 'observeStateTree' });
  const candidateIndex = events.findIndex(isCandidate);
  let reviewInserted = false;
  events.forEach((event, index) => {
    if (spec.preEdit && index === candidateIndex) actions.push(clone(EDIT));
    if (review && event.event === 'SubagentStop') {
      event = { ...event, agentId: REVIEWER, lastAssistantMessage: APPROVE };
      actions.push({ id: 'agent-surface', op: 'hookDeliver', payload: { event: 'PostToolUse', toolName: 'Agent', command: 'agent-launch', toolUseId: 'toolu_f4t12_agent', response: { stdout: '', stderr: '', interrupted: false, agentId: REVIEWER } } });
      if (spec.executor) actions.push({ id: 'executor-run', op: 'hookDeliver', payload: { event: 'PostToolUse', toolName: 'Bash', command: LINT_TEXT, toolUseId: 'toolu_f4t12_exec', agentId: REVIEWER, response: { stdout: 'completed', stderr: '', interrupted: false } } });
      reviewInserted = true;
    }
    actions.push(...eventAction(event, index));
    if (event.checkpointAfter === 'generic') actions.push({ id: 'observe-generic', op: 'observeStateTree' });
    if (spec.postEdit && index === candidateIndex) actions.push(clone(EDIT));
  });
  if (review && !reviewInserted) throw new Error(`${label}: review variant needs a SubagentStop event`);
  if (spec.copyOutside) actions.push({ id: 'copy-run', op: 'hookDeliver', payload: { event: 'PostToolUse', toolName: 'Bash', command: `node ${OUTSIDE_COPY} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md`, toolUseId: 'toolu_f4t12_copy', response: { stdout: FAKE_REPORT, stderr: '', interrupted: false } } });
  if (spec.caseVariant) {
    const probe = caseVariantProbe(installed);
    if (probe.available) {
      actions.push({ id: 'case-run', op: 'hostRun', payload: { command: 'doc-check', args: LINT_ARGS } });
      actions.push({ id: 'case-post', op: 'hookDeliver', payload: { event: 'PostToolUse', command: probe.command, toolUseId: 'toolu_f4t12_case', fromRun: 'case-run' } });
    }
  }
  if (spec.driftEdit) actions.push(clone(EDIT));
  if (review) actions.push(clone(REVIEW_PASS), clone(VERIFY_BIND));
  actions.push(clone(OBSERVE));
  if (!spec.noPostCheck) actions.push(clone(VERIFY_PASS), { id: 'observe-after', op: 'observeStateTree' });
  actions.push(...clone(STOP));
  if (spec.noPostCheck) actions.push({ id: 'observe-after', op: 'observeStateTree' });
  return { id: label, requirements: clone(review ? REQUIREMENTS : POS_CASE.requirements), actions, input: clone(POS_CASE.input) };
}

// Synthetic streams for the drift and withhold replays (Z1 §4 "runtime drift" and "malformed" rows). They use the corpus
// event shape, so the same builder runs them.
const SYNTHETIC = {
  'lookalike-npm-drift': [{ id: 'event-01', event: 'PostToolUse', toolName: 'Bash', command: 'node ./scripts/doc-check.js check', toolUseId: 'tool-1', success: true }, clone(NPM_TEST)],
  'malformed-npm-drift': [{ id: 'event-01', event: 'PostToolUse', toolName: 'Bash', command: `sh -c "node ${'{{DOC_CHECK}}'} check"`, toolUseId: 'tool-1', success: true }, clone(NPM_TEST)],
  'runtime-npm-drift': [streamFile('on-runtime-drift-later-npm-test').events[0], clone(NPM_TEST)],
  'generic-doc-runtime-drift': [clone(NPM_TEST), streamFile('on-runtime-drift-later-npm-test').events[0]],
  'generic-edit-doc-runtime-drift': [clone(NPM_TEST), { id: 'edit-doc', event: 'PostToolUse', toolName: 'Edit', command: 'docs/a.md', toolUseId: 'tool-edit-doc', success: true }, streamFile('on-runtime-drift-later-npm-test').events[0]],
  'doc-only-runtime-drift': [streamFile('on-runtime-drift-later-npm-test').events[0]],
};
function streamEvents(id) { return SYNTHETIC[id] ? SYNTHETIC[id] : streamFile(id).events; }

// Preserved corpus streams and their mode, as the C1 helper runs them.
const STREAM_MODE = {
  'off-capture-only': 'off', 'off-legacy': 'off', 'on-normal-session': 'on', 'on-valid-direct-quoted-review': 'on',
  'on-malformed': 'on', 'on-lookalikes-runtime-mutations': 'on', 'on-runtime-drift-later-npm-test': 'on', 'on-concurrent-writers': 'on',
  'generic-doc-runtime-drift': 'on', 'generic-edit-doc-runtime-drift': 'on', 'doc-only-runtime-drift': 'on',
};

const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4t12-trace-'));
const runs = new Map();

function observe(definition, root, mode, leg, modules) {
  const state = (root.actions['observe-state'] && root.actions['observe-state'].state) || {};
  const json = (root.actions['observe-state'] && root.actions['observe-state'].json) || {};
  const records = (state.capture && state.capture.records) || [];
  return {
    leg, mode,
    faults: fx.infrastructureFaults(definition, root, mode).map(item => `${item.actionId}: ${item.message}`),
    pilot: root.pilot || null,
    handoff: state.handoff || {},
    preHook: root.actions['observe-pre'] ? { stateFiles: root.actions['observe-pre'].json.stateFiles, digests: stateDigests(root.actions['observe-pre'].state || {}) } : null,
    obligations: state.obligations || null,
    stateFiles: json.stateFiles || [],
    digests: stateDigests(state),
    after: (root.actions['observe-after'] && root.actions['observe-after'].state && root.actions['observe-after'].state.handoff) || null,
    captures: records,
    modules,
    verify: { exit: root.actions['verify-pass'] && root.actions['verify-pass'].exitCode, stdout: root.actions['verify-pass'] && root.actions['verify-pass'].stdout },
    review: { exit: root.actions['review-pass'] && root.actions['review-pass'].exitCode },
    genericCheckpoint: (root.actions['observe-generic'] && root.actions['observe-generic'].state && root.actions['observe-generic'].state.handoff) || null,
    stop: { exit: root.actions.stop && root.actions.stop.exitCode, stderr: (root.actions.stop && root.actions.stop.stderr) || '' },
    generic: { exit: root.actions['stop-generic'] && root.actions['stop-generic'].exitCode, stderr: (root.actions['stop-generic'] && root.actions['stop-generic'].stderr) || '' },
    rootActions: Object.keys(root.actions),
  };
}

// The shipped qualification export and its sibling capture are copied into each staged tree (the staged tree starts without
// them), so the ON gate opens exactly as it does for users.
const LIB_OF_LEG = { source: path.join(ROOT, 'hooks', 'scripts', 'lib'), packaged: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib') };

// The provider's verdict and reason codes for every doc-check and review record, read from the staged provider module.
function verdictsFor(libDir, captures) {
  const out = {};
  const identityRecord = captures.find(record => record && record.observedIdentity);
  if (!identityRecord) return out;
  const provider = require(path.join(libDir, 'doc-reconciliation-provider.js'));
  const identity = identityRecord.observedIdentity;
  const origin = provider.createClaudeOriginProvider({ hostId: 'claude-code', sessionId: identityRecord.session_id, workspaceRoot: identityRecord.cwd, workflowId: identity.workflowId, workflowRevision: identity.workflowRevision, taskId: 'task-f4t12', principals: { author: identityRecord.session_id, executors: [] }, baseline: identity.baselinePin, captures });
  for (const record of captures) {
    if (!record || !record.ref) continue;
    const references = record.event === 'SubagentStop' ? [record.ref] : (/doc-check/.test(record.command || '') ? [`${record.ref}#doc-lint`] : []);
    for (const reference of references) {
      const response = origin.resolveEvent({ reference, identity: null });
      out[reference] = { status: response.status, codes: (response.diagnostics || []).map(item => item && item.code) };
    }
  }
  return out;
}

function runVariant(leg, streamId, variant, mode) {
  const key = `${leg}|${streamId}|${mode}|${variant}`;
  if (runs.has(key)) return runs.get(key);
  const label = `F4T12-${streamId}-${variant}-${leg}`;
  const staged = stage(leg);
  let result;
  try {
    fs.copyFileSync(path.join(LIB_OF_LEG[leg], EXPORT_FILE), staged.exportFile);
    fs.copyFileSync(path.join(LIB_OF_LEG[leg], SIBLING_CAPTURE), staged.captureFile);
    const definition = definitionFor(label, streamEvents(streamId), variant, staged.dist.docCheck);
    const spy = path.join(traceDir, `${sha(key).slice(0, 12)}-spy.js`);
    const trace = path.join(traceDir, `${sha(key).slice(0, 12)}.jsonl`);
    tracePreloader(spy, trace);
    const previous = process.env.F4_C1_TRACE;
    process.env.F4_C1_TRACE = trace;
    try {
      const root = fx.replayCase(definition, staged.dist, { ...(mode === 'on' ? { pilot: '1' } : {}), nodeArgs: ['--require', spy] });
      const modules = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      result = observe(definition, root, mode, leg, modules);
      result.verdicts = verdictsFor(staged.libDir, result.captures);
      result.caseProbe = (VARIANTS[variant] || {}).caseVariant ? caseVariantProbe(staged.dist.docCheck) : null;
    } catch (error) {
      result = { leg, mode, faults: [`replay threw: ${error.message}`], error: true };
    } finally {
      if (previous === undefined) delete process.env.F4_C1_TRACE; else process.env.F4_C1_TRACE = previous;
    }
  } finally {
    staged.cleanup();
  }
  runs.set(key, result);
  return result;
}

const run = (leg, streamId, variant) => runVariant(leg, streamId, variant, STREAM_MODE[streamId] || 'on');

// ---- Predicates. Each takes the runs for one leg and returns { pass, actual }. -------------------------------------------

const lastVerify = obs => obs.handoff.lastVerifyAt ?? null;
const creditedOf = obs => (obs.pilot && obs.pilot.creditedCapabilities ? [...obs.pilot.creditedCapabilities].sort() : []);
const acceptedRefs = obs => (obs.pilot && obs.pilot.acceptedRefs) || [];
const docRecords = obs => obs.captures.filter(record => record.event === 'PostToolUse' && /doc-check/.test(record.command || ''));
const quotedRecords = obs => obs.captures.filter(record => record.event === 'PostToolUse' && /node "/.test(record.command || ''));
const diagCodes = obs => ((obs.pilot && obs.pilot.diagnostics) || []).map(item => (item && item.code) || item);

// S1-I2 negative control: an in-place append to a pre-existing state file, on a copy. The path list is unchanged, so only
// the content digest can report it; a path-only comparison must miss it.
function inPlaceAppendControl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4t4-s1i2-'));
  const file = path.join(dir, 'handoff-state.json');
  fs.writeFileSync(file, '{"lastVerifyAt":1}\n', 'utf8');
  const snap = () => ({ stateFiles: fs.readdirSync(dir), digests: { handoff: sha(fs.readFileSync(file, 'utf8')) } });
  const before = snap();
  fs.appendFileSync(file, '{"lastVerifyAt":2}\n', 'utf8');
  const delta = hookDelta(before, snap());
  fs.rmSync(dir, { recursive: true, force: true });
  return { caught: delta.changed.join() === 'handoff', pathOnlyMisses: delta.added.length === 0 };
}

// Each cell: site, invariant, the runs it needs (stream, variant), the predicate, and the invariant it states.
const CELLS = [
  // OFF legacy capture-only callbacks must not add state; a content-digest control catches in-place writes.
  { id: 'S1-I2', site: 'state-persist entry and workspace binding', inv: 'I2', stated: 'the OFF capture-only route adds no file, changes no existing state file or capture record, and the content-digest control catches in-place writes',
    runs: [['off-capture-only', 'base-snapshot']],
    check: r => {
      const off = r['off-capture-only|base-snapshot'];
      const delta = hookDelta(off.preHook, off);
      const control = inPlaceAppendControl();
      return { pass: delta.added.length === 0 && delta.changed.length === 0 && off.captures.length === 0 && control.caught && control.pathOnlyMisses,
        actual: { added: delta.added, changed: delta.changed, captures: off.captures.length, control } };
    } },

  // locks: R3 — "only affected evidence is revoked"; control: S10-I2
  { id: 'S7-I1', site: 'generic verification persistence', inv: 'I1', stated: 'ordinary generic verification remains in public handoff state after a runtime-file change',
    runs: [['runtime-npm-drift', 'drift']],
    check: r => {
      const obs = r['runtime-npm-drift|drift'];
      const before = obs.handoff;
      const after = obs.after || {};
      return { pass: typeof before.lastVerifyAt === 'number' && after.lastVerifyAt === before.lastVerifyAt
        && after.lastVerifyExitCode === before.lastVerifyExitCode,
      actual: { before: { lastVerifyAt: before.lastVerifyAt ?? null, lastVerifyExitCode: before.lastVerifyExitCode ?? null },
        after: { lastVerifyAt: after.lastVerifyAt ?? null, lastVerifyExitCode: after.lastVerifyExitCode ?? null } } };
    } },
  // locks: unresolved — OFF withholding absence is retained I2 (A4), not in the A/B/C/R3 table
  { id: 'S8-I2', site: 'workflow verification', inv: 'I2', stated: 'the ordinary verify step succeeds after a failed tool event is followed by a successful check',
    runs: [['off-legacy', 'base']],
    check: r => ({ pass: r['off-legacy|base'].verify.exit === 0, actual: r['off-legacy|base'].verify.exit }) },
  // locks: historical — retired 2026-10-23 (owner decision 5): S8-I3 origin-marker key predicate; see ci/archive/325-prep/README.md
  // locks: R3 — "only affected evidence is revoked"; control: S7-I1
  { id: 'S10-I2', site: 'generic verification wrapper and runtime CLI', inv: 'I2', stated: 'the generic verifier is unchanged by the pilot switch: a legacy success sets the timestamp',
    runs: [['off-legacy', 'base']],
    check: r => ({ pass: lastVerify(r['off-legacy|base']) !== null, actual: lastVerify(r['off-legacy|base']) }) },
  // locks: R3 — "only affected evidence is revoked"; control: S7-I1
  { id: 'S10-I3', site: 'generic verification wrapper and runtime CLI', inv: 'I3', stated: 'generic verification remains visible in the public handoff field and the generic Stop stays silent after a runtime change',
    runs: [['runtime-npm-drift', 'drift-no-post-check']],
    check: r => {
      const obs = r['runtime-npm-drift|drift-no-post-check'];
      const genericBefore = obs.genericCheckpoint?.lastVerifyAt ?? null;
      const genericAfter = obs.after?.lastVerifyAt ?? null;
      const pass = typeof genericBefore === 'number' && genericAfter === genericBefore
        && !/\[Verification Reminder\]/.test(obs.generic.stderr);
      return { pass, actual: { genericBefore, genericAfter, aggregateAfter: obs.after?.lastVerifyAt ?? null, genericStop: obs.generic.stderr.trim().slice(0, 120) } };
    } },
  { id: 'S11-I1', site: 'workflow and generic Stop readers', inv: 'I3', stated: 'generic verification alone leaves req-verify pending at workflow Stop while generic Stop remains quiet',
    runs: [['off-legacy', 'no-post-check']],
    check: r => {
      const obs = r['off-legacy|no-post-check'];
      const verifyRecorded = typeof obs.handoff.lastVerifyAt === 'number';
      const workflowPending = /step:req-verify:pending/.test(obs.stop.stderr);
      const genericQuiet = !/\[Verification Reminder\]/.test(obs.generic.stderr);
      return { pass: verifyRecorded && workflowPending && genericQuiet,
        actual: { verifyRecorded, workflowStop: obs.stop.stderr.trim(), genericStop: obs.generic.stderr.trim() } };
    } },
];

// ---- Evaluation ---------------------------------------------------------------------------------------------------------

function evaluate(cell, leg) {
  const map = {};
  for (const [stream, variant] of cell.runs) map[`${stream}|${variant}`] = run(leg, stream, variant);
  const failed = Object.entries(map).filter(([, obs]) => obs.error || obs.faults.length);
  if (failed.length) return { status: 'INFRA', reason: failed.map(([key, obs]) => `${key}: ${obs.faults.join('; ') || 'replay error'}`).join(' | ') };
  // Variants are keyed by stream and variant; the predicate reads them by the same keys.
  const outcome = cell.check(map, leg);
  if (outcome.skip) return { status: 'SKIP', reason: outcome.skip };
  return { status: outcome.pass ? 'CONTROL' : 'RED', stated: cell.stated, actual: outcome.actual };
}

async function main(argv) {
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose');
  const results = {};
  for (const leg of LEGS) for (const cell of CELLS) {
    const outcome = evaluate(cell, leg);
    results[`${cell.id}@${leg}`] = { cell: cell.id, leg, site: cell.site, inv: cell.inv, ...outcome };
  }
  const counts = {};
  for (const item of Object.values(results)) counts[item.status] = (counts[item.status] || 0) + 1;
  if (json) { process.stdout.write(JSON.stringify({ results, counts }) + '\n'); return 0; }
  for (const item of Object.values(results)) {
    const detail = item.status === 'RED' || (verbose && item.status === 'CONTROL') ? `${item.stated}; actual ${JSON.stringify(item.actual).slice(0, 180)}` : item.status === 'SKIP' || item.status === 'INFRA' ? item.reason : (item.stated || '');
    console.log(`   ${item.status.padEnd(7)} ${item.cell}@${item.leg} [${item.site} / ${item.inv}] - ${detail}`);
  }
  const reds = Object.values(results).filter(item => item.status === 'RED').map(item => `${item.cell}@${item.leg}`).sort();
  const infra = Object.values(results).filter(item => item.status === 'INFRA').length;
  console.log(`\nF4 invariant matrix: ${counts.CONTROL || 0} CONTROL, ${counts.RED || 0} RED, ${counts.SKIP || 0} SKIP, ${infra} INFRA`);
  console.log(reds.length || infra ? `STATUS: NOT-GREEN (red ${reds.length}, infra ${infra})` : 'STATUS: GREEN');
  return reds.length || infra ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { CELLS };

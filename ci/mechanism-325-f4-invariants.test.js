#!/usr/bin/env node
'use strict';

// #325 F4-T12: the I1–I4 invariant matrix over the C1 corpus (F4-Z1 §2 gap matrix, §4 replays and mutation table).
//
// One cell per (site × invariant) where the Z1 gap matrix gives a verdict. Each cell is owned by exactly one site and
// runs its own replay variants through the real hook, workflow and Stop entries (source and packaged legs), so a failure
// at one site cannot mask another. A cell is CONTROL when the invariant holds today and RED when it does not; a RED must
// fail for its stated invariant, never for an infrastructure fault. SKIP is reserved for the case-variant probe on a
// case-sensitive filesystem and is always reported.
//
// Modes:
//   (default)       run the matrix; exit 1 while any RED exists. Every RED is an actual failure, never a frozen expectation.
//   --json          print a machine-readable summary (used by the mutation runner).
//   --mutants       run the mutation table (Z1 §4) on scratch copies; fail if a mutant is not applied, is not detected by
//                   its owning cell, or is detected only by a different cell.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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
const NPM_TEST = { id: 'npm-test', event: 'PostToolUse', toolName: 'Bash', command: 'npm test', toolUseId: 'tool-npm', success: true };
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
  actions.push(clone(OBSERVE), clone(VERIFY_PASS), { id: 'observe-after', op: 'observeStateTree' }, ...clone(STOP));
  return { id: label, requirements: clone(review ? REQUIREMENTS : POS_CASE.requirements), actions, input: clone(POS_CASE.input) };
}

// Synthetic streams for the drift and withhold replays (Z1 §4 "runtime drift" and "malformed" rows). They use the corpus
// event shape, so the same builder runs them.
const SYNTHETIC = {
  'lookalike-npm-drift': [{ id: 'event-01', event: 'PostToolUse', toolName: 'Bash', command: 'node ./scripts/doc-check.js check', toolUseId: 'tool-1', success: true }, clone(NPM_TEST)],
  'malformed-npm-drift': [{ id: 'event-01', event: 'PostToolUse', toolName: 'Bash', command: `sh -c "node ${'{{DOC_CHECK}}'} check"`, toolUseId: 'tool-1', success: true }, clone(NPM_TEST)],
  'runtime-npm-drift': [streamFile('on-runtime-drift-later-npm-test').events[0], clone(NPM_TEST)],
};
function streamEvents(id) { return SYNTHETIC[id] ? SYNTHETIC[id] : streamFile(id).events; }

// Preserved corpus streams and their mode, as the C1 helper runs them.
const STREAM_MODE = {
  'off-capture-only': 'off', 'off-legacy': 'off', 'on-normal-session': 'on', 'on-valid-direct-quoted-review': 'on',
  'on-malformed': 'on', 'on-lookalikes-runtime-mutations': 'on', 'on-runtime-drift-later-npm-test': 'on', 'on-concurrent-writers': 'on',
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
    obligations: state.obligations || null,
    stateFiles: json.stateFiles || [],
    after: (root.actions['observe-after'] && root.actions['observe-after'].state && root.actions['observe-after'].state.handoff) || null,
    captures: records,
    modules,
    verify: { exit: root.actions['verify-pass'] && root.actions['verify-pass'].exitCode, stdout: root.actions['verify-pass'] && root.actions['verify-pass'].stdout },
    review: { exit: root.actions['review-pass'] && root.actions['review-pass'].exitCode },
    stop: { exit: root.actions.stop && root.actions.stop.exitCode },
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

const bindingFiles = obs => obs.stateFiles.filter(file => file.startsWith('session-workspaces/'));
const lastVerify = obs => obs.handoff.lastVerifyAt ?? null;
const creditedOf = obs => (obs.pilot && obs.pilot.creditedCapabilities ? [...obs.pilot.creditedCapabilities].sort() : []);
const acceptedRefs = obs => (obs.pilot && obs.pilot.acceptedRefs) || [];
const docRecords = obs => obs.captures.filter(record => record.event === 'PostToolUse' && /doc-check/.test(record.command || ''));
const quotedRecords = obs => obs.captures.filter(record => record.event === 'PostToolUse' && /node "/.test(record.command || ''));
const diagCodes = obs => ((obs.pilot && obs.pilot.diagnostics) || []).map(item => (item && item.code) || item);
const timestampSourceKeys = obs => Object.keys(obs.handoff).filter(key => /lastVerify/i.test(key) && /(source|kind|origin)/i.test(key));

// Each cell: site, invariant, the runs it needs (stream, variant), the predicate, and the invariant it states.
const CELLS = [
  // locks: unresolved — OFF pre-switch binding is retained I2 (A4), not in the A/B/C/R3 table
  { id: 'S1-I2', site: 'state-persist entry and workspace binding', inv: 'I2', stated: 'the OFF capture-only route writes no workspace binding before the pilot switch',
    runs: [['off-capture-only', 'base']],
    check: r => ({ pass: bindingFiles(r['off-capture-only|base']).length === 0, actual: bindingFiles(r['off-capture-only|base']) }) },
  // locks: A — "Pilot ON credits valid evidence (no false PASS)"; control: S6-I4
  { id: 'S2-I1', site: 'state-persist verification', inv: 'I1', stated: 'a refused doc-check candidate never writes the doc-check timestamp, and a valid direct run does',
    runs: [['on-malformed', 'candidates-only'], ['on-valid-direct-quoted-review', 'direct-only']],
    check: r => { const refused = lastVerify(r['on-malformed|candidates-only']); const valid = lastVerify(r['on-valid-direct-quoted-review|direct-only']); return { pass: refused === null && valid !== null, actual: { refused, valid } }; } },
  // locks: C — "unavailable observations ... cannot become a false PASS"; control: S6-I1
  { id: 'S2-I2', site: 'state-persist verification', inv: 'I2', stated: 'a changed-before-run doc-check never writes the timestamp before pilot acceptance',
    runs: [['on-lookalikes-runtime-mutations', 'pre-edit']],
    check: r => ({ pass: lastVerify(r['on-lookalikes-runtime-mutations|pre-edit']) === null, actual: lastVerify(r['on-lookalikes-runtime-mutations|pre-edit']) }) },
  // locks: unresolved — key-name predicate (lastVerify plus source/kind/origin) is mechanism-specific; the R3 behaviour is S7-I1
  { id: 'S2-I3', site: 'state-persist verification', inv: 'I3', stated: 'the doc-check timestamp carries a source tag, so withdrawal can remove only its own record',
    runs: [['on-valid-direct-quoted-review', 'review']],
    check: r => ({ pass: timestampSourceKeys(r['on-valid-direct-quoted-review|review']).length > 0, actual: Object.keys(r['on-valid-direct-quoted-review|review'].handoff) }) },
  // locks: B — "host payload fields are re-validated at assessment time"; control: S6-I4
  { id: 'S2-I4', site: 'state-persist verification', inv: 'I4', stated: 'state-persist and the provider agree on a safely quoted doc-check invocation: the timestamp is set exactly when the provider accepts that record',
    runs: [['on-valid-direct-quoted-review', 'quoted-only']],
    check: r => { const obs = r['on-valid-direct-quoted-review|quoted-only']; const quoted = quotedRecords(obs); const accepted = quoted.length > 0 && acceptedRefs(obs).some(ref => ref.startsWith(quoted[0].ref)); return { pass: (lastVerify(obs) !== null) === accepted, actual: { timestamp: lastVerify(obs) !== null, providerAccepted: accepted } }; } },
  // locks: B — "host payload fields are re-validated at assessment time"; control: S6-I4
  { id: 'S3-I1', site: 'capture builder and event/journal writer', inv: 'I1', stated: 'a wrong-path candidate records no doc-check material (no digest, no stdout)',
    runs: [['on-lookalikes-runtime-mutations', 'base']],
    check: r => { const wrong = r['on-lookalikes-runtime-mutations|base'].captures.find(record => /\.\/scripts\/doc-check\.js/.test(record.command || '')); return { pass: Boolean(wrong) && !wrong.implementationDigest && typeof wrong.stdout !== 'string', actual: wrong ? { digest: Boolean(wrong.implementationDigest), stdout: typeof wrong.stdout === 'string' } : 'no record' }; } },
  // locks: unresolved — OFF capture-only writes no record before the switch: retained I2 (A4), not in the A/B/C/R3 table
  { id: 'S3-I2', site: 'capture builder and event/journal writer', inv: 'I2', stated: 'the OFF capture-only route writes no capture record before the pilot switch',
    runs: [['off-capture-only', 'base']],
    check: r => ({ pass: r['off-capture-only|base'].captures.length === 0, actual: r['off-capture-only|base'].captures.length }) },
  // locks: B — "host payload fields are re-validated at assessment time"; control: S6-I4
  { id: 'S3-I3', site: 'capture builder and event/journal writer', inv: 'I3', stated: 'capture records keep ref, session and tool correlation (concurrent writers are not covered by this cell)',
    runs: [['on-valid-direct-quoted-review', 'review']],
    check: r => { const records = r['on-valid-direct-quoted-review|review'].captures.filter(record => record.event === 'PostToolUse'); const ok = records.length > 0 && records.every(record => record.ref && record.session_id && record.tool_use_id); return { pass: ok, actual: records.map(record => ({ ref: Boolean(record.ref), session: Boolean(record.session_id), tool: Boolean(record.tool_use_id) })) }; } },
  // locks: B — "host payload fields are re-validated at assessment time"; control: S6-I1
  { id: 'S3-I4', site: 'capture builder and event/journal writer', inv: 'I4', stated: 'a candidate with changed bytes retains no stdout or digest for the pinned check',
    runs: [['on-valid-direct-quoted-review', 'review-pre-edit']],
    check: r => { const records = docRecords(r['on-valid-direct-quoted-review|review-pre-edit']); return { pass: records.length > 0 && records.every(record => typeof record.stdout !== 'string'), actual: records.map(record => ({ stdout: typeof record.stdout === 'string', digest: Boolean(record.implementationDigest) })) }; } },
  // locks: B — "copied-record replay tests are required negatives"; control: S6-I4
  { id: 'S4-I1', site: 'parseRegisteredCheck / registeredInstalledCheck callers', inv: 'I1', stated: 'a byte-identical copy outside the install is not the installed runtime and is not accepted',
    runs: [['on-valid-direct-quoted-review', 'copy-only']],
    check: r => { const obs = r['on-valid-direct-quoted-review|copy-only']; const copy = obs.captures.find(record => (record.command || '').includes(OUTSIDE_COPY)); const accepted = Boolean(copy) && acceptedRefs(obs).some(ref => ref.startsWith(copy.ref)); return { pass: Boolean(copy) && !accepted, actual: { copyRecorded: Boolean(copy), accepted } }; } },
  // locks: C — "unavailable observations ... cannot become a false PASS"; control: S6-I4
  { id: 'S4-I4', site: 'parseRegisteredCheck / registeredInstalledCheck callers', inv: 'I4', stated: 'every explicit malformed candidate is refused with a reason diagnostic',
    runs: [['on-malformed', 'base']],
    check: r => ({ pass: creditedOf(r['on-malformed|base']).length === 0 && diagCodes(r['on-malformed|base']).includes('unregistered-command'), actual: diagCodes(r['on-malformed|base']) }) },
  // locks: A — "Pilot ON credits valid evidence (no false PASS)"; control: S6-I4
  { id: 'S5-I1', site: 'capture candidate selection', inv: 'I1', stated: 'ordinary Edit, Agent and npm events create no doc-check references',
    runs: [['on-normal-session', 'base']],
    check: r => { const codes = diagCodes(r['on-normal-session|base']); return { pass: !codes.includes('unregistered-command'), actual: codes.filter(code => code === 'unregistered-command').length }; } },
  // locks: A — "Pilot ON credits valid evidence (no false PASS)"; control: S6-I4
  { id: 'S5-I4', site: 'capture candidate selection', inv: 'I4', stated: 'a grammar-valid candidate spelled with a case variant is offered and accepted, never silently omitted',
    runs: [['on-valid-direct-quoted-review', 'case-only']],
    check: (r, leg) => {
      const obs = r['on-valid-direct-quoted-review|case-only'];
      const probe = obs.caseProbe;
      if (!probe || !probe.available) return { skip: probe ? probe.reason : 'case-variant probe not run' };
      const records = obs.captures.filter(record => record.tool_use_id === 'toolu_f4t12_case');
      const accepted = records.length === 1 && acceptedRefs(obs).some(ref => ref.startsWith(records[0].ref));
      return { pass: accepted, actual: { records: records.length, accepted } };
    } },
  // locks: B — "host payload fields are re-validated at assessment time"; control: S6-I4
  { id: 'S6-I1', site: 'provider resolveEvent, event adapter and core', inv: 'I1', stated: 'the installed identity decides: a valid direct run is accepted; a post-capture or pre-run change is refused with its own code; an independent approve is accepted; a reviewer who ran evidence is refused with reviewer-not-independent',
    runs: [['on-valid-direct-quoted-review', 'base'], ['on-valid-direct-quoted-review', 'post-edit'], ['on-valid-direct-quoted-review', 'pre-edit'], ['on-valid-direct-quoted-review', 'review'], ['on-valid-direct-quoted-review', 'executor']],
    check: r => {
      const docRef = obs => { const record = obs.captures.find(item => item.event === 'PostToolUse' && /doc-check/.test(item.command || '') && !/"/.test(item.command || '')); return record ? record.ref + '#doc-lint' : null; };
      const verdictOf = (obs, ref) => (ref && obs.verdicts && obs.verdicts[ref]) || { status: 'missing', codes: [] };
      const reviewRef = obs => { const record = obs.captures.find(item => item.event === 'SubagentStop'); return record ? record.ref : null; };
      const base = r['on-valid-direct-quoted-review|base'];
      const post = r['on-valid-direct-quoted-review|post-edit'];
      const pre = r['on-valid-direct-quoted-review|pre-edit'];
      const review = r['on-valid-direct-quoted-review|review'];
      const executor = r['on-valid-direct-quoted-review|executor'];
      const parts = {
        directAccepted: acceptedRefs(base).includes(docRef(base)),
        postEditRefusedByDigest: verdictOf(post, docRef(post)).codes.includes('implementation-digest-mismatch'),
        preEditRefusedByPin: verdictOf(pre, docRef(pre)).codes.includes('implementation-pin-mismatch'),
        independentApproveAccepted: review.review.exit === 0 && verdictOf(review, reviewRef(review)).status === 'accepted',
        executorRefused: executor.review.exit === 2 && verdictOf(executor, reviewRef(executor)).codes.includes('reviewer-not-independent'),
      };
      return { pass: Object.values(parts).every(Boolean), actual: parts };
    } },
  // locks: unresolved — acceptedEvents schema is a mechanism shape; no violated owner clause (A7 §3)
  { id: 'S6-I3', site: 'provider resolveEvent, event adapter and core', inv: 'I3', stated: 'the persisted report keeps per-event provenance for every accepted event',
    runs: [['on-valid-direct-quoted-review', 'review']],
    check: r => { const obs = r['on-valid-direct-quoted-review|review']; const accepted = acceptedRefs(obs).length; const events = (obs.pilot && obs.pilot.acceptedEvents) || null; return { pass: accepted > 0 && Array.isArray(events) && events.length === accepted && events.every(event => event && event.provenance), actual: { acceptedRefs: accepted, acceptedEvents: events ? events.length : null } }; } },
  // locks: A — "Pilot ON credits valid evidence (no false PASS)"; control: S2-I1
  { id: 'S6-I4', site: 'provider resolveEvent, event adapter and core', inv: 'I4', stated: 'the provider accepts the safely quoted installed invocation',
    runs: [['on-valid-direct-quoted-review', 'review']],
    check: r => { const obs = r['on-valid-direct-quoted-review|review']; const quoted = quotedRecords(obs); return { pass: quoted.length === 1 && acceptedRefs(obs).some(ref => ref.startsWith(quoted[0].ref)), actual: { quotedRecords: quoted.length, accepted: acceptedRefs(obs).length } }; } },
  // locks: R3 — "only affected evidence is revoked"; control: S10-I2
  { id: 'S7-I1', site: 'assessment withdrawal and pilot report', inv: 'I1', stated: 'withdrawal after a runtime change removes only the doc-check record; ordinary verification survives',
    runs: [['runtime-npm-drift', 'drift']],
    check: r => ({ pass: ((r['runtime-npm-drift|drift'].after) || {}).lastVerifyAt ?? null !== null, actual: ((r['runtime-npm-drift|drift'].after) || {}).lastVerifyAt ?? null }) },
  // locks: R3 — "only affected evidence is revoked"; control: S7-I1
  { id: 'S7-I2', site: 'assessment withdrawal and pilot report', inv: 'I2', stated: 'withdrawal runs only for a session with a valid registered doc-check capture; a look-alike session keeps its ordinary timestamp',
    runs: [['lookalike-npm-drift', 'drift']],
    check: r => ({ pass: ((r['lookalike-npm-drift|drift'].after) || {}).lastVerifyAt ?? null !== null, actual: ((r['lookalike-npm-drift|drift'].after) || {}).lastVerifyAt ?? null }) },
  // locks: unresolved — a truthy identity field proves neither freshness nor selective revocation (A7 §2)
  { id: 'S7-I3', site: 'assessment withdrawal and pilot report', inv: 'I3', stated: 'the pilot report carries the workflow identity it was assessed under',
    runs: [['on-valid-direct-quoted-review', 'review']],
    check: r => ({ pass: Boolean(r['on-valid-direct-quoted-review|review'].pilot && r['on-valid-direct-quoted-review|review'].pilot.identity), actual: r['on-valid-direct-quoted-review|review'].pilot && r['on-valid-direct-quoted-review|review'].pilot.identity }) },
  // locks: R3 — "only affected evidence is revoked"; control: S7-I2
  { id: 'S7-I4', site: 'assessment withdrawal and pilot report', inv: 'I4', stated: 'a malformed candidate is not a registered capture, so withdrawal ignores it',
    runs: [['malformed-npm-drift', 'drift']],
    check: r => ({ pass: ((r['malformed-npm-drift|drift'].after) || {}).lastVerifyAt ?? null !== null, actual: ((r['malformed-npm-drift|drift'].after) || {}).lastVerifyAt ?? null }) },
  // locks: unresolved — OFF withholding absence is retained I2 (A4), not in the A/B/C/R3 table
  { id: 'S8-I2', site: 'workflow withholding', inv: 'I2', stated: 'OFF returns without any pilot withholding: the legacy verify step passes',
    runs: [['off-legacy', 'base']],
    check: r => ({ pass: r['off-legacy|base'].verify.exit === 0, actual: r['off-legacy|base'].verify.exit }) },
  // locks: unresolved — origin-marker key predicate; withholding is per run (A7 §2)
  { id: 'S8-I3', site: 'workflow withholding', inv: 'I3', stated: 'a pilot-withheld verify state carries an origin marker',
    runs: [['on-malformed', 'base']],
    check: r => { const obligations = r['on-malformed|base'].obligations || {}; return { pass: Object.keys(obligations).some(key => /origin|withheld|source/i.test(key)), actual: Object.keys(obligations) }; } },
  // locks: unresolved — OFF mounts and early return are an owner decision in A4, not in the A/B/C/R3 table
  { id: 'S9-I2', site: 'workflow callers and baseline capture', inv: 'I2', stated: 'OFF keeps its mounts and returns early: a legacy OFF workflow performs no pilot assessment and writes no capture (owner decision: mounts stay)',
    runs: [['off-legacy', 'base']],
    check: r => { const obs = r['off-legacy|base']; return { pass: obs.pilot === null && obs.captures.length === 0, actual: { pilot: obs.pilot === null ? null : 'report', captures: obs.captures.length } }; } },
  // locks: R3 — "only affected evidence is revoked"; control: S7-I1
  { id: 'S10-I2', site: 'generic verification wrapper and runtime CLI', inv: 'I2', stated: 'the generic verifier is unchanged by the pilot switch: a legacy success sets the timestamp',
    runs: [['off-legacy', 'base']],
    check: r => ({ pass: lastVerify(r['off-legacy|base']) !== null, actual: lastVerify(r['off-legacy|base']) }) },
  // locks: unresolved — source-tag key predicate; the R3 behaviour is S7-I1
  { id: 'S10-I3', site: 'generic verification wrapper and runtime CLI', inv: 'I3', stated: 'the generic verifier timestamp carries a source tag',
    runs: [['off-legacy', 'base']],
    check: r => ({ pass: timestampSourceKeys(r['off-legacy|base']).length > 0, actual: Object.keys(r['off-legacy|base'].handoff) }) },
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

// Mutation table (F4-Z1 §4). `apply` is a text needle in the source file; the same edit is applied to the packaged mirror.
// `owner` is the cell that must fail for this mutant. Probes whose target code does not exist yet are declared with
// `pending`, so the runner reports them as NOT APPLIED instead of hiding them.
const MUTANTS = [
  { id: 'M1-realpath-accepts-any-path', file: 'hooks/scripts/lib/doc-reconciliation-provider.js', owner: 'S4-I1',
    from: '  return argv === installed ? { tokens, installed } : null;', to: '  return { tokens, installed: argv };' },
  { id: 'M2-drop-assessment-digest-check', file: 'hooks/scripts/lib/doc-reconciliation-provider.js', owner: 'S6-I1',
    from: "      if (cap.implementationDigest !== fileDigest(registered.installed)) return rejected('implementation-digest-mismatch', 'the installed doc-check digest differs from the one observed at capture; no credit');\n", to: '' },
  { id: 'M3-drop-executor-exclusion', file: 'hooks/scripts/lib/doc-reconciliation-provider.js', owner: 'S6-I1',
    from: 'function journalExecutors(captures, author) {\n  const executors = new Set(textOf(author) ? [author] : []);', to: 'function journalExecutors(captures, author) {\n  return textOf(author) ? [author] : [];\n  const executors = new Set(textOf(author) ? [author] : []);' },
  { id: 'M4-drop-shipped-pin-check', file: 'hooks/scripts/lib/doc-reconciliation-provider.js', owner: 'S6-I1',
    from: "      if (fileDigest(registered.installed) !== SHIPPED_DOC_CHECK_DIGEST) return rejected('implementation-pin-mismatch', 'the installed doc-check is not the shipped script (canonical digest differs from SHIPPED_DOC_CHECK_DIGEST); no credit');\n", to: '' },
  { id: 'M5-revert-capture-candidate-filter', file: 'hooks/scripts/lib/doc-reconciliation-pilot.js', owner: 'S5-I1',
    from: '(item.event === \'SubagentStop\' || docCheckCandidate(item))', to: '(item.event === \'SubagentStop\' || item.event === \'PostToolUse\')' },
  { id: 'M6-revert-state-persist-pin-guard', file: 'hooks/scripts/state-persist.js', owner: 'S2-I2',
    from: '        ? docCheck.fileDigest(installedCheck.installed) === docCheck.SHIPPED_DOC_CHECK_DIGEST', to: '        ? true' },
  { id: 'P-retain-unpinned-stdout', file: 'hooks/scripts/lib/doc-reconciliation-provider.js', owner: 'S3-I4',
    from: '    if (installedCheck && record.implementationDigest === SHIPPED_DOC_CHECK_DIGEST) {', to: '    if (installedCheck) {' },
  { id: 'P-state-persist-resolver-caller-removed', file: 'hooks/scripts/state-persist.js', owner: 'S2-I1',
    from: 'const installedCheck = docCheck && docCheck.registeredInstalledCheck(command, cwdOf(payload, root));', to: 'const installedCheck = null;' },
  { id: 'P-move-switch-after-workspace-bind', pending: 'needs the Packet B entry gate (switch before workspace binding); the current order is not a single edit', owner: 'S1-I2' },
  { id: 'P-drop-capture-provenance', pending: 'needs source-keyed capture provenance (Packet B); no such field exists to drop', owner: 'S3-I3' },
  { id: 'P-drop-adapter-provenance-identity', pending: 'the adapter required-field list is shared with the provenance tag introduced by W7; separating it needs Packet A', owner: 'S6-I3' },
  { id: 'P-delete-generic-timestamps-in-withdrawal', pending: 'the withdrawal already deletes both timestamps (the defect); the probe needs the source-scoped withdrawal of Packet B', owner: 'S7-I2' },
  { id: 'P-overwrite-concurrent-source-record', pending: 'no source-keyed records exist yet (Packet B)', owner: 'S8-I3' },
  { id: 'P-bypass-stop-source-selection', pending: 'no Stop source selection exists yet (Packet B); Z1 §4 names a Stop-reader site that Z1 §2 maps to no invariant cell, so this probe has no owner cell yet', owner: 'NO-CELL' },
];

async function main(argv) {
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose');
  if (argv.includes('--mutants')) return mutantRun();
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

// Mutation runner: each mutant runs on a fresh export of HEAD with this suite overlaid; the mutant's needles must be applied
// to both legs, and the owning cell must be the one that changes to RED. A mutant that is not applied, or that is detected
// only by another cell, fails. Pending probes fail as NOT APPLIED.
function mutantRun() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f4t12-mutbase-'));
  const archive = spawnSync('git', ['-C', ROOT, 'archive', 'HEAD'], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  if (archive.status !== 0) { console.log('INFRA: git archive HEAD failed'); return 2; }
  spawnSync('tar', ['-x', '-C', base], { input: archive.stdout });
  for (const rel of ['ci/mechanism-325-f4-invariants.test.js', 'ci/lib/doc-reconciliation-prep-fixtures.js', 'ci/lib/doc-reconciliation-replay.js', 'ci/lib/doc-reconciliation-staged-tree.js']) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(base, rel));
  }
  const ran = spawnSync(process.execPath, [path.join(base, 'ci', 'mechanism-325-f4-invariants.test.js'), '--json'], { cwd: base, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const baseline = JSON.parse(ran.stdout || '{"results":{}}').results;
  let failures = 0;
  const report = [];
  for (const mutant of MUTANTS) {
    if (mutant.pending) { failures += 1; report.push(`NOT APPLIED  ${mutant.id} (owner ${mutant.owner}): ${mutant.pending}`); continue; }
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f4t12-mut-')), 'copy');
    spawnSync('cp', ['-R', base, dir]);
    let applied = true;
    for (const rel of [mutant.file, mutant.file.replace('hooks/scripts/', 'plugins/harness-everything/hooks/scripts/')]) {
      const file = path.join(dir, rel);
      const text = fs.readFileSync(file, 'utf8');
      if (text.split(mutant.from).length !== 2) { applied = false; break; }
      fs.writeFileSync(file, text.replace(mutant.from, mutant.to));
    }
    if (!applied) { failures += 1; report.push(`NOT APPLIED  ${mutant.id}: the needle is not present exactly once`); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    const out = spawnSync(process.execPath, [path.join(dir, 'ci', 'mechanism-325-f4-invariants.test.js'), '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const mutated = JSON.parse(out.stdout || '{"results":{}}').results;
    const changed = [...new Set(Object.values(mutated).filter(item => item.status === 'RED' && (baseline[`${item.cell}@${item.leg}`] || {}).status !== 'RED').map(item => item.cell))];
    const owner = changed.includes(mutant.owner);
    const verdict = owner ? (changed.length === 1 ? 'DETECTED' : 'DETECTED (owner plus others)') : changed.length ? 'WRONG ASSERTION' : 'NOT DETECTED';
    if (!owner) failures += 1;
    report.push(`${verdict.padEnd(18)} ${mutant.id} (owner ${mutant.owner}): ${changed.join(', ') || 'no cell changed'}`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
  console.log(report.join('\n'));
  console.log(failures ? `STATUS: MUTANTS-FAILED (${failures})` : 'STATUS: MUTANTS-DETECTED');
  return failures ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => {
    fs.rmSync(traceDir, { recursive: true, force: true });
    fs.rmSync(OUTSIDE_DIR, { recursive: true, force: true });
    process.exitCode = code;
  });
}

module.exports = { CELLS, MUTANTS };
